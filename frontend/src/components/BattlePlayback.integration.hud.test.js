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
    rafState.cb(0)
    clock.now = 1300
    rafState.cb(1300) // +1.3s → t=12.3 跨过 DAMAGE@12
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    // wall-clock 到期（>1s）消失（此时 rafState.cb 仍指向 wrapper 的 frame）
    clock.now = 2600
    rafState.cb(2600)
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
    rafState.cb(0)
    clock.now = 1500
    rafState.cb(1500) // t=14.5 跨过 DAMAGE@14（失察期）
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
    rafState.cb(0)
    clock.now = 34100
    rafState.cb(34100) // t≈43：跨过完整 hidden-window loss，canonical facts remain visible
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
    rafState.cb(0)
    rafState.cb(1300) // t=12.3 跨过 DAMAGE@12
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
    rafState.cb(0)
    rafState.cb(5100) // t=17.1 跨过 4 条 KILL
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
    // 真实数据里 DamageLoss 来自两条可信读数，HP 条必然同时下降；承受伤害按 HP 条计
    ds.vehicles[0].healthTransitions.push({ timeSec: 14, currentHp: 1300, knowledge: 'CURRENT', displayCapacityHp: 1500, relativeFull: false, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' })
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

  it('issue557: 2D Details reads the recorded recorder total without leaking a future broadcast', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    ds.vehicles[0].damageDealtSamples = [{ timeSec: 10, total: 900 }, { timeSec: 30, total: 2000 }]
    const wrapper = mountPlayback(makeOverview(), 18, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(sidebarValue(wrapper.find('[data-test="pb-info"]'), 'recon.map.playback.damage_recorded')).toBe('900')
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
    rafState.cb(0)
    clock.now = 6000
    rafState.cb(6000) // +6s → t=17：跨过 DAMAGE@12 与 KILL@16
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
    rafState.cb(0)
    clock.now = 1300
    rafState.cb(1300) // +1.3s → t=20（duration）：先消费 (19, 20] 再停止
    await flushPromises()
    // 末尾最后一段事件全部消费一次：floating damage + burst + kill feed
    expect(wrapper.findAll('[data-test="pb-float-dmg"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(true)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    // 到达 duration 后停止；后续仅轻量时钟推进（wall-clock 自然完成），不产生重复消费
    clock.now = 2500
    rafState.cb(2500)
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
    rafState.cb(0)
    clock.now = 1300
    rafState.cb(1300) // t=20：先消费 (19, 20] 再回绕到 0（仍在播放）
    await flushPromises()
    // 回绕：时间归 0；末尾事件已被消费（kill feed 可见，恰好 1 条；float 已生成）
    expect(wrapper.find('.pb-time').text()).toBe('00:00 / 00:20')
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    // 下一轮前段（无事件）：上一轮末尾事件不重复（feed 仍 1 条、float 按 wall-clock 到期）
    clock.now = 2600
    rafState.cb(2600) // +1.3s → t=1.3（round 2）
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false) // 上一轮 float 到期，未重复
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1) // 上一轮 feed 仍在自然存活，未重复
  })

  it('B5A-fix kill feed 隐藏时不无限续约暂停时钟；恢复显示重启时钟并展示队列', async () => {
    // 记录 RAF 调度次数：隐藏 feed 时暂停时钟必须收敛，不得为不可见内容无限续约
    let rafScheduled = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafScheduled += 1; rafState.cb = cb; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const clock = fakeClock()
    const prefs = usePlaybackPreferences()
    prefs.uiPrefs.showKillfeed = false
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.events.push({ type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 11, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafState.cb(0)
    clock.now = 6000
    rafState.cb(6000) // t=17：消费 DAMAGE@12 + KILL@16（feed 隐藏 → 排队无 shownAt）
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 暂停：隐藏 feed 不算 pending；可见 float/ghost 按原寿命完成后调度必须收敛
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    const counts = []
    for (let i = 0; i < 12; i++) {
      clock.now += 500
      if (rafState.cb) rafState.cb(clock.now)
      await flushPromises()
      counts.push(rafScheduled)
    }
    expect(counts[counts.length - 1]).toBe(counts[counts.length - 4]) // 末 3 帧无新调度
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 暂停期间墙钟前移 10s（不执行任何 RAF）：nowMs 保持旧值
    clock.now += 10_000
    // 恢复显示：watch 重启时钟，队列提升并可见
    prefs.uiPrefs.showKillfeed = true
    await flushPromises()
    expect(rafScheduled).toBeGreaterThan(counts[counts.length - 1]) // 时钟被重启
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('EnemyA（T49）')
    // 恢复后 +2s 仍可见（shownAt 必须取新鲜时钟——旧 nowMs 会把首帧渲染的
    // shownAt 记成暂停前旧值，下一帧新鲜时间一到立即过期 → 只闪现一帧）
    for (let i = 0; i < 4; i++) {
      clock.now += 500
      if (rafState.cb) rafState.cb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    // 恢复后累计 >4s：自然消失
    for (let i = 0; i < 6; i++) {
      clock.now += 500
      if (rafState.cb) rafState.cb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 动画结束后 RAF 停止续约
    const scheduledAtEnd = rafScheduled
    clock.now += 500
    if (rafState.cb) rafState.cb(clock.now)
    await flushPromises()
    expect(rafScheduled).toBe(scheduledAtEnd)
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
    // The visible physical side lanes consume the same authoritative roster.
    const roster = wrapper.get('[data-test="pb-main"]')
    expect(roster.exists()).toBe(true)
    // 按物理队伍分组（Team 1 / Team 2），不是录像者视角的 friendly / enemy
    const friendly = roster.findAll('.pb-roster-team1 [data-test="pb-roster-row"]')
    const enemy = roster.findAll('.pb-roster-team2 [data-test="pb-roster-row"]')
    expect(friendly).toHaveLength(1)      // 仅 You/Maus（Team 1）
    expect(enemy).toHaveLength(2)          // EnemyA/T49 + NeverSeen：后者在 event 流中从无位置，但仍来自 result 名单
    expect(friendly[0].text()).toContain('Maus')
    expect(enemy[0].text()).toContain('T49')
    expect(enemy[1].text()).toContain('NeverSeen')
  })
})

