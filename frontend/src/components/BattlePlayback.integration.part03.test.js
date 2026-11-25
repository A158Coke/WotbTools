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

  it('B5A-fix kill feed 隐藏时不无限续约暂停时钟；恢复显示重启时钟并展示队列', async () => {
    // 记录 RAF 调度次数：隐藏 feed 时暂停时钟必须收敛，不得为不可见内容无限续约
    let rafScheduled = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafScheduled += 1; rafCb = cb; return 1 })
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
    rafCb(0)
    clock.now = 6000
    rafCb(6000) // t=17：消费 DAMAGE@12 + KILL@16（feed 隐藏 → 排队无 shownAt）
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 暂停：隐藏 feed 不算 pending；可见 float/ghost 按原寿命完成后调度必须收敛
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    const counts = []
    for (let i = 0; i < 12; i++) {
      clock.now += 500
      if (rafCb) rafCb(clock.now)
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
      if (rafCb) rafCb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    // 恢复后累计 >4s：自然消失
    for (let i = 0; i < 6; i++) {
      clock.now += 500
      if (rafCb) rafCb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    // 动画结束后 RAF 停止续约
    const scheduledAtEnd = rafScheduled
    clock.now += 500
    if (rafCb) rafCb(clock.now)
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

describe('Playback secondary convergence', () => {
  it('opens Events through Display and keeps event seek/pause behavior reachable', async () => {
    const wrapper = mountPlayback()
    await flushPromises()
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-panel-events"]').trigger('click')
    expect(wrapper.get('[data-testid="display-panel"]').find('[data-test="pb-event-panel"]').exists()).toBe(true)
    const event = wrapper.find('[data-test="pb-event"]')
    expect(event.exists()).toBe(true)
    await event.trigger('click')
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('playing')).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBeGreaterThan(0)
    await wrapper.get('[data-test="pb-events-back"]').trigger('click')
    expect(wrapper.find('[data-test="pb-panel-content-display"]').exists()).toBe(true)
  })

  it('opens one closeable annotation toolbar under Transport in wide form', async () => {
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-annotation-entry"]').trigger('click')
    expect(wrapper.find('[data-testid="display-panel"]').exists()).toBe(false)
    expect(wrapper.findAllComponents({ name: 'AnnotationToolbar' })).toHaveLength(1)
    expect(wrapper.get('[data-test="pb-transport-slot"]').find('.pb-annotation-toolbar').exists()).toBe(true)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('activeTool')).toBe('select')
    await wrapper.getComponent({ name: 'AnnotationToolbar' }).vm.$emit('close')
    await nextTick()
    expect(wrapper.findComponent({ name: 'AnnotationToolbar' }).exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('activeTool')).toBe(null)
  })

  it('map selection displays and updates HP from the current replay time', async () => {
    const ds = makePlaybackV2()
    ds.vehicles[0].healthTransitions = [
      { timeSec: 0, currentHp: 1000, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 10, currentHp: 600, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' },
      { timeSec: 20, currentHp: 400, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' },
    ]
    const wrapper = mountPlayback(makeOverview(), 10, ds)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.get('[data-test="pb-sb-hp-current"]').text()).toBe('600')
    expect(wrapper.get('[data-test="pb-sb-hp-max"]').text()).toContain('1000')
    expect(wrapper.get('[data-test="pb-sb-hp-percentage"]').text()).toContain('60%')
    await wrapper.setProps({ seekTo: 20 })
    await flushPromises()
    expect(wrapper.get('[data-test="pb-sb-hp-current"]').text()).toBe('400')
  })

  it('switches HP presentation and applies the ring declutter preset without changing playback', async () => {
    const wrapper = mountPlayback()
    await flushPromises()
    const time = wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-testid="pb-hp-mode-ring"]').trigger('click')
    const map = wrapper.getComponent({ name: 'BattleMap' })
    const prefs = usePlaybackPreferences()
    expect(map.props('hpPrefs').mode).toBe('ring')
    expect(map.props('markerLabel')(1001).showReload).toBe(false)
    expect(wrapper.get('[data-test="pb-show-reload"]').element.disabled).toBe(true)
    expect(prefs.labelPrefs.showReload).toBe(true)
    expect(wrapper.findAll('[data-test="pb-hp-ring"]').length).toBeGreaterThan(0)
    await wrapper.get('[data-testid="pb-hp-mode-bar"]').trigger('click')
    expect(map.props('markerLabel')(1001).showReload).toBe(true)
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(prefs.hpPrefs).toEqual({ showHp: true, mode: 'ring' })
    expect(wrapper.findAll('[data-test="pb-hp-ring"]').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    await wrapper.get('[data-test="pb-declutter"]').trigger('click')
    expect(prefs.hpPrefs.mode).toBe('bar')
    expect(prefs.labelPrefs.showReload).toBe(true)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBe(time)
  })

  it('honors shared HUD/base/killfeed/Reload preferences without changing replay state', async () => {
    const dataset = makePlaybackV2({ baseStates: [{ timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null }] })
    const wrapper = mountPlayback(makeOverview(), 8, dataset)
    await flushPromises()
    const time = wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-show-hud"]').setValue(false)
    expect(wrapper.find('[data-test="pb-hp-bars"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud-bases"]').exists()).toBe(true)
    await wrapper.get('[data-test="pb-show-base"]').setValue(false)
    expect(wrapper.find('[data-test="pb-hud"]').exists()).toBe(false)
    await wrapper.get('[data-test="pb-show-killfeed"]').setValue(false)
    await wrapper.get('[data-test="pb-show-reload"]').setValue(false)
    const prefs = usePlaybackPreferences()
    expect(prefs.uiPrefs.showKillfeed).toBe(false)
    expect(prefs.labelPrefs.showReload).toBe(false)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('markerLabel')(1001).showReload).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBe(time)
  })

  it('hides all UI transiently and restores retained time, selection and preferences via H', async () => {
    const wrapper = mountPlayback(makeOverview(), 8)
    await flushPromises()
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    const map = wrapper.getComponent({ name: 'BattleMap' })
    const selected = map.props('selectedAccountId')
    const time = wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')
    const prefs = usePlaybackPreferences()
    const before = { ...prefs.uiPrefs }
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await wrapper.get('[data-test="pb-hide-all-ui"]').trigger('click')
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-hud"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-show-all-ui"]').exists()).toBe(true)
    expect(map.props('selectedAccountId')).toBe(selected)
    expect(map.props('hpPrefs').showHp).toBe(false)
    expect(prefs.uiPrefs).toEqual(before)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }))
    await nextTick()
    expect(wrapper.find('[data-test="pb-show-all-ui"]').exists()).toBe(false)
    expect(wrapper.getComponent({ name: 'PlaybackControls' }).props('currentTime')).toBe(time)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
    expect(wrapper.findComponent({ name: 'VehicleDetailsPanel' }).exists()).toBe(true)
  })
})

describe('2D 位姿与 3D 同源（poseFacet 通道）', () => {
  /** 常量位姿切面：game 系 (x, z) + 朝向；网格 11 点覆盖原始时钟 100..101s */
  function constantPoseFacet(accountId, { x, z, hullYawRad, turretAbsRad }) {
    const n = 11
    return {
      tStart: 100, samples: n,
      vehicles: [{
        eid: 1, account_id: accountId,
        pos: Array.from({ length: n }, () => [x, 0, z]).flat(),
        hull_yaw: new Array(n).fill(hullYawRad),
        hull_pitch: new Array(n).fill(0),
        turret_yaw: new Array(n).fill(turretAbsRad),
        gun_pitch: new Array(n).fill(0),
        coverage: [100, 101],
      }],
    }
  }

  it('位姿通道在场：标记位置/朝向取通道值（canonical 原始观测被覆盖）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    // canonical：1001 车 t=0..40 从 (0,0) 走到 (200,200)、朝向 90°
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 0 }],
    }]
    // 位姿通道：常量 (game x=50, z=-60)、朝北 0°（偏移 100 ⇒ 原始时刻 100+战斗秒）
    const wrapper = mountBattlePlayback({
      overview: makeOverview(),
      playbackV2: ds,
      poseFacet: constantPoseFacet(1001, { x: 50, z: -60, hullYawRad: 0, turretAbsRad: 0 }),
      clockOffset: 100,
    })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.exists()).toBe(true)
    // 位置来自通道：(50, -60) 在 ±300 框、766×769 逻辑框内
    const style = marker.attributes('style')
    expect(style).toMatch(/58\.33/)
    expect(style).toMatch(/60%/)
    // 朝向来自通道（0°），而不是 canonical 的 90°
    expect(marker.findAll('img')[0].attributes('style')).toContain('rotate(0deg)')
    expect(marker.findAll('img')[0].attributes('style')).not.toContain('rotate(90deg)')
  })

  it('无位姿通道：回退 canonical 原始观测（与既往行为一致）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 30 }],
    }]
    const wrapper = mountPlayback(makeOverview(), 20, ds)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.findAll('img')[0].attributes('style')).toContain('rotate(90deg)')
    expect(marker.findAll('img')[1].attributes('style')).toContain('rotate(120deg)')
  })

  it('失察即冻结：观测段结束后标记停在最后观测点，不跟随滤波器继续移动', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    // canonical：OBSERVED [0,30]（0→60 m），其后 LAST_KNOWN（冻结在 t=30）
    trackOf(ds, 1001).positionSegments = [
      { knowledge: 'OBSERVED', startSec: 0, endSec: 30, interpolationAllowed: true,
        samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 30, x: 60, y: 0 }] },
      { knowledge: 'LAST_KNOWN', startSec: 30, endSec: 60,
        samples: [{ timeSec: 30, x: 60, y: 0 }] },
    ]
    // 位姿通道：x 随原始时钟线性增长 2 m/s（raw = battle + 100）
    const n = 601
    const pos = []
    const yaw = []
    for (let i = 0; i < n; i++) { pos.push(i * 0.2, 0, 0); yaw.push(0) }
    const facet = {
      tStart: 100, samples: n,
      vehicles: [{
        eid: 1, account_id: 1001, pos, hull_yaw: yaw, hull_pitch: new Array(n).fill(0),
        turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0), coverage: [100, 160],
      }],
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: ds, poseFacet: facet, clockOffset: 100,
    })
    await flushPromises()
    // 期望的 left%：x = 2 m/s × 战斗秒（raw = 战斗秒 + 100）
    const pctOf = (x) => (((x + 300) / 600) * 766 / 766) * 100
    const readLeft = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const t = wrapper.vm.currentTime
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return { t, left: Number(/left: ([\d.]+)%/.exec(style)?.[1]) }
    }
    // t=20（观测内）：跟随位姿通道（x = 2·t）
    const observed = await readLeft(20)
    expect(observed.left).toBeCloseTo(pctOf(2 * observed.t), 3)
    // t>30（失察）：冻结在 t=30 的位姿（x=60），而不是滤波延续值（x = 2·t）
    const frozen = await readLeft(60)
    expect(frozen.t).toBeGreaterThan(30)
    expect(frozen.left).toBeCloseTo(pctOf(60), 3)
    expect(Math.abs(frozen.left - pctOf(2 * frozen.t))).toBeGreaterThan(5)
  })

  it('位姿通道缺该车 / 缺时钟偏移：该车回退 canonical，其余车不受影响', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 0 }],
    }]
    // 切面只含 2001；且 clockOffset 缺失（Number 缺省 null）
    const wrapper = mountBattlePlayback({
      overview: makeOverview(),
      playbackV2: ds,
      poseFacet: constantPoseFacet(2001, { x: 0, z: 0, hullYawRad: 0, turretAbsRad: 0 }),
    })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.findAll('img')[0].attributes('style')).toContain('rotate(90deg)')
  })

  it('多实体账号（AoI 重入 / 复活换实体）：按 canonical 身份证据选活跃实体，后一实体不得泄漏到重入之前', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    const n = 401
    const defOf = (eid, x) => ({
      eid, account_id: 1001,
      pos: Array.from({ length: n }, () => [x, 0, 0]).flat(),
      hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      coverage: [100, 140],
    })
    // 同一账号两个实体：eid 1 首见 0s（x=50）、eid 2 首见 30s（x=150）。数组里 eid 2 在后 ——
    // 若按"后写覆盖"取 def，重入之前的每一帧都会被 eid 2 的钳位首帧（x=150）顶掉（未来泄漏）。
    const facet = {
      tStart: 100, samples: n,
      vehicles: [defOf(1, 50), defOf(2, 150)],
      entityStartsByAccount: new Map([[1001, new Map([[1, 0], [2, 30]])]]),
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: ds, poseFacet: facet, clockOffset: 100,
    })
    await flushPromises()
    const pctOf = (x) => ((x + 300) / 600) * 100
    const leftAt = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return Number(/left: ([\d.]+)%/.exec(style)?.[1])
    }
    expect(await leftAt(5)).toBeCloseTo(pctOf(50), 1)    // 重入前：eid 1
    expect(await leftAt(35)).toBeCloseTo(pctOf(150), 1)  // 重入后：eid 2
  })

  it('实体身份证据早于位姿覆盖（HP 先见）→ 覆盖外的采样回落 canonical，不泄漏该实体未来首帧（review P2）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
    // canonical：观测 [0,40]、x 恒 0——回落路径的期望位置
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 0, y: 0, timeSec: 40 }], 0, 40)
    const n = 401
    const defOf = (eid, x, coverage) => ({
      eid, account_id: 1001,
      pos: Array.from({ length: n }, () => [x, 0, 0]).flat(),
      hull_yaw: new Array(n).fill(0), hull_pitch: new Array(n).fill(0),
      turret_yaw: new Array(n).fill(0), gun_pitch: new Array(n).fill(0),
      coverage,
    })
    const facet = {
      tStart: 100, samples: n,
      // eid 2 的位姿证据从战斗 30s（raw 130）才出现，但身份证据（HP/观测先见）在战斗 10s ——
      // 战斗 20s 的采样时刻落在 eid 2 的 coverage 之外，钳位会把它未来的首帧（x=150）泄漏到过去。
      vehicles: [defOf(1, 50, [100, 140]), defOf(2, 150, [130, 200])],
      entityStartsByAccount: new Map([[1001, new Map([[1, 0], [2, 10]])]]),
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: ds, poseFacet: facet, clockOffset: 100,
    })
    await flushPromises()
    const pctOf = (x) => ((x + 300) / 600) * 100
    const leftAt = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return Number(/left: ([\d.]+)%/.exec(style)?.[1])
    }
    expect(await leftAt(20)).toBeCloseTo(pctOf(0), 1)     // 覆盖外 → canonical 的 x=0（不是 eid 2 的 150）
    expect(await leftAt(35)).toBeCloseTo(pctOf(150), 1)   // 进入覆盖（raw 135）→ eid 2 的通道值
  })
})

describe('2D 工具栏折叠与名册浮层（§2d-toolbar-collapse / §roster-overlay）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('底部工具栏折叠后只留恢复入口，再展开恢复原内容；折叠会关闭 Display 面', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const toggle = () => wrapper.get('[data-test="pb-transport-toggle"]')
    const content = () => wrapper.get('[data-test="pb-transport-controls"]')
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(content().attributes('style') || '').not.toContain('display: none')
    // 打开 Display 面后折叠：折叠必须同时收起二级面（与 3D 同语义）
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.displayOpened()).toBe(true)
    await toggle().trigger('click')
    await flushPromises()
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(content().attributes('style')).toContain('display: none')
    expect(wrapper.vm.displayOpened()).toBe(false)
    // 折叠时 aria-controls 指向仍在 DOM 的传输内容（可达恢复入口）
    expect(content().attributes('id')).toBe(toggle().attributes('aria-controls'))
    // 恢复：内容回来了，播放时间不变
    const time = wrapper.vm.currentTime
    await toggle().trigger('click')
    await flushPromises()
    expect(toggle().attributes('aria-expanded')).toBe('true')
    expect(content().attributes('style') || '').not.toContain('display: none')
    expect(wrapper.vm.currentTime).toBe(time)
  })

  it('名册浮层收纳/展开不改变选中与时间；手机横屏默认收纳', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.classes()).toContain('pb-roster-lanes')
    await wrapper.get('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    const time = wrapper.vm.currentTime
    const selected = wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')
    const entry = () => wrapper.get('[data-test="pb-roster-entry"]')
    expect(entry().attributes('aria-pressed')).toBe('true')
    await entry().trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-team-lane-right"]').exists()).toBe(false)
    expect(wrapper.classes()).not.toContain('pb-roster-lanes')
    expect(entry().attributes('aria-pressed')).toBe('false')
    expect(wrapper.vm.currentTime).toBe(time)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
    await entry().trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.getComponent({ name: 'BattleMap' }).props('selectedAccountId')).toBe(selected)
  })

  it('手机横屏（phoneLandscape）默认收纳名册浮层，入口仍是传输条上的 roster 按钮', async () => {
    stubRaf()
    vi.stubGlobal('innerWidth', 844)
    const mql = (query) => ({
      matches: query === PLAYBACK_MOBILE_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('matchMedia', mql)
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.classes()).toContain('pb-phone-landscape')
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="pb-roster-entry"]').attributes('aria-pressed')).toBe('false')
    await wrapper.get('[data-test="pb-roster-entry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="pb-team-lane-left"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-roster-entry"]').attributes('aria-pressed')).toBe('true')
  })
})

describe('2D 自动全屏（Android 手机 App）：退出不打断回放', () => {
  const file = new File(['x'], 'a.wotbreplay')
  function installFullscreen() {
    const state = { request: 0, exit: 0 }
    Element.prototype.requestFullscreen = vi.fn(async function () {
      state.request++
      Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true, writable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    document.exitFullscreen = vi.fn(async () => {
      state.exit++
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
    return state
  }
  afterEach(() => {
    delete Element.prototype.requestFullscreen
    delete document.exitFullscreen
    delete document.fullscreenElement
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('挂载即成功就绪：自动进入一次；退出后时间 / 播放态 / 选中 / 组件实例保持且不重入', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('matchMedia', (query) => ({ matches: query === PLAYBACK_MOBILE_QUERY, media: query, addEventListener() {}, removeEventListener() {} }))
    const fs = installFullscreen()
    const wrapper = mountBattlePlayback({ overview: makeOverview(), seekTo: 12, playbackV2: makePlaybackV2(), autoFullscreen: { token: 1, key: file }, active: true })
    await flushPromises()
    await vi.waitFor(() => expect(fs.request).toBe(1))
    await flushPromises()
    const root = wrapper.find('[data-test="battle-playback"]').element
    expect(document.fullscreenElement).toBe(root)

    await wrapper.find('.pb-range').setValue(12)
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 })
    await flushPromises()
    const before = {
      time: wrapper.find('.pb-time').text(),
      playLabel: wrapper.get('[data-test="pb-play"]').attributes('aria-label'),
      info: wrapper.find('[data-test="pb-info"]').text(),
    }
    // 退出按钮与 Back/系统手势最终都是 fullscreenchange(null)
    await document.exitFullscreen()
    await flushPromises()
    expect(wrapper.find('[data-test="battle-playback"]').element).toBe(root)
    expect(wrapper.find('.pb-time').text()).toBe(before.time)
    expect(wrapper.get('[data-test="pb-play"]').attributes('aria-label')).toBe(before.playLabel)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(before.info)
    expect(fs.request).toBe(1)
    await wrapper.setProps({ seekTo: 12 })
    await flushPromises()
    expect(fs.request).toBe(1)
    // 新的进入事件才会再次自动进入
    await wrapper.setProps({ autoFullscreen: { token: 2, key: file } })
    await vi.waitFor(() => expect(fs.request).toBe(2))
    wrapper.unmount()
  })

  describe('请求挂起期间失活：迟到的完成必须立刻交还全屏，且不留方向锁', () => {
    function deferredFullscreen() {
      let release
      const gate = new Promise((resolve) => { release = resolve })
      const exit = vi.fn(async () => {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      Element.prototype.requestFullscreen = vi.fn(async function () {
        await gate
        Object.defineProperty(document, 'fullscreenElement', { value: this, configurable: true, writable: true })
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      document.exitFullscreen = exit
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true })
      const lock = vi.fn(async () => {})
      vi.stubGlobal('screen', { orientation: { lock, unlock: vi.fn() } })
      return { release, exit, lock }
    }
    const phoneMedia = () => vi.stubGlobal('matchMedia', (query) => ({ matches: query === PLAYBACK_MOBILE_QUERY, media: query, addEventListener() {}, removeEventListener() {} }))

    it('切走能力（props.active=false）后请求才完成：旧 2D 根立刻退出全屏，不锁方向', async () => {
      vi.stubGlobal('requestAnimationFrame', () => 0)
      vi.stubGlobal('cancelAnimationFrame', () => {})
      phoneMedia()
      const fs = deferredFullscreen()
      const wrapper = mountBattlePlayback({ overview: makeOverview(), seekTo: 12, playbackV2: makePlaybackV2(), autoFullscreen: { token: 1, key: file }, active: true })
      await flushPromises()
      await vi.waitFor(() => expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1))
      await wrapper.setProps({ active: false })
      fs.release()
      await flushPromises()
      expect(document.fullscreenElement).toBeNull()
      expect(fs.exit).toHaveBeenCalledTimes(1)
      expect(fs.lock).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    it('KeepAlive 停用后请求才完成：同样交还全屏；重新激活不会自动重入', async () => {
      vi.stubGlobal('requestAnimationFrame', () => 0)
      vi.stubGlobal('cancelAnimationFrame', () => {})
      phoneMedia()
      const fs = deferredFullscreen()
      const show = ref(true)
      const Host = defineComponent({
        setup: () => () => h(KeepAlive, null, show.value
          ? [h(BattlePlayback, { overview: makeOverview(), seekTo: 12, playbackV2: makePlaybackV2(), autoFullscreen: { token: 1, key: file }, active: true })]
          : []),
      })
      const wrapper = mount(Host, { attachTo: document.body, global: { mocks: { $t: i18n.t } } })
      await flushPromises()
      await vi.waitFor(() => expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1))
      show.value = false
      await flushPromises()
      fs.release()
      await flushPromises()
      expect(document.fullscreenElement).toBeNull()
      expect(fs.lock).not.toHaveBeenCalled()
      show.value = true
      await flushPromises()
      expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })
  })
})

// 合并删除的 BattlePlayback.integration.test.js 中 2D 时间轴/seekAndPlay 覆盖：
// 这些断言在拆分后的三个 part 中都没有等价副本，恢复为独立回归。
describe('2D 时间轴与 seekAndPlay（恢复自合并删除的集成测试）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
      facetShots: facet.shots, facetKills: facet.kills, clockOffset: 0, showEventMarkers: true,
    })
    await flushPromises()
    expect(wrapper.findAll('.pb-tick-shot')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tick-kill')).toHaveLength(1)
  })

  it('2D 刻度点击值是战斗相对秒：canonical 偏移下 t 减 clockOffset，pct 不变', async () => {
    stubRaf()
    const facet = {
      shots: [{ t_fire: 60, shooter_eid: 1, is_author: false }],
      kills: [{ t: 90 }],
    }
    const wrapper = mountBattlePlayback({
      overview: makeOverview(), playbackV2: makePlaybackV2(),
      facetShots: facet.shots, facetKills: facet.kills, clockOffset: 30, showEventMarkers: true,
    })
    await flushPromises()
    // makePlaybackV2 durationSec=60 → 原始轴 [30, 90]：t_fire=60 / kill 90 → 50% / 100%；
    // 点击吸附返回值必须是战斗相对秒（60-30=30、90-30=60），否则 seek 会跳错时刻。
    const controls = wrapper.findComponent({ name: 'PlaybackControls' })
    expect(controls.props('shotTicks')).toEqual([{ t: 30, pct: 50, highlight: false }])
    expect(controls.props('killTicks')).toEqual([{ t: 60, pct: 100 }])
  })
})
