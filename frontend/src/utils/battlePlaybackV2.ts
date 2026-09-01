import type { PlaybackDirection, PlaybackPosition } from '../types/playback.js'
import type {
  ConsumableRuntimeResult,
  ConsumableTransition,
  BattleEvent,
  HealthAtResult,
  HealthTransition,
  LifeAtResult,
  LifeTransition,
  ModuleCrewResult,
  ModuleCrewTransition,
  OrientationKnowledge,
  OrientationSample,
  OrientationSegment,
  PositionSample,
  PositionSegment,
  VehiclePlaybackTrack,
} from '../types/playback-v2.js'

/**
 * Battle Playback V2（canonical sparse transition tracks）纯查询工具。
 *
 * 设计原则（docs/current-plan.md / plan §18/§20/§23）：
 * - 前端<b>不再</b>做 HP/AoI/death/loadout 业务推理 —— 只消费 backend 已标注的
 *   knowledge / provenance / observation boundary；
 * - {@code displayCapacityHp} 是 presentation-only HP bar 量程（anti-future-leak），
 *   不是 canonical max HP；绝不用未来采样；
 * - loadout 是持久配置（离开 AoI 仍 KNOWN）；consumable runtime 在 hidden interval = UNKNOWN。
 */

/** 二分查找：最近一次 <= t 的 transition（列表按 timeSec 升序）。无 → null。 */
function lastAtOrBefore<T extends { timeSec: number }>(
  items: readonly T[] | null | undefined,
  t: number,
): T | null {
  if (!Array.isArray(items) || items.length === 0) return null
  let lo = 0
  let hi = items.length - 1
  let ans: T | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const item = items[mid]
    if (item.timeSec <= t + 1e-6) {
      ans = item
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 最近一次 <= t 的 health transition（含 knowledge / displayCapacityHp）。 */
export function healthAt(
  track: Pick<VehiclePlaybackTrack, 'healthTransitions'> | null | undefined,
  t: number,
): HealthAtResult | null {
  const tr = lastAtOrBefore(track?.healthTransitions, t)
  if (!tr) return null
  return {
    currentHp: tr.currentHp ?? null,
    knowledge: tr.knowledge ?? 'UNKNOWN',
    source: tr.source ?? 'UNKNOWN',
    displayCapacityHp: tr.displayCapacityHp ?? null,
    confidence: tr.confidence ?? 'UNKNOWN',
  }
}

/** 最近一次 <= t 的 life transition。 */
export function lifeAt(
  track: Pick<VehiclePlaybackTrack, 'lifeTransitions'> | null | undefined,
  t: number,
): LifeAtResult | null {
  const tr = lastAtOrBefore(track?.lifeTransitions, t)
  if (!tr) return null
  return {
    lifeState: tr.lifeState ?? 'UNKNOWN',
    destroyedKnownAtSec: tr.destroyedKnownAtSec ?? null,
  }
}

/**
 * Canonical HP presentation for one track at t.
 *
 * `relativeFull` is deliberately a presentation flag: it never invents an
 * actual current/max HP pair. A concrete number is returned only when the
 * track has a <=t health fact; a missing enemy fact remains UNKNOWN.
 */
export function healthDisplayAt(
  track: Pick<VehiclePlaybackTrack, 'friendly' | 'healthTransitions' | 'lifeTransitions'> | null | undefined,
  t: number,
) {
  if (!track || !Number.isFinite(t)) return null
  const life = lifeAt(track, t)
  const health = healthAt(track, t)
  const destroyed = life?.lifeState === 'DESTROYED'
  if (destroyed) {
    const capacity = health?.displayCapacityHp ?? null
    return {
      currentHp: 0,
      displayCapacityHp: capacity,
      pct: capacity && capacity > 0 ? 0 : null,
      knowledge: 'CURRENT',
      source: 'DESTROYED',
      confidence: health?.confidence ?? 'UNKNOWN',
      destroyed: true,
      relativeFull: false,
      state: 'DESTROYED',
    }
  }

  if (health?.currentHp != null && Number.isFinite(health.currentHp)) {
    const rawCapacity = health.displayCapacityHp
    const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
      ? rawCapacity
      : null
    const pct = capacity == null ? null : Math.max(0, Math.min(100, (health.currentHp / capacity) * 100))
    const relativeFull = capacity == null && track.friendly === true
      && health.knowledge !== 'LAST_KNOWN'
      && openingHealthEvidence(track, t)
    return {
      currentHp: health.currentHp,
      displayCapacityHp: capacity,
      pct,
      knowledge: health.knowledge,
      source: health.source,
      confidence: health.confidence,
      destroyed: false,
      relativeFull,
      state: relativeFull ? 'RELATIVE_FULL' : health.knowledge,
    }
  }

  const relativeFull = track.friendly === true
    && health?.knowledge !== 'LAST_KNOWN'
    && openingHealthEvidence(track, t)
  return {
    currentHp: null,
    displayCapacityHp: null,
    pct: null,
    knowledge: health?.knowledge ?? 'UNKNOWN',
    source: health?.source ?? 'UNKNOWN',
    confidence: health?.confidence ?? 'UNKNOWN',
    destroyed: false,
    relativeFull,
    state: relativeFull ? 'RELATIVE_FULL' : 'UNKNOWN',
  }
}

/** No <=t canonical health decrease/zero/death evidence: opening relative-full. */
function openingHealthEvidence(track, t) {
  const life = lifeAt(track, t)
  if (life?.lifeState === 'DESTROYED') return false
  let previousHp: number | null = null
  let sawCurrent = false
  for (const transition of track.healthTransitions || []) {
    if (transition.timeSec > t + 1e-6) break
    if (transition.knowledge !== 'CURRENT') {
      if (sawCurrent) return false
      previousHp = null
      continue
    }
    const currentHp = transition.currentHp
    if (currentHp === null || currentHp === undefined || !Number.isFinite(currentHp)) {
      if (sawCurrent) return false
      previousHp = null
      continue
    }
    sawCurrent = true
    if (currentHp <= 0 || (previousHp != null && currentHp < previousHp)) return false
    previousHp = currentHp
  }
  return true
}

/** Canonical opening-full member: exact full HP is compatible with relative-full presentation. */
function openingFullMember(track, display, t) {
  if (!track || track.friendly !== true || !display || display.destroyed) return false
  if (display.relativeFull === true) return true
  return display.currentHp != null
    && display.displayCapacityHp != null
    && display.currentHp === display.displayCapacityHp
    && display.knowledge === 'CURRENT'
    && openingHealthEvidence(track, t)
}

/** Aggregate canonical health by the backend-resolved friendly perspective. */
export function friendlyHealthAt(
  tracks: readonly VehiclePlaybackTrack[] | null | undefined,
  friendly: boolean,
  t: number,
) {
  const perspectiveTracks = (tracks || []).filter(track => track && track.friendly === friendly)
  return aggregateHealth(perspectiveTracks, t)
}

function aggregateHealth(teamTracks, t) {
  if (teamTracks.length === 0) {
    return { totalMax: 0, knownRemaining: 0, unknownMax: 0, spawnFullCount: 0, openingFullCount: 0, state: 'UNKNOWN' }
  }

  const displays = teamTracks.map(track => healthDisplayAt(track, t))
  const exact = displays.every(display => display
    && display.currentHp != null
    && display.displayCapacityHp != null
    && display.displayCapacityHp > 0
    && (display.knowledge === 'CURRENT' || display.destroyed))
  const allOpeningFull = teamTracks.every((track, index) =>
    openingFullMember(track, displays[index], t))
  const knownRemaining = displays.reduce((sum, display) =>
    sum + (display?.currentHp != null && Number.isFinite(display.currentHp) ? display.currentHp : 0), 0)
  const totalMax = exact
    ? displays.reduce((sum, display) => sum + (display?.displayCapacityHp || 0), 0)
    : 0
  const hasKnownEvidence = displays.some(display => display && (
    display.currentHp != null || display.destroyed || display.knowledge === 'LAST_KNOWN'))
  let state = 'UNKNOWN'
  if (exact) {
    state = 'EXACT'
  } else if (allOpeningFull) {
    state = 'FULL_RELATIVE'
  } else if (hasKnownEvidence) {
    state = 'PARTIAL'
  }
  const relativeCount = displays.filter(display => display?.relativeFull === true).length
  return {
    totalMax,
    knownRemaining,
    unknownMax: 0,
    spawnFullCount: relativeCount,
    openingFullCount: relativeCount,
    state,
  }
}

/** Canonical combat statistics; all damage numbers come from backend DamageLoss facts. */
export function cumulativeStatsAtV2(
  events: readonly BattleEvent[] | null | undefined,
  selectedTrack: Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'> | null | undefined,
  t: number,
  tracks: readonly Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'>[] | null | undefined = [],
) {
  if (!selectedTrack || !Number.isFinite(t)) return { dealt: 0, received: 0, kills: 0 }
  const accountId = selectedTrack.accountId
  const received = (selectedTrack.damageLosses || [])
    .filter(loss => loss && loss.toSec <= t + 1e-6)
    .reduce((sum, loss) => sum + (Number.isFinite(loss.hpLoss) ? loss.hpLoss : 0), 0)
  const dealt = (tracks || [])
    .flatMap(track => track?.damageLosses || [])
    .filter(loss => loss && loss.toSec <= t + 1e-6
      && loss.attackerReliable === true && loss.attackerAccountId === accountId)
    .reduce((sum, loss) => sum + (Number.isFinite(loss.hpLoss) ? loss.hpLoss : 0), 0)
  let kills = 0
  for (const event of events || []) {
    if (!event || !Number.isFinite(event.timeSec) || event.timeSec > t + 1e-6) continue
    if (event.type === 'KILL' && event.accountId === accountId) kills += 1
  }
  return { dealt, received, kills }
}

/** Canonical damage log: incoming/outgoing rows are direct projections of DamageLoss facts. */
export function damageLogAtV2(
  events: readonly BattleEvent[] | null | undefined,
  selectedTrack: Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'> | null | undefined,
  t: number,
  maxRows = 8,
  tracks: readonly Pick<VehiclePlaybackTrack, 'accountId' | 'damageLosses'>[] | null | undefined = [],
) {
  if (!selectedTrack || !Number.isFinite(t)) return []
  const selectedAccountId = selectedTrack.accountId
  const rows: Array<{
    timeSec: number
    dir: 'in' | 'out'
    hpLoss: number
    attackerAccountId?: number | null
    attackerReliable?: boolean
    victimAccountId?: number
  }> = []
  for (const loss of selectedTrack.damageLosses || []) {
    if (!loss || loss.toSec > t + 1e-6) continue
    rows.push({
      timeSec: loss.toSec,
      dir: 'in',
      hpLoss: loss.hpLoss,
      attackerAccountId: loss.attackerAccountId ?? null,
      attackerReliable: loss.attackerReliable === true,
    })
  }
  for (const track of tracks || []) {
    for (const loss of track?.damageLosses || []) {
      if (!loss || loss.toSec > t + 1e-6 || loss.attackerReliable !== true
          || loss.attackerAccountId !== selectedAccountId || track.accountId === selectedAccountId) continue
      rows.push({ timeSec: loss.toSec, dir: 'out', hpLoss: loss.hpLoss, victimAccountId: track.accountId })
    }
  }
  rows.sort((a, b) => a.timeSec - b.timeSec)
  const limit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 8
  return rows.slice(-limit)
}

/** V2 feedback anchor check: the canonical position segment must cover event time. */
export function victimFeedbackAllowedV2(
  track: Pick<VehiclePlaybackTrack, 'positionSegments'> | null | undefined,
  eventTimeSec: number,
) {
  return Number.isFinite(eventTimeSec) && positionCoveredAtV2(track?.positionSegments, eventTimeSec)
}

/** Lost-HP ghost derived from adjacent canonical health transitions. */
export function ghostAroundV2(
  track: Pick<VehiclePlaybackTrack, 'healthTransitions'> | null | undefined,
  t: number,
) {
  if (!track || !Number.isFinite(t) || !Array.isArray(track.healthTransitions)) return null
  let previous: HealthTransition | null = null
  for (const transition of track.healthTransitions) {
    if (transition.timeSec > t + 1e-6) break
    const capacity = previous?.displayCapacityHp
    if (Math.abs(transition.timeSec - t) <= 1e-6
      && previous && previous.currentHp != null && transition.currentHp != null
      && transition.currentHp < previous.currentHp
      && typeof capacity === 'number' && Number.isFinite(capacity)
      && capacity > 0) {
      return {
        prevPct: (previous.currentHp / capacity) * 100,
        nextPct: (transition.currentHp / capacity) * 100,
      }
    }
    previous = transition
  }
  return null
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
      // 绝不能因为段标记为 LAST_KNOWN 就取未来样本（future leak，plan §17）。
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
 * t 时刻方向知识（backend 已切 CURRENT/LAST_KNOWN；不存在 → UNKNOWN）。
 * LAST_KNOWN 表示敌方离开 AoI，前端<b>不得</b>把它当实时炮塔方向。
 */
export function orientationKnownAt(
  track: Pick<VehiclePlaybackTrack, 'orientationSegments'> | null | undefined,
  t: number,
): OrientationKnowledge {
  if (!Array.isArray(track?.orientationSegments) || track.orientationSegments.length === 0) {
    return 'UNKNOWN'
  }
  // 找到覆盖 t 的段；若 t 落在最后观测段之后 → 离开 AoI → LAST_KNOWN。
  let lastSeen: OrientationSegment | null = null
  for (const seg of track.orientationSegments) {
    if (t >= seg.startSec - 1e-6 && t <= seg.endSec + 1e-6) {
      return seg.knowledge ?? 'UNKNOWN'
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
      if (seg.knowledge !== 'CURRENT') {
        // LAST_KNOWN 段：冻结在「最后一个 <= t」的样本（绝不返回未来方向，plan §18）。
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

/** Current runtime state keyed by canonical consumable slot, not array position or wire code. */
export function consumableRuntimeSlotsAt(
  transitions: readonly ConsumableTransition[] | null | undefined,
  t: number,
): Map<number, ConsumableRuntimeResult> {
  const states = new Map<number, ConsumableRuntimeResult>()
  for (const tr of transitions || []) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (tr.consumableSlot === null || tr.consumableSlot === undefined) {
      if (tr.state === 'UNKNOWN') states.clear()
      continue
    }
    states.set(tr.consumableSlot, {
      state: tr.state ?? 'UNKNOWN',
      logicalItemId: tr.logicalItemId ?? null,
      wireCode: tr.wireCode ?? null,
    })
  }
  return states
}

/** Current recorder-visible state per module/crew component. */
export function moduleCrewStatesAt(
  transitions: readonly ModuleCrewTransition[] | null | undefined,
  t: number,
): ModuleCrewResult[] {
  if (!Array.isArray(transitions)) return []
  const byComponent = new Map<string, ModuleCrewResult>()
  for (const tr of transitions) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (tr.recorderVisible !== true || !tr.component) continue
    byComponent.set(tr.component, {
      component: tr.component,
      state: tr.state ?? 'UNKNOWN',
      recorderVisible: true,
      confidence: tr.confidence ?? 'UNKNOWN',
    })
  }
  return [...byComponent.values()].sort((a, b) => a.component.localeCompare(b.component))
}
