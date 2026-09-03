'use strict';

/**
 * 布局侧车（Layout Sidecar，WP2785 M1-S2，2026-09-03 修订：默认按项目隔离，AT-2785-L5）
 * — 图谱画布坐标独立持久化。
 *
 * 零第三方依赖（仅 Node 内置 path/fs/crypto）。与 design/KG/SystemArchitecture.json
 * 完全物理隔离：坐标不进图谱 JSON、不进 schema；本模块永远不读写图谱文件本身。
 *
 * 存储根（按优先级）：
 * 1. 显式覆盖：createLayoutStore({ layoutRoot }) 选项或 EA_LAYOUT_ROOT 环境变量
 *    → <layoutRoot>/<projectId>/<view_id>.json（测试 / 自定义集中存储根）。
 * 2. 默认（无任何覆盖）：按项目隔离
 *    → <projectRoot>/design/KG/ea-layouts/<view_id>.json（仍是独立文件，
 *      只落在 ea-layouts/ 子目录，绝不触碰 SystemArchitecture.json 本身）。
 *
 * 文件内容：{ version, graphKey, view_id, signature, updatedAt, elements: { <elementId>: {x,y} } }
 *
 * 失效键 = 视图成员身份签名（成员身份集合的 sha256，只含身份 id，不含任何内容字段）：
 * signature = sha256(sorted(included_elements) + sorted(included_relationships))。
 * 图谱内容级修改（元素 name/description/attributes、关系描述等）不改变成员集合
 * → signature 不变 → 坐标完全不动；仅成员结构变化触发新成员补位/移除成员清理。
 *
 * 合并语义（读取时）：以当前图谱视图成员为准——仍有坐标的现存成员原样保留；
 * 新成员（无坐标）按确定性算法补位（沿用 buildViewGraph 的圆形布局公式）并写回侧车；
 * 已不在成员中的坐标清理。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const LAYOUT_VERSION = 1;
// 默认按项目隔离时，侧车相对项目根的存放目录。
const PROJECT_LAYOUT_DIR = path.join('design', 'KG', 'ea-layouts');

/**
 * 解析显式存储根覆盖：选项 > EA_LAYOUT_ROOT 环境变量。
 * 返回 null 表示无覆盖 → 使用默认的按项目隔离存储。
 */
function resolveLayoutRoot(explicitRoot) {
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  if (process.env.EA_LAYOUT_ROOT) {
    return path.resolve(process.env.EA_LAYOUT_ROOT);
  }
  return null;
}

/**
 * 视图成员身份签名：仅由 included_elements / included_relationships 的身份 id 集合决定，
 * 与元素/关系的任何内容字段无关。
 */
function computeViewSignature(view) {
  const elements = Array.from(new Set((view && view.included_elements) || [])).sort();
  const relationships = Array.from(new Set((view && view.included_relationships) || [])).sort();
  const payload = `${elements.join('\u0001')}\u0000${relationships.join('\u0001')}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// 文件名安全化（服务端路由已限制 [A-Za-z0-9._-]，此处为独立模块的防御性兜底）。
function safeFileName(segment) {
  return String(segment).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * 确定性补位：沿用 buildViewGraph 的圆形布局公式（成员索引 → 圆周位置）。
 */
function defaultPosition(index, count) {
  const angle = (2 * Math.PI * index) / Math.max(count, 1);
  return {
    x: Math.round(80 + 160 * Math.cos(angle)),
    y: Math.round(80 + 160 * Math.sin(angle)),
  };
}

function isValidPosition(pos) {
  return !!pos
    && typeof pos === 'object'
    && !Array.isArray(pos)
    && Number.isFinite(Number(pos.x))
    && Number.isFinite(Number(pos.y));
}

function createLayoutStore(options = {}) {
  // null → 默认按项目隔离存储；否则为显式集中存储根。
  const explicitRoot = resolveLayoutRoot(options.layoutRoot);

  /**
   * 目标解析：target = { project?: {id, root, graphPath}, projectId?, graphKey? }。
   * 显式根模式用 projectId 分桶；默认模式用 project.root 定位项目内 ea-layouts/ 目录。
   */
  function resolveTarget(target, viewId) {
    const t = target || {};
    const project = t.project || {};
    const projectId = t.projectId || project.id || null;
    const graphKey = t.graphKey || project.graphPath || null;
    if (explicitRoot) {
      if (!projectId) {
        throw new Error('layout store: 显式存储根模式下必须提供 projectId（或 project.id）');
      }
      return {
        projectId,
        graphKey,
        filePath: path.join(explicitRoot, safeFileName(projectId), `${safeFileName(viewId)}.json`),
      };
    }
    const projectRoot = project.root;
    if (!projectRoot) {
      throw new Error('layout store: 默认按项目隔离存储必须提供 project.root');
    }
    return {
      projectId,
      graphKey,
      filePath: path.join(path.resolve(projectRoot), PROJECT_LAYOUT_DIR, `${safeFileName(viewId)}.json`),
    };
  }

  function filePathFor(target, viewId) {
    return resolveTarget(target, viewId).filePath;
  }

  function readRecord(target, viewId) {
    let text;
    try {
      text = fs.readFileSync(filePathFor(target, viewId), 'utf8');
    } catch {
      return null;
    }
    try {
      const record = JSON.parse(text);
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return null;
      }
      if (!record.elements || typeof record.elements !== 'object' || Array.isArray(record.elements)) {
        record.elements = {};
      }
      return record;
    } catch {
      return null;
    }
  }

  function writeRecord(target, viewId, record) {
    const filePath = filePathFor(target, viewId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
    return filePath;
  }

  /**
   * 读取合并后的布局（以当前图谱视图成员为准）。
   * 有补位/清理/签名变化时写回侧车；纯内容级修改（签名不变）不触发写入。
   * 入参：{ project?: {id, root, graphPath}, projectId?, graphKey?, view }。
   * 返回 { signature, elements: { <elementId>: {x,y} } }。
   */
  function mergeLayout({ project, projectId, graphKey, view }) {
    if (!view || typeof view.view_id !== 'string') {
      throw new Error('mergeLayout: view with view_id is required');
    }
    const target = { project, projectId, graphKey };
    const viewId = view.view_id;
    const signature = computeViewSignature(view);
    const record = readRecord(target, viewId);
    const saved = record ? record.elements : {};
    const members = Array.isArray(view.included_elements) ? view.included_elements : [];
    const elements = {};
    let dirty = !record || record.signature !== signature;

    members.forEach((id, index) => {
      const pos = saved[id];
      if (isValidPosition(pos)) {
        elements[id] = { x: Number(pos.x), y: Number(pos.y) };
      } else {
        elements[id] = defaultPosition(index, members.length);
        dirty = true;
      }
    });
    for (const id of Object.keys(saved)) {
      if (!members.includes(id)) {
        dirty = true; // 已不在成员中的坐标：清理
      }
    }
    if (dirty) {
      writeRecord(target, viewId, {
        version: LAYOUT_VERSION,
        graphKey: resolveTarget(target, viewId).graphKey,
        view_id: viewId,
        signature,
        updatedAt: new Date().toISOString(),
        elements,
      });
    }
    return { signature, elements };
  }

  /**
   * 全量写入布局（按当前文档计算签名后原子写入侧车文件）。
   * 入参：{ project?: {id, root, graphPath}, projectId?, graphKey?, view, elements }；
   * elements: { <elementId>: {x,y} }；非法坐标抛错（由服务端映射为 400）。
   */
  function putLayout({ project, projectId, graphKey, view, elements }) {
    if (!view || typeof view.view_id !== 'string') {
      throw new Error('putLayout: view with view_id is required');
    }
    if (!elements || typeof elements !== 'object' || Array.isArray(elements)) {
      throw new Error('body.elements 必须是 { <elementId>: {x,y} } 对象');
    }
    const normalized = {};
    for (const [id, pos] of Object.entries(elements)) {
      if (!isValidPosition(pos)) {
        throw new Error(`elements['${id}'] 的坐标必须是有限的 {x,y} 数字`);
      }
      normalized[id] = { x: Number(pos.x), y: Number(pos.y) };
    }
    const target = { project, projectId, graphKey };
    const signature = computeViewSignature(view);
    writeRecord(target, view.view_id, {
      version: LAYOUT_VERSION,
      graphKey: resolveTarget(target, view.view_id).graphKey,
      view_id: view.view_id,
      signature,
      updatedAt: new Date().toISOString(),
      elements: normalized,
    });
    return { signature, view_id: view.view_id };
  }

  return { root: explicitRoot, filePathFor, readRecord, writeRecord, mergeLayout, putLayout };
}

module.exports = {
  LAYOUT_VERSION,
  PROJECT_LAYOUT_DIR,
  resolveLayoutRoot,
  computeViewSignature,
  defaultPosition,
  createLayoutStore,
};
