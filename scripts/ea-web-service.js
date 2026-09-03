'use strict';

/**
 * ArchGraph 本地 Web 服务（EA 知识图谱导入/导出/查看/编辑）— MVP 实现
 *
 * 零第三方运行时依赖（仅 Node 内置 http/fs/path/crypto/readline/child_process）。
 * 可被测试 require（不 require 即启动监听）；默认绑定 127.0.0.1，端口可配。
 *
 * 写图红线：所有「编辑」操作（新增/修改/删除视图/元素/关系）统一通过 ARGO MCP
 * 写图接口完成（进程内 callTool，fallback 为 stdio 子进程 MCP 客户端），
 * 与 Agent 写图路径一致；禁止在编辑路径直接改写 SystemArchitecture.json。
 * 「导入」为整体替换操作（受控例外，见设计 AD-a）：属于文档级批量操作，
 * 校验（结构/引用完整，与 ARGO MCP 同 schema）→ 备份 → 原子写（temp+rename），
 * 写图原语与 ARGO MCP 内部一致；「编辑」类（元素/关系/视图级增删改）必须经 ARGO MCP。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createLayoutStore } = require('./ea-layout-store.js');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const GRAPH_MARKER = ['design', 'KG', 'SystemArchitecture.json'];
const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB（搜索/编辑等请求体）
const DEFAULT_UNDO_DEPTH = 50;
const MAX_DISCOVERY_DEPTH = 6;

const REPO_ROOT = path.resolve(__dirname, '..');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
});

/**
 * 前端编辑操作语义 ↔ ARGO MCP 写图接口 一一映射（设计文档 §3 映射表）。
 */
const EDIT_OP_TOOL_MAP = Object.freeze({
  addElement: 'addArchitectureElement',
  updateElement: 'updateArchitectureElement',
  removeElement: 'removeArchitectureElement',
  addView: 'addArchitectureView',
  updateView: 'updateArchitectureView',
  removeView: 'removeArchitectureView',
  updateRelationship: 'updateArchitectureRelationship',
  removeRelationship: 'removeArchitectureRelationship',
  applyMutation: 'applySystemArchitectureMutation',
});

const EDIT_OPS = Object.freeze(Object.keys(EDIT_OP_TOOL_MAP));

// ---------------------------------------------------------------------------
// 纯函数：项目发现 / 状态 / 校验 / 搜索 / 图数据
// ---------------------------------------------------------------------------

function defaultSearchRoots(explicitRoot) {
  if (explicitRoot) {
    return [path.resolve(explicitRoot)];
  }
  const roots = [REPO_ROOT, path.dirname(REPO_ROOT), path.dirname(path.dirname(REPO_ROOT))];
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function projectIdForGraphPath(graphPath) {
  return crypto.createHash('sha1').update(path.resolve(graphPath)).digest('hex').slice(0, 12);
}

function readGraphDocument(graphPath) {
  return JSON.parse(fs.readFileSync(graphPath, 'utf8'));
}

/**
 * 递归发现项目：以 design/KG/SystemArchitecture.json 为 marker。
 * 返回 [{ id, name, root, graphPath }]。
 */
function discoverProjects(searchRoots) {
  const seen = new Set();
  const projects = [];

  function addProject(projectRoot) {
    const graphPath = path.join(projectRoot, ...GRAPH_MARKER);
    if (seen.has(graphPath)) {
      return;
    }
    seen.add(graphPath);
    projects.push({
      id: projectIdForGraphPath(graphPath),
      name: path.basename(projectRoot),
      root: path.resolve(projectRoot),
      graphPath,
    });
  }

  function walk(dir, depth) {
    if (depth > MAX_DISCOVERY_DEPTH) {
      return;
    }
    if (fs.existsSync(path.join(dir, ...GRAPH_MARKER))) {
      addProject(dir);
      return; // 项目原子：不再下钻
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const name = entry.name;
      if (name === 'node_modules' || name === '.git' || name === 'vendor' || name === '.argo' || name.startsWith('.')) {
        continue;
      }
      walk(path.join(dir, name), depth + 1);
    }
  }

  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      walk(path.resolve(root), 0);
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

function computeStatus(project) {
  const base = {
    id: project.id,
    name: project.name,
    graphPath: project.graphPath,
    root: project.root,
  };
  let stat;
  try {
    stat = fs.statSync(project.graphPath);
  } catch (error) {
    return { ...base, valid: false, error: String(error.message), mtime: null, elements: 0, relationships: 0, views: 0 };
  }
  try {
    const doc = readGraphDocument(project.graphPath);
    const errors = validateGraphDocument(doc);
    return {
      ...base,
      valid: errors.length === 0,
      elements: Array.isArray(doc.elements) ? doc.elements.length : 0,
      relationships: Array.isArray(doc.relationships) ? doc.relationships.length : 0,
      views: Array.isArray(doc.views) ? doc.views.length : 0,
      mtime: stat.mtime.toISOString(),
      errors: errors.slice(0, 5),
    };
  } catch (error) {
    return {
      ...base,
      valid: false,
      error: String(error.message),
      elements: 0,
      relationships: 0,
      views: 0,
      mtime: stat.mtime.toISOString(),
    };
  }
}

/**
 * 结构校验（需求 FR-4 / AC-4 / AC-5）：
 * 根字段、id 唯一、parent/source_id/target_id/included_* 引用完整。
 * 返回可读错误数组（空数组 = 通过）。
 */
function validateGraphDocument(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['根节点必须是 JSON 对象'];
  }
  for (const key of ['name', 'description', 'elements', 'relationships', 'views']) {
    if (typeof doc[key] === 'undefined') {
      errors.push(`缺少根字段 '${key}'`);
    }
  }
  if (!Array.isArray(doc.elements)) {
    errors.push("'elements' 必须是数组");
  }
  if (!Array.isArray(doc.relationships)) {
    errors.push("'relationships' 必须是数组");
  }
  if (!Array.isArray(doc.views)) {
    errors.push("'views' 必须是数组");
  }
  if (errors.length > 0) {
    return errors;
  }

  const elementIds = new Set();
  for (const element of doc.elements) {
    if (!element || typeof element.id !== 'string' || element.id === '') {
      errors.push('存在缺少 id 的元素');
      continue;
    }
    if (elementIds.has(element.id)) {
      errors.push(`元素 id 重复：'${element.id}'`);
    }
    elementIds.add(element.id);
  }
  const relationshipIds = new Set();
  for (const relationship of doc.relationships) {
    if (!relationship || typeof relationship.id !== 'string' || relationship.id === '') {
      errors.push('存在缺少 id 的关系');
      continue;
    }
    if (relationshipIds.has(relationship.id)) {
      errors.push(`关系 id 重复：'${relationship.id}'`);
    }
    relationshipIds.add(relationship.id);
  }
  const viewIds = new Set();
  for (const view of doc.views) {
    if (!view || typeof view.view_id !== 'string' || view.view_id === '') {
      errors.push('存在缺少 view_id 的视图');
      continue;
    }
    if (viewIds.has(view.view_id)) {
      errors.push(`视图 view_id 重复：'${view.view_id}'`);
    }
    viewIds.add(view.view_id);
  }

  for (const element of doc.elements) {
    if (element.parent && !elementIds.has(element.parent)) {
      errors.push(`元素 '${element.id}' 的 parent '${element.parent}' 不存在`);
    }
  }
  for (const relationship of doc.relationships) {
    if (!elementIds.has(relationship.source_id)) {
      errors.push(`关系 '${relationship.id}' 的 source_id '${relationship.source_id}' 不存在`);
    }
    if (!elementIds.has(relationship.target_id)) {
      errors.push(`关系 '${relationship.id}' 的 target_id '${relationship.target_id}' 不存在`);
    }
  }
  for (const view of doc.views) {
    for (const id of view.included_elements || []) {
      if (!elementIds.has(id)) {
        errors.push(`视图 '${view.view_id}' 引用的元素 '${id}' 不存在`);
      }
    }
    for (const id of view.included_relationships || []) {
      if (!relationshipIds.has(id)) {
        errors.push(`视图 '${view.view_id}' 引用的关系 '${id}' 不存在`);
      }
    }
    if (view.parent_element_id && !elementIds.has(view.parent_element_id)) {
      errors.push(`视图 '${view.view_id}' 的 parent_element_id '${view.parent_element_id}' 不存在`);
    }
  }
  if (doc.attributes !== undefined && !Array.isArray(doc.attributes)) {
    errors.push("'attributes' 必须是数组");
  }
  return errors;
}

function layerOf(type) {
  const t = String(type || '');
  if (/^(Business|Stakeholder|Driver|Assessment|Goal|Outcome|Principle|Requirement|Constraint|Meaning|Value|Product|Contract|Representation)/.test(t)) {
    return 'Business';
  }
  if (/^(Application|Data Object)/.test(t)) {
    return 'Application';
  }
  if (/^(Technology|Node$|Device$|System Software|Artifact|Equipment|Facility|Distribution Network|Material|Path$|Communication Network)/.test(t)) {
    return 'Technology';
  }
  if (/^(Work Package|Deliverable|Implementation Event|Plateau|Gap$)/.test(t)) {
    return 'Implementation';
  }
  return 'Other';
}

/**
 * 视图图数据（供前端渲染）：nodes / edges，带简单圆形初始布局。
 */
function buildViewGraph(doc, viewId) {
  const view = doc.views.find((entry) => entry.view_id === viewId);
  if (!view) {
    return null;
  }
  const included = view.included_elements || [];
  const count = included.length;
  const nodes = included
    .map((id, index) => {
      const element = doc.elements.find((entry) => entry.id === id);
      if (!element) {
        return null;
      }
      const angle = (2 * Math.PI * index) / Math.max(count, 1);
      return {
        id: element.id,
        label: element.name,
        type: element.type,
        layer: layerOf(element.type),
        x: Math.round(80 + 160 * Math.cos(angle)),
        y: Math.round(80 + 160 * Math.sin(angle)),
        fx: null,
        fy: null,
        data: {
          description: element.description || '',
          parent: element.parent || null,
        },
      };
    })
    .filter(Boolean);

  const edges = (view.included_relationships || [])
    .map((id) => {
      const relationship = doc.relationships.find((entry) => entry.id === id);
      if (!relationship) {
        return null;
      }
      return {
        id: relationship.id,
        source: relationship.source_id,
        target: relationship.target_id,
        label: relationship.type,
        type: relationship.type,
      };
    })
    .filter(Boolean);

  return {
    view: { view_id: view.view_id, view_name: view.view_name },
    nodes,
    edges,
  };
}

function scoreText(field, query) {
  if (typeof field !== 'string') {
    return 0;
  }
  const lower = field.toLowerCase();
  if (lower === query) {
    return 100;
  }
  if (lower.startsWith(query)) {
    return 50;
  }
  if (lower.includes(query)) {
    return 20;
  }
  return 0;
}

/**
 * local 子串检索（始终可用）。返回 { mode: 'local', hits: [...] }。
 */
function searchLocal(doc, rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) {
    return { mode: 'local', query: rawQuery || '', hits: [] };
  }
  const hits = [];
  for (const element of doc.elements || []) {
    const score = Math.max(
      scoreText(element.name, query),
      scoreText(element.id, query),
      scoreText(element.type, query) / 2,
      scoreText(element.description, query) / 2,
    );
    if (score > 0) {
      hits.push({ kind: 'element', id: element.id, name: element.name, type: element.type, description: element.description || '', score });
    }
  }
  for (const relationship of doc.relationships || []) {
    const score = Math.max(
      scoreText(relationship.name, query),
      scoreText(relationship.type, query) / 2,
      scoreText(relationship.statement, query) / 2,
    );
    if (score > 0) {
      hits.push({ kind: 'relationship', id: relationship.id, name: relationship.name, type: relationship.type, statement: relationship.statement || '', score });
    }
  }
  for (const view of doc.views || []) {
    const score = Math.max(scoreText(view.view_name, query), scoreText(view.view_id, query));
    if (score > 0) {
      hits.push({ kind: 'view', id: view.view_id, name: view.view_name, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return { mode: 'local', query: rawQuery || '', hits: hits.slice(0, 50) };
}

// ---------------------------------------------------------------------------
// 编辑 op → MCP 参数与逆操作（Command 模式，AD-h）
// ---------------------------------------------------------------------------

function findById(entries, id) {
  return (entries || []).find((entry) => entry.id === id);
}

function buildEditArgs(op, payload) {
  const p = payload || {};
  switch (op) {
    case 'addElement':
      return { element: p.element, view_ids: p.view_ids };
    case 'updateElement':
      return { id: p.id, patch: p.patch };
    case 'removeElement':
      return p.view_ids ? { id: p.id, view_ids: p.view_ids } : { id: p.id };
    case 'addView':
      return { view: p.view };
    case 'updateView':
      return { view_id: p.view_id, patch: p.patch };
    case 'removeView':
      return { view_id: p.view_id };
    case 'updateRelationship':
      return { id: p.id, patch: p.patch };
    case 'removeRelationship':
      return p.view_ids ? { id: p.id, view_ids: p.view_ids } : { id: p.id };
    case 'applyMutation':
      return { mutations: p.mutations };
    default:
      throw new Error(`Unsupported edit op: ${op}`);
  }
}

function viewsContainingElement(doc, elementId) {
  return (doc.views || [])
    .filter((view) => (view.included_elements || []).includes(elementId))
    .map((view) => view.view_id);
}

function viewsContainingRelationship(doc, relationshipId) {
  return (doc.views || [])
    .filter((view) => (view.included_relationships || []).includes(relationshipId))
    .map((view) => view.view_id);
}

function oldFieldsForPatch(entry, patch) {
  const oldFields = {};
  for (const key of Object.keys(patch || {})) {
    if (key === 'id' || key === 'type' || key === 'view_id') {
      continue; // 不可变字段
    }
    oldFields[key] = entry ? entry[key] : undefined;
  }
  return oldFields;
}

/**
 * 依据编辑前文档推导逆操作（ARGO MCP 逆调用），供撤销使用。
 */
function deriveInverseCommand(op, args, beforeDoc) {
  switch (op) {
    case 'addElement':
      return { tool: 'removeArchitectureElement', args: { id: args.element.id } };
    case 'addView':
      return { tool: 'removeArchitectureView', args: { view_id: args.view.view_id } };
    case 'removeElement': {
      const element = findById(beforeDoc.elements, args.id);
      const viewIds = viewsContainingElement(beforeDoc, args.id);
      return {
        tool: 'addArchitectureElement',
        args: { element, view_ids: viewIds.length > 0 ? viewIds : undefined },
      };
    }
    case 'removeView': {
      const view = beforeDoc.views.find((entry) => entry.view_id === args.view_id);
      return { tool: 'addArchitectureView', args: { view } };
    }
    case 'removeRelationship': {
      const relationship = findById(beforeDoc.relationships, args.id);
      const viewIds = viewsContainingRelationship(beforeDoc, args.id);
      return {
        tool: 'addArchitectureRelationship',
        args: { relationship, view_ids: viewIds.length > 0 ? viewIds : undefined },
      };
    }
    case 'updateElement': {
      const element = findById(beforeDoc.elements, args.id);
      return { tool: 'updateArchitectureElement', args: { id: args.id, patch: oldFieldsForPatch(element, args.patch) } };
    }
    case 'updateView': {
      const view = beforeDoc.views.find((entry) => entry.view_id === args.view_id);
      return { tool: 'updateArchitectureView', args: { view_id: args.view_id, patch: oldFieldsForPatch(view, args.patch) } };
    }
    case 'updateRelationship': {
      const relationship = findById(beforeDoc.relationships, args.id);
      return { tool: 'updateArchitectureRelationship', args: { id: args.id, patch: oldFieldsForPatch(relationship, args.patch) } };
    }
    case 'applyMutation':
      // 批量/复合变更：MVP 记录为快照回退（见 createService 的 applyMutation 处理）。
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// ARGO MCP 适配层（唯一写图入口；读检索亦复用）
// ---------------------------------------------------------------------------

function normalizeMcpResult(result) {
  let payload = result;
  let rawText = '';
  if (result && Array.isArray(result.content)) {
    rawText = result.content.map((entry) => (entry && entry.text) || '').join('\n');
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { raw: rawText };
    }
  }
  const failed = (result && result.isError === true) || (payload && payload.status === 'failed');
  return {
    ok: !failed,
    payload,
    rawText,
    error: payload && payload.error ? payload.error : failed ? { message: 'ARGO MCP tool failed' } : null,
    raw: result,
  };
}

function createMcpAdapter(options = {}) {
  const mode = options.mode || 'in-process';
  let argoMcp = null;
  let loadError = null;
  if (mode === 'in-process') {
    try {
      // eslint-disable-next-line global-require
      argoMcp = require('../argo/scripts/argo-mcp-server.js');
    } catch (error) {
      loadError = error;
    }
  }

  async function callStdio(toolName, args, projectRoot) {
    const script = path.join(REPO_ROOT, 'argo', 'scripts', 'argo-mcp-server.js');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: projectRoot || process.cwd(),
        env: { ...process.env, ...(projectRoot ? { ARGO_REPO_ROOT: projectRoot } : {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const rl = readline.createInterface({ input: child.stdout });
      let seq = 0;
      const pending = new Map();
      rl.on('line', (line) => {
        if (!line.trim()) {
          return;
        }
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const handler = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(msg.error.message || 'MCP error'));
          } else {
            handler.resolve(msg.result);
          }
        }
      });
      child.stderr.on('data', () => {});
      child.on('error', reject);
      function send(method, params) {
        const id = ++seq;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
      }
      (async () => {
        try {
          await send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ea-web-service', version: '1.0.0' },
          });
          const list = await send('tools/list', {});
          const tool = (list.tools || []).find((entry) => entry.name === toolName);
          if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
          }
          const result = await send('tools/call', { name: toolName, arguments: args || {} });
          resolve(normalizeMcpResult(result));
        } catch (error) {
          reject(error);
        } finally {
          child.stdin.end();
        }
      })();
    });
  }

  async function callTool(toolName, args, projectRoot) {
    if (mode === 'stdio') {
      return callStdio(toolName, args, projectRoot);
    }
    if (!argoMcp) {
      throw new Error(`ARGO MCP in-process backend unavailable: ${loadError ? loadError.message : 'not loaded'}`);
    }
    const previous = process.env.ARGO_REPO_ROOT;
    if (projectRoot) {
      process.env.ARGO_REPO_ROOT = projectRoot;
    }
    try {
      const result = await argoMcp.callTool(toolName, args || {}, null, undefined);
      return normalizeMcpResult(result);
    } finally {
      if (previous === undefined) {
        delete process.env.ARGO_REPO_ROOT;
      } else {
        process.env.ARGO_REPO_ROOT = previous;
      }
    }
  }

  return {
    mode,
    available: mode === 'stdio' ? true : !!argoMcp,
    callTool,
  };
}

// ---------------------------------------------------------------------------
// 搜索（local 恒可用；semantic/context 复用 ARGO MCP，不可用则明确降级）
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, fallbackError) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 把 ARGO MCP 语义/上下文检索结果（document/result 形态）归一化为前端可渲染的 hits。
function hitsFromPayload(payload) {
  const source = (payload && payload.document) || (payload && payload.result) || {};
  const elements = Array.isArray(source.elements) ? source.elements : [];
  const relationships = Array.isArray(source.relationships) ? source.relationships : [];
  const views = Array.isArray(source.views) ? source.views : [];
  const hits = [
    ...elements.map((e) => ({ kind: 'element', id: e.id, name: e.name, type: e.type })),
    ...relationships.map((r) => ({ kind: 'relationship', id: r.id, name: r.name || r.type, type: r.type })),
    ...views.map((v) => ({ kind: 'view', id: v.view_id || v.id, name: v.view_name || v.name || v.view_id || v.id, type: 'View' })),
  ];
  return hits.slice(0, 50);
}

async function searchSemantic(adapter, project, query) {
  // 首次语义检索需初始化语义旅程/嵌入生命周期，可能耗时数秒；给足超时，后续调用会更快。
  const timeoutMs = 15000;
  const args = {
    architecturePath: GRAPH_MARKER.join('/'),
    query: { purpose: 'general', intent: query },
  };
  const attempt = adapter.callTool('getSystemArchitecture', args, project.root);
  const result = await withTimeout(attempt, timeoutMs, { timedOut: true });
  if (result && result.timedOut) {
    return {
      mode: 'semantic',
      supported: false,
      message: '语义检索超时，已回退本地检索',
      fallback: searchLocal(readGraphDocument(project.graphPath), query),
    };
  }
  if (!result.ok) {
    return {
      mode: 'semantic',
      supported: false,
      message: '语义检索失败，已回退本地检索',
      detail: (result.error && result.error.message) || 'getSystemArchitecture failed',
      fallback: searchLocal(readGraphDocument(project.graphPath), query),
    };
  }
  return { mode: 'semantic', supported: true, hits: hitsFromPayload(result.payload) };
}

async function searchContext(adapter, project, query, elementId) {
  const doc = readGraphDocument(project.graphPath);
  const local = searchLocal(doc, elementId || query);
  const elementHit = local.hits.find((hit) => hit.kind === 'element');
  if (!elementHit) {
    return {
      mode: 'context',
      supported: false,
      message: elementId ? `未找到元素 '${elementId}'` : '未找到可做上下文检索的元素（TODO）',
      hits: local.hits,
    };
  }
  const args = { elementId: elementHit.id };
  const result = await adapter.callTool('getIntentElementContext', args, project.root);
  if (!result.ok) {
    return {
      mode: 'context',
      supported: false,
      message: '上下文检索失败，已回退本地检索',
      detail: (result.error && result.error.message) || 'getIntentElementContext failed',
      hits: local.hits,
    };
  }
  return { mode: 'context', supported: true, elementId: elementHit.id, hits: hitsFromPayload(result.payload) };
}

async function searchProject(adapter, project, body) {
  const { query, mode, elementId } = body || {};
  const q = String(query || '').trim();
  if (!q && !elementId) {
    return { mode: mode || 'local', hits: [] };
  }
  if (mode === 'semantic') {
    return searchSemantic(adapter, project, q);
  }
  if (mode === 'context') {
    return searchContext(adapter, project, q, elementId);
  }
  const doc = readGraphDocument(project.graphPath);
  return searchLocal(doc, q);
}

// ---------------------------------------------------------------------------
// 文件写入工具（备份 + 原子写）
// ---------------------------------------------------------------------------

function backupGraph(project, keep = 10) {
  const backupDir = path.join(project.root, '.argo', 'backups', project.name || project.id);
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(project.graphPath, path.join(backupDir, `${stamp}.json`));
  const files = fs.readdirSync(backupDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  while (files.length > keep) {
    const oldest = files.shift();
    try {
      fs.unlinkSync(path.join(backupDir, oldest));
    } catch {
      /* ignore */
    }
  }
}

function atomicWriteFile(filePath, text) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, filePath);
}

// 跨进程文件锁（AD-i）：锁文件 + 原子创建（'wx'）；占用时短暂重试后拒绝（409）。
const LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  Atomics.wait(LOCK_SLEEP, 0, 0, ms);
}

function acquireFileLock(graphPath, { timeoutMs = 3000, retryMs = 40 } = {}) {
  const lockPath = `${graphPath}.lock`;
  const start = Date.now();
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeSync(fd, String(process.pid));
      } catch {
        /* ignore */
      }
      return () => {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() - start > timeoutMs) {
        throw new HttpError(409, '图谱正被其他进程写入，请稍后重试');
      }
      sleepSync(retryMs);
    }
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createService(options = {}) {
  const host = options.host || process.env.EA_WEB_HOST || DEFAULT_HOST;
  const port = options.port !== undefined ? options.port
    : process.env.EA_WEB_PORT ? Number(process.env.EA_WEB_PORT) : DEFAULT_PORT;
  const searchRoots = options.searchRoots || defaultSearchRoots(options.root);
  const staticDir = options.staticDir || path.join(REPO_ROOT, 'web');
  const undoDepth = options.undoDepth || DEFAULT_UNDO_DEPTH;
  const mcpAdapter = options.mcpAdapter || createMcpAdapter(options.mcp || {});
  // 布局侧车（M1-S2，2026-09-03 修订：默认按项目隔离）：坐标独立持久化，与图谱 JSON 物理隔离。
  // 默认落在各项目自己的 <projectRoot>/design/KG/ea-layouts/<view_id>.json；
  // layoutRoot 选项 / EA_LAYOUT_ROOT 环境变量可显式覆盖为集中存储根。
  const layoutStore = options.layoutStore || createLayoutStore({ layoutRoot: options.layoutRoot });

  const state = {
    projects: new Map(),
    undoStacks: new Map(),
    redoStacks: new Map(),
    writeQueues: new Map(),
  };

  function refreshProjects() {
    const projects = discoverProjects(searchRoots);
    state.projects = new Map(projects.map((project) => [project.id, project]));
    return projects;
  }

  function getProject(id) {
    const project = state.projects.get(id);
    if (!project) {
      throw new HttpError(404, `project not found: ${id}`);
    }
    return project;
  }

  function withProjectWriteLock(projectId, fn) {
    const previous = state.writeQueues.get(projectId) || Promise.resolve();
    const next = previous.then(fn, fn);
    state.writeQueues.set(projectId, next.catch(() => {}));
    return next;
  }

  function pushUndo(projectId, command) {
    let stack = state.undoStacks.get(projectId);
    if (!stack) {
      stack = [];
      state.undoStacks.set(projectId, stack);
    }
    stack.push(command);
    while (stack.length > undoDepth) {
      stack.shift();
    }
  }

  function popUndo(projectId) {
    const stack = state.undoStacks.get(projectId);
    return stack && stack.length ? stack.pop() : null;
  }

  function pushRedo(projectId, command) {
    let stack = state.redoStacks.get(projectId);
    if (!stack) {
      stack = [];
      state.redoStacks.set(projectId, stack);
    }
    stack.push(command);
  }

  function popRedo(projectId) {
    const stack = state.redoStacks.get(projectId);
    return stack && stack.length ? stack.pop() : null;
  }

  async function editProject(projectId, op, payload) {
    const project = getProject(projectId);
    const toolName = EDIT_OP_TOOL_MAP[op];
    if (!toolName) {
      throw new HttpError(400, `unsupported op: ${op} (可用: ${EDIT_OPS.join(', ')})`);
    }
    const args = buildEditArgs(op, payload);
    return withProjectWriteLock(projectId, async () => {
      const release = acquireFileLock(project.graphPath);
      try {
        const beforeDoc = readGraphDocument(project.graphPath);
        backupGraph(project);
        const result = await mcpAdapter.callTool(toolName, args, project.root);
        if (!result.ok) {
          throw new HttpError(400, `编辑失败：${JSON.stringify(result.error || result.payload)}`);
        }
        let command;
        if (op === 'applyMutation') {
          const afterDoc = readGraphDocument(project.graphPath);
          command = { op, kind: 'snapshot', before: beforeDoc, after: afterDoc };
        } else {
          command = {
            op,
            tool: toolName,
            args,
            inverse: deriveInverseCommand(op, args, beforeDoc),
          };
        }
        pushUndo(projectId, command);
        state.redoStacks.delete(projectId);
        return { ok: true, op, tool: toolName, result: result.payload };
      } finally {
        release();
      }
    });
  }

  async function undoProject(projectId) {
    const project = getProject(projectId);
    const command = popUndo(projectId);
    if (!command || (!command.inverse && command.kind !== 'snapshot')) {
      throw new HttpError(400, '无可撤销的操作');
    }
    return withProjectWriteLock(projectId, async () => {
      const release = acquireFileLock(project.graphPath);
      try {
        if (command.kind === 'snapshot') {
          atomicWriteFile(project.graphPath, JSON.stringify(command.before, null, 2));
          pushRedo(projectId, command);
          return { ok: true, undone: command.op };
        }
        const result = await mcpAdapter.callTool(command.inverse.tool, command.inverse.args, project.root);
        if (!result.ok) {
          pushUndo(projectId, command);
          throw new HttpError(400, `撤销失败：${JSON.stringify(result.error || result.payload)}`);
        }
        pushRedo(projectId, command);
        return { ok: true, undone: command.op, result: result.payload };
      } finally {
        release();
      }
    });
  }

  async function redoProject(projectId) {
    const project = getProject(projectId);
    const command = popRedo(projectId);
    if (!command) {
      throw new HttpError(400, '无可重做的操作');
    }
    return withProjectWriteLock(projectId, async () => {
      const release = acquireFileLock(project.graphPath);
      try {
        if (command.kind === 'snapshot') {
          atomicWriteFile(project.graphPath, JSON.stringify(command.after, null, 2));
          pushUndo(projectId, command);
          return { ok: true, redone: command.op };
        }
        const result = await mcpAdapter.callTool(command.tool, command.args, project.root);
        if (!result.ok) {
          pushRedo(projectId, command);
          throw new HttpError(400, `重做失败：${JSON.stringify(result.error || result.payload)}`);
        }
        pushUndo(projectId, command);
        return { ok: true, redone: command.op, result: result.payload };
      } finally {
        release();
      }
    });
  }

  async function importProject(projectId, text) {
    const project = getProject(projectId);
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
      throw new HttpError(413, `文件过大：超过 ${MAX_IMPORT_BYTES / 1024 / 1024} MB 上限`);
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (error) {
      throw new HttpError(400, `JSON 解析失败：${error.message}`);
    }
    const errors = validateGraphDocument(doc);
    if (errors.length > 0) {
      throw new HttpError(400, `校验失败：${errors.join('; ')}`);
    }
    return withProjectWriteLock(projectId, async () => {
      const release = acquireFileLock(project.graphPath);
      try {
        backupGraph(project);
        atomicWriteFile(project.graphPath, text);
        state.undoStacks.delete(projectId);
        state.redoStacks.delete(projectId);
        return { ok: true, elements: doc.elements.length, relationships: doc.relationships.length, views: doc.views.length };
      } finally {
        release();
      }
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(res, 400, { error: '非法的 URL 编码' });
    }
    try {
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return serveStatic(res, path.join(staticDir, 'index.html'), staticDir);
      }
      if (req.method === 'GET' && (pathname === '/app.js' || pathname === '/style.css')) {
        return serveStatic(res, path.join(staticDir, pathname.slice(1)), staticDir);
      }
      // 本地 vendor 静态资源（如 AntV G6 v5：/vendor/g6.min.js）；路径穿越由 serveStatic 防护。
      if (req.method === 'GET' && pathname.startsWith('/vendor/')) {
        return serveStatic(res, path.join(staticDir, pathname.slice(1)), staticDir);
      }

      if (req.method === 'GET' && pathname === '/api/projects') {
        refreshProjects();
        const projects = [...state.projects.values()].map(computeStatus);
        return sendJson(res, 200, { projects });
      }

      const m = pathname.match(/^\/api\/projects\/([A-Za-z0-9]+)(\/.*)?$/);
      if (m) {
        const projectId = m[1];
        const rest = m[2] || '';
        // await 使异步路由内抛出的 HttpError 能被上方 catch 捕获并转为 JSON 错误响应，
        // 而非未处理的 Promise 拒绝（进程崩溃）。
        return await handleProjectRoute(req, res, projectId, rest, url);
      }

      return sendJson(res, 404, { error: `not found: ${pathname}` });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) {
        console.error('[ea-web-service]', error);
      }
      return sendJson(res, status, { error: error.message || String(error) });
    }
  }

  async function handleProjectRoute(req, res, projectId, rest) {
    if (rest === '' || rest === '/') {
      return sendJson(res, 200, { project: computeStatus(getProject(projectId)) });
    }
    if (req.method === 'POST' && rest === '/select') {
      return sendJson(res, 200, { project: computeStatus(getProject(projectId)) });
    }
    const contextMatch = rest.match(/^\/context\/([A-Za-z0-9._-]+)$/);
    if (req.method === 'GET' && contextMatch) {
      const project = getProject(projectId);
      const result = await mcpAdapter.callTool('getIntentElementContext', { elementId: contextMatch[1] }, project.root);
      if (result.ok) {
        return sendJson(res, 200, { elementId: contextMatch[1], context: result.payload });
      }
      return sendJson(res, 502, { error: (result.error && result.error.message) || 'getIntentElementContext failed' });
    }
    if (req.method === 'GET' && rest === '/status') {
      return sendJson(res, 200, computeStatus(getProject(projectId)));
    }
    if (req.method === 'GET' && rest === '/views') {
      const project = getProject(projectId);
      const doc = readGraphDocument(project.graphPath);
      const views = (doc.views || []).map((view) => ({
        view_id: view.view_id,
        view_name: view.view_name,
        parent_element_id: view.parent_element_id || null,
        element_count: (view.included_elements || []).length,
        relationship_count: (view.included_relationships || []).length,
      }));
      return sendJson(res, 200, { project: project.id, views });
    }
    const viewMatch = rest.match(/^\/views\/([A-Za-z0-9._-]+)\/graph$/);
    if (req.method === 'GET' && viewMatch) {
      const project = getProject(projectId);
      const doc = readGraphDocument(project.graphPath);
      const graph = buildViewGraph(doc, viewMatch[1]);
      if (!graph) {
        throw new HttpError(404, `view not found: ${viewMatch[1]}`);
      }
      return sendJson(res, 200, { project: { id: project.id, name: project.name }, ...graph });
    }
    // 布局侧车（M1-S2，加法端点）：GET 返回按当前成员合并后的坐标全集，
    // PUT 按当前文档计算成员身份签名后原子写入侧车；坐标永不进入图谱 JSON。
    const layoutMatch = rest.match(/^\/views\/([A-Za-z0-9._-]+)\/layout$/);
    if (layoutMatch) {
      const project = getProject(projectId);
      const doc = readGraphDocument(project.graphPath);
      const view = (doc.views || []).find((entry) => entry.view_id === layoutMatch[1]);
      if (!view) {
        throw new HttpError(404, `view not found: ${layoutMatch[1]}`);
      }
      if (req.method === 'GET') {
        const layout = layoutStore.mergeLayout({ project, view });
        return sendJson(res, 200, { project: project.id, view_id: view.view_id, ...layout });
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req, MAX_BODY_BYTES);
        try {
          const result = layoutStore.putLayout({
            project,
            view,
            elements: body && body.elements,
          });
          return sendJson(res, 200, { ok: true, project: project.id, ...result });
        } catch (error) {
          throw new HttpError(400, error.message);
        }
      }
      throw new HttpError(405, `method not allowed: ${req.method}`);
    }
    if (req.method === 'GET' && rest === '/export') {
      const project = getProject(projectId);
      const text = fs.readFileSync(project.graphPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${project.name || 'SystemArchitecture'}.json"`,
      });
      return res.end(text);
    }
    if (req.method === 'POST' && rest === '/import') {
      const text = await readBody(req, MAX_IMPORT_BYTES);
      return sendJson(res, 200, await importProject(projectId, text));
    }
    if (req.method === 'POST' && rest === '/search') {
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const project = getProject(projectId);
      return sendJson(res, 200, await searchProject(mcpAdapter, project, body));
    }
    if (req.method === 'POST' && rest === '/edit') {
      const body = await readJsonBody(req, MAX_BODY_BYTES);
      const { op, payload } = body || {};
      return sendJson(res, 200, await editProject(projectId, op, payload));
    }
    if (req.method === 'POST' && rest === '/undo') {
      return sendJson(res, 200, await undoProject(projectId));
    }
    if (req.method === 'POST' && rest === '/redo') {
      return sendJson(res, 200, await redoProject(projectId));
    }
    throw new HttpError(404, `not found: ${rest}`);
  }

  let refreshTimer = null;
  const watchers = [];
  const refreshIntervalMs = options.refreshIntervalMs !== undefined ? options.refreshIntervalMs : 5000;

  function debounce(fn, ms) {
    let timer = null;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  const debouncedRefresh = debounce(() => { try { refreshProjects(); } catch { /* ignore */ } }, 1000);

  function startRefreshing() {
    refreshProjects();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { try { refreshProjects(); } catch { /* ignore */ } }, refreshIntervalMs);
    for (const root of searchRoots) {
      try {
        watchers.push(fs.watch(root, { recursive: true }, debouncedRefresh));
      } catch {
        /* watch 不支持则靠轮询兜底 */
      }
    }
  }

  function stopRefreshing() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    watchers.length = 0;
  }

  const server = http.createServer(handle);

  function start() {
    startRefreshing();
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        resolve({ host, port: address && address.port ? address.port : port });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      stopRefreshing();
      server.close(() => resolve());
      // 主动关闭挂起的连接（含未消费响应体的 keep-alive 连接），保证 stop 必然完成。
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
  }

  return {
    server,
    start,
    stop,
    refreshProjects,
    handle,
    editProject,
    undoProject,
    redoProject,
    importProject,
    mcpAdapter,
    layoutStore,
    state,
  };
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text, 'utf8'),
  });
  res.end(text);
}

function serveStatic(res, filePath, baseDir) {
  const safe = path.resolve(filePath);
  const base = path.resolve(baseDir || path.dirname(filePath));
  if (safe !== base && !safe.startsWith(base + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  if (!fs.existsSync(safe)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  const ext = path.extname(safe).toLowerCase();
  const text = fs.readFileSync(safe);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(text);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, `请求体过大（上限 ${limit} 字节）`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit) {
  const text = await readBody(req, limit);
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, `JSON 解析失败：${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : undefined;
  const portIndex = argv.indexOf('--port');
  const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : undefined;
  const service = createService({ root, port });
  service.start().then(({ host, port: actualPort }) => {
    console.log(`ArchGraph 本地 Web 服务已启动：http://${host}:${actualPort}`);
  }).catch((error) => {
    console.error('启动失败：', error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  GRAPH_MARKER,
  MAX_IMPORT_BYTES,
  EDIT_OP_TOOL_MAP,
  EDIT_OPS,
  REPO_ROOT,
  HttpError,
  defaultSearchRoots,
  discoverProjects,
  computeStatus,
  validateGraphDocument,
  buildViewGraph,
  searchLocal,
  searchSemantic,
  searchContext,
  hitsFromPayload,
  buildEditArgs,
  deriveInverseCommand,
  createMcpAdapter,
  normalizeMcpResult,
  acquireFileLock,
  createService,
  readGraphDocument,
  layerOf,
};

if (require.main === module) {
  main();
}
