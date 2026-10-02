// dsh-argo-workspace - single source of truth for the DSH workspace bridge.
// install-argo.ps1 copies this file verbatim into ~/.dsh/plugins, so the
// deployed plugin and this shipped bundle artifact are byte-identical.
//
// Direct MCP stdio bridge(es) for DeepSeek Harness. Registers every tool of each
// configured MCP server as mcp__<id>__* and, for the argo server, injects the
// current session's workspace directory (SessionHeader.cwd) as the per-call
// `workspaceRoot` argument, so one dsh instance follows whichever workspace the
// user switched to - the model sees no extra parameters and no internal tool
// names. The argo server honors the injected workspaceRoot unconditionally.
//
// Multiple servers are supported so a host that can only spawn local stdio
// children (DSH) can still mount the remote federation Graph MCP through the
// stdio bridge (GRAPH_MCP_URL). Configure via `config.servers` (a list); the
// legacy single-server shape (`config.serverPath`) is still honored.
//
// Zero dependencies on purpose: implements the minimal MCP stdio client
// (JSON-RPC 2.0, one JSON object per line) with Node built-ins only, so the
// plugin runs from any DSH layout without resolving @modelcontextprotocol/sdk.
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-argo-workspace'
export const inject = ['tools']

// 包内默认：<pkg>/argo/scripts/argo-mcp-server.js —— 随包走，跨机器可移植。
const DEFAULT_SERVER_PATH = fileURLToPath(
  new URL('../argo/scripts/argo-mcp-server.js', import.meta.url),
)

// A `serverPath`/`args` entry that starts with ./ or ../ resolves relative to this
// plugin module (portable bundle references); an absolute path is used as-is.
function resolveMaybeRelative(value) {
  if (typeof value === 'string' && /^[.][\\/]/.test(value)) {
    try {
      return fileURLToPath(new URL(value, import.meta.url))
    } catch {
      return value
    }
  }
  return value
}

/** Normalize config into a list of server specs (backward compatible). */
function normalizeServerSpecs(config) {
  const topWorkspaces = Array.isArray(config.workspaces) ? config.workspaces : []
  const withCommon = (spec) => {
    const env = { ...process.env, ...(spec.env || {}) }
    if (spec.injectWorkspaceRoot && topWorkspaces.length > 0) {
      env.ARGO_WORKSPACE_ROOTS = topWorkspaces.join(';')
    }
    return { ...spec, env, cwd: spec.cwd ?? (spec.injectWorkspaceRoot ? config.cwd : undefined) }
  }

  if (Array.isArray(config.servers) && config.servers.length > 0) {
    return config.servers.map((server) => {
      const id = typeof server.id === 'string' && server.id !== '' ? server.id : 'server'
      const injectWorkspaceRoot = server.injectWorkspaceRoot !== undefined
        ? server.injectWorkspaceRoot === true
        : id === 'argo'
      const serverPath = resolveMaybeRelative(server.serverPath)
        ?? (id === 'argo' ? DEFAULT_SERVER_PATH : undefined)
      const args = Array.isArray(server.args)
        ? server.args.map(resolveMaybeRelative)
        : (serverPath ? [serverPath] : [])
      return withCommon({
        id,
        // mcp__<id>__ prefix mirrors the host's server-name convention.
        prefix: typeof server.prefix === 'string' && server.prefix !== '' ? server.prefix : 'mcp__' + id + '__',
        command: typeof server.command === 'string' && server.command !== '' ? server.command : 'node',
        args,
        env: server.env && typeof server.env === 'object' ? server.env : {},
        cwd: server.cwd,
        injectWorkspaceRoot,
      })
    })
  }

  // Legacy single-server shape: the argo workspace bridge.
  const serverPath = config.serverPath ?? process.env.ARGO_SERVER_PATH ?? DEFAULT_SERVER_PATH
  return [withCommon({
    id: 'argo',
    prefix: 'mcp__argo__',
    command: 'node',
    args: [serverPath],
    env: {},
    cwd: config.cwd,
    injectWorkspaceRoot: true,
  })]
}

/** Minimal MCP stdio client over one spawned server process. */
function createStdioClient(command, args, env, cwd) {
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    ...(cwd ? { cwd } : {}),
  })
  const pending = new Map()
  let nextId = 1
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message && typeof message.id === 'number' && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  })
  child.stderr.on('data', () => {}) // drain; the server logs to stderr
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  return {
    request,
    notify: (method, params) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    },
    close: () => child.kill(),
  }
}

/** Connect one server, list its tools, and register them under its prefix. */
async function mountServer(ctx, spec, registered) {
  const client = createStdioClient(spec.command, spec.args, spec.env, spec.cwd)
  ctx.effect(() => () => client.close(), `dsh-argo-workspace.dispose(${spec.id})`)

  let tools = []
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-argo-workspace', version: '0.1.0' },
    })
    client.notify('notifications/initialized', {})
    const listed = await client.request('tools/list', {})
    tools = (listed && Array.isArray(listed.tools)) ? listed.tools : []
  } catch (error) {
    console.warn(`[dsh-argo-workspace] failed to connect to '${spec.id}' (${spec.args.join(' ')}): ${error && error.message ? error.message : error}`)
    return
  }

  for (const tool of tools) {
    const publicName = spec.prefix + tool.name
    registered.push(ctx.tools.register({
      name: publicName,
      description: tool.description ?? '',
      parameters: tool.inputSchema,
      output: {
        schema: {
          type: 'object',
          properties: {
            content: { type: 'array', items: {} },
            structuredContent: {},
          },
          required: ['content'],
          additionalProperties: false,
        },
        render: (_args, value) => value.content,
      },
      execute: async (args, exec) => {
        // SessionHeader.cwd (the durable session workspace), NOT
        // requestHeader() — that returns the request EpochHeader
        // (config/system/tools) which has no cwd field.
        const injected = { ...(args && typeof args === 'object' ? args : {}) }
        if (spec.injectWorkspaceRoot) {
          const sessionCwd = exec && exec.agent && exec.agent.session
            ? exec.agent.session.header?.cwd
            : undefined
          if (typeof sessionCwd === 'string' && sessionCwd !== '') {
            injected.workspaceRoot = sessionCwd
          }
        }
        if (exec && exec.signal && exec.signal.aborted) {
          throw new Error('aborted')
        }
        const result = await client.request('tools/call', {
          name: tool.name,
          arguments: injected,
        })
        const text = Array.isArray(result.content)
          ? result.content
              .map((block) => block && block.type === 'text' && typeof block.text === 'string'
                ? block.text
                : JSON.stringify(block))
              .join('\n')
          : (result.toolResult !== undefined ? JSON.stringify(result.toolResult) : '(no output)')
        if (result.isError === true) throw new Error(text)
        return {
          content: [{ type: 'text', text }],
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        }
      },
    }))
  }
}

/** Connect every configured server, register its tools, keep clients until disposal. */
export async function apply(ctx, config) {
  const specs = normalizeServerSpecs(config || {})
  const registered = []
  for (const spec of specs) {
    await mountServer(ctx, spec, registered)
  }
  ctx.effect(() => () => {
    for (const dispose of registered) dispose()
  }, 'dsh-argo-workspace.tools')
}
