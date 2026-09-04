// @vitest-environment happy-dom

/**
 * Historical end-to-end regression matrix for the playback orchestrator.
 * Component ownership contracts live in BattleMap/PlaybackControls/
 * PlaybackTimeline/VehicleDetailsPanel focused tests; this suite remains
 * intentionally broad so the PR4 extraction does not discard proven replay
 * protocol, visibility, marker, and interaction regressions.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import BattlePlayback from './BattlePlayback.vue'
import { makeOverview, makePlaybackV2 } from './playbackTestHarness.js'
import { preloadBattleModels } from '../vehicle-models/runtime.js'
import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'zh' } })
}))

vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
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

vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({
    resolved: new Map(),
    failed: new Set(),
    byTank: new Map(),
  })),
}))

vi.mock('../vehicle-portraits/runtime.js', () => ({
  loadVehiclePortrait: vi.fn(async (tankId) => tankId === 2 ? '/portraits/2.webp' : null),
}))

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

// 左侧二级菜单：面板内容现在由左侧导航项（pb-rail-*）打开。
async function openPanel(wrapper, name) {
  const tab = wrapper.find(`[data-test="pb-rail-${name}"]`)
  if (tab.attributes('aria-expanded') !== 'true') await tab.trigger('click')
  await flushPromises()
}

describe('Supremacy 基地 overlay', () => {
  // 底图不再烤基地图形，几何来自 mapBases（客户端场景），状态来自 baseStates（回放）。
  // 这条断言覆盖 BattlePlayback -> BattleMap 的 bases 接线，接线断掉时必须失败。
  it('renders one circle per Supremacy base and colours it from baseStates', async () => {
    const dataset = makePlaybackV2({
      baseStates: [
        { timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null },
        { timeSec: 0, baseId: 'B', ownerTeam: 2, capturingTeam: null, captureProgress: null },
        { timeSec: 0, baseId: 'C', ownerTeam: null, capturingTeam: 2, captureProgress: 40 },
      ],
    })
    const wrapper = await mountPlayback(makeOverview(), null, dataset)

    // holland 在 mapBases 里是 3 个争霸基地
    expect(wrapper.findAll('[data-test="pb-bases"] .pb-base-circle')).toHaveLength(3)
    expect(wrapper.find('[data-test="pb-bases"]').text()).toContain('A')
    // 圆圈颜色 = 当前归属；C 还没易主，所以是 neutral 而不是占领方颜色
    expect(wrapper.findAll('.pb-base-friendly_controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-base-enemy_controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-base-neutral')).toHaveLength(1)
    // 进度水位只画在正在被占的 C 上，颜色是占领方（敌方）
    const fills = wrapper.findAll('[data-test="pb-base-fill"]')
    expect(fills).toHaveLength(1)
    expect(fills[0].classes()).toContain('pb-capture-enemy')
    // 水位由 clipPath 的矩形高度决定：40% 进度 → 高度是直径的 40%
    const clipRects = wrapper.findAll('clipPath rect')
    expect(clipRects).toHaveLength(3)
    const diameter = Number(clipRects[2].attributes('width'))
    expect(Number(clipRects[2].attributes('height'))).toBeCloseTo(diameter * 0.4, 3)
  })

  // 非争霸战（baseStates 为空，或旧 producer 未发该字段）不得靠地图几何画出基地。
  // HUD chip 是 fallback：地图能画基地时不重复；mapBases 未收录该图时 HUD 必须仍然显示，
  // 否则新地图上线到素材补齐之间会完全看不到基地归属。
  it('keeps the HUD base chips when mapBases has no geometry for the map', async () => {
    const states = [
      { timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null },
      { timeSec: 0, baseId: 'B', ownerTeam: 2, capturingTeam: null, captureProgress: null },
    ]
    const overview = { ...makeOverview(), mapCode: 'map_without_base_geometry' }
    const dataset = { ...makePlaybackV2({ baseStates: states }), mapCode: 'map_without_base_geometry' }
    const wrapper = await mountPlayback(overview, null, dataset)

    expect(wrapper.findAll('.pb-base-circle')).toHaveLength(0)
    const hud = wrapper.find('[data-test="pb-hud-bases"]')
    expect(hud.exists()).toBe(true)
    expect(hud.text()).toContain('A')
    expect(hud.text()).toContain('B')
  })

  // 反向：地图画得出基地时 HUD 不再重复一份。
  it('hides the HUD base chips once the map renders the bases', async () => {
    const dataset = makePlaybackV2({
      baseStates: [{ timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null }],
    })
    const wrapper = await mountPlayback(makeOverview(), null, dataset)
    expect(wrapper.findAll('.pb-base-circle').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-test="pb-hud-bases"]').exists()).toBe(false)
  })

  // wire 契约不保证 baseStates 按 timeSec 排序。靠数组顺序取「当前状态」会选中过期的一条，
  // 表现就是车早已离开、占领已清空，地图上却还画着进度。
  it('uses the latest transition by time, not by array order', async () => {
    const dataset = makePlaybackV2({
      baseStates: [
        // 故意乱序：清空（t=5）排在开始占领（t=1）之前
        { timeSec: 5, baseId: 'A', ownerTeam: null, capturingTeam: null, captureProgress: 60 },
        { timeSec: 1, baseId: 'A', ownerTeam: null, capturingTeam: 1, captureProgress: 60 },
      ],
    })
    const wrapper = await mountPlayback(makeOverview(), 8, dataset)
    expect(wrapper.findAll('[data-test="pb-base-fill"]')).toHaveLength(0)
  })

  // 契约：省略的字段保留旧值，所以放弃占领后 captureProgress 仍是旧数，只有 capturingTeam 归 null。
  // 水位必须跟着 capturingTeam 消失，否则地图上会一直挂着一个没踩下来的进度。
  it('clears the capture fill when the capture is abandoned but progress is retained', async () => {
    const dataset = makePlaybackV2({
      baseStates: [
        { timeSec: 0, baseId: 'A', ownerTeam: null, capturingTeam: 2, captureProgress: 80 },
        { timeSec: 5, baseId: 'A', ownerTeam: null, capturingTeam: null, captureProgress: 80 },
      ],
    })
    const wrapper = await mountPlayback(makeOverview(), 6, dataset)
    expect(wrapper.findAll('[data-test="pb-base-fill"]')).toHaveLength(0)
    // 圆圈本身仍在（基地还是中立），只是没有进度水位
    expect(wrapper.findAll('.pb-base-circle')).toHaveLength(3)
  })

  it('renders no base circles when the replay has no Supremacy base tracks', async () => {
    const wrapper = await mountPlayback(makeOverview(), null, makePlaybackV2({ baseStates: [] }))
    expect(wrapper.findAll('.pb-base-circle')).toHaveLength(0)
    expect(wrapper.findAll('[data-test="pb-base-fill"]')).toHaveLength(0)
  })

  it('no longer draws the analysis grid or the nine-grid region outlines', async () => {
    const wrapper = await mountPlayback()
    expect(wrapper.findAll('.pb-cell')).toHaveLength(0)
    expect(wrapper.findAll('.pb-region-line')).toHaveLength(0)
  })
})

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

describe('BattlePlayback', () => {
  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders controls, progress and vehicles (never-observed hidden)', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('00:12 / 01:00')
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('NeverSeen')
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
  })

  it('Blocker 2：V2 dataset 为核心输入——overview 为 null 时 PRIMARY 仍渲染', async () => {
    stubRaf()
    // V2 权威元数据（mapCode/friendlyTeam/recorderAccountId/arenaBonusType）都在 dataset 内，
    // MapOverview 缺失时 Battle Playback PRIMARY 必须可渲染（不被 map-overview artifact 锁死）。
    const v2Only = {
      ...makePlaybackV2(),
      mapCode: 'holland',
      friendlyTeam: 1,
      recorderAccountId: 1001,
      arenaBonusType: 1,
    }
    const wrapper = mountBattlePlayback({ overview: null, seekTo: null, playbackV2: v2Only })
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    // 事件面板默认折叠（左侧二级菜单未打开），事件入口为左侧 pb-rail-events。
    expect(wrapper.find('[data-test="pb-event-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-rail-events"]').exists()).toBe(true)
  })

  it('seeks on seekTo and pauses', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 30)
    await flushPromises()
    expect(wrapper.text()).toContain('00:30 / 01:00')
  })

  it('drives marker + inspector from V2 canonical tracks (AC-10)', async () => {
    stubRaf()
    const wrapper = mountBattlePlayback({ overview: makeOverview(), playbackV2: makePlaybackV2(), seekTo: 30 })
    await flushPromises()
    // t=30：EnemyA 在 V2 中已 DESTROYED（lifeTransition 25s）→ 存在 destroyed marker
    // （legacy overview 里 EnemyA deathSec=null，因此 destroyed 只能来自 V2 lifeTransition，
    //  证明 V2 canonical fact 驱动渲染，满足 AC-10）。
    const destroyedMarkers = wrapper.findAll('.pb-vehicle.pb-destroyed')
    expect(destroyedMarkers.length).toBeGreaterThan(0)
  })

  it('play advances time via RAF', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.pause')
    rafCb(0)
    rafCb(1000)
    await flushPromises()
    expect(wrapper.text()).toContain('00:01 / 01:00')
  })

  it('Event Panel is collapsed by default and event rows seek while paused', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    expect(wrapper.find('[data-test="pb-event-panel"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-progress .pb-marker')).toHaveLength(0)
    await openPanel(wrapper, 'events')
    const events = wrapper.findAll('[data-test="pb-event"]')
    expect(events).toHaveLength(1)
    await events.find(event => event.text().includes('event_DAMAGE')).trigger('click')
    expect(wrapper.find('[data-test="pb-event-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('recon.map.playback.event_DAMAGE')
    expect(wrapper.text()).toContain('400')
    expect(wrapper.find('.pb-time').text()).toContain('00:12 / 01:00')
    expect(wrapper.find('[data-test="pb-play"] .pb-control-label').text()).toBe('recon.map.playback.play')
  })

  function gapOverview() {
    const overview = makeOverview()
    // EnemyA 位置上报覆盖 [10,20]（OBSERVED）。samples 稀疏（14→20 采样间隔 >5s）——
    // V2 中「位置流覆盖」由 OBSERVED 段表达，段内允许插值，不因采样稀疏而降级 last-known。
    const ds = makePlaybackV2()
    ds.vehicles[1].lifeTransitions = [] // EnemyA 未 destroyed（原 makePlaybackV2 有 DESTROYED@25）
    ds.vehicles[1].positionSegments = [
      { knowledge: 'OBSERVED', startSec: 10, endSec: 20,
        samples: [
          { timeSec: 10, x: -50, y: -50 },
          { timeSec: 14, x: -90, y: -90 },
          { timeSec: 20, x: -100, y: -100 },
        ] },
    ]
    return { overview, ds }
  }

  it('gap vehicles stay at the faded last-known position instead of disappearing', async () => {
    stubRaf()
    // t=25 超出 observed position segment [10,20]：位置流未覆盖 → 真实 gap，淡化停驻
    const { overview, ds } = gapOverview()
    const wrapper = mountPlayback(overview, 25, ds)
    await flushPromises()
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).toContain('pb-last-known')
  })

  it('dragging the progress bar pauses immediately and stays paused', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.pause')
    await wrapper.find('.pb-range').trigger('pointerdown')
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.play')
    rafCb(1000) // 残留 RAF 回调不得再推进时间
    await flushPromises()
    expect(wrapper.text()).toContain('00:00 / 01:00')
  })

  it('keyboard Space and arrows control playback without stealing input focus', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 11)
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toContain('00:16 / 01:00')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toContain('00:16 / 01:00')
    input.remove()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.pause')
  })

  it('a single play click schedules exactly one RAF loop', async () => {
    let rafCalls = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCalls++
      rafCb = cb
      return rafCalls
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(rafCalls).toBe(1)
    await wrapper.find('[data-test="pb-play"]').trigger('click') // 暂停
    await wrapper.find('[data-test="pb-play"]').trigger('click') // 再次播放
    expect(rafCalls).toBe(2)
  })

  it('covered vehicles are not faded even when sampled route points have a >5s gap (position stream coverage)', async () => {
    stubRaf()
    // t=20 落在 observed position segment [10,20] 内（位置上报中）但 route 采样点 14→40 gap>5s：
    // 不得因 live=null 误判 lastKnown（修复「位置流覆盖却半透明」）
    const { overview, ds } = gapOverview()
    const wrapper = mountPlayback(overview, 20, ds)
    await flushPromises()
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).not.toContain('pb-last-known')
  })

  it('re-reported enemies restore opacity in the second coverage interval (position coverage gap → resume)', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    trackOf(ds, 2001).lifeTransitions = []
    // EnemyA：10–20 覆盖 → 位置流中断（gap）→ 40–60 再覆盖（两段区间）；t=50 在第二段区间内
    trackOf(ds, 2001).positionSegments = [
      { knowledge: 'OBSERVED', startSec: 10, endSec: 20, interpolationAllowed: true,
        samples: [{ x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 }] },
      { knowledge: 'OBSERVED', startSec: 40, endSec: 60, interpolationAllowed: true,
        samples: [{ x: -200, y: -200, timeSec: 40 }, { x: -250, y: -250, timeSec: 50 }] },
    ]
    const wrapper = mountPlayback(overview, 50, ds)
    await flushPromises()
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).not.toContain('pb-last-known')
    expect(enemy.classes()).not.toContain('pb-destroyed')
  })

})






describe('destroyed markers (symmetric contract)', () => {
  function destroyedOverview() {
    const overview = makeOverview()
    const ds = makePlaybackV2()
    setLife(ds, 1001, 30)
    setLife(ds, 2001, 30)
    trackOf(ds, 2001).orientationSegments = []
    trackOf(ds, 1001).orientationSegments = [{ knowledge: 'CURRENT', startSec: 10, endSec: 14,
      samples: [{ timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
        { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 }] }]
    setPositionSamples(ds, 2001, [{ x: -50, y: -50, timeSec: 10 }, { x: -300, y: -300, timeSec: 40 }], 10, 40)
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 60)
    return { overview, ds }
  }

  it('friendly and enemy destroyed markers share the same structure at the same timestamp', async () => {
    stubRaf()
    const { overview, ds } = destroyedOverview()
    const wrapper = mountPlayback(overview, 40, ds)
    await flushPromises()
    const friendly = wrapper.find('[data-test="pb-marker-1001"]')
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    for (const m of [friendly, enemy]) {
      expect(m.exists()).toBe(true)
      expect(m.classes()).toContain('pb-destroyed')
      expect(m.classes()).not.toContain('pb-last-known')
      expect(m.findAll('img')).toHaveLength(2)
      expect(m.find('.pb-death').exists()).toBe(true)
    }
    // 唯一允许的差异：阵营 PNG src
    expect(friendly.findAll('img')[0].attributes('src')).toContain('tank-marker-friendly-hull')
    expect(friendly.findAll('img')[1].attributes('src')).toContain('tank-marker-friendly-turret')
    expect(enemy.findAll('img')[0].attributes('src')).toContain('tank-marker-enemy-hull')
    expect(enemy.findAll('img')[1].attributes('src')).toContain('tank-marker-enemy-turret')
  })

  it('destroyed vehicles freeze at the last trusted pose and stay two-layer without direction samples', async () => {
    stubRaf()
    const { overview, ds } = destroyedOverview()
    const wrapper = mountPlayback(overview, 40, ds)
    await flushPromises()
    const friendly = wrapper.find('[data-test="pb-marker-1001"]')
    // 友方方向冻结在最后可信样本（hull 90°、turret world 120°），不随当前时间继续旋转
    expect(friendly.findAll('img')[0].attributes('style')).toContain('rotate(90deg)')
    expect(friendly.findAll('img')[1].attributes('style')).toContain('rotate(120deg)')
    // 敌方无方向样本：双层以素材默认 0° 渲染（不代表朝向），✕ 标记阵亡
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.findAll('img')[0].attributes('style')).toContain('rotate(0deg)')
    expect(enemy.findAll('img')[1].attributes('style')).toContain('rotate(0deg)')
    expect(enemy.find('.pb-death').text()).toBe('✕')
  })

  it('destroyed + selected：selected 走克制变体（destroyed > selected，仍可辨认）；✕ 覆盖车体中心', async () => {
    stubRaf()
    const { overview, ds } = destroyedOverview()
    const wrapper = mountPlayback(overview, 40, ds)
    await flushPromises()
    const friendly = wrapper.find('[data-test="pb-marker-1001"]')
    await friendly.trigger('click')
    const mark = friendly.find('.pb-selected-mark')
    expect(mark.exists()).toBe(true)
    expect(mark.classes()).toContain('pb-selected-restrained')
    // ✕ 中心定位 + overlayInverseScale 反缩放（1× = scale(1)），覆盖车辆主体
    const deathStyle = friendly.find('.pb-death').attributes('style')
    expect(deathStyle).toContain('font-size: 30px')
    expect(deathStyle).toContain('translate(-50%, -50%) scale(1)')
  })
})
describe('PR2 — Tier X dedicated models in Battle Playback', () => {
  const mausRaster = {
    logicalMinX: 112.19, logicalMinY: -19.64, logicalMaxX: 207.81, logicalMaxY: 267.24,
    pixelWidth: 191, pixelHeight: 574, pivotX: 47.81, pivotY: 212.87,
  }
  const mausModel = {
    kind: 'turreted', hullSrc: '/vm/maus/hull.webp', turretSrc: '/vm/maus/turret.webp',
    turretPivot: { x: 160, y: 193.23 }, turretRaster: mausRaster,
  }
  const hoRiModel = { kind: 'turretless', hullSrc: '/vm/ho-ri/hull.webp', turretSrc: null, turretPivot: null, turretRaster: null }

  function overviewWithTank(tankId, tankName) {
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles = [trackOf(ds, 1001)]
    ds.vehicles[0] = {
      ...ds.vehicles[0], accountId: 1001, playerName: 'You', tankId, tankName,
      positionSegments: [{ knowledge: 'OBSERVED', startSec: 0, endSec: 60, interpolationAllowed: true,
        samples: [{ timeSec: 10, x: 0, y: 0 }, { timeSec: 14, x: 50, y: 50 }] }],
      orientationSegments: [{ knowledge: 'CURRENT', startSec: 10, endSec: 14,
        samples: [{ timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
          { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 }] }],
    }
    return { overview, ds }
  }

  afterEach(() => {
    vi.mocked(preloadBattleModels).mockReset()
    vi.mocked(preloadBattleModels).mockResolvedValue({ resolved: new Map(), failed: new Set(), byTank: new Map() })
  })

  it('Tier X turreted：渲染 dedicated hull + turret assembly（嵌套 transform），非 generic', async () => {
    stubRaf()
    const { overview, ds } = overviewWithTank(6929, 'Maus')
    vi.mocked(preloadBattleModels).mockResolvedValue({
      resolved: new Map([['maus', mausModel]]),
      failed: new Set(),
      byTank: new Map([['6929', 'maus']]),
    })
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.exists()).toBe(true)
    expect(marker.find('.pb-hull-dedicated').attributes('src')).toBe('/vm/maus/hull.webp')
    // t=12：hull 0→90 插值 45°；turret = 45 + 15(relative 0→30 插值) = 60°
    expect(marker.find('.pb-hull-dedicated').attributes('style')).toContain('rotate(45deg)') // H
    const assembly = marker.find('.pb-turret-assembly')
    expect(assembly.exists()).toBe(true)
    expect(assembly.attributes('style')).toContain('rotate(45deg)') // 父层 H
    const turret = marker.find('.pb-turret-dedicated')
    expect(turret.attributes('src')).toBe('/vm/maus/turret.webp')
    expect(turret.attributes('style')).toContain('rotate(15deg)') // T - H = 60 - 45
    expect(marker.find('.pb-hull.pb-hull-dedicated').exists()).toBe(true)
    expect(marker.find('.pb-hull:not(.pb-hull-dedicated)').exists()).toBe(false) // 无 generic 层
  })

  it('preload 失败 modelKey → 单车 generic fallback（不整场 fallback）', async () => {
    stubRaf()
    const { overview, ds } = overviewWithTank(6929, 'Maus')
    vi.mocked(preloadBattleModels).mockResolvedValue({
      resolved: new Map(),
      failed: new Set(['maus']),
      byTank: new Map([['6929', 'maus']]),
    })
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.find('.pb-hull').exists()).toBe(true) // generic 双层
    expect(marker.find('.pb-turret').exists()).toBe(true)
    expect(marker.find('.pb-hull-dedicated').exists()).toBe(false)
    expect(marker.find('.pb-turret-assembly').exists()).toBe(false)
  })

  it('Tier X turretless：仅 dedicated hull，无 fake turret layer（§14）', async () => {
    stubRaf()
    const { overview, ds } = overviewWithTank(3937, 'Ho-Ri')
    vi.mocked(preloadBattleModels).mockResolvedValue({
      resolved: new Map([['ho-ri', hoRiModel]]),
      failed: new Set(),
      byTank: new Map([['3937', 'ho-ri']]),
    })
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.find('.pb-hull-dedicated').exists()).toBe(true)
    expect(marker.find('.pb-turret-assembly').exists()).toBe(false)
    expect(marker.find('.pb-turret').exists()).toBe(false)
  })

  it('非 Tier X 战局：preload 返回空 → 全部 generic（行为不变）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
    expect(wrapper.find('.pb-hull-dedicated').exists()).toBe(false)
    expect(wrapper.findAll('.pb-hull')).toHaveLength(2)
  })
})

describe('PR4 — 标签开关/碰撞/选中/倍速/循环（§26–§49）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('§26 默认 showPlayerName=false / showTankName=true；checkbox 切换并持久化', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await openPanel(wrapper, 'display')
    const player = wrapper.find('[data-test="pb-show-player"]')
    const tank = wrapper.find('[data-test="pb-show-tank"]')
    expect(player.element.checked).toBe(false)
    expect(tank.element.checked).toBe(true)
    // 默认只显示坦克名行
    expect(wrapper.findAll('.pb-label-tank').length).toBe(2)
    expect(wrapper.findAll('.pb-label-player').length).toBe(0)
    await player.setValue(true)
    expect(wrapper.findAll('.pb-label-player').length).toBe(2)
    expect(wrapper.findAll('.pb-label-player')[0].text()).toBe('You')
    // 持久化：localStorage 写入
    const saved = JSON.parse(localStorage.getItem('wotb.pb.label-prefs'))
    expect(saved).toEqual({ showPlayerName: true, showTankName: true })
    // 重新挂载 → 读取持久化值
    const w2 = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await openPanel(w2, 'display')
    expect(w2.find('[data-test="pb-show-player"]').element.checked).toBe(true)
    expect(w2.findAll('.pb-label-player').length).toBe(2)
  })

  it('§32/§33/§34 碰撞集成：两车贴近 → 标签与 HP 永不因碰撞隐藏', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    trackOf(ds, 2001).lifeTransitions = []
    // 两车同位 → 标签必然冲突（player 名够长保证与对方 tank 盒重叠）
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    trackOf(ds, 2001).playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    const wrapper = mountPlayback(overview, 12, ds)
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await wrapper.find('.pb-range').setValue(12.5) // 触发 seek（值变化）→ 重算 labelLayout
    await flushPromises()
    const a = wrapper.find('[data-test="pb-marker-1001"]')
    const b = wrapper.find('[data-test="pb-marker-2001"]')
    const labelsStyle = (m) => (m.find('.pb-labels').attributes('style') || '')
    // 标签位移为有限 screen px（稳定 lane），不产生 display:none
    expect(Number.isFinite(parseFloat(labelsStyle(a).match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || 'NaN'))).toBe(true)
    expect(Number.isFinite(parseFloat(labelsStyle(b).match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || 'NaN'))).toBe(true)
    // 玩家名/坦克名/HP：碰撞永不隐藏
    expect(a.find('.pb-label-player').attributes('style')).toBeUndefined()
    expect(b.find('.pb-label-player').attributes('style')).toBeUndefined()
    expect(a.find('.pb-label-player').isVisible()).toBe(true)
    expect(b.find('.pb-label-player').isVisible()).toBe(true)
    expect(a.find('.pb-label-tank').isVisible()).toBe(true)
    expect(b.find('.pb-label-tank').isVisible()).toBe(true)
    expect(a.find('[data-test="pb-hp-num"]').isVisible()).toBe(true)
    expect(b.find('[data-test="pb-hp-num"]').isVisible()).toBe(true)
  })

  it('§37 重叠 hitbox 选中：点击坐标靠近 B → 选中 B（即使点在 A 的按钮上）', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    // A 中心 content x=100（map -225），B 中心 content x=90（map -232.5），y 相同
    // A 按钮盒 x∈[82,118]，A hitbox x∈[83.8,116.2]，B hitbox x∈[73.8,106.2] → 点击 x=84 两盒都命中
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -232.5, y: -204.2, timeSec: 10 }, { x: -232.5, y: -204.2, timeSec: 14 }], 0, 60)
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    const aBtn = wrapper.find('[data-test="pb-marker-1001"]')
    // 点击 A 的按钮，坐标 (90, 675)：A/B generic hitbox 都命中（A 中心 (100,675)、B 中心 (90,675)）
    await aBtn.trigger('click', { clientX: 90, clientY: 675 })
    // 距离最近者 2001（B，dist 0）被选中（A dist 10）
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA')
    // PR5 §8.1：再点同一点保持选中（不 toggle-off）；× 显式关闭
    await aBtn.trigger('click', { clientX: 90, clientY: 675 })
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA')
    await wrapper.find('[data-test="pb-sb-close"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
  })

  it('§49 倍速循环含 0.5×；loop 到末尾自动回绕', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    expect(wrapper.find('[data-test="pb-speed-2"]').classes()).toContain('active')
    await wrapper.find('[data-test="pb-speed-4"]').trigger('click')
    expect(wrapper.find('[data-test="pb-speed-4"]').classes()).toContain('active')
    await wrapper.find('[data-test="pb-speed-0.5"]').trigger('click')
    expect(wrapper.find('[data-test="pb-speed-0.5"]').classes()).toContain('active')
    await wrapper.find('[data-test="pb-speed-1"]').trigger('click')
    expect(wrapper.find('[data-test="pb-speed-1"]').classes()).toContain('active')
    // loop：seek 到接近末尾 → 播放 → 越过末尾自动回 0 继续
    await wrapper.setProps({ loop: true })
    const wrap = mountPlayback(makeOverview(), 59)
    await flushPromises()
    await wrap.setProps({ loop: true })
    await wrap.find('[data-test="pb-play"]').trigger('click')
    expect(rafCb).toBeTruthy()
    rafCb(0)
    rafCb(1000) // 推进 1s → 59 + 1 = 60 = duration → loop 回 0
    await flushPromises()
    expect(wrap.find('.pb-time').text()).toBe('00:00 / 01:00')
  })
})


describe('PR4 §33 B3 — collision UX：标签与 HP 永不因碰撞隐藏', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** 两车同位（t=12 恒冲突）的 overview；2001 玩家名足够长。 */
  function overlapOverview() {
    const overview = makeOverview()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    trackOf(ds, 2001).playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    return { overview, ds }
  }

  function mountWithPlayer({ overview, ds }, seekTo) {
    const w = mountPlayback(overview, seekTo, ds)
    Object.defineProperty(w.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    return w
  }

  function markerOf(wrapper, accountId) {
    return wrapper.find('[data-test="pb-marker-' + accountId + '"]')
  }
  function playerVisible(wrapper, accountId) {
    const el = markerOf(wrapper, accountId).find('.pb-label-player')
    return el.exists() && el.isVisible()
  }
  function tankVisible(wrapper, accountId) {
    const el = markerOf(wrapper, accountId).find('.pb-label-tank')
    return el.exists() && el.isVisible()
  }
  function hpVisible(wrapper, accountId) {
    const num = markerOf(wrapper, accountId).find('[data-test="pb-hp-num"]')
    return num.exists() && num.isVisible()
  }

  function buildDenseVehicles(count, accountBase) {
    const vehicles = []
    for (let i = 0; i < count; i++) {
      const accountId = (accountBase || 3000) + i
      const friendly = i % 2 === 0
      vehicles.push({
        accountId, playerName: 'Dense-' + i, tankId: 1, tankName: 'Tank-' + i, tankClass: '', tankTier: null,
        team: friendly ? 1 : 2, friendly, loadout: null,
        positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 10, endSec: 14,
          samples: [{ timeSec: 10, x: 0, y: 0 }, { timeSec: 14, x: 0, y: 0 }] }],
        orientationSegments: [{ knowledge: 'CURRENT', startSec: 10, endSec: 14,
          samples: [{ timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 }, { timeSec: 14, hullYawDeg: 0, turretRelativeYawDeg: 0 }] }],
        healthTransitions: [{ timeSec: 0, currentHp: 1000, knowledge: 'CURRENT', displayCapacityHp: 1000, relativeFull: true, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' }],
        lifeTransitions: [], damageLosses: [], consumableTransitions: [], moduleCrewTransitions: [],
      })
    }
    return vehicles
  }

  it('pause + zoom 密集冲突：PlayerName / TankName / HP 始终可见', async () => {
    stubRaf()
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
    if (rafCb) { rafCb(50_100); await flushPromises() }
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
  })

  it('seek 到冲突/分离位置：PlayerName / HP 始终可见', async () => {
    stubRaf()
    const { overview, ds } = overlapOverview()
    setPositionSamples(ds, 1001, [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: -300, y: -260, timeSec: 14 },
    ], 0, 60)
    setPositionSamples(ds, 2001, [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: 300, y: 260, timeSec: 14 },
    ], 0, 60)
    const wrapper = mountWithPlayer({ overview, ds }, 11)
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
    await wrapper.find('.pb-range').setValue(11)
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
  })

  it('播放/暂停切换：PlayerName 恒可见', async () => {
    stubRaf()
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
  })

  it('fullscreen 进入/退出：PlayerName / HP 始终可见', async () => {
    stubRaf()
    const origReqFs = typeof Element.prototype !== 'undefined' ? Element.prototype.requestFullscreen : undefined
    const origFsElDesc = typeof document !== 'undefined' ? Object.getOwnPropertyDescriptor(document, 'fullscreenElement') : undefined
    const reqFs = vi.fn().mockResolvedValue(undefined)
    Element.prototype.requestFullscreen = reqFs
    const setFsEl = (el) => Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true, writable: true })
    try {
      const wrapper = mountWithPlayer(overlapOverview(), 12)
      await flushPromises()
      await openPanel(wrapper, 'display')
      await wrapper.find('[data-test="pb-show-player"]').setValue(true)
      await flushPromises()
      await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')
      setFsEl(wrapper.find('[data-test="battle-playback"]').element)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
      expect(playerVisible(wrapper, 2001)).toBe(true)
      expect(tankVisible(wrapper, 2001)).toBe(true)
      expect(hpVisible(wrapper, 2001)).toBe(true)
      setFsEl(null)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
      expect(playerVisible(wrapper, 2001)).toBe(true)
      expect(tankVisible(wrapper, 2001)).toBe(true)
      expect(hpVisible(wrapper, 2001)).toBe(true)
    } finally {
      if (origReqFs === undefined) delete Element.prototype.requestFullscreen
      else Element.prototype.requestFullscreen = origReqFs
      if (origFsElDesc) Object.defineProperty(document, 'fullscreenElement', origFsElDesc)
      else delete document.fullscreenElement
    }
  })

  it('dense collision（多车同位）：所有标记的标签与 HP 均可见', async () => {
    stubRaf()
    const ds = makePlaybackV2({ vehicles: buildDenseVehicles(6), events: [] })
    const wrapper = mountWithPlayer({ overview: makeOverview(), ds }, 12)
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    const markers = wrapper.findAll('[data-test^="pb-marker-"]')
    expect(markers.length).toBeGreaterThan(0)
    for (const m of markers) {
      expect(m.find('.pb-label-player').exists()).toBe(true)
      expect(m.find('.pb-label-player').isVisible()).toBe(true)
      expect(m.find('.pb-label-tank').exists()).toBe(true)
      expect(m.find('.pb-label-tank').isVisible()).toBe(true)
      expect(m.find('[data-test="pb-hp-num"]').exists()).toBe(true)
      expect(m.find('[data-test="pb-hp-num"]').isVisible()).toBe(true)
    }
  })
})
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
    const RO = vi.fn(function (cb) { callbacks.push(cb); this.observe = vi.fn(); this.disconnect = vi.fn() })
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
  it('feeds the rendered box into the collision layout, not the hull rectangle', () => {
    // happy-dom 下 import.meta.url 不是 file URL，用 cwd 相对路径读源码。
    const src = readFileSync(resolve(process.cwd(), 'src/components/BattlePlayback.vue'), 'utf8')
    expect(src).toContain('state.markerSize.renderBox.width * view.scale')
    expect(src).toContain('state.markerSize.renderBox.height * view.scale')
    expect(src).not.toContain('state.markerSize.collisionFootprint.width * view.scale')
  })

  // §side-slots：侧栏形态下 safeInsets 必须归零。忘了归零的话上下仍按 HUD/controls
  // 高度预留，地图白白小一圈——882×344 上是 336px 与 188px 的差别。
  it('keeps the fullscreen HUD inset and delegates bottom inset ownership by form', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/BattlePlayback.vue'), 'utf8')
    const fn = src.slice(src.indexOf('function safeInsets()'))
    const body = fn.slice(0, fn.indexOf('function applyView'))
    expect(body).toContain('playbackSafeInsetOwnership')
    expect(body).toContain('if (ownership.reserveTop)')
    expect(body).toContain("querySelector('.pb-hud')")
    expect(body).toContain('if (ownership.reserveBottom)')
    expect(body).toContain("querySelector('.pb-mobile-overlay-content')")
    expect(body).toContain('wrapRect.bottom - contentRect.top')
    expect(body).not.toContain('if (sideSlots.value) return { top, bottom }')
    expect(body).toContain('formFactor: formFactor.value')
  })

  // 三档必须严格互补：mobile 的上界与 pc 的下界不能重叠，否则同一视口既是
  // mobile 形态、又命中 pc 的媒体查询，互斥性就是假的。
  it('keeps the mobile and pc breakpoints strictly complementary', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/BattlePlayback.vue'), 'utf8')
    const mobileMax = /max-width:\s*([\d.]+)px\)'/.exec(src)
    const pcMin = /matchMedia\('\(min-width:\s*([\d.]+)px\)'\)/.exec(src)
    expect(mobileMax).not.toBeNull()
    expect(pcMin).not.toBeNull()
    expect(Number(mobileMax[1])).toBeLessThan(Number(pcMin[1]))
  })

  // §three-forms：根元素任何时刻只挂一个形态类。互斥性由这里保证，而不是靠媒体查询
  // 之间的算术——旧写法里一档的规则会以更高特异性压掉另一档，反复打穿。
  it('puts exactly one mutually exclusive form class on the root', async () => {
    const cases = [
      ['mobile', { '(pointer: coarse) and (max-width: 1199.98px)': true }],
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

  // 收起左栏时 controls 必须搬出 rail：非触屏设备的 controls 渲染在 rail 内，
  // 而收起态把 .pb-rail-body 整块 display:none，播放/进度条会跟着一起消失，
  // 屏幕上只剩一个展开箭头。
  it('moves the controls out of the rail when the rail collapses', async () => {
    stubRaf()
    stubMatchMedia({ '(min-width: 1200px)': true })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()

    const railBody = () => wrapper.find('[data-test="pb-rail-body"]')
    const controls = () => wrapper.find('[data-test="pb-controls"]')
    expect(controls().exists()).toBe(true)
    expect(railBody().element.contains(controls().element)).toBe(true)

    await wrapper.find('[data-test="pb-rail-collapse"]').trigger('click')
    await flushPromises()

    expect(controls().exists()).toBe(true)
    expect(railBody().element.contains(controls().element)).toBe(false)

    // 再展开回到 rail 内
    await wrapper.find('[data-test="pb-rail-collapse"]').trigger('click')
    await flushPromises()
    expect(railBody().element.contains(controls().element)).toBe(true)
  })

  // 左右两栏可拖拽改宽：把手写入 --pb-rail-w / --pb-details-w，并夹在合理区间内。
  it('resizes the rail by dragging its handle and clamps the width', async () => {
    stubRaf()
    stubMatchMedia({ '(min-width: 1200px)': true })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()

    const root = wrapper.find('[data-test="battle-playback"]')
    expect(root.attributes('style') || '').not.toContain('--pb-rail-w')

    const handle = wrapper.find('[data-test="pb-rail-resizer"]')
    expect(handle.exists()).toBe(true)
    root.element.getBoundingClientRect = () => ({ left: 0, right: 1600, top: 0, bottom: 900 })

    await handle.trigger('pointerdown', { button: 0, pointerId: 1 })
    window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 300 }))
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').attributes('style')).toContain('--pb-rail-w: 300px')

    // 超出上限被夹住（rail 最大 420）
    window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: 9999 }))
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').attributes('style')).toContain('--pb-rail-w: 420px')
    window.dispatchEvent(new window.PointerEvent('pointerup', {}))
  })

  // 宽桌面（>=1200px）：播放控制在 Left Rail 内（rail 已加宽到放得下速度档位那一排），
  // 且与 rail 图标导航重复的面板/标注/重置/全屏按钮必须隐藏，不能在右下角再出现一份。
  it('wide desktop puts playback controls in the Left Rail without duplicating rail actions', async () => {
    stubRaf()
    stubMatchMedia({ '(min-width: 1200px)': true })
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()

    const rail = wrapper.find('[data-test="pb-left-rail"]')
    expect(rail.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="pb-controls"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-controls"]').classes()).toContain('pb-controls-rail-mode')
    // rail 里已有这些图标，控制条不再重复
    expect(wrapper.find('[data-test="pb-rail-reset"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-rail-fullscreen"]').exists()).toBe(true)
  })

  it('1/2/3/4/5：API 可用 → 按钮可见；进入调 root.requestFullscreen；fullscreenchange 同步；退出调 exitFullscreen；ESC 外部退出恢复', async () => {
    stubRaf()
    const { reqFs, exitFs } = stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const btn = wrapper.find('[data-test="pb-fullscreen"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('enter_fullscreen')
    // 进入：requestFullscreen 调用在 Battle Playback root 上
    await btn.trigger('click')
    expect(reqFs).toHaveBeenCalledTimes(1)
    expect(reqFs.mock.instances[0]).toBe(wrapper.find('[data-test="battle-playback"]').element)
    // fullscreenchange + fullscreenElement=root → 显示退出全屏
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').text()).toContain('exit_fullscreen')
    // 点击退出 → document.exitFullscreen
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')
    expect(exitFs).toHaveBeenCalledTimes(1)
    // ESC/外部退出：fullscreenElement=null → 状态恢复
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').text()).toContain('enter_fullscreen')
  })

  it('6：API 不可用 → 按钮隐藏，不抛错', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').exists()).toBe(false)
  })

  it('7/8/9/10：进入/退出 fullscreen 不 reset currentTime/speed/selected/zoom/pan', async () => {
    stubRaf()
    stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('.pb-range').setValue(12)
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click') // 2×
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 }) // 选中
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const speedBefore = wrapper.find('.pb-speed .active').text()
    const infoBefore = wrapper.find('[data-test="pb-info"]').text()
    const viewportBefore = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    // 进入
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('.pb-speed .active').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
    // 退出
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('.pb-speed .active').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
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
      const m = st.match(/scale\(([\d.]+)\)/)
      return m ? parseFloat(m[1]) : NaN
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

  it('§safeInsets-contract：normal mobile controls hidden→bottom=0 不缩地图；fullscreen mobile controls visible→reserve content；content reflow→safe 更新', async () => {
    stubRaf()
    stubFullscreenApi()
    stubMatchMedia({
      '(pointer: coarse) and (max-width: 1199.98px)': true,
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
      const m = st.match(/scale\(([\d.]+)\)/)
      return m ? parseFloat(m[1]) : NaN
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
    expect(fsReserve).toBeLessThan(fsNoReserve)

    // --- content reflow：fullscreen mobile content 高度变化 → safe 几何更新（200>140 → reserve 更多 → 更小 fit）。 ---
    Object.defineProperty(overlayEl, 'clientHeight', { value: 200, configurable: true })
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    expect(scaleOf()).toBeLessThan(fsReserve)
  })

  it('§mobile-fullscreen-contract：手机 fullscreen + landscape（内宽>768）仍保持 mobile mode（bottom-overlay controls、无 rail/details）', async () => {
    stubRaf()
    stubFullscreenApi()
    // 移动端：primary pointer=coarse 且视口<=1200（手机横屏内宽>768 仍命中）。大桌面 1200 判定为 false。
    stubMatchMedia({
      '(pointer: coarse) and (max-width: 1199.98px)': true,
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

    // controls 在 bottom overlay：Left Rail 内不再有 pb-controls
    expect(wrapper.find('.pb-left-rail [data-test="pb-controls"]').exists()).toBe(false)
    // overlay 内有 controls：mobile mode 以 bottom-overlay controls 承载
    expect(wrapper.find('[data-test="pb-mobile-overlay"] [data-test="pb-controls"]').exists()).toBe(true)

    // §details-blocker：未选中车辆时 shell 空壳且不带 pb-details-active（不遮挡/不 tint/不接管 pointer）
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-side-panel-shell"]').classes()).not.toContain('pb-details-active')

    // §mobile-drawer：☰ 不是 dead action——打开 mobile drawer，能进入 Team/Display/Events
    await wrapper.find('[data-test="pb-panels"]').trigger('click')
    await flushPromises()
    expect(root.classes()).toContain('pb-drawer-open')
    expect(wrapper.find('[data-test="pb-drawer-backdrop"]').exists()).toBe(true)
    await wrapper.find('[data-test="pb-rail-team"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-friendly"]').exists()).toBe(true)
    await wrapper.find('[data-test="pb-rail-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-friendly"]').exists()).toBe(false)
    await wrapper.find('[data-test="pb-drawer-backdrop"]').trigger('click')
    await flushPromises()
    expect(root.classes()).not.toContain('pb-drawer-open')

    // 选中车辆 → details 以 sheet/drawer 出现，且 shell 进入 active（接管 pointer）
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-side-panel-shell"]').classes()).toContain('pb-details-active')
    // 退出 fullscreen 后仍保持 mobile overlay controls（不回到 rail）
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-left-rail [data-test="pb-controls"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-mobile-overlay"] [data-test="pb-controls"]').exists()).toBe(true)
  })

  it('§mobile-pointer-regression：未选车辆 mobile fullscreen 下 map pan + marker click 可操作（空 shell 不阻挡 pointer）', async () => {
    stubRaf()
    stubFullscreenApi()
    stubMatchMedia({
      '(pointer: coarse) and (max-width: 1199.98px)': true,
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
    expect(wrapper.find('[data-test="pb-side-panel-shell"]').classes()).not.toContain('pb-details-active')

    // 先 zoom in，让地图走出 contain-fit、产生可平移余量（真实手势路径：手指拖动）
    const map = wrapper.find('[data-test="pb-map"]')
    for (let i = 0; i < 3; i++) {
      await map.trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
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
      const m = st.match(/scale\(([\d.]+)\)/)
      return m ? parseFloat(m[1]) : NaN
    }

    // 初始 fit：map 宽 1200、近方形(766×769)、stage 高 900 → fitScale < 1
    roCb([{ target: mapEl, contentRect: { width: 1200, height: 1204 } }])
    await flushPromises()
    const fitScale = scaleOf()
    expect(fitScale).toBeGreaterThan(0)
    expect(fitScale).toBeLessThan(1)

    // 放大 3 步（deltaY<0）
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    await flushPromises()
    expect(scaleOf()).toBeGreaterThan(fitScale)

    // 缩小足够多步（deltaY>0）→ 回到 fitScale（缩放下限 = 完整地图 fit，不是 1x）
    for (let i = 0; i < 20; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: 120, clientX: 0, clientY: 0 })
    }
    await flushPromises()
    expect(scaleOf()).toBeCloseTo(fitScale, 3)
  })

  it('workspace Left Rail：buttons toggle panels; annotation/reset wired（§2）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // rail 常驻 DOM（fullscreen 下才视觉显示为左列）；所有 rail 按钮存在
    expect(wrapper.find('[data-test="pb-rail-team"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-rail-display"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-rail-events"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-rail-annotation"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-rail-reset"]').exists()).toBe(true)
    // 点击 rail display → 左侧二级菜单显示显示选项
    await wrapper.find('[data-test="pb-rail-display"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-panel-content-display"]').exists()).toBe(true)
    // 返回一级菜单
    await wrapper.find('[data-test="pb-rail-back"]').trigger('click')
    await flushPromises()
    // reset view 不改变回放状态
    const timeBefore = wrapper.find('.pb-time').text()
    await wrapper.find('[data-test="pb-rail-reset"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
  })

  it('§3 Right Details：右侧仅保留点击车辆后的详情；未选车辆时无战局/提示重复', async () => {
    stubRaf()
    stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 右侧列存在（对称）；未选车辆时右侧为空壳：无详情、无战局 Summary、无提示
    expect(wrapper.find('[data-test="pb-side-panel-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-panel-content-battle"]').exists()).toBe(false)
    // 进入 fullscreen + 点击车辆 → 右侧显示详情
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
    const labelsStyle = () => wrapper.find('[data-test="pb-marker-1001"]').find('.pb-labels').attributes('style') || ''
    expect(labelsStyle()).toContain('scale(1)') // 1× 反缩放
    // 2× zoom：wheel 锚点 = 车辆所在容器 px（(96,646)，1× 时内容 (95.75,646.2)）——
    // 避免 zoom 的 pan 把车辆移出 viewport 被裁剪（裁剪是真实机制，但本测试验证的是 zoom 后 collision）
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 96, clientY: 646 })
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 96, clientY: 646 })
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
    expect(wrapper.find('[data-test="pb-fullscreen"]').text()).toContain('enter_fullscreen')
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
    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs'))).toEqual({ showHp: false })
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

  it('§12/§13 伤害记录：hpLoss 驱动；未点亮攻击者显示「来源未知」，不泄露身份', async () => {
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

describe('Blocker 修复回归（review B1-1 / B1-2 / B1-3 / B2）', () => {
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

  /** 从当前状态 dl 读 dt 对应 dd 文本（finalStats 分区不渲染时唯一）。 */
  function sidebarValue(wrapper, dtKey) {
    const dts = wrapper.findAll('.pb-sb-grid dt')
    const idx = dts.findIndex((d) => d.text() === dtKey)
    if (idx === -1) return null
    const dds = wrapper.findAll('.pb-sb-grid dd')
    return dds[idx] ? dds[idx].text() : null
  }

  function logTimes(wrapper) {
    return wrapper.findAll('.pb-sb-log li').map((li) => li.find('.pb-sb-log-time').text())
  }

  it('B1-1 Event Panel：真实事件与 deterministic stats 使用同一 authoritative source', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events.push(
      { type: 'DAMAGE', timeSec: 14, accountId: 2001, targetAccountId: 1001, rawProtocolValue: 200, observedHpLoss: 200 },
      { type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null, observedHpLoss: null }
    )
    // 1001 受击 hpLoss（received）；2001 的 400（fixture dealt）保持
    ds.vehicles[0].damageLosses = [
      { fromSec: 12, toSec: 14, hpLoss: 200, attackerAccountId: 2001, attackerReliable: true, damageEventCount: 1 },
    ]
    const wrapper = mountPlayback(overview, 18, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.exists()).toBe(true)
    // t=18 的 current stats：dealt 400（DAMAGE@12）+ received 200（DAMAGE@14）+ kills 1（KILL@16）
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('400')
    expect(sidebarValue(info, 'recon.map.playback.damage_received')).toBe('200')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
    // 不再有事件过滤器或 timeline marker；面板只展示用户可读的战斗事件。
    expect(wrapper.find('[data-test="pb-all-events"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-event-panel"]').exists()).toBe(false)
    await openPanel(wrapper, 'events')
    expect(wrapper.findAll('[data-test="pb-event"]')).toHaveLength(3)
    const eventPanelText = wrapper.find('[data-test="pb-event-panel"]').text()
    expect(eventPanelText).toContain('event_KILL')
    expect(eventPanelText).not.toContain('event_POSITION_REPORTED')
    expect(eventPanelText).not.toContain('event_POSITION_STALE')
  })

  it('B1-1 recorder/team scope：presentation scope 不截断 sidebar 当前统计（authoritative 全量）', async () => {
    stubRaf()
    // recorder scope（arenaBonusType=1 + recorderAccountId=1001）：2001→2002 双方均非 recorder
    // → presentation 过滤；但选中 2001 的 dealt 必须计入（authoritative 全量事件）
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.arenaBonusType = 1
    ds.events.push({ type: 'DAMAGE', timeSec: 15, accountId: 2001, targetAccountId: 2002, rawProtocolValue: 300 })
    ds.vehicles[2].damageLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 300, attackerAccountId: 2001, attackerReliable: true, damageEventCount: 1 },
    ]
    const wrapper = mountPlayback(overview, 16, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
    // scope 已移除；真实事件面板保留该事件，不截断 authoritative stats。
    await openPanel(wrapper, 'events')
    expect(wrapper.find('[data-test="pb-event-panel"]').text()).toContain('00:15')
    // team metadata 仍不影响真实事件与 stats。
    const overview2 = makeOverview()
    const ds2 = makePlaybackV2()
    ds2.arenaBonusType = 2
    ds2.events.push({ type: 'DAMAGE', timeSec: 15, accountId: 2001, targetAccountId: 2002, rawProtocolValue: 300 })
    ds2.vehicles[2].damageLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 300, attackerAccountId: 2001, attackerReliable: true, damageEventCount: 1 },
    ]
    const w2 = mountPlayback(overview2, 16, ds2)
    await flushPromises()
    await w2.find('[data-test="pb-marker-2001"]').trigger('click')
    info = w2.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
    await openPanel(w2, 'events')
    expect(w2.find('[data-test="pb-event-panel"]').text()).toContain('00:15')
  })

  it('B1-1 combat feedback 不依赖 Event Panel 折叠状态：播放跨过仍触发', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events.push({ type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 6000
    rafCb(6000) // +6s → t=17：跨过 DAMAGE@12 与 KILL@16
    await flushPromises()
    // 即使事件面板折叠，combat feedback 仍按需求触发
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    // §15：banner 显示「玩家名（车辆名）被击毁」，来自 canonical vehicle identity。
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('EnemyA（T49）')
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('recon.map.playback.feed_destroyed')
  })

  it('B1-2 damage log 无 future leak：只显示 <= currentTime 的事件，backward seek 后未来事件消失', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.durationSec = 140
    ds.events = ds.events.filter((e) => e.type !== 'DAMAGE')
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 50, y: 50, timeSec: 140 }], 0, 140)
    setPositionSamples(ds, 2001, [
      { x: -50, y: -50, timeSec: 0 }, { x: -50, y: -50, timeSec: 10 },
      { x: -60, y: -60, timeSec: 14 }, { x: -100, y: -100, timeSec: 130 },
    ], 0, 140)
    for (const t of [20, 60, 120]) {
      ds.events.push({ type: 'DAMAGE', timeSec: t, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 300, observedHpLoss: 300 })
    }
    // 2001 的 damageLosses（1001 造成）：伤害记录与 dealt 统计的权威来源
    ds.vehicles[1].damageLosses = [20, 60, 120].map((t) => ({
      fromSec: t - 1, toSec: t, hpLoss: 300, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1,
    }))
    const wrapper = mountPlayback(overview, 30, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    // t=30：只见 20s
    expect(logTimes(info)).toEqual(['00:20'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
    // forward seek t=90：20/60
    await wrapper.find('.pb-range').setValue(90)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(logTimes(info)).toEqual(['00:20', '01:00'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('600')
    // forward seek t=130：20/60/120
    await wrapper.find('.pb-range').setValue(130)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(logTimes(info)).toEqual(['00:20', '01:00', '02:00'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('900')
    // backward seek 130 → 30：120/60 均消失（未来事件绝不泄漏，无单向 append/history cache）
    await wrapper.find('.pb-range').setValue(30)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(logTimes(info)).toEqual(['00:20'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
  })

  it('B1-3 enemy last-known HP 冻结：HUD 与 sidebar 一致；恢复 coverage 跳到最新可信值；friendly 不受影响', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    trackOf(ds, 2001).lifeTransitions = []
    setPositionSamples(ds, 2001, [{ x: -50, y: -50, timeSec: 0 }, { x: -60, y: -60, timeSec: 20 }], 0, 20)
    trackOf(ds, 2001).positionSegments.push({ knowledge: 'OBSERVED', startSec: 40, endSec: 60, interpolationAllowed: true,
      samples: [{ x: -100, y: -100, timeSec: 40 }, { x: -120, y: -120, timeSec: 60 }] })
    trackOf(ds, 2001).healthTransitions = [
      { timeSec: 10, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 42, currentHp: 1700, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
    ]
    // friendly 同样处于 gap：证明 friendly 不被敌方冻结规则误伤（HP 正常更新）
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 50, y: 50, timeSec: 20 }], 0, 20)
    trackOf(ds, 1001).positionSegments.push({ knowledge: 'OBSERVED', startSec: 40, endSec: 60, interpolationAllowed: true,
      samples: [{ x: 100, y: 100, timeSec: 40 }, { x: 120, y: 120, timeSec: 60 }] })
    trackOf(ds, 1001).healthTransitions = [
      { timeSec: 0, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 30, currentHp: 2200, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 42, currentHp: 1700, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(overview, 15, ds)
    await flushPromises()
    // t=15：覆盖期内正常
    expect(enemyHudNum(wrapper)).toBe('3000')
    // t=25/30/35：失察期冻结 3000——hidden interval 采样（2200/1800）不得提前泄漏
    for (const t of [25, 30, 35]) {
      await wrapper.find('.pb-range').setValue(t)
      await flushPromises()
      expect(enemyHudNum(wrapper)).toBe('3000')
    }
    // 恢复 coverage（40/42）：跳到届时最新可信值（不补播 hidden interval 历史伤害动画）
    await wrapper.find('.pb-range').setValue(40)
    await flushPromises()
    // V2 anti-future-leak：hidden interval 的 LAST_KNOWN 值不泄漏；恢复后跳到最新 CURRENT（3000@10）
    expect(enemyHudNum(wrapper)).toBe('3000')
    await wrapper.find('.pb-range').setValue(42)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('1700')
    // backward seek 确定性：42 → 25 重新冻结回 3000
    await wrapper.find('.pb-range').setValue(25)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('3000')
    // friendly 不受影响：t=30 正常显示 2200（同 gap 结构）
    await wrapper.find('.pb-range').setValue(30)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-num"]').text()).toBe('2200')
    // sidebar 与 marker HUD 完全一致（冻结值与恢复值都一致）
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(detailsHpNum(info)).toBe('3000')
    await wrapper.find('.pb-range').setValue(35)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('3000')
    expect(detailsHpNum(wrapper.find('[data-test="pb-info"]'))).toBe('3000')
    await wrapper.find('.pb-range').setValue(42)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('1700')
    expect(detailsHpNum(wrapper.find('[data-test="pb-info"]'))).toBe('1700')
  })

  it('B2 末尾事件消费：播放跨到 duration 时 (prev, duration] 内事件 exactly-once；seek 到末尾不补播', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.durationSec = 20
    setPositionSamples(ds, 2001, [
      { x: -50, y: -50, timeSec: 0 }, { x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 },
    ], 0, 20)
    ds.events.push(
      { type: 'DAMAGE', timeSec: 19.8, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
      { type: 'DESTROYED', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null },
      { type: 'KILL', timeSec: 20, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null }
    )
    ds.vehicles[1].damageLosses.push(
      { fromSec: 19, toSec: 19.8, hpLoss: 400, fromHp: 1200, toHp: 800, displayCapacityHp: 1200, transientAllowed: true, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }
    )
    const wrapper = mountPlayback(overview, 19, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1300
    rafCb(1300) // +1.3s → t=20（duration）：先消费 (19, 20] 再停止
    await flushPromises()
    // 末尾最后一段事件全部消费一次：floating damage + burst + kill feed
    expect(wrapper.findAll('[data-test="pb-float-dmg"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(true)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    // 到达 duration 后停止；后续仅轻量时钟推进（wall-clock 自然完成），不产生重复消费
    clock.now = 2500
    rafCb(2500)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1) // feed 未重复，仍在自然存活
    // seek 直接到 20s：不补播（无 feedback）
    const w2 = mountPlayback(overview, 20, ds)
    await flushPromises()
    Object.defineProperty(w2.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    expect(w2.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(w2.find('[data-test="pb-burst"]').exists()).toBe(false)
    expect(w2.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
  })

  it('B2 loop：末尾事件消费一次后回绕 0；下一轮不重复上一轮末尾事件', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.durationSec = 20
    setPositionSamples(ds, 2001, [
      { x: -50, y: -50, timeSec: 0 }, { x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 },
    ], 0, 20)
    ds.events.push(
      { type: 'DAMAGE', timeSec: 19.8, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
      { type: 'DESTROYED', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null },
      { type: 'KILL', timeSec: 20, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null }
    )
    ds.vehicles[1].damageLosses.push(
      { fromSec: 19, toSec: 19.8, hpLoss: 400, fromHp: 1200, toHp: 800, displayCapacityHp: 1200, transientAllowed: true, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }
    )
    // 回绕到 t=0 后受害车（2001）必须仍有锚点：t=0 有真实位置上报，OBSERVED 段从 0 起。
    ds.vehicles[1].positionSegments = [{ knowledge: 'OBSERVED', startSec: 0, endSec: 20,
      samples: [
        { timeSec: 0, x: -50, y: -50 },
        { timeSec: 10, x: -50, y: -50 },
        { timeSec: 14, x: -100, y: -100 },
      ] }]
    const wrapper = mount(BattlePlayback, {
      props: { overview, seekTo: 19, loop: true, playbackV2: ds },
      global: { mocks: { $t: i18n.t } }
    })
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1300
    rafCb(1300) // t=20：先消费 (19, 20] 再回绕到 0（仍在播放）
    await flushPromises()
    // 回绕：时间归 0；末尾事件已被消费（kill feed 可见，恰好 1 条；float 已生成）
    expect(wrapper.find('.pb-time').text()).toBe('00:00 / 00:20')
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    // 下一轮前段（无事件）：上一轮末尾事件不重复（feed 仍 1 条、float 按 wall-clock 到期）
    clock.now = 2600
    rafCb(2600) // +1.3s → t=1.3（round 2）
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false) // 上一轮 float 到期，未重复
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1) // 上一轮 feed 仍在自然存活，未重复
  })
})

describe('V2 HP regression (restored critical coverage)', () => {
  function mountV2(seekTo = 0, ds = makePlaybackV2()) {
    return mount(BattlePlayback, {
      props: { overview: makeOverview(), seekTo, playbackV2: ds },
      global: { mocks: { $t: i18n.t } }
    })
  }

  it('known+unknown team：enemy 含未知车辆 → PARTIAL 数值，不伪造全队分数', async () => {
    const w = mountV2(15)
    await flushPromises()
    // friendly 队唯一车辆全 known（CURRENT+cap）→ EXACT 真实分数
    expect(w.find('[data-test="pb-hp-value-friendly"]').text()).toBe('1500 / 1500')
    // enemy 队 2001 known + 2002 无数据 → PARTIAL：只显示真实已知剩余，不带 /总HP
    expect(w.find('[data-test="pb-hp-value-enemy"]').text()).toBe('800')
    expect(w.find('[data-test="pb-hp-value-enemy"]').text()).not.toContain('/')
  })

  it('无 health evidence 的己方队伍保持 relative-full presentation；敌方仍 UNKNOWN', async () => {
    const ds = makePlaybackV2()
    ds.vehicles.forEach((v) => { v.healthTransitions = [] })
    ds.vehicles[0].healthTransitions = [{ timeSec: 0, currentHp: null, knowledge: 'CURRENT', source: 'RELATIVE_FULL', displayCapacityHp: null, relativeFull: true, confidence: 'UNKNOWN' }]
    const w = mountV2(15, ds)
    await flushPromises()
    expect(w.find('[data-test="pb-hp-value-friendly"]').text()).toBe('100%')
    expect(w.find('[data-test="pb-hp-value-enemy"]').text()).toBe('—')
  })

  it('LAST_KNOWN：hidden interval 冻结 HP、不泄漏未来值；Details 标 LAST_KNOWN', async () => {
    const ds = makePlaybackV2()
    const enemy = ds.vehicles[1]
    enemy.positionSegments = [
      { knowledge: 'OBSERVED', startSec: 0, endSec: 20,
        samples: [{ timeSec: 0, x: -50, y: -50 }, { timeSec: 20, x: -60, y: -60 }] },
      { knowledge: 'OBSERVED', startSec: 30, endSec: 60,
        samples: [{ timeSec: 30, x: -60, y: -60 }, { timeSec: 60, x: -60, y: -60 }] },
    ]
    enemy.orientationSegments = []
    enemy.healthTransitions = [
      { timeSec: 0, currentHp: 1200, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 20, currentHp: 1200, knowledge: 'LAST_KNOWN', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 30, currentHp: 600, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
    ]
    enemy.lifeTransitions = []
    const w = mountV2(10, ds)
    await flushPromises()
    // 覆盖期 t=10 → CURRENT 1200
    expect(enemyHudNum(w)).toBe('1200')
    // hidden interval t=25 → LAST_KNOWN 冻结 1200，不泄漏未来 600
    await w.find('.pb-range').setValue(25)
    await flushPromises()
    expect(enemyHudNum(w)).toBe('1200')
    expect(enemyHudNum(w)).not.toBe('600')
    await w.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    expect(detailsHpNum(w.find('[data-test="pb-info"]'))).toBe('1200')
    expect(w.find('[data-test="pb-info"]').text()).toContain('recon.map.playback.last_known_hp')
    // backward seek 确定性：30（re-acquire 600）→ 25（冻结 1200），未来值不泄漏
    await w.find('.pb-range').setValue(30)
    await flushPromises()
    expect(enemyHudNum(w)).toBe('600')
    await w.find('.pb-range').setValue(25)
    await flushPromises()
    expect(enemyHudNum(w)).toBe('1200')
  })

  it('marker 百分比 + Details HP 一致性：pct=current/displayCapacityHp', async () => {
    const ds = makePlaybackV2()
    const enemy = ds.vehicles[1]
    enemy.positionSegments = [{ knowledge: 'OBSERVED', startSec: 0, endSec: 60,
      samples: [{ timeSec: 0, x: -50, y: -50 }, { timeSec: 60, x: -60, y: -60 }] }]
    enemy.orientationSegments = []
    enemy.healthTransitions = [
      { timeSec: 0, currentHp: 1200, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 10, currentHp: 600, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
    ]
    enemy.lifeTransitions = []
    const w = mountV2(10, ds)
    await flushPromises()
    // marker HUD 数字 + 百分比条
    expect(enemyHudNum(w)).toBe('600')
    expect(w.find('[data-test="pb-marker-2001"] .pb-hp-fill').attributes('style')).toContain('50%')
    // Details HP 与 marker 一致（600）
    await w.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    expect(detailsHpNum(w.find('[data-test="pb-info"]'))).toBe('600')
  })

  it('destroyed：隐藏单车 HP + Details 显示 0 与 destroyed_at', async () => {
    const ds = makePlaybackV2()
    ds.vehicles[1].lifeTransitions = [{ timeSec: 25, lifeState: 'DESTROYED', destroyedKnownAtSec: 25 }]
    const w = mountV2(30, ds)
    await flushPromises()
    // marker 阵亡（lifeState）→ 隐藏单车 HP number+bar（§18/§19）
    expect(w.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(w.find('[data-test="pb-marker-2001"] .pb-hp-fill').exists()).toBe(false)
    expect(w.find('[data-test="pb-marker-2001"]').find('.pb-death').exists()).toBe(true)
    // §21：Details 明确「已击毁」状态，不重点展示 0 HP；destroyed_at → 00:25
    await w.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    const info = w.find('[data-test="pb-info"]')
    expect(detailsHpNum(info)).toBeNull()
    expect(info.text()).toContain('recon.map.playback.state_destroyed')
    expect(info.text()).toContain('00:25')
  })

  it('队伍阵容：从 result 名单取，不依赖事件流（无位置的敌方也列出）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await openPanel(wrapper, 'team')
    const friendly = wrapper.findAll('[data-test="pb-team-friendly"] li')
    const enemy = wrapper.findAll('[data-test="pb-team-enemy"] li')
    expect(friendly).toHaveLength(1)      // 仅 You/Maus（friendly roster）
    expect(enemy).toHaveLength(2)          // EnemyA/T49 + NeverSeen：后者在 event 流中从无位置，但仍来自 result 名单
    expect(friendly[0].text()).toContain('Maus')
    expect(enemy[0].text()).toContain('T49')
    expect(enemy[1].text()).toContain('NeverSeen')
  })
})
