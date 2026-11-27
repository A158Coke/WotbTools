// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installWorkspaceTestLifecycle, testState, flushPromises, mountWorkspace, buildState,
  paneMock, withBattles, serveDemo, analyzeDemo, guideContext, demoIdle, choose,
  waitForDemoReady, switchTo, clickDemo, TAB_KEY, tab, capKeys, demoBytes, REPLACE_DECLINED,
  computed, h, KeepAlive, ref, toRaw, useConfirmHost, resetViewerClocks, viewerClocks,
  loadOfficialDemo, OFFICIAL_DEMO, createShellChrome, useReplaySession, useError, useConnectivityNotice, mount,
} from './ReplayWorkspace.test.harness.js'
import ReplayWorkspace from './ReplayWorkspace.vue'
import FileDrop from './FileDrop.vue'
const { hold, authState, nav, formState, connectivityState, nativeImportState, replayStateRef: replayState } = testState

installWorkspaceTestLifecycle()

describe('ReplayWorkspace 回放视窗自动居中', () => {
  let originalScrollIntoView
  let originalInnerHeight
  let originalRO
  let originalMO
  let scrollCalls
  let roCallbacks
  let moCallbacks
  let paneHeights
  let paneReadyState

  const paneHeight = (el) => paneHeights.get(el) ?? 0
  const setStage = (wrapper, { height, ready }) => {
    const pane = wrapper.get('[data-testid="ws-playback"]').element
    paneHeights.set(pane, height)
    const marker = pane.querySelector('[data-testid="ws-playback-pane"]')
    if (marker) {
      if (ready) marker.setAttribute('data-pane-ready', 'true')
      else marker.removeAttribute('data-pane-ready')
    }
    roCallbacks.forEach((ro) => ro.el === pane && ro.cb([]))
    moCallbacks.forEach((mo) => mo.cb([]))
    return pane
  }

  beforeEach(() => {
    scrollCalls = []
    roCallbacks = []
    moCallbacks = []
    paneHeights = new Map()
    paneReadyState = new Map()
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    originalInnerHeight = window.innerHeight
    HTMLElement.prototype.scrollIntoView = function (opts) { scrollCalls.push({ el: this, opts }) }
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const base = originalRect.call(this)
      if (this.dataset?.testid?.startsWith('ws-')) {
        const h = paneHeight(this)
        return { ...base, height: h, top: 0, bottom: h, width: 800, left: 0, right: 800, x: 0, y: 0 }
      }
      return base
    })
    originalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; roCallbacks.push(this) }
      observe(el) { this.el = el }
      disconnect() { this.el = null }
    }
    originalMO = globalThis.MutationObserver
    globalThis.MutationObserver = class {
      constructor(cb) { this.cb = cb; moCallbacks.push(this) }
      observe() {}
      disconnect() {}
    }
    connectivityState.state.value = 'online'
    connectivityState.settled.value = true
    replayState.current = buildState()
    hold.state = replayState.current
    authState.isAdmin.value = false
    withBattles(1)
  })
  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true })
    globalThis.ResizeObserver = originalRO
    globalThis.MutationObserver = originalMO
  })

  const lastBlock = () => scrollCalls.at(-1)?.opts?.block

  it('agent-events 深链：事件流先于 2D 就绪 → 定位信息流（不等待 2D 地图）', async () => {
    const wrapper = mountWorkspace('events')
    await flushPromises()
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })

    const events = wrapper.get('[data-testid="ws-events"]').element
    expect(events.style.display).toBe('')
    expect(wrapper.get('[data-testid="viewer-events-toggle"]').attributes('aria-checked')).toBe('true')
    paneHeights.set(events, 400)
    roCallbacks.forEach((ro) => ro.el === events && ro.cb([]))
    await flushPromises()

    expect(scrollCalls.length).toBeGreaterThan(0)
    expect(scrollCalls.at(-1).el.dataset.testid).toBe('ws-events')
    expect(lastBlock()).toBe('center')

    const playback = wrapper.get('[data-testid="ws-playback"]').element
    paneHeights.set(playback, 1600)
    playback.querySelector('[data-testid="ws-playback-pane"]')?.setAttribute('data-pane-ready', 'true')
    roCallbacks.forEach((ro) => ro.el === playback && ro.cb([]))
    await flushPromises()
    expect(scrollCalls.filter((c) => c.el.dataset.testid === 'ws-events')).toHaveLength(1)
    expect(scrollCalls.some((c) => c.el.dataset.testid === 'ws-playback')).toBe(false)
    wrapper.unmount()
  })

  it('多阶段加载：加载外壳有高度但不就绪 → 不滚动；真实视窗就绪后按最终高度定位一次', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    await switchTo(wrapper, 'playback')
    const before = scrollCalls.length

    setStage(wrapper, { height: 0, ready: false })
    expect(scrollCalls.length).toBe(before)

    setStage(wrapper, { height: 80, ready: false })
    expect(scrollCalls.length).toBe(before)

    setStage(wrapper, { height: 1600, ready: true })
    expect(scrollCalls.length).toBe(before + 1)
    expect(lastBlock()).toBe('start')
    expect(scrollCalls.at(-1).el.dataset.testid).toBe('ws-playback')

    setStage(wrapper, { height: 1700, ready: true })
    expect(scrollCalls.length).toBe(before + 1)
    wrapper.unmount()
  })

  it('就绪后视窗矮于视口 → 垂直居中', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    await switchTo(wrapper, 'playback')
    setStage(wrapper, { height: 400, ready: true })
    expect(lastBlock()).toBe('center')
    wrapper.unmount()
  })

  it('切走时撤销未完成的等待（迟到的就绪不再触发滚动）', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    await switchTo(wrapper, '3d')
    const before = scrollCalls.length
    await switchTo(wrapper, 'data')
    const pane = wrapper.get('[data-testid="ws-3d"]').element
    paneHeights.set(pane, 400)
    roCallbacks.forEach((ro) => ro.el === pane && ro.cb([]))
    moCallbacks.forEach((mo) => mo.cb([]))
    expect(scrollCalls.length).toBe(before)
    wrapper.unmount()
  })

  it('批次目标准备中（多文件未解析）不定位；落定后按真实视窗定位', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    withBattles(2)
    replayState.current.resp.value = null
    replayState.current.analysis.value = { phase: 'parsing', done: 0, total: 2, failure: null }
    await flushPromises()
    await switchTo(wrapper, 'playback')
    const before = scrollCalls.length
    setStage(wrapper, { height: 90, ready: true })
    expect(scrollCalls.length).toBe(before)

    withBattles(2)
    replayState.current.analysis.value = { phase: 'ready', done: 2, total: 2, failure: null }
    await flushPromises()
    setStage(wrapper, { height: 500, ready: true })
    expect(scrollCalls.length).toBe(before + 1)
    expect(lastBlock()).toBe('center')
    wrapper.unmount()
  })

  it('切到数据视图不触发居中（不动用户的数据页滚动位置）', async () => {
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const before = scrollCalls.length
    await switchTo(wrapper, 'data')
    expect(scrollCalls.length).toBe(before)
    wrapper.unmount()
  })

  describe('自动全屏的进入事件序号（Android 手机 App 边沿触发身份）', () => {
    const tokenOf = (wrapper, name) => wrapper.findComponent({ name }).props('autoFullscreenToken')

    it('每次切入查看器递增一次；停留 / 重渲染 / 回到数据页都不递增', async () => {
      withBattles(1)
      const wrapper = mountWorkspace('data')
      await flushPromises()
      await switchTo(wrapper, 'playback')
      const first = tokenOf(wrapper, 'BattlePlaybackPanelMock')
      expect(first).toBeGreaterThan(0)
      await wrapper.vm.$nextTick()
      expect(tokenOf(wrapper, 'BattlePlaybackPanelMock')).toBe(first)
      await switchTo(wrapper, 'data')
      expect(tokenOf(wrapper, 'BattlePlaybackPanelMock')).toBe(first)
      await switchTo(wrapper, 'playback')
      expect(tokenOf(wrapper, 'BattlePlaybackPanelMock')).toBe(first + 1)
    })
  })
})

