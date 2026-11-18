/** Battle Playback event crossing, score samples, and transient queues. */

/** 争霸赛实时点数：t 时刻该队最近一次 ≤t 的广播值（type-8 subtype48 field13，PROVEN）；
 * 无 → null（非争霸赛/该队暂无广播时不显示，绝不用结算值冒充实时比分）。
 */
export function teamPointsAt(
  samples: Array<{ team: number; timeSec: number; points: number } | null> | null | undefined,
  team: number,
  t: number,
) {
  if (!Array.isArray(samples) || !Number.isFinite(t)) return null
  let points: number | null = null
  for (const s of samples) {
    if (!s || s.team !== team || !Number.isFinite(s.timeSec) || !Number.isFinite(s.points)) continue
    if (s.timeSec <= t + 1e-6) points = s.points
    else break
  }
  return points
}

/**
 * 播放时钟从 fromSec 前进到 toSec 时跨过的（新消费）事件：严格 > from（事件恰在
 * cursor 上不重复触发——pause/resume 与 seek 到事件时刻都不补播），≤ to。
 * 返回事件引用数组（保持原顺序）。
 */
/** 事件数组时钟升序缓存（key = 数组身份）：升序时 (fromSec, toSec] 窗口可二分；含
 * 非 finite timeSec 视为无序，回退 filter（NaN 比较恒 false，升序判定不可信）。 */
const eventsAscendingCache = new WeakMap<object, boolean>()

function eventsAscending(events: Array<{ timeSec: number }>) {
  let ascending = eventsAscendingCache.get(events)
  if (ascending === undefined) {
    ascending = true
    for (let i = 0; i < events.length; i += 1) {
      const t = events[i] && events[i].timeSec
      if (!Number.isFinite(t)) {
        ascending = false
        break
      }
      if (i > 0 && t < events[i - 1].timeSec) {
        ascending = false
        break
      }
    }
    eventsAscendingCache.set(events, ascending)
  }
  return ascending
}

/** 升序数组中第一个 timeSec > t 的下标（严格上界，与 filter 的严格不等号逐位一致）。 */
function firstIndexAfterTimeSec(sorted: Array<{ timeSec: number }>, t: number) {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].timeSec > t) hi = mid
    else lo = mid + 1
  }
  return lo
}

export function eventsCrossed<T extends { timeSec: number }>(events: T[] | null | undefined, fromSec: number, toSec: number) {
  if (!Array.isArray(events) || !Number.isFinite(fromSec) || !Number.isFinite(toSec)) return []
  // 播放事件流按回放时钟升序时，窗口 (fromSec, toSec] 是连续区间：二分 + slice 代替
  // 每帧全量 filter（消费端 consumeEvents 在 rAF 帧内逐帧调用）。
  if (eventsAscending(events)) {
    const lo = firstIndexAfterTimeSec(events, fromSec + 1e-9)
    const hi = firstIndexAfterTimeSec(events, toSec + 1e-9)
    return lo < hi ? events.slice(lo, hi) : []
  }
  return events.filter(ev =>
    Number.isFinite(ev && ev.timeSec) && ev.timeSec > fromSec + 1e-9 && ev.timeSec <= toSec + 1e-9)
}

// ---- transient feedback（wall-clock 生命周期，任意倍速保持相近可读时长）----
/** 浮伤害数字寿命（真实 ms）。 */
export const FLOAT_DMG_MS = 1000
/** lost-HP ghost bar 消退（真实 ms）。 */
export const GHOST_MS = 600
/** HP bar 受击 flash（真实 ms）。 */
export const FLASH_MS = 280
/** 击毁 burst（真实 ms）。 */
export const BURST_MS = 700
/** Event Banner 生命周期（真实 ms，§3：Destroyed 停留约 4s）。 */
export const KILL_FEED_MS = 4000
/** Event Banner 最多同时显示 2 条；第 3 条及以后排队（activeFeed 提升展示，不 slice 挤出）。 */
const KILL_FEED_MAX = 2

/**
 * 过滤仍未过期的 transient 项：item 需携带 bornRealMs（performance.now 基准）与 durationMs。
 * 纯函数：由外层 wall-clock 驱动（播放帧 / 暂停时轻量时钟），seek 清空由调用方负责。
 */
export function transientsActive<T extends { bornRealMs: number; durationMs: number }>(items: T[] | null | undefined, nowRealMs: number) {
  if (!Array.isArray(items) || !Number.isFinite(nowRealMs)) return []
  return items.filter(i =>
    i && Number.isFinite(i.bornRealMs) && Number.isFinite(i.durationMs)
      && nowRealMs - i.bornRealMs < i.durationMs)
}

/**
 * Event Banner 真实队列：返回最多 max 条「正在展示」的条目。
 * - 展示起点由 shownAt（id → shownAtRealMs Map）记录；duration 从展示起点算。
 * - 排队条目（shownAt 为空）且有展示空位时提升为「正在展示」（此刻起算 duration）。
 * - 绝不 slice 掉尚未展示完的旧事件：第 3 条及以后等待，待到空位才展示。
 */
export function activeFeed<T extends { id: unknown; durationMs: number }>(
  items: T[] | null | undefined,
  nowRealMs: number,
  shownAt: Map<unknown, number>,
  max = KILL_FEED_MAX,
) {
  if (!Array.isArray(items) || !Number.isFinite(nowRealMs)) return []
  const shownMs = (id: unknown) => (shownAt && shownAt.get(id)) ?? null
  const visible = (it: T) => {
    const s = shownMs(it.id)
    return s != null && Number.isFinite(it.durationMs) && nowRealMs - s < it.durationMs
  }
  const active = items.filter(visible)
  let slots = Math.max(0, max - active.length)
  for (const it of items) {
    if (slots <= 0) break
    if (shownMs(it.id) == null) {
      shownAt.set(it.id, nowRealMs)
      active.push(it)
      slots--
    }
  }
  return active.slice(0, max)
}

/** Event Banner 入队：只追加（排队展示由 activeFeed 决定，不直接 slice 挤掉旧事件）。 */
export function pushFeed<T>(items: readonly T[], entry: T) {
  return [...items, entry]
}
