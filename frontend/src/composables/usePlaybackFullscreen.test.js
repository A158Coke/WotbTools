// @vitest-environment happy-dom
/**
 * 回放全屏 / 方向锁的**共享产品语义**（2D 与 3D 共用 composables/usePlaybackFullscreen）。
 *
 * 这些用例针对契约而不是某个组件：两边的全屏按钮最终都走同一实现，所以语义在这里锁一次。
 * 重点覆盖那个最容易出错、也最难在桌面上发现的点：
 *
 *   手机竖屏 412×915  →  点 Fullscreen  →  全屏横屏 915×412
 *
 * 横屏后**内宽 915 > 768**。如果按"宽度 ≥ 768 就是平板"重新判断，刚收起来的
 * controls 会全部展开、全屏锁横屏也永远不会发生。正确判据是 2D 早就用的
 * `PLAYBACK_MOBILE_QUERY`（宽度 < 768，**或**触屏且视口高 ≤ 500）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'
import { PLAYBACK_PHONE_QUERY, usePlaybackPhoneForm } from './usePlaybackPhoneForm.js'
import { usePlaybackFullscreen } from './usePlaybackFullscreen.js'

/** 与仓库既有写法一致：按 query 字符串返回命中与否 */
function stubMatchMedia(matchesByQuery = {}) {
  const mql = (query) => ({
    matches: !!matchesByQuery[query],
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
  vi.stubGlobal('matchMedia', mql)
}

/** happy-dom 没有 Fullscreen / Orientation API：按用例装/卸 */
function stubBrowserApis({ fullscreen = true, lock = 'resolve', unlock = true } = {}) {
  const calls = { request: 0, exit: 0, lock: [], unlock: 0 }
  const root = document.createElement('div')
  document.body.appendChild(root)
  if (fullscreen) {
    root.requestFullscreen = vi.fn(() => {
      calls.request++
      Object.defineProperty(document, 'fullscreenElement', { value: root, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
  }
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: vi.fn(() => {
      calls.exit++
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    }),
  })
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  const orientation = {}
  if (lock !== 'absent') {
    orientation.lock = vi.fn((o) => {
      calls.lock.push(o)
      return lock === 'reject' ? Promise.reject(new Error('not allowed')) : Promise.resolve()
    })
  }
  if (unlock) orientation.unlock = vi.fn(() => { calls.unlock++ })
  // `screen` 始终存在：`lock: 'absent'` 模拟的是「有 screen、但没有 orientation.lock」
  //（Safari / 部分 WebView 的真实形状），而不是 screen 本身缺失。
  vi.stubGlobal('screen', { orientation })
  return { root, calls }
}

function mountFullscreen({ target, isActive = () => true } = {}) {
  const root = document.body.lastElementChild
  const scope = effectScope()
  let api
  scope.run(() => {
    const phone = usePlaybackPhoneForm()
    api = usePlaybackFullscreen({
      target: target ?? (() => root),
      isPhone: phone.isPhone,
      isActive,
    })
  })
  return { api, stop: () => scope.stop() }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

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
    // 竖屏 412×915：命中宽度分支
    const portrait = /max-width:\s*([\d.]+)px/.exec(PLAYBACK_MOBILE_QUERY)[1]
    expect(412).toBeLessThanOrEqual(Number(portrait))
    // 全屏横屏 915×412：宽度分支已失效（915 > 767.98），必须由第二个分支接住
    expect(PLAYBACK_MOBILE_QUERY).toContain('(pointer: coarse) and (max-height: 500px)')
    expect(915).toBeGreaterThan(Number(portrait))
    expect(412).toBeLessThanOrEqual(500)
    // 平板竖屏 768×1024：两个分支都不命中 → tablet 形态（触屏 ≠ 手机）
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
    // 旋转/全屏后查询仍命中 → 形态不变
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
    expect(calls.lock).toEqual([])              // 全屏之前绝不请求方向锁
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
    // 外部退出：直接清 fullscreenElement 再派发事件（等价于用户按 ESC）
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
    // Removing the hidden pane also must not release the visible pane's lock.
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
    expect(api.isFullscreen.value).toBe(true)   // 全屏仍然有效
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
})
