import {
  NATIVE_CONNECTIVITY_CAPABILITY,
  NATIVE_CONNECTIVITY_CHANGED_GLOBAL,
  NATIVE_CONNECTIVITY_METHODS,
} from './nativeBridgeContract.js'
import { callBridge, isAndroidApp } from '../composables/usePlatformBridge.js'

/**
 * Connectivity abstraction —— 平台层的**唯一**连通性事实源。
 *
 * 为什么不是 `navigator.onLine` 一把梭（计划 §4）：
 *  - `navigator.onLine` 只说明「设备认为自己有默认路由」，不说明服务器可达；
 *  - Android WebView 里真正的权威是系统 `ConnectivityManager`（INTERNET + VALIDATED），
 *    由 Native 经 bridge v2 报告，页面不直接监听 Android framework；
 *  - 未来要区分 `degraded` / `service-unavailable` 时，只需要 Native 多报一个 token，
 *    业务代码与 capability 模型都不用改。
 *
 * 因此这里只做两件事：把「当前状态」规范化成一个 token，并在状态变化时通知订阅者。
 * 业务页面**不得**自己监听 `online`/`offline` 事件，也不得自己读 `navigator.onLine`。
 */
export const ConnectivityState = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  /** 以下为预留状态：模型能表达，当前没有生产者（见 normalizeConnectivityState 的 fail-closed 规则）。 */
  DEGRADED: 'degraded',
  SERVICE_UNAVAILABLE: 'service-unavailable',
  UNKNOWN: 'unknown',
})

const KNOWN_STATES = Object.freeze(Object.values(ConnectivityState))

/**
 * 把任意来源的原始值规范化成状态 token。
 *
 * 未知 / 缺失 / 类型不符一律落到 [ConnectivityState.UNKNOWN]（**不是** online）：
 * 连通性判断必须 fail-closed —— 宁可在已知离线时少发一次请求，也不能对着不可达的服务发请求。
 */
export function normalizeConnectivityState(raw) {
  if (typeof raw === 'boolean') return raw ? ConnectivityState.ONLINE : ConnectivityState.OFFLINE
  if (typeof raw !== 'string') return ConnectivityState.UNKNOWN
  const token = raw.trim().toLowerCase()
  return KNOWN_STATES.includes(token) ? token : ConnectivityState.UNKNOWN
}

/** 只有明确的 `online` 才算在线；`degraded` / `unknown` 一律按「不能依赖网络」处理。 */
export function isOnlineState(state) {
  return normalizeConnectivityState(state) === ConnectivityState.ONLINE
}

/**
 * 浏览器来源：`navigator.onLine` + 窗口 online/offline 事件。
 * 只能作为 Web 环境的近似（§4），Android 壳走 bridge 来源。
 */
export function createBrowserConnectivitySource(target = typeof window === 'undefined' ? null : window) {
  const read = () => {
    const nav = target?.navigator
    if (!nav || typeof nav.onLine !== 'boolean') return ConnectivityState.UNKNOWN
    return nav.onLine ? ConnectivityState.ONLINE : ConnectivityState.OFFLINE
  }
  return {
    name: 'browser',
    read,
    subscribe(onChange) {
      if (!target || typeof target.addEventListener !== 'function') return () => {}
      const handler = () => onChange(read())
      target.addEventListener('online', handler)
      target.addEventListener('offline', handler)
      return () => {
        target.removeEventListener('online', handler)
        target.removeEventListener('offline', handler)
      }
    },
  }
}

/**
 * Android 壳来源：bridge v2 的 `connectivityGetState`（系统权威）+ `wotbtoolsOnConnectivityChanged` 推送。
 *
 * 推送不携带 payload：状态一律回读 Native（与 authChanged 同一约定），因此不会出现
 * 「事件说在线、读回来是离线」的双事实源。缺少 bridge / 缺少 `connectivity` 能力时返回
 * UNKNOWN（fail-closed），绝不猜测。
 */
export function createAndroidConnectivitySource(bridgeCapabilities = null) {
  return {
    name: 'android',
    async read() {
      const raw = await callBridge(NATIVE_CONNECTIVITY_METHODS.getState)
      return normalizeConnectivityState(raw)
    },
    subscribe(onChange) {
      if (typeof window === 'undefined') return () => {}
      const handler = async () => {
        onChange(normalizeConnectivityState(await callBridge(NATIVE_CONNECTIVITY_METHODS.getState)))
      }
      window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL] = handler
      return () => {
        if (window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL] === handler) {
          delete window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]
        }
      }
    },
    capabilities: bridgeCapabilities,
  }
}

/**
 * 选择平台来源：Android 壳且声明了 `connectivity` 能力 → Native 权威；否则浏览器近似。
 *
 * 老客户端（bridge v2 但还没有 connectivity 方法）不视为错误：退回浏览器近似，
 * 仍能提供 offline/online 两态，只是权威性较低 —— 这也是 §4 允许的最低要求。
 */
export function selectConnectivitySource({ android = isAndroidApp(), capabilities = null } = {}) {
  if (android && (capabilities === null || capabilities.includes(NATIVE_CONNECTIVITY_CAPABILITY))) {
    return createAndroidConnectivitySource(capabilities)
  }
  return createBrowserConnectivitySource()
}

/**
 * 连通性 store：持有当前状态、去重通知、驱动订阅者。
 *
 * 状态迁移是同步可见的：`setState()` 先更新再通知，因此 capability 门禁在事件回调里
 * 读到的永远是**新**状态（计划 §29「offline → online / online → offline 能力更新」）。
 */
export function createConnectivity({ source = selectConnectivitySource() } = {}) {
  let state = ConnectivityState.UNKNOWN
  let started = false
  let unsubscribe = null
  const listeners = new Set()

  function notify(listener, next) {
    try {
      listener(next)
    } catch {
      // 单个订阅者异常不得影响其它订阅者（UI 崩溃不能拖垮连通性状态机）。
    }
  }

  function setState(next) {
    const normalized = normalizeConnectivityState(next)
    if (normalized === state) return state
    state = normalized
    for (const listener of [...listeners]) notify(listener, state)
    return state
  }

  async function refresh() {
    return setState(await source.read())
  }

  return {
    get state() {
      return state
    },
    isOnline() {
      return isOnlineState(state)
    },
    /** 订阅状态变化，返回退订函数。订阅者会立刻收到一次当前状态（可能是 UNKNOWN）。 */
    subscribe(listener) {
      listeners.add(listener)
      notify(listener, state)
      return () => listeners.delete(listener)
    },
    async start() {
      if (started) return state
      started = true
      unsubscribe = source.subscribe(next => setState(next)) || null
      await refresh()
      return state
    },
    stop() {
      started = false
      if (unsubscribe) unsubscribe()
      unsubscribe = null
    },
    /** 测试 / 原生推送回读入口：显式注入一次状态。 */
    setState,
  }
}
