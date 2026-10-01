import { ref } from 'vue'

export const UI_PROFILE_STORAGE_KEY = 'wotb-ui-profile'
const UI_PROFILE_ATTR = 'data-ui-profile'
export const UI_THEME_ATTR = 'data-theme'
export const UI_PROFILES = ['classic', 'showcase']
export const DEFAULT_UI_PROFILE = 'showcase'
/** 用户可选的偏好：两套主题之一，或 auto（跟随系统深浅色，design-language 决策记录）。 */
export const UI_PROFILE_AUTO = 'auto'
export const UI_PROFILE_PREFERENCES = ['showcase', 'classic', UI_PROFILE_AUTO]
/** 浏览器 / 系统界面颜色（<meta name="theme-color">），与两套主题的 --color-canvas 一致。 */
export const THEME_COLOR = Object.freeze({ dark: '#0b0f11', light: '#f6f5f2' })
const LIGHT_SCHEME_QUERY = '(prefers-color-scheme: light)'

/** Profile → 主题映射：showcase=深色沉浸，classic=浅色简约。唯一事实源。 */
export function themeForProfile(profile) {
  return profile === 'classic' ? 'light' : 'dark'
}

export function isUiProfile(value) {
  return UI_PROFILES.includes(value)
}

export function isUiProfilePreference(value) {
  return UI_PROFILE_PREFERENCES.includes(value)
}

function systemPrefersLight() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(LIGHT_SCHEME_QUERY).matches
  } catch (_) {
    return false
  }
}

/** 偏好 → 实际生效的 profile：auto 按系统深浅色解析。 */
export function resolveUiProfile(preference) {
  if (preference === UI_PROFILE_AUTO) return systemPrefersLight() ? 'classic' : 'showcase'
  return isUiProfile(preference) ? preference : DEFAULT_UI_PROFILE
}

/** 读取并规范化 localStorage 中的偏好;非法值一律回退默认 showcase。 */
function readStoredUiProfile() {
  try {
    const raw = window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)
    return isUiProfilePreference(raw) ? raw : DEFAULT_UI_PROFILE
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
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[themeForProfile(next)])
  }
  return next
}

/** 唯一 reactive 状态源。uiProfile = 实际生效的主题；uiProfilePreference = 用户的选择（可为 auto）。 */
const uiProfile = ref(DEFAULT_UI_PROFILE)
const uiProfilePreference = ref(DEFAULT_UI_PROFILE)

// auto 时跟随系统深浅色变化（全应用一个监听）
let schemeQuery = null
function onSystemSchemeChange() {
  if (uiProfilePreference.value !== UI_PROFILE_AUTO) return
  uiProfile.value = applyUiProfile(resolveUiProfile(UI_PROFILE_AUTO))
}
function bindSystemScheme() {
  if (schemeQuery || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  try {
    schemeQuery = window.matchMedia(LIGHT_SCHEME_QUERY)
    schemeQuery.addEventListener?.('change', onSystemSchemeChange)
  } catch (_) {
    schemeQuery = null
  }
}

function applyPreference(preference) {
  uiProfilePreference.value = preference
  if (preference === UI_PROFILE_AUTO) bindSystemScheme()
  uiProfile.value = applyUiProfile(resolveUiProfile(preference))
  return uiProfile.value
}

function restoreUiProfile() {
  return applyPreference(readStoredUiProfile())
}

/** 切换偏好:更新 reactive 状态 + 投影 html + 写 localStorage。O(1),不 reload / remount。返回实际生效的 profile。 */
export function setUiProfile(profile) {
  const next = isUiProfilePreference(profile) ? profile : DEFAULT_UI_PROFILE
  try {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, next)
  } catch (_) {
    // 忽略配额/隐私模式限制,保持内存态即可,不影响切换。
  }
  return applyPreference(next)
}

export function toggleUiProfile() {
  return setUiProfile(uiProfile.value === 'classic' ? 'showcase' : 'classic')
}

export function useUiProfile() {
  restoreUiProfile()
  return {
    uiProfile,
    uiProfilePreference,
    UI_PROFILES,
    UI_PROFILE_PREFERENCES,
    DEFAULT_UI_PROFILE,
    UI_PROFILE_STORAGE_KEY,
    setUiProfile,
    toggleUiProfile,
    applyUiProfile,
    isUiProfile,
  }
}


