// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'
import { preloadBattleModels } from '../vehicle-models/runtime.js'
import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'
import { PLAYER_FADE_MS, PLAYER_HIDE_MS, PLAYER_SHOW_MS } from '../utils/labelLayout'

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

vi.mock('../vehicle-portraits/runtime.js', () => ({
  loadVehiclePortrait: vi.fn(async (tankId) => tankId === 2 ? '/portraits/2.webp' : null),
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
          ],
          hpLosses: [{ fromSec: 0, toSec: 12, hpLoss: 400, attackerAccountId: 1001, attackerReliable: true }]
        },
        { accountId: 2002, playerName: 'NeverSeen', tankId: 3, team: 2, positionIntervals: [], deathSec: null, directionSamples: [] }
      ],
      events: [
        { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, rawProtocolValue: null, observedHpLoss: null },
        { type: 'DAMAGE', timeSec: 12, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
        { type: 'POSITION_STALE', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null, observedHpLoss: null }
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
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }, { timeSec: 12, hp: 2600 }]
    overview.playback.vehicles[1].baseHp = 2600

    overview.playback.vehicles[1].observedCapacityHp = 2600
    overview.playback.vehicles[1].hpSamples = [{ timeSec: 10, hp: 2600 }, { timeSec: 12, hp: 2200 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-bars"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('2600') // 本方 t=12 knownRemaining
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).toContain('2200') // 敌方 t=12 knownRemaining
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
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = []
    // enemy（vehicles[1]）存活无采样 → UNKNOWN 灰段（敌方禁止 maxHp fallback）
    overview.playback.vehicles[1].baseHp = 2600

    overview.playback.vehicles[1].observedCapacityHp = 2600
    overview.playback.vehicles[1].hpSamples = []
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-unknown-enemy"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-hp-unknown-enemy"]').text()).toContain('2600')
    // PR #107：friendly 无采样 → 相对满血状态（spawnFull 标记），不显示 base 总血量
    expect(wrapper.find('[data-test="pb-hp-spawn-full-friendly"]').exists()).toBe(true)
    // enemy 无采样 → known=0（unknownMax 灰段）
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).not.toContain(' / 2600')
    // 已阵亡且无采样 → 阵亡是权威事实（HP=0），dead 车容量不进未知灰段（Blocker 2）
    const overview2 = makeOverview()
    overview2.playback.vehicles[0].baseHp = 3000

    overview2.playback.vehicles[0].observedCapacityHp = 3000
    overview2.playback.vehicles[0].hpSamples = []
    overview2.playback.vehicles[0].deathSec = 5
    overview2.playback.vehicles[1].baseHp = 2600

    overview2.playback.vehicles[1].observedCapacityHp = 2600
    overview2.playback.vehicles[1].hpSamples = []
    overview2.playback.vehicles[1].deathSec = 5
    const wrapper2 = mountPlayback(overview2, 12)
    await flushPromises()
    // 无 unknownMax（dead 车不贡献灰段）→ 无 unknown 文案；value 为 —（无任何数据）
    expect(wrapper2.find('[data-test="pb-hp-unknown-friendly"]').exists()).toBe(false)
    expect(wrapper2.find('[data-test="pb-hp-unknown-enemy"]').exists()).toBe(false)
    expect(wrapper2.find('[data-test="pb-hp-value-friendly"]').text()).toBe('—')
    expect(wrapper2.find('[data-test="pb-hp-value-enemy"]').text()).toBe('—')
    // enemy 有第一条真实 HP sample → 使用真实 sample，不再 UNKNOWN
    const overview3 = makeOverview()
    overview3.playback.vehicles[0].baseHp = 3000

    overview3.playback.vehicles[0].observedCapacityHp = 3000
    overview3.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }]
    overview3.playback.vehicles[1].baseHp = 2600

    overview3.playback.vehicles[1].observedCapacityHp = 2600
    overview3.playback.vehicles[1].hpSamples = [{ timeSec: 2, hp: 2000 }]
    const wrapper3 = mountPlayback(overview3, 12)
    await flushPromises()
    expect(wrapper3.find('[data-test="pb-hp-unknown-enemy"]').exists()).toBe(false)
    expect(wrapper3.find('[data-test="pb-hp-bars"]').text()).toContain('2000')
  })

  it('death does not jump the team HP bar to 65533 (0xFFFD sentinel excluded)', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = [
      { timeSec: 0, hp: 3000 },
      { timeSec: 10, hp: 65533 }, // 0xFFFD 死亡 sentinel：绝不作为 HP
      { timeSec: 10.5, hp: 0 }    // 阵亡
    ]
    const wrapper = mountPlayback(overview, 11)
    await flushPromises()
    // 阵亡 0 采样 → knownRemaining=0（无已知剩余）；无已证明分母 → value 为 —（不显示 0/0）
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('—')
    expect(wrapper.text()).not.toContain('65533')
  })
  it('PR #107: 己方开局无 HP 采样 → marker 血条 100% 阵营色（fullState），不黑条不伪造数字', async () => {
    stubRaf()
    const overview = makeOverview()
    // 己方车辆无采样无战前掉血
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = []
    overview.playback.vehicles[0].hpLosses = []
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    // 己方 marker 的 HP HUD 存在且 fullState（非 hpHidden）
    const hud = wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]')
    expect(hud.exists()).toBe(true)
    // 数字为 —（不伪造具体数字）
    expect(hud.find('[data-test="pb-hp-num"]').text()).toBe('—')
    // 血条 100% 宽（阵营色 fill；无 unknown 斜纹 class）
    const fill = hud.find('.pb-hp-fill')
    expect(fill.exists()).toBe(true)
    expect(fill.attributes('style') || '').toContain('100%')
    expect(fill.classes()).not.toContain('pb-hp-fill-unknown')
    // 己方 marker 带 friendly class（阵营色）
    expect(wrapper.find('[data-test="pb-marker-1001"]').classes()).toContain('pb-friendly')
  })

  it('PR #107: 己方有 sample 但 max 未证明 → 真实数字 + indeterminate 斜纹（非黑条）', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].baseHp = null

    overview.playback.vehicles[0].observedCapacityHp = null // 无观测容量也无 entryHp → max 未证明
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 2600 }]
    overview.playback.vehicles[0].entryHpSource = null
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    const hud = wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]')
    expect(hud.find('[data-test="pb-hp-num"]').text()).toBe('2600')
    const fill = hud.find('.pb-hp-fill')
    expect(fill.exists()).toBe(true)
    // indeterminate：100% 宽 + 斜纹（max 未知）
    expect(fill.classes()).toContain('pb-hp-fill-unknown')
    expect(fill.attributes('style') || '').toContain('100%')
  })

  it('PR #107 Blocker 1: Details Panel 当前 HP 按 provenance 显示（开局 100% / sample 后真实数字 / backward 恢复 / 敌方 — / 阵亡 0）', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.routes[0].points.unshift({ x: 0, y: 0, timeSec: 0 }) // 己方 marker 全程可见
    // 己方 vehicles[0]：首个可信 sample 出现在 10s（2500）——开局无采样
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 10, hp: 2500 }]
    overview.playback.vehicles[0].hpLosses = []
    // 敌方 vehicles[1]：无采样 → UNKNOWN
    overview.playback.vehicles[1].hpSamples = []
    const wrapper = mountPlayback(overview, 5)
    await flushPromises()
    // 开局（sample 前）选中己方 → 「100%」（开局相对满血状态的 UI 投影，非具体 HP）
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('100%')
    // 首个可信 sample 出现后 → 真实 HP 数字
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('2500')
    // backward seek 回开局 → 重新显示 100%
    await wrapper.find('.pb-range').setValue(5)
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('100%')
    // 敌方无 sample → —（UNKNOWN，不因己方 fallback 泄漏）
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('—')
    // 阵亡 → 0（权威）
    overview.playback.vehicles[1].deathSec = 12
    overview.playback.vehicles[1].hpSamples = [{ timeSec: 0, hp: 2600 }, { timeSec: 12, hp: 0 }]
    const w2 = mountPlayback(overview, 15)
    await flushPromises()
    await w2.find('[data-test="pb-marker-2001"]').trigger('click')
    expect(w2.find('[data-test="pb-info"]').find('[data-test="pb-sb-hp"]').text()).toBe('0')
  })

  it('PR #107 Blocker 2: 己方全部存活车无 sample → 底部总条 100% 阵营色实心（FULL_RELATIVE），无斜纹无黑条；seek/backward 确定性', async () => {
    stubRaf()
    const overview = makeOverview()
    // 7 辆己方（team 1）无采样无战前掉血，全部可见
    overview.playback.vehicles = Array.from({ length: 7 }, (_, i) => ({
      accountId: 1001 + i, playerName: 'F' + i, tankId: 1, tankName: 'Maus', team: 1,
      positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null, directionSamples: [],
    }))
    overview.routes = Array.from({ length: 7 }, (_, i) => ({
      accountId: 1001 + i, playerName: 'F' + i, tankId: 1, team: 1,
      points: [{ x: i * 10, y: 0, timeSec: 0 }, { x: i * 10 + 5, y: 5, timeSec: 10 }],
      firstObservedSec: 0, lastObservedSec: 10, deathSec: null,
    }))
    const wrapper = mountPlayback(overview, 5)
    await flushPromises()
    // FULL_RELATIVE：value = 100%（相对满血），不是 0；known 段 100% 宽 + 阵营色 + 无斜纹
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('100%')
    const fill = wrapper.find('[data-test="pb-hp-fill-friendly"]')
    expect(fill.exists()).toBe(true)
    expect(fill.attributes('style') || '').toContain('100%')
    expect(fill.classes()).toContain('pb-hp-friendly')
    expect(fill.classes()).not.toContain('pb-hp-partial')
    // 不渲染虚假的 0 / 0
    expect(wrapper.find('[data-test="pb-hp-bars"]').text()).not.toContain('0 / 0')
    // seek 后出现可信 sample → 状态确定性更新（PARTIAL：真实数字 + 斜纹）
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 10, hp: 2500 }]
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('2500')
    expect(wrapper.find('[data-test="pb-hp-fill-friendly"]').classes()).toContain('pb-hp-partial')
    // backward seek → 恢复 100% 实心（无斜纹）
    await wrapper.find('.pb-range').setValue(5)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-hp-value-friendly"]').text()).toBe('100%')
    expect(wrapper.find('[data-test="pb-hp-fill-friendly"]').classes()).not.toContain('pb-hp-partial')
    // 敌方无 sample 不获得 FULL_RELATIVE（UNKNOWN → —）
    const overview2 = makeOverview()
    overview2.playback.vehicles = [
      { accountId: 2001, playerName: 'E', tankId: 2, tankName: 'T49', team: 2,
        positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null, directionSamples: [] },
    ]
    overview2.routes = [{
      accountId: 2001, playerName: 'E', tankId: 2, team: 2,
      points: [{ x: 0, y: 0, timeSec: 0 }, { x: 5, y: 5, timeSec: 10 }],
      firstObservedSec: 0, lastObservedSec: 10, deathSec: null,
    }]
    const w2 = mountPlayback(overview2, 5)
    await flushPromises()
    expect(w2.find('[data-test="pb-hp-value-enemy"]').text()).toBe('—')
    expect(w2.find('[data-test="pb-hp-fill-enemy"]').attributes('style') || '').toContain('0%')
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
    overview.playback.events.push({ type: 'KILL', timeSec: 12.1, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
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
    // PR5 §8.1：再点同一点保持选中（不 toggle-off）；× 显式关闭
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


describe('PR4 §33 B3 — hysteresis 使用 UI wall clock（暂停不冻结；fade-in 完整生命周期）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** 两车同位（t=12 恒冲突）的 overview；2001 玩家名足够长。 */
  function overlapOverview() {
    const overview = makeOverview()
    overview.routes[0].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.routes[1].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.playback.vehicles[1].playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    return overview
  }

  function mountWithPlayer(overview, seekTo) {
    const w = mountPlayback(overview, seekTo)
    Object.defineProperty(w.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    return w
  }

  function playerElOf(wrapper) {
    return wrapper.find('[data-test="pb-marker-2001"]').find('.pb-label-player')
  }

  it('暂停 + zoom 产生 conflict → ~250ms 后正常 hide（不依赖播放）', async () => {
    stubRaf()
    let fakeNow = 50_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 暂停态 zoom（wheel）→ 布局变化；hysteresis 时钟必须继续（轻量 RAF）
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 未到阈值
    expect(rafCb).toBeTruthy() // 轻量 hysteresis RAF 已注册（未决 transition）
    fakeNow = 50_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 暂停态 250ms 后隐藏
    nowSpy.mockRestore()
  })

  it('暂停 + 冲突解除 → ~300ms 后正常 show（seek 不破坏 hysteresis）', async () => {
    stubRaf()
    let fakeNow = 60_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const overview = overlapOverview()
    // t≤12 同位冲突；t=13.8 两车分离（线性插值）
    overview.routes[0].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: -300, y: -260, timeSec: 14 },
    ]
    overview.routes[1].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: 300, y: 260, timeSec: 14 },
    ]
    const wrapper = mountWithPlayer(overview, 11)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 隐藏（250ms）
    fakeNow = 60_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none')
    // 冲突解除（seek 到分离位置）→ show 计时重新开始
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 未到 300ms
    fakeNow = 60_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 恢复显示
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading') // fade-in 开始
    nowSpy.mockRestore()
  })

  it('fade-in 不会在下一个 RAF 立即消失（≥PLAYER_FADE_MS 完整生命周期）', async () => {
    stubRaf()
    let fakeNow = 70_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const overview = overlapOverview()
    overview.routes[0].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: -300, y: -260, timeSec: 14 },
    ]
    overview.routes[1].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: 300, y: 260, timeSec: 14 },
    ]
    const wrapper = mountWithPlayer(overview, 11)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    const el = () => playerElOf(wrapper)
    // hide
    fakeNow = 70_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(el().attributes('style')).toContain('display: none')
    // show（解除冲突）
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    fakeNow = 70_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(el().classes()).toContain('pb-label-fading')
    // 下一 RAF（10ms 后）仍保持 fade 类（不被下一次 resolve 取消）
    fakeNow += 10
    rafCb(fakeNow)
    await flushPromises()
    expect(el().classes()).toContain('pb-label-fading')
    // 超过 PLAYER_FADE_MS → 类移除
    fakeNow += PLAYER_FADE_MS + 20
    rafCb(fakeNow)
    await flushPromises()
    expect(el().classes()).not.toContain('pb-label-fading')
    nowSpy.mockRestore()
  })

  it('播放中同样工作（frame() 驱动时钟）', async () => {
    stubRaf()
    let fakeNow = 80_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 未到阈值
    await wrapper.find('[data-test="pb-play"]').trigger('click') // 播放
    await flushPromises()
    fakeNow = 80_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow) // frame → nowMs 刷新 → resolve
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 播放中 250ms 后隐藏
    nowSpy.mockRestore()
  })

  it('Blocker1：播放中 conflict 未完成 → Pause → 轻量 clock 接管 → 到 250ms 正常 hide', async () => {
    stubRaf()
    let fakeNow = 90_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 播放（frame 驱动 nowMs）
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    expect(rafCb).toBeTruthy()
    fakeNow = 90_000 + 100 // 播放 100ms，conflict 尚未到 hide 阈值
    rafCb(fakeNow) // frame：首帧 delta 0，nowMs 刷新
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 未隐藏
    // Pause：pending hide 的 clock 必须由轻量 hysteresis RAF 接管
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 90_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow) // hystTick
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // Pause 后仍到达 250ms
    nowSpy.mockRestore()
  })

  it('Blocker1：播放中隐藏 → 冲突解除（show pending）→ Pause → 到 300ms 正常 show', async () => {
    stubRaf()
    let fakeNow = 91_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const overview = overlapOverview()
    // 前段同位冲突，后段分离：seek 到分离段解除冲突
    overview.routes[0].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: -300, y: -260, timeSec: 14 },
    ]
    overview.routes[1].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: 300, y: 260, timeSec: 14 },
    ]
    const wrapper = mountWithPlayer(overview, 11)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 播放中完成 hide
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 91_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow) // frame 首帧 delta 0
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none')
    // 冲突解除（seek 分离段）→ show pending
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 未到 300ms
    // Pause：show pending 的 clock 接管
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 91_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toBeUndefined() // 已恢复显示
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading')
    nowSpy.mockRestore()
  })

  it('Blocker1：fade-in 开始 → Pause → 120ms 后 class 正常清除', async () => {
    stubRaf()
    let fakeNow = 92_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const overview = overlapOverview()
    // 前段同位冲突，后段分离：seek 到分离段解除冲突（保持 showPlayer on，player 元素恒存在）
    overview.routes[0].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: -300, y: -260, timeSec: 14 },
    ]
    overview.routes[1].points = [
      { x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 12 },
      { x: 300, y: 260, timeSec: 14 },
    ]
    const wrapper = mountWithPlayer(overview, 11)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // 播放中 hide
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow = 92_000 + PLAYER_HIDE_MS + 50
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none')
    // 冲突解除（seek 分离段）→ show pending（播放中，frame 仍驱动时钟）
    await wrapper.find('.pb-range').setValue(13.8)
    await flushPromises()
    expect(playerElOf(wrapper).attributes('style')).toContain('display: none') // 未到 300ms
    fakeNow = 92_000 + PLAYER_HIDE_MS + 50 + PLAYER_SHOW_MS + 50
    rafCb(fakeNow) // frame：delta 300 → currentTime 14.1（分离位置，无冲突）→ show + fade 开始
    await flushPromises()
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading')
    // Pause：fade 剩余生命周期由轻量 clock 接管
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    fakeNow += 10
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).classes()).toContain('pb-label-fading') // 未到 120ms 仍保留
    fakeNow += PLAYER_FADE_MS + 20
    rafCb(fakeNow)
    await flushPromises()
    expect(playerElOf(wrapper).classes()).not.toContain('pb-label-fading')
    nowSpy.mockRestore()
  })

  it('Blocker1：无 pending 时 Pause 不启动轻量 RAF（不永久轮询）', async () => {
    stubRaf()
    let fakeNow = 93_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    let rafCount = 0
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafCount++; rafCb = cb; return rafCount })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const wrapper = mountPlayback(makeOverview(), 12) // 默认两车相距远 → 无冲突
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    const afterPlay = rafCount
    expect(afterPlay).toBeGreaterThan(0)
    // Pause：无 pending → 不新增 RAF
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    await flushPromises()
    expect(rafCount).toBe(afterPlay)
    nowSpy.mockRestore()
  })

  it('Blocker1：unmount 时正确 cancel hystRaf（不残留）', async () => {
    stubRaf()
    let fakeNow = 94_000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => fakeNow)
    const cancelled = []
    vi.stubGlobal('cancelAnimationFrame', (id) => cancelled.push(id))
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafCb = cb; return 7 })
    const wrapper = mountWithPlayer(overlapOverview(), 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    // pending hide → scheduler 已注册 hystRaf（id 7）
    expect(cancelled).not.toContain(7)
    wrapper.unmount()
    expect(cancelled).toContain(7) // hystRaf 被 cancel
    nowSpy.mockRestore()
  })
})
describe('PR4 Blocker 2 — Fullscreen（原生 API + resize 契约）', () => {
  const origReqFs = typeof Element.prototype !== 'undefined' ? Element.prototype.requestFullscreen : undefined
  const origExitFs = typeof document !== 'undefined' ? document.exitFullscreen : undefined
  const origFsElDesc = typeof document !== 'undefined' ? Object.getOwnPropertyDescriptor(document, 'fullscreenElement') : undefined

  function setFullscreen(el) {
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true, writable: true })
  }
  function resetFullscreenGlobals() {
    if (origReqFs === undefined) delete Element.prototype.requestFullscreen
    else Element.prototype.requestFullscreen = origReqFs
    if (origExitFs === undefined) delete document.exitFullscreen
    else document.exitFullscreen = origExitFs
    if (origFsElDesc) Object.defineProperty(document, 'fullscreenElement', origFsElDesc)
    else delete document.fullscreenElement
  }
  function stubFullscreenApi() {
    const reqFs = vi.fn().mockResolvedValue(undefined)
    Element.prototype.requestFullscreen = reqFs
    const exitFs = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exitFs
    return { reqFs, exitFs }
  }
  /** ResizeObserver stub：捕获回调，测试里手动触发模拟尺寸变化。 */
  function stubResizeObserver() {
    let roCb = null
    const RO = vi.fn(function (cb) { roCb = cb; this.observe = vi.fn(); this.disconnect = vi.fn() })
    vi.stubGlobal('ResizeObserver', RO)
    return () => roCb
  }

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetFullscreenGlobals()
  })

  it('1/2/3/4/5：API 可用 → 按钮可见；进入调 root.requestFullscreen；fullscreenchange 同步；退出调 exitFullscreen；ESC 外部退出恢复', async () => {
    stubRaf()
    const { reqFs, exitFs } = stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    const btn = wrapper.find('[data-test="pb-fullscreen"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('enter_fullscreen')
    // 进入：requestFullscreen 调用在 Battle Playback root 上
    await btn.trigger('click')
    expect(reqFs).toHaveBeenCalledTimes(1)
    expect(reqFs.mock.instances[0]).toBe(wrapper.find('[data-test="battle-playback"]').element)
    // fullscreenchange + fullscreenElement=root → 显示退出全屏
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').text()).toContain('exit_fullscreen')
    // 点击退出 → document.exitFullscreen
    await wrapper.find('[data-test="pb-fullscreen"]').trigger('click')
    expect(exitFs).toHaveBeenCalledTimes(1)
    // ESC/外部退出：fullscreenElement=null → 状态恢复
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').text()).toContain('enter_fullscreen')
  })

  it('6：API 不可用 → 按钮隐藏，不抛错', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-fullscreen"]').exists()).toBe(false)
  })

  it('7/8/9/10：进入/退出 fullscreen 不 reset currentTime/speed/selected/zoom/pan', async () => {
    stubRaf()
    stubFullscreenApi()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    await wrapper.find('.pb-range').setValue(12)
    await wrapper.find('[data-test="pb-speed"]').trigger('click') // 2×
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 0, clientY: 0 }) // 选中
    for (let i = 0; i < 3; i++) {
      await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 400, clientY: 300 })
    }
    await flushPromises()
    const timeBefore = wrapper.find('.pb-time').text()
    const speedBefore = wrapper.find('[data-test="pb-speed"]').text()
    const infoBefore = wrapper.find('[data-test="pb-info"]').text()
    const viewportBefore = wrapper.find('[data-test="pb-viewport"]').attributes('style')
    // 进入
    setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-speed"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
    // 退出
    setFullscreen(null)
    document.dispatchEvent(new Event('fullscreenchange'))
    await flushPromises()
    expect(wrapper.find('.pb-time').text()).toBe(timeBefore)
    expect(wrapper.find('[data-test="pb-speed"]').text()).toBe(speedBefore)
    expect(wrapper.find('[data-test="pb-info"]').text()).toBe(infoBefore)
    expect(wrapper.find('[data-test="pb-viewport"]').attributes('style')).toBe(viewportBefore)
  })

  it('11/12/13：ResizeObserver 容器宽变化 → markerScreen/labelLayout 使用新尺寸（相对距离随容器缩放）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    // markerScreen 返回容器比例坐标（×W/766）：两车 Δx=20 地图单位 → 800 宽屏幕距 ≈26.6px
    // < 标签盒 30.4px → 冲突；1600 宽屏幕距 ≈53.3px > 30.4 → 无冲突（标签屏幕恒定）
    overview.routes[0].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.routes[1].points = [{ x: -205, y: -196.7, timeSec: 10 }, { x: -205, y: -196.7, timeSec: 14 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    expect(roCb()).toBeTruthy() // RO 已挂载
    const mapEl = wrapper.find('[data-test="pb-map"]').element
    // 2001（map y=-196.7）屏幕位置更靠上 → 是"上方"标签（冲突时上移让位）
    const labelsStyle = () => wrapper.find('[data-test="pb-marker-2001"]').find('.pb-labels').attributes('style') || ''
    const dy = (s) => parseFloat(s.match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || '2')
    // 800 宽：两车屏幕距 ≈26.6px < 标签宽 30.4px → 冲突 → 上方 2001 上移
    Object.defineProperty(mapEl, 'clientWidth', { value: 800, configurable: true })
    roCb()([{ contentRect: { width: 800, height: 800 } }])
    await flushPromises()
    expect(dy(labelsStyle())).toBeLessThan(2)
    // 800 → 1600（fullscreen 容器变化）→ RO 触发 → 屏幕距翻倍（≈53px）→ 无冲突 → 基准 2px
    Object.defineProperty(mapEl, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    expect(dy(labelsStyle())).toBe(2)
  })

  it('14：Resize 后 selectAt/hitbox 使用新尺寸（同一视觉位置点击选中最近车辆）', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    overview.routes[0].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.routes[1].points = [{ x: -232.5, y: -204.2, timeSec: 10 }, { x: -232.5, y: -204.2, timeSec: 14 }]
    overview.playback.vehicles[1].positionIntervals = [{ startSec: 0, endSec: 60 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    // 1600 宽：A 中心 x=200、B 中心 x=180（generic hitbox 半宽 ≈10.4）
    // 点击 A 按钮 (185, 1350)：命中 B（最近）；若仍用 800 旧尺寸（A=100/B=90）则 185 命中不了 → 选 A
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click', { clientX: 185, clientY: 1350 })
    expect(wrapper.find('[data-test="pb-info"]').text()).toContain('EnemyA') // B = 2001 = EnemyA
  })

  it('15：fullscreen（1600）+ 1×/2× zoom → collision 使用新 viewport 继续正确', async () => {
    stubRaf()
    const roCb = stubResizeObserver()
    const overview = makeOverview()
    // 同位 → 任意尺寸/zoom 都冲突（screen 尺寸恒定）
    overview.routes[0].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.routes[1].points = [{ x: -225, y: -204.2, timeSec: 10 }, { x: -225, y: -204.2, timeSec: 14 }]
    overview.playback.vehicles[1].playerName = 'VeryLongEnemyPlayerNameCollisionTest'
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 1600, configurable: true })
    roCb()([{ contentRect: { width: 1600, height: 1600 } }])
    await flushPromises()
    await wrapper.find('[data-test="pb-show-player"]').setValue(true)
    await flushPromises()
    const labelsStyle = () => wrapper.find('[data-test="pb-marker-1001"]').find('.pb-labels').attributes('style') || ''
    expect(labelsStyle()).toContain('scale(1)') // 1× 反缩放
    // 2× zoom：wheel 锚点 = 车辆所在容器 px（(96,646)，1× 时内容 (95.75,646.2)）——
    // 避免 zoom 的 pan 把车辆移出 viewport 被裁剪（裁剪是真实机制，但本测试验证的是 zoom 后 collision）
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 96, clientY: 646 })
    await wrapper.find('[data-test="pb-map"]').trigger('wheel', { deltaY: -120, clientX: 96, clientY: 646 })
    await flushPromises()
    const style2x = labelsStyle()
    expect(style2x).toContain('scale(0.6944') // 2× 反缩放
    const dy2x = parseFloat(style2x.match(/calc\(100% \+ (-?[\d.]+)px\)/)?.[1] || '2')
    expect(dy2x).toBeLessThan(2) // 2× 下同位冲突位移仍生效（tankDy×inv < 2）
  })

  it('16：重复进入/退出 fullscreen 不累积 fullscreenchange listener；unmount 移除', async () => {
    stubRaf()
    stubFullscreenApi()
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()
    expect(addSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1)
    for (let i = 0; i < 3; i++) {
      setFullscreen(wrapper.find('[data-test="battle-playback"]').element)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
      setFullscreen(null)
      document.dispatchEvent(new Event('fullscreenchange'))
      await flushPromises()
    }
    expect(addSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1) // 未重复 add
    expect(wrapper.find('[data-test="pb-fullscreen"]').text()).toContain('enter_fullscreen')
    wrapper.unmount()
    expect(removeSpy.mock.calls.filter(([t]) => t === 'fullscreenchange').length).toBe(1)
  })
})

describe('PR5 — HP HUD / combat feedback / detail sidebar（§4–§16）', () => {
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

  it('§4/§5/§6 HP HUD：数字+bar 随 timeline 确定性重建；UNKNOWN 显示 —；destroyed 归零', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }, { timeSec: 12, hp: 2600 }]
    overview.playback.vehicles[1].baseHp = 2600

    overview.playback.vehicles[1].observedCapacityHp = 2600
    overview.playback.vehicles[1].hpSamples = [] // 敌方无采样 → UNKNOWN
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    const hud = wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]')
    expect(hud.exists()).toBe(true)
    expect(hud.find('[data-test="pb-hp-num"]').text()).toBe('2600')
    // Blocker 3：进场 max 未证明 → CURRENT_HP_EXACT_MAX_UNKNOWN：fill 100% + indeterminate 斜纹
    //（绝不按 baseHp/observedCapacityHp 算 86.6%）
    expect(hud.find('.pb-hp-fill').attributes('style')).toContain('100%')
    expect(hud.find('.pb-hp-fill').classes()).toContain('pb-hp-fill-unknown')
    const ehud = wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-hud"]')
    expect(ehud.find('[data-test="pb-hp-num"]').text()).toBe('—')
    // destroyed → 权威 0
    overview.playback.vehicles[1].deathSec = 12
    overview.playback.vehicles[1].hpSamples = [{ timeSec: 0, hp: 2600 }, { timeSec: 12, hp: 0 }]
    const w2 = mountPlayback(overview, 15)
    await flushPromises()
    expect(w2.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-num"]').text()).toBe('0')
  })

  it('§4.3 HP HUD 开关：默认开启、localStorage 持久化、关闭隐藏数字/bar/ghost', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    const toggle = wrapper.find('[data-test="pb-show-hp"]')
    expect(toggle.element.checked).toBe(true)
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(true)
    await toggle.setValue(false)
    await flushPromises()
    // 关闭后隐藏地图 HP 数字/bar/ghost，但 marker 仍在
    expect(wrapper.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(wrapper.findAll('.pb-vehicle')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('wotb.pb.hp-prefs'))).toEqual({ showHp: false })
    // 重新挂载读取持久化
    const w2 = mountPlayback(overview, 12)
    await flushPromises()
    expect(w2.find('[data-test="pb-show-hp"]').element.checked).toBe(false)
    expect(w2.find('[data-test="pb-marker-1001"]').find('[data-test="pb-hp-hud"]').exists()).toBe(false)
  })

  it('§10/§20 floating damage：播放跨过 DAMAGE 触发 -400；seek 不触发；wall-clock 到期消失', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    // EnemyA 位置流覆盖 [10,20]：事件时刻 12 覆盖 → 允许反馈
    const wrapper = mountPlayback(overview, 11)
    await flushPromises()
    // 无布局环境需提供地图宽度（floating 位置锚定 markerScreen）
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    // seek 到 12（恰好事件时刻）不触发（§20.1）
    await wrapper.find('.pb-range').setValue(12)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    // 从 11 播放跨过 12 → 触发
    await wrapper.find('.pb-range').setValue(11)
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1300
    rafCb(1300) // +1.3s → t=12.3 跨过 DAMAGE@12
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    // wall-clock 到期（>1s）消失（此时 rafCb 仍指向 wrapper 的 frame）
    clock.now = 2600
    rafCb(2600)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
    // 失察期间受击不跳伤害（事件时刻无位置流覆盖）
    const overview2 = makeOverview()
    overview2.playback.vehicles[1].positionIntervals = [{ startSec: 10, endSec: 12 }]
    overview2.playback.events.push({ type: 'DAMAGE', timeSec: 14, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 500 })
    const w2 = mountPlayback(overview2, 13)
    await flushPromises()
    Object.defineProperty(w2.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    await w2.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 1500
    rafCb(1500) // t=14.5 跨过 DAMAGE@14（失察期）
    await flushPromises()
    expect(w2.find('[data-test="pb-float-dmg"]').exists()).toBe(false)
  })

  it('§10.3/§11 HP transition：跨过 DAMAGE 产生 ghost（同阵营浅版）+ fill 立即到新值', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    overview.playback.vehicles[1].baseHp = 2600

    overview.playback.vehicles[1].observedCapacityHp = 2600
    // Blocker 3：ghost 需要 pct，而 pct 只在进场满血已证明（OBSERVED_EXACT）时存在——
    // 本测试用已证明 entryHp=2600 验证真实百分比 ghost/填充
    overview.playback.vehicles[1].entryHpSource = 'OBSERVED_EXACT'
    overview.playback.vehicles[1].entryHp = 2600
    overview.playback.vehicles[1].hpSamples = [{ timeSec: 0, hp: 2600 }, { timeSec: 12, hp: 2200 }]
    const wrapper = mountPlayback(overview, 11)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafCb(0)
    rafCb(1300) // t=12.3 跨过 DAMAGE@12
    await flushPromises()
    const marker = wrapper.find('[data-test="pb-marker-2001"]')
    expect(marker.find('.pb-hp-ghost').exists()).toBe(true)
    expect(marker.find('.pb-hp-fill').attributes('style')).toContain('84.61') // 2200/2600（已证明 entryHp）
  })

  it('§16 kill feed：只显示受害者被击毁（§15.2 无攻击者名）；最多 3 条队列', async () => {
    stubRaf()
    fakeClock()
    const overview = makeOverview()
    for (let i = 0; i < 4; i++) {
      overview.playback.events.push({ type: 'KILL', timeSec: 13 + i, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    }
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    rafCb(0)
    rafCb(5100) // t=17.1 跨过 4 条 KILL
    await flushPromises()
    expect(wrapper.findAll('.pb-feed-item')).toHaveLength(3)
    const item = wrapper.find('.pb-feed-item')
    expect(item.text()).toContain('T49') // 受害者坦克名
    expect(item.text()).toContain('recon.map.playback.feed_destroyed')
    expect(item.text()).not.toContain('You') // 不显示攻击者（§15.2）
    // seek 不补 feed
    await wrapper.find('.pb-range').setValue(10)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(false)
  })

  it('§8 detail sidebar：点击打开/切换、seek 保持选中、× 关闭、destroyed 可选', async () => {
    stubRaf()
    const overview = makeOverview()
    const v = overview.playback.vehicles[1]
    v.baseHp = 2600

    v.observedCapacityHp = 2600
    v.deathSec = 12
    v.hpSamples = [{ timeSec: 0, hp: 2600 }, { timeSec: 12, hp: 0 }]
    overview.playback.events.push({ type: 'DESTROYED', timeSec: 12, accountId: 2001, targetAccountId: null, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 15)
    await flushPromises()
    // destroyed 车仍可选中
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.exists()).toBe(true)
    expect(info.find('[data-test="pb-sb-tank"]').text()).toBe('T49')
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('0')
    expect(info.text()).toContain('00:12') // destroyed at / last spotted
    // 点击另一辆切换
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-tank"]').text()).toBe('Maus')
    // seek 保持选中
    await wrapper.find('.pb-range').setValue(20)
    await flushPromises()
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(true)
    // × 关闭
    await wrapper.find('[data-test="pb-sb-close"]').trigger('click')
    expect(wrapper.find('[data-test="pb-info"]').exists()).toBe(false)
  })

  it('Details Panel 按 tankId 懒加载 BlitzKit 车型图；缺图时静默降级', async () => {
    stubRaf()
    const wrapper = mountPlayback(makeOverview(), 12)
    await flushPromises()

    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    await flushPromises()
    expect(loadVehiclePortrait).toHaveBeenCalledWith(2)
    const portrait = wrapper.find('[data-test="pb-sb-portrait"] img')
    expect(portrait.exists()).toBe(true)
    expect(portrait.attributes('src')).toBe('/portraits/2.webp')
    expect(portrait.attributes('alt')).toBe('T49')

    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    await flushPromises()
    expect(loadVehiclePortrait).toHaveBeenCalledWith(1)
    expect(wrapper.find('[data-test="pb-sb-portrait"]').exists()).toBe(false)
  })

  it('§8.4/§8.5/§9/§18/§20 sidebar：current-state only——无最终战绩分区、无协助伤害行、无最大HP/百分比', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.vehicles[0].finalStats = {
      damageDealt: 1000, damageReceived: 540, damageAssisted: 980, kills: 2,
      nShots: 10, nHitsDealt: 7, nPenetrationsDealt: 5,
      nHitsReceived: 3, nPenetrationsReceived: 2, damageBlocked: 300
    }
    overview.playback.vehicles[0].baseHp = 3000

    overview.playback.vehicles[0].observedCapacityHp = 3000
    overview.playback.vehicles[0].hpSamples = [{ timeSec: 0, hp: 3000 }, { timeSec: 12, hp: 2600 }]
    const wrapper = mountPlayback(overview, 12)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const info = wrapper.find('[data-test="pb-info"]')
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('2600')
    // §41：tankopedia base HP 不得包装成「最大 HP」展示
    expect(info.text()).not.toContain('recon.map.playback.max_hp')
    expect(info.text()).not.toContain('recon.map.playback.hp_pct')
    // §20：assist 行删除（无逐时间点来源）
    expect(info.find('[data-test="pb-sb-assist"]').exists()).toBe(false)
    // §18/BUG-5：最终战绩分区整体删除（整场结算值不得混入 current-state 面板）
    expect(info.text()).not.toContain('recon.map.playback.final_stats')
    expect(info.text()).not.toContain('1000')
    expect(info.text()).not.toContain('980')
    expect(info.text()).not.toContain('70%')
    // 当前统计（t=12：1001 造成的 400 已发生，来自 2001 的 hpLosses attribution）
    expect(info.text()).toContain('400')
  })

  it('§12/§13 伤害记录：hpLoss 驱动；未点亮攻击者显示「来源未知」，不泄露身份', async () => {
    stubRaf()
    const overview = makeOverview()
    // 2002 攻击 1001（hpLoss 540），但 2002 无位置流覆盖 → 来源未知
    overview.playback.vehicles[0].hpLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 540, attackerAccountId: 2002, attackerReliable: true },
    ]
    const wrapper = mountPlayback(overview, 16)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    const info = wrapper.find('[data-test="pb-info"]')
    expect(info.text()).toContain('recon.map.playback.source_unknown')
    expect(info.text()).toContain('540')
    // 可见攻击者（2001 覆盖）→ 显示玩家名
    const overview2 = makeOverview()
    overview2.playback.vehicles[0].hpLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 200, attackerAccountId: 2001, attackerReliable: true },
    ]
    const w2 = mountPlayback(overview2, 16)
    await flushPromises()
    await w2.find('[data-test="pb-marker-1001"]').trigger('click')
    expect(w2.find('[data-test="pb-info"]').text()).toContain('EnemyA')
    expect(w2.find('[data-test="pb-info"]').text()).toContain('200')
  })
})

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

  function clickChip(wrapper, labelFragment) {
    const chip = wrapper.findAll('.pb-chip').find((b) => b.text().includes(labelFragment))
    if (!chip) throw new Error('chip not found: ' + labelFragment)
    return chip.trigger('click')
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

  function enemyHudNum(wrapper) {
    return wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-num"]').text()
  }

  it('B1-1 typeFilter：关闭 DAMAGE/KILL checkbox 后 deterministic stats 完全不变', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.events.push(
      { type: 'DAMAGE', timeSec: 14, accountId: 2001, targetAccountId: 1001, rawProtocolValue: 200, observedHpLoss: 200 },
      { type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null, observedHpLoss: null }
    )
    // 1001 受击 hpLoss（received）；2001 的 400（fixture dealt）保持
    overview.playback.vehicles[0].hpLosses = [
      { fromSec: 12, toSec: 14, hpLoss: 200, attackerAccountId: 2001, attackerReliable: true },
    ]
    const wrapper = mountPlayback(overview, 18)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-1001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(info.exists()).toBe(true)
    // t=18 的 current stats：dealt 400（DAMAGE@12）+ received 200（DAMAGE@14）+ kills 1（KILL@16）
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('400')
    expect(sidebarValue(info, 'recon.map.playback.damage_received')).toBe('200')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
    // 关闭 DAMAGE checkbox → presentation 变化（事件标记减少），stats 完全不变
    const markersBefore = wrapper.findAll('.pb-marker').length
    await clickChip(wrapper, 'event_DAMAGE')
    await flushPromises()
    expect(wrapper.findAll('.pb-marker').length).toBeLessThan(markersBefore)
    info = wrapper.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('400')
    expect(sidebarValue(info, 'recon.map.playback.damage_received')).toBe('200')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
    // 关闭 KILL checkbox → kills 仍不变
    await clickChip(wrapper, 'event_KILL')
    await flushPromises()
    info = wrapper.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.kills')).toBe('1')
  })

  it('B1-1 recorder/team scope：presentation scope 不截断 sidebar 当前统计（authoritative 全量）', async () => {
    stubRaf()
    // recorder scope（arenaBonusType=1 + recorderAccountId=1001）：2001→2002 双方均非 recorder
    // → presentation 过滤；但选中 2001 的 dealt 必须计入（authoritative 全量事件）
    const overview = makeOverview()
    overview.playback.events.push({ type: 'DAMAGE', timeSec: 15, accountId: 2001, targetAccountId: 2002, rawProtocolValue: 300 })
    overview.playback.vehicles[2].hpLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 300, attackerAccountId: 2001, attackerReliable: true },
    ]
    const wrapper = mountPlayback(overview, 16)
    await flushPromises()
    await wrapper.find('[data-test="pb-marker-2001"]').trigger('click')
    let info = wrapper.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
    // 该事件同时被 presentation scope 隐藏（无 15s 事件标记）——证明 stats 未被 scope 截断
    const titles = wrapper.findAll('.pb-marker').map((m) => m.attributes('title') || '')
    expect(titles.some((s) => s.includes('00:15'))).toBe(false)
    // team scope（arenaBonusType=2）：2001→2002 双方均非 friendly team → presentation 过滤，stats 仍计入
    const overview2 = makeOverview()
    overview2.arenaBonusType = 2
    overview2.playback.events.push({ type: 'DAMAGE', timeSec: 15, accountId: 2001, targetAccountId: 2002, rawProtocolValue: 300 })
    overview2.playback.vehicles[2].hpLosses = [
      { fromSec: 14, toSec: 15, hpLoss: 300, attackerAccountId: 2001, attackerReliable: true },
    ]
    const w2 = mountPlayback(overview2, 16)
    await flushPromises()
    await w2.find('[data-test="pb-marker-2001"]').trigger('click')
    info = w2.find('[data-test="pb-info"]')
    expect(sidebarValue(info, 'recon.map.playback.damage_recorded')).toBe('300')
    const titles2 = w2.findAll('.pb-marker').map((m) => m.attributes('title') || '')
    expect(titles2.some((s) => s.includes('00:15'))).toBe(false)
  })

  it('B1-1 combat feedback 不依赖列表过滤器：DAMAGE/KILL checkbox 关闭时播放跨过仍触发', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    overview.playback.events.push({ type: 'KILL', timeSec: 16, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null })
    const wrapper = mountPlayback(overview, 11)
    await flushPromises()
    Object.defineProperty(wrapper.find('[data-test="pb-map"]').element, 'clientWidth', { value: 800, configurable: true })
    // 关闭 DAMAGE 与 KILL 的事件列表 checkbox
    await clickChip(wrapper, 'event_DAMAGE')
    await clickChip(wrapper, 'event_KILL')
    await flushPromises()
    await wrapper.find('[data-test="pb-play"]').trigger('click')
    clock.now = 100
    rafCb(0)
    clock.now = 6000
    rafCb(6000) // +6s → t=17：跨过 DAMAGE@12 与 KILL@16
    await flushPromises()
    // 即使事件列表 UI 不显示，combat feedback 仍按需求触发
    expect(wrapper.find('[data-test="pb-float-dmg"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-float-dmg"]').text()).toBe('-400')
    expect(wrapper.find('[data-test="pb-kill-feed"]').exists()).toBe(true)
  })

  it('B1-2 damage log 无 future leak：只显示 <= currentTime 的事件，backward seek 后未来事件消失', async () => {
    stubRaf()
    const overview = makeOverview()
    overview.playback.durationSec = 140
    overview.playback.events = overview.playback.events.filter((e) => e.type !== 'DAMAGE')
    overview.playback.vehicles[0].positionIntervals = [{ startSec: 0, endSec: 140 }]
    overview.playback.vehicles[1].positionIntervals = [{ startSec: 0, endSec: 140 }]
    overview.routes[1].points.push({ x: -100, y: -100, timeSec: 130 })
    for (const t of [20, 60, 120]) {
      overview.playback.events.push({ type: 'DAMAGE', timeSec: t, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 300, observedHpLoss: 300 })
    }
    // 2001 的 hpLosses（1001 造成）：伤害记录与 dealt 统计的权威来源
    overview.playback.vehicles[1].hpLosses = [20, 60, 120].map((t) => ({
      fromSec: t - 1, toSec: t, hpLoss: 300, attackerAccountId: 1001, attackerReliable: true,
    }))
    const wrapper = mountPlayback(overview, 30)
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
    const enemy = overview.playback.vehicles[1]
    enemy.baseHp = 3000

    enemy.observedCapacityHp = 3000
    enemy.positionIntervals = [{ startSec: 0, endSec: 20 }, { startSec: 40, endSec: 60 }]
    enemy.hpSamples = [
      { timeSec: 10, hp: 3000 },
      { timeSec: 30, hp: 2200 },
      { timeSec: 35, hp: 1800 },
      { timeSec: 42, hp: 1700 }
    ]
    // friendly 同样处于 gap：证明 friendly 不被敌方冻结规则误伤（HP 正常更新）
    const friendly = overview.playback.vehicles[0]
    friendly.baseHp = 3000

    friendly.observedCapacityHp = 3000
    friendly.positionIntervals = [{ startSec: 0, endSec: 20 }, { startSec: 40, endSec: 60 }]
    friendly.hpSamples = [
      { timeSec: 0, hp: 3000 },
      { timeSec: 30, hp: 2200 },
      { timeSec: 42, hp: 1700 }
    ]
    const wrapper = mountPlayback(overview, 15)
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
    expect(enemyHudNum(wrapper)).toBe('1800')
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
    expect(info.find('[data-test="pb-sb-hp"]').text()).toBe('3000')
    await wrapper.find('.pb-range').setValue(35)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('3000')
    expect(wrapper.find('[data-test="pb-info"]').find('[data-test="pb-sb-hp"]').text()).toBe('3000')
    await wrapper.find('.pb-range').setValue(42)
    await flushPromises()
    expect(enemyHudNum(wrapper)).toBe('1700')
    expect(wrapper.find('[data-test="pb-info"]').find('[data-test="pb-sb-hp"]').text()).toBe('1700')
  })

  it('B2 末尾事件消费：播放跨到 duration 时 (prev, duration] 内事件 exactly-once；seek 到末尾不补播', async () => {
    stubRaf()
    const clock = fakeClock()
    const overview = makeOverview()
    overview.playback.durationSec = 20
    overview.routes[1].points.unshift({ x: -50, y: -50, timeSec: 0 })
    overview.playback.events.push(
      { type: 'DAMAGE', timeSec: 19.8, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
      { type: 'DESTROYED', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null },
      { type: 'KILL', timeSec: 20, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null }
    )
    const wrapper = mountPlayback(overview, 19)
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
    const w2 = mountPlayback(overview, 20)
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
    overview.playback.durationSec = 20
    overview.routes[1].points.unshift({ x: -50, y: -50, timeSec: 0 })
    overview.playback.events.push(
      { type: 'DAMAGE', timeSec: 19.8, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
      { type: 'DESTROYED', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null },
      { type: 'KILL', timeSec: 20, accountId: 1001, targetAccountId: 2001, rawProtocolValue: null }
    )
    const wrapper = mount(BattlePlayback, {
      props: { overview, seekTo: 19, loop: true },
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
})