import { computed, getCurrentInstance } from 'vue'
import {
  Box, Cpu, Crosshair, Download, FileText, FlaskConical, Gauge, Heart, History, Mail, ShieldCheck, Users,
} from 'lucide-vue-next'
import { useAuth } from './useAuth.js'
import { useUiProfile } from './useUiProfile.js'
import { isAndroidApp } from './usePlatformBridge.js'

/**
 * "更多"的唯一内容源：手机的"更多"页（MorePage）与平板 / 桌面侧边栏底部的"更多"弹出面板（MorePanel）
 * 共用同一份设置项与链接清单，避免两处各写一份而漂移。
 * 只能在组件 setup 中调用（语言切换要拿到组件实例上的 $i18n）。
 */
export const FEEDBACK_URL = 'https://github.com/A158Coke/WotbTools/issues/new'

export const LANGUAGES = Object.freeze([
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
])

export function useMoreMenu() {
  const { isAdmin, isHofAdmin } = useAuth()
  const { uiProfilePreference, setUiProfile } = useUiProfile()
  // vue-i18n legacy 模式下 $i18n 由 mixin 在 setup 之后才挂上：setup 时只捕获实例，用户操作时再读
  const instance = getCurrentInstance()

  function setLocale(value) {
    instance.proxy.$i18n.locale = value
    localStorage.setItem('wotb-lang', value)
  }

  const uiProfileOptions = (t) => [
    { value: 'showcase', label: t('uiProfile.showcase') },
    { value: 'classic', label: t('uiProfile.classic') },
    { value: 'auto', label: t('uiProfile.auto') },
  ]

  /** 内测工具（仅管理员）：平板 / 桌面从回放工作台的模式切换进入，手机从"更多"页进入。 */
  const betaToolLinks = computed(() => (isAdmin.value
    ? [
        { view: 'agent-replay', labelKey: 'agentNav.replay', icon: Box },
        { view: 'agent-shots', labelKey: 'agentNav.shots', icon: Crosshair },
      ]
    : []))

  /** 管理入口：平板 / 桌面在侧边栏管理组，手机在"更多"页。 */
  const adminLinks = computed(() => [
    isAdmin.value && { view: 'admin-users', labelKey: 'admin.title', icon: Users },
    isHofAdmin.value && { view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', icon: ShieldCheck },
    isAdmin.value && { view: 'rating-v2', labelKey: 'ratingV2.title', icon: Gauge },
    isAdmin.value && { view: 'playback-qa', labelKey: 'more.playbackQa', icon: FlaskConical },
  ].filter(Boolean))

  /** 关于与支持：低频入口，两种形态都放在"更多"里。 */
  const aboutLinks = computed(() => [
    { view: 'history', labelKey: 'history.btn', icon: History },
    { view: 'technical-evolution', labelKey: 'technicalEvolution.btn', icon: Cpu },
    { view: 'rating-docs', labelKey: 'more.ratingDocs', icon: FileText },
    { view: 'contact', labelKey: 'contact.nav', icon: Mail },
    { view: 'sponsor', labelKey: 'more.sponsor', icon: Heart },
    !isAndroidApp() && { view: 'android', labelKey: 'android.nav', icon: Download },
  ].filter(Boolean))

  return { uiProfilePreference, setUiProfile, uiProfileOptions, setLocale, betaToolLinks, adminLinks, aboutLinks }
}
