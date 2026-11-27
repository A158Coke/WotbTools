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
