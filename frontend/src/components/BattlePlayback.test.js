// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BattlePlayback from './BattlePlayback.vue'
import { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'

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

const dataset = makeBattlePlaybackDataset()
dataset.vehicles = dataset.vehicles.slice(0, 2)
dataset.vehicles[0].positionSegments = [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 10,
  samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 10, x: 50, y: 0 }] }]
dataset.vehicles[1].positionSegments = [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 10,
  samples: [{ timeSec: 0, x: -20, y: 0 }, { timeSec: 10, x: -40, y: 0 }] }]

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
    expect(wrapper.find('[data-test="pb-marker-1001"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-2001"]').exists()).toBe(true)
    expect(wrapper.findAll('.pb-range')).toHaveLength(1)
  })

  it('seek projects canonical vehicle state and selection survives the seek', async () => {
    const wrapper = mount(BattlePlayback, {
      props: { playbackV2: dataset },
      global: { mocks: { $t: key => key } },
    })
    await flushPromises()

    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    await wrapper.find('input[type="range"]').setValue('7')
    await flushPromises()

    expect(wrapper.find('[data-test="pb-marker-2001"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-sb-tank"]').text()).toBe('T49')
  })

  it('does not leak a future-only position into the orchestrator view', async () => {
    const futureOnly = {
      ...dataset.vehicles[1],
      accountId: 9,
      positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 8, endSec: 10, samples: [
        { timeSec: 8, x: 20, y: 0 },
      ] }],
    }
    const wrapper = mount(BattlePlayback, {
      props: { playbackV2: {
        ...dataset, durationSec: 10, events: dataset.events.filter((event) => event.timeSec <= 10), vehicles: [futureOnly],
      } },
      global: { mocks: { $t: key => key } },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="pb-marker-9"]').exists()).toBe(false)
  })
})
