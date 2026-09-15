/** Exercise the packaged macOS sidecar through its shipped HTTP, image, and PTY paths. */
import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

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
const resources = app === undefined ? undefined : join(app, 'Contents', 'Resources')
const sidecar = macos === undefined ? undefined : join(macos, 'dsh-web')
const spawnHelper = macos === undefined ? undefined : join(macos, 'dsh-web-spawn-helper')

async function findDirectory(root: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory() && entry.name === name) return path
    if (entry.isDirectory()) {
      const found = await findDirectory(path, name)
      if (found !== undefined) return found
    }
  }
  return undefined
}

async function assertExecutable(path: string): Promise<void> {
  await access(path)
  if (((await stat(path)).mode & 0o111) === 0) throw new Error(`${path} is not executable`)
}

let sharpLibs: string | undefined
if (app !== undefined && macos !== undefined && resources !== undefined && sidecar !== undefined && spawnHelper !== undefined) {
  await assertExecutable(sidecar)
  await assertExecutable(spawnHelper)
  sharpLibs = await findDirectory(resources, 'sharp-libs')
  if (sharpLibs === undefined || (await readdir(sharpLibs)).length === 0) {
    throw new Error(`${resources} has no populated sharp-libs directory`)
  }
  console.log(`tauri bundle inventory: ${basename(sidecar)}, ${basename(spawnHelper)}, ${sharpLibs}`)
}
if (values['inventory-only']) process.exit(0)
if (app !== undefined && process.platform !== 'darwin') {
  throw new Error('native bundle smoke requires macOS; use --inventory-only elsewhere')
}

interface ProviderRequest {
  max_tokens?: number
  messages?: Array<{ role?: string; content?: unknown }>
}

const provider = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    const bytes = Buffer.concat(chunks)
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'POST' && requestUrl.pathname === '/files') {
      providerState.observedImage = bytes.includes(Buffer.from('smoke.png')) && bytes.length > 100
      const createdAt = Math.floor(Date.now() / 1_000)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'tauri-smoke-image', object: 'file', bytes: bytes.length, created_at: createdAt,
        filename: 'smoke.png', purpose: 'user_data', expires_at: createdAt + 3600,
      }))
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/files') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [], has_more: false }))
      return
    }
    const body = JSON.parse(bytes.toString('utf8')) as ProviderRequest
    const toolCompleted = body.messages?.some(message => message.role === 'tool') === true
    const serializedMessages = JSON.stringify(body.messages)
    const isSmokeRound = serializedMessages.includes('TAURI_BUNDLE_SMOKE')
    if (isSmokeRound && (serializedMessages.includes('"type":"file"') || serializedMessages.includes('image_url'))) {
      providerState.observedImage = true
    }
    const payloads: unknown[] = isSmokeRound && !toolCompleted
      ? [
        { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tauri-smoke-call', type: 'function', function: {
          name: 'bash', arguments: JSON.stringify({ command: 'sleep 60 & echo TAURI_PTY_OK:$!' }),
        } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
      ]
      : [
        { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] },
        { choices: [{ delta: { content: isSmokeRound ? 'TAURI_ROUND_DONE' : 'Tauri smoke title' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
      ]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end([...payloads.map(payload => JSON.stringify(payload)), '[DONE]']
      .map(event => `data: ${event}\n\n`).join(''))
  })
})
const providerState = { observedImage: false }
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

async function prepareSourcePreset(): Promise<string> {
  if (!values['source-cli']) return 'minimal'
  const shellPath = await findOnPath('bash')
  const sourceDir = join(repoRoot, 'apps/cli/config/agent-presets/minimal')
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
    ...(sharpLibs === undefined ? {} : { DYLD_LIBRARY_PATH: sharpLibs }),
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

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const endpoint = new URL(`/api/${method}`, baseUrl)
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `tauri-${method}`, method, payload }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}: ${text}`)
  const body = JSON.parse(text) as { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }
  if (!body.result.ok) throw new Error(`${method}: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
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
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      captured.kill('SIGKILL')
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    captured.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`failed to start ${command}`, { cause: error }))
    })
    captured.once('exit', (exitCode) => {
      clearTimeout(timer)
      resolveExit(exitCode)
    })
  })
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${code}: ${Buffer.concat(chunks).toString('utf8')}`)
  return Buffer.concat(chunks).toString('utf8')
}

async function waitForDesktopHost(appProcess: ChildProcess): Promise<{ pid: number; url: string }> {
  if (appProcess.pid === undefined) throw new Error('desktop app has no pid')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (desktopSpawnError !== undefined) throw new Error('failed to start desktop app', { cause: desktopSpawnError })
    if (appProcess.exitCode !== null) throw new Error(`desktop app exited during startup (${appProcess.exitCode})`)
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
        if ((await fetchWithTimeout(url).catch(() => undefined))?.ok === true) return { pid, url }
      }
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new Error('desktop app did not start a listening dsh-web child')
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
  const frontend = await fetchWithTimeout(baseUrl)
  if (!frontend.ok || !(await frontend.text()).includes('<div id="root"')) {
    throw new Error(`bundled frontend was not served from ${baseUrl}`)
  }
  await rpc(baseUrl, 'host.describe', {})
  const created = await rpc<{ sessionId: string }>(baseUrl, 'session.create', { agentPreset })
  await rpc(baseUrl, 'session.selectModel', {
    sessionId: created.sessionId,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash-vision-exp',
  })
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  await rpc(baseUrl, 'session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [
      { type: 'text', text: 'TAURI_BUNDLE_SMOKE' },
      { type: 'image', mediaType: 'image/png', data: png, name: 'smoke.png' },
    ],
  })
  let completed = false
  let durableImageObserved = false
  let lastHistory = ''
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const history = await rpc<{ events: Array<{ event: { type: string; data: unknown } }> }>(
      baseUrl, 'session.history', { sessionId: created.sessionId, maxMessages: 20 },
    )
    const serialized = JSON.stringify(history)
    lastHistory = serialized
    if (serialized.includes('"type":"tool/result"') && serialized.includes('"isError":true')) {
      throw new Error(`persistent PTY returned an error result; history=${serialized}`)
    }
    detachedPid = /TAURI_PTY_OK:(\d+)/.exec(serialized)?.[1]
    durableImageObserved = serialized.includes('"mediaType":"image/png"')
      && serialized.includes('"width":1') && serialized.includes('"height":1')
    completed = detachedPid !== undefined && durableImageObserved
      && serialized.includes('TAURI_ROUND_DONE') && serialized.includes('turn/end')
    if (completed) break
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  if (!completed || detachedPid === undefined) {
    throw new Error(`persistent PTY/model turn did not complete; history=${lastHistory}; host=${output}`)
  }
  if (!providerState.observedImage) throw new Error('provider did not receive the sharp-processed image')
  if (!durableImageObserved) throw new Error('session history did not retain normalized image metadata')
  try {
    process.kill(Number(detachedPid), 0)
  } catch (error) {
    throw new Error(`PTY descendant ${detachedPid} exited before the shutdown probe`, { cause: error })
  }
  const settingsPath = join(world, 'dsh-home', 'settings.yaml')
  await rpc(baseUrl, 'settings.mutate', {
    ns: 'ui-onboarding',
    ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: 'tauri-bundle-smoke' }],
  })
  if (!(await readFile(settingsPath, 'utf8')).includes('tauri-bundle-smoke')) {
    throw new Error('settings RPC did not persist to isolated DSH_HOME')
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
  console.log('tauri bundle smoke: frontend, RPC, settings, sharp, PTY, and graceful descendant cleanup passed')

  if (app !== undefined && macos !== undefined) {
    const desktopExecutable = join(macos, 'dsh-tauri')
    await assertExecutable(desktopExecutable)
    const desktopProcess = spawn(desktopExecutable, [], {
      cwd: world,
      env: cleanEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    desktop = desktopProcess
    desktopProcess.once('error', (error) => { desktopSpawnError = error })
    desktopProcess.stdout.resume()
    desktopProcess.stderr.resume()
    const host = await waitForDesktopHost(desktopProcess)
    desktopHostPid = host.pid
    const desktopExited = desktopProcess.exitCode !== null
      ? Promise.reject(new Error(`desktop app exited with ${desktopProcess.exitCode}`))
      : new Promise<void>((resolveExit, reject) => {
        desktopProcess.once('error', (error) => {
          reject(new Error('desktop app failed after startup', { cause: error }))
        })
        desktopProcess.once('exit', (code) => {
          if (code === 0) resolveExit()
          else reject(new Error(`desktop app exited with ${code}`))
        })
      })
    await capture('osascript', ['-e', 'tell application id "ai.deepseek.harness" to quit'])
    await Promise.race([
      desktopExited,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('desktop app ignored normal Quit')) }, 10_000)
      }),
    ])
    await waitForPidExit(host.pid, 'desktop dsh-web child')
    console.log(`tauri desktop quit smoke: app exited and stopped child ${host.pid} from ${host.url}`)
  }
} finally {
  if (child !== undefined) await stopChild(child, 'sidecar')
  if (desktop !== undefined) await stopChild(desktop, 'desktop app')
  if (desktopHostPid !== undefined) await stopPid(desktopHostPid)
  if (detachedPid !== undefined) {
    try {
      process.kill(Number(detachedPid), 'SIGTERM')
    } catch (error) {
      if (!isMissingProcess(error)) throw error
    }
  }
  await new Promise<void>((resolveClose) => { provider.close(() => { resolveClose() }) })
  await rm(world, { recursive: true, force: true })
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
