import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import ru from './locales/ru.json'
import zh from './locales/zh.json'

export const resources = {
  en: { translation: en },
  ru: { translation: ru },
  zh: { translation: zh },
} as const

export const supportedLngs = Object.keys(resources) as Array<keyof typeof resources>

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs,
    // The locale files use single-brace placeholders like "{count}",
    // so override i18next's default "{{ }}" interpolation syntax.
    interpolation: {
      escapeValue: false,
      prefix: '{',
      suffix: '}',
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'lng',
      caches: ['localStorage'],
    },
  })

export default i18n
