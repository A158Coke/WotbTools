import { isAndroidRuntime } from '../platform/runtime.js'
import {
  NATIVE_UPDATE_METHODS,
  SUPPORTED_NATIVE_BRIDGE_VERSIONS,
} from '../platform/nativeBridgeContract.js'
import { isRecord, isSafeCount, isString } from '../types/primitive-guards.js'
import type {
  NativeBridgeMethod,
  NativeBridgeRequest,
  NativeBridgeResponse,
} from '../api/generated/android-native-bridge.js'

export type NativePendingReplay = NonNullable<NativeBridgeResponse<'getPendingReplay'>>

type BridgeCallOptions = { timeoutMs?: number, onTimeout?: () => void, signal?: AbortSignal }

type BridgeCallArgs<M extends NativeBridgeMethod> = Record<string, never> extends NativeBridgeRequest<M>
  ? [params?: NativeBridgeRequest<M>, options?: BridgeCallOptions]
  : [params: NativeBridgeRequest<M>, options?: BridgeCallOptions]

const BRIDGE_KEY = 'WotbNative'
const BRIDGE_RPC_TIMEOUT_MS = 5000
const INSTALL_UPDATE_RPC_TIMEOUT_MS = 120_000

let seq = 0

function bridge(): NativeBridgeTransport | null {
  if (typeof window === 'undefined') return null
  return window[BRIDGE_KEY] || null
}

export function isAndroidApp() {
  const b = bridge()
  return isAndroidRuntime() || !!(b && typeof b.postMessage === 'function')
}

export function callBridge<M extends NativeBridgeMethod>(method: M, ...args: BridgeCallArgs<M>): Promise<unknown>
export function callBridge(
  method: NativeBridgeMethod,
  params: object = {},
  { timeoutMs = BRIDGE_RPC_TIMEOUT_MS, onTimeout, signal }: BridgeCallOptions = {},
): Promise<unknown> {
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
    if (signal?.aborted) { resolve(null); return }
    const id = ++seq
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    function cleanup() {
      b?.removeEventListener?.('message', handler)
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abort)
    }
    function abort() { cleanup(); resolve(null) }
    const handler = (e: { data: unknown }) => {
      let data = e.data
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch { return }
      }
      if (isRecord(data) && data.id === id) {
        cleanup()
        resolve(data.result)
      }
    }
    b.addEventListener('message', handler)
    signal?.addEventListener('abort', abort, { once: true })
    timeoutId = setTimeout(() => {
      if (onTimeout) { onTimeout(); return }
      cleanup()
      resolve(null)
    }, timeoutMs)
    try {
      b.postMessage(JSON.stringify({ id, method, params }))
    } catch {
      cleanup()
      resolve(null)
    }
  })
}

export async function getCapabilities(): Promise<string[]> {
  const c = await callBridge('getCapabilities')
  return Array.isArray(c) && c.every(isString) ? c : []
}

export async function getNativeBridgeVersion(): Promise<number | null> {
  const version = await callBridge('getBridgeVersion')
  return typeof version === 'number' && Number.isInteger(version) ? version : null
}

export function isNativeBridgeCompatible(version: number | null | undefined) {
  return version != null && SUPPORTED_NATIVE_BRIDGE_VERSIONS.includes(version)
}

export async function supports(capability: string) {
  return (await getCapabilities()).includes(capability)
}

export async function getPendingReplay(): Promise<NativePendingReplay | null> {
  const reply = await callBridge('getPendingReplay')
  return isPendingReplay(reply) ? reply : null
}

function isPendingReplay(value: unknown): value is NativePendingReplay {
  return isRecord(value) && isString(value.pendingId) && isString(value.name)
    && isSafeCount(value.size) && isString(value.uri)
}

export async function consumePendingReplay(expectedPendingId: string) {
  return (await callBridge('consumePendingReplay', { expectedPendingId })) === true
}

export async function checkForUpdate() {
  return (await callBridge('checkForUpdate')) === true
}

export async function startUpdate() {
  return (await callBridge('startUpdate')) === true
}

export async function getUpdateStatus() {
  return await callBridge(NATIVE_UPDATE_METHODS.getStatus)
}

export async function refreshUpdateStatus() {
  return await callBridge(NATIVE_UPDATE_METHODS.refreshStatus, {}, { timeoutMs: 15_000 })
}

export async function beginUpdateDownload(expectedLatestVersionCode: number) {
  return (await callBridge(NATIVE_UPDATE_METHODS.beginDownload, { expectedLatestVersionCode }, { timeoutMs: 120_000 })) === true
}

export async function installUpdate(expectedTaskToken: string, onTimeout: () => void = () => {}, signal?: AbortSignal) {
  const transport = bridge()
  if (!transport || typeof transport.postMessage !== 'function' || typeof transport.addEventListener !== 'function') {
    throw new Error('Native bridge unavailable')
  }
  const result = await callBridge(NATIVE_UPDATE_METHODS.install, { expectedTaskToken }, { timeoutMs: INSTALL_UPDATE_RPC_TIMEOUT_MS, onTimeout, signal })
  return typeof result === 'boolean' ? result : null
}

export async function dismissOptionalUpdate(expectedLatestVersionCode: number) {
  return (await callBridge(NATIVE_UPDATE_METHODS.dismiss, { expectedLatestVersionCode })) === true
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
    getUpdateStatus,
    refreshUpdateStatus,
    beginUpdateDownload,
    installUpdate,
    dismissOptionalUpdate,
  }
}
