import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { BURST_MS, FLOAT_DMG_MS, GHOST_MS, KILL_FEED_MS, transientsActive } from '../utils/battlePlayback.js'
import { usePlaybackTransients } from './usePlaybackTransients.js'
import type { BattleEvent, DamageLoss, PositionSegment } from '../types/playback-v2.js'
import type { TransientVehicleTrack } from './usePlaybackTransients.js'

let clockMs = 1000
const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => clockMs)

beforeEach(() => { clockMs = 1000 })
afterEach(() => { perfSpy.mockClear() })

function seg(startSec: number, endSec: number, points: Array<[number, number, number]>, knowledge = 'OBSERVED'): PositionSegment {
  return {
    startSec, endSec,
    knowledge: knowledge as PositionSegment['knowledge'],
    interpolationAllowed: true,
    samples: points.map(([timeSec, x, y]) => ({ timeSec, x, y })),
  } as PositionSegment
}

function loss(toSec: number, hpLoss = 300, extra: Partial<DamageLoss> = {}): DamageLoss {
  return {
    fromSec: toSec - 1, toSec, hpLoss,
    attackerAccountId: 1, attackerReliable: true, damageEventCount: 1,
    fromHp: 1000, toHp: 1000 - hpLoss, displayCapacityHp: 1000,
    transientAllowed: true, ...extra,
  } as DamageLoss
}

function ev(type: BattleEvent['type'], timeSec: number, accountId = 1, targetAccountId: number | null = null, observedHpLoss: number | null = null): BattleEvent {
  return { type, timeSec, accountId, targetAccountId, observedHpLoss } as BattleEvent
}

function track(accountId: number, overrides: Partial<TransientVehicleTrack> = {}): TransientVehicleTrack {
  return {
    accountId,
    playerName: 'P' + accountId,
    tankName: 'Tank' + accountId,
    tankId: 9000 + accountId,
    friendly: accountId <= 7,
    positionSegments: [seg(0, 60, [[0, 0, 0], [60, 10, 10]])],
    damageLosses: [],
    ...overrides,
  }
}

function setup(events: BattleEvent[], tracks: TransientVehicleTrack[], feedVisible?: () => boolean) {
  const nowMs = ref(1000)
  const t = usePlaybackTransients({
    nowMs,
    authoritativeEvents: () => events,
    hpVehicles: () => tracks,
    vehiclesByAccount: () => new Map(tracks.map(v => [v.accountId, v])),
    feedVisible,
  })
  return { nowMs, ...t }
}

describe('usePlaybackTransients — 事件消费 exactly-once', () => {
  it('DAMAGE 区间跨越只生成一次 floating damage（左开右闭 (fromSec, toSec]）', () => {
    const victim = track(2, { damageLosses: [loss(12), loss(13), loss(14)] })
    const t = setup([ev('KILL', 14, 1, 2)], [track(1), victim])
    t.consumeEvents(0, 12)
    expect(t.floatItems.value).toHaveLength(1)
    t.consumeEvents(12, 14)
    expect(t.floatItems.value).toHaveLength(3)
    expect(t.eventCursor.value).toBe(14)
    t.consumeEvents(0, 14)
    expect(t.floatItems.value).toHaveLength(3)
  })

  it('negative control：cursor 左界若为闭区间，重叠重放会重复消费（此断言必须失败）', () => {
    const victim = track(2, { damageLosses: [loss(12)] })
    const t = setup([], [track(1), victim])
    t.consumeEvents(0, 13)
    t.consumeEvents(0, 13)
    expect(t.floatItems.value).toHaveLength(1)
  })

  it('数值伤害唯一权威 = canonical DamageLoss；DAMAGE 通知事件只负责生命周期反馈', () => {
    const noLoss = setup([ev('DAMAGE', 12, 1, 2, 999)], [track(1), track(2)])
    noLoss.consumeEvents(0, 13)
    expect(noLoss.floatItems.value).toHaveLength(0)
    const victim = track(2, { damageLosses: [loss(12, 300)] })
    const withLoss = setup([ev('DAMAGE', 12, 1, 2, 999)], [track(1), victim])
    withLoss.consumeEvents(0, 13)
    expect(withLoss.floatItems.value).toHaveLength(1)
    expect(withLoss.floatItems.value[0].hpLoss).toBe(300)
  })

  it('不可见 AoI / 无位置覆盖 / 非法位置不产生虚假 feedback', () => {
    const aoi = track(2, { damageLosses: [loss(12, 300, { transientAllowed: false })] })
    const tAoi = setup([], [track(1), aoi])
    tAoi.consumeEvents(0, 13)
    expect(tAoi.floatItems.value).toHaveLength(0)
    expect(tAoi.ghostFor(2)).toBeNull()
    expect(tAoi.flashFor(2)).toBe(false)
    const hidden = track(3, { positionSegments: [seg(30, 60, [[30, 0, 0], [60, 10, 10]])] })
    const tHidden = setup(
      [ev('DESTROYED', 12, 3), ev('KILL', 12, 1, 3), ev('KILL', 12, 1, 9999)],
      [track(1), hidden],
    )
    tHidden.consumeEvents(0, 13)
    expect(tHidden.burstItems.value).toHaveLength(0)
    tHidden.nowMs.value = clockMs
    expect(tHidden.visibleFeed.value.map(it => it.victimAccountId)).toEqual([3])
  })

  it('ghost/flash 投影：受击后给出 HP 百分比过渡，wall-clock 过期后消失', () => {
    const victim = track(2, { damageLosses: [loss(12, 300)] })
    const t = setup([], [track(1), victim])
    t.consumeEvents(0, 13)
    expect(t.ghostFor(2)).toEqual({ prevPct: 100, nextPct: 70 })
    expect(t.flashFor(2)).toBe(true)
    clockMs += Math.max(GHOST_MS, FLOAT_DMG_MS) + 1
    t.nowMs.value = clockMs
    t.pruneTransients(clockMs)
    expect(t.ghostFor(2)).toBeNull()
    expect(t.flashFor(2)).toBe(false)
    expect(t.hasPendingTransients(clockMs)).toBe(false)
  })
})

describe('usePlaybackTransients — seek / pause / prune 生命周期', () => {
  it('seek 清空全部 transient 并重置 cursor；不补播历史效果', () => {
    const victim = track(2, { damageLosses: [loss(12)] })
    const t = setup([ev('KILL', 12, 1, 2)], [track(1), victim])
    t.consumeEvents(0, 13)
    expect(t.floatItems.value).toHaveLength(1)
    t.resetTransients(5)
    expect(t.floatItems.value).toHaveLength(0)
    expect(t.burstItems.value).toHaveLength(0)
    expect(t.feedItems.value).toHaveLength(0)
    expect(t.eventCursor.value).toBe(5)
    t.consumeEvents(0, 13)
    expect(t.floatItems.value).toHaveLength(1)
    expect(t.visibleFeed.value).toHaveLength(1)
  })

  it('pause：wall-clock 到期后 prune 清理，无 pending 即不再驱动时钟', () => {
    const victim = track(2, { damageLosses: [loss(12)] })
    const t = setup([], [track(1), victim])
    t.consumeEvents(0, 13)
    expect(t.hasPendingTransients(clockMs)).toBe(true)
    clockMs += FLOAT_DMG_MS + 1
    t.nowMs.value = clockMs
    t.pruneTransients(clockMs)
    expect(transientsActive(t.floatItems.value, clockMs)).toHaveLength(0)
    expect(t.hasPendingTransients(clockMs)).toBe(false)
  })

  it('feed queue：shownAt 从展示起点计时，展示完毕 prune 连 shownAt 一并清理', () => {
    const victim = track(2)
    const t = setup([ev('KILL', 12, 1, 2)], [track(1), victim])
    t.consumeEvents(0, 13)
    expect(t.feedItems.value).toHaveLength(1)
    t.nowMs.value = clockMs
    const shown = t.visibleFeed.value
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ victimPlayerName: 'P2', victimName: 'Tank2', durationMs: KILL_FEED_MS })
    expect(t.hasPendingTransients(clockMs)).toBe(true)
    clockMs += KILL_FEED_MS + 1
    t.nowMs.value = clockMs
    expect(t.visibleFeed.value).toHaveLength(0)
    t.pruneTransients(clockMs)
    expect(t.feedItems.value).toHaveLength(0)
    expect(t.hasPendingTransients(clockMs)).toBe(false)
  })

  it('排队 feed 未展示前 prune 不挤出；展示空位出现时按队列顺序提升', () => {
    const victims = [track(2), track(3), track(4)]
    const t = setup(
      [ev('KILL', 12, 1, 2), ev('KILL', 12.5, 1, 3), ev('KILL', 13, 1, 4)],
      [track(1), ...victims],
    )
    t.consumeEvents(0, 14)
    expect(t.feedItems.value).toHaveLength(3)
    t.nowMs.value = clockMs
    const first = t.visibleFeed.value
    expect(first.length).toBe(2)
    t.pruneTransients(clockMs)
    expect(t.feedItems.value).toHaveLength(3)
    clockMs += KILL_FEED_MS + 1
    t.nowMs.value = clockMs
    t.pruneTransients(clockMs)
    expect(t.feedItems.value.map(it => it.victimAccountId)).toEqual([4])
    expect(t.visibleFeed.value.map(it => it.victimAccountId)).toEqual([4])
  })
})

describe('usePlaybackTransients — loop 回绕与跨战局隔离', () => {
  it('loop：末尾事件只消费一次；回绕后下轮只消费新事件，不重复上一轮末尾', () => {
    const victim = track(2, { damageLosses: [loss(19.8, 400)] })
    const events = [ev('DESTROYED', 20, 2), ev('KILL', 20, 1, 2), ev('DAMAGE', 0.5, 1, 2, 100)]
    const t = setup(events, [track(1), { ...victim, damageLosses: [loss(19.8, 400), loss(0.5, 100)] }])
    t.consumeEvents(0, 20)
    const floatsAfterEnd = t.floatItems.value.length
    const feedAfterEnd = t.feedItems.value.length
    expect(floatsAfterEnd).toBe(2)
    expect(feedAfterEnd).toBe(1)
    t.eventCursor.value = 0
    t.consumeEvents(0, 1.3)
    expect(t.floatItems.value).toHaveLength(floatsAfterEnd + 1)
    expect(t.burstItems.value).toHaveLength(1)
    expect(t.feedItems.value).toHaveLength(feedAfterEnd)
    expect(t.floatItems.value.filter(it => it.hpLoss === 400)).toHaveLength(1)
  })

  it('相邻战局 / 重新初始化：新 composable 实例状态完全隔离', () => {
    const victim = track(2, { damageLosses: [loss(12)] })
    const events = [ev('DAMAGE', 12, 1, 2, 300)]
    const first = setup(events, [track(1), victim])
    first.consumeEvents(0, 13)
    expect(first.floatItems.value).toHaveLength(1)
    const second = setup(events, [track(1), victim])
    expect(second.floatItems.value).toHaveLength(0)
    expect(second.eventCursor.value).toBe(0)
    second.consumeEvents(0, 13)
    expect(second.floatItems.value).toHaveLength(1)
    expect(first.floatItems.value).toHaveLength(1)
  })

  it('feed 隐藏时排队条目不算 pending（不驱动暂停时钟）；恢复可见后重新算 pending', () => {
    const victim = track(2)
    const events = [ev('KILL', 12, 1, 2)]
    const hidden = setup(events, [track(1), victim], () => false)
    hidden.consumeEvents(0, 13)
    expect(hidden.feedItems.value).toHaveLength(1)
    hidden.nowMs.value = clockMs
    expect(hidden.hasPendingTransients(clockMs)).toBe(false)
    const shown = setup(events, [track(1), victim], () => false)
    shown.consumeEvents(0, 13)
    shown.nowMs.value = clockMs
    void shown.visibleFeed.value
    expect(shown.hasPendingTransients(clockMs)).toBe(true)
    clockMs += KILL_FEED_MS + 1
    shown.nowMs.value = clockMs
    expect(shown.hasPendingTransients(clockMs)).toBe(false)
    const visible = setup(events, [track(1), victim], () => true)
    visible.consumeEvents(0, 13)
    expect(visible.hasPendingTransients(clockMs)).toBe(true)
  })

  it('feedVisible 缺省为可见（向后兼容既有 pending 判定）', () => {
    const t = setup([ev('KILL', 12, 1, 2)], [track(1), track(2)])
    t.consumeEvents(0, 13)
    expect(t.hasPendingTransients(clockMs)).toBe(true)
  })

  it('DESTROYED burst：位置覆盖时生成，wall-clock 到期后消失', () => {
    const victim = track(2)
    const t = setup([ev('DESTROYED', 12, 2)], [track(1), victim])
    t.consumeEvents(0, 13)
    expect(t.burstItems.value).toHaveLength(1)
    expect(t.burstItems.value[0]).toMatchObject({ victimAccountId: 2, durationMs: BURST_MS })
    clockMs += BURST_MS + 1
    t.nowMs.value = clockMs
    t.pruneTransients(clockMs)
    expect(transientsActive(t.burstItems.value, clockMs)).toHaveLength(0)
    expect(t.hasPendingTransients(clockMs)).toBe(false)
  })
})
