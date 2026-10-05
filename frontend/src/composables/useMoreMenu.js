import { computed, getCurrentInstance } from 'vue'
import {
  Box, Cpu, Crosshair, Download, FileText, Heart, History, Mail, ShieldCheck, Users, ListOrdered, Settings, Trophy,
} from 'lucide-vue-next'
import { useAuth } from './useAuth.js'
import { useUiProfile } from './useUiProfile.js'
import { isAndroidApp } from './usePlatformBridge.js'

export const FEEDBACK_URL = 'https://github.com/A158Coke/WotbTools/issues/new'

export const LANGUAGES = Object.freeze([
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
])

export function useMoreMenu() {
  const { isAdmin, isHofAdmin, hasRole } = useAuth()
  const { uiProfilePreference, setUiProfile } = useUiProfile()
  const instance = getCurrentInstance()
  const tournamentAdmin = computed(() => hasRole('tournament-admin'))

  function setLocale(value) {
    instance.proxy.$i18n.locale = value
    localStorage.setItem('wotb-lang', value)
  }

  const uiProfileOptions = (t) => [
    { value: 'showcase', label: t('uiProfile.showcase') },
    { value: 'classic', label: t('uiProfile.classic') },
    { value: 'auto', label: t('uiProfile.auto') },
  ]

  const replayToolLinks = [
    { view: 'agent-replay', labelKey: 'agentNav.replay', icon: Box },
    { view: 'agent-shots', labelKey: 'agentNav.shots', icon: Crosshair },
    { view: 'tournament-points', labelKey: 'tournament.title', icon: Trophy },
  ]

  const adminLinks = computed(() => [
    isAdmin.value && { view: 'admin-users', labelKey: 'admin.title', icon: Users },
    isHofAdmin.value && { view: 'hof-admin', labelKey: 'hofAdmin.cardTitle', icon: ShieldCheck },
    tournamentAdmin.value && { view: 'tournament-points-config', labelKey: 'tournament.configTitle', icon: Settings },
    tournamentAdmin.value && { view: 'tournament-points-admin', labelKey: 'tournament.adminTitle', icon: ListOrdered },
  ].filter(Boolean))

  const aboutLinks = computed(() => [
    { view: 'history', labelKey: 'history.btn', icon: History },
    { view: 'technical-evolution', labelKey: 'technicalEvolution.btn', icon: Cpu },
    { view: 'rating-docs', labelKey: 'more.ratingDocs', icon: FileText },
    { view: 'contact', labelKey: 'contact.nav', icon: Mail },
    { view: 'sponsor', labelKey: 'more.sponsor', icon: Heart },
    !isAndroidApp() && { view: 'android', labelKey: 'android.nav', icon: Download },
  ].filter(Boolean))

  return { uiProfilePreference, setUiProfile, uiProfileOptions, setLocale, replayToolLinks, adminLinks, aboutLinks }
}
