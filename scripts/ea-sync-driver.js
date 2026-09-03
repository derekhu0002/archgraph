'use strict';

/**
 * EA 同步驱动器（WP2789 R-S1，只读骨架）— Node STDIO MCP 客户端（零第三方依赖）。
 *
 * 复用 scripts/ea-web-service.js createMcpAdapter/callStdio 模式：
 * spawn MCP3.exe（STDIO JSON-RPC）→ initialize → tools/list → tools/call。
 *
 * 子命令：
 *   env         环境探测（EA 进程 / MCP3 可执行 / add-in 日志 / EA 连通性）
 *   tools       initialize + tools/list 全量打印（--enable-edit 时以 -enableEdit 启动）
 *   read        读工具冒烟：get_root_packages / get_current_diagram / get_opened_diagrams /
 *               get_diagrams_information / find_elements_by_name（--name 可选）
 *   probe-edit  R-S1 最小写探测：仅改元素 Notes（description），断言 DiagramObject geometry
 *               逐字节不变 + -modifiedInfoPath 审计 CSV。双重安全门：
 *                 ① 必须显式 --allow-scratch-write；
 *                 ② EA 最近打开的项目必须在 --scratch-root 下，且绝不位于本仓库目录、
 *                    绝不为 archgraph.feap（生产文件红线）。
 *
 * 退出码：0 成功；1 一般错误；2 环境缺失（无 EA 进程/无 MCP3）；3 EA 连接失败（add-in 管道不可用）；
 *         4 安全门拒绝；5 无打开的图/元素。
 *
 * 选项：--mcp3 <path>、--timeout <秒>（-setTimeout，默认 60）、--enable-edit、
 *       --modified-info <csv 路径>、--allow-scratch-write、--scratch-root <dir>、--name <s>。
 * EA 生命周期归人类：本驱动器绝不启动/关闭 EA。
 */

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const EA_LOG_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'Sparx Systems', 'EA', 'MCP_EA.log');
const DEFAULT_SCRATCH_ROOT = path.join(os.tmpdir(), 'ea-scratch');
const PROD_FORBIDDEN_BASENAME = 'archgraph.feap';

const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  ENV_MISSING: 2,
  EA_CONNECT_FAILED: 3,
  SAFETY_GATE: 4,
  NO_DIAGRAM: 5,
});

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    _: [],
    mcp3: null,
    timeoutSec: 60,
    enableEdit: false,
    modifiedInfoPath: null,
    allowScratchWrite: false,
    scratchRoot: DEFAULT_SCRATCH_ROOT,
    name: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--mcp3': opts.mcp3 = argv[++i]; break;
      case '--timeout': opts.timeoutSec = Number(argv[++i]) || 60; break;
      case '--enable-edit': opts.enableEdit = true; break;
      case '--modified-info': opts.modifiedInfoPath = argv[++i]; break;
      case '--allow-scratch-write': opts.allowScratchWrite = true; break;
      case '--scratch-root': opts.scratchRoot = argv[++i]; break;
      case '--name': opts.name = argv[++i]; break;
      default: opts._.push(arg);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// 环境探测
// ---------------------------------------------------------------------------

function findMcp3(override) {
  if (override) {
    return fs.existsSync(override) ? override : null;
  }
  const programFiles = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean);
  const candidates = [];
  for (const pf of programFiles) {
    candidates.push(path.join(pf, 'Sparx Systems', 'EA', 'MCP_Server', 'MCP3.exe'));
    candidates.push(path.join(pf, 'Sparx Systems', 'EA Trial', 'MCP_Server', 'MCP3.exe'));
  }
  for (const candidate of [...new Set(candidates)]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isEaProcessRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq EA.exe" /FO CSV /NH', { encoding: 'utf8' });
    return out.includes('EA.exe');
  } catch {
    return false;
  }
}

function readEaLogTail(maxChars = 8000) {
  try {
    const stat = fs.statSync(EA_LOG_PATH);
    const fd = fs.openSync(EA_LOG_PATH, 'r');
    try {
      const start = Math.max(0, stat.size - maxChars);
      const buffer = Buffer.alloc(Math.min(maxChars, stat.size));
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/** 从 MCP_EA.log 解析最近一次 EA_FileOpen 的项目路径（add-in 记录于 EA 打开项目时）。 */
function lastFileOpenFromLog() {
  const tail = readEaLogTail(60000);
  const matches = [...tail.matchAll(/EA_FileOpen::(.+)$/gm)];
  if (matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1][1].trim();
}

/** 会话内（最近一次 Initialize 之后）add-in 日志是否出现 80070005/管道中断错误。 */
function logHasSessionErrors() {
  const tail = readEaLogTail(60000);
  const lastInit = tail.lastIndexOf('Initialize::Initialized');
  const session = lastInit >= 0 ? tail.slice(lastInit) : tail;
  const errors = [...session.matchAll(/80070005|80131620|管道已中断|访问被拒绝|UnauthorizedAccessException/g)];
  return { hasErrors: errors.length > 0, count: errors.length };
}

function reportEnv(opts) {
  const mcp3 = findMcp3(opts.mcp3);
  const eaRunning = isEaProcessRunning();
  const lastOpen = lastFileOpenFromLog();
  const sessionErrors = logHasSessionErrors();
  const report = {
    eaProcessRunning: eaRunning,
    mcp3Path: mcp3,
    eaLogPath: fs.existsSync(EA_LOG_PATH) ? EA_LOG_PATH : null,
    lastEaFileOpen: lastOpen,
    sessionErrors,
    scratchRoot: path.resolve(opts.scratchRoot),
  };
  if (!mcp3) {
    report.envStatus = 'missing-mcp3';
    report.exitCode = EXIT.ENV_MISSING;
  } else if (!eaRunning) {
    report.envStatus = 'ea-not-running';
    report.exitCode = EXIT.ENV_MISSING;
  } else {
    report.envStatus = 'present';
    report.exitCode = EXIT.OK; // EA 与 MCP3 俱在；add-in 管道是否可用需 tools/call 实测（见 probeConnectivity）
  }
  return report;
}

// ---------------------------------------------------------------------------
// MCP STDIO 会话（复用 ea-web-service.js callStdio 模式）
// ---------------------------------------------------------------------------

class McpSession {
  constructor(mcp3Path, extraArgs) {
    this.child = spawn(mcp3Path, extraArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderrChunks = [];
    this.child.stderr.on('data', (chunk) => this.stderrChunks.push(chunk.toString('utf8')));
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;
    this.rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(JSON.stringify(msg.error)));
        } else {
          handler.resolve(msg.result);
        }
      }
    });
    this.child.on('exit', () => {
      this.closed = true;
      for (const handler of this.pending.values()) {
        handler.reject(new Error('MCP3 process exited unexpectedly'));
      }
      this.pending.clear();
    });
  }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  static withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT waiting for ${label} (${ms}ms)`)), ms)),
    ]);
  }

  async initialize() {
    const result = await McpSession.withTimeout(
      this.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ea-sync-driver', version: '0.1.0' },
      }),
      20000,
      'initialize',
    );
    return result;
  }

  async listTools() {
    const result = await McpSession.withTimeout(this.send('tools/list', {}), 30000, 'tools/list');
    return result.tools || [];
  }

  async callTool(name, args, timeoutMs = 60000) {
    const result = await McpSession.withTimeout(
      this.send('tools/call', { name, arguments: args || {} }),
      timeoutMs,
      name,
    );
    const text = (result.content || []).map((entry) => entry.text || '').join('\n');
    return { text, isError: result.isError === true };
  }

  close() {
    try {
      this.rl.close();
    } catch { /* ignore */ }
    try {
      this.child.kill();
    } catch { /* ignore */ }
  }

  stderrTail(chars = 2000) {
    return this.stderrChunks.join('').slice(-chars);
  }
}

const EA_CONNECT_ERROR_MARK = 'Failed to connect to Enterprise Architect';

function isEaConnectFailure(text) {
  if (typeof text !== 'string') {
    return false;
  }
  // MCP3 自身的连接失败文本；或 initialize 成功后工具调用整体超时（MCP3 在 -setTimeout
  // 内等待 EA add-in 管道无响应）——两者都意味着 EA 侧管道不可用。
  return text.includes(EA_CONNECT_ERROR_MARK) || /^TIMEOUT waiting for /.test(text);
}

async function openSession(opts, { requireEdit } = {}) {
  const mcp3 = findMcp3(opts.mcp3);
  if (!mcp3) {
    const error = new Error('MCP3.exe not found（--mcp3 指定或安装目录探测均失败）');
    error.exitCode = EXIT.ENV_MISSING;
    throw error;
  }
  if (!isEaProcessRunning()) {
    const error = new Error('EA 进程未运行（EA 生命周期归人类：请人工启动 EA 并打开项目）');
    error.exitCode = EXIT.ENV_MISSING;
    throw error;
  }
  const args = [];
  if (requireEdit || opts.enableEdit) {
    args.push('-enableEdit'); // 写探测仅 -enableEdit；绝不 -enableDelete
  }
  args.push('-setTimeout', String(opts.timeoutSec));
  if (opts.modifiedInfoPath) {
    args.push('-modifiedInfoPath', opts.modifiedInfoPath);
  }
  const session = new McpSession(mcp3, args);
  try {
    const info = await session.initialize();
    return { session, serverInfo: info.serverInfo || info, mcp3 };
  } catch (error) {
    session.close();
    error.exitCode = error.exitCode || EXIT.ERROR;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 子命令实现
// ---------------------------------------------------------------------------

async function cmdEnv(opts) {
  const report = reportEnv(opts);
  if (report.exitCode === EXIT.OK) {
    // EA 与 MCP3 俱在 → 实测 add-in 管道（只读调用，无副作用）。
    // 等待预算须大于 MCP3 的 -setTimeout，让 MCP3 自身的连接失败文本先回来。
    const callTimeoutMs = opts.timeoutSec * 1000 + 30000;
    try {
      const { session } = await openSession(opts);
      try {
        const result = await session.callTool('get_root_packages', {}, callTimeoutMs);
        if (isEaConnectFailure(result.text)) {
          report.envStatus = 'ea-pipe-dead';
          report.exitCode = EXIT.EA_CONNECT_FAILED;
          report.connectivity = result.text.slice(0, 300);
        } else {
          report.envStatus = 'connected';
          report.connectivity = 'ok';
        }
      } finally {
        session.close();
      }
    } catch (error) {
      report.envStatus = isEaConnectFailure(error.message) ? 'ea-pipe-dead' : 'connect-error';
      report.exitCode = isEaConnectFailure(error.message) ? EXIT.EA_CONNECT_FAILED : EXIT.ERROR;
      report.connectivity = error.message;
    }
  }
  return report;
}

async function cmdTools(opts) {
  const { session, serverInfo } = await openSession(opts, { requireEdit: opts.enableEdit });
  try {
    const tools = await session.listTools();
    return {
      serverInfo,
      enableEdit: opts.enableEdit,
      toolCount: tools.length,
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description || '' })),
    };
  } finally {
    session.close();
  }
}

async function cmdRead(opts) {
  const { session, serverInfo } = await openSession(opts);
  const report = { serverInfo, calls: {} };
  const callTimeoutMs = opts.timeoutSec * 1000 + 30000;
  try {
    const calls = [
      ['get_root_packages', {}],
      ['get_current_diagram', {}],
      ['get_opened_diagrams', {}],
    ];
    if (opts.name) {
      calls.push(['find_elements_by_name', { name: opts.name, exactMatch: false }]);
    }
    for (const [name, args] of calls) {
      try {
        const result = await session.callTool(name, args, callTimeoutMs);
        report.calls[name] = { ok: !result.isError && !isEaConnectFailure(result.text), text: result.text.slice(0, 4000) };
        if (isEaConnectFailure(result.text)) {
          const error = new Error(`${name}: ${EA_CONNECT_ERROR_MARK}（add-in 管道不可用）`);
          error.exitCode = EXIT.EA_CONNECT_FAILED;
          report.connectivity = 'dead';
          throw error;
        }
      } catch (error) {
        if (error.exitCode) {
          throw error;
        }
        report.calls[name] = { ok: false, error: error.message };
      }
    }
    // get_diagrams_information：取第一个打开的图深入读取
    try {
      const opened = report.calls.get_opened_diagrams;
      const parsed = opened && opened.ok ? tryParse(opened.text) : null;
      const diagrams = extractDiagramIds(parsed);
      if (diagrams.length > 0) {
        const detail = await session.callTool('get_diagrams_information', { diagramIDs: [diagrams[0]] }, callTimeoutMs);
        report.calls.get_diagrams_information = { ok: !detail.isError, text: detail.text.slice(0, 6000) };
        report.firstDiagramId = diagrams[0];
      }
    } catch (error) {
      if (error.exitCode) {
        throw error;
      }
      report.calls.get_diagrams_information = { ok: false, error: error.message };
    }
    report.connectivity = 'ok';
    return report;
  } finally {
    session.close();
  }
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractDiagramIds(parsed) {
  const ids = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.diagramID === 'number') {
      ids.push(value.diagramID);
    }
    if (typeof value.DiagramID === 'number') {
      ids.push(value.DiagramID);
    }
    Object.values(value).forEach(visit);
  };
  visit(parsed);
  return [...new Set(ids)];
}

function extractElements(parsed) {
  const elements = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.elementID === 'number' && typeof value.name === 'string') {
      elements.push(value);
    }
    Object.values(value).forEach(visit);
  };
  visit(parsed);
  return elements;
}

/** 取元素在图中的 geometry 快照（规范化 JSON 串，供逐字节比较）。 */
function geometrySnapshot(diagramInfoParsed, elementID) {
  const holders = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const id = value.elementID ?? value.ElementID;
    if (id === elementID) {
      holders.push(value);
    }
    Object.values(value).forEach(visit);
  };
  visit(diagramInfoParsed);
  const geoParts = holders.map((holder) => {
    const pick = (source) => {
      if (!source || typeof source !== 'object') {
        return null;
      }
      const keys = Object.keys(source).filter((key) => /left|top|right|bottom|width|height|cx|cy|diagramobject|geometry/i.test(key));
      if (keys.length === 0) {
        return null;
      }
      const picked = {};
      for (const key of keys.sort()) {
        picked[key] = source[key];
      }
      return picked;
    };
    return pick(holder) || pick(holder.diagramObject) || pick(holder.DiagramObject);
  }).filter(Boolean);
  return JSON.stringify(geoParts);
}

/** 安全门：最近打开的项目必须位于 scratch 根下，且绝不位于仓库目录、绝不为生产文件。 */
function safetyGateCheck(opts) {
  const lastOpen = lastFileOpenFromLog();
  if (!lastOpen) {
    return { pass: false, reason: 'MCP_EA.log 中无 EA_FileOpen 记录，无法确认 EA 当前打开的项目', lastOpen };
  }
  const normalized = path.resolve(lastOpen);
  const lower = normalized.toLowerCase();
  if (path.basename(lower) === PROD_FORBIDDEN_BASENAME) {
    return { pass: false, reason: `当前打开的是生产文件 ${normalized}，写探测被红线拒绝`, lastOpen: normalized };
  }
  if (lower.startsWith(REPO_ROOT.toLowerCase())) {
    return { pass: false, reason: `当前打开的项目位于仓库目录内（${normalized}），写探测被红线拒绝`, lastOpen: normalized };
  }
  const scratchRoot = path.resolve(opts.scratchRoot).toLowerCase();
  if (!lower.startsWith(scratchRoot)) {
    return { pass: false, reason: `当前打开的项目不在 scratch 根（${path.resolve(opts.scratchRoot)}）下：${normalized}`, lastOpen: normalized };
  }
  return { pass: true, lastOpen: normalized };
}

async function cmdProbeEdit(opts) {
  if (!opts.allowScratchWrite) {
    const error = new Error('写探测需要显式 --allow-scratch-write（R-S1 安全门①）');
    error.exitCode = EXIT.SAFETY_GATE;
    throw error;
  }
  const gate = safetyGateCheck(opts);
  if (!gate.pass) {
    const error = new Error(`安全门②拒绝：${gate.reason}`);
    error.exitCode = EXIT.SAFETY_GATE;
    error.gate = gate;
    throw error;
  }

  const scratchDir = path.dirname(gate.lastOpen);
  const modifiedInfoPath = opts.modifiedInfoPath || path.join(scratchDir, 'modified-info.csv');
  const probeOpts = { ...opts, enableEdit: true, modifiedInfoPath };
  const { session, serverInfo } = await openSession(probeOpts, { requireEdit: true });
  const report = { serverInfo, safetyGate: gate, modifiedInfoPath };
  const callTimeoutMs = opts.timeoutSec * 1000 + 30000;
  try {
    // 1) 找一个打开的图与其上的元素 E
    const opened = await session.callTool('get_opened_diagrams', {}, callTimeoutMs);
    if (isEaConnectFailure(opened.text)) {
      const error = new Error(`${EA_CONNECT_ERROR_MARK}（add-in 管道不可用）`);
      error.exitCode = EXIT.EA_CONNECT_FAILED;
      throw error;
    }
    const diagramIds = extractDiagramIds(tryParse(opened.text));
    if (diagramIds.length === 0) {
      const error = new Error('EA 中没有打开的图（请先在 EA 中打开 scratch 项目的一张图）');
      error.exitCode = EXIT.NO_DIAGRAM;
      throw error;
    }
    const diagramId = diagramIds[0];
    const before = await session.callTool('get_diagrams_information', { diagramIDs: [diagramId] }, callTimeoutMs);
    const beforeParsed = tryParse(before.text);
    const elements = extractElements(beforeParsed);
    if (elements.length === 0) {
      const error = new Error(`图 ${diagramId} 上没有元素，无法执行写探测`);
      error.exitCode = EXIT.NO_DIAGRAM;
      throw error;
    }
    const target = elements[0];
    const elementID = target.elementID;
    const geometryBefore = geometrySnapshot(beforeParsed, elementID);

    // 2) 仅改 Notes（description）
    const notesProbe = `archgraph-r1-probe ${new Date().toISOString()}`;
    const update = await session.callTool('create_or_update_elements', {
      elementInfo: [{ elementID, description: notesProbe }],
    }, callTimeoutMs);
    report.updateResult = update.text.slice(0, 1500);
    if (update.isError || /error|failed/i.test(update.text)) {
      const error = new Error(`create_or_update_elements 失败：${update.text.slice(0, 500)}`);
      error.exitCode = EXIT.ERROR;
      throw error;
    }

    // 3) 读回 geometry 比对（逐字节）
    const after = await session.callTool('get_diagrams_information', { diagramIDs: [diagramId] }, callTimeoutMs);
    const afterParsed = tryParse(after.text);
    const geometryAfter = geometrySnapshot(afterParsed, elementID);
    report.elementID = elementID;
    report.elementName = target.name;
    report.notesSet = notesProbe;
    report.geometryBefore = geometryBefore;
    report.geometryAfter = geometryAfter;
    report.geometryUnchanged = geometryBefore === geometryAfter;

    // 4) 审计 CSV 检查
    try {
      const csv = fs.readFileSync(modifiedInfoPath, 'utf8');
      const lines = csv.split(/\r?\n/).filter(Boolean);
      report.modifiedInfo = {
        exists: true,
        lineCount: lines.length,
        mentionsChange: csv.includes(String(elementID)) || csv.includes('create_or_update_elements') || csv.includes('Element'),
        tail: lines.slice(-5),
      };
    } catch {
      report.modifiedInfo = { exists: false };
    }
    return report;
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const COMMANDS = Object.freeze({
  env: cmdEnv,
  tools: cmdTools,
  read: cmdRead,
  'probe-edit': cmdProbeEdit,
});

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const subcommand = opts._[0];
  if (!subcommand || !COMMANDS[subcommand]) {
    process.stdout.write(`${JSON.stringify({
      error: `unknown subcommand: ${subcommand || '(none)'}`,
      usage: 'node scripts/ea-sync-driver.js <env|tools|read|probe-edit> [options]',
      options: ['--mcp3 <path>', '--timeout <sec>', '--enable-edit', '--modified-info <csv>', '--allow-scratch-write', '--scratch-root <dir>', '--name <s>'],
      exitCodes: EXIT,
    }, null, 2)}\n`);
    process.exit(EXIT.ERROR);
  }
  try {
    const result = await COMMANDS[subcommand](opts);
    process.stdout.write(`${JSON.stringify({ ok: true, exitCode: EXIT.OK, ...result }, null, 2)}\n`);
    process.exit(result && typeof result.exitCode === 'number' ? result.exitCode : EXIT.OK);
  } catch (error) {
    const exitCode = error.exitCode || EXIT.ERROR;
    process.stdout.write(`${JSON.stringify({ ok: false, exitCode, error: error.message, ...(error.gate ? { gate: error.gate } : {}) }, null, 2)}\n`);
    process.exit(exitCode);
  }
}

if (require.main === module) {
  main();
}

module.exports = { EXIT, findMcp3, isEaProcessRunning, lastFileOpenFromLog, logHasSessionErrors, McpSession, safetyGateCheck };
