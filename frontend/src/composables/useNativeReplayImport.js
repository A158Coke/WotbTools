import { consumePendingReplay, getPendingReplay, isAndroidApp } from './usePlatformBridge.js'

/**
 * 端侧 Replay 导入钩子：把 Native 收到（并已复制到 app cache）的 share/open replay
 * 注入现有 Web 上传管线。
 *
 * 机制（不再依赖 synthetic input.click()）：Native 把 pending replay 的字节经 WebView
 * `shouldInterceptRequest` 以「app-owned 安全 content:// 缓存文件」serve 出来；Web 侧
 * `fetch(pending.uri)` 直接读取字节构造 `File`，再交给 `onPendingFile(file)` → 现存
 * upload pipeline（`updateFiles`）。无需 Base64、不取真实路径、不放宽 WebView 安全边界。
 *
 * exactly-once：Native 侧 `pendingReplayEligible` 保证首次注入后即清空；Web 侧
 * `pendingEligible` 防止同一会话重复触发。跨 auth 保留：仅在 `isAuthenticated()` 为真时消费，
 * `window.wotbtoolsOnReplay` 读实际登录态，绝不以 authenticated=true 默认值绕过。
 */
export function useNativeReplayImport({ isAuthenticated = () => false, onPendingFile } = {}) {
  let pendingEligible = true

  /** 从 Native serve 的 content:// 安全 URI 读取字节并构造 File（浏览器 fetch 不做身份判断）。 */
  async function readPendingFile(pending) {
    const resp = await fetch(pending.uri)
    if (!resp.ok) throw new Error(`PendingReplay fetch failed: ${resp.status}`)
    const blob = await resp.blob()
    return new File([blob], pending.name || 'replay.wotbreplay', { type: 'application/octet-stream' })
  }

  async function consumePendingWhenReady() {
    if (!isAndroidApp()) return false
    if (!isAuthenticated()) return false
    if (!pendingEligible) return false
    const pending = await getPendingReplay()
    if (!pending) {
      pendingEligible = false
      return false
    }
    try {
      const file = await readPendingFile(pending)
      // exactly-once：Native 端消费并清空 pending；本会话不再重复注入。
      await consumePendingReplay()
      pendingEligible = false
      if (onPendingFile) onPendingFile(file)
      return true
    } catch (e) {
      // read/consume 失败：不标记 pendingEligible=false，允许下一次 ready 重试。
      return false
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
