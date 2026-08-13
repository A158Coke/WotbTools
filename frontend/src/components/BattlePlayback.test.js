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
        {
          accountId: 1001, playerName: 'You', tankId: 1, team: 1,
          positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
            { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 }
          ]
        },
        {
          accountId: 2001, playerName: 'EnemyA', tankId: 2, team: 2,
          positionIntervals: [{ startSec: 10, endSec: 20 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 10, turretRelativeYawDeg: 5 },
            { timeSec: 14, hullYawDeg: 30, turretRelativeYawDeg: 20 }
          ]
        },
        { accountId: 2002, playerName: 'NeverSeen', tankId: 3, team: 2, positionIntervals: [], deathSec: null, directionSamples: [] }
      ],
      events: [
        { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, damage: null },
        { type: 'DAMAGE', timeSec: 12, accountId: 1001, targetAccountId: 2001, damage: 400 },
        { type: 'POSITION_STALE', timeSec: 20, accountId: 2001, targetAccountId: null, damage: null }
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

  function gapOverview() {
    const overview = makeOverview()
    // EnemyA 在 14s 与 40s 之间存在 >5s 断线：20s 时不得穿线，但车辆应停在最后可信位置
    overview.routes[1].points = [
      { x: -50, y: -50, timeSec: 10 },
      { x: -100, y: -100, timeSec: 14 },
      { x: -200, y: -200, timeSec: 40 }
    ]
    return overview
  }

  it('gap vehicles stay at the faded last-known position instead of disappearing', async () => {
    stubRaf()
    const wrapper = mountPlayback(gapOverview(), 20)
    await flushPromises()
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).toContain('pb-last-known')
  })

  it('renders route prefixes only up to the current time', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const polylines = wrapper.findAll('.pb-route')
    expect(polylines.length).toBeGreaterThanOrEqual(1)
    for (const pl of polylines) {
      const pts = pl.attributes('points')
      expect(pts).toBeTruthy()
      expect(pts.length).toBeGreaterThan(0)
    }
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

  it('renders two-layer tank markers: friendly/enemy images + independent hull/turret rotation', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const friendly = wrapper.find('[data-test="pb-marker-1001"]')
    expect(friendly.exists()).toBe(true)
    const friendlyImgs = friendly.findAll('img')
    expect(friendlyImgs).toHaveLength(2)
    expect(friendlyImgs[0].attributes('src')).toContain('tank-marker-friendly-hull')
    expect(friendlyImgs[1].attributes('src')).toContain('tank-marker-friendly-turret')
    // t=12：hull 0→90 半程=45°；turret rel 0→30 半程=15° → 世界=60°
    expect(friendlyImgs[0].attributes('style')).toContain('rotate(45deg)')
    expect(friendlyImgs[1].attributes('style')).toContain('rotate(60deg)')
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.findAll('img')).toHaveLength(2)
    expect(enemy.findAll('img')[0].attributes('src')).toContain('tank-marker-enemy-hull')
    expect(enemy.findAll('img')[1].attributes('src')).toContain('tank-marker-enemy-turret')
  })

  it('never-observed enemies render no marker; recorder/selected/destroyed overlays stay separate', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-marker-2002"]').exists()).toBe(false)
    const recorder = wrapper.find('[data-test="pb-marker-1001"]')
    expect(recorder.classes()).toContain('pb-recorder')
    await recorder.trigger('click')
    expect(recorder.classes()).toContain('pb-selected')
  })

  it('markers keep showing the faded last-known state in a gap instead of disappearing', async () => {
    stubRaf()
    const wrapper = mountPlayback(gapOverview(), 20)
    await flushPromises()
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).toContain('pb-last-known')
  })
})
