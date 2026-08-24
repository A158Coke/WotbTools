import zh from './zh.json'
import en from './en.json'
import ru from './ru.json'
import featureMessages from './feature-messages.json'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Compose locale modules without mutating imported base JSON objects.
 * Nested feature namespaces (for example replay.processing_job) are merged so
 * existing translations such as mixed_league_standard cannot be overwritten.
 */
export function mergeLocaleMessages(base, addition) {
  const result = { ...base }
  for (const [key, value] of Object.entries(addition || {})) {
    result[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? mergeLocaleMessages(base[key], value)
      : value
  }
  return result
}

export const messages = {
  zh: mergeLocaleMessages(zh, featureMessages.zh),
  en: mergeLocaleMessages(en, featureMessages.en),
  ru: mergeLocaleMessages(ru, featureMessages.ru)
}
