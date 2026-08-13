// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'

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

function makeOverview() {
  return {
    mapCode: 'holland',
    displayName: 'Molendijk',
    displayNames: { zh: '莫伦代克', en: 'Molendijk', ru: 'Молендейк' },
    playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
    friendlyTeam: 1,
    arenaBonusType: 1,
    recorderAccountId: 1001,
    gridCells: [],
    spawnPoints: [],
    routes: [
      {
        accountId: 1001, playerName: 'You', tankId: 1, team: 1,
        points: [{ x: 0, y: 0, timeSec: 10 }, { x: 50, y: 50, timeSec: 14 }],
        firstObservedSec: 10, lastObservedSec: 20, deathSec: null
      },
      {
        accountId: 2001, playerName: 'EnemyA', tankId: 2, team: 2,
        points: [{ x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 }],
        firstObservedSec: 10, lastObservedSec: 30, deathSec: null
      }
    ],
    playback: {
      durationSec: 60,
      vehicles: [
        { accountId: 1001, playerName: 'You', tankId: 1, team: 1, observedIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null },
        { accountId: 2001, playerName: 'EnemyA', tankId: 2, team: 2, observedIntervals: [{ startSec: 10, endSec: 20 }], deathSec: null },
        { accountId: 2002, playerName: 'NeverSeen', tankId: 3, team: 2, observedIntervals: [], deathSec: null }
      ],
      events: [
        { type: 'OBSERVED', timeSec: 10, accountId: 2001, targetAccountId: null, damage: null },
        { type: 'DAMAGE', timeSec: 12, accountId: 1001, targetAccountId: 2001, damage: 400 },
        { type: 'LOST', timeSec: 20, accountId: 2001, targetAccountId: null, damage: null }
      ]
    }
  }
}

function mountPlayback(overview = makeOverview(), seekTo = null) {
  return mount(BattlePlayback, {
    props: { overview, seekTo },
    global: { mocks: { $t: i18n.t } }
  })
}

describe('BattlePlayback', () => {
  let rafCb

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function stubRaf() {
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCb = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  }

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

  it('seeks on seekTo and pauses', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 30)
    await flushPromises()
    expect(wrapper.text()).toContain('00:30 / 01:00')
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
})
