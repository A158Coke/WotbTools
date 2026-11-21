// @vitest-environment happy-dom
// BattlePlayback 集成矩阵（拆分自 BattlePlayback.integration.test.js；装配见 .harness.js）。
// vi 必须直接来自 vitest：vi.mock 提升依赖它被识别为 vitest API。
import { vi } from 'vitest'
import {
  describe, expect, it, afterEach, beforeEach,
  KeepAlive, defineComponent, h, nextTick, ref,
  flushPromises, mount, readFileSync, resolve,
  PLAYBACK_MOBILE_QUERY, makeOverview, makePlaybackV2,
  preloadBattleModels, loadVehiclePortrait, TANK_ID_TO_MODEL,
  BattlePlayback, usePlaybackPreferences,
  mountBattlePlayback, mountPlayback, openPanel, trackOf, setPositionSamples, setLife,
  rafState, mountedWrappers, stubRaf, detailsHpNum, enemyHudNum, installIntegrationLifecycle,
} from './BattlePlayback.integration.test.harness.js'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

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

installIntegrationLifecycle()

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

  it('renders Assault reset as idle in map/HUD, then resumes later progress and still accepts 100', async () => {
    const overview = { ...makeOverview(), mapCode: 'neptune' }
    const dataset = {
      ...makePlaybackV2({
        baseStates: [
          { timeSec: 0, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: 0 },
          { timeSec: 10, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: 35 },
          { timeSec: 20, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: 0 },
          { timeSec: 30, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: 12 },
          { timeSec: 40, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: 100 },
        ],
      }),
      mapCode: 'neptune',
      assaultObjectivePresent: true,
    }
    const wrapper = await mountPlayback(overview, 40, dataset)
    await flushPromises()

    expect(wrapper.findAll('[data-test="pb-bases"] .pb-base-circle')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-base-BASE"]').text()).toContain('BASE')
    expect(wrapper.findComponent({ name: 'BattleMap' }).props('bases')[0]).toMatchObject({
      x: 49.5339,
      y: 8.5291,
      baseId: 'BASE',
      radius: 20,
      status: 'neutral',
      capturedBy: 'unknown',
      progress: 100,
    })
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(true)
    let rect = wrapper.find('clipPath rect')
    expect(Number(rect.attributes('height'))).toBeCloseTo(Number(rect.attributes('width')), 3)

    await wrapper.setProps({ seekTo: 10 })
    await flushPromises()
    rect = wrapper.find('clipPath rect')
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(true)
    expect(Number(rect.attributes('height'))).toBeCloseTo(Number(rect.attributes('width')) * 0.35, 3)

    // Explicit protocol 0 is a reset: objective remains visible, progress visuals return to idle.
    await wrapper.setProps({ seekTo: 20 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-base-BASE"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="base-badge-BASE"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="base-badge-ring"]').exists()).toBe(false)
    expect(wrapper.find('.base-objective-progress').exists()).toBe(false)

    // A later positive update starts a new visible capture after the reset.
    await wrapper.setProps({ seekTo: 30 })
    await flushPromises()
    rect = wrapper.find('clipPath rect')
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(true)
    expect(Number(rect.attributes('height'))).toBeCloseTo(Number(rect.attributes('width')) * 0.12, 3)
    expect(wrapper.find('.base-objective-progress').text()).toBe('12%')

    // Backward/forward seeks deterministically restore reset vs active presentation.
    await wrapper.setProps({ seekTo: 20 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(false)
    await wrapper.setProps({ seekTo: 10 })
    await flushPromises()
    rect = wrapper.find('clipPath rect')
    expect(Number(rect.attributes('height'))).toBeCloseTo(Number(rect.attributes('width')) * 0.35, 3)

    expect(wrapper.find('[data-test="pb-base-A"]').exists()).toBe(false)
    await wrapper.setProps({ playbackV2: { ...dataset, assaultObjectivePresent: false } })
    expect(wrapper.findAll('[data-test="pb-bases"] .pb-base-circle')).toHaveLength(0)
  })

  it('renders Malinovka Assault initialization without any capture transitions', async () => {
    const dataset = { ...makePlaybackV2(), mapCode: 'malinovka', arenaBonusType: 2,
      assaultObjectivePresent: true, baseStates: [], durationSec: 14.15 }
    const wrapper = mountPlayback({ ...makeOverview(), mapCode: 'malinovka' }, null, dataset)
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-bases"] .pb-base-circle')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-base-BASE"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'BattleMap' }).props('bases')[0].progress).toBeNull()
    await wrapper.setProps({ playbackV2: { ...dataset, assaultObjectivePresent: false } })
    expect(wrapper.findAll('[data-test="pb-bases"] .pb-base-circle')).toHaveLength(0)
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
  // 顶部基地状态条与 3D 共用，始终显示（不再只是地图缺几何时的兜底）；地图上的圆照常画
  it('shows the base status bar alongside the map bases', async () => {
    const dataset = makePlaybackV2({
      baseStates: [{ timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null }],
    })
    const wrapper = await mountPlayback(makeOverview(), null, dataset)
    expect(wrapper.findAll('.pb-base-circle').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="base-status-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="base-badge-A"]').classes()).toContain('is-owner-friendly')
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
    // 从未被观测到的车辆不出现在地图上（阵容列表来自结算名单，仍会列出全员）
    expect(wrapper.find('[data-test="pb-map"]').text()).not.toContain('NeverSeen')
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
  })

  it('seekAndPlay：一次性同步位置 + 播放状态 + 倍速（2D/3D 切换）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), null)
    await flushPromises()
    wrapper.vm.seekAndPlay(20, true, 2)
    await flushPromises()
    expect(wrapper.vm.currentTime).toBeCloseTo(20, 5)
    expect(wrapper.vm.playing).toBe(true)
    expect(wrapper.vm.speed).toBe(2)
    wrapper.vm.seekAndPlay(30, false, 1)
    expect(wrapper.vm.currentTime).toBeCloseTo(30, 5)
    expect(wrapper.vm.playing).toBe(false)
    expect(wrapper.vm.speed).toBe(1)
  })

  it('2D 时间轴渲染与 3D 同款的炮击/击毁刻度（scenePlayback facet 换算）', async () => {
    stubRaf()
    const facet = {
      shots: [{ t_fire: 10, shooter_eid: 1, target_eid: 2, game_hit_result: 3, hit_flags: 0, ricochet: false, is_kill: false, is_author: true }],
      kills: [{ t: 20, killer_eid: 1, victim_eid: 2, cause: 0 }],
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: makePlaybackV2(),
      facetShots: facet.shots, facetKills: facet.kills, clockOffset: 0,
    })
    await flushPromises()
    expect(wrapper.findAll('.pb-tick-shot').length).toBe(1)
    expect(wrapper.findAll('.pb-tick-kill').length).toBe(1)
  })

  it('2D 刻度点击值是战斗相对秒：canonical 偏移下 t 减 clockOffset，pct 不变', async () => {
    stubRaf()
    const facet = {
      shots: [{ t_fire: 60, shooter_eid: 1, is_author: false }],
      kills: [{ t: 90 }],
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: makePlaybackV2(),
      facetShots: facet.shots, facetKills: facet.kills, clockOffset: 30,
    })
    await flushPromises()
    // makePlaybackV2 durationSec=60 → 原始轴 [30, 90]：t_fire=60 / kill 90 → 50% / 100%；
    // 点击吸附返回值必须是战斗相对秒（60-30=30、90-30=60），否则 seek 会跳错时刻。
    const controls = wrapper.findComponent({ name: 'PlaybackControls' })
    expect(controls.props('shotTicks')).toEqual([{ t: 30, pct: 50, highlight: false }])
    expect(controls.props('killTicks')).toEqual([{ t: 60, pct: 100 }])
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
    // 事件面板默认折叠：二级面未打开时事件行不在 DOM 里，入口在 Display 面里的 pb-panel-events。
    expect(wrapper.find('[data-test="pb-event-panel"]').exists()).toBe(false)
    await openPanel(wrapper, 'display')
    expect(wrapper.find('[data-test="pb-panel-events"]').exists()).toBe(true)
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
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.pause')
    rafState.cb(0)
    rafState.cb(1000)
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
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.play')
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
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.pause')
    await wrapper.find('.pb-range').trigger('pointerdown')
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.play')
    rafState.cb(1000) // 残留 RAF 回调不得再推进时间
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
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.pause')
  })

  it('a single play click schedules exactly one RAF loop', async () => {
    let rafCalls = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCalls++
      rafState.cb = cb
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

describe('2D Playback reload telemetry', () => {
  const telemetry = () => ({
    timeOrigin: 40,
    friendlyTeam: 1,
    vehicles: [
      { eid: 7, account_id: 1001, team: 1, tank_id: 1 },
      { eid: 8, account_id: 2001, team: 2, tank_id: 2 },
    ],
    reloads: [
      { eid: 7, clock: 50, phase: 3, duration_s: 8, count: null },
      { eid: 8, clock: 50, phase: 3, duration_s: 4, count: null },
    ],
    reload_effective: [{ eid: 7, clock: 40, duration_s: 4 }],
    shots: [],
  })
  const marker = (wrapper, accountId) => wrapper.findAllComponents({ name: 'VehicleMarker' })
    .find((component) => component.props('marker').vehicle.accountId === accountId)

  it('passes authoritative friendly reload to labels with canonical time; enemy stays unknown', async () => {
    const wrapper = mountBattlePlayback({ overview: makeOverview(), playbackV2: makePlaybackV2(), reloadTelemetry: telemetry(), seekTo: 12 })
    await flushPromises()
    expect(marker(wrapper, 1001).props('marker').reloadShells).toEqual([{ state: 'loading', progress: 0.5 }])
    expect(marker(wrapper, 1001).props('label').showReload).toBe(true)
    expect(marker(wrapper, 2001).props('marker').reloadShells).toBeNull()
    await wrapper.setProps({ seekTo: 20 })
    await flushPromises()
    expect(marker(wrapper, 1001).props('marker').reloadShells).toEqual([{ state: 'full', progress: 1 }])
    await wrapper.setProps({ seekTo: 12 })
    await flushPromises()
    expect(marker(wrapper, 1001).props('marker').reloadShells).toEqual([{ state: 'loading', progress: 0.5 }])
    // wall-clock time advancing while playback stays paused cannot change gun progress.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(marker(wrapper, 1001).props('marker').reloadShells).toEqual([{ state: 'loading', progress: 0.5 }])
  })

  it('missing telemetry and unresolved/ambiguous identity remain hidden', async () => {
    const wrapper = mountBattlePlayback({ overview: makeOverview(), playbackV2: makePlaybackV2(), seekTo: 12 })
    await flushPromises()
    expect(marker(wrapper, 1001).props('marker').reloadShells).toBeNull()
    const raw = telemetry()
    await wrapper.setProps({ reloadTelemetry: { ...raw, friendlyTeam: null } })
    await flushPromises()
    expect(marker(wrapper, 1001).props('marker').reloadShells).toBeNull()
    await wrapper.setProps({ reloadTelemetry: { ...raw, vehicles: [...raw.vehicles, { eid: 17, account_id: 1001, team: 1, tank_id: 1 }] } })
    await flushPromises()
    expect(marker(wrapper, 1001).props('marker').reloadShells).toBeNull()
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
  const representativeTurretedModels = [
    ['spht', 'SPHT'],
    ['kranvagn', 'Kranvagn'],
    ['e-100', 'E 100'],
    ['is-7', 'IS-7'],
    ['maus', 'Maus'],
    ['type-5-heavy', 'Type 5 Heavy'],
    ['type-5-h-zetsu', 'Type 5 H Zetsu'],
    ['zmije', 'Zmije'],
  ]

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

  for (const [modelKey, tankName] of representativeTurretedModels) {
    it(`${tankName}：DOM 实际消费 dedicated ${modelKey} hull/turret asset`, async () => {
      stubRaf()
      const tankIdEntry = Object.entries(TANK_ID_TO_MODEL).find(([, mappedModelKey]) => mappedModelKey === modelKey)
      expect(tankIdEntry, `${modelKey} must have a canonical tankId mapping`).toBeDefined()
      const tankId = Number(tankIdEntry[0])
      const { overview, ds } = overviewWithTank(tankId, tankName)
      const model = {
        kind: 'turreted',
        modelKey,
        hullSrc: `/vm/${modelKey}/hull.webp`,
        turretSrc: `/vm/${modelKey}/turret.webp`,
        turretPivot: { x: 160, y: 160 },
        turretRaster: mausRaster,
      }
      vi.mocked(preloadBattleModels).mockResolvedValue({
        resolved: new Map([[modelKey, model]]),
        failed: new Set(),
        byTank: new Map([[String(tankId), modelKey]]),
      })
      const wrapper = mountPlayback(overview, 12, ds)
      await flushPromises()
      const marker = wrapper.find('[data-test="pb-marker-1001"]')
      expect(marker.find('.pb-hull-dedicated').attributes('src')).toBe(`/vm/${modelKey}/hull.webp`)
      expect(marker.find('.pb-turret-dedicated').attributes('src')).toBe(`/vm/${modelKey}/turret.webp`)
      expect(marker.find('.pb-hull:not(.pb-hull-dedicated)').exists()).toBe(false)
      expect(marker.find('.pb-turret:not(.pb-turret-dedicated)').exists()).toBe(false)
    })
  }

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
    // 持久化：localStorage 写入（含新增的 showReload —— 同一份共享偏好里的标签行开关）
    const saved = JSON.parse(localStorage.getItem('wotb.pb.label-prefs'))
    expect(saved).toEqual({ showPlayerName: true, showTankName: true, showReload: true })
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
    const labelsStyle = (m) => (m.find('.pb-presentation').attributes('style') || '')
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
    await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-2"]').trigger('click')
    expect(wrapper.get('[data-test=\"pb-speed-current\"]').text()).toBe('2×')
    await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-4"]').trigger('click')
    expect(wrapper.get('[data-test=\"pb-speed-current\"]').text()).toBe('4×')
    await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-0.5"]').trigger('click')
    expect(wrapper.get('[data-test=\"pb-speed-current\"]').text()).toBe('0.5×')
    await wrapper.get('[data-test="pb-speed-current"]').trigger('click')
    await wrapper.find('[data-test="pb-speed-1"]').trigger('click')
    expect(wrapper.get('[data-test=\"pb-speed-current\"]').text()).toBe('1×')
    // loop：seek 到接近末尾 → 播放 → 越过末尾自动回 0 继续
    await wrapper.setProps({ loop: true })
    const wrap = mountPlayback(makeOverview(), 59)
    await flushPromises()
    await wrap.setProps({ loop: true })
    await wrap.find('[data-test="pb-play"]').trigger('click')
    expect(rafState.cb).toBeTruthy()
    rafState.cb(0)
    rafState.cb(1000) // 推进 1s → 59 + 1 = 60 = duration → loop 回 0
    await flushPromises()
    expect(wrap.find('.pb-time').text()).toBe('00:00 / 01:00')
  })
})

describe('PR4 §33 B3 — 标签防重叠：标签与 HP 永不因碰撞隐藏（车体不参与布局，2026-10-16）', () => {
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
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    await flushPromises()
    expect(playerVisible(wrapper, 2001)).toBe(true)
    expect(tankVisible(wrapper, 2001)).toBe(true)
    expect(hpVisible(wrapper, 2001)).toBe(true)
    if (rafState.cb) { rafState.cb(50_100); await flushPromises() }
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

  it('标记严格落在真实位置（无防重叠位移），标签的防重叠车道仍然生效', async () => {
    // 2026-10-16 用户裁定：2D 车体不再被推开（密集处允许压盖），与 3D 一致；
    // 名牌 / HP 的防重叠由 labelLayout 的车道机制承担（本用例锁住它没被一起删掉）。
    stubRaf()
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()

    const styleOf = (accountId) => markerOf(wrapper, accountId).attributes('style') || ''
    // 位置表达式必须是纯百分比（无 `+ Npx` 位移项）
    expect(styleOf(2001)).toMatch(/left: \d+(\.\d+)?%/)
    expect(styleOf(2001)).not.toMatch(/left: calc\(/)
    expect(styleOf(2001)).not.toMatch(/top: calc\(/)

    // 1× 与 4× 下位置表达式形态一致（相机是 layout-scaled，不再有 screen-px 位移）
    for (let i = 0; i < 14; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    expect(styleOf(2001)).not.toMatch(/left: calc\(/)
    // 车道位移仍然存在（标签块自己会被挪开，车体不动）
    const labelStyle = markerOf(wrapper, 2001).find('.pb-presentation').attributes('style') || ''
    expect(labelStyle).toContain('bottom:')
  })
})
