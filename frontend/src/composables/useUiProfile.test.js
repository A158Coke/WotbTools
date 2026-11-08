// @vitest-environment happy-dom

import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  useUiProfile,
  setUiProfile,
  applyUiProfile,
  isUiProfile,
  themeForProfile,
  DEFAULT_UI_PROFILE,
  THEME_COLOR,
  UI_PROFILES,
  UI_PROFILE_STORAGE_KEY,
  UI_THEME_ATTR,
} from './useUiProfile.js'

function freshStorage() {
  const store = new Map()
  const storage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
  return store
}

const root = () => document.documentElement

describe('useUiProfile（四季主题）', () => {
  beforeEach(() => {
    freshStorage()
    root().removeAttribute('data-ui-profile')
    root().removeAttribute('data-theme')
    document.head.innerHTML = '<meta name="theme-color" content="#000000">'
  })

  it('合法值是春夏秋冬，默认盛夏，只有 wotb-ui-profile 一个 key', () => {
    expect(UI_PROFILES).toEqual(['spring', 'summer', 'autumn', 'winter'])
    expect(DEFAULT_UI_PROFILE).toBe('summer')
    expect(UI_PROFILE_STORAGE_KEY).toBe('wotb-ui-profile')
    for (const profile of UI_PROFILES) expect(isUiProfile(profile)).toBe(true)
    for (const value of ['showcase', 'classic', 'auto', null, 'legacy']) expect(isUiProfile(value)).toBe(false)
  })

  it('寒冬是唯一的浅色主题', () => {
    expect(UI_PROFILES.map(themeForProfile)).toEqual(['dark', 'dark', 'dark', 'light'])
  })

  it.each(['showcase', 'classic', 'auto'])('旧值 %s 在读取边界映射为盛夏并写回新值', (legacy) => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, legacy)
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('summer')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('summer')
    expect(root().getAttribute('data-ui-profile')).toBe('summer')
    expect(root().getAttribute(UI_THEME_ATTR)).toBe('dark')
  })

  it('非法值回退盛夏但不改写存储；无存储为盛夏', () => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, 'legacy')
    expect(useUiProfile().uiProfile.value).toBe('summer')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('legacy')
  })

  it.each(UI_PROFILES)('setUiProfile(%s) 同步 ref、html 投影、theme-color 与存储', (profile) => {
    const { uiProfile } = useUiProfile()
    setUiProfile(profile)
    expect(uiProfile.value).toBe(profile)
    expect(root().getAttribute('data-ui-profile')).toBe(profile)
    expect(root().getAttribute(UI_THEME_ATTR)).toBe(themeForProfile(profile))
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe(THEME_COLOR[profile])
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe(profile)
    expect(window.localStorage.getItem('wotb-theme')).toBeNull()
  })

  it('持久化值在下次启动时恢复', () => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, 'winter')
    expect(useUiProfile().uiProfile.value).toBe('winter')
    expect(root().getAttribute(UI_THEME_ATTR)).toBe('light')
  })

  it('setUiProfile(非法值) 回退盛夏，不写入非法值', () => {
    setUiProfile('legacy')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('summer')
  })

  it('applyUiProfile 只投影 html，不写存储', () => {
    applyUiProfile('autumn')
    expect(root().getAttribute('data-ui-profile')).toBe('autumn')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBeNull()
  })

  it('切换不得触发 reload', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    setUiProfile('spring')
    setUiProfile('winter')
    expect(reload).not.toHaveBeenCalled()
    reload.mockRestore()
  })
})
