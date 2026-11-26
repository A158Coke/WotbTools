const VERSION_PATTERN = /^(\d+(?:\.\d+)*)(?:[_\s-]+[A-Za-z][\w-]*)?$/

export function formatGameVersion(raw) {
  const text = raw == null ? '' : String(raw).trim()
  if (!text) return ''
  const match = VERSION_PATTERN.exec(text)
  return match ? match[1] : text
}
