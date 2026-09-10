import { consumePendingReplay, getPendingReplay, isAndroidApp } from './usePlatformBridge.js'

/**
 * 端侧 Replay 导入钩子：把 Native 收到（并已复制到 app cache）的 share/open replay
 * 注入现有 Web 上传管线，并**自动触发解析**。
 *
 * 机制（不再依赖 synthetic input.click()）：Native 经 WebView `shouldInterceptRequest`
 * 以「app-owned 安全 content:// 缓存文件」serve 字节；Web 侧 `fetch(pending.uri)` 读字节构造
 * `File`，再交给 `onPendingFile(file, pending)` → 现存 upload pipeline
 * （`updateFiles` → `startProcessingJob`）。无需 Base64、不取真实路径、不放宽 WebView 安全边界。
 *
 * exactly-once 语义（针对「一个具体 pending replay」）：
 * - **identity-aware**：pending identity 是 Native 提供的 `pendingId`（完整 UUID，不是 URI 字符串）。
 *   ACK 必须携带该 identity，Native 执行 compare-and-clear；identity 缺失的 pending 一律不消费。
 * - 只有 authenticated 时才消费；未登录一律不动 Native pending，登录后重新触发即可。
 * - ACK 边界是「server 已接受该 processing request」：`onPendingFile` 必须 await 并返回
 *   `true` 才调用 Native `consumePendingReplay(pendingId)`；未受理 / 抛错 / 中断都不 ACK，保留 pending 可重试。
 * - `onPendingFile` 必须把 `pendingId` 作为 processing create 的 operationId 传给后端，使
 *   「server 已接受但 ACK 前进程被杀 → 冷启动重新导入」拿回同一个 job（可重放安全）。
 * - 业务已受理后即使 Native ACK 返回 stale（pending 已被更新的 replay 取代），也绝不重复处理这一份；
 *   新 pending 保留待下一轮消费。
 * - `pendingEligible` 只做「当前这次 pending 是否已被受理」，**不把整个 composable lifetime 永久锁死**；
 *   getPendingReplay() 返回 null（本就没 pending）时**绝不清零** eligible，允许稍后 onNewIntent 新增
 *   replay 后 `window.wotbtoolsOnReplay()` 再次消费（warm resume）。
 * - Web 端以 `inflight` 防并发 + `consumedIds`（pendingId）防同一份重复注入。
 *
 * 跨 auth 保留：`window.wotbtoolsOnReplay` 读实际登录态，绝不以 authenticated=true 默认值绕过。
 *
 * @param onPendingFile async (file, pending) => boolean
 *        业务受理结果：`true` = server 已创建 Processing Job（可 ACK Native），否则不得 ACK。
 */
export function useNativeReplayImport({ isAuthenticated = () => false, onPendingFile } = {}) {
  let inflight = false
  const consumedIds = new Set()

  /** 从 Native serve 的 content:// 安全 URI 读取字节并构造 File。 */
  async function readPendingFile(pending) {
    const resp = await fetch(pending.uri)
    if (!resp.ok) throw new Error(`PendingReplay fetch failed: ${resp.status}`)
    const blob = await resp.blob()
    return new File([blob], pending.name || 'replay.wotbreplay', { type: 'application/octet-stream' })
  }

  async function consumePendingWhenReady() {
    if (!isAndroidApp()) return false
    if (!isAuthenticated()) {
      // 未登录：pending 原样留在 Native，登录成功（页面重新挂载）后再消费。
      console.debug('[replay-native] pending deferred reason=unauthenticated')
      return false
    }
    if (inflight) return false
    const pending = await getPendingReplay()
    // 当前没有 pending（可能从未有，也可能 Native 尚未产生）→ 不清零 eligible，留待 warm resume。
    if (!pending) return false
    // 没有 identity 就无法 ACK（也绝不消费）：旧 Native 或畸形 payload 一律跳过。
    if (!pending.pendingId) {
      console.debug('[replay-native] pending skipped reason=missing-identity')
      return false
    }
    // 这份 pending 已在本会话消费并成功注入 → 不再重复（exactly-once for this replay）。
    if (consumedIds.has(pending.pendingId)) return false

    inflight = true
    try {
      const file = await readPendingFile(pending)
      // ACK 顺序：先让业务受理（upload + create processing job），成功后才清 Native pending。
      const accepted = await onPendingFile?.(file, pending)
      if (accepted !== true) return false
      const acked = await consumePendingReplay(pending.pendingId)
      consumedIds.add(pending.pendingId)
      if (!acked) {
        // 正常竞态：处理期间新 replay 已取代它 → 新 pending 保留，绝不被这次 ACK 清掉。
        console.debug('[replay-native] pending ack stale (replaced by newer replay)')
      }
      console.debug('[replay-native] pending accepted')
      return true
    } catch (e) {
      // read/受理失败：不记录 consumed、不 ACK Native，允许下一次 ready 重试。
      console.debug('[replay-native] pending rejected', e?.message || e)
      return false
    } finally {
      inflight = false
    }
  }

  /** 供 Native onNewIntent 回调的全局入口（warm resume 时 Workspace 重新触发导入）。 */
  function registerGlobalHandler() {
    if (typeof window !== 'undefined') {
      window.wotbtoolsOnReplay = () => consumePendingWhenReady()
    }
  }

  registerGlobalHandler()
  return { consumePendingWhenReady, registerGlobalHandler }
}
