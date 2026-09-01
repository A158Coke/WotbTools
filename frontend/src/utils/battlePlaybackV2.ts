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

interface VehicleInspection {
  identity: {
    accountId: number
    playerName: string
    tankId: number
    tankName: string
    tankClass: string
    team: number
    friendly: boolean
  }
  health: HealthAtResult | null
  lifeState: LifeTransition['lifeState']
  destroyedKnownAtSec: number | null
  positionCovered: boolean
  orientationKnowledge: OrientationKnowledge
  loadout: VehiclePlaybackTrack['loadout']
  loadoutKnown: boolean
}

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

  const relativeFull = track.friendly === true && openingHealthEvidence(track, t)
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
  for (const transition of track.healthTransitions || []) {
    if (transition.timeSec > t + 1e-6) break
    const currentHp = transition.currentHp
    if (currentHp == null || !Number.isFinite(currentHp)) continue
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

/** Aggregate only canonical V2 health/life/friendly/team facts. */
export function teamHealthAt(
  tracks: readonly VehiclePlaybackTrack[] | null | undefined,
  team: number | null | undefined,
  t: number,
) {
  const teamTracks = (tracks || []).filter(track => track && track.team === team)
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

/** Return decreases between canonical CURRENT samples at or before t. */
function healthDecreasesAt(track, t) {
  const losses: Array<{ fromSec: number; toSec: number; hpLoss: number }> = []
  let previousHp: number | null = null
  let previousSec: number | null = null
  for (const transition of track?.healthTransitions || []) {
    if (transition.timeSec > t + 1e-6) break
    // LAST_KNOWN repeats the last observed value across a hidden interval; it
    // is not a new current sample and must not invent a loss timestamp.
    if (transition.knowledge !== 'CURRENT') {
      if (transition.knowledge !== 'LAST_KNOWN') {
        previousHp = null
        previousSec = null
      }
      continue
    }
    const currentHp = transition.currentHp
    const trusted = currentHp != null && Number.isFinite(currentHp)
    if (!trusted) {
      previousHp = null
      previousSec = null
      continue
    }
    if (previousHp != null && previousSec != null && currentHp < previousHp) {
      losses.push({ fromSec: previousSec, toSec: transition.timeSec, hpLoss: previousHp - currentHp })
    }
    previousHp = currentHp
    previousSec = transition.timeSec
  }
  return losses
}

/** Canonical event-derived combat statistics; raw protocol damage is ignored. */
export function cumulativeStatsAtV2(
  events: readonly BattleEvent[] | null | undefined,
  selectedTrack: Pick<VehiclePlaybackTrack, 'accountId' | 'healthTransitions'> | null | undefined,
  t: number,
) {
  if (!selectedTrack || !Number.isFinite(t)) return { dealt: 0, received: 0, kills: 0 }
  const accountId = selectedTrack.accountId
  let dealt = 0
  let kills = 0
  for (const event of events || []) {
    if (!event || !Number.isFinite(event.timeSec) || event.timeSec > t + 1e-6) continue
    if (event.type === 'KILL' && event.accountId === accountId) kills += 1
    const observedHpLoss = event.observedHpLoss
    if (event.type !== 'DAMAGE' || observedHpLoss == null || !Number.isFinite(observedHpLoss)) continue
    if (event.accountId === accountId) dealt += observedHpLoss
  }
  const received = healthDecreasesAt(selectedTrack, t)
    .reduce((sum, loss) => sum + loss.hpLoss, 0)
  return { dealt, received, kills }
}

/** Canonical damage log: incoming rows come from health decreases; outgoing rows need observed attribution. */
export function damageLogAtV2(
  events: readonly BattleEvent[] | null | undefined,
  selectedTrack: Pick<VehiclePlaybackTrack, 'accountId' | 'healthTransitions'> | null | undefined,
  t: number,
  maxRows = 8,
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
  const observedEvents = (events || []).filter(event => {
    const observedHpLoss = event?.observedHpLoss
    return event && event.type === 'DAMAGE' && Number.isFinite(event.timeSec)
      && event.timeSec <= t + 1e-6 && observedHpLoss != null && Number.isFinite(observedHpLoss)
  })
  const usedAttribution = new Set<number>()
  for (const loss of healthDecreasesAt(selectedTrack, t)) {
    const candidateIndexes = observedEvents.reduce<number[]>((indexes, event, index) => {
      if (!usedAttribution.has(index)
        && event.targetAccountId === selectedAccountId
        && event.accountId != null
        && event.timeSec > loss.fromSec + 1e-6
        && event.timeSec <= loss.toSec + 1e-6) {
        indexes.push(index)
      }
      return indexes
    }, [])
    const candidateAccounts = new Set<number>()
    for (const index of candidateIndexes) {
      const accountId = observedEvents[index].accountId
      if (accountId != null) candidateAccounts.add(accountId)
    }
    const attributedTotal = candidateIndexes.reduce((sum, index) => {
      const observedHpLoss = observedEvents[index].observedHpLoss
      return observedHpLoss == null ? sum : sum + observedHpLoss
    }, 0)
    const uniquelyAttributed = candidateAccounts.size === 1
      && Math.abs(attributedTotal - loss.hpLoss) <= 1e-6
    const matchIndex = uniquelyAttributed ? candidateIndexes[0] : -1
    const match = matchIndex >= 0 ? observedEvents[matchIndex] : null
    if (uniquelyAttributed) {
      for (const index of candidateIndexes) usedAttribution.add(index)
    }
    rows.push({
      // A single attributed event has the best timestamp; an aggregate or
      // unknown loss stays at the canonical observation boundary.
      timeSec: candidateIndexes.length === 1 && uniquelyAttributed && match
        ? match.timeSec : loss.toSec,
      dir: 'in',
      hpLoss: loss.hpLoss,
      attackerAccountId: match?.accountId ?? null,
      attackerReliable: match?.accountId != null,
    })
  }
  for (const event of observedEvents) {
    if (event.accountId === selectedAccountId && event.targetAccountId != null) {
      const hpLoss = event.observedHpLoss
      if (hpLoss == null) continue
      rows.push({
        timeSec: event.timeSec,
        dir: 'out',
        hpLoss,
        victimAccountId: event.targetAccountId,
      })
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
          // DTO permits null yaw values. Number(null) intentionally preserves the
          // legacy JS coercion (null behaves as zero) while keeping arithmetic typed.
          const norm = (a: number) => ((a + 180) % 360 + 360) % 360 - 180
          const shortest = (a: number, b: number) => norm(a - b)
          const previousHull = Number(p.hullYawDeg)
          const nextHull = Number(n.hullYawDeg)
          const previousTurret = Number(p.turretRelativeYawDeg)
          const nextTurret = Number(n.turretRelativeYawDeg)
          return {
            hullYawDeg: norm(previousHull + shortest(nextHull, previousHull) * ratio),
            turretRelativeYawDeg: norm(previousTurret + shortest(nextTurret, previousTurret) * ratio),
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

/**
 * “在 t 时刻我们到底知道什么” —— Vehicle Inspector 的单一确定性视图
 * （plan §24 / §40）。返回纯事实 + knowledge/provenance，不猜测。
 */
export function inspectVehicleAt(
  track: VehiclePlaybackTrack | null | undefined,
  t: number,
): VehicleInspection | null {
  if (!track) return null
  const health = healthAt(track, t)
  const life = lifeAt(track, t)
  const loadoutKnown = Boolean(track.loadout) && track.loadout !== null
  return {
    identity: {
      accountId: track.accountId,
      playerName: track.playerName,
      tankId: track.tankId,
      tankName: track.tankName,
      tankClass: track.tankClass,
      team: track.team,
      friendly: track.friendly,
    },
    health,
    lifeState: life?.lifeState ?? 'UNKNOWN',
    destroyedKnownAtSec: life?.destroyedKnownAtSec ?? null,
    positionCovered: positionCoveredAtV2(track.positionSegments, t),
    orientationKnowledge: orientationKnownAt(track, t),
    // loadout 是持久配置：一旦 materialized combat vehicle 被观察，离开 AoI 仍 KNOWN。
    loadout: loadoutKnown ? track.loadout : null,
    loadoutKnown,
  }
}

/**
 * t 时刻 consumable runtime 状态。hidden interval（AoI 未观测）= UNKNOWN，
 * 绝不因“没看到 activation”显示 READY。返回 { logicalItemId, state, wireCode }。
 */
export function consumableRuntimeAt(
  transitions: readonly ConsumableTransition[] | null | undefined,
  t: number,
): ConsumableRuntimeResult {
  const tr = lastAtOrBefore(transitions, t)
  if (!tr) return { state: 'UNKNOWN', logicalItemId: null, wireCode: null }
  return {
    state: tr.state ?? 'UNKNOWN',
    logicalItemId: tr.logicalItemId ?? null,
    wireCode: tr.wireCode ?? null,
  }
}

/**
 * Return independent runtime state for every observed consumable wire code at t.
 * A null-wire UNKNOWN transition is an AoI invalidation and clears all known
 * per-consumable states; a wire-specific transition only updates that code.
 */
export function consumableRuntimeStatesAt(
  transitions: readonly ConsumableTransition[] | null | undefined,
  t: number,
): Map<number, ConsumableRuntimeResult> {
  const states = new Map<number, ConsumableRuntimeResult>()
  if (!Array.isArray(transitions)) return states
  for (const tr of transitions) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t) continue
    const state: ConsumableRuntimeResult = {
      state: tr.state ?? 'UNKNOWN',
      logicalItemId: tr.logicalItemId ?? null,
      wireCode: tr.wireCode ?? null,
    }
    if (state.wireCode === null && state.state === 'UNKNOWN') {
      states.clear()
    } else if (state.wireCode !== null) {
      states.set(state.wireCode, state)
    }
  }
  return states
}

/** t 时刻 module/crew 状态（recorder-visible provenance）。 */
export function moduleCrewAt(
  transitions: readonly ModuleCrewTransition[] | null | undefined,
  t: number,
): ModuleCrewResult | null {
  const tr = lastAtOrBefore(transitions, t)
  if (!tr) return null
  return {
    component: tr.component,
    state: tr.state,
    recorderVisible: tr.recorderVisible,
    confidence: tr.confidence,
  }
}
