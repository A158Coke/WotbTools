// @vitest-environment happy-dom


// @vitest-environment happy-dom


import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'

import { readFileSync } from 'node:fs'

import { resolve } from 'node:path'

import BattlePlayback from './BattlePlayback.vue'

import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'

import { makeOverview, makePlaybackV2 } from './playbackTestHarness.js'

import { preloadBattleModels } from '../vehicle-models/runtime.js'

import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'

import { TANK_ID_TO_MODEL } from '../vehicle-models/mapping.js'


const i18n = vi.hoisted(() => { globalThis.__battlePlaybackIntegration ||= {}; return globalThis.__battlePlaybackIntegration.i18n ||= { t: vi.fn(key => key) } })


vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'zh' } })
}))


vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))


vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    },
    neptune: {
      src: 'neptune.png', width: 766, height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    },
    malinovka: {
      src: 'malinovka.png', width: 766, height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    },
    map_without_base_geometry: {
      src: 'no-bases.webp',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    }
  }
}))


vi.mock('../utils/mapPalette.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    luminanceOfImage: vi.fn().mockResolvedValue(0.8)
  }
})


const preloadBattleModelsMock = vi.hoisted(() => { globalThis.__battlePlaybackIntegration ||= {}; return globalThis.__battlePlaybackIntegration.preloadBattleModels ||= vi.fn(async () => ({ resolved: new Map(), failed: new Set(), byTank: new Map() })) })
vi.mock('../vehicle-models/runtime.js', () => ({ preloadBattleModels: preloadBattleModelsMock }))


const loadVehiclePortraitMock = vi.hoisted(() => { globalThis.__battlePlaybackIntegration ||= {}; return globalThis.__battlePlaybackIntegration.loadVehiclePortrait ||= vi.fn(async (tankId) => tankId === 2 ? '/portraits/2.webp' : null) })
vi.mock('../vehicle-portraits/runtime.js', () => ({ loadVehiclePortrait: loadVehiclePortraitMock }))


function mountBattlePlayback(props) {
  const wrapper = mount(BattlePlayback, {
    props,
    global: { mocks: { $t: i18n.t } }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}


function mountPlayback(overview = makeOverview(), seekTo = null, dataset = undefined) {
  const finalDataset = dataset === undefined ? makePlaybackV2() : dataset
  return mountBattlePlayback({ overview, seekTo, playbackV2: finalDataset })
}


async function openPanel(wrapper, name) {
  if (!wrapper.find('[data-testid="display-panel"]').exists()) {
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
  }
  if (name === 'events') await wrapper.get('[data-test="pb-panel-events"]').trigger('click')
  await flushPromises()
}


function trackOf(dataset, accountId) {
  return dataset.vehicles.find((vehicle) => vehicle.accountId === accountId)
}


function setPositionSamples(dataset, accountId, samples, startSec = samples[0]?.timeSec ?? 0, endSec = samples.at(-1)?.timeSec ?? startSec) {
  trackOf(dataset, accountId).positionSegments = [{
    knowledge: 'OBSERVED', startSec, endSec, interpolationAllowed: true, samples,
  }]
}


function setLife(dataset, accountId, timeSec) {
  trackOf(dataset, accountId).lifeTransitions = [{
    timeSec, lifeState: 'DESTROYED', destroyedKnownAtSec: timeSec,
  }]
}


let rafCb

const mountedWrappers = []


beforeEach(async () => {
  const prefs = usePlaybackPreferences()
  Object.assign(prefs.labelPrefs, { showPlayerName: false, showTankName: true, showReload: true })
  Object.assign(prefs.hpPrefs, { showHp: true, mode: 'bar' })
  Object.assign(prefs.trailPrefs, { showTrail: true })
  Object.assign(prefs.markerPrefs, { classIcons: false, showStatus: true })
  Object.assign(prefs.uiPrefs, { showTopbar: true, showRoster: true, showKillfeed: true, showBaseStatus: true })
  await nextTick()
  localStorage.clear()
})


afterEach(() => {
  mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
})


function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafCb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}


function detailsHpNum(info) {
  const val = info.find('[data-test="v2-inspector-hp"] .v2-inspector-val').text()
  const m = val.match(/\d+/)
  return m ? m[0] : null
}


function enemyHudNum(wrapper) {
  return wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-num"]').text()
}
describe('PR4 Blocker 2 — Fullscreen（原生 API + resize 契约）', () => {
  const origReqFs = typeof Element.prototype !== 'undefined' ? Element.prototype.requestFullscreen : undefined
  const origExitFs = typeof document !== 'undefined' ? document.exitFullscreen : undefined
  const origFsElDesc = typeof document !== 'undefined' ? Object.getOwnPropertyDescriptor(document, 'fullscreenElement') : undefined

  function setFullscreen(el) {
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true, writable: true })
  }
  function resetFullscreenGlobals() {
    if (origReqFs === undefined) delete Element.prototype.requestFullscreen
    else Element.prototype.requestFullscreen = origReqFs
    if (origExitFs === undefined) delete document.exitFullscreen
    else document.exitFullscreen = origExitFs
    if (origFsElDesc) Object.defineProperty(document, 'fullscreenElement', origFsElDesc)
    else delete document.fullscreenElement
  }
  function stubFullscreenApi() {
    const reqFs = vi.fn().mockResolvedValue(undefined)
    Element.prototype.requestFullscreen = reqFs
    const exitFs = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exitFs
    return { reqFs, exitFs }
  }
  function stubResizeObserver() {
    const callbacks = []
    const RO = vi.fn(function (cb) { callbacks.push(cb); this.observe = vi.fn(); this.unobserve = vi.fn(); this.disconnect = vi.fn() })
    vi.stubGlobal('ResizeObserver', RO)
    return () => (callbacks.length ? (entries) => { for (const cb of callbacks) cb(entries) } : null)
  }
  function stubMatchMedia(matchesByQuery = {}) {
    const mql = (query) => ({
      matches: !!matchesByQuery[query],
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('matchMedia', mql)
    return mql
  }

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetFullscreenGlobals()
  })

  const PLAYBACK_SOURCE_FILES = [
    'src/components/BattlePlayback.vue',
    'src/components/battlePlaybackA.ts',
    'src/components/battlePlaybackB.ts',
    'src/components/battlePlaybackC.ts',
    'src/components/battlePlaybackD.ts',
    'src/components/battlePlaybackE.ts',
  ]
  function readPlaybackSource() {
    return PLAYBACK_SOURCE_FILES
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join(String.fromCharCode(10))
  }

  it('车体不再参与防重叠布局（marker 只按真实位置摆放；位移与虚线整体删除）', () => {
    const src = readPlaybackSource()
    const projectionSrc = readFileSync(resolve(process.cwd(), 'src/composables/usePlaybackVehicleProjection.ts'), 'utf8')
    expect(src).not.toContain('computeTankCollisionLayout')
    expect(src).not.toContain('presentationOffset')
    expect(projectionSrc).toContain('state.markerSize.renderBox.width')
    expect(src).not.toContain('state.markerSize.collisionFootprint.width * view.scale')
  })

  it('keeps the mobile and pc breakpoints strictly complementary', () => {
    const src = readPlaybackSource()
    const mobileMax = /max-width:\s*([\d.]+)px\)/.exec(PLAYBACK_MOBILE_QUERY)
    const pcMin = /matchMedia\('\(min-width:\s*([\d.]+)px\)'\)/.exec(src)
    expect(mobileMax).not.toBeNull()
    expect(pcMin).not.toBeNull()
    expect(Number(mobileMax[1])).toBeLessThan(Number(pcMin[1]))
  })

  it('puts exactly one mutually exclusive form class on the root', async () => {
    const cases = [
      ['mobile', { '(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)': true }],
      ['pc', { '(min-width: 1200px)': true }],
      ['tablet', {}],
    ]
    for (const [expected, queries] of cases) {
      stubRaf()
      stubMatchMedia(queries)
      const wrapper = mountPlayback(makeOverview(), 12)
      await flushPromises()
      const classes = wrapper.find('[data-test="battle-playback"]').classes()
      const forms = classes.filter((c) => c.startsWith('pb-form-'))
      expect(forms).toEqual([`pb-form-${expected}`])
      wrapper.unmount()
      vi.unstubAllGlobals()
    }
  })

  it('wide desktop keeps one primary Transport in the center stack', async () => {
    stubRaf()
    stubMatchMedia({ '(min-width: 1200px)': true })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-controls"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-transport-slot"]').find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-secondary-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
  })

  it('1/2/3/4/5：API 可用 → 按钮可见；进入调 root.requestFullscreen；fullscreenchange 同步；退出调 exitFullscreen；ESC 外部退出恢复', async () => {
    stubRaf()
    const { reqFs, exitFs } = stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const btn = wrapper.find('[data-test="pb-fullscreen"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toContain('enter_fullscreen')
    await btn.trigger('click')
    expect(reqFs).toHaveBeenCalledTimes(1)
    expect(reqFs.mock.instances[0]).toBe(wrapper.find('[data-test="battle-playback"]').element)
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').attributes('aria-label')).toContain('exit_fullscreen')
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')
    expect(exitFs).toHaveBeenCalledTimes(1)
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').attributes('aria-label')).toContain('enter_fullscreen')
  })

  it('6：元素级 Fullscreen API 不可用（iPhone Safari）→ 按钮保留，点击进入 CSS 伪全屏，再点退出，不抛错', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const btn = () => wrapper.find('[data-test="pb-fullscreen"]')
    expect(btn().exists()).toBe(true)
    expect(wrapper.find('.battle-playback').classes()).not.toContain('pb-pseudo-fullscreen')
    await btn().trigger('click')
    await flushPromises()
    expect(wrapper.find('.battle-playback').classes()).toContain('pb-pseudo-fullscreen')
    expect(btn().attributes('aria-label')).toContain('exit_fullscreen')
    expect(document.documentElement.hasAttribute('data-pb-pseudo-fullscreen')).toBe(true)
    await btn().trigger('click')
    await flushPromises()
    expect(wrapper.find('.battle-playback').classes()).not.toContain('pb-pseudo-fullscreen')
    expect(document.documentElement.hasAttribute('data-pb-pseudo-fullscreen')).toBe(false)
  })

  it('7/8/9/10：进入/退出 fullscreen 不 reset currentTime/speed/selected/zoom/pan', async () => {
    stubRaf()
    stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('.pb-range').setValue(12)
    await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const speedBefore = wrapper.get('[data-test="pb-speed-current"]').text()
    const infoBefore = wrapper.find('[data-test="pb-info"]').text()
    const viewportBefore = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.get('[data-test="pb-speed-current"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.get('[data-test="pb-speed-current"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
  })

  it('preserves user zoom/pan when actual Stage dimensions change and fullscreen toggles', async () => {
    stubRaf()
    stubFullscreenApi()
    const getRoCb = stubResizeObserver()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const roCb = getRoCb()
    const stage = wrapper.get('.pb-map-stage').element
    const map = wrapper.get('[data-test="pb-map"]').element
    Object.defineProperty(stage, 'clientHeight', { value: 900, configurable: true })
    roCb([{ target: map, contentRect: { width: 900, height: 900 } }])
    await flushPromises()
    for (let i = 0; i < 4; i++) {
      await wrapper.get('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    const viewport = wrapper.get('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 400, clientY: 300 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 440, clientY: 330 })
    await viewport.trigger('pointerup', { pointerId: 1, clientX: 440, clientY: 330 })
    const camera = { ...wrapper.vm.view }
    const time = wrapper.vm.currentTime
    Object.defineProperty(stage, 'clientHeight', { value: 650, configurable: true })
    roCb([{ target: map, contentRect: { width: 650, height: 650 } }])
    await flushPromises()
    expect({ ...wrapper.vm.view }).toEqual(camera)
    setFullscreen(wrapper.get('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    Object.defineProperty(stage, 'clientHeight', { value: 1000, configurable: true })
    roCb([{ target: map, contentRect: { width: 1000, height: 1000 } }])
    await flushPromises()
    expect({ ...wrapper.vm.view }).toEqual(camera)
    expect(wrapper.vm.currentTime).toBe(time)
    await openPanel(wrapper, 'display')
    await wrapper.get('[data-test="pb-panel-reset"]').trigger('click')
    expect(wrapper.vm.view.scale).toBeLessThan(camera.scale)
  })

  it('§fullscreen-exit：退出 fullscreen 后以 page-mode 几何重新 fit（不带回 fullscreen camera），持久状态保留', async () => {
    stubRaf()
    stubFullscreenApi()
    const getRoCb = stubResizeObserver()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const roCb = getRoCb()
    expect(roCb).toBeTruthy()

    const stageEl = wrapper.find('.pb-map-stage').element
    Object.defineProperty(stageEl, 'clientHeight', { value: 900, configurable: true })
    const mapEl = wrapper.find('[data-test="pb-map"]').element

    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const selBefore = wrapper.find('[data-test="pb-info"]').text()

    const scaleOf = () => {
      const st = wrapper.find('[data-test="pb-viewport"]').attributes('style') || ''
      const m = st.match(/width:\s*([\d.]+)%/)
      return m ? parseFloat(m[1]) / 100 : NaN
    }

    expect(roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])).toBe(undefined)
    await flushPromises()
    const pageScale = scaleOf()
    expect(pageScale).toBeGreaterThan(0)
    expect(pageScale).toBeLessThan(1)

    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1800, height: 1807 } }])
    await flushPromises()
    const fsScale = scaleOf()
    expect(fsScale).not.toBe(pageScale)
    expect(fsScale).toBeGreaterThan(0)

    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(pageScale, 3)

    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(selBefore)
  })

  it('external HUD/Transport never reserve an inset inside the square raster viewport', async () => {
    stubRaf()
    stubFullscreenApi()
    stubMatchMedia({
      '(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)': true,
      '(min-width: 1200px)': false,
    })
    const getRoCb = stubResizeObserver()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const roCb = getRoCb()
    expect(roCb).toBeTruthy()
    const root = wrapper.find('[data-test="battle-playback"]')

    const stageEl = wrapper.find('.pb-map-stage').element
    Object.defineProperty(stageEl, 'clientHeight', { value: 900, configurable: true })
    const mapEl = wrapper.find('[data-test="pb-map"]').element
    const overlayWrapEl = wrapper.find('[data-test="pb-mobile-overlay"]').element
    const overlayEl = wrapper.find('.pb-mobile-overlay-content').element
    Object.defineProperty(overlayWrapEl, 'getBoundingClientRect', {
      value: () => ({ top: 0, left: 0, right: 1200, bottom: 900, width: 1200, height: 900 }),
      configurable: true,
    })
    Object.defineProperty(overlayEl, 'getBoundingClientRect', {
      value: () => {
        const height = overlayEl.clientHeight || 0
        const bottom = 892
        return { top: bottom - height, left: 8, right: 1192, bottom, width: 1184, height }
      },
      configurable: true,
    })
    const scaleOf = () => {
      const st = wrapper.find('[data-test="pb-viewport"]').attributes('style') || ''
      const m = st.match(/width:\s*([\d.]+)%/)
      return m ? parseFloat(m[1]) / 100 : NaN
    }

    Object.defineProperty(overlayEl, 'clientHeight', { value: 0, configurable: true })
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const normalZero = scaleOf()
    Object.defineProperty(overlayEl, 'clientHeight', { value: 140, configurable: true })
    roCb([])
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(normalZero, 6)

    setFullscreen(root.element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const fsReserve = scaleOf()
    Object.defineProperty(overlayEl, 'clientHeight', { value: 0, configurable: true })
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const fsNoReserve = scaleOf()
    expect(fsReserve).toBeCloseTo(fsNoReserve, 6)

    Object.defineProperty(overlayEl, 'clientHeight', { value: 200, configurable: true })
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(fsReserve, 6)
  })

  it('shared roster presentation hides/restores both physical teams without clearing selection/time', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    const time = wrapper.vm.currentTime
    const selected = wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')
    expect(wrapper.findAll('[data-test="pb-roster-row"]')).toHaveLength(3)
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="pb-show-roster"]').setValue(false)
    await flushPromises()
    expect(wrapper.get('[data-test="pb-show-roster"]').element.checked).toBe(false)
    expect(wrapper.classes()).not.toContain('pb-roster-lanes')
    expect(wrapper.findAll('[data-test="pb-roster-row"]')).toHaveLength(0)
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    expect(wrapper.vm.currentTime).toBe(time)
    await wrapper.get('[data-test="pb-show-roster"]').setValue(true)
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-roster-row"]')).toHaveLength(3)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
  })

  it('one-click declutter changes only presentation and restores custom options around an unchanged paused frame', async () => {
    stubRaf()
    const prefs = usePlaybackPreferences()
    prefs.labelPrefs.showPlayerName = true
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click')
    const map = wrapper.getComponent({ name: 'BattleMap' })
    const beforeFacts = map.props('vehicleStates').map(state => ({ id: state.vehicle.accountId, hp: map.props('hpFor')(state.vehicle), pos: state.pos, destroyed: state.destroyed }))
    const time = wrapper.vm.currentTime
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(wrapper.get('[data-test="pb-declutter"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.pb-label-player')).toHaveLength(0)
    expect(wrapper.findAll('.pb-hp-hud')).toHaveLength(0)
    expect(wrapper.findAll('.pb-class-symbol')).toHaveLength(map.props('vehicleStates').length)
    expect(map.props('visibleFloats')).toEqual([])
    expect(map.props('visibleTrails')).toEqual([])
    expect(map.props('selectedAccountId')).toBe(1001)
    expect(map.props('vehicleStates').map(state => ({ id: state.vehicle.accountId, hp: map.props('hpFor')(state.vehicle), pos: state.pos, destroyed: state.destroyed }))).toEqual(beforeFacts)
    expect(wrapper.vm.currentTime).toBe(time)
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(wrapper.findAll('.pb-class-symbol')).toHaveLength(0)
    expect(wrapper.findAll('.pb-label-player').length).toBeGreaterThan(0)
    expect(prefs.hpPrefs.showHp).toBe(true)
    expect(wrapper.vm.currentTime).toBe(time)
  })

  it.each([
    { phone: true, portrait: false, width: 844, compact: true },
    { phone: true, portrait: true, width: 390, compact: false },
    { phone: false, portrait: false, width: 1280, compact: false },
  ])('uses one compact marking row only for phone landscape ($width px)', async ({ phone, portrait, width, compact }) => {
    stubRaf()
    stubFullscreenApi()
    vi.stubGlobal('innerWidth', width)
    stubMatchMedia({
      [PLAYBACK_MOBILE_QUERY]: phone,
      '(orientation: portrait) and (width < 768px)': portrait,
      '(min-width: 1200px)': width >= 1200,
    })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-annotation-entry"]').exists()).toBe(true)
    const controls = wrapper.getComponent({ name: 'PlaybackControls' })
    const controlsInstance = controls.vm.$.uid
    const timeBefore = controls.props('currentTime')
    await wrapper.get('[data-test="pb-annotation-entry"]').trigger('click')
    const toolbar = wrapper.getComponent({ name: 'AnnotationToolbar' })
    expect(toolbar.props('compact')).toBe(compact)
    expect(wrapper.find('[data-test="pb-annotation-entry"]').exists()).toBe(!compact)
    expect(wrapper.findAll('[data-test="pb-annot-close"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-transport-controls"]').element.style.display === 'none').toBe(compact)
    expect(wrapper.get('.pb-transport-row').element.style.display === 'none').toBe(compact)
    expect(controls.props('playing')).toBe(false)
    await wrapper.get('[data-test="pb-annot-TD"]').trigger('click')
    const viewport = wrapper.get('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 99, clientX: 100, clientY: 100 })
    await viewport.trigger('pointerup', { pointerId: 99, clientX: 100, clientY: 100 })
    expect(wrapper.find('[data-test="pb-annot-unit-TD"]').exists()).toBe(true)
    if (compact) {
      setFullscreen(wrapper.element)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
      expect(toolbar.props('compact')).toBe(true)
    }
    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    expect(wrapper.find('[data-test="pb-annotation-entry"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="pb-transport-controls"]').element.style.display).not.toBe('none')
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).vm.$.uid).toBe(controlsInstance)
    expect(controls.props('playing')).toBe(false)
    expect(controls.props('currentTime')).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-annot-unit-TD"]').exists()).toBe(true)
  })

  it('§mobile-fullscreen-contract：手机 fullscreen + landscape（内宽>768）仍保持 mobile mode（bottom-overlay controls、无 rail/details）', async () => {
    stubRaf()
    stubFullscreenApi()
    stubMatchMedia({
      '(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)': true,
      '(min-width: 1200px)': false,
    })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const root = wrapper.find('[data-test="battle-playback"]')
    expect(root.classes()).toContain('pb-device-mobile')

    setFullscreen(root.element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)

    expect(wrapper.findAll('[data-test="pb-controls"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-mobile-overlay"] [data-test="pb-controls"]').exists()).toBe(true)

    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)

    await openPanel(wrapper, 'display')
    expect(wrapper.find('[data-test="pb-panel-events"]').exists()).toBe(true)
    await wrapper.get('[data-testid="display-close"]').trigger('click')

    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-controls"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-mobile-overlay"] [data-test="pb-controls"]').exists()).toBe(true)
  })

  it('§mobile-pointer-regression：未选车辆 mobile fullscreen 下 map pan + marker click 可操作（空 shell 不阻挡 pointer）', async () => {
    stubRaf()
    stubFullscreenApi()
    stubMatchMedia({
      '(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)': true,
      '(min-width: 1200px)': false,
    })
    const getRoCb = stubResizeObserver()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const roCb = getRoCb()
    expect(roCb).toBeTruthy()

    const stageEl = wrapper.find('.pb-map-stage').element
    Object.defineProperty(stageEl, 'clientHeight', { value: 900, configurable: true })
    const mapEl = wrapper.find('[data-test="pb-map"]').element
    Object.defineProperty(mapEl, 'clientWidth', { value: 1200, configurable: true })

    const root = wrapper.find('[data-test="battle-playback"]')
    setFullscreen(root.element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()


    const map = wrapper.find('[data-test="pb-map"]')
    for (let i = 0; i < 3; i++) {
      await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()

    const viewport = wrapper.find('[data-test="pb-viewport"]')
    const before = viewport.attributes('style') || ''
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 500, clientY: 400 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 300, clientY: 250 })
    await viewport.trigger('pointerup', { pointerId: 1, clientX: 300, clientY: 250 })
    await flushPromises()
    expect(viewport.attributes('style')).not.toBe(before)

    await viewport.trigger('click', { clientX: 9999, clientY: 9999 })
    await flushPromises()

    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('§zoom：放大后再缩小能回到完整地图 fit（不再卡在 1x）', async () => {
    stubRaf()
    const getRoCb = stubResizeObserver()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const roCb = getRoCb()
    expect(roCb).toBeTruthy()

    const stageEl = wrapper.find('.pb-map-stage').element
    Object.defineProperty(stageEl, 'clientHeight', { value: 900, configurable: true })
    const mapEl = wrapper.find('[data-test="pb-map"]').element

    const scaleOf = () => {
      const st = wrapper.find('[data-test="pb-viewport"]').attributes('style') || ''
      const m = st.match(/width:\s*([\d.]+)%/)
      return m ? parseFloat(m[1]) / 100 : NaN
    }

    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const fitScale = scaleOf()
    expect(fitScale).toBeGreaterThan(0)
    expect(fitScale).toBeLessThan(1)

    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    await flushPromises()
    expect(scaleOf()).toBeGreaterThan(fitScale)

    for (let i = 0; i < 20; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: 120, clientX: 0, clientY: 0 })
    }
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(fitScale, 3)
  })

  it('secondary Reset View remains reachable and preserves replay time', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await openPanel(wrapper, 'display')
    const time = wrapper.get('[data-test="pb-time"]').text()
    await wrapper.get('[data-test="pb-panel-reset"]').trigger('click')
    expect(wrapper.get('[data-test="pb-time"]').text()).toBe(time)
  })

  it('§3 Right Details：右侧仅保留点击车辆后的详情；未选车辆时无战局/提示重复', async () => {
    stubRaf()
    stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-panel-content-battle"]').exists()).toBe(false)
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-panel-content-battle"]').exists()).toBe(false)
  })

  it('11/12/13：ResizeObserver 容器宽变化 → markerScreen/labelLayout 使用新尺寸（标签恒可见）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -205, y: -196.7, timeSec: 10 }, { x: -205, y: -196.7, timeSec: 14 }], 0, 60)
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    expect(roCb()).toBeTruthy()
    const mapEl = wrapper.find('[data-test="pb-map"]').element
    const tankVisible = (id) => wrapper.find('[data-test="pb-marker-' + id + '"]').find('.pb-label-tank').isVisible()
    Object.defineProperty(mapEl, 'clientWidth', { value: 800, configurable: true })
    roCb()([{ contentRect: { width: 800, height: 800 } }])
    await flushPromises()
    expect(tankVisible(1001)).toBe(true)
    expect(tankVisible(2001)).toBe(true)
    Object.defineProperty(mapEl, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    expect(tankVisible(1001)).toBe(true)
    expect(tankVisible(2001)).toBe(true)
  })

  it('14：Resize 后 selectAt/hitbox 使用新尺寸（同一视觉位置点击选中最近车辆）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -232.5, y: -204.2, timeSec: 10 }, { x: -232.5, y: -204.2, timeSec: 14 }], 0, 60)
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 185, clientY: 1350 })
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA')
  })

  it('15：fullscreen（1600）+ 1×/2× zoom → collision 使用新 viewport 继续正确（标签恒可见）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    trackOf(ds, 2001).playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    const labelsStyle = () => wrapper.find('[data-test="pb-marker-1001"]').find('.pb-presentation').attributes('style') || ''
    expect(labelsStyle()).toContain('scale(1)')
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 96, clientY: 646 })
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 96, clientY: 646 })
    await flushPromises()
    const style2x = labelsStyle()
    expect(style2x).toContain('scale(0.6944')
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('.pb-label-player').isVisible()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-2001"]').find('.pb-label-player').isVisible()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('.pb-label-tank').isVisible()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-2001"]').find('.pb-label-tank').isVisible()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-num"]').isVisible()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-num"]').isVisible()).toBe(true)
  })

  it('16：重复进入/退出 fullscreen 不累积 fullscreenchange listener；unmount 移除', async () => {
    stubRaf()
    stubFullscreenApi()
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(addSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1)
    for (let i = 0; i < 3; i++) {
      setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
      setFullscreen(null)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
    }
    expect(addSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1)
    expect(wrapper.find('[data-test="pb-fullscreen"]').attributes('aria-label')).toContain('enter_fullscreen')
    wrapper.unmount()
    expect(removeSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1)
  })
})

describe('PR5 — HP HUD / combat feedback / detail sidebar（§4–§16）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function fakeClock() {
    const clock = { now: 0 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    return clock
  }

  it('§4/§5/§6 HP HUD：数字+bar 随 timeline 确定性重建；UNKNOWN 显示 —；destroyed 隐藏单车 HP', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [
      { timeSec: 0, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
    ]
    ds.vehicles[1].healthTransitions = []
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    const hud = wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]')
    expect(hud.exists()).toBe(true)
    expect(hud.find('[data-test="pb-hp-num"]').text()).toBe('2600')
    const ehud = wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-hud"]')
    expect(ehud.find('[data-test="pb-hp-num"]').text()).toBe('—')
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 0, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
    ]
    ds.vehicles[1].lifeTransitions = [{ timeSec: 12, lifeState: 'DESTROYED', destroyedKnownAtSec: 12 }]
    const w2 = mountPlayback(overview, 15, ds)
    await flushPromises()
    expect(w2.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(w2.find('[data-test="pb-marker-2001"]').find('.pb-death').exists()).toBe(true)
  })

  it('§4.3 HP HUD 开关：默认开启、localStorage 持久化、关闭隐藏数字/bar/ghost', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [{ timeSec: 0, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' }]
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    await openPanel(wrapper, 'display')
    const toggle = wrapper.find('[data-test="pb-show-hp"]')
    expect(toggle.element.checked).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(true)
    await toggle.setValue(false)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs'))).toEqual({ showHp: false, mode: 'bar' })
    const w2 = mountPlayback(overview, 12, ds)
    await flushPromises()
    await openPanel(w2, 'display')
    expect(w2.find('[data-test="pb-show-hp"]').element.checked).toBe(false)
    expect(w2.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
  })

  it('§10/§20 floating damage：播放跨过 DAMAGE 触发 -400；seek 不触发；wall-clock 到期消失', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    await wrapper.find('.pb-range').setValue(11)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1300
    rafCb(1300)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    clock.now = 2600
    rafCb(2600)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    const overview2 = makeOverview()
    const ds2 = makePlaybackV2()
    setPositionSamples(ds2, 2001, [{ x: -50, y: -50, timeSec: 10 }, { x: -60, y: -60, timeSec: 12 }], 10, 12)
    ds2.vehicles[1].damageLosses = [{ fromSec: 13, toSec: 14, hpLoss: 500, fromHp: 1200, toHp: 700, displayCapacityHp: 1200, transientAllowed: false, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }]
    const w2 = mountPlayback(overview2, 13, ds2)
    await flushPromises()
    Object.defineProperty(w2.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await w2.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1500
    rafCb(1500)
    await flushPromises()
    expect(w2.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
  })

  it('hidden AoI DamageLoss keeps canonical stats/log but suppresses all transient feedback', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events = ds.events.filter((event) => event.type !== 'DAMAGE')
    const enemy = trackOf(ds, 2001)
    enemy.positionSegments = [
      { knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 20,
        samples: [{ timeSec: 0, x: -50, y: -50 }, { timeSec: 20, x: -60, y: -60 }] },
      { knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 40, endSec: 60,
        samples: [{ timeSec: 40, x: -100, y: -100 }, { timeSec: 60, x: -120, y: -120 }] },
    ]
    enemy.healthTransitions = [
      { timeSec: 0, currentHp: 2000, knowledge: 'CURRENT', displayCapacityHp: 2000, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
      { timeSec: 42, currentHp: 1500, knowledge: 'CURRENT', displayCapacityHp: 2000, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
    ]
    enemy.damageLosses = [{
      fromSec: 10, toSec: 42, hpLoss: 500,
      fromHp: 2000, toHp: 1500, displayCapacityHp: 2000, transientAllowed: false,
      attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1,
    }]
    const wrapper = mountPlayback(overview, 9, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 34100
    rafCb(34100)
    await flushPromises()

    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-marker-2001"] .pb-hp-ghost').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-marker-2001"] .pb-hp-flash').exists()).toBe(false)
    const info = wrapper.find('[data-test="pb-info"]')
    const dts = info.findAll('.pb-sb-grid dt')
    const recordedIndex = dts.findIndex((dt) => dt.text() === 'recon.map.playback.damage_recorded')
    expect(info.findAll('.pb-sb-grid dd')[recordedIndex].text()).toBe('500')
    expect(info.findAll('.pb-sb-log-time').map((node) => node.text())).toEqual(['00:42'])
  })

  it('§10.3/§11 HP transition：跨过 DAMAGE 产生 ghost（同阵营浅版）+ fill 立即到新值', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2200, knowledge: 'CURRENT', displayCapacityHp: 2600, relativeFull: false, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafCb(0)
    rafCb(1300)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-2001"]')
    expect(marker.find('.pb-hp-ghost').exists()).toBe(true)
    expect(marker.find('.pb-hp-fill').attributes('style')).toContain('84.61')
  })

  it('§16 kill feed：只显示受害者被击毁（§15.2 无攻击者名）；最多 2 条可见队列（§17）', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    for (let i = 0; i < 4; i++) {
      ds.events.push({ type: 'KILL', timeSec: 13 + i, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    }
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafCb(0)
    rafCb(5100)
    await flushPromises()
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(2)
    const item = wrapper.find('.pb-feed-item')
    expect(item.text()).toContain('T49')
    expect(item.text()).toContain('recon.map.playback.feed_destroyed')
    expect(item.text()).not.toContain('You')
    await wrapper.find('.pb-range').setValue(10)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
  })

  it('§8 detail sidebar：点击打开/切换、seek 保持选中、× 关闭、destroyed 可选', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 0, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
    ]
    setLife(ds, 2001, 12)
    ds.events.push({ type: 'DESTROYED', timeSec: 12, accountId: 2001, targetAccountId: null, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 15, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.exists()).toBe(true)
    expect(info.find('[data-test="pb-sb-tank"]').text()).toBe('T49')
    expect(detailsHpNum(info)).toBeNull()
    expect(info.text()).toContain('recon.map.playback.state_destroyed')
    expect(info.text()).toContain('00:12')
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-tank"]').text()).toBe('Maus')
    await wrapper.find('.pb-range').setValue(20)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    await wrapper.find('[data-test="pb-sb-close"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
  })

  it('Details Panel 按 tankId 懒加载 BlitzKit 车型图；缺图时静默降级', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()

    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    expect(loadVehiclePortrait).toHaveBeenCalledWith(2)
    const portrait = wrapper.find('[data-test="pb-sb-portrait"] img')
    expect(portrait.exists()).toBe(true)
    expect(portrait.attributes('src')).toBe('/portraits/2.webp')
    expect(portrait.attributes('alt')).toBe('T49')

    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    await flushPromises()
    expect(loadVehiclePortrait).toHaveBeenCalledWith(1)
    expect(wrapper.find('[data-test="pb-sb-portrait"]').exists()).toBe(false)
  })

  it('§8.4/§8.5/§9/§18/§20 sidebar：current-state only——无最终战绩分区、无协助伤害行、无最大HP/百分比', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [
      { timeSec: 0, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const info = wrapper.find('[data-test="pb-info"]')
    expect(detailsHpNum(info)).toBe('2600')
    expect(info.text()).not.toContain('recon.map.playback.max_hp')
    expect(info.text()).not.toContain('recon.map.playback.hp_pct')
    expect(info.find('[data-test="pb-sb-assist"]').exists()).toBe(false)
    expect(info.text()).not.toContain('recon.map.playback.final_stats')
    expect(info.text()).not.toContain('1000')
    expect(info.text()).not.toContain('980')
    expect(info.text()).not.toContain('70%')
    expect(info.text()).toContain('400')
  })

  it('伤害记录：hpLoss 驱动；未点亮攻击者显示「来源未知」，不泄露身份', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[0].damageLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 540, attackerAccountId: 2002, attackerReliable: true, damageEventCount: 1 },
    ]
    const wrapper = mountPlayback(overview, 16, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const info = wrapper.find('[data-test="pb-info"]')
    expect(info.text()).toContain('recon.map.playback.source_unknown')
    expect(info.text()).toContain('540')
    const overview2 = makeOverview()
    const ds2 = makePlaybackV2()
    ds2.vehicles[0].damageLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 200, attackerAccountId: 2001, attackerReliable: true, damageEventCount: 1 },
    ]
    const w2 = mountPlayback(overview2, 16, ds2)
    await flushPromises()
    await w2.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(w2.find('[data-test="pb-info"]').text()).toContain('EnemyA')
    expect(w2.find('[data-test="pb-info"]').text()).toContain('200')
  })
})
