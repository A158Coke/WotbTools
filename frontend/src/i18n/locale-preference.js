const LOCALE_STORAGE_KEY = 'wotb-lang'
const SUPPORTED_LOCALES = Object.freeze(['zh', 'en', 'ru'])
const DEFAULT_LOCALE = 'zh'

export function normalizeLocale(value) {
  const normalized = String(value || '').toLowerCase().trim().split('-')[0]
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE
}

export function readLocale(storage) {
  try {
    const target = storage ?? globalThis.localStorage
    return normalizeLocale(target?.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return DEFAULT_LOCALE
  }
}

export function persistLocale(value, storage) {
  const locale = normalizeLocale(value)
  try {
    const target = storage ?? globalThis.localStorage
    target?.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Keep the active in-memory locale usable when browser storage is unavailable.
  }
  return locale
}
