'use strict';

// ArchGraph 本地知识图谱工具 — 前端逻辑（零依赖，基础 SVG 渲染 + 拖动）。
// TODO(后续切片)：图形内核接入 AntV G6 v5（web/vendor/g6.min.js 本地 vendor），
// 使用其内置 force/dagre 布局、原生拖动/选择/命中/固定节点，替换下方基础 SVG 渲染。

(function () {
  const state = {
    projects: [],
    selectedProjectId: null,
    views: [],
    currentViewId: null,
    graph: null,
    dragNodeId: null,
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
    state.graph = data;
    $('graph-title').textContent = `视图：${viewName}`;
    renderGraph();
  }

  function renderGraph() {
    const svg = $('graph-svg');
    svg.innerHTML = '';
    if (!state.graph) {
      return;
    }
    const { nodes, edges } = state.graph;
    for (const edge of edges) {
      const source = nodes.find((n) => n.id === edge.source);
      const target = nodes.find((n) => n.id === edge.target);
      if (!source || !target) {
        continue;
      }
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', source.x + 60);
      line.setAttribute('y1', source.y + 20);
      line.setAttribute('x2', target.x + 60);
      line.setAttribute('y2', target.y + 20);
      line.setAttribute('stroke', '#999');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    }
    for (const node of nodes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      group.dataset.id = node.id;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '120');
      rect.setAttribute('height', '40');
      rect.setAttribute('rx', '6');
      rect.setAttribute('fill', colorForLayer(node.layer));
      rect.setAttribute('stroke', '#555');
      group.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '8');
      text.setAttribute('y', '18');
      text.setAttribute('fill', '#111');
      text.setAttribute('font-size', '12');
      text.textContent = (node.label || node.id).slice(0, 16);
      group.appendChild(text);

      const type = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      type.setAttribute('x', '8');
      type.setAttribute('y', '33');
      type.setAttribute('fill', '#333');
      type.setAttribute('font-size', '9');
      type.textContent = (node.type || '').slice(0, 20);
      group.appendChild(type);

      group.style.cursor = 'move';
      group.addEventListener('mousedown', (event) => {
        state.dragNodeId = node.id;
        event.preventDefault();
      });
      svg.appendChild(group);
    }
    svg.addEventListener('mousemove', onSvgMouseMove);
    svg.addEventListener('mouseup', onSvgMouseUp);
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

  function onSvgMouseMove(event) {
    if (!state.dragNodeId || !state.graph) {
      return;
    }
    const svg = $('graph-svg');
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - 60;
    const y = event.clientY - rect.top - 20;
    const node = state.graph.nodes.find((n) => n.id === state.dragNodeId);
    if (node) {
      node.x = Math.max(0, Math.min(700, x));
      node.y = Math.max(0, Math.min(500, y));
      node.fx = node.x;
      node.fy = node.y;
      renderGraph();
    }
  }

  function onSvgMouseUp() {
    state.dragNodeId = null;
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
