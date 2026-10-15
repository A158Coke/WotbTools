/**
 * 复制文本到剪贴板：Clipboard API 优先；writeText 缺失或 reject 时降级 execCommand
 * （非安全上下文 / 旧 WebView）。复制成功返回 true，失败返回 false，不抛异常。
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // writeText 存在但失败 → 继续尝试 fallback
    }
  }
  return fallbackCopy(text)
}

/**
 * execCommand 降级：textarea 通过 try/finally 保证移除；
 * execCommand 返回 false 或抛异常时视为失败（不显示「已复制」）。
 */
function fallbackCopy(text) {
  let textarea = null
  try {
    textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    if (textarea) {
      textarea.remove()
    }
  }
}
