// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BattlePlayback from './BattlePlayback.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, te: () => false, locale: { value: 'en' } }) }))
vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({ resolved: new Map(), failed: new Set(), byTank: new Map() })),
}))
vi.mock('../vehicle-portraits/runtime.js', () => ({ loadVehiclePortrait: vi.fn(async () => null) }))

vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: '/holland.png', width: 100, height: 100,
      coordinateBounds: { xMin: -100, xMax: 100, yMin: -100, yMax: 100 },
    },
  },
}))

const track = (accountId, team, friendly, x0, x1) => ({
  accountId,
  playerName: accountId === 1 ? 'Player' : 'Enemy',
  tankId: accountId,
  tankName: accountId === 1 ? 'Maus' : 'T49',
  tankClass: '', team, friendly,
  positionSegments: [{ knowledge: 'OBSERVED', startSec: 0, endSec: 10, samples: [
    { timeSec: 0, x: x0, y: 0, knowledge: 'OBSERVED' },
    { timeSec: 10, x: x1, y: 0, knowledge: 'OBSERVED' },
  ] }],
  orientationSegments: [{ knowledge: 'CURRENT', startSec: 0, endSec: 10, samples: [
    { timeSec: 0, hullYawDeg: 0, turretRelativeYawDeg: 0 },
  ] }],
  healthTransitions: [{ timeSec: 0, currentHp: 1000, knowledge: 'CURRENT', displayCapacityHp: 1000, source: 'EXACT_BATTLE_EVENT' }],
  lifeTransitions: [], damageLosses: [], consumableTransitions: [], moduleCrewTransitions: [],
})

const dataset = {
  mapCode: 'holland', friendlyTeam: 1, recorderAccountId: 1, durationSec: 10,
  vehicles: [track(1, 1, true, 0, 50), track(2, 2, false, -20, -40)],
  events: [{ type: 'POSITION_REPORTED', timeSec: 2, accountId: 2, targetAccountId: null, observedHpLoss: null }],
  pointsSamples: [], limitations: [],
}

describe('BattlePlayback orchestrator integration', () => {
  it('wires canonical V2 data through one clock owner and all presentation boundaries', async () => {
    const wrapper = mount(BattlePlayback, {
      props: { playbackV2: dataset },
      global: { mocks: { $t: key => key } },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'PlaybackControls' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'BattleMap' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'PlaybackTimeline' }).exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-2"]').exists()).toBe(true)
    expect(wrapper.findAll('.pb-range')).toHaveLength(1)
  })

  it('seek projects canonical vehicle state and selection survives the seek', async () => {
    const wrapper = mount(BattlePlayback, {
      props: { playbackV2: dataset },
      global: { mocks: { $t: key => key } },
    })
    await flushPromises()

    await wrapper.find('[data-test="pb-marker-2"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    await wrapper.find('input[type="range"]').setValue('7')
    await flushPromises()

    expect(wrapper.find('[data-test="pb-marker-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-sb-tank"]').text()).toBe('T49')
  })

  it('does not leak a future-only position into the orchestrator view', async () => {
    const futureOnly = {
      ...track(9, 2, 20, 30),
      positionSegments: [{ knowledge: 'OBSERVED', startSec: 8, endSec: 10, samples: [
        { timeSec: 8, x: 20, y: 0, knowledge: 'OBSERVED' },
      ] }],
    }
    const wrapper = mount(BattlePlayback, {
      props: { playbackV2: { ...dataset, durationSec: 10, vehicles: [futureOnly] } },
      global: { mocks: { $t: key => key } },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="pb-marker-9"]').exists()).toBe(false)
  })
})
