/**
 * WotbTools canonical replay facts（`replay-local/canonical`）+ 上游 PlaybackData 位姿网格 →
 * 2D 战局回放消费的 `BattlePlaybackDataset`（`contracts/http/openapi.yaml`）。
 *
 * 纯投影，语义逐条对应已退役 Java `BattlePlaybackProjector` / `BattleTimelineBuilder.frameVehicle`：
 *  - 位置 / 朝向：t 处于 AoI 观测段 [observedFrom, absentFrom) 且位置样本来自本段 → OBSERVED/CURRENT；
 *    否则沿用最后一次位置 → LAST_KNOWN（不插值、不前进）；从未有位置 → 无样本；
 *  - 血量：canonical 血量采样（prop3 + 每次物化快照）；哨兵 = 血量未知，不改写为 0、不产生迁移；
 *    友方开局 = 结算血量（HIGH），敌方开局 = 车辆库血量（MEDIUM、临时），首个回放血量后永久回放权威；
 *  - 掉血 / 归属 / 击杀者：canonical combat（method8 直击 = 证据，其它变体 = 冲突，fail-closed）；
 *  - 生命：prop3 alive=false（终态）→ DESTROYED；可信血量 / alive → ALIVE；
 *  - limitations：映射 / 时钟 / 车辆轨迹缺失 + 视角未解析 / 回放在战斗结束前截断（缺证据即 PARTIAL）。
 *
 * 与 Java 的已知口径差异（`playback.golden.test.ts` 逐项固定，`docs/features/battle-playback.md` 记录）：
 *  - Java 帧是 1 Hz 整秒；这里位姿按 battle-relative `sampleStepSec` 对齐采样（默认 0.5 s，含整秒与
 *    durationSec 终点），血量 / 生命迁移用事件精确时刻（Java 量化到下一整秒帧）；
 *  - 位置来自上游渲染滤波网格（0.1 s），Java 取整秒前最后一个原始位置包。
 */

import type {
  AgentAiReviewFacet,
  AgentBattleResult,
  AgentPlaybackFacet,
  AgentResultPlayer,
  AgentVehicleTrack,
} from '../../api/agent-replay-facets.js'
import type {
  BaseStateTransition,
  BattleEvent,
  BattlePlaybackDataset,
  ConsumableTransition,
  DamageLoss,
  HealthTransition,
  LifeTransition,
  ModuleCrewTransition,
  OrientationSample,
  OrientationSegment,
  PlaybackConfidence,
  PointsSample,
  PositionSample,
  PositionSegment,
  VehicleBattleLoadout,
  VehiclePlaybackTrack,
} from '../../types/playback-v2.js'
import {
  buildCanonicalReplayFacts,
  displayCapacityAt,
  EPS,
  lastHpSampleAtOrBefore,
  lastPoseIndexAtOrBefore,
  observationAt,
  resolveReplayClock,
  type CanonicalReplayFacts,
  type ReplayClock,
} from '../canonical/facts.js'
import type { Tankopedia } from '../compute/tankopedia.js'
import { consumableItemId, consumableStateName, provisionItemId } from './itemCodes.js'

export interface ToDatasetOptions {
  /** 车辆库（车名/车种/等级/敌方开局血量）；缺省时车名回退结算名、车种「未知」、等级 null、敌方无开局种子 */
  tankopedia?: Tankopedia | null
  /** 位姿采样间隔（秒，battle-relative 对齐；默认 0.5，须整除 1 才含全部整秒帧） */
  sampleStepSec?: number
}

/** 2D 投影新增的显式降级（Java 当年静默）：见 `docs/features/battle-playback.md` */
export const PERSPECTIVE_TEAM_UNRESOLVED = 'PERSPECTIVE_TEAM_UNRESOLVED'
export const REPLAY_STREAM_TRUNCATED = 'REPLAY_STREAM_TRUNCATED'

const BASE_IDS = ['A', 'B', 'C', 'D'] as const

// ---------- 时间轴（兼容出口：时钟规则在 canonical 层） ----------

export type PlaybackClock = ReplayClock

export function resolvePlaybackClock(pb: AgentPlaybackFacet, result?: AgentBattleResult | null): PlaybackClock | null {
  return resolveReplayClock(pb.periods, result, pb.meta.duration)
}

// ---------- 采样 ----------

function normDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180
  if (Object.is(d, -0)) d = 0
  return d
}

const RAD2DEG = 180 / Math.PI

/** battle-relative 对齐的采样时刻：k·step（k = 0..⌊duration/step⌋）+ durationSec 终点 */
function sampleTimes(durationSec: number, stepSec: number): number[] {
  const out: number[] = []
  const n = Math.floor(durationSec / stepSec + EPS)
  for (let k = 0; k <= n; k++) out.push(Number((k * stepSec).toFixed(6)))
  if (durationSec - out[out.length - 1] > EPS) out.push(durationSec)
  return out
}

interface PoseSample {
  t: number
  /** 位置观测时刻（battle-relative；原始 type=10 包） */
  observedAt: number
  x: number
  y: number
  hull: number | null
  turretRel: number | null
}

/**
 * 单个实体的位姿采样（Java `lastPositionAtOrBefore` / `lastTurretAtOrBefore`）：位置事实 = 上游原始
 * type=10 世界位姿观测（不是渲染滤波网格——AoI 重入后网格有收敛滞后），采样值取 ≤ t 的最后一个观测；
 * 从未有位置 → 无样本。车体偏航取同一位姿包，炮塔相对偏航取 ≤ t 的最后一个 prop2。
 */
function poseSamplesOf(facts: CanonicalReplayFacts, entityId: number, times: number[]): PoseSample[] {
  const pose = facts.poses.get(entityId)
  const turret = facts.turrets.get(entityId)
  const out: PoseSample[] = []
  for (const t of times) {
    const i = lastPoseIndexAtOrBefore(pose, t)
    if (i < 0 || !pose) continue
    const x = pose.x[i], z = pose.z[i]
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    const hull = Number.isFinite(pose.yaw[i]) ? normDeg(pose.yaw[i] * RAD2DEG) : null
    const ti = lastPoseIndexAtOrBefore(turret, t)
    out.push({
      t, observedAt: pose.t[i], x, y: z, hull,
      turretRel: hull !== null && ti >= 0 && turret ? normDeg(turret.relYawDeg[ti]) : null,
    })
  }
  return out
}

/** Java frameVehicle：观测段内且位置来自本段 → CURRENT，否则 LAST_KNOWN */
function isCurrent(facts: CanonicalReplayFacts, entityId: number, t: number, observedAt: number): boolean {
  const w = observationAt(facts, entityId, t)
  return w !== null && observedAt >= w.fromSec - 1e-9
}

function positionSegments(facts: CanonicalReplayFacts, entityId: number, samples: PoseSample[]): PositionSegment[] {
  const out: PositionSegment[] = []
  let cur: PositionSample[] = []
  let knowledge: 'OBSERVED' | 'LAST_KNOWN' | null = null
  const flush = () => {
    if (cur.length === 0 || knowledge === null) return
    out.push({ startSec: cur[0].timeSec, endSec: cur[cur.length - 1].timeSec, knowledge, interpolationAllowed: knowledge === 'OBSERVED', samples: cur })
  }
  for (const s of samples) {
    const next = isCurrent(facts, entityId, s.t, s.observedAt) ? 'OBSERVED' : 'LAST_KNOWN'
    if (knowledge !== null && knowledge !== next) {
      flush()
      cur = []
    }
    knowledge = next
    cur.push({ timeSec: s.t, x: s.x, y: s.y })
  }
  flush()
  return out
}

function orientationSegments(facts: CanonicalReplayFacts, entityId: number, samples: PoseSample[]): OrientationSegment[] {
  const out: OrientationSegment[] = []
  let cur: OrientationSample[] = []
  let knowledge: 'CURRENT' | 'LAST_KNOWN' | null = null
  const flush = () => {
    if (cur.length === 0 || knowledge === null) return
    out.push({ startSec: cur[0].timeSec, endSec: cur[cur.length - 1].timeSec, knowledge, samples: cur })
  }
  for (const s of samples) {
    if (s.hull === null) {
      flush()
      cur = []
      knowledge = null
      continue
    }
    const next = isCurrent(facts, entityId, s.t, s.observedAt) ? 'CURRENT' : 'LAST_KNOWN'
    if (knowledge !== null && knowledge !== next) {
      flush()
      cur = []
    }
    knowledge = next
    cur.push({ timeSec: s.t, hullYawDeg: s.hull, turretRelativeYawDeg: s.turretRel })
  }
  flush()
  return out
}

// ---------- 血量 / 生命（Java healthTransitions / lifeTransitions，事件精确时刻） ----------

/** Java `ReplayHpTimeline.settlementInitialHp`：结算剩余血量（signed field1）+ 承受伤害。 */
export function settlementInitialHp(player: AgentResultPlayer | undefined): number | null {
  if (!player) return null
  const left = typeof player.hitpoints_left === 'number' ? player.hitpoints_left : null
  const received = typeof player.damage_received === 'number' ? player.damage_received : 0
  if (left === null && received <= 0) return null
  return Math.max(left ?? 0, 0) + Math.max(received, 0)
}

/** 账号在 t 的活动实体（Java `vehicleInAny`：首个已出现的实体） */
function activeEntityAt(facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number>, t: number): number | null {
  for (const id of entityIds) {
    const first = firstSeen.get(id)
    if (first !== undefined && first <= t + 1e-9) return id
  }
  return null
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

function healthTransitions(
  facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number>, durationSec: number,
  friendly: boolean, openingSeed: number | null,
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
  let replayCapacity: number | null = null
  for (const t of changePoints(facts, entityIds, durationSec)) {
    const eid = activeEntityAt(facts, entityIds, firstSeen, t)
    if (eid === null) continue
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

/** Java frameVehicle lifeState：prop3 alive=false（终态，EXACT）→ DESTROYED；可信血量 / alive → ALIVE */
function lifeTransitions(
  facts: CanonicalReplayFacts, entityIds: number[], firstSeen: Map<number, number>, durationSec: number,
): LifeTransition[] {
  const out: LifeTransition[] = []
  let previous: LifeTransition | null = null
  for (const t of changePoints(facts, entityIds, durationSec)) {
    const eid = activeEntityAt(facts, entityIds, firstSeen, t)
    if (eid === null) continue
    let destroyedAt: number | null = null
    for (const s of facts.hpSamples.get(eid) ?? []) {
      if (s.t > t) break
      if (s.kind === 'PROP3' && s.exact && s.alive === false) destroyedAt = s.t
    }
    const sample = lastHpSampleAtOrBefore(facts, eid, t)
    const lifeState = destroyedAt !== null ? 'DESTROYED'
      : sample && (sample.alive === true || (sample.hp !== null && sample.hp > 0)) ? 'ALIVE' : null
    if (lifeState === null) continue
    const next: LifeTransition = { timeSec: t, lifeState, destroyedKnownAtSec: destroyedAt }
    if (!previous || previous.lifeState !== next.lifeState || previous.destroyedKnownAtSec !== next.destroyedKnownAtSec) {
      out.push(next)
      previous = next
    }
  }
  return out
}

// ---------- 装载 / 消耗品 / 模块 ----------

function toLoadout(vehicles: AgentVehicleTrack[], replayVersion: string | null): VehicleBattleLoadout | null {
  const v = vehicles.find((x) => Array.isArray(x.loadout_items) && x.loadout_items.length === 6
    && Array.isArray(x.equipment) && x.equipment.length === 9)
  if (!v) return null
  const items = v.loadout_items!
  let unknown = false
  const consumables: Array<string | null> = []
  const consumableWireCodes: Array<number | null> = []
  const provisions: Array<string | null> = []
  const provisionWireCodes: Array<number | null> = []
  items.forEach((item, i) => {
    const wire = item[0] ?? 0
    const id = i < 3 ? consumableItemId(wire) : provisionItemId(wire)
    if (id === null && wire !== 0) unknown = true
    if (i < 3) { consumables.push(id); consumableWireCodes.push(wire) } else { provisions.push(id); provisionWireCodes.push(wire) }
  })
  return {
    replayVersion,
    consumables,
    consumableWireCodes,
    provisions,
    provisionWireCodes,
    equipmentIds: v.equipment!.map((e) => e),
    confidence: unknown ? 'LOW' : 'HIGH',
  }
}

/** Java `BattlePlaybackProjector.consumableSlot`：wireCode 在装载里唯一命中的槽位。 */
function consumableSlot(loadout: VehicleBattleLoadout | null, wire: number | null): number | null {
  if (!loadout || wire === null) return null
  let match: number | null = null
  for (let i = 0; i < loadout.consumableWireCodes.length; i++) {
    if (loadout.consumableWireCodes[i] === wire) {
      if (match !== null) return null
      match = i
    }
  }
  return match
}

/** Java `BattlePlaybackProjector.consumableTransitions`（开战前 INITIALIZED 种子 + AoI 关闭失效）。 */
function consumableTransitions(
  pb: AgentPlaybackFacet, facts: CanonicalReplayFacts, entityIds: number[], clock: ReplayClock, loadout: VehicleBattleLoadout | null,
): ConsumableTransition[] {
  const eids = new Set(entityIds)
  const obs = (pb.consumables ?? [])
    .filter((c) => eids.has(c.eid))
    .map((c) => {
      const logicalItemId = consumableItemId(c.wire_code)
      const state = consumableStateName(c.state)
      const proven = logicalItemId !== null && state !== 'UNKNOWN'
      return { t: c.clock - clock.startRaw, eid: c.eid, wire: c.wire_code, logicalItemId, state, confidence: (proven ? 'HIGH' : 'LOW') as PlaybackConfidence }
    })
    .sort((a, b) => a.t - b.t || a.eid - b.eid)
  const out: ConsumableTransition[] = []
  const seeds = new Map<string, typeof obs[number]>()
  for (const o of obs) {
    if (o.t < 0 && o.state === 'INITIALIZED') {
      const key = `${o.eid}:${o.wire}`
      const prev = seeds.get(key)
      if (!prev || o.t >= prev.t) seeds.set(key, o)
      continue
    }
    if (!Number.isFinite(o.t) || o.t < 0) continue
    const invalidation = o.state === 'UNKNOWN'
    out.push({
      timeSec: o.t,
      consumableSlot: invalidation ? null : consumableSlot(loadout, o.wire),
      logicalItemId: invalidation ? null : o.logicalItemId,
      wireCode: invalidation ? null : o.wire,
      state: o.state,
      invalidation,
      confidence: o.confidence,
    })
  }
  for (const o of seeds.values()) {
    out.push({
      timeSec: 0, consumableSlot: consumableSlot(loadout, o.wire), logicalItemId: o.logicalItemId,
      wireCode: o.wire, state: 'INITIALIZED', invalidation: false, confidence: o.confidence,
    })
  }
  for (const id of entityIds) {
    for (const w of facts.observation.get(id) ?? []) {
      const absent = w.toSec
      if (absent === null || !Number.isFinite(absent) || absent < 0) continue
      const hadKnownBefore = obs.some((o) => o.t < absent - EPS && (o.logicalItemId !== null || o.state !== 'UNKNOWN'))
      if (hadKnownBefore) {
        out.push({ timeSec: absent, consumableSlot: null, logicalItemId: null, wireCode: null, state: 'UNKNOWN', invalidation: true, confidence: 'UNKNOWN' })
      }
    }
  }
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.timeSec - b.t.timeSec || (a.t.wireCode ?? -1) - (b.t.wireCode ?? -1) || a.i - b.i)
    .map(({ t }) => t)
}

const MODULE_COMPONENTS = new Set([
  'ENGINE', 'AMMO_RACK', 'FUEL_TANK', 'RIGHT_TRACK', 'LEFT_TRACK', 'GUN', 'TURRET_ROTATOR',
  'OBSERVATION_DEVICE', 'COMMANDER', 'DRIVER', 'GUNNER', 'LOADER', 'RADIOMAN', 'RADIO',
])

/** Java `BattlePlaybackProjector.moduleCrewTransitions`：仅录像者车辆（recorder-visible）。 */
function moduleCrewTransitions(
  pb: AgentPlaybackFacet, entityIds: number[], clock: ReplayClock, recorderVisible: boolean,
): ModuleCrewTransition[] {
  if (!recorderVisible) return []
  const eids = new Set(entityIds)
  const out: ModuleCrewTransition[] = []
  for (const m of pb.module_crew_states ?? []) {
    if (!eids.has(m.vehicle_eid)) continue
    const t = m.clock - clock.startRaw
    if (!Number.isFinite(t) || t < 0) continue
    const component = String(m.component ?? '').toUpperCase()
    if (!MODULE_COMPONENTS.has(component)) continue
    let state: string | null
    switch (String(m.state ?? '').toUpperCase()) {
      case 'FULL_REPAIRED_CLEAR':
      case 'CREW_HEALED': state = null; break
      case 'AUTO_REPAIRED_TO_DAMAGED': state = 'DAMAGED_DEGRADED'; break
      case 'DAMAGED_DEGRADED': state = 'DAMAGED_DEGRADED'; break
      case 'CRITICAL_DISABLED': state = 'CRITICAL_DISABLED'; break
      case 'CREW_SHELL_SHOCKED': state = 'CREW_SHELL_SHOCKED'; break
      default: continue
    }
    out.push({ timeSec: t, component, state, recorderVisible: true, confidence: 'HIGH' })
  }
  return out.sort((a, b) => a.timeSec - b.timeSec)
}

// ---------- 主投影 ----------

const UNKNOWN_TANK_NAME = '未知坦克'
const UNKNOWN_TANK_CLASS = '未知'

function validTankName(name: unknown): name is string {
  if (typeof name !== 'string' || name.trim() === '') return false
  return !['#', '?', 'vehicle_', 'tankId='].some((p) => name.startsWith(p))
}

/**
 * 投影入口：上游三切面（结算 / 时序 / AI 事件）→ canonical facts → dataset。
 * 时间轴不可用（无 period 3 且无法由结算反推）或无任何可映射参战实体 → null（与 Java 204 同义）。
 */
export function toBattlePlaybackDataset(
  pb: AgentPlaybackFacet,
  result: AgentBattleResult | null | undefined,
  aiReview: AgentAiReviewFacet,
  options: ToDatasetOptions = {},
): BattlePlaybackDataset | null {
  const facts = buildCanonicalReplayFacts({
    result, aiReview, streamEndRaw: pb.meta.duration,
  })
  if (!facts) return null
  const { clock } = facts
  const tankopedia = options.tankopedia ?? null
  const times = sampleTimes(clock.durationSec, options.sampleStepSec ?? 0.5)
  const recorderAccountId = facts.recorderAccountId
  const friendlyTeam = facts.perspectiveTeam

  const vehicleByEid = new Map(pb.vehicles.map((v) => [v.eid, v]))
  const settlementPlayers = new Map<number, AgentResultPlayer>()
  for (const p of result?.players ?? []) if (p.account_id > 0) settlementPlayers.set(p.account_id, p)

  const tracks: VehiclePlaybackTrack[] = []
  for (const player of settlementPlayers.values()) {
    if (!(player.team > 0)) continue
    const entityIds = facts.entityIdsByAccount.get(player.account_id) ?? []
    if (entityIds.length === 0) continue
    const vehicles = entityIds.map((id) => vehicleByEid.get(id)).filter((v): v is AgentVehicleTrack => !!v)
    const tankId = player.tank_id > 0 ? player.tank_id : vehicles[0]?.tank_id ?? 0
    const friendly = friendlyTeam === null ? null : player.team === friendlyTeam

    // 每实体独立分段（Java 按 entityId 逐个投影后按起点合并）
    const firstSeen = new Map<number, number>()
    const posSegs: PositionSegment[] = []
    const oriSegs: OrientationSegment[] = []
    for (const id of entityIds) {
      const poses = poseSamplesOf(facts, id, times)
      posSegs.push(...positionSegments(facts, id, poses))
      oriSegs.push(...orientationSegments(facts, id, poses))
      const firsts = [poses[0]?.observedAt, facts.hpSamples.get(id)?.[0]?.t, facts.observation.get(id)?.[0]?.fromSec]
        .filter((x): x is number => typeof x === 'number')
      if (firsts.length) firstSeen.set(id, Math.min(...firsts))
    }
    posSegs.sort((a, b) => a.startSec - b.startSec)
    oriSegs.sort((a, b) => a.startSec - b.startSec)

    const info = tankopedia && tankId > 0 ? tankopedia.info(tankId) : null
    const openingSeed = friendly === true
      ? settlementInitialHp(player)
      : (info?.maxHp != null && info.maxHp > 0 ? info.maxHp : null)
    const health = healthTransitions(facts, entityIds, firstSeen, clock.durationSec, friendly === true, openingSeed)
    const losses = facts.lossesByVictim.get(player.account_id) ?? []
    const loadout = toLoadout(vehicles, result?.client_version ?? null)
    tracks.push({
      accountId: player.account_id,
      playerName: player.nickname || vehicles[0]?.nickname || '',
      tankId,
      tankName: validTankName(info?.name) ? info!.name : validTankName(player.tank_name) ? player.tank_name
        : validTankName(vehicles[0]?.tank_name) ? vehicles[0].tank_name : UNKNOWN_TANK_NAME,
      tankClass: info?.type ? info.type : UNKNOWN_TANK_CLASS,
      tankTier: typeof info?.tier === 'number' ? info.tier : null,
      team: player.team,
      friendly,
      loadout,
      positionSegments: posSegs,
      orientationSegments: oriSegs,
      healthTransitions: health,
      lifeTransitions: lifeTransitions(facts, entityIds, firstSeen, clock.durationSec),
      damageLosses: losses.map((l): DamageLoss => ({
        ...l,
        displayCapacityHp: lossCapacity(facts, entityIds, l.toSec),
        transientAllowed: posSegs.some((s) => s.knowledge === 'OBSERVED' && s.startSec <= l.toSec + EPS && s.endSec >= l.toSec - EPS),
      })),
      ...(player.account_id === recorderAccountId && facts.recorderDamageDealt.length
        ? { damageDealtSamples: facts.recorderDamageDealt.map(sample => ({ ...sample })) } : {}),
      consumableTransitions: consumableTransitions(pb, facts, entityIds, clock, loadout),
      moduleCrewTransitions: moduleCrewTransitions(pb, entityIds, clock, recorderAccountId !== null && player.account_id === recorderAccountId),
    })
  }
  if (tracks.length === 0) return null
  tracks.sort((a, b) => a.accountId - b.accountId)

  const events: BattleEvent[] = []
  // DAMAGE：method8 直击（Java VehicleHitEvent），受击方须可映射；攻击者未映射 = null（未知，不猜）
  for (const n of facts.damageNotices) {
    if (n.kind !== 'HIT' || !(n.t >= 0)) continue
    const victim = facts.entities.get(n.victimEntityId)?.accountId
    if (victim === undefined) continue
    const attacker = n.attackerEntityId > 0 ? facts.entities.get(n.attackerEntityId)?.accountId ?? null : null
    const loss = (facts.lossesByVictim.get(victim) ?? []).find((x) => x.damageEventCount === 1 && x.attackerReliable
      && n.t > x.fromSec + EPS && n.t <= x.toSec + EPS)
    events.push({ type: 'DAMAGE', timeSec: n.t, accountId: attacker, targetAccountId: victim, observedHpLoss: loss ? loss.hpLoss : null })
  }
  // DESTROYED / KILL：canonical 终态 + 致死窗口唯一攻击者（fail-closed：证据冲突 → 无击杀者）
  for (const d of facts.destroyed) {
    if (!(d.timeSec >= 0)) continue
    events.push({ type: 'DESTROYED', timeSec: d.timeSec, accountId: d.accountId, targetAccountId: null, observedHpLoss: null })
    if (d.killerAccountId !== null && d.killerAccountId !== d.accountId) {
      events.push({ type: 'KILL', timeSec: d.timeSec, accountId: d.killerAccountId, targetAccountId: d.accountId, observedHpLoss: null })
    }
  }
  // POSITION_*：OBSERVED 段起止；录像者自身不广播
  for (const track of tracks) {
    if (recorderAccountId !== null && track.accountId === recorderAccountId) continue
    for (const seg of track.positionSegments) {
      if (seg.knowledge !== 'OBSERVED') continue
      const end = Math.min(clock.durationSec, seg.endSec)
      if (seg.startSec < 0 || end < seg.startSec) continue
      events.push({ type: 'POSITION_REPORTED', timeSec: seg.startSec, accountId: track.accountId, targetAccountId: null, observedHpLoss: null })
      events.push({ type: 'POSITION_STALE', timeSec: end, accountId: track.accountId, targetAccountId: null, observedHpLoss: null })
    }
  }
  events.sort((a, b) => a.timeSec - b.timeSec)

  // limitations：Java 顺序（映射 → 时钟 → 轨迹缺失），再追加 2D 新增的显式降级
  const limitations = new Set<string>(facts.mappingLimitations)
  if (clock.estimated) limitations.add('CLOCK_ESTIMATED')
  const combatants = new Set([...settlementPlayers.values()].filter((p) => p.team > 0).map((p) => p.account_id))
  if (combatants.size > new Set(tracks.map((t) => t.accountId)).size) limitations.add('PLAYBACK_COMBATANT_TRACK_INCOMPLETE')
  if (friendlyTeam === null) limitations.add(PERSPECTIVE_TEAM_UNRESOLVED)
  if (facts.streamTruncated) limitations.add(REPLAY_STREAM_TRUNCATED)
  const limitationList = [...limitations]

  const mapKey = typeof result?.map_key === 'string' && result.map_key.trim() ? result.map_key.trim().toLowerCase() : null
  return {
    durationSec: clock.durationSec,
    mapCode: mapKey,
    friendlyTeam,
    recorderAccountId,
    vehicles: tracks,
    events,
    pointsSamples: pointsSamples(pb, clock),
    assaultObjectivePresent: pb.assault_objective_present === true,
    baseStates: baseStates(pb, clock),
    limitations: limitationList,
    capability: limitationList.length > 0 ? 'PARTIAL' : 'FULL',
    arenaBonusType: typeof result?.arena_bonus_type === 'number' ? result.arena_bonus_type : null,
  }
}

/**
 * Java `displayCapacityForLoss`：只有某个整秒帧的 FrameHealth 恰好观测到掉血终点那条采样时才有量程
 * （同一秒内又有新采样 → 该终点从未成为帧状态 → null）。presentation-only，按 Java 帧语义固定。
 */
function lossCapacity(facts: CanonicalReplayFacts, entityIds: number[], toSec: number): number | null {
  const frameT = Math.ceil(toSec - 1e-9)
  for (const id of entityIds) {
    const s = lastHpSampleAtOrBefore(facts, id, frameT)
    if (s && Math.abs(s.t - toSec) <= 1e-6) return displayCapacityAt(facts, id, frameT)
  }
  return null
}

/** Java `BattlePlaybackProjector.pointsSamples`：开战前每队最后一条并入 t=0。 */
function pointsSamples(pb: AgentPlaybackFacet, clock: ReplayClock): PointsSample[] {
  const out: PointsSample[] = []
  const preBattle = new Map<number, PointsSample>()
  const zeroTeams = new Set<number>()
  for (const p of pb.supremacy_points ?? []) {
    if (p.team !== 1 && p.team !== 2) continue
    const t = p.clock - clock.startRaw
    if (!Number.isFinite(t)) continue
    if (t < 0) {
      const prev = preBattle.get(p.team)
      if (!prev || prev.timeSec < t) preBattle.set(p.team, { timeSec: t, team: p.team, points: p.points })
    } else {
      out.push({ timeSec: t, team: p.team, points: p.points })
      if (t <= 1e-9) zeroTeams.add(p.team)
    }
  }
  for (const seed of preBattle.values()) if (!zeroTeams.has(seed.team)) out.push({ ...seed, timeSec: 0 })
  return out.sort((a, b) => a.timeSec - b.timeSec)
}

/** Java `BattlePlaybackProjector.baseStates`：争霸 A–D + 单基地 BASE；开战前每基地最后一条并入 t=0。 */
function baseStates(pb: AgentPlaybackFacet, clock: ReplayClock): BaseStateTransition[] {
  const projected: BaseStateTransition[] = []
  for (const b of pb.supremacy_bases ?? []) {
    const baseId = BASE_IDS[b.base_id]
    if (!baseId) continue
    projected.push({
      timeSec: b.clock - clock.startRaw, baseId,
      ownerTeam: teamOrNull(b.owner_team), capturingTeam: teamOrNull(b.capturing_team),
      captureProgress: typeof b.capture_progress === 'number' ? b.capture_progress : null,
    })
  }
  for (const a of pb.assault_bases ?? []) {
    projected.push({ timeSec: a.clock - clock.startRaw, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: a.progress })
  }
  const out: BaseStateTransition[] = []
  const preBattle = new Map<string, BaseStateTransition>()
  const zeroBases = new Set<string>()
  for (const s of projected) {
    if (!Number.isFinite(s.timeSec)) continue
    if (s.timeSec < 0) {
      const prev = preBattle.get(s.baseId)
      if (!prev || prev.timeSec < s.timeSec) preBattle.set(s.baseId, s)
      continue
    }
    if (s.timeSec > clock.durationSec + 1e-9) continue
    out.push(s)
    if (s.timeSec <= 1e-9) zeroBases.add(s.baseId)
  }
  for (const seed of preBattle.values()) if (!zeroBases.has(seed.baseId)) out.push({ ...seed, timeSec: 0 })
  return out.sort((a, b) => a.timeSec - b.timeSec || (a.baseId < b.baseId ? -1 : a.baseId > b.baseId ? 1 : 0))
}

function teamOrNull(v: number | null | undefined): 1 | 2 | null {
  return v === 1 || v === 2 ? v : null
}
