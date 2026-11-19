import type { AgentPlaybackFacet, AgentResultPlayer } from '../../api/agent-replay-facets.js'
import type { HealthTransition, LifeTransition } from '../../types/playback-v2.js'
import { activeEntityAt, displayCapacityAt, EPS, isCurrent, lastHpSampleAtOrBefore, type CanonicalReplayFacts, type ReplayClock } from '../canonical/facts.js'
import { isPlausibleHp } from '../canonical/hpRawState.js'

// ---------- 血量 / 生命（Java healthTransitions / lifeTransitions，事件精确时刻） ----------

/** Java `ReplayHpTimeline.settlementInitialHp`：结算剩余血量（signed field1）+ 承受伤害。 */
export function settlementInitialHp(player: AgentResultPlayer | undefined): number | null {
  if (!player) return null
  const left = typeof player.hitpoints_left === 'number' ? player.hitpoints_left : null
  const received = typeof player.damage_received === 'number' ? player.damage_received : 0
  if (left === null && received <= 0) return null
  return Math.max(left ?? 0, 0) + Math.max(received, 0)
}

/** 状态可能变化的时刻：血量采样、观测段起止、0（开战前事实并入 t=0） */
function changePoints(facts: CanonicalReplayFacts, entityIds: number[], durationSec: number): number[] {
  const set = new Set<number>([0])
  for (const id of entityIds) {
    for (const s of facts.hpSamples.get(id) ?? []) set.add(Math.max(0, s.t))
    for (const w of facts.observation.get(id) ?? []) {
      set.add(Math.max(0, w.fromSec))
      if (w.toSec !== null) set.add(Math.max(0, w.toSec))
    }
  }
  return [...set].filter((t) => t <= durationSec + EPS).sort((a, b) => a - b)
}

export function healthTransitions(
  facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number | null>, durationSec: number,
  friendly: boolean, openingSeed: number | null, respawnByEid?: Map<number, RespawnTrack>,
): HealthTransition[] {
  const out: HealthTransition[] = []
  let previous: HealthTransition | null = null
  if (openingSeed !== null && openingSeed > 0) {
    previous = {
      timeSec: 0, currentHp: openingSeed, knowledge: 'CURRENT',
      source: friendly ? 'SETTLEMENT_OPENING_HP_EXACT' : 'TANKOPEDIA_BASE_PROVISIONAL',
      displayCapacityHp: openingSeed, relativeFull: false, confidence: friendly ? 'HIGH' : 'MEDIUM',
    }
    out.push(previous)
  }
  // 复活时刻也是血量状态变化点（复活后血量未知，直到新证据到达）
  const points = new Set(changePoints(facts, entityIds, durationSec))
  for (const id of entityIds) {
    for (const r of respawnTrackOf(respawnByEid, id)?.resurrections ?? []) {
      if (r >= 0) points.add(Math.min(r, durationSec + EPS))
    }
  }
  let replayCapacity: number | null = null
  for (const t of [...points].sort((a, b) => a - b)) {
    const eid = activeEntityAt(firstSeen, t)
    if (eid === null) continue
    // 复活后尚无新血量证据：生命已回 ALIVE，但死前血量（可能是 0 / 终态哨兵镜像）**不是**当前血量。
    // 显式落"未知"边界（currentHp null；展示层渲染为「—」），新证据一到即被正常采样覆盖。
    const resurrectedAt = lastResurrectionAtOrBefore(respawnTrackOf(respawnByEid, eid), t)
    if (resurrectedAt !== null && !hasPlausibleHpBetween(facts, eid, resurrectedAt, t)) {
      const next: HealthTransition = {
        timeSec: t, currentHp: null, knowledge: 'LAST_KNOWN', source: null,
        displayCapacityHp: replayCapacity, relativeFull: false, confidence: 'UNKNOWN',
      }
      if (!sameHealth(previous, next)) {
        out.push(next)
        previous = next
      }
      continue
    }
    const sample = lastHpSampleAtOrBefore(facts, eid, t)
    // 无可信血量（未观测 / 哨兵）= 保持上一 canonical 状态；绝不回落到车辆库种子
    if (!sample || sample.hp === null) continue
    const capacity = displayCapacityAt(facts, eid, t)
    if (friendly) replayCapacity = openingSeed !== null && openingSeed > 0 ? openingSeed : capacity ?? sample.hp
    else if (capacity !== null && capacity > 0) replayCapacity = capacity
    const next: HealthTransition = {
      timeSec: t,
      currentHp: sample.hp,
      knowledge: isCurrent(facts, eid, t, sample.t) ? 'CURRENT' : 'LAST_KNOWN',
      source: sample.exact ? 'EXACT_BATTLE_EVENT' : 'INFERRED',
      displayCapacityHp: replayCapacity,
      relativeFull: false,
      confidence: sample.exact ? 'HIGH' : 'MEDIUM',
    }
    if (!sameHealth(previous, next)) {
      out.push(next)
      previous = next
    }
  }
  return out
}

function sameHealth(a: HealthTransition | null, b: HealthTransition): boolean {
  return a !== null && a.currentHp === b.currentHp && a.knowledge === b.knowledge && a.source === b.source
    && a.displayCapacityHp === b.displayCapacityHp && a.relativeFull === b.relativeFull && a.confidence === b.confidence
}

/**
 * 上游 additive 复活轨道（issue #622，2026-10-15）：eid → 战斗相对时刻的死亡/复活事件表。
 * 仅当车辆声明 ≥2 死或 ≥1 复活时才有条目；字段缺省（旧上游产物 / 普通回放）= 空表，
 * 生命投影走 prop3 采样路径，输出与既往逐位一致（golden 锁定）。
 */
export type RespawnTrack = { deaths: number[]; resurrections: number[] }

export function respawnTracks(pb: AgentPlaybackFacet, clock: ReplayClock): Map<number, RespawnTrack> {
  const out = new Map<number, RespawnTrack>()
  for (const v of pb.vehicles) {
    const declared = v.death_times ?? []
    const resurrections = v.resurrection_times ?? []
    if (declared.length <= 1 && resurrections.length === 0) continue
    const deaths = (declared.length > 0 ? declared : v.death_t != null ? [v.death_t] : [])
      .map((t) => t - clock.startRaw).sort((a, b) => a - b)
    out.set(v.eid, {
      deaths,
      resurrections: resurrections.map((t) => t - clock.startRaw).sort((a, b) => a - b),
    })
  }
  return out
}

/** 复活模式车（≥2 死或 ≥1 复活）的轨道；缺省/旧产物 = null → 走采样路径（行为与既往逐位一致）。 */
function respawnTrackOf(tracks: Map<number, RespawnTrack> | undefined, eid: number): RespawnTrack | null {
  const track = tracks?.get(eid)
  return track && (track.deaths.length > 1 || track.resurrections.length > 0) ? track : null
}

/** 最近的 ≤t 复活时刻（轨道已升序）；无 = null。 */
function lastResurrectionAtOrBefore(track: RespawnTrack | null, t: number): number | null {
  let latest: number | null = null
  for (const r of track?.resurrections ?? []) {
    if (r <= t + EPS && (latest === null || r > latest)) latest = r
  }
  return latest
}

/** 该实体在 [from, to] 窗口内是否已有**可用数值血量**证据（判定"复活后是否已有新血量"）。
 *  哨兵（`hp = null`，如 PROP3 `UNKNOWN_FFFF`）与终态 0 都不是可用血量证据——它们不提供
 *  任何可显示的现值（`isPlausibleHp`，Java `HealthChangedEvent.isPlausibleHp` 同源）。 */
function hasPlausibleHpBetween(facts: CanonicalReplayFacts, eid: number, from: number, to: number): boolean {
  for (const s of facts.hpSamples.get(eid) ?? []) {
    if (s.t >= from - EPS && s.t <= to + EPS && isPlausibleHp(s.hp)) return true
  }
  return false
}

/**
 * 复活模式账号 → DESTROYED 事件时刻列（升序去重；issue #622）。
 *
 * canonical 终态重建（`facts.destroyed`）每个账号至多一条终态，而复活模式会死多次——只发前者会让
 * 前面的死亡没有 DESTROYED 事件（2D 爆焰按事件生成，就会少爆）。上游轨道在场时它是死亡时刻
 * SSOT，故这些账号改用轨道列；返回表外的账号由调用方维持 canonical 终态。
 *
 * 同一账号可能有**多个实体**（AoI 重入 / 复活换实体），每个实体各带自己的死亡列——按账号
 * **合并**（覆盖写会丢掉前一实体的死亡，而调用方随后已抑制该账号的 canonical 回退 ⇒ 那些死亡
 * 会彻底没有事件）。
 */
export function respawnDestroyedTimes(
  facts: CanonicalReplayFacts, respawnByEid: Map<number, RespawnTrack>,
): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const [eid, track] of respawnByEid) {
    if (!respawnTrackOf(respawnByEid, eid) || track.deaths.length === 0) continue
    const accountId = facts.entities.get(eid)?.accountId
    if (accountId === undefined) continue
    const merged = out.get(accountId)
    if (merged) merged.push(...track.deaths)
    else out.set(accountId, [...track.deaths])
  }
  for (const deaths of out.values()) {
    deaths.sort((a, b) => a - b)
    let kept = 0
    for (const t of deaths) {
      if (kept > 0 && t <= deaths[kept - 1] + EPS) continue
      deaths[kept++] = t
    }
    deaths.length = kept
  }
  return out
}

/** Java frameVehicle lifeState：prop3 alive=false（终态，EXACT）→ DESTROYED；可信血量 / alive → ALIVE。
 *  上游复活轨道在场时（issue #622）它取代采样扫描成为死亡/复活时刻 SSOT：
 *  死亡 → DESTROYED、复活 → ALIVE 交替（采样只兜底 ALIVE 证据），否则行为与既往逐位一致。 */
export function lifeTransitions(
  facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number | null>, durationSec: number,
  respawnByEid?: Map<number, RespawnTrack>,
): LifeTransition[] {
  const out: LifeTransition[] = []
  let previous: LifeTransition | null = null
  const tracksOf = (eid: number): RespawnTrack | null => respawnTrackOf(respawnByEid, eid)
  const extraPoints: number[] = []
  for (const id of entityIds) {
    const track = tracksOf(id)
    if (!track) continue
    extraPoints.push(...track.deaths, ...track.resurrections)
  }
  const points = changePoints(facts, entityIds, durationSec)
  if (extraPoints.length) {
    const set = new Set(points)
    for (const t of extraPoints) if (t >= 0) set.add(Math.min(t, durationSec + EPS))
    points.length = 0
    points.push(...set)
    points.sort((a, b) => a - b)
  }
  for (const t of points) {
    const eid = activeEntityAt(firstSeen, t)
    if (eid === null) continue
    let destroyedAt: number | null = null
    let resurrected = false
    const track = tracksOf(eid)
    if (track) {
      let di = 0
      let ri = 0
      while (di < track.deaths.length || ri < track.resurrections.length) {
        const d = di < track.deaths.length ? track.deaths[di] : Infinity
        const r = ri < track.resurrections.length ? track.resurrections[ri] : Infinity
        if (d <= t && d <= r) { destroyedAt = d; di += 1 }
        else if (r <= t) { destroyedAt = null; resurrected = true; ri += 1 }
        else break
      }
    } else {
      for (const s of facts.hpSamples.get(eid) ?? []) {
        if (s.t > t) break
        if (s.kind === 'PROP3' && s.exact && s.alive === false) destroyedAt = s.t
      }
    }
    const sample = lastHpSampleAtOrBefore(facts, eid, t)
    const aliveBySample = sample != null && (sample.alive === true || (sample.hp !== null && sample.hp > 0))
    const lifeState = destroyedAt !== null ? 'DESTROYED'
      : (resurrected || aliveBySample) ? 'ALIVE' : null
    if (lifeState === null) continue
    const next: LifeTransition = { timeSec: t, lifeState, destroyedKnownAtSec: destroyedAt }
    if (!previous || previous.lifeState !== next.lifeState || previous.destroyedKnownAtSec !== next.destroyedKnownAtSec) {
      out.push(next)
      previous = next
    }
  }
  return out
}
