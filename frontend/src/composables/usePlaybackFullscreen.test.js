// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'
import { PLAYBACK_PHONE_QUERY, usePlaybackPhoneForm } from './usePlaybackPhoneForm.ts'
import { flush, mountFullscreen, stubBrowserApis, stubMatchMedia } from '../test/usePlaybackFullscreenTestHelpers.js'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('回放 form factor：手机横屏/全屏后仍是手机', () => {
  it('phone 形态查询就是 2D 一直在用的 PLAYBACK_MOBILE_QUERY（不另立规则）', () => {
    expect(PLAYBACK_PHONE_QUERY).toBe(PLAYBACK_MOBILE_QUERY)
  })

  it('手机竖屏与**全屏横屏**都命中 phone 形态（后者靠 coarse + 矮视口，不靠宽度）', () => {
    const portrait = /max-width:\s*([\d.]+)px/.exec(PLAYBACK_MOBILE_QUERY)[1]
    expect(412).toBeLessThanOrEqual(Number(portrait))
    expect(PLAYBACK_MOBILE_QUERY).toContain('(pointer: coarse) and (max-height: 500px)')
    expect(915).toBeGreaterThan(Number(portrait))
    expect(412).toBeLessThanOrEqual(500)
    expect(768).toBeGreaterThan(Number(portrait))
    expect(1024).toBeGreaterThan(500)
  })

  it('usePlaybackPhoneForm 跟随 matchMedia 变化（模拟旋转）', () => {
    let matches = true
    const listeners = []
    vi.stubGlobal('matchMedia', (query) => ({
      get matches() { return matches && query === PLAYBACK_PHONE_QUERY },
      media: query,
      addEventListener(_t, cb) { listeners.push(cb) },
      removeEventListener() {},
    }))
    const scope = effectScope()
    let phone
    scope.run(() => { phone = usePlaybackPhoneForm() })
    expect(phone.isPhone.value).toBe(true)
    listeners.forEach((cb) => cb({ matches: true }))
    expect(phone.isPhone.value).toBe(true)
    scope.stop()
  })
})

describe('usePlaybackFullscreen：手机一键全屏 + 横屏锁', () => {
  it('全屏成功后才请求 landscape 锁（顺序错在安卓上会被直接拒）', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis()
    const { api, stop } = mountFullscreen()
    expect(api.fullscreenSupported.value).toBe(true)
    expect(calls.lock).toEqual([])
    api.toggleFullscreen()
    expect(calls.request).toBe(1)
    await flush()
    expect(calls.lock).toEqual(['landscape'])
    stop()
  })

  it('fullscreenchange 是唯一事实源：外部退出（ESC / 系统手势）会同步并解锁', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis()
    const { api, stop } = mountFullscreen()
    api.toggleFullscreen()
    await flush()
    expect(api.isFullscreen.value).toBe(true)
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(api.isFullscreen.value).toBe(false)
    expect(calls.unlock).toBe(1)
    stop()
  })

  it('再点一次 = exitFullscreen，并解锁方向', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis()
    const { api, stop } = mountFullscreen()
    api.toggleFullscreen()
    await flush()
    api.toggleFullscreen()
    expect(calls.exit).toBe(1)
    expect(api.isFullscreen.value).toBe(false)
    expect(calls.unlock).toBe(1)
    stop()
  })

  it('two live consumers report fullscreen only for their own target and cannot exit each other', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { root: target3d, calls } = stubBrowserApis()
    const target2d = document.createElement('div')
    target2d.requestFullscreen = vi.fn()
    document.body.appendChild(target2d)
    const two = mountFullscreen({ target: () => target2d })
    const three = mountFullscreen({ target: () => target3d })

    three.api.toggleFullscreen()
    await flush()
    expect(three.api.isFullscreen.value).toBe(true)
    expect(two.api.isFullscreen.value).toBe(false)
    expect(calls.lock).toEqual(['landscape'])
    two.api.toggleFullscreen()
    two.api.unlockOrientation()
    expect(calls.exit).toBe(0)
    expect(target2d.requestFullscreen).not.toHaveBeenCalled()
    expect(calls.unlock).toBe(0)
    two.stop()
    expect(calls.unlock).toBe(0)

    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(two.api.isFullscreen.value).toBe(false)
    expect(three.api.isFullscreen.value).toBe(false)
    expect(calls.unlock).toBe(1)
    three.stop()
    expect(calls.unlock).toBe(1)
  })

  it('external exit synchronizes both still-mounted targets without a second unlock', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { root, calls } = stubBrowserApis()
    const otherRoot = document.createElement('div')
    const first = mountFullscreen({ target: () => root })
    const second = mountFullscreen({ target: () => otherRoot })
    first.api.toggleFullscreen()
    await flush()
    expect(first.api.isFullscreen.value).toBe(true)
    expect(second.api.isFullscreen.value).toBe(false)
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(first.api.isFullscreen.value).toBe(false)
    expect(second.api.isFullscreen.value).toBe(false)
    expect(calls.unlock).toBe(1)
    first.stop()
    second.stop()
  })

  it('initializes state from the current target ownership', () => {
    const { root } = stubBrowserApis()
    Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true })
    const owner = mountFullscreen({ target: () => root })
    const other = mountFullscreen({ target: () => document.createElement('div') })
    expect(owner.api.isFullscreen.value).toBe(true)
    expect(other.api.isFullscreen.value).toBe(false)
    owner.stop()
    other.stop()
  })

  it('平板 / 桌面形态：全屏可用但**绝不**请求方向锁', async () => {
    for (const query of [{}, { [PLAYBACK_PHONE_QUERY]: false }]) {
      stubMatchMedia(query)
      const { calls } = stubBrowserApis()
      const { api, stop } = mountFullscreen()
      api.toggleFullscreen()
      await flush()
      expect(api.isFullscreen.value).toBe(true)
      expect(calls.lock).toEqual([])
      stop()
    }
  })

  it('方向锁被拒（系统旋转锁定 / 不支持）时保留全屏会话，不破坏播放', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis({ lock: 'reject' })
    const { api, stop } = mountFullscreen()
    api.toggleFullscreen()
    await flush()
    expect(calls.lock).toEqual(['landscape'])
    expect(api.isFullscreen.value).toBe(true)
    stop()
  })

  it('方向锁 API 缺失时不抛错，也不影响全屏', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    stubBrowserApis({ lock: 'absent' })
    const { api, stop } = mountFullscreen()
    expect(() => api.toggleFullscreen()).not.toThrow()
    await flush()
    expect(api.isFullscreen.value).toBe(true)
    stop()
  })

  it('Fullscreen API 不可用 → 不暴露可用控件（不画假按钮）', () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    stubBrowserApis({ fullscreen: false })
    const { api, stop } = mountFullscreen()
    expect(api.fullscreenSupported.value).toBe(false)
    stop()
  })

  it('requestFullscreen 被拒 → 不改变全屏状态，也不写手工布尔值', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { root } = stubBrowserApis()
    root.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')))
    const { api, stop } = mountFullscreen()
    api.toggleFullscreen()
    await flush()
    expect(api.isFullscreen.value).toBe(false)
    stop()
  })

  it('过期请求的迟到成功不得退出更新请求建立的全屏（同一 target 元素）', async () => {
    stubMatchMedia({})
    const { root, calls } = stubBrowserApis()
    const pending = []
    root.requestFullscreen = vi.fn(() => new Promise((resolve) => {
      pending.push(() => {
        Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
        resolve()
      })
    }))
    const { api, stop } = mountFullscreen()
    api.toggleFullscreen()
    expect(pending).toHaveLength(1)
    api.exitOwnedFullscreen()
    api.toggleFullscreen()
    expect(pending).toHaveLength(2)
    pending[1]()
    await flush()
    expect(api.isFullscreen.value).toBe(true)
    expect(calls.exit).toBe(0)

    pending[0]()
    await flush()
    expect(api.isFullscreen.value).toBe(true)
    expect(calls.exit).toBe(0)
    stop()
  })

  it('生命周期失活（capability 切走）后不再锁横屏', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis()
    let active = false
    const { api, stop } = mountFullscreen({ isActive: () => active })
    api.toggleFullscreen()
    await flush()
    expect(calls.lock).toEqual([])
    active = true
    stop()
  })

  it('作用域销毁时解锁方向（绝不把应用留在锁死方向）', async () => {
    stubMatchMedia({ [PLAYBACK_PHONE_QUERY]: true })
    const { calls } = stubBrowserApis()
    const { api, stop } = mountFullscreen()
    api.toggleFullscreen()
    await flush()
    expect(calls.unlock).toBe(0)
    stop()
    expect(calls.unlock).toBe(1)
  })

  it('exitOwnedFullscreen 只退出本回放根拥有的全屏，别的元素的全屏不碰', async () => {
    stubMatchMedia({})
    const { calls, root } = stubBrowserApis()
    const { api, stop } = mountFullscreen()
    api.exitOwnedFullscreen()
    expect(calls.exit).toBe(0)
    api.toggleFullscreen()
    await flush()
    expect(api.isFullscreen.value).toBe(true)
    api.exitOwnedFullscreen()
    await flush()
    expect(calls.exit).toBe(1)
    expect(api.isFullscreen.value).toBe(false)
    const other = document.createElement('div')
    Object.defineProperty(document, 'fullscreenElement', { value: other, configurable: true })
    api.exitOwnedFullscreen()
    expect(calls.exit).toBe(1)
    expect(root).not.toBe(other)
    stop()
  })
})
