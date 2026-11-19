import type { AgentAiReviewFacet, AgentBattleResult } from '../../api/agent-replay-facets.js'
import type { HpRawState } from './hpRawState.js'

export const EPS = 1e-6

export interface ReplayClock {
  /** 战斗开始的原始时钟（period 3 = BATTLE；或 AFTERBATTLE − 结算时长的反推） */
  startRaw: number
  durationSec: number
  /** 无 period 3 广播、按结算时长反推（Java `BattleTimelineClock.ESTIMATED`） */
  estimated: boolean
}

export interface PeriodPoint { clock: number; period: number }

// ---------- 事实类型 ----------

/** 可用身份（结算实际参战者；Java `TeamEntityIdentity.usable()`） */
export interface CanonicalEntity {
  entityId: number
  accountId: number
  /** 结算花名册的队伍（权威） */
  team: 1 | 2
  nickname: string
  tankId: number
  recorder: boolean
}

/** AoI 观测段 [fromSec, toSec)；toSec = null = 战斗结束仍在观测 */
export interface ObservationWindow {
  entityId: number
  fromSec: number
  toSec: number | null
  /** 开段物化快照的可信血量（0 < hp < 0xFF00；哨兵/缺失 = null） */
  materializationHp: number | null
  order: number
}

export type HpSampleKind = 'PROP3' | 'MATERIALIZATION'

/** 血量帧采样（Java `EntityIndex.HpSample`）：hp = null 表示该刻血量未知（哨兵），不是 0 */
export interface HpSample {
  t: number
  entityId: number
  hp: number | null
  kind: HpSampleKind
  rawState: HpRawState | null
  alive: boolean | null
  exact: boolean
  order: number
}

/** method1 血量 / 来源 / 原因事件（Java `VehicleHealthStateEvent`） */
export interface HealthEvent {
  t: number
  entityId: number
  hpRaw: number
  rawState: HpRawState
  sourceEntityId: number
  causeFlag: number
  order: number
}

export type DamageNoticeKind = 'HIT' | 'UNDECODED_VARIANT' | 'SHORT_VARIANT'

/** method8 伤害/命中反馈（Java `parseDamage`：HIT = VehicleHitEvent，其余 = UnsupportedDamageEvent） */
export interface DamageNotice {
  t: number
  kind: DamageNoticeKind
  envelopeEntityId: number
  attackerEntityId: number
  victimEntityId: number
  primaryResult: number | null
  secondaryResult: number | null
  order: number
}

/** 原始世界位姿观测（battle-relative，时钟升序；Java `EntityIndex.PosSample`） */
export interface PoseTrack {
  entityId: number
  t: number[]
  x: number[]
  y: number[]
  z: number[]
  /** 车体偏航 rad */
  yaw: number[]
}

/** 原始炮塔观测（battle-relative；relYawDeg = prop2 高 10 位 coarse 解码，Java `TurretDirectionChangedEvent`） */
export interface TurretTrack {
  entityId: number
  t: number[]
  relYawDeg: number[]
}

export interface CombatLoss {
  fromSec: number
  toSec: number
  hpLoss: number
  /** 唯一可证明的攻击者（attackerReliable 时才有值） */
  attackerAccountId: number | null
  attackerReliable: boolean
  /** 窗口内直击证据条数（0 = 无归属证据；≥1 且不可靠 = 证据冲突） */
  damageEventCount: number
  fromHp: number
  toHp: number
}

/** 终态证据种类：`DEATH_SENTINEL` = 负 i16 终态哨兵族（0xFFFF/0xFFFE/0xFFFD 及同编码其它负值，
 *  上游 `hp_state === 'terminal'`；2026-10-16 前只覆盖 0xFFFD，见 hpRawState.ts 历史注）。 */
export type TerminalKind = 'HP_ZERO' | 'DEATH_SENTINEL' | 'DROWNING' | 'LEGACY_EXACT_ALIVE_FALSE'

export interface TerminalEvidence {
  accountId: number
  entityId: number
  timeSec: number
  order: number
  terminal: boolean
  kind: TerminalKind | null
}

export interface DestroyedFact {
  timeSec: number
  accountId: number
  killerAccountId: number | null
  kind: TerminalKind
}

export interface CanonicalReplayFacts {
  clock: ReplayClock
  /** AFTERBATTLE（period 4）battle-relative 时刻；未观测 = null */
  battleEndSec: number | null
  /** 流末（最后数据时刻）battle-relative；未知 = null */
  streamEndSec: number | null
  /**
   * 回放在战斗结束前截断：既无 AFTERBATTLE，流末又早于 durationSec 超过一个覆盖空洞（2 s，
   * 与上游 coverage 断开阈值同一口径）——之后的事件缺失，证据不完整。
   */
  streamTruncated: boolean
  winnerTeam: 1 | 2 | null
  recorderAccountId: number | null
  /** 录像者队伍（结算权威）；无法解析 = null，**绝不缺省成某一队** */
  perspectiveTeam: 1 | 2 | null
  recorderEntityIds: number[]
  entities: Map<number, CanonicalEntity>
  entityIdsByAccount: Map<number, number[]>
  /** 战斗车辆实体（Type5 entityTypeId=2 物化证据，录像者 Avatar 实体除外；method8 只对这些实体解码） */
  vehicleEntityIds: Set<number>
  observation: Map<number, ObservationWindow[]>
  poses: Map<number, PoseTrack>
  turrets: Map<number, TurretTrack>
  hpSamples: Map<number, HpSample[]>
  healthEvents: HealthEvent[]
  damageNotices: DamageNotice[]
  lossesByVictim: Map<number, CombatLoss[]>
  /** Avatar prop10 is recorder-only cumulative damage evidence, separate from victim attribution. */
  recorderDamageDealt: Array<{ timeSec: number; total: number }>
  destroyed: DestroyedFact[]
  /** Java `TeamEntityMapper` limitations（进 2D / AI capability） */
  mappingLimitations: string[]
  /** Java `TeamPerspectiveResolver` limitations（AI 视角） */
  perspectiveLimitations: string[]
}

export interface CanonicalInput {
  result?: AgentBattleResult | null
  aiReview: AgentAiReviewFacet
  /** 流末原始时钟（时长兜底；PlaybackData.meta.duration） */
  streamEndRaw?: number | null
}

// ---------- 查询（与 Java 同一边界语义） ----------

/** Java `ReplayAoiLifecycle.segmentAt`：[observedFrom, absentFrom) 半开区间 */
export function observationAt(facts: CanonicalReplayFacts, entityId: number, t: number): ObservationWindow | null {
  for (const w of facts.observation.get(entityId) ?? []) {
    if (!Number.isFinite(t) || t < w.fromSec - 1e-9) continue
    if (w.toSec === null || t < w.toSec - 1e-9) return w
  }
  return null
}

/** Java `EntityIndex.lastHealthAtOrBefore` */
export function lastHpSampleAtOrBefore(facts: CanonicalReplayFacts, entityId: number, t: number): HpSample | null {
  let hit: HpSample | null = null
  for (const s of facts.hpSamples.get(entityId) ?? []) {
    if (s.t > t) break
    hit = s
  }
  return hit
}

/** Java `EntityIndex.displayCapacityHpAt`：截至 t 的可信 currentHp 最大值（仅 HP bar 量程，不是 max HP 事实） */
export function displayCapacityAt(facts: CanonicalReplayFacts, entityId: number, t: number): number | null {
  let max = 0
  for (const s of facts.hpSamples.get(entityId) ?? []) {
    if (s.t > t + 1e-9) break
    if (s.hp !== null && s.hp > max) max = s.hp
  }
  return max > 0 ? max : null
}

/** Java `EntityIndex.lastPositionAtOrBefore`：≤ t 的最后一个原始观测下标；无 → -1 */
export function lastPoseIndexAtOrBefore(track: { t: number[] } | undefined, t: number): number {
  if (!track) return -1
  let lo = 0, hi = track.t.length - 1, hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (track.t[mid] <= t) { hit = mid; lo = mid + 1 } else hi = mid - 1
  }
  return hit
}

/**
 * prop2 u16 → 炮塔相对偏航（度）：`u16 · 360 / 65536 − 180`——WotbTools 已证明的 canonical 编码
 * （`docs/research/replay/turret-direction.md`）。上游把低 6 位解释为
 * 俯仰比例、只取高 10 位；两者相差 ≤ 0.35°，canonical 保持旧口径不静默改变。
 */
export function prop2RelYawDeg(raw: number): number {
  return ((raw & 0xffff) * 360) / 65536 - 180
}

/** Canonical first identity evidence, in battle-relative seconds; unknown starts remain explicit. */
export function entityFirstSeenByAccount(facts: CanonicalReplayFacts): Map<number, Map<number, number | null>> {
  return new Map([...facts.entityIdsByAccount].map(([accountId, ids]) => [accountId, new Map(ids.map(id => {
    const starts = [facts.poses.get(id)?.t[0], facts.hpSamples.get(id)?.[0]?.t, facts.observation.get(id)?.[0]?.fromSec]
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    return [id, starts.length ? Math.min(...starts) : null]
  }))]))
}

/** Most recently entered entity at t; numeric IDs never determine order. Ties/missing evidence stay unknown. */
export function activeEntityAt(firstSeen: ReadonlyMap<number, number | null>, t: number): number | null {
  if (!Number.isFinite(t)) return null
  let latest = -Infinity
  for (const first of firstSeen.values()) {
    if (first === null || !Number.isFinite(first)) return null
    if (first <= t + EPS) latest = Math.max(latest, first)
  }
  let owner: number | null = null
  for (const [id, first] of firstSeen) {
    if (first !== null && first <= t + EPS && Math.abs(first - latest) <= EPS) {
      if (owner !== null) return null
      owner = id
    }
  }
  return owner
}

/** Java frameVehicle：观测段内且位置来自本段 → CURRENT，否则 LAST_KNOWN */
export function isCurrent(facts: CanonicalReplayFacts, entityId: number, t: number, observedAt: number): boolean {
  const w = observationAt(facts, entityId, t)
  return w !== null && observedAt >= w.fromSec - 1e-9
}
