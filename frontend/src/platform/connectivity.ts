import {
  NATIVE_CONNECTIVITY_CAPABILITY,
  NATIVE_CONNECTIVITY_CHANGED_GLOBAL,
  NATIVE_CONNECTIVITY_METHODS,
} from './nativeBridgeContract.js'
import { callBridge, isAndroidApp } from '../composables/usePlatformBridge.js'

export const ConnectivityState = Object.freeze({
  ONLINE: 'online',
  OFFLINE: 'offline',
  DEGRADED: 'degraded',
  SERVICE_UNAVAILABLE: 'service-unavailable',
  UNKNOWN: 'unknown',
})

export type ConnectivityStateValue = (typeof ConnectivityState)[keyof typeof ConnectivityState]

export interface ConnectivitySource {
  name: string
  read(): ConnectivityStateValue | Promise<ConnectivityStateValue>
  subscribe(onChange: (next: ConnectivityStateValue) => void): (() => void) | void
  capabilities?: string[] | null
}

const KNOWN_STATES: readonly string[] = Object.freeze(Object.values(ConnectivityState))

function isKnownState(token: string): token is ConnectivityStateValue {
  return KNOWN_STATES.includes(token)
}

export function normalizeConnectivityState(raw: unknown): ConnectivityStateValue {
  if (typeof raw === 'boolean') return raw ? ConnectivityState.ONLINE : ConnectivityState.OFFLINE
  if (typeof raw !== 'string') return ConnectivityState.UNKNOWN
  const token = raw.trim().toLowerCase()
  return isKnownState(token) ? token : ConnectivityState.UNKNOWN
}

export function isOnlineState(state: unknown) {
  return normalizeConnectivityState(state) === ConnectivityState.ONLINE
}

export function createBrowserConnectivitySource(
  target: Window | null = typeof window === 'undefined' ? null : window,
): ConnectivitySource {
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

export function createAndroidConnectivitySource(bridgeCapabilities: string[] | null = null): ConnectivitySource {
  return {
    name: 'android',
    async read() {
      const raw = await callBridge(NATIVE_CONNECTIVITY_METHODS.getState)
      return normalizeConnectivityState(raw)
    },
    subscribe(onChange) {
      if (typeof window === 'undefined') return () => {}
      const handler = async () => {
        let raw = null
        try {
          raw = await callBridge(NATIVE_CONNECTIVITY_METHODS.getState)
        } catch {
          raw = null
        }
        onChange(normalizeConnectivityState(raw))
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

export function selectConnectivitySource(
  { android = isAndroidApp(), capabilities = null }: { android?: boolean; capabilities?: string[] | null } = {},
) {
  if (android && (capabilities === null || capabilities.includes(NATIVE_CONNECTIVITY_CAPABILITY))) {
    return createAndroidConnectivitySource(capabilities)
  }
  return createBrowserConnectivitySource()
}

type ConnectivityListener = (next: ConnectivityStateValue) => void

export function createConnectivity({ source = selectConnectivitySource() }: { source?: ConnectivitySource } = {}) {
  let state: ConnectivityStateValue = ConnectivityState.UNKNOWN
  let started = false
  let unsubscribe: (() => void) | null = null
  const listeners = new Set<ConnectivityListener>()

  function notify(listener: ConnectivityListener, next: ConnectivityStateValue) {
    try {
      listener(next)
    } catch {
      // 单个订阅者异常不得影响其它订阅者（UI 崩溃不能拖垮连通性状态机）。
    }
  }

  function setState(next: unknown) {
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
    subscribe(listener: ConnectivityListener) {
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
    setState,
  }
}
