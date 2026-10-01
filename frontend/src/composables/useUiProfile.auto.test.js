// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 可控的 prefers-color-scheme：light=true 表示系统浅色，change() 模拟系统切换 */
function stubScheme(light) {
  const listeners = new Set()
  const mql = {
    get matches() { return light },
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    change(next) {
      light = next
      listeners.forEach(fn => fn({ matches: next }))
    },
  }
}

function freshStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  Object.defineProperty(window, 'localStorage', {
    value: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    configurable: true,
  })
  return store
}

describe('useUiProfile：跟随系统（auto）', () => {
  beforeEach(() => {
    vi.resetModules()
    document.head.innerHTML = '<meta name="theme-color" content="">'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('auto：按系统深浅色解析，系统切换时跟随；偏好保持 auto', async () => {
    const scheme = stubScheme(true)
    const store = freshStorage()
    const { useUiProfile, setUiProfile } = await import('./useUiProfile.js')
    const { uiProfile, uiProfilePreference } = useUiProfile()
    expect(setUiProfile('auto')).toBe('classic')
    expect(store.get('wotb-ui-profile')).toBe('auto')
    expect(uiProfilePreference.value).toBe('auto')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f6f5f2')

    scheme.change(false)
    expect(uiProfile.value).toBe('showcase')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#0b0f11')
  })

  it('选了固定主题后，系统切换不再影响', async () => {
    const scheme = stubScheme(false)
    freshStorage({ 'wotb-ui-profile': 'auto' })
    const { useUiProfile, setUiProfile } = await import('./useUiProfile.js')
    const { uiProfile } = useUiProfile()
    expect(uiProfile.value).toBe('showcase')
    setUiProfile('showcase')
    scheme.change(true)
    expect(uiProfile.value).toBe('showcase')
  })
})
