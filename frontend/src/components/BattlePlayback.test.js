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
  it('名册保留未被发现敌车的开局血量事实', async () => {
    const opening = structuredClone(dataset)
    const enemy = opening.vehicles[1]
    enemy.positionSegments = []
    enemy.healthTransitions = [{ timeSec: 0, currentHp: 1995, displayCapacityHp: 1995, knowledge: 'CURRENT', source: 'EXACT_BATTLE_EVENT' }]
    const wrapper = mount(BattlePlayback, {
      props: { playbackV2: opening }, global: { mocks: { $t: key => key } },
    })
    await flushPromises()
    expect(wrapper.find('[data-test="pb-marker-2001"]').exists()).toBe(false)
    expect(wrapper.findAllComponents({ name: 'PlaybackRoster' }).some(roster =>
      roster.props('health')[enemy.accountId]?.currentHp === 1995)).toBe(true)
    expect(wrapper.text()).toContain('1995 / 1995')
    enemy.lifeTransitions = [{ timeSec: 0, lifeState: 'DESTROYED' }]
    await wrapper.setProps({ playbackV2: structuredClone(opening) })
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'PlaybackRoster' }).some(roster =>
      roster.props('destroyed').has(enemy.accountId))).toBe(true)
    wrapper.unmount()
  })

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
