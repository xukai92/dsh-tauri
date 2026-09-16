/** Exercise the packaged macOS sidecar through its shipped HTTP, image, and PTY paths. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    'source-cli': { type: 'boolean', default: false },
    'inventory-only': { type: 'boolean', default: false },
  },
})
if (values.app === undefined && !values['source-cli']) {
  throw new Error('Usage: smoke-tauri-bundle.ts (--app <bundle.app> | --source-cli) [--inventory-only]')
}
if (values.app !== undefined && values['source-cli']) throw new Error('--app and --source-cli are mutually exclusive')

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const app = values.app === undefined ? undefined : resolve(values.app)
const macos = app === undefined ? undefined : join(app, 'Contents', 'MacOS')
const sidecar = macos === undefined ? undefined : join(macos, 'dsh-web')
const spawnHelper = macos === undefined ? undefined : join(macos, 'dsh-web-spawn-helper')
const ripgrep = macos === undefined ? undefined : join(macos, 'dsh-web-rg')

async function assertExecutable(path: string): Promise<void> {
  await access(path)
  if (((await stat(path)).mode & 0o111) === 0) throw new Error(`${path} is not executable`)
}

if (app !== undefined && macos !== undefined && sidecar !== undefined && spawnHelper !== undefined && ripgrep !== undefined) {
  await assertExecutable(sidecar)
  await assertExecutable(spawnHelper)
  await assertExecutable(ripgrep)
  console.log(`tauri bundle inventory: ${basename(sidecar)}, ${basename(spawnHelper)}, ${basename(ripgrep)}`)
}
if (values['inventory-only']) process.exit(0)
if (app !== undefined && process.platform !== 'darwin') {
  throw new Error('native bundle smoke requires macOS; use --inventory-only elsewhere')
}

interface ProviderRequest {
  messages?: Array<{ role?: string; content?: unknown }>
}

function messagesResponse(content: { kind: 'text'; text: string } | { kind: 'tool'; id: string; name: string; input: object }): string {
  const events: object[] = [
    { type: 'message_start', message: { id: 'tauri-smoke-response', model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
  ]
  if (content.kind === 'text') {
    events.push(
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: content.text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    )
  } else {
    events.push(
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: content.id, name: content.name, input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(content.input) } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
    )
  }
  events.push({ type: 'message_stop' })
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
}

const provider = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    void (async () => {
      try {
        const bytes = Buffer.concat(chunks)
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (request.method === 'POST' && requestUrl.pathname === '/v1/files') {
          const contentType = request.headers['content-type']
          if (contentType === undefined) throw new Error('Files upload omitted Content-Type')
          const form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData()
          const file = form.get('file')
          if (!(file instanceof Blob)) throw new Error('Files upload omitted its file part')
          const imageBytes = Buffer.from(await file.arrayBuffer())
          providerState.observedNormalizedUpload ||= file.type === 'image/webp' && file.size > 0
            && imageBytes.includes(Buffer.from('RIFF')) && imageBytes.includes(Buffer.from('WEBP'))
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({
            id: 'tauri-smoke-image', type: 'file', size_bytes: imageBytes.length,
            created_at: new Date().toISOString(), filename: 'smoke.png', mime_type: 'image/webp',
          }))
          return
        }
        if (request.method !== 'POST' || requestUrl.pathname !== '/v1/messages') {
          response.writeHead(404, { 'content-type': 'text/plain' })
          response.end(`unexpected mock provider request: ${request.method ?? 'UNKNOWN'} ${requestUrl.pathname}`)
          return
        }
        const body = JSON.parse(bytes.toString('utf8')) as ProviderRequest
        const serializedMessages = JSON.stringify(body.messages)
        const toolCompleted = serializedMessages.includes('tool_result')
        if (serializedMessages.includes('TAURI_PTY_IMAGE')) {
          providerState.observedImage ||= serializedMessages.includes('"type":"image"')
            && serializedMessages.includes('"file_id":"tauri-smoke-image"')
          providerState.observedPtyResult ||= serializedMessages.includes('TAURI_PTY_OK:')
        }
        if (serializedMessages.includes('TAURI_RG')) {
          providerState.observedRipgrepResult ||= serializedMessages.includes('tauri-rg-result-probe.txt')
        }
        const payload = serializedMessages.includes('TAURI_PTY_IMAGE') && !toolCompleted
          ? messagesResponse({ kind: 'tool', id: 'tauri-pty-call', name: 'bash', input: { command: 'sleep 60 & echo TAURI_PTY_OK:$!' } })
          : serializedMessages.includes('TAURI_RG') && !toolCompleted
            ? messagesResponse({ kind: 'tool', id: 'tauri-rg-call', name: 'grep', input: { pattern: 'TAURI_RG_MATCH_CONTENT', path: '.' } })
            : messagesResponse({ kind: 'text', text: serializedMessages.includes('TAURI_RG') ? 'TAURI_RG_DONE' : 'TAURI_ROUND_DONE' })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(payload)
      } catch (error) {
        providerState.failure = error instanceof Error ? error.message : String(error)
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(`mock provider failure: ${providerState.failure}`)
      }
    })()
  })
})
const providerState = {
  observedNormalizedUpload: false,
  observedImage: false,
  observedPtyResult: false,
  observedRipgrepResult: false,
  failure: undefined as string | undefined,
}
await new Promise<void>(resolveListen => provider.listen(0, '127.0.0.1', resolveListen))
const address = provider.address()
if (address === null || typeof address === 'string') throw new Error('mock provider did not bind')
const providerPort = address.port

const world = await mkdtemp(join(tmpdir(), 'dsh-tauri-bundle-smoke-'))
let child: ChildProcess | undefined
let desktop: ChildProcess | undefined
let desktopHostPid: number | undefined
let desktopSpawnError: Error | undefined
let output = ''
let detachedPid: string | undefined

type ProcessOutcome =
  | { kind: 'error'; error: Error }
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }

function observeOutcome(process: ChildProcess): Promise<ProcessOutcome> {
  return new Promise((resolveOutcome) => {
    process.once('error', (error) => { resolveOutcome({ kind: 'error', error }) })
    process.once('exit', (code, signal) => { resolveOutcome({ kind: 'exit', code, signal }) })
  })
}

function captureProcessOutput(process: ChildProcess): () => string {
  const chunks: Buffer[] = []
  let byteCount = 0
  const append = (chunk: Buffer): void => {
    byteCount += chunk.length
    if (byteCount <= 1024 * 1024) chunks.push(chunk)
  }
  process.stdout?.on('data', append)
  process.stderr?.on('data', append)
  return () => Buffer.concat(chunks).toString('utf8')
}

function describeOutcome(outcome: ProcessOutcome, captured: string): string {
  if (outcome.kind === 'error') return `failed to start: ${outcome.error.stack ?? outcome.error.message}`
  return `exited with code ${String(outcome.code)}, signal ${String(outcome.signal)}${captured === '' ? '' : `:\n${captured}`}`
}

async function prepareSourcePreset(): Promise<string> {
  if (!values['source-cli']) return 'minimal'
  const shellPath = await findOnPath('bash')
  const sourceDir = join(repoRoot, 'packages/preset/agent-presets/presets/minimal')
  const composition = await readFile(join(sourceDir, 'agent.cordis.yml'), 'utf8')
  const anchor = "    - id: terminal-bash\n      name: '@deepseek-ai/dsh-terminal-bash'\n      disabled: !!js process.platform === 'win32'\n      config:\n"
  if (!composition.includes(anchor)) throw new Error('minimal preset terminal-bash row changed')
  const targetDir = join(world, 'dsh-home', '.agent-presets', 'tauri-smoke')
  await mkdir(targetDir, { recursive: true })
  await writeFile(join(targetDir, 'agent.cordis.yml'), composition.replace(
    anchor,
    `${anchor}        shellPath: ${JSON.stringify(shellPath)}\n`,
  ))
  await writeFile(join(targetDir, 'preset.yml'), 'name: Tauri source smoke\ndescription: Test-only real PTY composition.\norder: 99\n')
  return 'tauri-smoke'
}

async function findOnPath(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue through PATH; failure means this candidate is absent or not executable.
    }
  }
  throw new Error(`${name} is not executable on PATH`)
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const keep = ['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']
  const env = Object.fromEntries(keep.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]))
  return {
    ...env,
    DSH_HOME: join(world, 'dsh-home'),
    DSH_AGENTS_HOME: join(world, 'agents-home'),
    DSH_BUNDLED_SKILL_DIR: join(world, 'bundled-skills'),
    DSH_CWD: world,
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json'),
    DEEPSEEK_API_KEY: 'tauri-bundle-smoke-key',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${providerPort}`,
  }
}

function waitForReady(process: ChildProcess): Promise<string> {
  return new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sidecar readiness timed out:\n${output}`))
    }, 30_000)
    const inspect = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\S*)(?:[ \t].*)?\r?\n/m.exec(output)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    process.stdout?.on('data', inspect)
    process.stderr?.on('data', inspect)
    process.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error('failed to start sidecar', { cause: error }))
    })
    process.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`sidecar exited before readiness (${code}):\n${output}`))
    })
  })
}

async function fetchWithTimeout(input: string | URL, init?: RequestInit): Promise<Response> {
  return await fetch(input, { ...init, signal: AbortSignal.timeout(5_000) })
}

let authentication: Promise<{ origin: string; cookie: string }> | undefined

async function authenticatedWeb(launchUrl: string): Promise<{ origin: string; cookie: string }> {
  authentication ??= (async () => {
    const response = await fetchWithTimeout(launchUrl, { redirect: 'manual' })
    const setCookie = response.headers.get('set-cookie')
    if (response.status !== 303 || setCookie === null) {
      throw new Error(`sidecar authentication returned HTTP ${String(response.status)}`)
    }
    const cookie = setCookie.split(';', 1)[0]
    if (cookie === undefined) throw new Error('sidecar authentication returned an empty cookie')
    return { origin: new URL(launchUrl).origin, cookie }
  })()
  return authentication
}

async function rpc<T>(baseUrl: string, method: string, args: object): Promise<T> {
  const authenticated = await authenticatedWeb(baseUrl)
  const endpoint = new URL(`/api/${method}`, authenticated.origin)
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: authenticated.cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `tauri-${method}-${randomUUID()}`, method, payload: { args } }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}: ${text}`)
  const body = JSON.parse(text) as { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }
  if (!body.result.ok) throw new Error(`${method}: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

interface HistoryPage {
  records: Array<{ type: 'event' | 'chunks'; event: { type: string; data: unknown } }>
  hasMore: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function webSocketText(bytes: WebSocket.RawData): string {
  if (Buffer.isBuffer(bytes)) return bytes.toString('utf8')
  if (Array.isArray(bytes)) return Buffer.concat(bytes).toString('utf8')
  return Buffer.from(bytes).toString('utf8')
}

async function sessionCursor(baseUrl: string, sessionId: string): Promise<number> {
  const authenticated = await authenticatedWeb(baseUrl)
  const socket = new WebSocket(`${authenticated.origin.replace(/^http/u, 'ws')}/api/remote.mux`, {
    headers: { cookie: authenticated.cookie },
    handshakeTimeout: 5_000,
  })
  // Operation listeners report failures through their promises. This listener
  // remains for a late error emitted by intentional termination during cleanup.
  socket.on('error', () => {})
  const streamId = `tauri-history-${randomUUID()}`
  try {
    await new Promise<void>((resolveOpen, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        socket.terminate()
        reject(new Error('session/follow WebSocket did not open'))
      }, 5_000)
      const cleanup = (): void => {
        clearTimeout(timer)
        socket.off('open', opened)
        socket.off('error', failed)
      }
      const opened = (): void => { cleanup(); resolveOpen() }
      const failed = (error: Error): void => { cleanup(); reject(error) }
      socket.once('open', opened)
      socket.once('error', failed)
    })
    return await new Promise<number>((resolveCursor, reject) => {
      const timer = setTimeout(() => { finish(new Error('session/follow did not publish a cursor')) }, 10_000)
      const message = (bytes: WebSocket.RawData): void => {
        try {
          const frame: unknown = JSON.parse(webSocketText(bytes))
          if (!isRecord(frame) || frame.streamId !== streamId) return
          if (frame.type === 'error') {
            finish(new Error(`session/follow failed: ${JSON.stringify(frame.error)}`))
            return
          }
          if (frame.type === 'end') {
            finish(new Error('session/follow ended before publishing a cursor'))
            return
          }
          if (frame.type === 'item' && isRecord(frame.value)
            && frame.value.type === 'snapshot' && Number.isSafeInteger(frame.value.cursor)) {
            finish(undefined, frame.value.cursor as number)
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      }
      const failed = (error: Error): void => { finish(error) }
      const closed = (): void => { finish(new Error('session/follow closed before publishing a cursor')) }
      const finish = (error: Error | undefined, cursor?: number): void => {
        clearTimeout(timer)
        socket.off('message', message)
        socket.off('error', failed)
        socket.off('close', closed)
        if (error !== undefined) reject(error)
        else resolveCursor(cursor ?? -1)
      }
      socket.on('message', message)
      socket.once('error', failed)
      socket.once('close', closed)
      socket.send(JSON.stringify({
        type: 'open', streamId, endpoint: 'session/follow',
        payload: { args: { request: { address: { kind: 'session', sessionId } } } },
      }))
    })
  } finally {
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.terminate()
  }
}

async function history(baseUrl: string, sessionId: string): Promise<HistoryPage> {
  const throughSeq = await sessionCursor(baseUrl, sessionId)
  return await rpc<HistoryPage>(baseUrl, 'session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq, maxMessages: 50 },
  })
}

async function capture(command: string, args: string[], timeoutMs = 5_000): Promise<string> {
  const captured = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks: Buffer[] = []
  let byteCount = 0
  const append = (chunk: Buffer): void => {
    byteCount += chunk.length
    if (byteCount <= 1024 * 1024) chunks.push(chunk)
  }
  captured.stdout.on('data', append)
  captured.stderr.on('data', append)
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      captured.kill('SIGKILL')
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    captured.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`failed to start ${command}`, { cause: error }))
    })
    captured.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
  if (outcome.code !== 0 || outcome.signal !== null) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${String(outcome.code)}, signal ${String(outcome.signal)}: ${Buffer.concat(chunks).toString('utf8')}`)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function waitForDesktopHost(appProcess: ChildProcess, capturedOutput: () => string): Promise<{ pid: number; url: string }> {
  if (appProcess.pid === undefined) throw new Error('desktop app has no pid')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (desktopSpawnError !== undefined) throw new Error('failed to start desktop app', { cause: desktopSpawnError })
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error(`desktop app exited during startup with code ${String(appProcess.exitCode)}, signal ${String(appProcess.signalCode)}:\n${capturedOutput()}`)
    }
    const table = await capture('ps', ['-axo', 'pid=,ppid=,comm='])
    const childLine = table.split('\n').find((line) => {
      const fields = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
      return Number(fields?.[2]) === appProcess.pid && fields?.[3]?.endsWith('/dsh-web') === true
    })
    const pid = Number(/^\s*(\d+)/.exec(childLine ?? '')?.[1])
    if (Number.isSafeInteger(pid) && pid > 0) {
      const listeners = await capture('lsof', ['-Pan', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
        .catch(() => '')
      const port = /127\.0\.0\.1:(\d+)/.exec(listeners)?.[1]
      if (port !== undefined) {
        const url = `http://127.0.0.1:${port}`
        const response = await fetchWithTimeout(url).catch(() => undefined)
        if (response?.status === 401) return { pid, url }
      }
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new Error(`desktop app did not start a listening dsh-web child:\n${capturedOutput()}`)
}

async function nativeApplicationStatus(appProcess: ChildProcess): Promise<'missing' | 'launching' | 'ready'> {
  if (appProcess.pid === undefined) throw new Error('desktop app has no pid')
  const script = [
    'ObjC.import("AppKit")',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${appProcess.pid})`,
    'app.isNil() ? "missing" : (app.finishedLaunching ? "ready" : "launching")',
  ].join('\n')
  const status = (await capture('osascript', ['-l', 'JavaScript', '-e', script])).trim()
  if (status === 'missing' || status === 'launching' || status === 'ready') return status
  throw new Error(`AppKit returned an unknown desktop application status: ${status}`)
}

async function waitForDesktopApplication(appProcess: ChildProcess, capturedOutput: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  let status: 'missing' | 'launching' | 'ready' = 'missing'
  while (Date.now() < deadline) {
    if (desktopSpawnError !== undefined) throw new Error('failed to start desktop app', { cause: desktopSpawnError })
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error(`desktop app exited during native launch with code ${String(appProcess.exitCode)}, signal ${String(appProcess.signalCode)}:\n${capturedOutput()}`)
    }
    status = await nativeApplicationStatus(appProcess)
    if (status === 'ready') return
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`desktop app did not finish native launch (last AppKit status: ${status}):\n${capturedOutput()}`)
}

async function requestDesktopQuit(appProcess: ChildProcess): Promise<void> {
  if (appProcess.pid === undefined) throw new Error('desktop app has no pid')
  const script = [
    'ObjC.import("AppKit")',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${appProcess.pid})`,
    'if (app.isNil()) throw new Error("desktop application is not registered with AppKit")',
    'app.terminate ? "requested" : "refused"',
  ].join('\n')
  const result = (await capture('osascript', ['-l', 'JavaScript', '-e', script])).trim()
  if (result !== 'requested') throw new Error(`AppKit refused the desktop Quit request: ${result}`)
}

async function waitForPidExit(pid: number, label: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (isMissingProcess(error)) return
      throw error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error(`${label} ${pid} remained alive`)
}

async function stopChild(process: ChildProcess, label: string): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null || process.pid === undefined) return
  try {
    process.kill('SIGKILL')
  } catch (error) {
    if (isMissingProcess(error)) return
    throw error
  }
  await Promise.race([
    new Promise<void>((resolveExit) => {
      process.once('exit', () => { resolveExit() })
      process.once('close', () => { resolveExit() })
    }),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error(`${label} did not exit after SIGKILL`)) }, 5_000)
    }),
  ])
}

async function stopPid(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (isMissingProcess(error)) return
    throw error
  }
  try {
    await waitForPidExit(pid, 'cleanup process')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if (!isMissingProcess(error)) throw error
    }
    await waitForPidExit(pid, 'cleanup process')
  }
}

let primaryFailure: unknown
try {
  const agentPreset = await prepareSourcePreset()
  const command = sidecar ?? process.execPath
  const commandArgs = sidecar === undefined
    ? ['--import', import.meta.resolve('tsx/esm'), join(repoRoot, 'apps/cli/src/bin.ts'), 'web', '--port', '0', '--no-open']
    : ['--profile', 'web', '--port', '0', '--no-open']
  const sidecarProcess = spawn(command, commandArgs, {
    cwd: world,
    env: cleanEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child = sidecarProcess
  const baseUrl = await waitForReady(sidecarProcess)
  const authenticated = await authenticatedWeb(baseUrl)
  const frontend = await fetchWithTimeout(authenticated.origin, { headers: { cookie: authenticated.cookie } })
  if (!frontend.ok || !(await frontend.text()).includes('<div id="root"')) {
    throw new Error(`bundled frontend was not served from ${baseUrl}`)
  }
  await writeFile(join(world, 'tauri-rg-result-probe.txt'), 'TAURI_RG_MATCH_CONTENT\n')
  await rpc(baseUrl, 'settings/describe', {})
  const created = await rpc<{ sessionId: string }>(baseUrl, 'session/create', {
    request: { cwd: world, agentPreset },
  })
  await rpc(baseUrl, 'session/selectModel', { request: {
    sessionId: created.sessionId, provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp',
  } })
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  await rpc(baseUrl, 'session/prompt', { request: {
    requestId: randomUUID(), sessionId: created.sessionId, mode: 'queue',
    content: [
      { type: 'text', text: 'TAURI_PTY_IMAGE' },
      { type: 'image', mediaType: 'image/png', data: png, name: 'smoke.png' },
    ],
  } })
  let completed = false
  let durableImageObserved = false
  let lastHistory = ''
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (providerState.failure !== undefined) throw new Error(`mock provider failed: ${providerState.failure}`)
    const page = await history(baseUrl, created.sessionId)
    const serialized = JSON.stringify(page)
    lastHistory = serialized
    if (serialized.includes('"isError":true')) {
      throw new Error(`persistent PTY returned an error result; history=${serialized}`)
    }
    detachedPid = /TAURI_PTY_OK:(\d+)/.exec(serialized)?.[1]
    const normalizedBytes = Number(/"mediaType":"image\/webp","width":1,"height":1,"bytes":(\d+)/.exec(serialized)?.[1])
    durableImageObserved = serialized.includes('"mediaType":"image/webp"')
      && serialized.includes('"width":1') && serialized.includes('"height":1')
      && normalizedBytes > 0
    completed = detachedPid !== undefined && durableImageObserved
      && serialized.includes('TAURI_ROUND_DONE') && serialized.includes('turn/end')
    if (completed) break
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  if (!completed || detachedPid === undefined) {
    throw new Error(`persistent PTY/model turn did not complete; history=${lastHistory}; host=${output}`)
  }
  if (!providerState.observedNormalizedUpload || !providerState.observedImage) {
    throw new Error(`provider did not receive and reference the normalized WebP image: ${JSON.stringify(providerState)}`)
  }
  if (!providerState.observedPtyResult) throw new Error('provider did not receive the persistent PTY result')
  try {
    process.kill(Number(detachedPid), 0)
  } catch (error) {
    throw new Error(`PTY descendant ${detachedPid} exited before the shutdown probe`, { cause: error })
  }

  const searchSession = await rpc<{ sessionId: string }>(baseUrl, 'session/create', {
    request: { cwd: world, agentPreset: 'standard' },
  })
  await rpc(baseUrl, 'session/prompt', { request: {
    requestId: randomUUID(), sessionId: searchSession.sessionId, mode: 'queue',
    content: [{ type: 'text', text: 'TAURI_RG' }],
  } })
  let searchHistory = ''
  let searchCompleted = false
  const searchDeadline = Date.now() + 60_000
  while (Date.now() < searchDeadline) {
    if (providerState.failure !== undefined) throw new Error(`mock provider failed: ${providerState.failure}`)
    searchHistory = JSON.stringify(await history(baseUrl, searchSession.sessionId))
    if (searchHistory.includes('"isError":true')) throw new Error(`ripgrep tool returned an error; history=${searchHistory}`)
    if (providerState.observedRipgrepResult && searchHistory.includes('TAURI_RG_DONE')
      && searchHistory.includes('turn/end')) {
      searchCompleted = true
      break
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  if (!searchCompleted) {
    throw new Error(`ripgrep/model turn did not complete; history=${searchHistory}`)
  }
  const settingsPath = join(world, 'dsh-home', 'settings.yaml')
  const described = await rpc<{ namespaces: Array<{ ns: string; revision: number }> }>(baseUrl, 'settings/describe', {})
  const onboarding = described.namespaces.find(namespace => namespace.ns === 'ui-onboarding')
  if (onboarding === undefined) throw new Error('settings describe omitted ui-onboarding')
  await rpc(baseUrl, 'settings/mutate', {
    ns: 'ui-onboarding',
    ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: 'tauri-bundle-smoke' }],
    expectedRevision: onboarding.revision,
  })
  if (!(await readFile(settingsPath, 'utf8')).includes('tauri-bundle-smoke')) {
    throw new Error('settings RPC did not persist to isolated DSH_HOME')
  }
  try {
    process.kill(Number(detachedPid), 0)
  } catch (error) {
    throw new Error(`PTY descendant ${detachedPid} ended before sidecar shutdown`, { cause: error })
  }

  const exited = new Promise<void>((resolveExit, reject) => {
    sidecarProcess.once('exit', (code) => {
      if (code === 0) resolveExit()
      else reject(new Error(`sidecar exited with ${code}:\n${output}`))
    })
  })
  sidecarProcess.kill('SIGTERM')
  await Promise.race([exited, new Promise<never>((_resolve, reject) => {
    setTimeout(() => { reject(new Error('sidecar ignored SIGTERM')) }, 10_000)
  })])
  const descendantAlive = spawn('kill', ['-0', detachedPid], { stdio: 'ignore' })
  const descendantStatus = await new Promise<number | null>(resolveExit => descendantAlive.once('exit', resolveExit))
  if (descendantStatus === 0) throw new Error(`sidecar teardown left PTY descendant ${detachedPid} alive`)
  console.log('tauri bundle smoke: frontend, authenticated RPC, settings, image, PTY, ripgrep, and graceful cleanup passed')

  if (app !== undefined && macos !== undefined) {
    const desktopExecutable = join(macos, 'dsh-tauri')
    await assertExecutable(desktopExecutable)
    const desktopProcess = spawn(desktopExecutable, [], {
      cwd: world,
      env: cleanEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    desktop = desktopProcess
    const desktopOutcome = observeOutcome(desktopProcess)
    const desktopOutput = captureProcessOutput(desktopProcess)
    desktopProcess.once('error', (error) => { desktopSpawnError = error })
    console.log(`tauri desktop quit smoke: spawned app pid ${String(desktopProcess.pid)}`)
    const host = await waitForDesktopHost(desktopProcess, desktopOutput)
    desktopHostPid = host.pid
    console.log(`tauri desktop quit smoke: host ready appPid=${String(desktopProcess.pid)} childPid=${host.pid} url=${host.url}`)
    await waitForDesktopApplication(desktopProcess, desktopOutput)
    console.log(`tauri desktop quit smoke: native application finished launching appPid=${String(desktopProcess.pid)}`)
    try {
      await requestDesktopQuit(desktopProcess)
    } catch (error) {
      throw new Error(
        `normal Quit request failed; desktop code=${String(desktopProcess.exitCode)}, signal=${String(desktopProcess.signalCode)}:\n${desktopOutput()}`,
        { cause: error },
      )
    }
    const outcome = await Promise.race([
      desktopOutcome,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('desktop app ignored normal Quit')) }, 10_000)
      }),
    ])
    if (outcome.kind === 'error' || outcome.code !== 0 || outcome.signal !== null) {
      throw new Error(`desktop app ${describeOutcome(outcome, desktopOutput())}`)
    }
    await waitForPidExit(host.pid, 'desktop dsh-web child')
    console.log(`tauri desktop quit smoke: app exited and stopped child ${host.pid} from ${host.url}`)
  }
} catch (error) {
  primaryFailure = error
} finally {
  const cleanupFailures: unknown[] = []
  const cleanup = async (action: () => void | Promise<void>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  const sidecarProcess = child
  const desktopProcess = desktop
  const hostPid = desktopHostPid
  const ptyPid = detachedPid
  if (sidecarProcess !== undefined) await cleanup(async () => { await stopChild(sidecarProcess, 'sidecar') })
  if (desktopProcess !== undefined) await cleanup(async () => { await stopChild(desktopProcess, 'desktop app') })
  if (hostPid !== undefined) await cleanup(async () => { await stopPid(hostPid) })
  if (ptyPid !== undefined) await cleanup(() => {
    try {
      process.kill(Number(ptyPid), 'SIGTERM')
    } catch (error) {
      if (!isMissingProcess(error)) throw error
    }
  })
  await cleanup(async () => {
    await new Promise<void>((resolveClose) => { provider.close(() => { resolveClose() }) })
  })
  await cleanup(async () => { await rm(world, { recursive: true, force: true }) })
  if (primaryFailure !== undefined) {
    if (cleanupFailures.length > 0) console.error('tauri smoke cleanup failures:', ...cleanupFailures)
    throw primaryFailure instanceof Error
      ? primaryFailure
      : new Error('tauri smoke failed with a non-Error value', { cause: primaryFailure })
  }
  if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'tauri smoke cleanup failed')
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
