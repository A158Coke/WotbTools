import { getPendingReplay, isAndroidApp } from './usePlatformBridge.js'

/**
 * 端侧 Replay 导入钩子：把 Native 收到（并已复制到 app cache）的 share/open content URI
 * 注入现有 Web 上传管线。
 *
 * 机制：Native 在 WebView 请求文件选择时（onShowFileChooser）把 app-owned FileProvider URI
 * 回传给 `<input type="file">` —— 我们只需在 Replay 页就绪后点击该 input，让现有 FileUploader
 * 走 validate/upload pipeline，无需 Base64 传 replay（规格 §38/§39）。
 *
 * 限制（ponytail: 需真机验证，规格 §9/§84）：MIME/触发时机依赖 WoT Blitz 实际导出行为，
 * 最终以用户真机 evidence 调优；此处先用保守默认。
 */
export function useNativeReplayImport() {
  async function triggerFileInput() {
    if (!isAndroidApp()) return
    const pending = await getPendingReplay()
    if (!pending) return
    const input = document.querySelector('input[type="file"][accept*=".wotbreplay"]')
    if (input) input.click()
  }

  function registerGlobalHandler() {
    if (typeof window !== 'undefined') {
      window.wotbtoolsOnReplay = () => triggerFileInput()
    }
  }

  registerGlobalHandler()
  return { triggerFileInput, registerGlobalHandler }
}
