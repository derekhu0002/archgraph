'use strict';

// ArchGraph 本地知识图谱工具 — 前端逻辑（零构建）。
// 画布内核（WP2788-S1）：Excalidraw 0.18.1（MIT，vendored /vendor/excalidraw/，
// React 18 + Excalidraw 一次性 esbuild 单文件 ESM bundle，浏览器原生 module 加载）。
// 视图成员→矩形（按 ArchiMate 层着色 + name/type 双行标签），关系→绑定箭头（标签=关系类型）。
// 布局侧车（M1-S2）：打开视图先 GET /views/:id/layout 覆盖形状坐标；
// 场景变化（拖动等）后防抖 PUT /views/:id/layout 落盘。坐标不进图谱 JSON。
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
    excalidrawRoot: null,
    excalidrawApi: null,
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
        <div class="project-name">${escapeHtml(project.name)}${manual ? ' <span class="badge manual">手动</span>' : ''}</div>
        <div class="project-meta">
          <span class="badge ${project.valid ? 'ok' : 'bad'}">${valid}</span>
          元素 ${project.elements} · 关系 ${project.relationships} · 视图 ${project.views}
        </div>`;
      li.addEventListener('click', () => selectProject(project.id));
      if (manual) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-project';
        removeBtn.title = `移除手动项目：${project.root}`;
        removeBtn.textContent = '移除';
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

  async function selectProject(id) {
    state.selectedProjectId = id;
    state.currentViewId = null;
    state.graph = null;
    renderProjects();
    $('no-selection').hidden = true;
    $('workspace').hidden = false;
    const project = state.projects.find((p) => p.id === id);
    $('current-project').textContent = `当前项目：${project ? project.name : id}`;
    await Promise.all([loadStatus(), loadViews()]);
  }

  async function loadStatus() {
    const status = await api(`/api/projects/${state.selectedProjectId}/status`);
    $('status-bar').textContent = status.valid
      ? `图谱有效 · 元素 ${status.elements} · 关系 ${status.relationships} · 视图 ${status.views} · 最近修改 ${new Date(status.mtime).toLocaleString()}`
      : `图谱无效：${status.error || (status.errors || []).join('; ')}`;
  }

  async function loadViews() {
    const { views } = await api(`/api/projects/${state.selectedProjectId}/views`);
    state.views = views;
    renderViews();
  }

  function renderViews() {
    const list = $('view-list');
    list.innerHTML = '';
    for (const view of state.views) {
      const li = document.createElement('li');
      li.className = view.view_id === state.currentViewId ? 'selected' : '';
      li.innerHTML = `${escapeHtml(view.view_name)} <span class="muted">(元素 ${view.element_count})</span>`;
      li.addEventListener('click', () => openView(view.view_id, view.view_name));
      list.appendChild(li);
    }
  }

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
    renderGraph();
  }

  function renderGraph() {
    if (state.excalidrawRoot) {
      state.excalidrawRoot.unmount();
      state.excalidrawRoot = null;
      state.excalidrawApi = null;
    }
    const container = $('graph-container');
    container.innerHTML = '';
    if (!state.graph) {
      return;
    }
    const lib = window.ExcalidrawLib;
    if (!lib) {
      container.textContent = 'Excalidraw 未加载（/vendor/excalidraw/ 资源缺失）';
      return;
    }
    const elements = buildExcalidrawElements(lib, state.graph);
    const root = lib.createRoot(container);
    root.render(
      lib.React.createElement(lib.Excalidraw, {
        initialData: {
          elements,
          appState: { viewBackgroundColor: '#fafafa' },
        },
        excalidrawAPI: (apiInstance) => {
          state.excalidrawApi = apiInstance;
        },
        // 场景变化（拖动/移动等）→ 防抖落布局侧车；语义不变，签名由侧车端点承担。
        onChange: () => scheduleLayoutSave(),
        theme: 'light',
      }),
    );
    state.excalidrawRoot = root;
  }

  // 图形元素 id ↔ Excalidraw 元素：确定性派生 id（n-<graphId>）+ customData.graphId 双保险。
  function shapeIdFor(graphId) {
    return `n-${graphId}`;
  }

  function buildExcalidrawElements(lib, graph) {
    const skeletons = [];
    for (const node of graph.nodes) {
      skeletons.push({
        id: shapeIdFor(node.id),
        type: 'rectangle',
        x: node.x,
        y: node.y,
        width: 160,
        height: 64,
        backgroundColor: colorForLayer(node.layer),
        fillStyle: 'solid',
        strokeColor: '#343a40',
        customData: { graphId: node.id },
        label: { text: `${node.label || node.id}\n${node.type || ''}` },
      });
    }
    for (const edge of graph.edges) {
      skeletons.push({
        type: 'arrow',
        x: 0,
        y: 0,
        strokeColor: '#868e96',
        customData: { graphId: edge.id },
        start: { id: shapeIdFor(edge.source) },
        end: { id: shapeIdFor(edge.target) },
        label: { text: edge.label || edge.type || '' },
      });
    }
    // regenerateIds:false 保留确定性 id，保证侧车身份映射稳定。
    return lib.convertToExcalidrawElements(skeletons, { regenerateIds: false });
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

  function scheduleLayoutSave() {
    if (state.layoutSaveTimer) {
      clearTimeout(state.layoutSaveTimer);
    }
    state.layoutSaveTimer = setTimeout(saveLayout, 400);
  }

  async function saveLayout() {
    state.layoutSaveTimer = null;
    if (!state.excalidrawApi || !state.graph || !state.selectedProjectId || !state.currentViewId) {
      return;
    }
    const elements = {};
    const scene = state.excalidrawApi.getSceneElements();
    for (const el of scene) {
      if (el && el.type === 'rectangle' && !el.isDeleted && el.customData && el.customData.graphId) {
        elements[el.customData.graphId] = { x: Math.round(el.x), y: Math.round(el.y) };
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
      });
      list.appendChild(li);
    }
  }

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

  function bindEvents() {
    $('refresh-projects').addEventListener('click', loadProjects);
    $('btn-add-project').addEventListener('click', doAddProject);
    $('add-project-path').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        doAddProject();
      }
    });
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
