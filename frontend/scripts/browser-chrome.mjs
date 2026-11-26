import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WINDOWS_INSTALLS = [
  ['PROGRAMFILES', 'Google/Chrome/Application/chrome.exe'],
  ['PROGRAMFILES(X86)', 'Google/Chrome/Application/chrome.exe'],
  ['LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe'],
  ['PROGRAMFILES', 'Microsoft/Edge/Application/msedge.exe'],
  ['PROGRAMFILES(X86)', 'Microsoft/Edge/Application/msedge.exe'],
]

function chromeCandidates() {
  const candidates = []
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN)
  if (process.platform === 'win32') {
    for (const [envKey, suffix] of WINDOWS_INSTALLS) {
      const base = process.env[envKey]
      if (base) candidates.push(join(base, suffix))
    }
  }
  candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser')
  return candidates
}

export function findChrome() {
  const candidates = chromeCandidates()
  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate
      continue
    }
    if (spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0) return candidate
  }
  throw new Error(`Chrome/Chromium executable not found; tried: ${candidates.join(', ')}`)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
    socket.addEventListener('close', () => {
      this.closed = true
      for (const entry of this.pending.values()) entry.reject(new Error(`CDP websocket closed during ${entry.method}`))
      this.pending.clear()
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id != null) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
        else entry.resolve(message.result)
        return
      }
      for (const handler of this.listeners.get(message.method) || []) handler(message.params, message.sessionId)
    })
  }

  static connect(webSocketDebuggerUrl) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl)
      socket.addEventListener('open', () => resolve(new CdpClient(socket)), { once: true })
      socket.addEventListener('error', () => reject(new Error(`CDP websocket failed: ${webSocketDebuggerUrl}`)), { once: true })
    })
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error(`CDP websocket closed before ${method}`))
    const id = this.nextId++
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify(payload))
    })
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(handler)
  }

  dispose() {
    try { this.socket.close() } catch { /* already closed */ }
  }
}

export async function launchChromeForCdp(chrome, { extraArgs = [], gpu = false } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'wotb-cdp-'))
  let child
  let stderr = ''
  let spawnError = null
  let client = null
  const stderrLimit = 16 * 1024
  const portFile = join(userDataDir, 'DevToolsActivePort')
  let portState = 'missing'
  const cleanup = async (failed = false) => {
    if (child?.pid && (failed || (child.exitCode == null && child.signalCode == null))) {
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        else process.kill(-child.pid, 'SIGTERM')
      } catch { try { child.kill('SIGTERM') } catch { /* already gone */ } }
      for (let i = 0; i < 40 && child.exitCode == null && child.signalCode == null; i++) await delay(50)
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
        else if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      } catch { /* already gone */ }
    }
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* best effort */ }
  }
  try {
    child = spawn(chrome, [
      '--headless=new',
      '--no-sandbox',
      ...(gpu ? ['--ignore-gpu-blocklist'] : ['--disable-gpu', '--enable-unsafe-swiftshader']),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--mute-audio',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' })
    child.on('error', error => { spawnError = error })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-stderrLimit) })
    const deadline = Date.now() + 30_000
    let port = 0
    while (!port) {
      if (spawnError) throw new Error(`Chrome spawn failed: ${spawnError.code || spawnError.name}`)
      if (child.signalCode || (child.exitCode != null && child.exitCode !== 0)) {
        throw new Error(`Chrome exited before publishing DevToolsActivePort (code=${child.exitCode})`)
      }
      if (Date.now() > deadline) throw new Error('Chrome did not publish DevToolsActivePort within 30s')
      if (existsSync(portFile)) {
        try {
          portState = 'present-invalid'
          port = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim()) || 0
          if (port) portState = 'present-valid'
        } catch (error) {
          if (error.code !== 'EBUSY' && error.code !== 'EPERM' && error.code !== 'ENOENT') throw error
          portState = `unreadable:${error.code}`
          port = 0
        }
      }
      if (!port) await delay(50)
    }

    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    client = await CdpClient.connect(version.webSocketDebuggerUrl)

    return {
      client,
      async openPage() {
        const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
        const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
        return { targetId, sessionId }
      },
      async close() {
        try { await client.send('Browser.close') } catch { /* best effort */ }
        client.dispose()
        for (let i = 0; i < 60 && child.exitCode == null && child.signalCode == null; i++) await delay(50)
        await cleanup()
      },
    }
  } catch (error) {
    client?.dispose()
    const safeStderr = stderr.replaceAll(userDataDir, '<profile>').replace(/https?:\/\/[^\s]+/gi, '<url>')
      .replace(/((?:token|password|secret|authorization|api[_-]?key)\s*[=:]\s*)[^\s]+/gi, '$1<redacted>')
    const details = `exitCode=${child?.exitCode ?? 'null'} signal=${child?.signalCode ?? 'null'} profile=${existsSync(userDataDir) ? 'present' : 'missing'} portFile=${portState}`
    await cleanup(true)
    throw new Error(`${error.message}; ${details}; stderr (last ${stderrLimit} chars): ${safeStderr || '<empty>'}`)
  }
}
