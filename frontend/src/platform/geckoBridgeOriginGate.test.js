import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * content script 的第一道门必须是 **exact local origin**：`http://127.0.0.1:21653` 的 top frame。
 *
 * 这里直接在 Node 里执行真实的 `bridge.js`（用一个最小的 `window` / `location` / `browser` /
 * `cloneInto` 替身），因此断言的是行为而不是源码文本：只有 exact origin 才会 `connectNative` 并
 * 暴露 `window.WotbNative`。任何只比对 hostname（漏掉 port）的实现都会在这些用例上失败——
 * `http://127.0.0.1/`、`http://127.0.0.1:21654/` 之类必须被拒绝。
 */
const BRIDGE = new URL('../../../android/app/src/main/assets/gecko-bridge/bridge.js', import.meta.url)
const MANIFEST = new URL('../../../android/app/src/main/assets/gecko-bridge/manifest.json', import.meta.url)
const source = readFileSync(BRIDGE, 'utf8')

/** 用真实 location 形态（protocol / hostname / port，默认端口为空串）执行一次 bridge.js。 */
function runBridge(url, { topFrame = true } = {}) {
  const parsed = new URL(url)
  const location = { protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port }
  const page = {}
  const window = { wrappedJSObject: page }
  window.top = topFrame ? window : {}
  let connects = 0
  const browser = {
    runtime: {
      connectNative() {
        connects += 1
        return { postMessage() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }
      },
    },
  }
  const cloneInto = (value) => value
  new Function('window', 'location', 'browser', 'cloneInto', source)(window, location, browser, cloneInto)
  return { bridge: page.WotbNative, connects }
}

const TRUSTED = [
  'http://127.0.0.1:21653/',
  'http://127.0.0.1:21653', // 同一 origin，路径为空
  'http://127.0.0.1:21653/index.html',
  'http://127.0.0.1:21653/index.html?view=replay',
]
const REJECTED = [
  'http://127.0.0.1/', // 默认端口 80
  'http://127.0.0.1:80/',
  'http://127.0.0.1:21654/',
  'http://127.0.0.1:9999/',
  'http://127.0.0.1:0/',
  'http://127.0.0.1.evil:21653/',
  'http://localhost:21653/',
  'http://127.0.0.2:21653/',
  'http://[::1]:21653/',
  'https://127.0.0.1:21653/',
  'http://evil.example/',
  'file:///index.html',
]

describe('GeckoView bridge content-script origin gate', () => {
  it('exposes window.WotbNative only for the exact local origin', () => {
    for (const url of TRUSTED) {
      const { bridge, connects } = runBridge(url)
      expect(bridge, url).toBeTypeOf('object')
      expect(connects, url).toBe(1)
    }
  })

  it('never even connects for any other origin (missing / different / wrong-scheme port)', () => {
    for (const url of REJECTED) {
      const { bridge, connects } = runBridge(url)
      expect(bridge, url).toBeUndefined()
      expect(connects, url).toBe(0)
    }
  })

  it('rejects the exact origin when it is not the top frame', () => {
    const { bridge, connects } = runBridge('http://127.0.0.1:21653/index.html', { topFrame: false })
    expect(bridge).toBeUndefined()
    expect(connects).toBe(0)
  })

  it('checks protocol, hostname and port explicitly and pins the local port literal', () => {
    expect(source).toContain('window !== window.top')
    expect(source).toContain('loc.protocol === "http:"')
    expect(source).toContain('loc.hostname === "127.0.0.1"')
    expect(source).toContain('loc.port === "21653"')
  })

  /**
   * Firefox 的 WebExtension match pattern 不支持 port（MDN match patterns；bug 1362809 / 1468162），
   * 写成 `http://127.0.0.1:21653/*` 是无效 pattern。因此 manifest 保持粗 host 匹配，port 由
   * bridge.js + Native sender 校验执行；这里钉住这个分工，防止有人写回无效的 port pattern。
   */
  it('keeps the coarse host match pattern because Gecko cannot match a port', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches)
    expect(matches).toEqual(['http://127.0.0.1/*'])
    for (const pattern of matches) expect(pattern.replace(/^[a-z*]+:\/\//, '')).not.toContain(':')
    expect(manifest.content_scripts.every((entry) => entry.all_frames === false)).toBe(true)
  })
})
