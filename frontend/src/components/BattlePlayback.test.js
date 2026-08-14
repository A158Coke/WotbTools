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
          accountId: 1001, playerName: 'You', tankId: 1, tankName: 'Maus', team: 1,
          positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
            { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 }
          ]
        },
        {
          accountId: 2001, playerName: 'EnemyA', tankId: 2, tankName: 'T49', team: 2,
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

let rafCb

function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafCb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

describe('BattlePlayback', () => {
  afterEach(() => {
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

describe('tracer shots', () => {
  it('draws a tracer at the damage moment only within its window (seek-safe)', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.findAll('.pb-tracer').length).toBeGreaterThanOrEqual(1)
    expect(wrapper.findAll('.pb-tracer')[0].attributes('x1')).toBeTruthy()
    const before = mountPlayback(makeOverview(), 11)
    await flushPromises()
    expect(before.findAll('.pb-tracer')).toHaveLength(0)
    const after = mountPlayback(makeOverview(), 13)
    await flushPromises()
    expect(after.findAll('.pb-tracer')).toHaveLength(0)
  })

  it('dedupes a same-shot DAMAGE+KILL pair into one tracer', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.events.push({ type: 'KILL', timeSec: 12.1, accountId: 1001, targetAccountId: 2001, damage: null })
    const wrapper = mountPlayback(overview, 12.05)
    await flushPromises()
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
  })
})

describe('map zoom and pan', () => {
  async function zoomedWrapper() {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    return wrapper
  }

  it('wheel zooms in/out anchored at the cursor and clamps to 1x-4x', async () => {
    const wrapper = await zoomedWrapper()
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('scale(1.2)')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('scale(4)')
    for (let i = 0; i < 20; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: 120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('scale(1)')
  })

  it('dragging pans the viewport and suppresses the follow-up click (no accidental selection)', async () => {
    const wrapper = await zoomedWrapper()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 })
    expect(viewport.attributes('style')).toContain('translate(50px, 20px)')
    await viewport.trigger('pointerup', { pointerId: 1 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerup', { pointerId: 2 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('pinch with two pointers zooms around the midpoint', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 200, clientY: 0 })
    expect(viewport.attributes('style')).toContain('scale(2)')
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
  })

  function nonzeroRect() {
    return {
      left: 100,
      top: 50,
      width: 400,
      height: 300,
      right: 500,
      bottom: 350,
      x: 100,
      y: 50,
      toJSON: () => ({})
    }
  }

  it('pinch anchor uses map-local coordinates when the map is not at the viewport origin', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 110, clientY: 60 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 210, clientY: 60 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 310, clientY: 60 })
    // 锚点局部 (60,10)，dist 100→200（ratio 2）：t'=anchor−anchor·2=(−60,−10)；中点位移 (50,0)
    expect(viewport.attributes('style')).toContain('translate(-10px, -10px) scale(2)')
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
  })

  it('wheel zoom anchors at the cursor in screen coordinates', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 110, clientY: 60 })
    // 屏幕锚点 (10,10)：t' = 10 − 10×1.2 = −2
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toContain('translate(-2px, -2px) scale(1.2)')
  })

  function parseTransform(style) {
    const m = style.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/)
    return m ? { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) } : null
  }

  it('wheel zoom keeps the cursor content point fixed after prior zoom and pan', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const map = wrapper.find('[data-test="pb-map"]')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await map.trigger('wheel', { deltaY: -120, clientX: 110, clientY: 60 }) // → (-2,-2) scale 1.2
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 }) // 平移 +50/+20 → (48,18)
    await viewport.trigger('pointerup', { pointerId: 1 })
    await map.trigger('wheel', { deltaY: -120, clientX: 150, clientY: 80 }) // 屏幕锚点 (50,30)
    const t = parseTransform(viewport.attributes('style'))
    expect(t).not.toBeNull()
    expect(t.scale).toBeCloseTo(1.44, 6)
    expect(t.tx).toBeCloseTo(47.6, 6)
    expect(t.ty).toBeCloseTo(15.6, 6)
    // 锚点内容不变式：(px − tx)/scale
    const before = { x: (50 - 48) / 1.2, y: (30 - 18) / 1.2 }
    const after = { x: (50 - t.tx) / t.scale, y: (30 - t.ty) / t.scale }
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('consecutive wheel zooms keep the anchor fixed at every step and clamp to 1x-4x', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const map = wrapper.find('[data-test="pb-map"]')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    // 初始 scale 1、t=0：屏幕锚点 (50,30) 即内容点
    for (let i = 0; i < 3; i++) {
      await map.trigger('wheel', { deltaY: -120, clientX: 150, clientY: 80 })
      const t = parseTransform(viewport.attributes('style'))
      expect((50 - t.tx) / t.scale).toBeCloseTo(50, 6)
      expect((30 - t.ty) / t.scale).toBeCloseTo(30, 6)
    }
    for (let i = 0; i < 12; i++) {
      await map.trigger('wheel', { deltaY: -120, clientX: 150, clientY: 80 })
    }
    expect(parseTransform(viewport.attributes('style')).scale).toBe(4)
    for (let i = 0; i < 30; i++) {
      await map.trigger('wheel', { deltaY: 120, clientX: 150, clientY: 80 })
    }
    const min = parseTransform(viewport.attributes('style'))
    expect(min.scale).toBe(1)
    expect(min.tx).toBe(0)
    expect(min.ty).toBe(0)
  })

  it('pinch keeps the mid-point content fixed after prior zoom and pan, including consecutive pinches', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    wrapper.find('[data-test="pb-map"]').element.getBoundingClientRect = () => nonzeroRect()
    const map = wrapper.find('[data-test="pb-map"]')
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await map.trigger('wheel', { deltaY: -120, clientX: 110, clientY: 60 }) // (-2,-2) 1.2
    await viewport.trigger('pointerdown', { pointerId: 9, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 9, clientX: 60, clientY: 30 }) // → (48,18) 1.2
    await viewport.trigger('pointerup', { pointerId: 9 })
    // 第一次捏合：mid 160→210、dist 100→200（ratio 2）
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 110, clientY: 60 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 210, clientY: 60 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 310, clientY: 60 })
    const t = parseTransform(viewport.attributes('style'))
    expect(t.scale).toBeCloseTo(2.4, 6)
    // 不变式：捏合前 mid0 下的内容点 == 捏合后 mid1 下的内容点（手指跟随）
    const beforeMid = { x: (160 - 100 - 48) / 1.2, y: (60 - 50 - 18) / 1.2 }
    const afterMid = { x: (210 - 100 - t.tx) / t.scale, y: (60 - 50 - t.ty) / t.scale }
    expect(afterMid.x).toBeCloseTo(beforeMid.x, 6)
    expect(afterMid.y).toBeCloseTo(beforeMid.y, 6)
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
    // 连续第二次捏合：mid 170→210、dist 100→200，2.4×2 → clamp 4
    await viewport.trigger('pointerdown', { pointerId: 3, clientX: 120, clientY: 70 })
    await viewport.trigger('pointerdown', { pointerId: 4, clientX: 220, clientY: 70 })
    await viewport.trigger('pointermove', { pointerId: 4, clientX: 320, clientY: 70 })
    const t2 = parseTransform(viewport.attributes('style'))
    expect(t2.scale).toBe(4)
    const mid2Before = { x: (170 - 100 - t.tx) / t.scale, y: (70 - 50 - t.ty) / t.scale }
    const mid2After = { x: (220 - 100 - t2.tx) / t2.scale, y: (70 - 50 - t2.ty) / t2.scale }
    expect(mid2After.x).toBeCloseTo(mid2Before.x, 6)
    expect(mid2After.y).toBeCloseTo(mid2Before.y, 6)
    await viewport.trigger('pointerup', { pointerId: 3 })
    await viewport.trigger('pointerup', { pointerId: 4 })
  })

  it('reset restores identity view and keeps all layers on the single transform', async () => {
    const wrapper = await zoomedWrapper()
    const markerStyleBefore = wrapper.find('[data-test="pb-marker-1001"]').attributes('style')
    await wrapper.find('[data-test="pb-reset"]').trigger('click')
    const style = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    expect(style).toContain('scale(1)')
    expect(style).toContain('translate(0px, 0px)')
    // 图层对齐契约：transform 只在 viewport 单层；标记 left/top（%）不随缩放变化，
    // 标记反缩放随 view.scale 回到 1（scale(1)），svg 自身无 style
    const markerAfter = wrapper.find('[data-test="pb-marker-1001"]').attributes('style')
    const leftTop = (s) => s.match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    expect(leftTop(markerAfter)).toEqual(leftTop(markerStyleBefore))
    expect(markerAfter).toContain('scale(1)')
    expect(wrapper.find('.pb-svg').attributes('style')).toBeUndefined()
  })
})

describe('fixed-size vehicle markers', () => {
  function parseMarkerScale(style) {
    const m = style.match(/scale\(([-\d.]+)\)/)
    return m ? Number(m[1]) : null
  }

  function viewportScale(wrapper) {
    const m = wrapper.find('[data-test="pb-viewport"]').attributes('style').match(/scale\(([-\d.]+)\)/)
    return Number(m[1])
  }

  it('marker inverse scale keeps screen size fixed at 1x/2x/4x', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    // 1×：反缩放 1
    expect(parseMarkerScale(marker.attributes('style'))).toBeCloseTo(1)
    // 2×（两次 wheel）
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    const s2 = viewportScale(wrapper)
    expect(s2).toBeGreaterThan(1)
    expect(parseMarkerScale(marker.attributes('style'))).toBeCloseTo(1 / s2, 10)
    // 4×（clamp）
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBe(4)
    expect(parseMarkerScale(marker.attributes('style'))).toBeCloseTo(0.25, 10)
  })

  it('marker map-coordinate anchor and child rotation/overlays survive zooming', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].deathSec = 30 // destroyed 结构：hull/turret + ✕
    const wrapper = mountPlayback(overview, 40)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    const leftTopBefore = marker.attributes('style').match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    const hullRotateBefore = marker.findAll('img')[0].attributes('style')
    const turretRotateBefore = marker.findAll('img')[1].attributes('style')
    expect(marker.classes()).toContain('pb-destroyed')
    expect(marker.find('.pb-death').exists()).toBe(true)
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    const leftTopAfter = marker.attributes('style').match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    expect(leftTopAfter).toEqual(leftTopBefore) // 中心仍锚定同一地图坐标
    expect(marker.findAll('img')[0].attributes('style')).toBe(hullRotateBefore) // 旋转不被反缩放覆盖
    expect(marker.findAll('img')[1].attributes('style')).toBe(turretRotateBefore)
    expect(marker.find('.pb-death').exists()).toBe(true) // ✕ 随标记保持固定屏幕尺寸（同一结构）
  })
})

describe('fixed-size strokes and always-visible tank name labels', () => {
  it('tracer stroke width stays constant on screen at any zoom', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 1×：炮线 1.5px
    expect(wrapper.find('.pb-tracers').attributes('stroke-width')).toBe('1.5')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    // 4×：除以 view.scale 保持屏幕宽度（长度仍随地图坐标缩放）
    expect(wrapper.find('.pb-tracers').attributes('stroke-width')).toBe('0.375')
  })

  it('marker images keep center-pivot rotation with the visible-body scale', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const imgs = wrapper.find('[data-test="pb-marker-1001"]').findAll('img')
    expect(imgs.length).toBe(2)
    for (const img of imgs) {
      const style = img.attributes('style')
      expect(style).toContain('translate(-50%, -50%)') // 以素材共同 pivot 居中（131% 有效车体缩放）
      expect(style).toContain('rotate(')
    }
  })

  it('tank name label is always visible above every marker at any zoom', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 1× 即常显（不再依赖 ≥2× 缩放）
    const labels = wrapper.findAll('.pb-name')
    expect(labels.length).toBe(2) // 两辆可见车都显示标签
    expect(labels[0].text()).toContain('Maus')
    expect(labels[1].text()).toContain('T49')
    // 标签位于图标上方（bottom: calc(100% + 2px)），且高倍缩放后仍在（反缩放恒定）
    for (const label of labels) {
      expect(label.attributes('style')).toBeUndefined() // 位置由 CSS 控制
    }
    const firstStyle = wrapper.find('.pb-vehicle').attributes('style')
    expect(firstStyle).toContain('scale(') // 反缩放逻辑未变
    for (let i = 0; i < 12; i++) { // 1× → 4×
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.findAll('.pb-name').length).toBe(2)
  })

  it('no route polylines are rendered in the playback view', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('.pb-routes').exists()).toBe(false)
    expect(wrapper.findAll('.pb-route')).toHaveLength(0)
  })
})

describe('gesture click suppression and pointer cleanup', () => {
  it('pinch followed by a click does not select the vehicle; next plain click does', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 220, clientY: 0 })
    await viewport.trigger('pointerup', { pointerId: 1 })
    await viewport.trigger('pointerup', { pointerId: 2 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('plain click selects and sub-threshold single-finger move is not a drag', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 12, clientY: 12 }) // <5px
    await viewport.trigger('pointerup', { pointerId: 1 })
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
  })

  it('pointerup on window cleans state; next pan starts from a fresh baseline', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 }) // scale>1 才可平移
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 60, clientY: 30 }) // pan +50/+20
    const up = new window.Event('pointerup')
    up.pointerId = 1
    window.dispatchEvent(up) // 指针移出元素后在 window 上结束
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 20, clientY: 20 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 30, clientY: 20 })
    expect(viewport.attributes('style')).toContain('translate(60px, 20px)') // 上次 50,20 + 新位移 10,0
    await viewport.trigger('pointerup', { pointerId: 2 })
  })

  it('pinch ending with one finger left continues panning (no stuck state)', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const viewport = wrapper.find('[data-test="pb-viewport"]')
    await viewport.trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    await viewport.trigger('pointerdown', { pointerId: 2, clientX: 100, clientY: 0 })
    await viewport.trigger('pointermove', { pointerId: 2, clientX: 200, clientY: 0 })
    await viewport.trigger('pointerup', { pointerId: 2 }) // 剩下一根手指
    await viewport.trigger('pointermove', { pointerId: 1, clientX: 50, clientY: 30 })
    const style = viewport.attributes('style')
    expect(style).toContain('scale(2)')
    expect(style).toContain('translate(50px, 30px)')
    await viewport.trigger('pointerup', { pointerId: 1 })
  })

  it('unmount removes window listeners and pointer state', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    await wrapper.find('[data-test="pb-viewport"]').trigger('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function))
    removeSpy.mockRestore()
    const up = new window.Event('pointerup')
    up.pointerId = 1
    window.dispatchEvent(up)
    const move = new window.Event('pointermove')
    move.pointerId = 1
    window.dispatchEvent(move)
  })
})

describe('destroyed markers (symmetric contract)', () => {
  function destroyedOverview() {
    const overview = makeOverview()
    overview.playback.vehicles[0].deathSec = 30
    overview.playback.vehicles[1].deathSec = 30
    overview.playback.vehicles[1].directionSamples = []
    overview.playback.vehicles[1].positionIntervals = [{ startSec: 10, endSec: 40 }]
    overview.routes[0].points.push({ x: 200, y: 200, timeSec: 40 })
    overview.routes[1].points.push({ x: -300, y: -300, timeSec: 40 })
    return overview
  }

  it('friendly and enemy destroyed markers share the same structure at the same timestamp', async () => {
    stubRaf()
    const wrapper = mountPlayback(destroyedOverview(), 40)
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
    const wrapper = mountPlayback(destroyedOverview(), 40)
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
})
