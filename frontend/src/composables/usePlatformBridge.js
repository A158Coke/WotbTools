/**
 * 极薄的平台能力探测（origin-scoped）。
 *
 * Android WebView 壳经 AndroidX WebKit WebMessageListener 注入 `window.WotbNative`
 * （仅 `https://wotbtools.com` / `https://www.wotbtools.com` 可调，见 android/.../MainActivity.kt）。
 * 普通浏览器 / 非 Android 场景下不存在该对象，所有方法回退到 Web 默认（null / false）。
 *
 * 本模块是异步 RPC（postMessage → reply 'message' 事件），只做能力查询与 pending replay 交接，
 * 绝不借此调用任何系统能力（readFile / http / execute / launch）。Vue 业务用 supports() 能力探测。
 */
const BRIDGE_KEY = 'WotbNative'

let seq = 0

function bridge() {
  if (typeof window === 'undefined') return null
  return window[BRIDGE_KEY] || null
}

export function isAndroidApp() {
  const b = bridge()
  return !!(b && typeof b.postMessage === 'function')
}

function call(method, params = {}) {
  return new Promise(resolve => {
    const b = bridge()
    if (!b || typeof b.postMessage !== 'function') {
      resolve(null)
      return
    }
    const id = ++seq
    const handler = (e) => {
      let data = e.data
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch { return }
      }
      if (data && data.id === id) {
        if (typeof b.removeEventListener === 'function') {
          b.removeEventListener('message', handler)
        }
        resolve(data.result)
      }
    }
    b.addEventListener('message', handler)
    b.postMessage(JSON.stringify({ id, method, params }))
  })
}

export async function getCapabilities() {
  const c = await call('getCapabilities')
  return Array.isArray(c) ? c : []
}

export async function supports(capability) {
  return (await getCapabilities()).includes(capability)
}

export async function getPendingReplay() {
  return await call('getPendingReplay')
}

export async function consumePendingReplay() {
  return (await call('consumePendingReplay')) === true
}

export async function checkForUpdate() {
  return (await call('checkForUpdate')) === true
}

export async function startUpdate() {
  return (await call('startUpdate')) === true
}

export function usePlatformBridge() {
  return {
    isAndroidApp,
    getCapabilities,
    supports,
    getPendingReplay,
    consumePendingReplay,
    checkForUpdate,
    startUpdate,
  }
}
