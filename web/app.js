'use strict';

// ArchGraph 本地知识图谱工具 — 前端逻辑（零构建）。
// 编辑器外壳（WP2788-S2）：顶栏（项目选择/添加移除/检索/导入导出/undo/redo）
// + 三栏主区（左模型树 / 中画布 / 右属性面板），CSS flex+视口单位全区域自适应，
// 左右栏可折叠，窄屏（≤700px）堆叠降级。
// 画布内核（WP2788-S1B）：MaxGraph 0.24.0（Apache-2.0，draw.io 引擎后继，
// vendored /vendor/maxgraph/，一次性 esbuild bundle，见 web/vendor/maxgraph/NOTICE）。
// 视图成员→顶点（圆角矩形 + 按 ArchiMate 层着色 + name/type 双行标签），
// 关系→正交路由箭头边（标签=关系类型）；交互收敛：允许拖动顶点/平移/缩放，
// 禁用单元格内文字编辑（防手改标签脱离模型）。
// 内核沿革：G6 v5（M1）→ Excalidraw（S1，因风格不适退役）→ MaxGraph（S1B）。
// 选中联动：画布点选 ↔ 模型树高亮 ↔ 右栏属性详情；树点击 → 画布定位并选中。
// 布局侧车（M1-S2）：打开视图先 GET /views/:id/layout 覆盖顶点坐标；
// 顶点拖动结束后防抖 PUT /views/:id/layout 落盘。坐标不进图谱 JSON。
// 手动项目根（WP2787）：项目栏可添加本地目录为项目（/api/roots 校验+持久化），
// 手动添加的项目可移除；自动发现的项目不可移除。

(function () {
  const state = {
    projects: [],
    manualRoots: [],
    selectedProjectId: null,
    views: [],
    currentViewId: null,
    graph: null,
    maxGraph: null,
    resizeHandler: null,
    layoutSaveTimer: null,
    lastSavedLayout: '',
  };

  const $ = (id) => document.getElementById(id);

  async function api(path, options) {
    const res = await fetch(path, options);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return body;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------
  // 项目（顶栏）：列表 / 添加 / 移除（WP2787 能力全保留）
  // ------------------------------------------------------------------

  async function loadProjects() {
    const [{ projects }, roots] = await Promise.all([api('/api/projects'), loadManualRoots()]);
    state.projects = projects;
    state.manualRoots = roots;
    renderProjects();
  }

  async function loadManualRoots() {
    try {
      const { roots } = await api('/api/roots');
      return Array.isArray(roots) ? roots : [];
    } catch {
      return [];
    }
  }

  function renderProjects() {
    const list = $('project-list');
    list.innerHTML = '';
    for (const project of state.projects) {
      const li = document.createElement('li');
      const valid = project.valid ? '有效' : '无效';
      const manual = state.manualRoots.includes(project.root);
      li.className = project.id === state.selectedProjectId ? 'selected' : '';
      li.innerHTML = `
        <span class="project-name">${escapeHtml(project.name)}${manual ? ' <span class="badge manual">手动</span>' : ''}</span>
        <span class="project-meta">
          <span class="badge ${project.valid ? 'ok' : 'bad'}">${valid}</span>
          ${project.elements}元素/${project.views}视图
        </span>`;
      li.addEventListener('click', () => selectProject(project.id));
      if (manual) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-project';
        removeBtn.title = `移除手动项目：${project.root}`;
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          doRemoveProject(project);
        });
        li.appendChild(removeBtn);
      }
      list.appendChild(li);
    }
  }

  async function doAddProject() {
    const input = $('add-project-path');
    const feedback = $('add-project-feedback');
    const root = input.value.trim();
    if (!root) {
      feedback.textContent = '请输入项目根目录绝对路径';
      return;
    }
    try {
      await api('/api/roots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root }),
      });
      input.value = '';
      feedback.textContent = '';
      await loadProjects();
    } catch (error) {
      feedback.textContent = `添加失败：${error.message}`;
    }
  }

  async function doRemoveProject(project) {
    const feedback = $('add-project-feedback');
    try {
      await api('/api/roots', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: project.root }),
      });
      if (state.selectedProjectId === project.id) {
        state.selectedProjectId = null;
      }
      feedback.textContent = '';
      await loadProjects();
    } catch (error) {
      feedback.textContent = `移除失败：${error.message}`;
    }
  }

  function doRemoveSelectedProject() {
    const feedback = $('add-project-feedback');
    const project = state.projects.find((p) => p.id === state.selectedProjectId);
    if (!project) {
      feedback.textContent = '请先选择要移除的项目';
      return;
    }
    if (!state.manualRoots.includes(project.root)) {
      feedback.textContent = '自动发现的项目不可移除（仅手动添加的项目可移除）';
      return;
    }
    doRemoveProject(project);
  }

  async function selectProject(id) {
    state.selectedProjectId = id;
    state.currentViewId = null;
    state.graph = null;
    destroyGraph();
    $('graph-panel').hidden = true;
    renderProjects();
    $('no-selection').hidden = true;
    const project = state.projects.find((p) => p.id === id);
    $('current-project').textContent = `当前项目：${project ? project.name : id}`;
    $('current-view-hint').textContent = '';
    clearProperties();
    await Promise.all([loadStatus(), loadViews()]);
  }

  async function loadStatus() {
    const status = await api(`/api/projects/${state.selectedProjectId}/status`);
    $('status-bar').textContent = status.valid
      ? `图谱有效 · 元素 ${status.elements} · 关系 ${status.relationships} · 视图 ${status.views} · 最近修改 ${new Date(status.mtime).toLocaleString()}`
      : `图谱无效：${status.error || (status.errors || []).join('; ')}`;
  }

  // ------------------------------------------------------------------
  // 左栏模型树：视图列表 → 打开的视图展开成员元素
  // ------------------------------------------------------------------

  async function loadViews() {
    const { views } = await api(`/api/projects/${state.selectedProjectId}/views`);
    state.views = views;
    renderViews();
  }

  function renderViews() {
    const list = $('view-list');
    list.innerHTML = '';
    if (state.views.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted tree-empty';
      li.textContent = state.selectedProjectId ? '该项目无视图' : '请先选择项目';
      list.appendChild(li);
      return;
    }
    for (const view of state.views) {
      const li = document.createElement('li');
      const open = view.view_id === state.currentViewId;
      li.className = `tree-view${open ? ' selected open' : ''}`;
      li.dataset.viewId = view.view_id;
      const row = document.createElement('div');
      row.className = 'tree-view-row';
      row.innerHTML = `${escapeHtml(view.view_name)} <span class="muted">(元素 ${view.element_count})</span>`;
      row.addEventListener('click', () => openView(view.view_id, view.view_name));
      li.appendChild(row);
      if (open && state.graph) {
        const members = document.createElement('ul');
        members.className = 'member-list';
        for (const node of state.graph.nodes) {
          const mli = document.createElement('li');
          mli.className = 'tree-member';
          mli.dataset.elementId = node.id;
          mli.innerHTML = `${escapeHtml(node.label || node.id)} <span class="muted">${escapeHtml(node.type || '')}</span>`;
          mli.addEventListener('click', (event) => {
            event.stopPropagation();
            focusElement(node.id);
          });
          members.appendChild(mli);
        }
        li.appendChild(members);
      }
      list.appendChild(li);
    }
  }

  function highlightTreeMember(graphId) {
    for (const el of document.querySelectorAll('#view-list .tree-member')) {
      el.classList.toggle('selected', graphId != null && el.dataset.elementId === graphId);
    }
  }

  // ------------------------------------------------------------------
  // 中栏画布（MaxGraph）
  // ------------------------------------------------------------------

  async function openView(viewId, viewName) {
    state.currentViewId = viewId;
    renderViews();
    const data = await api(`/api/projects/${state.selectedProjectId}/views/${viewId}/graph`);
    // 布局侧车（M1-S2）：先取合并后的侧车坐标覆盖图数据默认圆形布局。
    // 侧车不可用时回退图端点自带坐标，不阻塞渲染。
    try {
      const layout = await api(`/api/projects/${state.selectedProjectId}/views/${viewId}/layout`);
      const positions = (layout && layout.elements) || {};
      for (const node of data.nodes) {
        const pos = positions[node.id];
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          node.x = pos.x;
          node.y = pos.y;
        }
      }
    } catch {
      /* 布局侧车不可用：使用图端点默认坐标 */
    }
    state.graph = data;
    state.lastSavedLayout = '';
    $('graph-title').textContent = `视图：${viewName}`;
    $('current-view-hint').textContent = `当前视图：${viewName}`;
    $('graph-panel').hidden = false;
    renderViews();
    renderGraph();
    clearProperties();
  }

  function renderGraph() {
    destroyGraph();
    const container = $('graph-container');
    container.innerHTML = '';
    if (!state.graph) {
      return;
    }
    const lib = window.MaxGraphLib;
    if (!lib) {
      container.textContent = 'MaxGraph 未加载（/vendor/maxgraph/ 资源缺失）';
      return;
    }
    const graph = new lib.Graph(container);
    state.maxGraph = graph;

    // 交互收敛到架构场景：禁用单元格内文字编辑（防止手改标签脱离模型）。
    graph.setCellsEditable(false);
    // 背景左键平移 + 滚轮缩放（内置能力按 MaxGraph API 开启）。
    graph.setPanning(true);
    if (graph.panningHandler) {
      graph.panningHandler.useLeftButtonForPanning = true;
    }
    lib.InternalEvent.addMouseWheelListener((evt, up) => {
      if (up) {
        graph.zoomIn();
      } else {
        graph.zoomOut();
      }
      lib.InternalEvent.consume(evt);
    }, container);

    // 顶点拖动结束 → 防抖落布局侧车（语义不变，签名由侧车端点承担）。
    graph.addListener(lib.InternalEvent.MOVE_CELLS, () => scheduleLayoutSave());

    // 选中联动：画布点选 → 右栏属性详情 + 左栏模型树高亮。
    graph.getSelectionModel().addListener(lib.InternalEvent.CHANGE, () => onSelectionChange());

    graph.batchUpdate(() => {
      const parent = graph.getDefaultParent();
      for (const node of state.graph.nodes) {
        graph.insertVertex({
          parent,
          id: shapeIdFor(node.id),
          value: `${node.label || node.id}\n${node.type || ''}`,
          x: node.x,
          y: node.y,
          width: 150,
          height: 50,
          // MaxGraph 0.24 样式为对象（非 mxGraph 字符串语法）
          style: {
            rounded: 1,
            whiteSpace: 'wrap',
            fillColor: colorForLayer(node.layer),
            strokeColor: '#555555',
            fontColor: '#1f2933',
            fontSize: 12,
          },
        });
      }
      for (const edge of state.graph.edges) {
        const source = graph.getDataModel().getCell(shapeIdFor(edge.source));
        const target = graph.getDataModel().getCell(shapeIdFor(edge.target));
        if (!source || !target) {
          continue;
        }
        graph.insertEdge({
          parent,
          id: `e-${edge.id}`,
          value: edge.label || edge.type || '',
          source,
          target,
          style: {
            edgeStyle: 'orthogonalEdgeStyle',
            rounded: 0,
            endArrow: 'block',
            endFill: 1,
            strokeColor: '#868e96',
            fontColor: '#555555',
            fontSize: 10,
          },
        });
      }
    });

    // 画布随容器/窗口自适应：窗口 resize 时同步画布尺寸。
    state.resizeHandler = () => {
      try {
        graph.sizeDidChange();
      } catch {
        /* 画布尺寸同步失败不影响交互 */
      }
    };
    window.addEventListener('resize', state.resizeHandler);
  }

  function destroyGraph() {
    if (state.resizeHandler) {
      window.removeEventListener('resize', state.resizeHandler);
      state.resizeHandler = null;
    }
    if (state.maxGraph) {
      try {
        state.maxGraph.destroy();
      } catch {
        /* 画布销毁失败忽略 */
      }
      state.maxGraph = null;
    }
  }

  // 图形元素 id ↔ MaxGraph cell id：确定性派生（n-<graphId>），保证侧车按元素 id 读写。
  function shapeIdFor(graphId) {
    return `n-${graphId}`;
  }

  function colorForLayer(layer) {
    switch (layer) {
      case 'Business': return '#dbeafe';
      case 'Application': return '#d1fae5';
      case 'Technology': return '#fef3c7';
      case 'Implementation': return '#fce7f3';
      default: return '#f3f4f6';
    }
  }

  // 树点击 → 画布定位并选中该顶点（0.24：scrollCellToVisible(cell, center) + setSelectionCell）。
  function focusElement(graphId) {
    if (!state.maxGraph) {
      return;
    }
    const cell = state.maxGraph.getDataModel().getCell(shapeIdFor(graphId));
    if (!cell) {
      return;
    }
    try {
      state.maxGraph.scrollCellToVisible(cell, true);
    } catch {
      /* 定位失败不阻断选中 */
    }
    state.maxGraph.setSelectionCell(cell);
  }

  // ------------------------------------------------------------------
  // 右栏属性面板：展示 + 选中联动（编辑向导为 S3，本切片只读展示）
  // ------------------------------------------------------------------

  function onSelectionChange() {
    const graph = state.maxGraph;
    if (!graph || !state.graph) {
      return;
    }
    const cell = graph.getSelectionCell();
    const id = cell && typeof cell.getId === 'function' ? cell.getId() : null;
    if (typeof id === 'string' && id.startsWith('n-')) {
      const graphId = id.slice(2);
      const node = state.graph.nodes.find((n) => n.id === graphId);
      if (node) {
        showElementProperties(node);
        highlightTreeMember(graphId);
        return;
      }
    }
    if (typeof id === 'string' && id.startsWith('e-')) {
      const edge = state.graph.edges.find((e) => e.id === id.slice(2));
      if (edge) {
        showEdgeProperties(edge);
        highlightTreeMember(null);
        return;
      }
    }
    clearProperties();
  }

  function propsHtml(rows) {
    return `<dl class="props">${rows
      .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join('')}</dl>`;
  }

  function showElementProperties(node) {
    const detail = $('properties-detail');
    detail.classList.remove('muted');
    const data = node.data || {};
    detail.innerHTML = propsHtml([
      ['名称', node.label || node.id],
      ['元素 id', node.id],
      ['类型', node.type || '—'],
      ['ArchiMate 层', node.layer || '—'],
      ['描述', data.description || '—'],
      ['父元素', data.parent || '—'],
      ['属性', data.attributes || '（图端点未返回 attributes，可经高级编辑/上下文检索查看）'],
    ]);
  }

  function showEdgeProperties(edge) {
    const nameOf = (graphId) => {
      const node = state.graph.nodes.find((n) => n.id === graphId);
      return node ? node.label || node.id : graphId;
    };
    const detail = $('properties-detail');
    detail.classList.remove('muted');
    detail.innerHTML = propsHtml([
      ['关系类型', edge.type || '—'],
      ['关系 id', edge.id],
      ['源元素', nameOf(edge.source)],
      ['目标元素', nameOf(edge.target)],
      ['陈述', edge.label || edge.type || '—'],
    ]);
  }

  function clearProperties() {
    const detail = $('properties-detail');
    detail.classList.add('muted');
    detail.textContent = '点击画布顶点 / 边或模型树元素查看详情';
    highlightTreeMember(null);
  }

  function switchRightTab(name) {
    $('tab-properties').classList.toggle('active', name === 'properties');
    $('tab-advanced').classList.toggle('active', name === 'advanced');
    $('properties-tab').hidden = name !== 'properties';
    $('advanced-tab').hidden = name !== 'advanced';
  }

  // ------------------------------------------------------------------
  // 布局侧车落盘（语义不变）
  // ------------------------------------------------------------------

  function scheduleLayoutSave() {
    if (state.layoutSaveTimer) {
      clearTimeout(state.layoutSaveTimer);
    }
    state.layoutSaveTimer = setTimeout(saveLayout, 400);
  }

  async function saveLayout() {
    state.layoutSaveTimer = null;
    if (!state.maxGraph || !state.graph || !state.selectedProjectId || !state.currentViewId) {
      return;
    }
    const elements = {};
    const model = state.maxGraph.getDataModel();
    for (const node of state.graph.nodes) {
      const cell = model.getCell(shapeIdFor(node.id));
      const geo = cell && cell.getGeometry();
      if (geo) {
        elements[node.id] = { x: Math.round(geo.x), y: Math.round(geo.y) };
      }
    }
    const serialized = JSON.stringify(elements);
    if (serialized === state.lastSavedLayout) {
      return; // 坐标未变化（如初次渲染回放），不打扰侧车
    }
    try {
      await api(`/api/projects/${state.selectedProjectId}/views/${state.currentViewId}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements }),
      });
      state.lastSavedLayout = serialized;
    } catch {
      /* 布局持久化失败不影响画布交互 */
    }
  }

  // ------------------------------------------------------------------
  // 检索（顶栏入口，结果下拉）
  // ------------------------------------------------------------------

  async function doSearch() {
    const query = $('search-input').value.trim();
    const mode = $('search-mode').value;
    if (!query) {
      return;
    }
    const body = await api(`/api/projects/${state.selectedProjectId}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, mode }),
    });
    renderSearchResults(body);
  }

  function renderSearchResults(body) {
    const list = $('search-results');
    list.innerHTML = '';
    if (body.supported === false) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = body.message || '该检索模式暂不支持';
      list.appendChild(li);
    }
    const hits = body.hits || [];
    if (hits.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = '无结果';
      list.appendChild(li);
    }
    for (const hit of hits.slice(0, 20)) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${escapeHtml(hit.kind)}</b> ${escapeHtml(hit.name || hit.id)} <span class="muted">${escapeHtml(hit.type || '')}</span>`;
      li.addEventListener('click', () => {
        $('search-input').value = hit.id || hit.name || '';
        $('search-dropdown').hidden = true;
        // 命中当前画布内的元素 → 画布定位并选中
        if (hit.kind === 'element' && state.graph && state.graph.nodes.some((n) => n.id === hit.id)) {
          focusElement(hit.id);
        }
      });
      list.appendChild(li);
    }
    $('search-dropdown').hidden = false;
  }

  // ------------------------------------------------------------------
  // 高级编辑（既有手填 JSON 编辑区，保留为右栏页签）
  // ------------------------------------------------------------------

  function renderEditForm(op) {
    const form = $('edit-form');
    const examples = {
      addElement: '{"element":{"id":"9001","name":"新元素","type":"Application Component"},"view_ids":["1800"]}',
      updateElement: '{"id":"9001","patch":{"description":"新描述"}}',
      removeElement: '{"id":"9001"}',
      addView: '{"view":{"view_id":"9002","view_name":"新视图","included_elements":[]}}',
      updateRelationship: '{"id":"1980","patch":{"description":"新描述"}}',
      removeRelationship: '{"id":"1980"}',
    };
    form.innerHTML = `
      <label>操作载荷（JSON）</label>
      <textarea id="edit-payload" rows="6">${examples[op] || '{}'}</textarea>`;
  }

  async function doEdit() {
    const op = $('edit-op').value;
    let payload;
    try {
      payload = JSON.parse($('edit-payload').value || '{}');
    } catch (error) {
      $('edit-feedback').textContent = `载荷不是合法 JSON：${error.message}`;
      return;
    }
    try {
      const result = await api(`/api/projects/${state.selectedProjectId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, payload }),
      });
      $('edit-feedback').textContent = `成功：${result.op} → ${result.tool}`;
      await Promise.all([loadStatus(), loadViews()]);
    } catch (error) {
      $('edit-feedback').textContent = `失败：${error.message}`;
    }
  }

  async function doUndoRedo(kind) {
    try {
      await api(`/api/projects/${state.selectedProjectId}/${kind}`, { method: 'POST' });
      $('edit-feedback').textContent = `${kind} 完成`;
      await Promise.all([loadStatus(), loadViews()]);
    } catch (error) {
      $('edit-feedback').textContent = `${kind} 失败：${error.message}`;
    }
  }

  async function doExport() {
    const res = await api(`/api/projects/${state.selectedProjectId}/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const project = state.projects.find((p) => p.id === state.selectedProjectId);
    a.href = url;
    a.download = `${project ? project.name : 'SystemArchitecture'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(file) {
    const text = await file.text();
    try {
      const result = await api(`/api/projects/${state.selectedProjectId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      $('edit-feedback').textContent = `导入成功：元素 ${result.elements} · 关系 ${result.relationships} · 视图 ${result.views}`;
      await Promise.all([loadProjects(), loadStatus(), loadViews()]);
    } catch (error) {
      $('edit-feedback').textContent = `导入失败：${error.message}`;
    }
  }

  // ------------------------------------------------------------------
  // 面板折叠（全区域自适应：桌面宽度收缩，窄屏 display:none 降级）
  // ------------------------------------------------------------------

  function togglePanel(panelId) {
    const panel = $(panelId);
    panel.classList.toggle('collapsed');
    // 折叠改变画布容器尺寸 → 同步画布
    requestAnimationFrame(() => {
      if (state.maxGraph) {
        try {
          state.maxGraph.sizeDidChange();
        } catch {
          /* 忽略 */
        }
      }
    });
  }

  function bindEvents() {
    $('refresh-projects').addEventListener('click', loadProjects);
    $('btn-add-project').addEventListener('click', doAddProject);
    $('add-project-path').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        doAddProject();
      }
    });
    $('btn-remove-project').addEventListener('click', doRemoveSelectedProject);
    $('btn-export').addEventListener('click', doExport);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', (event) => {
      if (event.target.files[0]) {
        doImport(event.target.files[0]);
      }
      event.target.value = '';
    });
    $('btn-undo').addEventListener('click', () => doUndoRedo('undo'));
    $('btn-redo').addEventListener('click', () => doUndoRedo('redo'));
    $('btn-search').addEventListener('click', doSearch);
    $('search-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        doSearch();
      }
    });
    $('btn-toggle-left').addEventListener('click', () => togglePanel('left-panel'));
    $('btn-toggle-right').addEventListener('click', () => togglePanel('right-panel'));
    $('tab-properties').addEventListener('click', () => switchRightTab('properties'));
    $('tab-advanced').addEventListener('click', () => switchRightTab('advanced'));
    $('edit-op').addEventListener('change', (event) => renderEditForm(event.target.value));
    $('btn-edit').addEventListener('click', doEdit);
    renderEditForm('addElement');
  }

  async function boot() {
    bindEvents();
    try {
      await loadProjects();
    } catch (error) {
      $('no-selection').textContent = `无法连接服务：${error.message}`;
      $('no-selection').hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
