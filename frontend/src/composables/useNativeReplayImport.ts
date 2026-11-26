import { readonly, ref } from 'vue'
import {
  consumePendingReplay,
  getNativeBridgeVersion,
  getPendingReplay,
  isAndroidApp,
  isNativeBridgeCompatible,
  type NativePendingReplay,
} from './usePlatformBridge.js'
import { NATIVE_REPLAY_GLOBAL, NATIVE_REPLAY_RESOURCE_URL } from '../platform/nativeBridgeContract.js'

/**
 * 端侧 Replay 导入钩子：把 Native 收到（并已复制到 app cache）的 share/open replay
 * 注入共享本地 replay selection，并**自动触发解析**。
 *
 * 机制（不再依赖 synthetic input.click()）：Native 的本机 LocalRuntimeServer
 * 以固定 same-origin resource stream 私有缓存文件；Web 侧 `fetch(pending.uri)` 读字节构造
 * `File`，再交给 `onPendingFile(file, pending)` → 工作台本机分析
 * （`updateFiles` → `analyze`，服务器没有 parser）。无需 Base64、不取真实路径、不放宽引擎安全边界。
 *
 * exactly-once 语义（针对「一个具体 pending replay」）：
 * - **identity-aware**：pending identity 是 Native 提供的 `pendingId`（完整 UUID，不是 URI 字符串）。
 *   ACK 必须携带该 identity，Native 执行 compare-and-clear；identity 缺失的 pending 一律不消费。
 * - 只有 `isReady` 后才消费（工作台挂载即 ready；分析在本机，不依赖登录状态）。
 * - ACK 边界是「本机分析已完成」：`onPendingFile` 必须 await 并返回 `true` 才调用 Native
 *   `consumePendingReplay(pendingId)`；回放引擎装载失败 / 抛错 / 中断都不 ACK，保留 pending 可重试。
 *   分析完成后 ACK 前进程被杀 → 冷启动会重新分析同一份文件，结果相同（本机分析无副作用，可重放安全）。
 * - 业务已受理后即使 Native ACK 返回 stale（pending 已被更新的 replay 取代），也绝不重复处理这一份；
 *   新 pending 保留待下一轮消费。
 *
 * 单飞 + deferred drain（coalesced rerun）：
 * - 同时最多一个 import 在跑（`inflight`）；但 inflight 期间到达的 Native 通知**绝不丢弃**——
 *   只置 `rerunRequested`，当前 import 结束后立刻再 drain 一次当前 Native pending。
 *   因此「A 处理中 Android 又收到 replay B，Native 只调用一次 `window.wotbtoolsOnReplay()`」的场景里，
 *   A 完成后 B 会自动被处理，不需要用户再打开一次文件、也不需要外部第二次触发。
 * - 多次 inflight 通知 coalesce 成一次 rerun；没有 pending 时 drain 直接结束，不空转。
 * - Web 端以 `consumedIds`（pendingId）防同一份重复注入。
 *
 * Workspace 就绪门槛：`window.wotbtoolsOnReplay` 读实际的 workspace-ready 状态，`isReady` 缺省为 false，绝不默认放行。
 *
 * @param onPendingFile async (file, pending) => boolean
 *        业务受理结果：`true` = 本机分析已完成（可 ACK Native），否则不得 ACK。
 */
export function useNativeReplayImport({ isReady = () => false, onPendingFile, onReadError }: {
  isReady?: () => boolean
  onPendingFile?: (file: File, pending: NativePendingReplay) => boolean | Promise<boolean>
  onReadError?: (reason?: string) => void
} = {}) {
  const inflight = ref(false)
  let rerunRequested = false
  const consumedIds = new Set()

  async function readPendingFile(pending: NativePendingReplay) {
    console.debug('[replay-native] pending stream fetch start')
    const resp = await fetch(pending.uri, {
      headers: { 'X-Wotb-Pending-Id': pending.pendingId },
      cache: 'no-store',
    })
    if (!resp.ok) {
      console.warn(`[replay-native] pending stream fetch failed status=${resp.status}`)
      throw new Error('PendingReplay stream unavailable')
    }
    const blob = await resp.blob()
    const file = new File([blob], pending.name || 'replay.wotbreplay', { type: 'application/octet-stream' })
    console.debug('[replay-native] pending file constructed')
    return file
  }

  async function drainOnce() {
    if (!isAndroidApp()) return false
    if (!isReady()) {
      console.debug('[replay-native] pending deferred reason=workspace-pending')
      return false
    }
    const nativeBridgeVersion = await getNativeBridgeVersion()
    if (!isNativeBridgeCompatible(nativeBridgeVersion)) {
      console.warn('[replay-native] pending skipped reason=bridge-version-mismatch')
      onReadError?.('native-client-upgrade-required')
      return false
    }
    const pending = await getPendingReplay()
    if (!pending) return false
    if (!pending.pendingId || pending.uri !== NATIVE_REPLAY_RESOURCE_URL) {
      console.debug('[replay-native] pending skipped reason=invalid-metadata')
      return false
    }
    if (consumedIds.has(pending.pendingId)) return false
    console.debug('[replay-native] pending discovered')

    let file
    try {
      file = await readPendingFile(pending)
    } catch {
      console.warn('[replay-native] pending stream read failed')
      onReadError?.()
      return false
    }
    try {
      const accepted = await onPendingFile?.(file, pending)
      if (accepted !== true) return false
      console.debug('[replay-native] analysis completed')
      const acked = await consumePendingReplay(pending.pendingId)
      consumedIds.add(pending.pendingId)
      if (!acked) {
        console.debug('[replay-native] pending ack stale (replaced by newer replay)')
      } else {
        console.debug('[replay-native] pending ack success')
      }
      console.debug('[replay-native] pending accepted')
      return true
    } catch {
      console.warn('[replay-native] pending processing or ack failed')
      return false
    }
  }

  async function consumePendingWhenReady() {
    if (inflight.value) {
      rerunRequested = true
      return false
    }
    inflight.value = true
    try {
      let handled = false
      do {
        rerunRequested = false
        if (await drainOnce()) handled = true
      } while (rerunRequested)
      return handled
    } finally {
      inflight.value = false
    }
  }

  function registerGlobalHandler() {
    if (typeof window !== 'undefined') {
      window[NATIVE_REPLAY_GLOBAL] = () => consumePendingWhenReady()
    }
  }

  registerGlobalHandler()
  return { consumePendingWhenReady, registerGlobalHandler, importing: readonly(inflight) }
}
