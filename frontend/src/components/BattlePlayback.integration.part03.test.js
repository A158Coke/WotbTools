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
describe('Blocker 修复回归（review B1-1 / B1-2 / B1-3 / B2）', () => {
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
    ds.vehicles[0].damageLosses = [
      { fromSec: 12, toSec: 14, hpLoss: 200, attackerAccountId: 2001, attackerReliable: true, damageEventCount: 1 },
    ]
    ds.vehicles[0].healthTransitions.push({ timeSec: 14, currentHp: 1300, knowledge: 'CURRENT', displayCapacityHp: 1500, relativeFull: false, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' })
    const wrapper = mountPlayback(overview, 18, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.exists()).toBe(true)
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('400')
    expect(sidebarValue(info, 'recon.map.playback.damage_received')).toBe('200')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
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
    await openPanel(wrapper, 'events')
    expect(wrapper.find('[data-test="pb-event-panel"]').text()).toContain('00:15')
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
    rafCb(6000)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
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
    ds.vehicles[1].damageLosses = [20, 60, 120].map((t) => ({
      fromSec: t - 1, toSec: t, hpLoss: 300, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1,
    }))
    const wrapper = mountPlayback(overview, 30, ds)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(logTimes(info)).toEqual(['00:20'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
    await wrapper.find('.pb-range').setValue(90)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(logTimes(info)).toEqual(['00:20', '01:00'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('600')
    await wrapper.find('.pb-range').setValue(130)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(logTimes(info)).toEqual(['00:20', '01:00', '02:00'])
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('900')
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
    expect(enemyHudNum(wrapper)).toBe('3000')
    for (const t of [25, 30, 35]) {
      await wrapper.find('.pb-range').setValue(t)
      await flushPromises()
      expect(enemyHudNum(wrapper)).toBe('3000')
    }
    await wrapper.find('.pb-range').setValue(40)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('3000')
    await wrapper.find('.pb-range').setValue(42)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('1700')
    await wrapper.find('.pb-range').setValue(25)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('3000')
    await wrapper.find('.pb-range').setValue(30)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-num"]').text()).toBe('2200')
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
    rafCb(1300)
    await flushPromises()
    expect(wrapper.findAll('[data-test="pb-float-dmg"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(true)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    clock.now = 2500
    rafCb(2500)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-burst"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
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
    rafCb(1300)
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe('00:00 / 00:20')
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    clock.now = 2600
    rafCb(2600)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(1)
  })

  it('B5A-fix kill feed 隐藏时不无限续约暂停时钟；恢复显示重启时钟并展示队列', async () => {
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
    rafCb(6000)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    const counts = []
    for (let i = 0; i < 12; i++) {
      clock.now += 500
      if (rafCb) rafCb(clock.now)
      await flushPromises()
      counts.push(rafScheduled)
    }
    expect(counts[counts.length - 1]).toBe(counts[counts.length - 4])
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
    clock.now += 10_000
    prefs.uiPrefs.showKillfeed = true
    await flushPromises()
    expect(rafScheduled).toBeGreaterThan(counts[counts.length - 1])
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-kill-feed"]').text()).toContain('EnemyA（T49）')
    for (let i = 0; i < 4; i++) {
      clock.now += 500
      if (rafCb) rafCb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
    for (let i = 0; i < 6; i++) {
      clock.now += 500
      if (rafCb) rafCb(clock.now)
      await flushPromises()
    }
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
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
    expect(w.find('[data-test="pb-hp-value-friendly"]').text()).toBe('1500 / 1500')
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
    expect(enemyHudNum(w)).toBe('1200')
    await w.find('.pb-range').setValue(25)
    await flushPromises()
    expect(enemyHudNum(w)).toBe('1200')
    expect(enemyHudNum(w)).not.toBe('600')
    await w.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    expect(detailsHpNum(w.find('[data-test="pb-info"]'))).toBe('1200')
    expect(w.find('[data-test="pb-info"]').text()).toContain('recon.map.playback.last_known_hp')
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
    expect(enemyHudNum(w)).toBe('600')
    expect(w.find('[data-test="pb-marker-2001"] .pb-hp-fill').attributes('style')).toContain('50%')
    await w.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    expect(detailsHpNum(w.find('[data-test="pb-info"]'))).toBe('600')
  })

  it('destroyed：隐藏单车 HP + Details 显示 0 与 destroyed_at', async () => {
    const ds = makePlaybackV2()
    ds.vehicles[1].lifeTransitions = [{ timeSec: 25, lifeState: 'DESTROYED', destroyedKnownAtSec: 25 }]
    const w = mountV2(30, ds)
    await flushPromises()
    expect(w.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(w.find('[data-test="pb-marker-2001"] .pb-hp-fill').exists()).toBe(false)
    expect(w.find('[data-test="pb-marker-2001"]').find('.pb-death').exists()).toBe(true)
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
    const roster = wrapper.get('[data-test="pb-main"]')
    expect(roster.exists()).toBe(true)
    const friendly = roster.findAll('.pb-roster-team1 [data-test="pb-roster-row"]')
    const enemy = roster.findAll('.pb-roster-team2 [data-test="pb-roster-row"]')
    expect(friendly).toHaveLength(1)
    expect(enemy).toHaveLength(2)
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
    setPositionSamples(ds, 1001, [{ x: 0, y: 0, timeSec: 0 }, { x: 200, y: 200, timeSec: 40 }], 0, 40)
    trackOf(ds, 1001).orientationSegments = [{
      knowledge: 'CURRENT', startSec: 0, endSec: 40,
      samples: [{ timeSec: 0, hullYawDeg: 90, turretRelativeYawDeg: 0 }],
    }]
    const wrapper = mountBattlePlayback({
      overview: makeOverview(),
      playbackV2: ds,
      poseFacet: constantPoseFacet(1001, { x: 50, z: -60, hullYawRad: 0, turretAbsRad: 0 }),
      clockOffset: 100,
    })
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.exists()).toBe(true)
    const style = marker.attributes('style')
    expect(style).toMatch(/58\.33/)
    expect(style).toMatch(/60%/)
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
    trackOf(ds, 1001).positionSegments = [
      { knowledge: 'OBSERVED', startSec: 0, endSec: 30, interpolationAllowed: true,
        samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 30, x: 60, y: 0 }] },
      { knowledge: 'LAST_KNOWN', startSec: 30, endSec: 60,
        samples: [{ timeSec: 30, x: 60, y: 0 }] },
    ]
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
    const pctOf = (x) => (((x + 300) / 600) * 766 / 766) * 100
    const readLeft = async (seekTo) => {
      await wrapper.setProps({ seekTo })
      await flushPromises()
      const t = wrapper.vm.currentTime
      const style = wrapper.find('[data-test="pb-marker-1001"]').attributes('style') || ''
      return { t, left: Number(/left: ([\d.]+)%/.exec(style)?.[1]) }
    }
    const observed = await readLeft(20)
    expect(observed.left).toBeCloseTo(pctOf(2 * observed.t), 3)
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
    expect(await leftAt(5)).toBeCloseTo(pctOf(50), 1)
    expect(await leftAt(35)).toBeCloseTo(pctOf(150), 1)
  })

  it('实体身份证据早于位姿覆盖（HP 先见）→ 覆盖外的采样回落 canonical，不泄漏该实体未来首帧（review P2）', async () => {
    stubRaf()
    const ds = makePlaybackV2()
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
    expect(await leftAt(20)).toBeCloseTo(pctOf(0), 1)
    expect(await leftAt(35)).toBeCloseTo(pctOf(150), 1)
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
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.displayOpened()).toBe(true)
    await toggle().trigger('click')
    await flushPromises()
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(content().attributes('style')).toContain('display: none')
    expect(wrapper.vm.displayOpened()).toBe(false)
    expect(content().attributes('id')).toBe(toggle().attributes('aria-controls'))
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
    const controls = wrapper.findComponent({ name: 'PlaybackControls' })
    expect(controls.props('shotTicks')).toEqual([{ t: 30, pct: 50, highlight: false }])
    expect(controls.props('killTicks')).toEqual([{ t: 60, pct: 100 }])
  })
})
