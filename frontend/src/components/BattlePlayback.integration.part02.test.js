// @vitest-environment happy-dom

/**
 * Historical end-to-end regression matrix for the playback orchestrator.
 * Component ownership contracts live in BattleMap/PlaybackControls/
 * PlaybackTimeline/VehicleDetailsPanel focused tests; this suite remains
 * intentionally broad so the PR4 extraction does not discard proven replay
 * protocol, visibility, marker, and interaction regressions.
 */

// @vitest-environment happy-dom

/**
 * Historical end-to-end regression matrix for the playback orchestrator.
 * Component ownership contracts live in BattleMap/PlaybackControls/
 * PlaybackTimeline/VehicleDetailsPanel focused tests; this suite remains
 * intentionally broad so the PR4 extraction does not discard proven replay
 * protocol, visibility, marker, and interaction regressions.
 */

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
    // 有底图但 mapBases 未收录几何——新地图上线到基地坐标补齐之间的真实状态。
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


// Secondary settings and Events share the Gear-anchored surface.
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
  // Preferences have one persistent in-memory owner. Clearing storage alone does not
  // reset that owner between tests; restore its logical defaults before each mount.
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


/** canonical V2 Details Panel HP：读 v2-inspector-hp 值区首个数字（去掉 LAST_KNOWN badge / capacity）。 */
function detailsHpNum(info) {
  const val = info.find('[data-test="v2-inspector-hp"] .v2-inspector-val').text()
  const m = val.match(/\d+/)
  return m ? m[0] : null
}


/** marker HUD HP 数字（账号 2001）。 */
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
  /** ResizeObserver stub：捕获回调，测试里手动触发模拟尺寸变化。 */
  function stubResizeObserver() {
    // 组件里不止一个 ResizeObserver（地图一个、Map Workspace 一个）。只留最后一个回调
    // 会让喂进去的 entries 落到错误的观察者身上，于是 mapSize 永远是 0、scale 恒为 1。
    // 广播给全部回调即可——每个回调本来就按 e.target 过滤自己关心的元素。
    const callbacks = []
    const RO = vi.fn(function (cb) { callbacks.push(cb); this.observe = vi.fn(); this.unobserve = vi.fn(); this.disconnect = vi.fn() })
    vi.stubGlobal('ResizeObserver', RO)
    // 保持原 API：返回的是「取回调」的 getter，取到的才是喂 entries 的那个函数。
    return () => (callbacks.length ? (entries) => { for (const cb of callbacks) cb(entries) } : null)
  }
  /** matchMedia stub：按 query 返回 matches（用于模拟移动端/大桌面判定）。 */
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

  // 碰撞必须喂渲染方框，不能喂各向异性的车体矩形：贴图按航向在方框内旋转，方框才是
  // 屏幕外接盒。喂车体矩形时横向行驶/接近垂直的两车判定失准，视觉上仍然叠在一起。
  it('车体不再参与防重叠布局（marker 只按真实位置摆放；位移与虚线整体删除）', () => {
    // happy-dom 下 import.meta.url 不是 file URL，用 cwd 相对路径读源码。
    const src = readFileSync(resolve(process.cwd(), 'src/components/BattlePlayback.vue'), 'utf8')
    // #820 Agent C：vehicleStates 投影 owner 出仓到 usePlaybackVehicleProjection；负向锁仍看宿主。
    const projectionSrc = readFileSync(resolve(process.cwd(), 'src/composables/usePlaybackVehicleProjection.ts'), 'utf8')
    expect(src).not.toContain('computeTankCollisionLayout')
    expect(src).not.toContain('presentationOffset')
    // 标记尺寸仍按渲染方框（供命中盒/环/标签布局用），但不再喂给碰撞求解器
    expect(projectionSrc).toContain('state.markerSize.renderBox.width')
    expect(src).not.toContain('state.markerSize.collisionFootprint.width * view.scale')
  })

  // 三档必须严格互补：mobile 的上界与 pc 的下界不能重叠，否则同一视口既是
  // mobile 形态、又命中 pc 的媒体查询，互斥性就是假的。
  it('keeps the mobile and pc breakpoints strictly complementary', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/useBattlePlaybackLifecycle.js'), 'utf8')
    // mobile 形态的唯一来源是 shared/breakpoints 的 PLAYBACK_MOBILE_QUERY
    const mobileMax = /max-width:\s*([\d.]+)px\)/.exec(PLAYBACK_MOBILE_QUERY)
    const pcMin = /matchMedia\('\(min-width:\s*([\d.]+)px\)'\)/.exec(src)
    expect(mobileMax).not.toBeNull()
    expect(pcMin).not.toBeNull()
    expect(Number(mobileMax[1])).toBeLessThan(Number(pcMin[1]))
  })

  // §three-forms：根元素任何时刻只挂一个形态类。互斥性由这里保证，而不是靠媒体查询
  // 之间的算术——旧写法里一档的规则会以更高特异性压掉另一档，反复打穿。
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

  // Desktop primary controls belong to the same center Transport.
  it('wide desktop keeps one primary Transport in the center stack', async () => {
    stubRaf()
    stubMatchMedia({ '(min-width: 1200px)': true })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-controls"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-transport-slot"]').find('[data-test="pb-controls"]').exists()).toBe(true)
    // 二级入口是 Transport 上的 gear；宽档不再有常驻左栏，也不预渲染 Display 浮面
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
    // 进入：requestFullscreen 调用在 Battle Playback root 上
    await btn.trigger('click')
    expect(reqFs).toHaveBeenCalledTimes(1)
    expect(reqFs.mock.instances[0]).toBe(wrapper.find('[data-test="battle-playback"]').element)
    // fullscreenchange + fullscreenElement=root → 显示退出全屏
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').attributes('aria-label')).toContain('exit_fullscreen')
    // 点击退出 → document.exitFullscreen
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')
    expect(exitFs).toHaveBeenCalledTimes(1)
    // ESC/外部退出：fullscreenElement=null → 状态恢复
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
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click') // 2×
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 }) // 选中
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const speedBefore = wrapper.get('[data-test="pb-speed-current"]').text()
    const infoBefore = wrapper.find('[data-test="pb-info"]').text()
    const viewportBefore = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    // 进入
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.get('[data-test="pb-speed-current"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
    // 退出
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

    // happy-dom 无真实布局：给 stage 高度、给 map 宽度（经 ResizeObserver 写入 mapSize）。
    const stageEl = wrapper.find('.pb-map-stage').element
    Object.defineProperty(stageEl, 'clientHeight', { value: 900, configurable: true })
    const mapEl = wrapper.find('[data-test="pb-map"]').element

    // 持久状态：选中车辆 + 记录时间/所选信息
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const selBefore = wrapper.find('[data-test="pb-info"]').text()

    const scaleOf = () => {
      const st = wrapper.find('[data-test="pb-viewport"]').attributes('style') || ''
      const m = st.match(/width:\s*([\d.]+)%/)
      return m ? parseFloat(m[1]) / 100 : NaN
    }

    // 初始 page fit：地图近方形(766×769)，stage 高 900、map 宽 1200 → scale < 1（contain 居中）
    expect(roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])).toBe(undefined)
    await flushPromises()
    const pageScale = scaleOf()
    expect(pageScale).toBeGreaterThan(0)
    expect(pageScale).toBeLessThan(1)

    // 进入 fullscreen：几何更宽 → 重新 fit，scale 变化（不等于 page fit）
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1800, height: 1807 } }])
    await flushPromises()
    const fsScale = scaleOf()
    expect(fsScale).not.toBe(pageScale)
    expect(fsScale).toBeGreaterThan(0)

    // 退出 fullscreen → 重新以 page 宽 fit：scale 回到 page fit（不带回 fullscreen camera）
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(pageScale, 3)

    // 持久状态保留（currentTime / selected vehicle）
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
    // §safeInsets-DOM：生产逻辑按 overlay wrapper bottom → content top 的真实占用区计算。
    // happy-dom 不做 CSS layout，因此这里显式提供与 transient bottom:8px 契约一致的 rect。
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

    // --- normal mobile：controls 为 transient overlay（默认 opacity:0）。即使 content 高≠0，
    //    因非 fullscreen → bottom=0 → 地图不为其留黑边（scale 不变）。 ---
    Object.defineProperty(overlayEl, 'clientHeight', { value: 0, configurable: true })
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const normalZero = scaleOf()
    Object.defineProperty(overlayEl, 'clientHeight', { value: 140, configurable: true })
    roCb([])
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(normalZero, 6)

    // --- fullscreen mobile：controls 始终显示 → reserve bottom=140 → 更小 fit；
    //    content 高改 0 → 不再 reserve → 更大 fit。 ---
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

    // --- content reflow：fullscreen mobile content 高度变化 → safe 几何更新（200>140 → reserve 更多 → 更小 fit）。 ---
    Object.defineProperty(overlayEl, 'clientHeight', { value: 200, configurable: true })
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(fsReserve, 6)
  })

  /**
   * 需求 1D/1E：名册可见性是**共享呈现偏好**（uiPrefs.showRoster，与 3D 同一个 key），
   * 手机形态下名册是**临时面**而不是常驻侧边车道。
   */
  it('shared roster presentation hides/restores both physical teams without clearing selection/time', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    const time = wrapper.vm.currentTime
    const selected = wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')
    expect(wrapper.findAll('[data-test="pb-roster-row"]')).toHaveLength(3)
    // #727：名册开关只在 Display 面里（地图上不再放常驻控件），所以先从 gear 打开那块面
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
    // #727：一键防遮只在 Display 面里
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
    // F2：紧凑标注态整行隐藏（含折叠按钮）——标注工具条接替传输行，不额外占一行；
    // 隐藏的折叠按钮不再暴露 aria-expanded（其指向的内容此时不可见）。
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
    // 移动端：primary pointer=coarse 且视口<=1200（手机横屏内宽>768 仍命中）。大桌面 1200 判定为 false。
    stubMatchMedia({
      '(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)': true,
      '(min-width: 1200px)': false,
    })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const root = wrapper.find('[data-test="battle-playback"]')
    // 判定为移动设备 → root 带 pb-device-mobile
    expect(root.classes()).toContain('pb-device-mobile')

    // 进入 fullscreen（相当于手机锁横屏）→ isFullscreen 为真，但必须仍为 mobile mode
    setFullscreen(root.element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)

    // controls 在 bottom overlay：手机形态只由 overlay 承载，不存在第二份控件条
    expect(wrapper.findAll('[data-test="pb-controls"]')).toHaveLength(1)
    // overlay 内有 controls：mobile mode 以 bottom-overlay controls 承载
    expect(wrapper.find('[data-test="pb-mobile-overlay"] [data-test="pb-controls"]').exists()).toBe(true)

    // §details-blocker：未选中车辆时 shell 空壳且不带 pb-details-active（不遮挡/不 tint/不接管 pointer）
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)

    await openPanel(wrapper, 'display')
    expect(wrapper.find('[data-test="pb-panel-events"]').exists()).toBe(true)
    await wrapper.get('[data-testid="display-close"]').trigger('click')

    // 选中车辆 → details 以 sheet/drawer 出现，且 shell 进入 active（接管 pointer）
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    // 退出 fullscreen 后仍保持 mobile overlay controls（不产生第二份常驻控件条）
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

    // 进入 mobile fullscreen（横屏）
    const root = wrapper.find('[data-test="battle-playback"]')
    setFullscreen(root.element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()

    // 空 shell：未选中车辆，无 pb-details-active → shell 不接管 pointer

    // 先 zoom in，让地图走出 contain-fit、产生可平移余量（真实手势路径：手指拖动）
    const map = wrapper.find('[data-test="pb-map"]')
    for (let i = 0; i < 3; i++) {
      await map.trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()

    // pan：单指拖动超阈值（>5px）→ viewport translate 应变化（地图未被空 shell 阻挡）
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    const before = viewport.attributes('style') || ''
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 500, clientY: 400 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 300, clientY: 250 })
    await viewport.trigger('pointerup', { pointerId: 1, clientX: 300, clientY: 250 })
    await flushPromises()
    expect(viewport.attributes('style')).not.toBe(before)

    // 手势后的首个 click 会被 suppressClick 吞掉，先 drain 一次（off-map，不选中）
    await viewport.trigger('click', { clientX: 9999, clientY: 9999 })
    await flushPromises()

    // marker click 仍可选中
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

    // 初始 fit：map 宽 1200、近方形(766×769)、stage 高 900 → fitScale < 1
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const fitScale = scaleOf()
    expect(fitScale).toBeGreaterThan(0)
    expect(fitScale).toBeLessThan(1)

    // 放大 3 步（deltaY<0）
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 0, clientY: 0 })
    }
    await flushPromises()
    expect(scaleOf()).toBeGreaterThan(fitScale)

    // 缩小足够多步（deltaY>0）→ 回到 fitScale（缩放下限 = 完整地图 fit，不是 1x）
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
    // 右侧列只在**真的有内容**时才存在：名册关闭、也没选车时它整列不渲染，
    // 否则空壳会占住「地图列 + 详情列」的第二轨，正方形只能拿到第一轨的宽度
    // （详见 styles/playback-workspace.css 的 `.pb-details-column`）。
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-panel-content-battle"]').exists()).toBe(false)
    // 进入 fullscreen + 点击车辆 → 详情就是右侧列本身（全屏下不走浮窗）
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
    expect(roCb()).toBeTruthy() // RO 已挂载
    const mapEl = wrapper.find('[data-test="pb-map"]').element
    const tankVisible = (id) => wrapper.find('[data-test="pb-marker-' + id + '"]').find('.pb-label-tank').isVisible()
    // 800 宽：两车屏幕距 ≈26.6px < 标签宽 30.4px → 冲突 → 标签走稳定 lane，但不隐藏
    Object.defineProperty(mapEl, 'clientWidth', { value: 800, configurable: true })
    roCb()([{ contentRect: { width: 800, height: 800 } }])
    await flushPromises()
    expect(tankVisible(1001)).toBe(true)
    expect(tankVisible(2001)).toBe(true)
    // 800 → 1600（fullscreen 容器变化）：无冲突 → 标签仍可见
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
    // 1600 宽：A 中心 x=200、B 中心 x=180（generic hitbox 半宽 ≈10.4）
    // 点击 A 按钮 (185, 1350)：命中 B（最近）；若仍用 800 旧尺寸（A=100/B=90）则 185 命中不了 → 选 A
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 185, clientY: 1350 })
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA') // B = 2001 = EnemyA
  })

  it('15：fullscreen（1600）+ 1×/2× zoom → collision 使用新 viewport 继续正确（标签恒可见）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    // 同位 → 任意尺寸/zoom 都冲突（screen 尺寸恒定）
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
    expect(labelsStyle()).toContain('scale(1)') // 1× 反缩放
    // 2× zoom：wheel 锚点 = 车辆所在容器 px（(96,646)，1× 时内容 (95.75,646.2)）——
    // 避免 zoom 的 pan 把车辆移出 viewport 被裁剪（裁剪是真实机制，但本测试验证的是 zoom 后 collision）
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 96, clientY: 646 })
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 96, clientY: 646 })
    await flushPromises()
    const style2x = labelsStyle()
    expect(style2x).toContain('scale(0.6944') // 2× 反缩放
    // 2× 下同位冲突：标签与 HP 恒可见（不再隐藏/位移判定）
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
    expect(addSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1) // 未重复 add
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

  /** performance.now 受控时钟（驱动 wall-clock transient）。 */
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
    ds.vehicles[1].healthTransitions = [] // 敌方无采样 → UNKNOWN
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    const hud = wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]')
    expect(hud.exists()).toBe(true)
    expect(hud.find('[data-test="pb-hp-num"]').text()).toBe('2600')
    const ehud = wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-hud"]')
    expect(ehud.find('[data-test="pb-hp-num"]').text()).toBe('—')
    // destroyed（lifeState）→ 隐藏单车 HP number+bar
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 0, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
    ]
    ds.vehicles[1].lifeTransitions = [{ timeSec: 12, lifeState: 'DESTROYED', destroyedKnownAtSec: 12 }]
    const w2 = mountPlayback(overview, 15, ds)
    await flushPromises()
    // §18/§19：DESTROYED（lifeState）隐藏单车 HP，不得靠 hp===0 归零展示
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
    // 关闭后隐藏地图 HP 数字/bar/ghost，但 marker 仍在
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs'))).toEqual({ showHp: false, mode: 'bar' })
    // 重新挂载读取持久化
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
    // EnemyA 位置流覆盖 [10,20]：事件时刻 12 覆盖 → 允许反馈
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    // 无布局环境需提供地图宽度（floating 位置锚定 markerScreen）
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    // seek 到 12（恰好事件时刻）不触发（§20.1）
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    // 从 11 播放跨过 12 → 触发
    await wrapper.find('.pb-range').setValue(11)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1300
    rafCb(1300) // +1.3s → t=12.3 跨过 DAMAGE@12
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    // wall-clock 到期（>1s）消失（此时 rafCb 仍指向 wrapper 的 frame）
    clock.now = 2600
    rafCb(2600)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    // 失察期间受击不跳伤害（事件时刻无位置流覆盖）
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
    rafCb(1500) // t=14.5 跨过 DAMAGE@14（失察期）
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
    rafCb(34100) // t≈43：跨过完整 hidden-window loss，canonical facts remain visible
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
    // Blocker 3：ghost 需要 pct，而 pct 只在进场满血已证明（OBSERVED_EXACT）时存在——
    // 本测试用已证明 entryHp=2600 验证真实百分比 ghost/填充
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2200, knowledge: 'CURRENT', displayCapacityHp: 2600, relativeFull: false, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafCb(0)
    rafCb(1300) // t=12.3 跨过 DAMAGE@12
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-2001"]')
    expect(marker.find('.pb-hp-ghost').exists()).toBe(true)
    expect(marker.find('.pb-hp-fill').attributes('style')).toContain('84.61') // 2200/2600（已证明 entryHp）
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
    rafCb(5100) // t=17.1 跨过 4 条 KILL
    await flushPromises()
    // §17：最多 2 条 visible，第 3 条及以后排队（从最旧挤出）
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(2)
    const item = wrapper.find('.pb-feed-item')
    expect(item.text()).toContain('T49') // 受害者坦克名
    expect(item.text()).toContain('recon.map.playback.feed_destroyed')
    expect(item.text()).not.toContain('You') // 不显示攻击者（§15.2）
    // seek 不补 feed
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
    // destroyed 车仍可选中
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.exists()).toBe(true)
    expect(info.find('[data-test="pb-sb-tank"]').text()).toBe('T49')
    // §21：已击毁状态明确，不重点展示 0 HP
    expect(detailsHpNum(info)).toBeNull()
    expect(info.text()).toContain('recon.map.playback.state_destroyed')
    expect(info.text()).toContain('00:12') // destroyed at / last spotted
    // 点击另一辆切换
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-tank"]').text()).toBe('Maus')
    // seek 保持选中
    await wrapper.find('.pb-range').setValue(20)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    // × 关闭
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
    // §41：tankopedia base HP 不得包装成「最大 HP」展示
    expect(info.text()).not.toContain('recon.map.playback.max_hp')
    expect(info.text()).not.toContain('recon.map.playback.hp_pct')
    // §20：assist 行删除（无逐时间点来源）
    expect(info.find('[data-test="pb-sb-assist"]').exists()).toBe(false)
    // §18/BUG-5：最终战绩分区整体删除（整场结算值不得混入 current-state 面板）
    expect(info.text()).not.toContain('recon.map.playback.final_stats')
    expect(info.text()).not.toContain('1000')
    expect(info.text()).not.toContain('980')
    expect(info.text()).not.toContain('70%')
    // 当前统计（t=12：1001 造成的 400 已发生，来自 2001 的 damageLosses attribution）
    expect(info.text()).toContain('400')
  })

  it('伤害记录：hpLoss 驱动；未点亮攻击者显示「来源未知」，不泄露身份', async () => {
    stubRaf()
    const overview = makeOverview()
    // 2002 攻击 1001（hpLoss 540），但 2002 无位置流覆盖 → 来源未知
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
    // 可见攻击者（2001 覆盖）→ 显示玩家名
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
