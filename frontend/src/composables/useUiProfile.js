import { ref } from 'vue'

/**
 * 四季主题（design-language §2）：春 · 青山、夏 · 盛夏（默认）、秋 · 金秋、冬 · 寒冬。
 * 主题只换配色、氛围主视觉与底纹，布局 / 组件 / 字号 / 交互全站一致。
 * `wotb-ui-profile` 是唯一持久化 key；`data-theme`（dark / light）只由 profile 派生。
 */
export const UI_PROFILE_STORAGE_KEY = 'wotb-ui-profile'
const UI_PROFILE_ATTR = 'data-ui-profile'
export const UI_THEME_ATTR = 'data-theme'
export const UI_PROFILES = Object.freeze(['spring', 'summer', 'autumn', 'winter'])
export const DEFAULT_UI_PROFILE = 'summer'
/** 读取边界的旧值映射：沉浸 / 简约 / 跟随系统一律落到默认主题，并写回新值。 */
const LEGACY_UI_PROFILES = Object.freeze(['showcase', 'classic', 'auto'])
/** 浏览器 / 系统界面颜色（<meta name="theme-color">），与各主题的 --color-canvas 一致（tokens/color.css）。 */
export const THEME_COLOR = Object.freeze({ spring: '#08140f', summer: '#0b0f11', autumn: '#160f08', winter: '#eef3f8' })

/** Profile → 深浅色：寒冬是浅色（白 7 蓝 3），其余三套深色。唯一事实源。 */
export function themeForProfile(profile) {
  return profile === 'winter' ? 'light' : 'dark'
}

export function isUiProfile(value) {
  return UI_PROFILES.includes(value)
}

/** 读取并规范化 localStorage：旧值映射为默认并写回；非法值回退默认。 */
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

/**
 * 投影到 <html data-ui-profile> 与派生的 <html data-theme>、<meta name="theme-color">。
 * CSS namespace 的唯一事实源；业务组件不得直接操作 localStorage 或 html attribute。
 */
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

/** 唯一 reactive 状态源。 */
export const uiProfile = ref(DEFAULT_UI_PROFILE)

function restoreUiProfile() {
  uiProfile.value = applyUiProfile(readStoredUiProfile())
  return uiProfile.value
}

/** 切换主题：更新 reactive 状态 + 投影 html + 写 localStorage。O(1)，不 reload / remount。 */
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
