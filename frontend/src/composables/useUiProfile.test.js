// @vitest-environment happy-dom

import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  useUiProfile,
  setUiProfile,
  toggleUiProfile,
  applyUiProfile,
  isUiProfile,
  DEFAULT_UI_PROFILE,
  UI_PROFILES,
  UI_PROFILE_STORAGE_KEY,
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
