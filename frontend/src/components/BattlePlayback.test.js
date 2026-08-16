// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'
import { preloadBattleModels } from '../vehicle-models/runtime.js'

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

vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({
    resolved: new Map(),
    failed: new Set(),
    byTank: new Map(),
  })),
}))

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
    // t=25 超出 positionIntervals [10,20]：位置流未覆盖 → 真实 gap，淡化停驻
    const wrapper = mountPlayback(gapOverview(), 25)
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
    expect(recorder.find('.pb-recorder-badge').exists()).toBe(true)
    await recorder.trigger('click')
    expect(recorder.find('.pb-selected-mark').exists()).toBe(true)
  })

  it('covered vehicles are not faded even when sampled route points have a >5s gap (position stream coverage)', async () => {
    stubRaf()
    // t=20 落在 positionIntervals [10,20] 内（位置上报中）但 route 采样点 14→40 gap>5s：
    // 不得因 live=null 误判 lastKnown（修复「位置流覆盖却半透明」）
    const wrapper = mountPlayback(gapOverview(), 20)
    await flushPromises()
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).not.toContain('pb-last-known')
  })

  it('re-reported enemies restore opacity in the second coverage interval (position coverage gap → resume)', async () => {
    stubRaf()
    const overview = makeOverview()
    // EnemyA：10–20 覆盖 → 位置流中断（gap）→ 40–60 再覆盖（两段区间）；t=50 在第二段区间内
    overview.playback.vehicles[1].positionIntervals = [
      { startSec: 10, endSec: 20 },
      { startSec: 40, endSec: 60 }
    ]
    overview.routes[1].points = [
      { x: -50, y: -50, timeSec: 10 },
      { x: -100, y: -100, timeSec: 14 },
      { x: -200, y: -200, timeSec: 40 },
      { x: -250, y: -250, timeSec: 50 }
    ]
    const wrapper = mountPlayback(overview, 50)
    await flushPromises()
    const enemy = wrapper.find('[data-test="pb-marker-2001"]')
    expect(enemy.exists()).toBe(true)
    expect(enemy.classes()).not.toContain('pb-last-known')
    expect(enemy.classes()).not.toContain('pb-destroyed')
  })

  it('renders team HP bars that decrease with playback time', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].maxHp = 3000
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }, { timeSec: 12, hp: 2600 }]
    overview.playback.vehicles[1].maxHp = 2600
    overview.playback.vehicles[1].hpSamples = [{ timeSec: 10, hp: 2600 }, { timeSec: 12, hp: 2200 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-bars"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('2600 / 3000') // 本方 t=12
    expect(wrapper.text()).toContain('2200 / 2600') // 敌方 t=12
  })

  it('supremacy points come from the realtime broadcast timeline and change with seek time', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.pointsSamples = [
      { timeSec: 10, team: 1, points: 300 },
      { timeSec: 10, team: 2, points: 300 },
      { timeSec: 20, team: 1, points: 500 },
      { timeSec: 20, team: 2, points: 280 }
    ]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    // t=12：取最近一次 ≤12 的广播
    expect(wrapper.find('[data-test="pb-points-friendly"]').text()).toContain('300')
    expect(wrapper.find('[data-test="pb-points-enemy"]').text()).toContain('300')
    // 拖动到 t=20：比分必须随 currentTime 变化，不是终局静态值
    await wrapper.find('.pb-range').setValue(20)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-points-friendly"]').text()).toContain('500')
    expect(wrapper.find('[data-test="pb-points-enemy"]').text()).toContain('280')
  })

  it('friendly no-sample falls back to full HP; enemy no-sample stays UNKNOWN gray', async () => {
    stubRaf()
    const overview = makeOverview()
    // friendly（vehicles[0]）存活无采样 → 满血回退（本方路径）
    overview.playback.vehicles[0].maxHp = 3000
    overview.playback.vehicles[0].hpSamples = []
    // enemy（vehicles[1]）存活无采样 → UNKNOWN 灰段（敌方禁止 maxHp fallback）
    overview.playback.vehicles[1].maxHp = 2600
    overview.playback.vehicles[1].hpSamples = []
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-unknown-enemy"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-hp-unknown-enemy"]').text()).toContain('2600')
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('3000 / 3000') // friendly 满血回退
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('0 / 2600') // enemy 无采样 → known=0
    // 已阵亡且无采样 → 双方路径都 UNKNOWN
    const overview2 = makeOverview()
    overview2.playback.vehicles[0].maxHp = 3000
    overview2.playback.vehicles[0].hpSamples = []
    overview2.playback.vehicles[0].deathSec = 5
    overview2.playback.vehicles[1].maxHp = 2600
    overview2.playback.vehicles[1].hpSamples = []
    overview2.playback.vehicles[1].deathSec = 5
    const wrapper2 = mountPlayback(overview2, 12)
    await flushPromises()
    expect(wrapper2.find('[data-test="pb-hp-unknown-friendly"]').exists()).toBe(true)
    expect(wrapper2.find('[data-test="pb-hp-unknown-enemy"]').exists()).toBe(true)
    expect(wrapper2.find('[data-test="pb-hp-unknown-friendly"]').text()).toContain('3000')
    // enemy 有第一条真实 HP sample → 使用真实 sample，不再 UNKNOWN
    const overview3 = makeOverview()
    overview3.playback.vehicles[0].maxHp = 3000
    overview3.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }]
    overview3.playback.vehicles[1].maxHp = 2600
    overview3.playback.vehicles[1].hpSamples = [{ timeSec: 2, hp: 2000 }]
    const wrapper3 = mountPlayback(overview3, 12)
    await flushPromises()
    expect(wrapper3.find('[data-test="pb-hp-unknown-enemy"]').exists()).toBe(false)
    expect(wrapper3.find('[data-test="pb-hp-bars"]').text()).toContain('2000 / 2600')
  })

  it('death does not jump the team HP bar to 65533 (0xFFFD sentinel excluded)', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].maxHp = 3000
    overview.playback.vehicles[0].hpSamples = [
      { timeSec: 0, hp: 3000 },
      { timeSec: 10, hp: 65533 }, // 0xFFFD 死亡 sentinel：绝不作为 HP
      { timeSec: 10.5, hp: 0 }    // 阵亡
    ]
    const wrapper = mountPlayback(overview, 11)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('0 / 3000') // 阵亡 → 0
    expect(wrapper.text()).not.toContain('65533')
  })

  it('tank marker scales with the map (no counter-scale) while name/death overlays stay constant', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120 }) // 放大 1.2×
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    const style = marker.attributes('style')
    expect(style).toContain('translate(-50%, -50%)')
    expect(style).not.toContain('scale(') // 标记本体不再反缩放 → 随地图缩放
    const name = marker.find('.pb-labels')
    expect(name.attributes('style')).toContain('scale(0.833') // 1/1.2 反缩放保屏幕恒定
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
    // 标记本体不再反缩放（随地图缩放），svg 自身无 style
    const markerAfter = wrapper.find('[data-test="pb-marker-1001"]').attributes('style')
    const leftTop = (s) => s.match(/left: ([^;]+); top: ([^;]+);/).slice(1, 3)
    expect(leftTop(markerAfter)).toEqual(leftTop(markerStyleBefore))
    expect(markerAfter).not.toContain('scale(')
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

  it('marker scales with the map (no counter-scale) while the name overlay counter-scales to stay constant', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    // 1×：标记本体无反缩放
    expect(parseMarkerScale(marker.attributes('style'))).toBeNull()
    // 2× → 4×（wheel）：标记仍无反缩放（随 viewport 同比放大），名称叠加层按 1/view.scale 反缩放
    for (let i = 0; i < 14; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBe(4)
    expect(parseMarkerScale(marker.attributes('style'))).toBeNull()
    expect(marker.find('.pb-labels').attributes('style')).toContain('scale(0.25)')
  })

  it('zoom 下 selected→name gap 与 recorder→vehicle 恒定；浮动幅度恒 ≈2px（1×/≈2×/4×）', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const readOffset = (sel) => {
      const style = wrapper.find(sel).attributes('style') || ''
      const m = style.match(/calc\(100% \+ ([\d.]+)px\)/)
      return m ? Number(m[1]) : null
    }
    const readInv = () => {
      const style = wrapper.find('.pb-selected-mark').attributes('style') || ''
      const m = style.match(/--pb-overlay-inv: ([\d.]+)/)
      return m ? Number(m[1]) : null
    }
    // 屏幕几何（layout→screen）：三角底边 = (X + 4.5)·s − 4.5；name 顶边 = 9·s + 7（name 锚点 2px + 盒高 14px，与 .pb-name CSS 一致）
    const triBottom = (x, s) => (x + 4.5) * s - 4.5
    const nameTop = (s) => 9 * s + 7
    const check = () => {
      const s = viewportScale(wrapper)
      const x = readOffset('.pb-selected-mark')
      const r = readOffset('.pb-recorder-badge')
      const inv = readInv()
      expect(x).toBeTruthy()
      expect(r).toBeTruthy()
      expect(inv).toBeTruthy()
      // selected → name 顶边屏幕 gap 恒 3px（三角跟随 name 上移）
      expect(triBottom(x, s) - nameTop(s)).toBeCloseTo(3, 6)
      // recorder → vehicle 恒 5px
      expect(r * s).toBeCloseTo(5, 6)
      // 浮动幅度 = 2px × inv × s = 2px（inv = 1/s）
      expect(inv * s).toBeCloseTo(1, 6)
    }
    // 1×：selected 19px / recorder 5px（既有基准契约）
    expect(viewportScale(wrapper)).toBe(1)
    expect(readOffset('.pb-selected-mark')).toBe(19)
    expect(readOffset('.pb-recorder-badge')).toBe(5)
    check()
    // ≈2×（1.2^4 ≈ 2.07）
    for (let i = 0; i < 4; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBeGreaterThan(1.9)
    check()
    // 4×（钳制）
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(viewportScale(wrapper)).toBe(4)
    check()
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
  it('laser glow and core stroke widths stay constant on screen at any zoom', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 1×：外层光晕 6px / 内芯 1.75px（逐元素绑定，屏幕宽度恒定）
    expect(wrapper.find('.pb-tracer').attributes('stroke-width')).toBe('6')
    expect(wrapper.find('.pb-tracer-core').attributes('stroke-width')).toBe('1.75')
    for (let i = 0; i < 12; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    // 4×：除以 view.scale 保持屏幕宽度（长度仍随地图坐标缩放）
    expect(wrapper.find('.pb-tracer').attributes('stroke-width')).toBe('1.5')
    expect(wrapper.find('.pb-tracer-core').attributes('stroke-width')).toBe('0.4375')
  })

  it('renders laser layers (glow + white core + impact flash) with flash expanding', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    // 命中瞬间三层齐全：光晕（阵营色）、内芯（亮白）、命中闪光圆点
    expect(wrapper.findAll('.pb-tracer')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer-core')).toHaveLength(1)
    expect(wrapper.findAll('.pb-tracer-flash')).toHaveLength(1)
    const core = wrapper.find('.pb-tracer-core')
    expect(core.attributes('stroke')).toBe('#fff')
    expect(core.attributes('opacity')).toBe('1')
    const flash = wrapper.find('.pb-tracer-flash')
    expect(flash.attributes('cx')).toBeTruthy()
    expect(flash.attributes('r')).toBe('3') // flashProgress=0 → 起始半径 3px
    // 0.1s 后闪光扩散（flashProgress≈0.286 → r≈5.57）
    const later = mountPlayback(makeOverview(), 12.1)
    await flushPromises()
    const rLater = Number(later.find('.pb-tracer-flash').attributes('r'))
    expect(rLater).toBeGreaterThan(3)
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
    const labels = wrapper.findAll('.pb-labels')
    expect(labels.length).toBe(2) // 两辆可见车都显示标签
    expect(labels[0].text()).toContain('Maus')
    expect(labels[1].text()).toContain('T49')
    // 标签块位于图标上方（bottom: calc(100% + 2px)），自身反缩放（overlayInverseScale）→ 屏幕字号恒定
    for (const label of labels) {
      expect(label.attributes('style')).toContain('scale(')
    }
    const firstStyle = wrapper.find('.pb-vehicle').attributes('style')
    expect(firstStyle).not.toContain('scale(') // 标记本体随地图缩放，不再反缩放
    for (let i = 0; i < 12; i++) { // 1× → 4×
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 0, clientY: 0 })
    }
    expect(wrapper.findAll('.pb-labels').length).toBe(2)
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

  it('destroyed + selected：selected 走克制变体（destroyed > selected，仍可辨认）；✕ 覆盖车体中心', async () => {
    stubRaf()
    const wrapper = mountPlayback(destroyedOverview(), 40)
    await flushPromises()
    const friendly = wrapper.find('[data-test="pb-marker-1001"]')
    await friendly.trigger('click')
    const mark = friendly.find('.pb-selected-mark')
    expect(mark.exists()).toBe(true)
    expect(mark.classes()).toContain('pb-selected-restrained')
    // ✕ 中心定位 + overlayInverseScale 反缩放（1× = scale(1)），覆盖车辆主体
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

  function overviewWithTank(tankId, tankName, team = 1) {
    const overview = makeOverview()
    overview.playback.vehicles = [
      {
        accountId: 1001, playerName: 'You', tankId, tankName, team,
        positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null,
        directionSamples: [
          { timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
          { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 },
        ],
      },
    ]
    return overview
  }

  afterEach(() => {
    vi.mocked(preloadBattleModels).mockReset()
    vi.mocked(preloadBattleModels).mockResolvedValue({ resolved: new Map(), failed: new Set(), byTank: new Map() })
  })

  it('Tier X turreted：渲染 dedicated hull + turret assembly（嵌套 transform），非 generic', async () => {
    stubRaf()
    const overview = overviewWithTank(6929, 'Maus')
    vi.mocked(preloadBattleModels).mockResolvedValue({
      resolved: new Map([['maus', mausModel]]),
      failed: new Set(),
      byTank: new Map([['6929', 'maus']]),
    })
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.exists()).toBe(true)
    expect(marker.find('.pb-hull-dedicated').attributes('src')).toBe('/vm/maus/hull.webp')
    // t=12：hull 0→90 插值 45°；turret = 45 + 15(relative 0→30 插值) = 60°
    expect(marker.find('.pb-hull-dedicated').attributes('style')).toContain('rotate(45deg)') // H
    const assembly = marker.find('.pb-turret-assembly')
    expect(assembly.exists()).toBe(true)
    expect(assembly.attributes('style')).toContain('rotate(45deg)') // 父层 H
    const turret = marker.find('.pb-turret-dedicated')
    expect(turret.attributes('src')).toBe('/vm/maus/turret.webp')
    expect(turret.attributes('style')).toContain('rotate(15deg)') // T - H = 60 - 45
    expect(marker.find('.pb-hull.pb-hull-dedicated').exists()).toBe(true)
    expect(marker.find('.pb-hull:not(.pb-hull-dedicated)').exists()).toBe(false) // 无 generic 层
  })

  it('preload 失败 modelKey → 单车 generic fallback（不整场 fallback）', async () => {
    stubRaf()
    const overview = overviewWithTank(6929, 'Maus')
    vi.mocked(preloadBattleModels).mockResolvedValue({
      resolved: new Map(),
      failed: new Set(['maus']),
      byTank: new Map([['6929', 'maus']]),
    })
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-1001"]')
    expect(marker.find('.pb-hull').exists()).toBe(true) // generic 双层
    expect(marker.find('.pb-turret').exists()).toBe(true)
    expect(marker.find('.pb-hull-dedicated').exists()).toBe(false)
    expect(marker.find('.pb-turret-assembly').exists()).toBe(false)
  })

  it('Tier X turretless：仅 dedicated hull，无 fake turret layer（§14）', async () => {
    stubRaf()
    const overview = overviewWithTank(3937, 'Ho-Ri')
    vi.mocked(preloadBattleModels).mockResolvedValue({
      resolved: new Map([['ho-ri', hoRiModel]]),
      failed: new Set(),
      byTank: new Map([['3937', 'ho-ri']]),
    })
    const wrapper = mountPlayback(overview, 12)
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
    const player = wrapper.find('[data-test="pb-show-player"]')
    const tank = wrapper.find('[data-test="pb-show-tank"]')
    expect(player.element.checked).toBe(false)
    expect(tank.element.checked).toBe(true)
    // 默认只显示坦克名行
    expect(wrapper.findAll('.pb-label-tank').length).toBe(2)
    expect(wrapper.findAll('.pb-label-player').length).toBe(0)
    await player.setValue(true)
    expect(wrapper.findAll('.pb-label-player').length).toBe(2)
    expect(wrapper.findAll('.pb-label-player')[0].text()).toBe('You')
    // 持久化：localStorage 写入
    const saved = JSON.parse(localStorage.getItem('wotb.pb.label-prefs'))
    expect(saved).toEqual({ showPlayerName: true, showTankName: true })
    // 重新挂载 → 读取持久化值
    const w2 = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(w2.find('[data-test="pb-show-player"]').element.checked).toBe(true)
    expect(w2.findAll('.pb-label-player').length).toBe(2)
  })

  it('§32/§33/§34 碰撞集成：两车贴近 → 上方 tank 标签上移，玩家名经 hysteresis 后隐藏', async () => {
    stubRaf()
    // performance.now 全程受控（fakeNow），hysteresis 时间轴确定
    let fakeNow = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const overview = makeOverview()
    // 两车同位 → 标签必然冲突（player 名够长保证与对方 tank 盒重叠）
    overview.routes[0].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.routes[1].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.playback.vehicles[1].playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    const wrapper = mountPlayback(overview, 12)
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await wrapper.find('.pb-range').setValue(12.5) // 触发 seek（值变化）→ 重算 labelLayout
    await flushPromises()
    // 上方（friendly 1001，y 更小）tank 标签上移让位
    const a = wrapper.find('[data-test="pb-marker-1001"]')
    const b = wrapper.find('[data-test="pb-marker-2001"]')
    const aDy = parseFloat((a.find('.pb-labels').attributes('style') || '').match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || '0')
    expect(aDy).toBeLessThan(2) // 上方标签被上移（2 + dy < 2 基准）
    // 玩家名：冲突持续超过 hideMs（250ms）才隐藏（fakeNow 受控推进）
    await wrapper.find('.pb-range').setValue(12.1) // seek 刷新 nowMs（冲突开始计时，fakeNow=0）
    await flushPromises()
    expect(b.find('.pb-label-player').attributes('style')).toBeUndefined() // 未到阈值仍显示
    fakeNow = 400 // 400ms > hideMs
    await wrapper.find('.pb-range').setValue(12.2)
    await flushPromises()
    expect(b.find('.pb-label-player').attributes('style')).toContain('display: none') // 已隐藏
    nowSpy.mockRestore()
  })

  it('§37 重叠 hitbox 选中：点击坐标靠近 B → 选中 B（即使点在 A 的按钮上）', async () => {
    stubRaf()
    const overview = makeOverview()
    // A 中心 content x=100（map -225），B 中心 content x=90（map -232.5），y 相同
    // A 按钮盒 x∈[82,118]，A hitbox x∈[83.8,116.2]，B hitbox x∈[73.8,106.2] → 点击 x=84 两盒都命中
    overview.routes[0].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.routes[1].points = [{ x: -232.5, y: -204.2, timeSec: 10 }, { x: -232.5, y: -204.2, timeSec: 14 }]
    overview.playback.vehicles[1].positionIntervals = [{ startSec: 0, endSec: 60 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    const aBtn = wrapper.find('[data-test="pb-marker-1001"]')
    // 点击 A 的按钮，坐标 (90, 675)：A/B generic hitbox 都命中（A 中心 (100,675)、B 中心 (90,675)）
    await aBtn.trigger('click', { clientX: 90, clientY: 675 })
    // 距离最近者 2001（B，dist 0）被选中（A dist 10）
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA')
    // 再点同一点 → 已选 B 被取消（toggle）
    await aBtn.trigger('click', { clientX: 90, clientY: 675 })
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
  })

  it('§49 倍速循环含 0.5×；loop 到末尾自动回绕', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const btn = wrapper.find('[data-test="pb-speed"]')
    await btn.trigger('click')
    expect(btn.text()).toBe('2×')
    await btn.trigger('click')
    expect(btn.text()).toBe('4×')
    await btn.trigger('click')
    expect(btn.text()).toBe('0.5×')
    await btn.trigger('click')
    expect(btn.text()).toBe('1×')
    // loop：seek 到接近末尾 → 播放 → 越过末尾自动回 0 继续
    await wrapper.setProps({ loop: true })
    const wrap = mountPlayback(makeOverview(), 59)
    await flushPromises()
    await wrap.setProps({ loop: true })
    await wrap.find('[data-test="pb-play"]').trigger('click')
    expect(rafCb).toBeTruthy()
    rafCb(0)
    rafCb(1000) // 推进 1s → 59 + 1 = 60 = duration → loop 回 0
    await flushPromises()
    expect(wrap.find('.pb-time').text()).toBe('00:00 / 01:00')
  })
})
