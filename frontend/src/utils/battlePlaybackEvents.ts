
export function teamPointsAt(
  samples: Array<{ team: number; timeSec: number; points: number } | null> | null | undefined,
  team: number | null | undefined,
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
  if (eventsAscending(events)) {
    const lo = firstIndexAfterTimeSec(events, fromSec + 1e-9)
    const hi = firstIndexAfterTimeSec(events, toSec + 1e-9)
    return lo < hi ? events.slice(lo, hi) : []
  }
  return events.filter(ev =>
    Number.isFinite(ev && ev.timeSec) && ev.timeSec > fromSec + 1e-9 && ev.timeSec <= toSec + 1e-9)
}

export const FLOAT_DMG_MS = 1000
export const GHOST_MS = 600
export const FLASH_MS = 280
export const BURST_MS = 700
export const KILL_FEED_MS = 4000
const KILL_FEED_MAX = 2

export function transientsActive<T extends { bornRealMs: number; durationMs: number }>(items: T[] | null | undefined, nowRealMs: number) {
  if (!Array.isArray(items) || !Number.isFinite(nowRealMs)) return []
  return items.filter(i =>
    i && Number.isFinite(i.bornRealMs) && Number.isFinite(i.durationMs)
      && nowRealMs - i.bornRealMs < i.durationMs)
}

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

export function pushFeed<T>(items: readonly T[], entry: T) {
  return [...items, entry]
}
