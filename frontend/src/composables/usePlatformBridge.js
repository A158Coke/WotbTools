/**
 * 极薄的平台能力探测。
 *
 * Android WebView 壳通过 addJavascriptInterface 注入 `window.WotbNative`
 * （见 android/.../NativeBridge.kt，Phase 4 实现）。普通浏览器 / 非 Android 场景下
 * 不存在该对象，所有方法回退到 Web 默认（null / false）。
 *
 * 本模块只做能力查询与 pending replay 交接，绝不借此调用任何系统能力
 * （readFile / http / execute / launch）。Vue 业务不使用「if Android then blindly call」，
 * 而是用 supports() 能力探测（规格 §25–§27）。
 */
const BRIDGE_KEY = 'WotbNative'

function bridge() {
  if (typeof window === 'undefined') return null
  return window[BRIDGE_KEY] || null
}

function parse(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return fallback }
}

export function isAndroidApp() {
  return !!bridge()
}

export function getCapabilities() {
  const b = bridge()
  if (!b || typeof b.getCapabilities !== 'function') return []
  return parse(b.getCapabilities(), []) || []
}

export function supports(capability) {
  return getCapabilities().includes(capability)
}

export function getPendingReplay() {
  const b = bridge()
  if (!b || typeof b.getPendingReplay !== 'function') return null
  return parse(b.getPendingReplay(), null)
}

export function consumePendingReplay() {
  const b = bridge()
  if (!b || typeof b.consumePendingReplay !== 'function') return false
  return b.consumePendingReplay() === true
}

export function checkForUpdate() {
  const b = bridge()
  if (!b || typeof b.checkForUpdate !== 'function') return false
  return b.checkForUpdate()
}

export function startUpdate() {
  const b = bridge()
  if (!b || typeof b.startUpdate !== 'function') return false
  return b.startUpdate()
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
