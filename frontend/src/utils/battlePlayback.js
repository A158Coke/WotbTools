/**
 * 战局回放（Battle Playback）确定性工具：位置插值、可见性、时间解析与事件聚合。
 * 全部为纯函数，供 BattlePlayback.vue 与单测使用。
 */

/** 相邻可信位置的最大间隔（秒）；超过则断线，禁止穿线插值。 */
export const OBSERVED_GAP_SEC = 5

/**
 * 某时刻车辆位置：
 * - t 早于首点 → null（尚未观测，不显示）
 * - 落在相邻可信点之间且 gap ≤ 5s → 线性插值
 * - gap > 5s（跨越断线/失察）→ null，不穿线
 * - 晚于末点 → 返回最后已知位置（供失察淡化/阵亡标记）
 */
export function positionAt(points, t) {
  if (!points || points.length === 0 || !Number.isFinite(t)) return null
  if (t < points[0].timeSec - 1e-6) return null
  if (points.length === 1) {
    return { x: points[0].x, y: points[0].y, timeSec: t }
  }
  let prev = points[0]
  for (let i = 1; i < points.length; i++) {
    const next = points[i]
    if (t <= next.timeSec + 1e-6) {
      const gap = next.timeSec - prev.timeSec
      if (gap > OBSERVED_GAP_SEC) return null
      const ratio = gap <= 0 ? 0 : Math.min(1, Math.max(0, (t - prev.timeSec) / gap))
      return {
        x: prev.x + (next.x - prev.x) * ratio,
        y: prev.y + (next.y - prev.y) * ratio,
        timeSec: t
      }
    }
    prev = next
  }
  return { x: prev.x, y: prev.y, timeSec: prev.timeSec }
}

/** t 是否落在任一可观测区间内。 */
export function observedAt(intervals, t) {
  if (!intervals) return false
  return intervals.some(iv => t >= iv.startSec - 1e-6 && t <= iv.endSec + 1e-6)
}

/** 事件按秒聚合（进度条标记）：[{ sec, count, types }]。 */
export function aggregateEventsBySecond(events) {
  const map = new Map()
  for (const ev of events || []) {
    if (!Number.isFinite(ev.timeSec)) continue
    const sec = Math.round(ev.timeSec)
    const bucket = map.get(sec) || { sec, count: 0, types: new Set() }
    bucket.count++
    bucket.types.add(ev.type)
    map.set(sec, bucket)
  }
  return [...map.values()]
    .sort((a, b) => a.sec - b.sec)
    .map(b => ({ sec: b.sec, count: b.count, types: [...b.types] }))
}

/**
 * 识别 AI 报告中的明确时间文本 → 秒；不支持裸数字（防止 854:275 等误识别）。
 * 支持：03:20 / 3分20秒 / 3m 20s / 3 мин 20 с。
 */
export function parseAiTime(text) {
  if (text == null) return null
  const s = String(text).trim()
  let m
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) {
    return (+m[1]) * 60 + (+m[2])
  }
  if ((m = s.match(/^(\d{1,2})分(\d{1,2})秒$/))) {
    return (+m[1]) * 60 + (+m[2])
  }
  if ((m = s.match(/^(\d{1,2})m\s*(\d{1,2})s$/i))) {
    return (+m[1]) * 60 + (+m[2])
  }
  if ((m = s.match(/^(\d{1,2})\s*мин\.?\s*(\d{1,2})\s*с\.?$/i))) {
    return (+m[1]) * 60 + (+m[2])
  }
  return null
}

/** 秒 → MM:SS（播放器/进度条显示）。 */
export function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 事件是否与录像者相关（随机战默认过滤；OBSERVED/LOST 恒显示）。 */
export function recorderRelated(event, recorderAccountId) {
  if (event.type === 'OBSERVED' || event.type === 'LOST') return true
  if (recorderAccountId == null) return true
  return event.accountId === recorderAccountId || event.targetAccountId === recorderAccountId
}

/** 事件是否涉及某阵营（团队视角默认过滤）。 */
export function teamRelated(event, team, vehiclesByAccount) {
  if (event.type === 'OBSERVED' || event.type === 'LOST') return true
  const a = vehiclesByAccount.get(event.accountId)
  const b = vehiclesByAccount.get(event.targetAccountId)
  return (a && a.team === team) || (b && b.team === team)
}
