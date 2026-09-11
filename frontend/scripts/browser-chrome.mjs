import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Windows 安装路径（Chrome 优先，Edge 作为 Chromium 后备）。 */
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

/**
 * Chrome/Chromium 可执行文件发现。
 *
 * Windows 上 Chrome 已在运行时 `<exe> --version` 会被转发给既有会话（打印
 * "Opening in existing browser session"）而不是真的报告版本，因此绝对路径只做存在性检查，
 * 只有命令名才用 `--version` 退出码做探针。
 */
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

/** 极简 CDP 客户端：浏览器级 endpoint + flatten session 复用同一条 WebSocket。 */
class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
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

/**
 * 启动一个**独立的** Chrome 实例并连上 CDP。
 *
 * `--user-data-dir` 必须显式指定：否则 Chrome 会把命令转发给用户已开着的实例，测试就
 * 跑在真实浏览器会话里（可能带扩展/已登录态），完全不可复现。
 */
export async function launchChromeForCdp(chrome, { extraArgs = [] } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'wotb-cdp-'))
  const child = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
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
  ], { stdio: 'ignore' })

  const portFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + 30_000
  let port = 0
  while (!port) {
    if (child.exitCode != null) throw new Error(`Chrome exited before publishing DevToolsActivePort (code=${child.exitCode})`)
    if (Date.now() > deadline) throw new Error('Chrome did not publish DevToolsActivePort within 30s')
    // 文件出现 ≠ 写完：读到空/半行时继续等，避免把 NaN 递给 fetch。
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0].trim()) || 0
    if (!port) await delay(50)
  }

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const client = await CdpClient.connect(version.webSocketDebuggerUrl)

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
      for (let i = 0; i < 60 && child.exitCode == null; i++) await delay(50)
      try { child.kill() } catch { /* already gone */ }
      try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* profile cleanup is best effort */ }
    },
  }
}
