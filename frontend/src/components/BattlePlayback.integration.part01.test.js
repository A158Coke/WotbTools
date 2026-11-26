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
describe('Supremacy 基地 overlay', () => {
  it('renders one circle per Supremacy base and colours it from baseStates', async () => {
    const dataset = makePlaybackV2({
      baseStates: [
        { timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null },
        { timeSec: 0, baseId: 'B', ownerTeam: 2, capturingTeam: null, captureProgress: null },
        { timeSec: 0, baseId: 'C', ownerTeam: null, capturingTeam: 2, captureProgress: 40 },
      ],
    })
    const wrapper = await mountPlayback(makeOverview(), null, dataset)

    expect(wrapper.findAll('[data-test="pb-bases"] .pb-base-circle')).toHaveLength(3)
    expect(wrapper.find('[data-test="pb-bases"]').text()).toContain('A')
    expect(wrapper.findAll('.pb-base-friendly_controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-base-enemy_controlled')).toHaveLength(1)
    expect(wrapper.findAll('.pb-base-neutral')).toHaveLength(1)
    const fills = wrapper.findAll('[data-test="pb-base-fill"]')
    expect(fills).toHaveLength(1)
    expect(fills[0].classes()).toContain('pb-capture-enemy')
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

    await wrapper.setProps({ seekTo: 20 })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-base-BASE"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="base-badge-BASE"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="base-badge-ring"]').exists()).toBe(false)
    expect(wrapper.find('.base-objective-progress').exists()).toBe(false)

    await wrapper.setProps({ seekTo: 30 })
    await flushPromises()
    rect = wrapper.find('clipPath rect')
    expect(wrapper.find('[data-test="pb-base-fill"]').exists()).toBe(true)
    expect(Number(rect.attributes('height'))).toBeCloseTo(Number(rect.attributes('width')) * 0.12, 3)
    expect(wrapper.find('.base-objective-progress').text()).toBe('12%')

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

  it('shows the base status bar alongside the map bases', async () => {
    const dataset = makePlaybackV2({
      baseStates: [{ timeSec: 0, baseId: 'A', ownerTeam: 1, capturingTeam: null, captureProgress: null }],
    })
    const wrapper = await mountPlayback(makeOverview(), null, dataset)
    expect(wrapper.findAll('.pb-base-circle').length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="base-status-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="base-badge-A"]').classes()).toContain('is-owner-friendly')
  })

  it('uses the latest transition by time, not by array order', async () => {
    const dataset = makePlaybackV2({
      baseStates: [
        { timeSec: 5, baseId: 'A', ownerTeam: null, capturingTeam: null, captureProgress: 60 },
        { timeSec: 1, baseId: 'A', ownerTeam: null, capturingTeam: 1, captureProgress: 60 },
      ],
    })
    const wrapper = await mountPlayback(makeOverview(), 8, dataset)
    expect(wrapper.findAll('[data-test="pb-base-fill"]')).toHaveLength(0)
  })

  it('clears the capture fill when the capture is abandoned but progress is retained', async () => {
    const dataset = makePlaybackV2({
      baseStates: [
        { timeSec: 0, baseId: 'A', ownerTeam: null, capturingTeam: 2, captureProgress: 80 },
        { timeSec: 5, baseId: 'A', ownerTeam: null, capturingTeam: null, captureProgress: 80 },
      ],
    })
    const wrapper = await mountPlayback(makeOverview(), 6, dataset)
    expect(wrapper.findAll('[data-test="pb-base-fill"]')).toHaveLength(0)
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
    expect(wrapper.find('[data-test="pb-map"]').text()).not.toContain('NeverSeen')
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
  })

  it('Blocker 2：V2 dataset 为核心输入——overview 为 null 时 PRIMARY 仍渲染', async () => {
    stubRaf()
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
    const destroyedMarkers = wrapper.findAll('.pb-vehicle.pb-destroyed')
    expect(destroyedMarkers.length).toBeGreaterThan(0)
  })

  it('play advances time via RAF', async () => {
    stubRaf()
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.pause')
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
    expect(wrapper.find('[data-test="pb-play"]').attributes('aria-label')).toBe('recon.map.playback.play')
  })

  function gapOverview() {
    const overview = makeOverview()
    const ds = makePlaybackV2()
    ds.vehicles[1].lifeTransitions = []
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
    rafCb(1000)
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
      rafCb = cb
      return rafCalls
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const wrapper = mountPlayback()
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(rafCalls).toBe(1)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    expect(rafCalls).toBe(2)
  })

  it('covered vehicles are not faded even when sampled route points have a >5s gap (position stream coverage)', async () => {
    stubRaf()
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
    expect(friendly.findAll('img')[0].attributes('style')).toContain('rotate(90deg)')
    expect(friendly.findAll('img')[1].attributes('style')).toContain('rotate(120deg)')
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
    expect(marker.find('.pb-hull-dedicated').attributes('style')).toContain('rotate(45deg)')
    const assembly = marker.find('.pb-turret-assembly')
    expect(assembly.exists()).toBe(true)
    expect(assembly.attributes('style')).toContain('rotate(45deg)')
    const turret = marker.find('.pb-turret-dedicated')
    expect(turret.attributes('src')).toBe('/vm/maus/turret.webp')
    expect(turret.attributes('style')).toContain('rotate(15deg)')
    expect(marker.find('.pb-hull.pb-hull-dedicated').exists()).toBe(true)
    expect(marker.find('.pb-hull:not(.pb-hull-dedicated)').exists()).toBe(false)
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
    expect(marker.find('.pb-hull').exists()).toBe(true)
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
    expect(wrapper.findAll('.pb-label-tank').length).toBe(2)
    expect(wrapper.findAll('.pb-label-player').length).toBe(0)
    await player.setValue(true)
    expect(wrapper.findAll('.pb-label-player').length).toBe(2)
    expect(wrapper.findAll('.pb-label-player')[0].text()).toBe('You')
    const saved = JSON.parse(localStorage.getItem('wotb.pb.label-prefs'))
    expect(saved).toEqual({ showPlayerName: true, showTankName: true, showReload: true })
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
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    trackOf(ds, 2001).playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    const wrapper = mountPlayback(overview, 12, ds)
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await flushPromises()
    await openPanel(wrapper, 'display')
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await wrapper.find('.pb-range').setValue(12.5)
    await flushPromises()
    const a = wrapper.find('[data-test="pb-marker-1001"]')
    const b = wrapper.find('[data-test="pb-marker-2001"]')
    const labelsStyle = (m) => (m.find('.pb-presentation').attributes('style') || '')
    expect(Number.isFinite(parseFloat(labelsStyle(a).match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || 'NaN'))).toBe(true)
    expect(Number.isFinite(parseFloat(labelsStyle(b).match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || 'NaN'))).toBe(true)
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
    setPositionSamples(ds, 1001, [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }], 0, 60)
    setPositionSamples(ds, 2001, [{ x: -232.5, y: -204.2, timeSec: 10 }, { x: -232.5, y: -204.2, timeSec: 14 }], 0, 60)
    const wrapper = mountPlayback(overview, 12, ds)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    const aBtn = wrapper.find('[data-test="pb-marker-1001"]')
    await aBtn.trigger('click', { clientX: 90, clientY: 675 })
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA')
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
    await wrapper.setProps({ loop: true })
    const wrap = mountPlayback(makeOverview(), 59)
    await flushPromises()
    await wrap.setProps({ loop: true })
    await wrap.find('[data-test="pb-play"]').trigger('click')
    expect(rafCb).toBeTruthy()
    rafCb(0)
    rafCb(1000)
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

  it('标记严格落在真实位置（无防重叠位移），标签的防重叠车道仍然生效', async () => {
    stubRaf()
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()

    const styleOf = (accountId) => markerOf(wrapper, accountId).attributes('style') || ''
    expect(styleOf(2001)).toMatch(/left: \d+(\.\d+)?%/)
    expect(styleOf(2001)).not.toMatch(/left: calc\(/)
    expect(styleOf(2001)).not.toMatch(/top: calc\(/)

    for (let i = 0; i < 14; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { ctrlKey: true, deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    expect(styleOf(2001)).not.toMatch(/left: calc\(/)
    const labelStyle = markerOf(wrapper, 2001).find('.pb-presentation').attributes('style') || ''
    expect(labelStyle).toContain('bottom:')
  })
})
