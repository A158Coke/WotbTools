import type { PlaybackDirection, PlaybackPosition } from '../types/playback.js'
import type {
  DamageLoss,
  OrientationKnowledge,
  OrientationSample,
  OrientationSegment,
  PositionSample,
  PositionSegment,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'

/**
 * V2 位姿 / 方向 / 观测边界的纯查询工具（自 battlePlaybackV2.ts 出仓，2026-11-21
 * 结构拆分：代码与搬移前逐字一致，公共入口仍由 battlePlaybackV2 re-export）。
 */

/** V2 feedback anchor check: the canonical position segment must cover event time. */
export function victimFeedbackAllowedV2(
  track: Pick<VehiclePlaybackTrack, 'positionSegments'> | null | undefined,
  eventTimeSec: number,
) {
  return Number.isFinite(eventTimeSec) && positionCoveredAtV2(track?.positionSegments, eventTimeSec)
}

/** Lost-HP ghost percentages from client-projected canonical facts. */
export function ghostAroundV2(
  loss: Pick<DamageLoss, 'fromHp' | 'toHp' | 'displayCapacityHp'> | null | undefined,
) {
  if (!loss || typeof loss.fromHp !== 'number' || !Number.isFinite(loss.fromHp)
    || typeof loss.toHp !== 'number' || !Number.isFinite(loss.toHp)
    || typeof loss.displayCapacityHp !== 'number' || !Number.isFinite(loss.displayCapacityHp)
    || loss.displayCapacityHp <= 0 || loss.fromHp < loss.toHp) return null
  return {
    prevPct: (loss.fromHp / loss.displayCapacityHp) * 100,
    nextPct: (loss.toHp / loss.displayCapacityHp) * 100,
  }
}

/** t 是否落在任一 OBSERVED position segment 内（AoI boundary，非 5s 规则）。 */
export function positionCoveredAtV2(
  segments: readonly PositionSegment[] | null | undefined,
  t: number,
): boolean {
  if (!Array.isArray(segments)) return false
  return segments.some(s => s.knowledge === 'OBSERVED'
    && t >= s.startSec - 1e-6 && t <= s.endSec + 1e-6)
}

/**
 * 位姿渲染的**采样时刻**（battle-relative 秒）：观测区间内 = t 本身；失察区间内 = 该时刻之前
 * 最后一个 OBSERVED 段的结束时刻（即"停在最后观测点"，**不跟随**滤波器在失察区的预测延续）。
 *
 * 2026-10-16 用户裁定：2D 图标在车辆离开视野后必须停在原地（3D 里该车模型直接不显示，两者语义
 * 一致）。从未被观测（t 之前没有 OBSERVED 段）→ null（调用方不显示该标记）。
 *
 * 只返回时刻，取值由调用方（位姿通道 / canonical 观测）决定——本函数不碰任何位姿数据。
 */
export function observedFreezeTimeAt(
  segments: readonly PositionSegment[] | null | undefined,
  t: number,
): number | null {
  if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(t)) return null
  let freeze: number | null = null
  for (const s of segments) {
    if (!s || s.knowledge !== 'OBSERVED' || !Number.isFinite(s.startSec)) continue
    if (s.startSec > t + 1e-6) break
    const end = Number.isFinite(s.endSec) ? s.endSec : s.startSec
    if (t <= end + 1e-6) return t              // 区间内：正常采样
    freeze = Math.max(freeze ?? Number.NEGATIVE_INFINITY, end)
  }
  return freeze
}

/**
 * V2 位置解析：t 落在 OBSERVED segment 内 → 段内插值（后端允许的边界内）；
 * 落在 UNKNOWN_AOI gap / 段外 → 最后已知位置（LAST_KNOWN，绝不跨 gap 插值/连真实轨迹）。
 * 语义 = canonical AoI boundary，不是 5 秒 packet-gap 规则。
 */
export function positionAtV2(
  positionSegments: readonly PositionSegment[] | null | undefined,
  t: number,
): PlaybackPosition | null {
  if (!Array.isArray(positionSegments) || positionSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen: PositionSample | null = null
  for (const seg of positionSegments) {
    // anti-future-leak：整个 segment 在 t 之后 → 对当前查询完全不可见（不得取该段任何样本）。
    if (seg.startSec > t + 1e-6) continue
    const samples = seg.samples || []
    if (samples.length === 0) continue
    if (seg.knowledge === 'OBSERVED' && seg.interpolationAllowed !== false) {
      // 段内插值
      const lo = samples[0]
      const hi = samples[samples.length - 1]
      if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
        // 命中首个样本点 / 单样本段（插值循环只处理 i>=1，需显式返回 lo）。
        if (lo.timeSec >= t - 1e-6) return { x: lo.x, y: lo.y, timeSec: lo.timeSec }
        let p = samples[0]
        for (let i = 1; i < samples.length; i++) {
          const n = samples[i]
          if (t <= n.timeSec + 1e-6) {
            if (t >= n.timeSec - 1e-6) return { x: n.x, y: n.y, timeSec: n.timeSec }
            const gap = n.timeSec - p.timeSec
            if (gap <= 0) return { x: p.x, y: p.y, timeSec: p.timeSec }
            const ratio = Math.min(1, Math.max(0, (t - p.timeSec) / gap))
            return {
              x: p.x + (n.x - p.x) * ratio,
              y: p.y + (n.y - p.y) * ratio,
              timeSec: t,
            }
          }
          p = n
        }
      }
      // 记录本段最后样本，供段外 last-known 兜底（按时间序；只接受 <= t 的样本，防未来泄漏）
      if (t > hi.timeSec + 1e-6 && hi.timeSec <= t + 1e-6
          && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) {
        lastSeen = hi
      }
    } else {
      // LAST_KNOWN 段：整段即最后已知范围，冻结在「最后一个 <= t」的样本。
      // 绝不能因为段标记为 LAST_KNOWN 就取未来样本（anti-future-leak）。
      let cand: PositionSample | null = null
      for (const s of samples) {
        if (s.timeSec <= t + 1e-6 && (cand == null || s.timeSec > cand.timeSec)) cand = s
      }
      if (cand && (lastSeen == null || cand.timeSec > lastSeen.timeSec)) lastSeen = cand
    }
  }
  return lastSeen ? { x: lastSeen.x, y: lastSeen.y, timeSec: lastSeen.timeSec } : null
}

/**
 * t 时刻方向知识（canonical projection 已切 CURRENT/LAST_KNOWN；不存在 → UNKNOWN）。
 * LAST_KNOWN 表示敌方离开 AoI，前端<b>不得</b>把它当实时炮塔方向。
 */
export function orientationKnownAt(
  track: Pick<VehiclePlaybackTrack, 'orientationSegments'> | null | undefined,
  t: number,
): OrientationKnowledge | 'UNKNOWN' {
  if (!Array.isArray(track?.orientationSegments) || track.orientationSegments.length === 0) {
    return 'UNKNOWN'
  }
  // 找到覆盖 t 的段；若 t 落在最后观测段之后 → 离开 AoI → LAST_KNOWN。
  let lastSeen: OrientationSegment | null = null
  for (const seg of track.orientationSegments) {
    if (t >= seg.startSec - 1e-6 && t <= seg.endSec + 1e-6) {
      return seg.knowledge === 'CURRENT' || seg.knowledge === 'LAST_KNOWN'
        ? seg.knowledge : 'UNKNOWN'
    }
    if (seg.startSec <= t) {
      lastSeen = seg
    }
  }
  return (lastSeen && t > lastSeen.endSec + 1e-6) ? 'LAST_KNOWN' : 'UNKNOWN'
}

/** V2 方向插值：在 orientationSegments 内按最短圆弧插值 hull/turret（CURRENT 段）；
 * LAST_KNOWN/段外 → 最后结束样本（冻结，不插值实时方向）。 */
export function orientationAtV2(
  orientationSegments: readonly OrientationSegment[] | null | undefined,
  t: number,
): PlaybackDirection | null {
  if (!Array.isArray(orientationSegments) || orientationSegments.length === 0 || !Number.isFinite(t)) return null
  let lastSeen: OrientationSample | null = null
  for (const seg of orientationSegments) {
    // anti-future-leak：整个 segment 在 t 之后 → 对当前查询完全不可见。
    if (seg.startSec > t + 1e-6) continue
    const samples = seg.samples || []
    if (samples.length === 0) continue
    const lo = samples[0]
    const hi = samples[samples.length - 1]
    if (t >= lo.timeSec - 1e-6 && t <= hi.timeSec + 1e-6) {
      if (seg.knowledge !== 'CURRENT' && seg.knowledge !== 'LAST_KNOWN') continue
      if (seg.knowledge === 'LAST_KNOWN') {
        // LAST_KNOWN 段：冻结在「最后一个 <= t」的样本（绝不返回未来方向）。
        let cand: OrientationSample | null = null
        for (const s of samples) {
          if (s.timeSec <= t + 1e-6 && (cand == null || s.timeSec > cand.timeSec)) cand = s
        }
        if (cand) {
          return { hullYawDeg: cand.hullYawDeg, turretRelativeYawDeg: cand.turretRelativeYawDeg, timeSec: cand.timeSec }
        }
      }
      // 命中首个样本点 / 单样本段
      if (lo.timeSec >= t - 1e-6) {
        return { hullYawDeg: lo.hullYawDeg, turretRelativeYawDeg: lo.turretRelativeYawDeg, timeSec: lo.timeSec }
      }
      let p = samples[0]
      for (let i = 1; i < samples.length; i++) {
        const n = samples[i]
        if (t <= n.timeSec + 1e-6) {
          if (t >= n.timeSec - 1e-6) {
            return { hullYawDeg: n.hullYawDeg, turretRelativeYawDeg: n.turretRelativeYawDeg, timeSec: n.timeSec }
          }
          const gap = n.timeSec - p.timeSec
          if (gap <= 0) return { hullYawDeg: p.hullYawDeg, turretRelativeYawDeg: p.turretRelativeYawDeg, timeSec: p.timeSec }
          const ratio = Math.min(1, Math.max(0, (t - p.timeSec) / gap))
          const norm = (a: number) => ((a + 180) % 360 + 360) % 360 - 180
          const shortest = (a: number, b: number) => norm(a - b)
          const interpolate = (previous: number | null, next: number | null) => {
            if (typeof previous !== 'number' || !Number.isFinite(previous)
              || typeof next !== 'number' || !Number.isFinite(next)) return null
            return norm(previous + shortest(next, previous) * ratio)
          }
          return {
            hullYawDeg: interpolate(p.hullYawDeg, n.hullYawDeg),
            turretRelativeYawDeg: interpolate(p.turretRelativeYawDeg, n.turretRelativeYawDeg),
            timeSec: t,
          }
        }
        p = n
      }
    }
    if (t > hi.timeSec && hi.timeSec <= t + 1e-6
        && (lastSeen == null || hi.timeSec > lastSeen.timeSec)) lastSeen = hi
  }
  return lastSeen
    ? { hullYawDeg: lastSeen.hullYawDeg, turretRelativeYawDeg: lastSeen.turretRelativeYawDeg, timeSec: lastSeen.timeSec }
    : null
}
