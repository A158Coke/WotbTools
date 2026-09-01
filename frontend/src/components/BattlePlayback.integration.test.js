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
import BattlePlayback from './BattlePlayback.vue'
import { makeOverview, makePlaybackV2 } from './playbackTestHarness.js'
import { preloadBattleModels } from '../vehicle-models/runtime.js'
import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'
import { PLAYER_FADE_MS, PLAYER_HIDE_MS, PLAYER_SHOW_MS } from '../utils/labelLayout'

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

function mountPlayback(overview = makeOverview(), seekTo = null, dataset = undefined) {
  const finalDataset = dataset === undefined ? makePlaybackV2() : dataset
  return mount(BattlePlayback, {
    props: { overview, seekTo, playbackV2: finalDataset },
    global: { mocks: { $t: i18n.t } }
  })
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
    const wrapper = mount(BattlePlayback, {
      props: { overview: null, seekTo: null, playbackV2: v2Only },
      global: { mocks: { $t: i18n.t } },
    })
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    // recorder 存在时显示「全部事件」过滤器（来自 V2 recorderAccountId）
    expect(wrapper.find('[data-test="pb-all-events"]').exists()).toBe(true)
  })

  it('seeks on seekTo and pauses', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 30)
    await flushPromises()
    expect(wrapper.text()).toContain('00:30 / 01:00')
  })

  it('drives marker + inspector from V2 canonical tracks (AC-10)', async () => {
    stubRaf()
    const wrapper = mount(BattlePlayback, {
      props: { overview: makeOverview(), playbackV2: makePlaybackV2(), seekTo: 30 },
      global: { mocks: { $t: i18n.t } },
    })
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

  it('event markers open the per-second popup', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    const markers = wrapper.findAll('.pb-marker')
    expect(markers.length).toBeGreaterThanOrEqual(3)
    const damageMarker = markers.find(m => m.attributes('style').includes('20%'))
    await damageMarker.trigger('click')
    expect(wrapper.find('[data-test="pb-popup"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('recon.map.playback.event_DAMAGE')
    expect(wrapper.text()).toContain('400')
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

  it('event marker click and prev/next jumps keep the player paused', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 11)
    await flushPromises()
    await wrapper.find('[data-test="pb-next"]').trigger('click')
    expect(wrapper.find('[data-test="pb-play"]').text()).toBe('recon.map.playback.play')
    expect(wrapper.text()).toContain('00:12 / 01:00')
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
    expect(w2.find('[data-test="pb-show-player"]').element.checked).toBe(true)
    expect(w2.findAll('.pb-label-player').length).toBe(2)
  })

  it('§32/§33/§34 碰撞集成：两车贴近 → 上方 tank 标签上移，玩家名经 hysteresis 后隐藏', async () => {
    stubRaf()
    // performance.now 全程受控（fakeNow），hysteresis 时间轴确定
    let fakeNow = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
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
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await wrapper.find('.pb-range').setValue(12.5) // 触发 seek（值变化）→ 重算 labelLayout
    await flushPromises()
    // 上方（friendly 1001，y 更小）tank 标签上移让位
    const a = wrapper.find('[data-test="pb-marker-1001"]')
    const b = wrapper.find('[data-test="pb-marker-2001"]')
    const aDy = parseFloat((a.find('.pb-labels').attributes('style') || '').match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || '0')
    expect(aDy).toBeLessThan(2) // 上方标签被上移（2 + dy < 2 基准）
    // 玩家名：冲突持续超过 hideMs（250ms）才隐藏（fakeNow 受控推进）
    await wrapper.find('.pb-range').setValue(12.1) // seek 刷新 nowMs（冲突开始计时，fakeNow=0）
    await flushPromises()
    expect(b.find('.pb-label-player').attributes('style')).toBeUndefined() // 未到阈值仍显示
    fakeNow = 400 // 400ms > hideMs
    await wrapper.find('.pb-range').setValue(12.2)
    await flushPromises()
    expect(b.find('.pb-label-player').attributes('style')).toContain('display: none') // 已隐藏
    nowSpy.mockRestore()
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
    const btn = wrapper.find('[data-test="pb-speed"]')
    await btn.trigger('click')
    expect(btn.text()).toBe('2×')
    await btn.trigger('click')
    expect(btn.text()).toBe('4×')
    await btn.trigger('click')
    expect(btn.text()).toBe('0.5×')
    await btn.trigger('click')
    expect(btn.text()).toBe('1×')
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


describe('PR4 §33 B3 — hysteresis 使用 UI wall clock（暂停不冻结；fade-in 完整生命周期）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
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

  function playerElOf(wrapper) {
    return wrapper.find('[data-test="pb-marker-2001"]').find('.pb-label-player')
  }

  it('暂停 + zoom 产生 conflict → ~250ms 后正常 hide（不依赖播放）', async () => {
    stubRaf()
    let fakeNow = 50_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 暂停态 zoom（wheel）→ 布局变化；hysteresis 时钟必须继续（轻量 RAF）
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 未到阈值
    expect(rafCb).toBeTruthy() // 轻量 hysteresis RAF 已注册（未决 transition）
    fakeNow = 50_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 暂停态 250ms 后隐藏
    nowSpy.mockRestore()
  })

  it('暂停 + 冲突解除 → ~300ms 后正常 show（seek 不破坏 hysteresis）', async () => {
    stubRaf()
    let fakeNow = 60_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const { overview, ds } = overlapOverview()
    // t≤12 同位冲突；t=13.8 两车分离（线性插值）
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
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 隐藏（250ms）
    fakeNow = 60_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none')
    // 冲突解除（seek 到分离位置）→ show 计时重新开始
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 未到 300ms
    fakeNow = 60_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 恢复显示
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading') // fade-in 开始
    nowSpy.mockRestore()
  })

  it('fade-in 不会在下一个 RAF 立即消失（≥PLAYER_FADE_MS 完整生命周期）', async () => {
    stubRaf()
    let fakeNow = 70_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
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
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    const el = () => playerElOf(wrapper)
    // hide
    fakeNow = 70_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(el().attributes('style')).toContain('display: none')
    // show（解除冲突）
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    fakeNow = 70_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(el().classes()).toContain('pb-label-fading')
    // 下一 RAF（10ms 后）仍保持 fade 类（不被下一次 resolve 取消）
    fakeNow += 10
    rafCb(fakeNow)
    await flushPromises()
    expect(el().classes()).toContain('pb-label-fading')
    // 超过 PLAYER_FADE_MS → 类移除
    fakeNow += PLAYER_FADE_MS + 20
    rafCb(fakeNow)
    await flushPromises()
    expect(el().classes()).not.toContain('pb-label-fading')
    nowSpy.mockRestore()
  })

  it('播放中同样工作（frame() 驱动时钟）', async () => {
    stubRaf()
    let fakeNow = 80_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 未到阈值
    await wrapper.find('[data-test="pb-play"]').trigger('click') // 播放
    await flushPromises()
    fakeNow = 80_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow) // frame → nowMs 刷新 → resolve
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 播放中 250ms 后隐藏
    nowSpy.mockRestore()
  })

  it('Blocker1：播放中 conflict 未完成 → Pause → 轻量 clock 接管 → 到 250ms 正常 hide', async () => {
    stubRaf()
    let fakeNow = 90_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 播放（frame 驱动 nowMs）
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    expect(rafCb).toBeTruthy()
    fakeNow = 90_000 + 100 // 播放 100ms，conflict 尚未到 hide 阈值
    rafCb(fakeNow) // frame：首帧 delta 0，nowMs 刷新
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 未隐藏
    // Pause：pending hide 的 clock 必须由轻量 hysteresis RAF 接管
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 90_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow) // hystTick
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // Pause 后仍到达 250ms
    nowSpy.mockRestore()
  })

  it('Blocker1：播放中隐藏 → 冲突解除（show pending）→ Pause → 到 300ms 正常 show', async () => {
    stubRaf()
    let fakeNow = 91_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const { overview, ds } = overlapOverview()
    // 前段同位冲突，后段分离：seek 到分离段解除冲突
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
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 播放中完成 hide
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 91_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow) // frame 首帧 delta 0
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none')
    // 冲突解除（seek 分离段）→ show pending
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 未到 300ms
    // Pause：show pending 的 clock 接管
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 91_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 已恢复显示
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading')
    nowSpy.mockRestore()
  })

  it('Blocker1：fade-in 开始 → Pause → 120ms 后 class 正常清除', async () => {
    stubRaf()
    let fakeNow = 92_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const { overview, ds } = overlapOverview()
    // 前段同位冲突，后段分离：seek 到分离段解除冲突（保持 showPlayer on，player 元素恒存在）
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
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 播放中 hide
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 92_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none')
    // 冲突解除（seek 分离段）→ show pending（播放中，frame 仍驱动时钟）
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 未到 300ms
    fakeNow = 92_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow) // frame：delta 300 → currentTime 14.1（分离位置，无冲突）→ show + fade 开始
    await flushPromises()
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading')
    // Pause：fade 剩余生命周期由轻量 clock 接管
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow += 10
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading') // 未到 120ms 仍保留
    fakeNow += PLAYER_FADE_MS + 20
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).classes()).not.toContain('pb-label-fading')
    nowSpy.mockRestore()
  })

  it('Blocker1：无 pending 时 Pause 不启动轻量 RAF（不永久轮询）', async () => {
    stubRaf()
    let fakeNow = 93_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    let rafCount = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafCount++; rafCb = cb; return rafCount })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const wrapper = mountPlayback(makeOverview(), 12) // 默认两车相距远 → 无冲突
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    const afterPlay = rafCount
    expect(afterPlay).toBeGreaterThan(0)
    // Pause：无 pending → 不新增 RAF
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    expect(rafCount).toBe(afterPlay)
    nowSpy.mockRestore()
  })

  it('Blocker1：unmount 时正确 cancel hystRaf（不残留）', async () => {
    stubRaf()
    let fakeNow = 94_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const cancelled = []
    vi.stubGlobal('cancelAnimationFrame', (id) => cancelled.push(id))
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafCb = cb; return 7 })
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // pending hide → scheduler 已注册 hystRaf（id 7）
    expect(cancelled).not.toContain(7)
    wrapper.unmount()
    expect(cancelled).toContain(7) // hystRaf 被 cancel
    nowSpy.mockRestore()
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
    let roCb = null
    const RO = vi.fn(function (cb) { roCb = cb; this.observe = vi.fn(); this.disconnect = vi.fn() })
    vi.stubGlobal('ResizeObserver', RO)
    return () => roCb
  }

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetFullscreenGlobals()
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
    await wrapper.find('[data-test="pb-speed"]').trigger('click') // 2×
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 }) // 选中
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const speedBefore = wrapper.find('[data-test="pb-speed"]').text()
    const infoBefore = wrapper.find('[data-test="pb-info"]').text()
    const viewportBefore = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    // 进入
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-speed"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
    // 退出
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-speed"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
  })

  it('11/12/13：ResizeObserver 容器宽变化 → markerScreen/labelLayout 使用新尺寸（相对距离随容器缩放）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    // markerScreen 返回容器比例坐标（×W/766）：两车 Δx=20 地图单位 → 800 宽屏幕距 ≈26.6px
    // < 标签盒 30.4px → 冲突；1600 宽屏幕距 ≈53.3px > 30.4 → 无冲突（标签屏幕恒定）
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -205, y: -196.7, timeSec: 10 }, { x: -205, y: -196.7, timeSec: 14 }], 0, 60)
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    expect(roCb()).toBeTruthy() // RO 已挂载
    const mapEl = wrapper.find('[data-test="pb-map"]').element
    // 2001（map y=-196.7）屏幕位置更靠上 → 是"上方"标签（冲突时上移让位）
    const labelsStyle = () => wrapper.find('[data-test="pb-marker-2001"]').find('.pb-labels').attributes('style') || ''
    const dy = (s) => parseFloat(s.match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || '2')
    // 800 宽：两车屏幕距 ≈26.6px < 标签宽 30.4px → 冲突 → 上方 2001 上移
    Object.defineProperty(mapEl, 'clientWidth', { value: 800, configurable: true })
    roCb()([{ contentRect: { width: 800, height: 800 } }])
    await flushPromises()
    expect(dy(labelsStyle())).toBeLessThan(2)
    // 800 → 1600（fullscreen 容器变化）→ RO 触发 → 屏幕距翻倍（≈53px）→ 无冲突 → 基准 2px
    Object.defineProperty(mapEl, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    expect(dy(labelsStyle())).toBe(2)
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

  it('15：fullscreen（1600）+ 1×/2× zoom → collision 使用新 viewport 继续正确', async () => {
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
    const dy2x = parseFloat(style2x.match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || '2')
    expect(dy2x).toBeLessThan(2) // 2× 下同位冲突位移仍生效（tankDy×inv < 2）
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

  it('§4/§5/§6 HP HUD：数字+bar 随 timeline 确定性重建；UNKNOWN 显示 —；destroyed 归零', async () => {
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
    // destroyed → 权威 0
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 0, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
    ]
    ds.vehicles[1].lifeTransitions = [{ timeSec: 12, lifeState: 'DESTROYED', destroyedKnownAtSec: 12 }]
    const w2 = mountPlayback(overview, 15, ds)
    await flushPromises()
    expect(w2.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-num"]').text()).toBe('0')
  })

  it('§4.3 HP HUD 开关：默认开启、localStorage 持久化、关闭隐藏数字/bar/ghost', async () => {
    stubRaf()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [{ timeSec: 0, currentHp: 3000, knowledge: 'CURRENT', displayCapacityHp: 3000, source: 'EXACT_BATTLE_EVENT' }]
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
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
    ds2.vehicles[1].damageLosses = [{ fromSec: 13, toSec: 14, hpLoss: 500, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }]
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

  it('§10.3/§11 HP transition：跨过 DAMAGE 产生 ghost（同阵营浅版）+ fill 立即到新值', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    // Blocker 3：ghost 需要 pct，而 pct 只在进场满血已证明（OBSERVED_EXACT）时存在——
    // 本测试用已证明 entryHp=2600 验证真实百分比 ghost/填充
    ds.vehicles[1].healthTransitions = [
      { timeSec: 0, currentHp: 2600, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 12, currentHp: 2200, knowledge: 'CURRENT', displayCapacityHp: 2600, source: 'EXACT_BATTLE_EVENT' },
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

  it('§16 kill feed：只显示受害者被击毁（§15.2 无攻击者名）；最多 3 条队列', async () => {
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
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(3)
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
    expect(detailsHpNum(info)).toBe('0')
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

  function clickChip(wrapper, labelFragment) {
    const chip = wrapper.findAll('.pb-chip').find((b) => b.text().includes(labelFragment))
    if (!chip) throw new Error('chip not found: ' + labelFragment)
    return chip.trigger('click')
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

  it('B1-1 typeFilter：关闭 DAMAGE/KILL checkbox 后 deterministic stats 完全不变', async () => {
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
    // 关闭 DAMAGE checkbox → presentation 变化（事件标记减少），stats 完全不变
    const markersBefore = wrapper.findAll('.pb-marker').length
    await clickChip(wrapper, 'event_DAMAGE')
    await flushPromises()
    expect(wrapper.findAll('.pb-marker').length).toBeLessThan(markersBefore)
    info = wrapper.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('400')
    expect(sidebarValue(info, 'recon.map.playback.damage_received')).toBe('200')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
    // 关闭 KILL checkbox → kills 仍不变
    await clickChip(wrapper, 'event_KILL')
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
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
    // 该事件同时被 presentation scope 隐藏（无 15s 事件标记）——证明 stats 未被 scope 截断
    const titles = wrapper.findAll('.pb-marker').map((m) => m.attributes('title') || '')
    expect(titles.some((s) => s.includes('00:15'))).toBe(false)
    // team scope（arenaBonusType=2）：2001→2002 双方均非 friendly team → presentation 过滤，stats 仍计入
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
    const titles2 = w2.findAll('.pb-marker').map((m) => m.attributes('title') || '')
    expect(titles2.some((s) => s.includes('00:15'))).toBe(false)
  })

  it('B1-1 combat feedback 不依赖列表过滤器：DAMAGE/KILL checkbox 关闭时播放跨过仍触发', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events.push({ type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    // 关闭 DAMAGE 与 KILL 的事件列表 checkbox
    await clickChip(wrapper, 'event_DAMAGE')
    await clickChip(wrapper, 'event_KILL')
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 6000
    rafCb(6000) // +6s → t=17：跨过 DAMAGE@12 与 KILL@16
    await flushPromises()
    // 即使事件列表 UI 不显示，combat feedback 仍按需求触发
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
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
      { fromSec: 19, toSec: 19.8, hpLoss: 400, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }
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
      { fromSec: 19, toSec: 19.8, hpLoss: 400, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }
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

  it('destroyed：标记归零 + Details 显示 0 与 destroyed_at', async () => {
    const ds = makePlaybackV2()
    ds.vehicles[1].lifeTransitions = [{ timeSec: 25, lifeState: 'DESTROYED', destroyedKnownAtSec: 25 }]
    const w = mountV2(30, ds)
    await flushPromises()
    // marker 阵亡 → 0
    expect(enemyHudNum(w)).toBe('0')
    expect(w.find('[data-test="pb-marker-2001"] .pb-hp-fill').attributes('style')).toContain('0%')
    // Details HP → 0；destroyed_at → 00:25
    await w.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    const info = w.find('[data-test="pb-info"]')
    expect(detailsHpNum(info)).toBe('0')
    expect(info.text()).toContain('00:25')
  })
})
