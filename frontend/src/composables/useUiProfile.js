import { ref } from 'vue'

export const UI_PROFILE_STORAGE_KEY = 'wotb-ui-profile'
export const UI_PROFILE_ATTR = 'data-ui-profile'
export const UI_THEME_ATTR = 'data-theme'
export const UI_PROFILES = ['classic', 'showcase']
export const DEFAULT_UI_PROFILE = 'showcase'

/** Profile → 主题映射：showcase=深色沉浸，classic=浅色简约。唯一事实源。 */
export function themeForProfile(profile) {
  return profile === 'classic' ? 'light' : 'dark'
}

export function isUiProfile(value) {
  return UI_PROFILES.includes(value)
}

/** 读取并规范化 localStorage 中的 profile;非法值一律回退默认 showcase。 */
export function readStoredUiProfile() {
  try {
    const raw = window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)
    return isUiProfile(raw) ? raw : DEFAULT_UI_PROFILE
  } catch (_) {
    return DEFAULT_UI_PROFILE
  }
}

/**
 * 投影到 <html data-ui-profile> 与派生的 <html data-theme>。
 * CSS namespace 的唯一事实源;业务组件不得直接操作 localStorage 或 html attribute。
 * data-theme 只由 profile 派生（showcase→dark, classic→light），不设独立主题状态。
 */
export function applyUiProfile(profile) {
  const next = isUiProfile(profile) ? profile : DEFAULT_UI_PROFILE
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute(UI_PROFILE_ATTR, next)
    document.documentElement.setAttribute(UI_THEME_ATTR, themeForProfile(next))
  }
  return next
}

/** 唯一 reactive 状态源。初值 DEFAULT;每次 useUiProfile() 从存储同步。 */
const uiProfile = ref(DEFAULT_UI_PROFILE)

function restoreUiProfile() {
  const stored = readStoredUiProfile()
  uiProfile.value = stored
  applyUiProfile(stored)
  return stored
}

/** 切换 profile:更新 reactive 状态 + 投影 html + 写 localStorage。O(1),不 reload / remount。 */
export function setUiProfile(profile) {
  const next = isUiProfile(profile) ? profile : DEFAULT_UI_PROFILE
  uiProfile.value = next
  applyUiProfile(next)
  try {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, next)
  } catch (_) {
    // 忽略配额/隐私模式限制,保持内存态即可,不影响切换。
  }
  return next
}

export function toggleUiProfile() {
  return setUiProfile(uiProfile.value === 'classic' ? 'showcase' : 'classic')
}

export function useUiProfile() {
  restoreUiProfile()
  return {
    uiProfile,
    UI_PROFILES,
    DEFAULT_UI_PROFILE,
    UI_PROFILE_STORAGE_KEY,
    setUiProfile,
    toggleUiProfile,
    applyUiProfile,
    isUiProfile,
  }
}

export default useUiProfile
