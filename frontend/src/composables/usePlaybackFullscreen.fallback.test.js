// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { PLAYBACK_PHONE_QUERY } from './usePlaybackPhoneForm.ts'
import { usePlaybackFullscreen } from './usePlaybackFullscreen.ts'
import { flush, mountFullscreen, stubBrowserApis, stubMatchMedia } from '../test/usePlaybackFullscreenTestHelpers.js'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('usePlaybackFullscreen.enterFullscreen：幂等的自动进入入口（resolve 真实结果）', () => {
  it('成功才 true 并锁横屏；已全屏时再调用 false；退出后可再进入', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis()
    const { api, stop } = mountFullscreen()
    expect(await api.enterFullscreen()).toBe(true)
    expect(api.isFullscreen.value).toBe(true)
    expect(calls.lock).toEqual(['landscape'])
    expect(await api.enterFullscreen()).toBe(false)
    expect(calls.request).toBe(1)
    api.toggleFullscreen()
    expect(api.isFullscreen.value).toBe(false)
    expect(await api.enterFullscreen()).toBe(true)
    expect(calls.request).toBe(2)
    stop()
  })

  it('失活 / API 缺失 / 被拒绝都 resolve false，不抛出，也不锁方向', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    stubBrowserApis()
    const inactive = mountFullscreen({ isActive: () => false })
    expect(await inactive.api.enterFullscreen()).toBe(false)
    inactive.stop()
    document.body.innerHTML = ''
    const { root, calls } = stubBrowserApis()
    root.requestFullscreen = vi.fn(() => Promise.reject(new Error('Permission denied')))
    const rejected = mountFullscreen()
    expect(await rejected.api.enterFullscreen()).toBe(false)
    expect(rejected.api.isFullscreen.value).toBe(false)
    expect(calls.lock).toEqual([])
    rejected.stop()
    document.body.innerHTML = ''
    stubBrowserApis({ fullscreen: false })
    const missing = mountFullscreen()
    expect(await missing.api.enterFullscreen()).toBe(false)
    missing.stop()
  })

  it('迟到的成功：请求期间已失活或卸载 → 立刻退出本回放拥有的全屏并 resolve false', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { root, calls } = stubBrowserApis()
    let release
    root.requestFullscreen = vi.fn(async () => {
      await new Promise((resolve) => { release = resolve })
      Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    let active = true
    const lateInactive = mountFullscreen({ isActive: () => active })
    const pendingInactive = lateInactive.api.enterFullscreen()
    active = false
    release()
    expect(await pendingInactive).toBe(false)
    expect(calls.exit).toBe(1)
    expect(calls.lock).toEqual([])
    lateInactive.stop()

    const lateDisposed = mountFullscreen()
    const pendingDisposed = lateDisposed.api.enterFullscreen()
    lateDisposed.stop()
    release()
    expect(await pendingDisposed).toBe(false)
    expect(calls.exit).toBe(2)
  })
})

describe('伪全屏降级（pseudoFallback，2D 回放开启）', () => {
  function mountPseudo({ pseudoFallback = true, onChange, isActive } = {}) {
    const root = document.body.lastElementChild
    const scope = effectScope()
    let api
    scope.run(() => { api = usePlaybackFullscreen({ target: () => root, pseudoFallback, onChange, isActive }) })
    return { api, root, stop: () => scope.stop() }
  }
  const html = () => document.documentElement

  it('原生请求被拒绝 → 进入伪全屏（锁文档滚动），再点一次退出并解锁', async () => {
    stubBrowserApis()
    document.body.lastElementChild.requestFullscreen = vi.fn(() => Promise.reject(new Error('Permissions check failed')))
    const changes = []
    const { api, stop } = mountPseudo({ onChange: (v) => changes.push(v) })
    api.toggleFullscreen()
    await flush()
    expect(api.pseudoFullscreen.value).toBe(true)
    expect(api.isFullscreen.value).toBe(true)
    expect(html().hasAttribute('data-pb-pseudo-fullscreen')).toBe(true)
    api.toggleFullscreen()
    expect(api.isFullscreen.value).toBe(false)
    expect(html().hasAttribute('data-pb-pseudo-fullscreen')).toBe(false)
    expect(changes).toEqual([true, false])
    stop()
  })

  it('原生请求悬挂不落定（既不 resolve 也不 reject）→ 超时后降级，不是「点了没反应」', async () => {
    vi.useFakeTimers()
    stubBrowserApis()
    document.body.lastElementChild.requestFullscreen = vi.fn(() => new Promise(() => {}))
    const { api, stop } = mountPseudo()
    api.toggleFullscreen()
    expect(api.isFullscreen.value).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(api.pseudoFullscreen.value).toBe(true)
    stop()
    vi.useRealTimers()
  })

  it('元素不支持 requestFullscreen（iPhone Safari）→ 直接伪全屏，且按钮视为受支持', () => {
    stubBrowserApis({ fullscreen: false })
    const { api, stop } = mountPseudo()
    expect(api.fullscreenSupported.value).toBe(true)
    api.toggleFullscreen()
    expect(api.pseudoFullscreen.value).toBe(true)
    stop()
  })

  it('Esc 退出伪全屏；别的层已处理（defaultPrevented）的 Esc 不抢', async () => {
    stubBrowserApis({ fullscreen: false })
    const { api, stop } = mountPseudo()
    api.toggleFullscreen()
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    handled.preventDefault()
    document.dispatchEvent(handled)
    expect(api.pseudoFullscreen.value).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await Promise.resolve()
    expect(api.pseudoFullscreen.value).toBe(false)
    expect(html().hasAttribute('data-pb-pseudo-fullscreen')).toBe(false)
    stop()
  })

  it('exitOwnedFullscreen（能力切走 / KeepAlive 停用）与卸载都会退出伪全屏', () => {
    stubBrowserApis({ fullscreen: false })
    const first = mountPseudo()
    first.api.toggleFullscreen()
    first.api.exitOwnedFullscreen()
    expect(first.api.pseudoFullscreen.value).toBe(false)
    first.api.toggleFullscreen()
    first.stop()
    expect(html().hasAttribute('data-pb-pseudo-fullscreen')).toBe(false)
  })

  it.each(['exit', 'deactivate', 'dispose'])('%s 使重复点击的悬挂请求及迟到拒绝失效', async (mode) => {
    vi.useFakeTimers()
    stubBrowserApis()
    let active = true
    const rejects = []
    document.body.lastElementChild.requestFullscreen = vi.fn(() => new Promise((_, reject) => rejects.push(reject)))
    const { api, stop } = mountPseudo({ isActive: () => active })
    try {
      api.toggleFullscreen()
      vi.advanceTimersByTime(300)
      api.toggleFullscreen()
      if (mode === 'exit') {
        vi.advanceTimersByTime(700)
        expect(api.pseudoFullscreen.value).toBe(true)
        api.toggleFullscreen()
      } else {
        active = false
        if (mode === 'dispose') stop()
        else api.exitOwnedFullscreen()
        active = true
      }
      rejects.forEach(reject => reject(new Error('late rejection')))
      await Promise.resolve()
      await Promise.resolve()
      vi.runAllTimers()
      expect(api.isFullscreen.value).toBe(false)
      expect(html().hasAttribute('data-pb-pseudo-fullscreen')).toBe(false)
    } finally { stop(); vi.useRealTimers() }
  })

  it('window 标注快捷键消费 Esc 后保留伪全屏', async () => {
    stubBrowserApis({ fullscreen: false })
    const { api, stop } = mountPseudo()
    const annotationHandler = event => event.preventDefault()
    window.addEventListener('keydown', annotationHandler)
    api.toggleFullscreen()
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await Promise.resolve()
      expect(api.pseudoFullscreen.value).toBe(true)
      window.removeEventListener('keydown', annotationHandler)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await Promise.resolve()
      expect(api.pseudoFullscreen.value).toBe(false)
    } finally { window.removeEventListener('keydown', annotationHandler); stop() }
  })

  it('默认不开降级：API 缺失时按钮不受支持、点击无副作用（3D / Map Preview 等沿用旧语义）', () => {
    stubBrowserApis({ fullscreen: false })
    const { api, stop } = mountPseudo({ pseudoFallback: false })
    expect(api.fullscreenSupported.value).toBe(false)
    api.toggleFullscreen()
    expect(api.isFullscreen.value).toBe(false)
    stop()
  })
})
