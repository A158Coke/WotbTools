import { ref } from 'vue'

export const UI_PROFILE_STORAGE_KEY = 'wotb-ui-profile'
const UI_PROFILE_ATTR = 'data-ui-profile'
export const UI_THEME_ATTR = 'data-theme'
export const UI_PROFILES = Object.freeze(['spring', 'summer', 'autumn', 'winter'])
export const DEFAULT_UI_PROFILE = 'summer'
const LEGACY_UI_PROFILES = Object.freeze(['showcase', 'classic', 'auto'])
export const THEME_COLOR = Object.freeze({ spring: '#08140f', summer: '#191304', autumn: '#160f08', winter: '#eef3f8' })

export function themeForProfile(profile) {
  return profile === 'winter' ? 'light' : 'dark'
}

export function isUiProfile(value) {
  return UI_PROFILES.includes(value)
}

function readStoredUiProfile() {
  try {
    const raw = window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)
    if (isUiProfile(raw)) return raw
    if (LEGACY_UI_PROFILES.includes(raw)) window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, DEFAULT_UI_PROFILE)
    return DEFAULT_UI_PROFILE
  } catch (_) {
    return DEFAULT_UI_PROFILE
  }
}

export function applyUiProfile(profile) {
  const next = isUiProfile(profile) ? profile : DEFAULT_UI_PROFILE
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute(UI_PROFILE_ATTR, next)
    document.documentElement.setAttribute(UI_THEME_ATTR, themeForProfile(next))
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[next])
  }
  return next
}

export const uiProfile = ref(DEFAULT_UI_PROFILE)

function restoreUiProfile() {
  uiProfile.value = applyUiProfile(readStoredUiProfile())
  return uiProfile.value
}

export function setUiProfile(profile) {
  const next = isUiProfile(profile) ? profile : DEFAULT_UI_PROFILE
  try {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, next)
  } catch (_) {
    // 忽略配额 / 隐私模式限制，保持内存态即可，不影响切换。
  }
  uiProfile.value = applyUiProfile(next)
  return uiProfile.value
}

export function useUiProfile() {
  restoreUiProfile()
  return {
    uiProfile,
    UI_PROFILES,
    DEFAULT_UI_PROFILE,
    UI_PROFILE_STORAGE_KEY,
    setUiProfile,
    applyUiProfile,
    isUiProfile,
  }
}
