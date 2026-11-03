import { isAndroidRuntime } from '../platform/runtime.js'
/**
 * 极薄的平台能力探测（origin-scoped）。
 *
 * Android 壳（GeckoView）由内置扩展的 content script 注入 `window.WotbNative`
 * （仅 exact 本机 origin 的 top frame；Native 侧再按 sender 复核）。
 * 普通浏览器 / 非 Android 场景下不存在该对象，所有方法回退到 Web 默认（null / false）。
 *
 * 本模块是异步 RPC（postMessage → reply 'message' 事件），只做能力查询、pending replay 交接
 * 与 native-auth 会话调用，以及 capability-gated 的用户目录选择。
 * 不提供任意路径 readFile / http / execute / launch；目录文件只经固定 Native resource 读取。
 * Vue 业务用 supports() 能力探测。
 *
 * `callBridge` 是**唯一**的 RPC transport（一份实现 / 一份监听注册 / 一个序号计数器），
 * 也被 `platform/androidAuthProvider.ts` 复用；禁止再造第二条通道或轮询。
 */
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

type BridgeCallOptions = { timeoutMs?: number }

/** 请求没有必填字段的方法才能省略 params。 */
type BridgeCallArgs<M extends NativeBridgeMethod> = Record<string, never> extends NativeBridgeRequest<M>
  ? [params?: NativeBridgeRequest<M>, options?: BridgeCallOptions]
  : [params: NativeBridgeRequest<M>, options?: BridgeCallOptions]

const BRIDGE_KEY = 'WotbNative'
const BRIDGE_RPC_TIMEOUT_MS = 5000

let seq = 0

function bridge(): NativeBridgeTransport | null {
  if (typeof window === 'undefined') return null
  return window[BRIDGE_KEY] || null
}

export function isAndroidApp() {
  const b = bridge()
  return isAndroidRuntime() || !!(b && typeof b.postMessage === 'function')
}

/**
 * 单次 RPC：postMessage → 同 id 的 reply 'message' → `data.result`。
 * 无 bridge / 超时一律 resolve `null`（绝不 reject）：调用方按 null 走 fail-closed 分支。
 *
 * `timeoutMs` 允许按方法放宽：native-auth 的 RPC 需要 OIDC discovery / token refresh（网络），
 * 默认 5s 不够；调用方传 `NATIVE_AUTH_TIMEOUT_MS`。其余方法保持默认预算不变。
 */
export function callBridge<M extends NativeBridgeMethod>(method: M, ...args: BridgeCallArgs<M>): Promise<unknown>
export function callBridge(
  method: NativeBridgeMethod,
  params: object = {},
  { timeoutMs = BRIDGE_RPC_TIMEOUT_MS }: BridgeCallOptions = {},
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
    const id = ++seq
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const handler = (e: { data: unknown }) => {
      let data = e.data
      if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch { return }
      }
      if (isRecord(data) && data.id === id) {
        if (typeof b.removeEventListener === 'function') {
          b.removeEventListener('message', handler)
        }
        clearTimeout(timeoutId)
        resolve(data.result)
      }
    }
    b.addEventListener('message', handler)
    try {
      b.postMessage(JSON.stringify({ id, method, params }))
    } catch {
      // postMessage 抛错（页面引擎已销毁 / 桥实现异常）也必须遵守「绝不 reject」的契约：
      // 否则 async 调用方（例如 connectivity 事件 handler）会产生 unhandled rejection。
      if (typeof b.removeEventListener === 'function') {
        b.removeEventListener('message', handler)
      }
      clearTimeout(timeoutId)
      resolve(null)
      return
    }
    timeoutId = setTimeout(() => {
      if (typeof b.removeEventListener === 'function') {
        b.removeEventListener('message', handler)
      }
      resolve(null)
    }, timeoutMs)
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

/** Result: { pendingId, name, size, uri }; uri is the fixed same-origin LocalRuntimeServer resource (NATIVE_REPLAY_RESOURCE_URL). */
export async function getPendingReplay(): Promise<NativePendingReplay | null> {
  const reply = await callBridge('getPendingReplay')
  return isPendingReplay(reply) ? reply : null
}

function isPendingReplay(value: unknown): value is NativePendingReplay {
  return isRecord(value) && isString(value.pendingId) && isString(value.name)
    && isSafeCount(value.size) && isString(value.uri)
}

/**
 * ACK 当前 pending replay —— 必须携带 exact pending identity（`pendingId`）。
 * Native 执行 compare-and-clear：只有 identity 与当前 pending 完全一致才清理；
 * 不传 / 不匹配一律返回 false 且**绝不清掉当前 pending**（避免清掉后来取代它的新 replay）。
 */
export async function consumePendingReplay(expectedPendingId: string) {
  return (await callBridge('consumePendingReplay', { expectedPendingId })) === true
}

export async function checkForUpdate() {
  return (await callBridge('checkForUpdate')) === true
}

export async function startUpdate() {
  return (await callBridge('startUpdate')) === true
}

/** 只读 Native snapshot；输入验证与展示投影归 useAndroidUpdate。 */
export async function getUpdateStatus() {
  return await callBridge(NATIVE_UPDATE_METHODS.getStatus)
}

/** Native fetch 预算为 connect/read 各 3s，给异步回复保留独立的 15s RPC 预算。 */
export async function refreshUpdateStatus() {
  return await callBridge(NATIVE_UPDATE_METHODS.refreshStatus, {}, { timeoutMs: 15_000 })
}

export async function beginUpdateDownload(expectedLatestVersionCode: number) {
  return (await callBridge(NATIVE_UPDATE_METHODS.beginDownload, { expectedLatestVersionCode }, { timeoutMs: 120_000 })) === true
}

export async function installUpdate(expectedTaskToken: string) {
  return (await callBridge(NATIVE_UPDATE_METHODS.install, { expectedTaskToken })) === true
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
