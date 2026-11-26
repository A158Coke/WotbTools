import { computed, getCurrentInstance, inject } from 'vue'
import { Cpu, Download, FileText, Heart, History, Mail } from 'lucide-vue-next'
import { isAndroidApp } from './usePlatformBridge.js'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { ANDROID_UPDATE_KEY } from '../shared/androidUpdate.js'
import { persistLocale } from '../i18n/locale-preference.js'

export const LANGUAGES = Object.freeze([
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
])

export function useMoreMenu() {
  const onboarding = inject(ONBOARDING_KEY, null)
  const openFeedback = inject(FEEDBACK_KEY, null)
  const androidUpdate = inject(ANDROID_UPDATE_KEY, null)
  const instance = getCurrentInstance()

  function setLocale(value) {
    const locale = persistLocale(value)
    instance.proxy.$i18n.locale = locale
  }

  const aboutLinks = computed(() => [
    { view: 'history', labelKey: 'history.btn', icon: History },
    { view: 'technical-evolution', labelKey: 'technicalEvolution.btn', icon: Cpu },
    { view: 'rating-docs', labelKey: 'more.ratingDocs', icon: FileText },
    { view: 'contact', labelKey: 'contact.nav', icon: Mail },
    { view: 'sponsor', labelKey: 'more.sponsor', icon: Heart },
    !isAndroidApp() && { view: 'android', labelKey: 'android.nav', icon: Download },
  ].filter(Boolean))

  const openGuide = computed(() => onboarding ? () => onboarding.openDirectory() : null)
  const openAndroidUpdate = computed(() => androidUpdate?.supported.value ? opener => androidUpdate.open(opener) : null)
  return { setLocale, aboutLinks, openGuide, openFeedback, openAndroidUpdate }
}
