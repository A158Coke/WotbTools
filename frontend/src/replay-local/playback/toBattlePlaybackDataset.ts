/**
 * 上游 Rust Core `parsePlayback`（PlaybackData v2）+ `parseResult`（BattleResult）→ 2D 战局回放
 * 消费的 `BattlePlaybackDataset`（`contracts/http/openapi.yaml`，与服务端 battle-playback-v2 同形状）。
 *
 * 纯投影：不读字节、不推断协议语义。每一步对应 Java `BattlePlaybackProjector` /
 * `BattleTimelineBuilder` / `PlaybackCombatReconstruction` 的同名规则（注释标注出处），
 * 时间轴口径与 Java 一致：`timeSec = 原始时钟 − 战斗开始（period 3 时钟）`，`[0, durationSec]`。
 *
 * 与 Java 的已知差异（golden 测试量化，见 `playback.golden.test.ts`）：
 *  - Java 帧是 1 Hz 整秒采样；这里直接用上游 0.1 s 网格（按 `sampleStepSec` 抽样），段起止精确到网格；
 *  - DESTROYED/KILL 的击杀者取上游 `kills[]`（服务器击杀流），Java 由致命掉血窗口内唯一命中者推导；
 *  - 命中归因用上游 `shots[]`（`target_eid` 在案 = 命中），Java 用 method8 VehicleHitEvent。
 */

import type {
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
  OrientationSegment,
  OrientationSample,
  PlaybackConfidence,
  PointsSample,
  PositionSegment,
  PositionSample,
  VehicleBattleLoadout,
  VehiclePlaybackTrack,
} from '../../types/playback-v2.js'
import type { Tankopedia } from '../compute/tankopedia.js'
import { consumableItemId, consumableStateName, provisionItemId } from './itemCodes.js'

export interface ToDatasetOptions {
  /** 车辆库（车名/车种/等级/敌方开局血量）；缺省时车名回退结算名、车种「未知」、等级 null、敌方无开局种子 */
  tankopedia?: Tankopedia | null
  /** 位置/朝向采样间隔（秒，取上游网格整数倍；默认 0.5） */
  sampleStepSec?: number
  /**
   * 伤害归因事件（上游 `parseAiReview` 的 `events[type=damage]`：服务器下发的受击方/来源实体）。
   * PlaybackData v2 不含这条流；缺省时退化为 `shots[]`（他人宽松路径解不出 target 的命中会丢归因）。
   */
  damageEvents?: readonly AgentDamageEvent[] | null
}

/** `parseAiReview` 事件流里的伤害事件（t = 原始时钟；source_eid 缺省 = 来源未知）。 */
export interface AgentDamageEvent {
  t: number
  victim_eid: number
  source_eid?: number | null
}

/** 从 `parseAiReview` 输出里取伤害事件（形状不符的条目跳过）。 */
export function damageEventsFromAiReview(aiReview: unknown): AgentDamageEvent[] {
  const events = (aiReview as { events?: unknown } | null)?.events
  if (!Array.isArray(events)) return []
  return events.filter((e): e is AgentDamageEvent => !!e && typeof e === 'object'
    && (e as { type?: unknown }).type === 'damage'
    && typeof (e as AgentDamageEvent).t === 'number' && typeof (e as AgentDamageEvent).victim_eid === 'number')
    .map((e) => ({ t: e.t, victim_eid: e.victim_eid, source_eid: typeof e.source_eid === 'number' ? e.source_eid : null }))
}

/** Java `BattleTimelineBuilder.MAX_BATTLE_DURATION_SEC`。 */
const MAX_BATTLE_DURATION_SEC = 420
const EPS = 1e-6
const BASE_IDS = ['A', 'B', 'C', 'D'] as const

// ---------- 时间轴 ----------

export interface PlaybackClock {
  /** 战斗开始的原始时钟（period 3 = BATTLE） */
  startRaw: number
  durationSec: number
  /** 战斗开始无 period 3 广播、按结算时长反推 */
  estimated: boolean
}

/**
 * 战斗开始 + 时长（Java `BattleTimelineBuilder.resolveClock / resolveDurationSec` 同优先级）：
 * 时长 ① 结算 root5（cap 420）② RoundFinished（period 4）− 开始 ③ meta battleDuration（cap 420）
 * ④ 上游流末时钟 − 开始。
 */
export function resolvePlaybackClock(pb: AgentPlaybackFacet, result?: AgentBattleResult | null): PlaybackClock | null {
  const battleStart = pb.periods.find((p) => p.period === 3)
  const roundFinished = pb.periods.find((p) => p.period === 4)
  const settlement = positive(result?.result_duration_secs)
  let startRaw: number
  let estimated = false
  if (battleStart && Number.isFinite(battleStart.clock)) {
    startRaw = battleStart.clock
  } else if (roundFinished && settlement !== null) {
    startRaw = roundFinished.clock - settlement
    estimated = true
  } else {
    return null
  }
  let durationSec: number | null = null
  if (settlement !== null) durationSec = Math.min(settlement, MAX_BATTLE_DURATION_SEC)
  else if (roundFinished && roundFinished.clock - startRaw > 0) durationSec = roundFinished.clock - startRaw
  else if (positive(result?.battle_duration_secs) !== null) {
    durationSec = Math.min(result!.battle_duration_secs, MAX_BATTLE_DURATION_SEC)
  } else if (pb.meta.duration - startRaw > 0) durationSec = Math.min(pb.meta.duration - startRaw, MAX_BATTLE_DURATION_SEC)
  if (durationSec === null || !(durationSec > 0)) return null
  return { startRaw, durationSec, estimated }
}

function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

// ---------- 车辆窗口（AoI 可见性 / 位置覆盖） ----------

interface Window { from: number; to: number }

interface VehicleContext {
  vehicles: AgentVehicleTrack[]
  /** AoI 观测段（battle-relative；未关闭 = +∞） */
  aoi: Window[]
  /** 已关闭 AoI 段的离开时刻（battle-relative） */
  aoiCloses: number[]
  deathSec: number | null
}

function rel(raw: number, clock: PlaybackClock): number {
  return raw - clock.startRaw
}

function pairs(flat: number[] | undefined, clock: PlaybackClock): Window[] {
  const out: Window[] = []
  if (!flat) return out
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ from: rel(flat[i], clock), to: rel(flat[i + 1], clock) })
  return out
}

function inWindows(windows: Window[], t: number): Window | null {
  for (const w of windows) if (t >= w.from - EPS && t <= w.to + EPS) return w
  return null
}

// ---------- 采样网格 ----------

interface Grid { t0: number; step: number; samples: number }

function gridOf(pb: AgentPlaybackFacet): Grid {
  const { t_start: t0, samples, duration } = pb.meta
  const step = samples > 1 ? (duration - t0) / (samples - 1) : 0.1
  return { t0, step: step > 0 ? step : 0.1, samples }
}

function gridIndex(grid: Grid, raw: number): number {
  return Math.round((raw - grid.t0) / grid.step)
}

function normDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180
  if (Object.is(d, -0)) d = 0
  return d
}

const RAD2DEG = 180 / Math.PI

interface PoseSample {
  t: number
  observed: boolean
  x: number
  y: number
  hull: number | null
  turretRel: number | null
}

/**
 * 位姿采样（Java `BattleTimelineBuilder.frameVehicle` 规则）：t 落在 AoI 观测段且该段内已有位置数据
 * → OBSERVED/CURRENT，否则沿用最后一次位置 → LAST_KNOWN；从未有位置 → 无样本。
 * 位置数据只取覆盖段内的网格值（段外不信网格值，保持最后覆盖值）。
 */
function poseSamples(ctx: VehicleContext, grid: Grid, clock: PlaybackClock, stepSec: number): PoseSample[] {
  const out: PoseSample[] = []
  const stride = Math.max(1, Math.round(stepSec / grid.step))
  let last: Omit<PoseSample, 't' | 'observed'> | null = null
  let lastFrom = Number.NEGATIVE_INFINITY // 最后一次位置数据的时间（battle-relative）
  // 从开战前的最后一个网格点起逐点推进（开战前位置是 t=0 帧的合法 carry-forward）
  const firstIdx = 0
  const lastIdx = Math.min(grid.samples - 1, gridIndex(grid, clock.startRaw + clock.durationSec))
  const startIdx = Math.max(0, Math.ceil((clock.startRaw - grid.t0) / grid.step - EPS))
  const v = ctx.vehicles.map((vehicle) => ({ vehicle, coverage: pairs(vehicle.coverage, clock) }))
  for (let i = firstIdx; i <= lastIdx; i++) {
    const t = rel(grid.t0 + i * grid.step, clock)
    for (const { vehicle, coverage } of v) {
      if (!inWindows(coverage, t)) continue
      const x = vehicle.pos[3 * i]
      const z = vehicle.pos[3 * i + 2]
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue
      const hullRad = vehicle.hull_yaw[i]
      const turretRad = vehicle.turret_yaw[i]
      const hull = Number.isFinite(hullRad) ? normDeg(hullRad * RAD2DEG) : null
      const turretRel = hull !== null && Number.isFinite(turretRad)
        ? normDeg(turretRad * RAD2DEG - hullRad * RAD2DEG) : null
      last = { x, y: z, hull, turretRel }
      lastFrom = t
      break
    }
    if (i < startIdx || last === null) continue
    const atStep = (i - startIdx) % stride === 0 || i === lastIdx
    if (!atStep) continue
    const w = inWindows(ctx.aoi, t)
    const observed = w !== null && lastFrom >= w.from - EPS
    out.push({ t: Math.max(0, t), observed, ...last })
  }
  return out
}

function positionSegments(samples: PoseSample[]): PositionSegment[] {
  const out: PositionSegment[] = []
  let cur: PositionSample[] = []
  let knowledge: 'OBSERVED' | 'LAST_KNOWN' | null = null
  const flush = () => {
    if (cur.length === 0 || knowledge === null) return
    out.push({
      startSec: cur[0].timeSec,
      endSec: cur[cur.length - 1].timeSec,
      knowledge,
      interpolationAllowed: knowledge === 'OBSERVED',
      samples: cur,
    })
  }
  for (const s of samples) {
    const next = s.observed ? 'OBSERVED' : 'LAST_KNOWN'
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

function orientationSegments(samples: PoseSample[]): OrientationSegment[] {
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
    const next = s.observed ? 'CURRENT' : 'LAST_KNOWN'
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

// ---------- 血量 ----------

interface HpPoint { t: number; hp: number }

/** 账号的血量样本（battle-relative，升序；含开战前样本）。 */
function hpPoints(ctx: VehicleContext, clock: PlaybackClock): HpPoint[] {
  const out: HpPoint[] = []
  for (const v of ctx.vehicles) for (const [raw, hp] of v.hp) out.push({ t: rel(raw, clock), hp })
  return out.sort((a, b) => a.t - b.t)
}

/** Java `ReplayHpTimeline.settlementInitialHp`：结算剩余血量（signed field1）+ 承受伤害。 */
export function settlementInitialHp(player: AgentResultPlayer | undefined): number | null {
  if (!player) return null
  const left = typeof player.hitpoints_left === 'number' ? player.hitpoints_left : null
  const received = typeof player.damage_received === 'number' ? player.damage_received : 0
  if (left === null && received <= 0) return null
  return Math.max(left ?? 0, 0) + Math.max(received, 0)
}

/**
 * Java `BattlePlaybackProjector.healthTransitions`：友方开局 = 结算血量（HIGH），敌方开局 =
 * 车辆库血量（MEDIUM，临时）；之后每个回放血量样本 → CURRENT（AoI 观测段内）/ LAST_KNOWN，
 * AoI 关闭时刻降为 LAST_KNOWN。容量：友方 = 开局血量，敌方 = 截至 t 的观测最大值。
 */
function healthTransitions(
  ctx: VehicleContext, points: HpPoint[], clock: PlaybackClock, friendly: boolean, openingSeed: number | null,
): HealthTransition[] {
  const out: HealthTransition[] = []
  let previous: HealthTransition | null = null
  if (openingSeed !== null && openingSeed > 0) {
    previous = {
      timeSec: 0,
      currentHp: openingSeed,
      knowledge: 'CURRENT',
      source: friendly ? 'SETTLEMENT_OPENING_HP_EXACT' : 'TANKOPEDIA_BASE_PROVISIONAL',
      displayCapacityHp: openingSeed,
      relativeFull: false,
      confidence: friendly ? 'HIGH' : 'MEDIUM',
    }
    out.push(previous)
  }
  // 事件：血量样本（开战前的并入 t=0）+ AoI 关闭
  type Ev = { t: number; hp?: number; close?: boolean }
  const events: Ev[] = []
  let preBattle: HpPoint | null = null
  for (const p of points) {
    if (p.t < 0) preBattle = p
    else if (p.t <= clock.durationSec + EPS) events.push({ t: p.t, hp: p.hp })
  }
  if (preBattle && !events.some((e) => e.t <= EPS)) events.unshift({ t: 0, hp: preBattle.hp })
  for (const close of ctx.aoiCloses) {
    if (close >= 0 && close <= clock.durationSec + EPS) events.push({ t: close, close: true })
  }
  events.sort((a, b) => a.t - b.t || (a.close ? 1 : 0) - (b.close ? 1 : 0))

  let maxSeen = 0
  for (const p of points) if (p.t < 0 && p.hp > maxSeen) maxSeen = p.hp
  let currentHp: number | null = null
  let lastSampleT = Number.NEGATIVE_INFINITY
  let capacity: number | null = null
  for (const e of events) {
    if (e.hp !== undefined) {
      currentHp = e.hp
      lastSampleT = e.t
      if (e.hp > maxSeen) maxSeen = e.hp
    }
    if (currentHp === null) continue
    const w = e.close ? null : inWindows(ctx.aoi, e.t)
    const current = w !== null && lastSampleT >= w.from - EPS
    if (friendly) capacity = openingSeed !== null && openingSeed > 0 ? openingSeed : (maxSeen > 0 ? maxSeen : currentHp)
    else if (maxSeen > 0) capacity = maxSeen
    const next: HealthTransition = {
      timeSec: e.t,
      currentHp,
      knowledge: current ? 'CURRENT' : 'LAST_KNOWN',
      source: 'EXACT_BATTLE_EVENT',
      displayCapacityHp: capacity,
      relativeFull: false,
      confidence: 'HIGH',
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

/** 生命状态：首个回放血量（>0）→ ALIVE；上游 death_t → DESTROYED（destroyedKnownAtSec 同刻）。 */
function lifeTransitions(ctx: VehicleContext, points: HpPoint[], clock: PlaybackClock): LifeTransition[] {
  const out: LifeTransition[] = []
  const firstAlive = points.find((p) => p.hp > 0 && p.t <= clock.durationSec + EPS)
  const death = ctx.deathSec
  if (firstAlive && (death === null || firstAlive.t < death)) {
    out.push({ timeSec: Math.max(0, firstAlive.t), lifeState: 'ALIVE', destroyedKnownAtSec: null })
  }
  if (death !== null && death >= 0 && death <= clock.durationSec + EPS) {
    out.push({ timeSec: death, lifeState: 'DESTROYED', destroyedKnownAtSec: death })
  }
  return out
}

// ---------- 掉血（Java PlaybackCombatReconstruction.deriveLosses） ----------

interface Loss {
  fromSec: number
  toSec: number
  hpLoss: number
  attackerAccountId: number | null
  attackerReliable: boolean
  damageEventCount: number
  fromHp: number
  toHp: number
}

function collapseSameClock(points: HpPoint[]): HpPoint[] {
  const out: HpPoint[] = []
  let i = 0
  while (i < points.length) {
    const { t, hp } = points[i]
    let conflict = false
    let j = i + 1
    while (j < points.length && Math.abs(points[j].t - t) <= EPS) {
      if (points[j].hp !== hp) conflict = true
      j++
    }
    if (!conflict) out.push({ t, hp })
    i = j
  }
  return out
}

function deriveLosses(points: HpPoint[], hits: Array<{ t: number; attacker: number }>, clock: PlaybackClock): Loss[] {
  const list = collapseSameClock(points.filter((p) => p.t >= 0 && p.t <= clock.durationSec + EPS))
  const out: Loss[] = []
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]
    const cur = list[i]
    if (prev.hp <= 0 || cur.hp >= prev.hp) continue
    let sole: number | null = null
    let inWindow = 0
    let mixed = false
    for (const h of hits) {
      if (h.t > prev.t + EPS && h.t <= cur.t + EPS) {
        inWindow++
        if (h.attacker <= 0) mixed = true
        else if (sole === null) sole = h.attacker
        else if (sole !== h.attacker) mixed = true
      }
    }
    const reliable = !mixed && inWindow >= 1 && sole !== null
    out.push({
      fromSec: prev.t, toSec: cur.t, hpLoss: prev.hp - cur.hp,
      attackerAccountId: reliable ? sole : null, attackerReliable: reliable,
      damageEventCount: inWindow, fromHp: prev.hp, toHp: cur.hp,
    })
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
  pb: AgentPlaybackFacet, ctx: VehicleContext, clock: PlaybackClock, loadout: VehicleBattleLoadout | null,
): ConsumableTransition[] {
  const eids = new Set(ctx.vehicles.map((v) => v.eid))
  const obs = (pb.consumables ?? [])
    .filter((c) => eids.has(c.eid))
    .map((c) => {
      const logicalItemId = consumableItemId(c.wire_code)
      const state = consumableStateName(c.state)
      const proven = logicalItemId !== null && state !== 'UNKNOWN'
      return { t: rel(c.clock, clock), eid: c.eid, wire: c.wire_code, logicalItemId, state, confidence: (proven ? 'HIGH' : 'LOW') as PlaybackConfidence }
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
  for (const absent of ctx.aoiCloses) {
    const hadKnownBefore = obs.some((o) => o.t < absent - EPS && (o.logicalItemId !== null || o.state !== 'UNKNOWN'))
    if (hadKnownBefore && Number.isFinite(absent) && absent >= 0) {
      out.push({
        timeSec: absent, consumableSlot: null, logicalItemId: null, wireCode: null,
        state: 'UNKNOWN', invalidation: true, confidence: 'UNKNOWN',
      })
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
  pb: AgentPlaybackFacet, ctx: VehicleContext, clock: PlaybackClock, recorderVisible: boolean,
): ModuleCrewTransition[] {
  if (!recorderVisible) return []
  const eids = new Set(ctx.vehicles.map((v) => v.eid))
  const out: ModuleCrewTransition[] = []
  for (const m of pb.module_crew_states ?? []) {
    if (!eids.has(m.vehicle_eid)) continue
    const t = rel(m.clock, clock)
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
 * 投影入口。`result` 提供结算名册/开局血量/地图代号/模式；缺省时退化为 PlaybackData 自带名册
 * （友方开局血量未知 → 无 SETTLEMENT 种子）。时间轴不可用（无 period 3 且无法由结算反推）→ null。
 */
export function toBattlePlaybackDataset(
  pb: AgentPlaybackFacet,
  result?: AgentBattleResult | null,
  options: ToDatasetOptions = {},
): BattlePlaybackDataset | null {
  const clock = resolvePlaybackClock(pb, result)
  if (!clock) return null
  const grid = gridOf(pb)
  const tankopedia = options.tankopedia ?? null
  const stepSec = options.sampleStepSec ?? 0.5

  const authorVehicle = pb.vehicles.find((v) => v.is_author)
  const recorderAccountId = positive(result?.author_account_id) ?? positive(authorVehicle?.account_id) ?? null
  const settlementPlayers = new Map<number, AgentResultPlayer>()
  for (const p of result?.players ?? []) if (p.account_id > 0) settlementPlayers.set(p.account_id, p)
  const recorderTeam = recorderAccountId === null ? null
    : settlementPlayers.get(recorderAccountId)?.team ?? pb.vehicles.find((v) => v.account_id === recorderAccountId)?.team ?? null
  const friendlyTeam = recorderTeam === 1 || recorderTeam === 2 ? recorderTeam : null

  // eid → account（身份域主键 = 上游 vehicles[].eid）
  const accountByEid = new Map<number, number>()
  const vehiclesByAccount = new Map<number, AgentVehicleTrack[]>()
  for (const v of pb.vehicles) {
    if (!(v.account_id > 0) || !(v.team === 1 || v.team === 2)) continue
    if (settlementPlayers.size > 0 && !settlementPlayers.has(v.account_id)) continue
    accountByEid.set(v.eid, v.account_id)
    const list = vehiclesByAccount.get(v.account_id) ?? []
    list.push(v)
    vehiclesByAccount.set(v.account_id, list)
  }

  // 伤害归因：优先 AiReview 伤害事件（服务器受击流，Java VehicleHitEvent 同源），否则 shots[]
  // （target_eid 在案 = 命中）
  const sources = options.damageEvents
    // AiReview 时钟是全精度，PlaybackData 时钟（hp/shots/kills）舍入到 0.01 s：对齐到同一量化，
    // 否则恰在血量样本时刻的伤害会落进下一个掉血窗口
    ? options.damageEvents.map((d) => ({ raw: Math.round(d.t * 100) / 100, victimEid: d.victim_eid, sourceEid: d.source_eid ?? null }))
    : pb.shots.filter((s) => s.target_eid != null).map((s) => ({ raw: s.t_fire, victimEid: s.target_eid!, sourceEid: s.shooter_eid }))
  const hitsByVictim = new Map<number, Array<{ t: number; attacker: number }>>()
  const damageEvents: BattleEvent[] = []
  for (const s of sources) {
    const victim = accountByEid.get(s.victimEid)
    if (victim === undefined) continue
    const t = rel(s.raw, clock)
    if (!Number.isFinite(t) || t < 0 || t > clock.durationSec + EPS) continue
    const attacker = (s.sourceEid !== null ? accountByEid.get(s.sourceEid) : undefined) ?? 0
    const list = hitsByVictim.get(victim) ?? []
    list.push({ t, attacker })
    hitsByVictim.set(victim, list)
    damageEvents.push({ type: 'DAMAGE', timeSec: t, accountId: attacker > 0 ? attacker : null, targetAccountId: victim, observedHpLoss: null })
  }

  const visibilityByEid = new Map<number, Window[]>()
  const closesByEid = new Map<number, number[]>()
  for (const p of pb.visibility) {
    const from = rel(p.t_in, clock)
    const to = p.t_out == null ? Number.POSITIVE_INFINITY : rel(p.t_out, clock)
    const list = visibilityByEid.get(p.eid) ?? []
    list.push({ from, to })
    visibilityByEid.set(p.eid, list)
    if (p.t_out != null) closesByEid.set(p.eid, [...(closesByEid.get(p.eid) ?? []), to])
  }

  const tracks: VehiclePlaybackTrack[] = []
  const lossesByAccount = new Map<number, Loss[]>()
  for (const [accountId, vehicles] of vehiclesByAccount) {
    const player = settlementPlayers.get(accountId)
    const head = vehicles[0]
    const team = player?.team ?? head.team
    const tankId = player?.tank_id ?? head.tank_id
    const deaths = vehicles.map((v) => v.death_t).filter((d): d is number => typeof d === 'number')
    const ctx: VehicleContext = {
      vehicles,
      aoi: vehicles.flatMap((v) => visibilityByEid.get(v.eid) ?? []),
      aoiCloses: vehicles.flatMap((v) => closesByEid.get(v.eid) ?? []),
      deathSec: deaths.length ? rel(Math.max(...deaths), clock) : null,
    }
    const friendly = friendlyTeam === null ? null : team === friendlyTeam
    const poses = poseSamples(ctx, grid, clock, stepSec)
    const posSegs = positionSegments(poses)
    const points = hpPoints(ctx, clock)
    const info = tankopedia && tankId > 0 ? tankopedia.info(tankId) : null
    const openingSeed = friendly === true
      ? settlementInitialHp(player)
      : (info?.maxHp != null && info.maxHp > 0 ? info.maxHp : null)
    const health = healthTransitions(ctx, points, clock, friendly === true, openingSeed)
    const losses = deriveLosses(points, hitsByVictim.get(accountId) ?? [], clock)
    lossesByAccount.set(accountId, losses)
    const loadout = toLoadout(vehicles, result?.client_version ?? null)
    tracks.push({
      accountId,
      playerName: player?.nickname ?? head.nickname ?? '',
      tankId,
      tankName: validTankName(info?.name) ? info!.name : validTankName(player?.tank_name) ? player!.tank_name
        : validTankName(head.tank_name) ? head.tank_name : UNKNOWN_TANK_NAME,
      tankClass: info?.type ? info.type : UNKNOWN_TANK_CLASS,
      tankTier: typeof info?.tier === 'number' ? info.tier : null,
      team,
      friendly,
      loadout,
      positionSegments: posSegs,
      orientationSegments: orientationSegments(poses),
      healthTransitions: health,
      lifeTransitions: lifeTransitions(ctx, points, clock),
      damageLosses: losses.map((l): DamageLoss => ({
        ...l,
        displayCapacityHp: capacityAt(health, l.toSec),
        transientAllowed: posSegs.some((s) => s.knowledge === 'OBSERVED' && s.startSec <= l.toSec + EPS && s.endSec >= l.toSec - EPS),
      })),
      consumableTransitions: consumableTransitions(pb, ctx, clock, loadout),
      moduleCrewTransitions: moduleCrewTransitions(pb, ctx, clock, recorderAccountId !== null && accountId === recorderAccountId),
    })
  }
  if (tracks.length === 0) return null
  tracks.sort((a, b) => a.accountId - b.accountId)

  // observedHpLoss（Java PlaybackCombatReconstruction.observedHpLossAt）
  for (const e of damageEvents) {
    const losses = lossesByAccount.get(e.targetAccountId!) ?? []
    const l = losses.find((x) => x.damageEventCount === 1 && x.attackerReliable && e.timeSec > x.fromSec + EPS && e.timeSec <= x.toSec + EPS)
    e.observedHpLoss = l ? l.hpLoss : null
  }

  const events: BattleEvent[] = [...damageEvents]
  // DESTROYED / KILL：上游 death_t + kills[]（击杀者 = 服务器击杀流）
  const killerByVictim = new Map<number, number>()
  for (const k of pb.kills) {
    const victim = accountByEid.get(k.victim_eid)
    const killer = accountByEid.get(k.killer_eid)
    if (victim !== undefined && killer !== undefined) killerByVictim.set(victim, killer)
  }
  for (const track of tracks) {
    const destroyed = track.lifeTransitions.find((l) => l.lifeState === 'DESTROYED')
    if (!destroyed) continue
    events.push({ type: 'DESTROYED', timeSec: destroyed.timeSec, accountId: track.accountId, targetAccountId: null, observedHpLoss: null })
    const killer = killerByVictim.get(track.accountId)
    if (killer !== undefined && killer !== track.accountId) {
      events.push({ type: 'KILL', timeSec: destroyed.timeSec, accountId: killer, targetAccountId: track.accountId, observedHpLoss: null })
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

  const limitations: string[] = []
  if (clock.estimated) limitations.push('CLOCK_ESTIMATED')
  const combatants = new Set([...settlementPlayers.values()].filter((p) => p.team > 0).map((p) => p.account_id))
  if (combatants.size > tracks.length) limitations.push('PLAYBACK_COMBATANT_TRACK_INCOMPLETE')

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
    limitations,
    capability: limitations.length > 0 ? 'PARTIAL' : 'FULL',
    arenaBonusType: typeof result?.arena_bonus_type === 'number' ? result.arena_bonus_type : null,
  }
}

function capacityAt(health: HealthTransition[], t: number): number | null {
  let cap: number | null = null
  for (const h of health) {
    if (h.timeSec > t + EPS) break
    if (h.source !== 'TANKOPEDIA_BASE_PROVISIONAL' && h.source !== 'SETTLEMENT_OPENING_HP_EXACT') cap = h.displayCapacityHp
  }
  return cap
}

/** Java `BattlePlaybackProjector.pointsSamples`：开战前每队最后一条并入 t=0。 */
function pointsSamples(pb: AgentPlaybackFacet, clock: PlaybackClock): PointsSample[] {
  const out: PointsSample[] = []
  const preBattle = new Map<number, PointsSample>()
  const zeroTeams = new Set<number>()
  for (const p of pb.supremacy_points ?? []) {
    if (p.team !== 1 && p.team !== 2) continue
    const t = rel(p.clock, clock)
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
function baseStates(pb: AgentPlaybackFacet, clock: PlaybackClock): BaseStateTransition[] {
  const projected: BaseStateTransition[] = []
  for (const b of pb.supremacy_bases ?? []) {
    const baseId = BASE_IDS[b.base_id]
    if (!baseId) continue
    projected.push({
      timeSec: rel(b.clock, clock), baseId,
      ownerTeam: teamOrNull(b.owner_team), capturingTeam: teamOrNull(b.capturing_team),
      captureProgress: typeof b.capture_progress === 'number' ? b.capture_progress : null,
    })
  }
  for (const a of pb.assault_bases ?? []) {
    projected.push({ timeSec: rel(a.clock, clock), baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: a.progress })
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
