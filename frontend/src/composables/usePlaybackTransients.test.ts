import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { BURST_MS, FLOAT_DMG_MS, GHOST_MS, KILL_FEED_MS, transientsActive } from '../utils/battlePlayback.js'
import { usePlaybackTransients } from './usePlaybackTransients.js'
import type { BattleEvent, DamageLoss, PositionSegment } from '../types/playback-v2.js'
import type { TransientVehicleTrack } from './usePlaybackTransients.js'

// 真实时钟替换：composable 的 bornRealMs 取 performance.now（真实 wall clock owner），
// 测试用可控时钟驱动消费/过期转换（不 mock 内部逻辑，只替换时间事实源）。
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

/** 真实 composable 状态机：驱动 consume/reset/prune/visibleFeed 的真实转换。 */
function setup(events: BattleEvent[], tracks: TransientVehicleTrack[]) {
  const nowMs = ref(1000)
  const t = usePlaybackTransients({
    nowMs,
    authoritativeEvents: () => events,
    hpVehicles: () => tracks,
    vehiclesByAccount: () => new Map(tracks.map(v => [v.accountId, v])),
  })
  return { nowMs, ...t }
}

describe('usePlaybackTransients — 事件消费 exactly-once', () => {
  it('DAMAGE 区间跨越只生成一次 floating damage（左开右闭 (fromSec, toSec]）', () => {
    const victim = track(2, { damageLosses: [loss(12), loss(13), loss(14)] })
    const t = setup([ev('KILL', 14, 1, 2)], [track(1), victim])
    t.consumeEvents(0, 12)
    expect(t.floatItems.value).toHaveLength(1)
    // resume 帧（如 seek 精确落在事件时刻后播放）：cursor=12 恰在 loss@12 上——
    // 左开语义下不重复；(12,14] 内新事件（loss@13/14 + KILL@14）正常消费。
    t.consumeEvents(12, 14)
    expect(t.floatItems.value).toHaveLength(3)
    expect(t.eventCursor.value).toBe(14)
    // 同一 cursor 重放重叠区间（含事件所在点）不得生成第二条
    t.consumeEvents(0, 14)
    expect(t.floatItems.value).toHaveLength(3)
  })

  it('negative control：cursor 左界若为闭区间，重叠重放会重复消费（此断言必须失败）', () => {
    const victim = track(2, { damageLosses: [loss(12)] })
    const t = setup([], [track(1), victim])
    t.consumeEvents(0, 13)
    t.consumeEvents(0, 13) // 闭区间实现会在此重复生成 → 本测试用例失败
    expect(t.floatItems.value).toHaveLength(1)
  })

  it('数值伤害唯一权威 = canonical DamageLoss；DAMAGE 通知事件只负责生命周期反馈', () => {
    // 有 DAMAGE 通知但无 canonical damageLosses → 不生成任何数值 float
    const noLoss = setup([ev('DAMAGE', 12, 1, 2, 999)], [track(1), track(2)])
    noLoss.consumeEvents(0, 13)
    expect(noLoss.floatItems.value).toHaveLength(0)
    // 补上 canonical loss：float 数值取 loss.hpLoss（300），不取通知事件的 observedHpLoss（999）
    const victim = track(2, { damageLosses: [loss(12, 300)] })
    const withLoss = setup([ev('DAMAGE', 12, 1, 2, 999)], [track(1), victim])
    withLoss.consumeEvents(0, 13)
    expect(withLoss.floatItems.value).toHaveLength(1)
    expect(withLoss.floatItems.value[0].hpLoss).toBe(300)
  })

  it('不可见 AoI / 无位置覆盖 / 非法位置不产生虚假 feedback', () => {
    // transientAllowed=false（AoI 不可见伤害）→ 无 float/ghost/flash
    const aoi = track(2, { damageLosses: [loss(12, 300, { transientAllowed: false })] })
    const tAoi = setup([], [track(1), aoi])
    tAoi.consumeEvents(0, 13)
    expect(tAoi.floatItems.value).toHaveLength(0)
    expect(tAoi.ghostFor(2)).toBeNull()
    expect(tAoi.flashFor(2)).toBe(false)
    // 受击方在事件时刻无位置覆盖 → DESTROYED 无 burst；未知账号 → 无 feed
    const hidden = track(3, { positionSegments: [seg(30, 60, [[30, 0, 0], [60, 10, 10]])] })
    const tHidden = setup(
      [ev('DESTROYED', 12, 3), ev('KILL', 12, 1, 3), ev('KILL', 12, 1, 9999)],
      [track(1), hidden],
    )
    tHidden.consumeEvents(0, 13)
    expect(tHidden.burstItems.value).toHaveLength(0)
    // kill feed 是身份驱动（受害者 identity 存在即入队，无位置门槛——与 baseline 一致）：
    // 未知账号 9999 被跳过，位置不覆盖的 3 仍按 canonical identity 入队
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
    // negative control：seek 若不清空，这里必然失败
    expect(t.floatItems.value).toHaveLength(0)
    expect(t.burstItems.value).toHaveLength(0)
    expect(t.feedItems.value).toHaveLength(0)
    expect(t.eventCursor.value).toBe(5)
    // seek 后新时间线：只消费 (5, 13]，历史 (0,5] 不补播
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
    // baseline 语义：过期 float/burst 留在队列中由 transientsActive 显示过滤，不再视为 pending
    expect(transientsActive(t.floatItems.value, clockMs)).toHaveLength(0)
    expect(t.hasPendingTransients(clockMs)).toBe(false)
  })

  it('feed queue：shownAt 从展示起点计时，展示完毕 prune 连 shownAt 一并清理', () => {
    const victim = track(2)
    const t = setup([ev('KILL', 12, 1, 2)], [track(1), victim])
    t.consumeEvents(0, 13)
    expect(t.feedItems.value).toHaveLength(1)
    // 首次读取 visibleFeed → 排队条目提升为展示中（shownAt 记录此刻）
    t.nowMs.value = clockMs
    const shown = t.visibleFeed.value
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ victimPlayerName: 'P2', victimName: 'Tank2', durationMs: KILL_FEED_MS })
    expect(t.hasPendingTransients(clockMs)).toBe(true)
    // 展示完毕（> 4s）：可见队列清空，prune 移除条目与 shownAt 记录
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
    // KILL_FEED_MAX（默认 2）slots：前两条立即展示，第 3 条排队（shownAt 空 → prune 保留）
    const first = t.visibleFeed.value
    expect(first.length).toBe(2)
    t.pruneTransients(clockMs)
    expect(t.feedItems.value).toHaveLength(3)
    // 第一条展示完毕 → 空位出现，第 3 条按队列顺序提升
    clockMs += KILL_FEED_MS + 1
    t.nowMs.value = clockMs
    t.pruneTransients(clockMs)
    // 展示完毕的 [2,3] 连同 shownAt 一并移除；从未展示的 4 保留
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
    // 回绕：只重置 cursor，不清 transient（「末尾消费一次」继续自然完成）
    t.eventCursor.value = 0
    t.consumeEvents(0, 1.3) // 下一轮前段：只消费 DAMAGE@0.5（新事件）
    expect(t.floatItems.value).toHaveLength(floatsAfterEnd + 1)
    expect(t.burstItems.value).toHaveLength(1) // DESTROYED@20 不重复
    expect(t.feedItems.value).toHaveLength(feedAfterEnd) // KILL@20 不重复
    expect(t.floatItems.value.filter(it => it.hpLoss === 400)).toHaveLength(1)
  })

  it('相邻战局 / 重新初始化：新 composable 实例状态完全隔离', () => {
    const victim = track(2, { damageLosses: [loss(12)] })
    const events = [ev('DAMAGE', 12, 1, 2, 300)]
    const first = setup(events, [track(1), victim])
    first.consumeEvents(0, 13)
    expect(first.floatItems.value).toHaveLength(1)
    // 新战局：全新实例（cursor 归零、队列为空），同一 dataset 重放从零开始
    const second = setup(events, [track(1), victim])
    expect(second.floatItems.value).toHaveLength(0)
    expect(second.eventCursor.value).toBe(0)
    second.consumeEvents(0, 13)
    expect(second.floatItems.value).toHaveLength(1)
    expect(first.floatItems.value).toHaveLength(1) // 首个实例不受影响
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
