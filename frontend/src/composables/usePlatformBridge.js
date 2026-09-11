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
import { SUPPORTED_NATIVE_BRIDGE_VERSION } from '../platform/nativeBridgeContract.js'

const BRIDGE_KEY = 'WotbNative'
const BRIDGE_RPC_TIMEOUT_MS = 5000

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
    if (typeof b.addEventListener !== 'function') {
      resolve(null)
      return
    }
    const id = ++seq
    let timeoutId
    const handler = (e) => {
      let data = e.data
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch { return }
      }
      if (data && data.id === id) {
        if (typeof b.removeEventListener === 'function') {
          b.removeEventListener('message', handler)
        }
        clearTimeout(timeoutId)
        resolve(data.result)
      }
    }
    b.addEventListener('message', handler)
    b.postMessage(JSON.stringify({ id, method, params }))
    timeoutId = setTimeout(() => {
      if (typeof b.removeEventListener === 'function') {
        b.removeEventListener('message', handler)
      }
      resolve(null)
    }, BRIDGE_RPC_TIMEOUT_MS)
  })
}

export async function getCapabilities() {
  const c = await call('getCapabilities')
  return Array.isArray(c) ? c : []
}

export async function getNativeBridgeVersion() {
  const version = await call('getBridgeVersion')
  return Number.isInteger(version) ? version : null
}

export function isNativeBridgeCompatible(version) {
  return version === SUPPORTED_NATIVE_BRIDGE_VERSION
}

export async function supports(capability) {
  return (await getCapabilities()).includes(capability)
}

/** Result: { pendingId, name, size, uri }; uri is a fixed same-origin HTTPS Native resource. */
export async function getPendingReplay() {
  return await call('getPendingReplay')
}

/**
 * ACK 当前 pending replay —— 必须携带 exact pending identity（`pendingId`）。
 * Native 执行 compare-and-clear：只有 identity 与当前 pending 完全一致才清理；
 * 不传 / 不匹配一律返回 false 且**绝不清掉当前 pending**（避免清掉后来取代它的新 replay）。
 */
export async function consumePendingReplay(expectedPendingId) {
  return (await call('consumePendingReplay', { expectedPendingId })) === true
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
    getNativeBridgeVersion,
    isNativeBridgeCompatible,
    supports,
    getPendingReplay,
    consumePendingReplay,
    checkForUpdate,
    startUpdate,
  }
}
