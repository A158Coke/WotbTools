import { getPendingReplay, isAndroidApp } from './usePlatformBridge.js'

/**
 * 端侧 Replay 导入钩子：把 Native 收到（并已复制到 app cache）的 share/open content URI
 * 注入现有 Web 上传管线。
 *
 * 机制：Native 在 WebView 请求文件选择时（onShowFileChooser）把 app-owned FileProvider URI
 * 回传给 `<input type="file">` —— 无需 Base64 传 replay（规格 §38/§39）。
 *
 * 可靠性（ponytail: 需真机验证，规格 §9/§84）：本钩子不依赖「挂载后立即 synthetic click」，
 * 而是暴露一个幂等 `consumePendingWhenReady`，由 Workspace 在`登录态就绪 + 文件输入已挂载`
 * 后调用一次。Native 侧的 `onShowFileChooser` 已用 `pendingReplayEligible` 保证 exactly-once
 * （首次注入后即清空），Web 侧只用 `pendingEligible` 防止重复触发，绝不在未登录时提前消费。
 */
export function useNativeReplayImport() {
  let pendingEligible = true

  async function consumePendingWhenReady({ authenticated = true } = {}) {
    if (!isAndroidApp()) return false
    if (!authenticated) return false
    if (!pendingEligible) return false
    const pending = await getPendingReplay()
    // pending 可能已被 Native 消费（比如用户在其它 tab/页面触发过 chooser）——不再重复注入。
    if (!pending) {
      pendingEligible = false
      return false
    }
    // 定位 Workspace 的上传器输入（accept 限定 .wotbreplay），交给 Native onShowFileChooser 注入 URI。
    const input = document.querySelector('input[type="file"][accept*=".wotbreplay"]')
    if (!input) return false
    // 标记为已受理：本会话内不重复触发；Native 侧 exactly-once 由 pendingReplayEligible 保证。
    pendingEligible = false
    input.click()
    return true
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
