import { consumePendingReplay, getPendingReplay, isAndroidApp } from './usePlatformBridge.js'

/**
 * 端侧 Replay 导入钩子：把 Native 收到（并已复制到 app cache）的 share/open replay
 * 注入现有 Web 上传管线，并**自动触发解析**。
 *
 * 机制（不再依赖 synthetic input.click()）：Native 经 WebView `shouldInterceptRequest`
 * 以「app-owned 安全 content:// 缓存文件」serve 字节；Web 侧 `fetch(pending.uri)` 读字节构造
 * `File`，再交给 `onPendingFile(file)` → 现存 upload pipeline（`updateFiles` → `startProcessingJob`）。
 * 无需 Base64、不取真实路径、不放宽 WebView 安全边界。
 *
 * exactly-once 语义（针对「一个具体 pending replay」）：
 * - `pendingEligible` 只做「当前这次 pending 是否已被受理」，**不把整个 composable lifetime 永久锁死**；
 * - getPendingReplay() 返回 null（本就没 pending）时**绝不清零** eligible，允许稍后 onNewIntent 新增
 *   replay 后 `window.wotbtoolsOnReplay()` 再次消费（warm resume）；
 * - consume 成功后调用 Native `consumePendingReplay()` 使 Native 端 exactly-once；Web 端以
 *   `inflight` 防并发 + `consumedUri` 记录本次 pending 已消费，避免同一份重复注入。
 *
 * 跨 auth 保留：仅在 `isAuthenticated()` 为真时消费；`window.wotbtoolsOnReplay` 读实际登录态，
 * 绝不以 authenticated=true 默认值绕过。
 */
export function useNativeReplayImport({ isAuthenticated = () => false, onPendingFile } = {}) {
  let inflight = false
  const consumedUris = new Set()

  /** 从 Native serve 的 content:// 安全 URI 读取字节并构造 File。 */
  async function readPendingFile(pending) {
    const resp = await fetch(pending.uri)
    if (!resp.ok) throw new Error(`PendingReplay fetch failed: ${resp.status}`)
    const blob = await resp.blob()
    return new File([blob], pending.name || 'replay.wotbreplay', { type: 'application/octet-stream' })
  }

  async function consumePendingWhenReady() {
    if (!isAndroidApp()) return false
    if (!isAuthenticated()) return false
    if (inflight) return false
    const pending = await getPendingReplay()
    // 当前没有 pending（可能从未有，也可能 Native 尚未产生）→ 不清零 eligible，留待 warm resume。
    if (!pending) return false
    // 这份 pending 已在本会话消费并成功注入 → 不再重复（exactly-once for this replay）。
    if (consumedUris.has(pending.uri)) return false

    inflight = true
    try {
      const file = await readPendingFile(pending)
      // Native exactly-once：消费并清空 Native 端 pending（后续 onNewIntent 可产生新 pending）。
      await consumePendingReplay()
      consumedUris.add(pending.uri)
      if (onPendingFile) onPendingFile(file)
      return true
    } catch (e) {
      // read/consume 失败：不记录 consumed，允许下一次 ready 重试（现有 Processing error/retry）。
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
