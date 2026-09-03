'use strict';

// ArchGraph 本地知识图谱工具 — 前端逻辑（零构建）。
// 图形内核：AntV G6 v5（本地 vendor /vendor/g6.min.js，默认 Canvas 渲染），
// 支持 drag-canvas / zoom-canvas / drag-element / click-select。
// 布局侧车（M1-S2）：打开视图先 GET /views/:id/layout 覆盖节点坐标；
// 节点拖动结束后 PUT /views/:id/layout 落盘（防抖）。坐标不进图谱 JSON。

(function () {
  const state = {
    projects: [],
    selectedProjectId: null,
    views: [],
    currentViewId: null,
    graph: null,
    g6Graph: null,
    layoutSaveTimer: null,
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
    const { projects } = await api('/api/projects');
    state.projects = projects;
    renderProjects();
  }

  function renderProjects() {
    const list = $('project-list');
    list.innerHTML = '';
    for (const project of state.projects) {
      const li = document.createElement('li');
      const valid = project.valid ? '有效' : '无效';
      li.className = project.id === state.selectedProjectId ? 'selected' : '';
      li.innerHTML = `
        <div class="project-name">${escapeHtml(project.name)}</div>
        <div class="project-meta">
          <span class="badge ${project.valid ? 'ok' : 'bad'}">${valid}</span>
          元素 ${project.elements} · 关系 ${project.relationships} · 视图 ${project.views}
        </div>`;
      li.addEventListener('click', () => selectProject(project.id));
      list.appendChild(li);
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
    $('graph-title').textContent = `视图：${viewName}`;
    renderGraph();
  }

  function renderGraph() {
    if (state.g6Graph) {
      state.g6Graph.destroy();
      state.g6Graph = null;
    }
    const container = $('graph-container');
    container.innerHTML = '';
    if (!state.graph) {
      return;
    }
    if (!window.G6) {
      container.textContent = 'G6 v5 未加载（/vendor/g6.min.js 缺失）';
      return;
    }
    const { nodes, edges } = state.graph;
    const graph = new G6.Graph({
      container,
      width: container.clientWidth || 760,
      height: container.clientHeight || 520,
      autoFit: 'view',
      data: {
        nodes: nodes.map((node) => ({
          id: node.id,
          data: {
            label: node.label,
            type: node.type,
            layer: node.layer,
            description: node.data ? node.data.description : '',
          },
          style: { x: node.x, y: node.y },
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          data: { label: edge.label, type: edge.type },
        })),
      },
      node: {
        type: 'rect',
        style: (datum) => ({
          size: [140, 44],
          radius: 6,
          fill: colorForLayer(datum.data && datum.data.layer),
          stroke: '#555',
          labelText: `${(datum.data && datum.data.label) || datum.id}\n${(datum.data && datum.data.type) || ''}`,
          labelFill: '#111',
          labelFontSize: 11,
          labelLineHeight: 14,
          labelPlacement: 'center',
          cursor: 'move',
        }),
      },
      edge: {
        type: 'line',
        style: (datum) => ({
          stroke: '#999',
          lineWidth: 1,
          endArrow: true,
          labelText: (datum.data && datum.data.label) || '',
          labelFill: '#666',
          labelFontSize: 9,
        }),
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select'],
    });
    // 拖动结束 → 布局侧车落盘（防抖，见 scheduleLayoutSave）。
    graph.on('node:dragend', () => scheduleLayoutSave());
    graph.render();
    state.g6Graph = graph;
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
    if (!state.g6Graph || !state.graph || !state.selectedProjectId || !state.currentViewId) {
      return;
    }
    const elements = {};
    for (const node of state.graph.nodes) {
      let pos = null;
      try {
        pos = state.g6Graph.getElementPosition(node.id);
      } catch {
        pos = null;
      }
      if (Array.isArray(pos)) {
        elements[node.id] = { x: Math.round(pos[0]), y: Math.round(pos[1]) };
      } else if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        elements[node.id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
      }
    }
    try {
      await api(`/api/projects/${state.selectedProjectId}/views/${state.currentViewId}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements }),
      });
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
