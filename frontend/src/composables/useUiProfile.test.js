// @vitest-environment happy-dom

import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  useUiProfile,
  setUiProfile,
  toggleUiProfile,
  applyUiProfile,
  isUiProfile,
  themeForProfile,
  DEFAULT_UI_PROFILE,
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

describe('useUiProfile', () => {
  beforeEach(() => {
    freshStorage()
    document.documentElement.removeAttribute('data-ui-profile')
    document.documentElement.removeAttribute('data-theme')
  })

  it('暴露常量:合法值为 classic/showcase,默认 showcase', () => {
    expect(DEFAULT_UI_PROFILE).toBe('showcase')
    expect(UI_PROFILES).toEqual(['classic', 'showcase'])
    expect(UI_PROFILE_STORAGE_KEY).toBe('wotb-ui-profile')
    expect(isUiProfile('classic')).toBe(true)
    expect(isUiProfile('showcase')).toBe(true)
    expect(isUiProfile('legacy')).toBe(false)
    expect(isUiProfile(null)).toBe(false)
  })

  it('default:无 storage -> showcase', () => {
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('showcase')
  })

  it('persistence:storage=classic -> classic,并投影到 html[data-ui-profile]', () => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, 'classic')
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('classic')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('classic')
  })

  it('invalid storage -> showcase', () => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, 'legacy')
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('showcase')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('showcase')
  })

  it('setUiProfile("classic") 同步 ref + html dataset + localStorage', () => {
    const { uiProfile } = useUiProfile()
    setUiProfile('classic')
    expect(uiProfile.value).toBe('classic')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('classic')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('classic')
  })

  it('reverse:classic -> showcase', () => {
    setUiProfile('classic')
    const { uiProfile } = useUiProfile()
    setUiProfile('showcase')
    expect(uiProfile.value).toBe('showcase')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('showcase')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('showcase')
  })

  it('setUiProfile(invalid) 回退 showcase 而非写入非法值', () => {
    setUiProfile('legacy')
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('showcase')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('showcase')
  })

  it('toggle 在 classic/showcase 间翻转', () => {
    useUiProfile()
    setUiProfile('showcase')
    toggleUiProfile()
    expect(useUiProfile().uiProfile.value).toBe('classic')
    toggleUiProfile()
    expect(useUiProfile().uiProfile.value).toBe('showcase')
  })

  it('applyUiProfile 投影到 html attribute', () => {
    applyUiProfile('classic')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('classic')
  })

  it('切换不得触发 reload', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    setUiProfile('classic')
    toggleUiProfile()
    expect(reload).not.toHaveBeenCalled()
    reload.mockRestore()
  })
})

describe('useUiProfile → data-theme 派生（Theme 计划）', () => {
  beforeEach(() => {
    freshStorage()
    document.documentElement.removeAttribute('data-ui-profile')
    document.documentElement.removeAttribute('data-theme')
  })

  it('themeForProfile:showcase→dark,classic→light', () => {
    expect(themeForProfile('showcase')).toBe('dark')
    expect(themeForProfile('classic')).toBe('light')
    expect(themeForProfile('legacy')).toBe('dark')
  })

  it('默认 showcase:data-ui-profile=showcase 且 data-theme=dark', () => {
    useUiProfile()
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('showcase')
    expect(document.documentElement.getAttribute(UI_THEME_ATTR)).toBe('dark')
  })

  it('storage=classic:data-ui-profile=classic 且 data-theme=light,无独立 theme storage', () => {
    window.localStorage.setItem(UI_PROFILE_STORAGE_KEY, 'classic')
    useUiProfile()
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('classic')
    expect(document.documentElement.getAttribute(UI_THEME_ATTR)).toBe('light')
    // 不得新增第二个持久化 key（no wotb-theme）
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('classic')
    expect(window.localStorage.getItem('wotb-theme')).toBeNull()
  })

  it('setUiProfile(classic/showcase) 同步两个 attribute 派生主题', () => {
    setUiProfile('classic')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('classic')
    expect(document.documentElement.getAttribute(UI_THEME_ATTR)).toBe('light')
    setUiProfile('showcase')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('showcase')
    expect(document.documentElement.getAttribute(UI_THEME_ATTR)).toBe('dark')
  })

  it('非法值回退 showcase→dark,不写非法 key 值', () => {
    setUiProfile('legacy')
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('showcase')
    expect(document.documentElement.getAttribute('data-ui-profile')).toBe('showcase')
    expect(document.documentElement.getAttribute(UI_THEME_ATTR)).toBe('dark')
    expect(window.localStorage.getItem(UI_PROFILE_STORAGE_KEY)).toBe('showcase')
  })
})
