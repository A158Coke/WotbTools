import { computed, getCurrentInstance, inject } from 'vue'
import { Cpu, Download, FileText, Heart, History, Mail } from 'lucide-vue-next'
import { isAndroidApp } from './usePlatformBridge.js'
import { FEEDBACK_KEY } from '../shared/feedback.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { ANDROID_UPDATE_KEY } from '../shared/androidUpdate.js'
import { persistLocale } from '../i18n/locale-preference.js'

/**
 * "更多"的唯一内容源：手机的"更多"页（MorePage）与平板 / 桌面侧边栏底部的"更多"弹出面板（MorePanel）
 * 共用同一份设置项与链接清单，避免两处各写一份而漂移。
 * 只能在组件 setup 中调用（语言切换要拿到组件实例上的 $i18n）。
 */
export const LANGUAGES = Object.freeze([
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
])

export function useMoreMenu() {
  const onboarding = inject(ONBOARDING_KEY, null)
  const openFeedback = inject(FEEDBACK_KEY, null)
  const androidUpdate = inject(ANDROID_UPDATE_KEY, null)
    // vue-i18n legacy 模式下 $i18n 由 mixin 在 setup 之后才挂上：setup 时只捕获实例，用户操作时再读
  const instance = getCurrentInstance()

  function setLocale(value) {
    const locale = persistLocale(value)
    instance.proxy.$i18n.locale = locale
  }

  /** 关于与支持：低频入口，两种形态都放在"更多"里。 */
  const aboutLinks = computed(() => [
    { view: 'history', labelKey: 'history.btn', icon: History },
    { view: 'technical-evolution', labelKey: 'technicalEvolution.btn', icon: Cpu },
    { view: 'rating-docs', labelKey: 'more.ratingDocs', icon: FileText },
    { view: 'contact', labelKey: 'contact.nav', icon: Mail },
    { view: 'sponsor', labelKey: 'more.sponsor', icon: Heart },
    !isAndroidApp() && { view: 'android', labelKey: 'android.nav', icon: Download },
  ].filter(Boolean))

  // 功能指南对所有人开放：Android App 没有首页，抽屉外壳里「更多」是重开教程的唯一稳定入口
  const openGuide = computed(() => onboarding ? () => onboarding.openDirectory() : null)
  const openAndroidUpdate = computed(() => androidUpdate?.supported.value ? opener => androidUpdate.open(opener) : null)
  return { setLocale, aboutLinks, openGuide, openFeedback, openAndroidUpdate }
}
