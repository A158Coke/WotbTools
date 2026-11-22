/** Agent 回放数据契约 —— 形状校验（trust boundary：进 view model 前的结构契约锁定）。
 *  拆分自 agent-replay-facets.ts；公共入口仍为 `../agent-replay-facets.ts`。 */

import type { AgentAiReviewFacet, AiReviewValidationMode } from './aiTypes.js'
import type { AgentBattleResult, AgentAuthorInitialPosition, AgentRecorderCamera } from './resultTypes.js'
import type { AgentPlaybackFacet, AgentArmorStateTrack } from './playbackTypes.js'
import { AI_HP_STATE_SET, AI_REVIEW_CONTRACT_VERSION } from './aiTypes.js'

// ---------- AiReviewFacet 形状校验 ----------

/**
 * AiReviewFacet 形状校验（trust boundary）。除结构外还锁定 canonical 语义**必需**的
 * v0.3.5 证据：`damage.hp_raw`（区分 HP=0 与终态哨兵）。缺失即拒绝——旧产物不得被
 * 静默投影成「哨兵 = 血量 0」的错误事实（fail closed，而不是降级猜测）。
 *
 * `mode` **必填**：当前 pin 的 producer 路径（`current-producer`）把 `hp_state` 当必填字段，
 * 旧 artifact / 显式 legacy 摄入（`legacy-compatible`）才允许缺省。没有默认值——两条路径
 * 由调用方显式选择，避免未来新增调用方静默拿到宽松口径。
 */
export function validateAgentAiReview(value: unknown, mode: AiReviewValidationMode): AgentAiReviewFacet {
  const doc = assertObject(value, 'ai_review')
  assertFacetVersion(doc.version, 'ai_review.version', AI_REVIEW_CONTRACT_VERSION)
  const battle = assertObject(doc.battle, 'ai_review.battle')
  assertArray(battle.periods, 'ai_review.battle.periods')
  for (const key of ['rosters', 'events', 'settlements']) assertArray(doc[key], `ai_review.${key}`)
  // 原始位姿是位置证据的唯一来源（回放网格是渲染滤波输出，不是观测）
  for (const key of ['poses', 'turrets']) {
    if (!Array.isArray(doc[key])) throw new Error(`agent facets: ai_review.${key} 缺失（canonical 投影需要上游 ≥ v0.3.7）`)
  }
  for (const e of doc.events as unknown[]) {
    if (!isObject(e) || typeof e.type !== 'string') throw new Error('agent facets: ai_review.events[] 必须是带 type 的对象')
    if (e.type === 'damage' && typeof e.hp_raw !== 'number') {
      throw new Error('agent facets: ai_review damage.hp_raw 缺失（canonical 投影需要上游 ≥ v0.3.7）')
    }
    // hp_state：**两个方向都 fail closed**。①当前 pin（v0.4.9+）的 producer 恒输出该字段——
    // 计数型 HP 事件缺字段 = producer 漂移，必须拒绝；若静默走 legacy 回退，0xFFFE 档弹药架殉爆
    // 会重新被判成存活（本 PR 修的正是这个 bug）。②在场值必须落在闭集内，绝不静默回退 hp_raw。
    if (e.type === 'damage' || e.type === 'health') {
      if (e.hp_state === undefined) {
        if (mode === 'current-producer') {
          throw new Error('agent facets: ai_review ' + e.type
            + '.hp_state 缺失（当前 pin 的 producer 恒输出该字段；缺失 = producer 漂移，fail closed）')
        }
      } else if (!AI_HP_STATE_SET.has(e.hp_state as string)) {
        throw new Error('agent facets: ai_review ' + e.type + '.hp_state 非法（须为 current|zero|terminal）')
      }
    } else if (e.hp_state !== undefined && !AI_HP_STATE_SET.has(e.hp_state as string)) {
      throw new Error('agent facets: ai_review ' + e.type + '.hp_state 非法（须为 current|zero|terminal）')
    }
  }
  // prop3 血量广播是录像者血量帧的唯一来源：整场没有任何 health 事件 = 旧产物，拒绝而不是缺帧投影
  const evts = doc.events as Array<Record<string, unknown>>
  if (evts.some((e) => e.type === 'damage') && !evts.some((e) => e.type === 'health')) {
    throw new Error('agent facets: ai_review 缺 health（prop3）事件（canonical 投影需要上游 ≥ v0.3.7）')
  }
  return value as unknown as AgentAiReviewFacet
}

// ---------- 形状校验辅助与各能力入口 ----------

// ---------- 形状校验（trust boundary：进 view model 前的结构契约锁定） ----------

/** PlaybackData 契约版本（上游 v0.2.0 起 = 2：+supremacy_bases/supremacy_points；
 *  上游 2026-10-03 起不再产出 `aim_frames`——该字段自始可选且无消费方，版本保持 2）。
 *  错版 WASM 在此显式拒绝，不允许被静默解析成半残数据（trust boundary）。 */
export const PLAYBACK_CONTRACT_VERSION = 2

/** 切面契约版本（v1 切面字段口径沿用；原 agent-replay-facets.ts 内私有，HoF 投影复用） */
export const CONTRACT_VERSION = 1

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertObject(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) throw new Error(`agent facets: ${path} 必须是对象`)
  return v
}

function assertArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`agent facets: ${path} 必须是数组`)
  return v
}

function assertFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`agent facets: ${path} 必须是有限数值`)
  return v
}

function assertNonNegativeInteger(v: unknown, path: string, max: number = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) {
    throw new Error(`agent facets: ${path} 必须是非负整数`)
  }
  return v
}

/**
 * 可空有限数值（producer 的 `Option<f32>` 线形状）：`null`（上游缺省）或**任何有限数值**。
 *
 * 这里**不施加 `> 0`**：该字段是 producer 的原始透传（arena update subtype 15/16/17 的
 * 原始 f3），producer 没有「正时长」这个 invariant——真实回放会给出 `-0.039` 这样的负
 * finite 值（时长变更事件相对上一刻的差值）。把消费方「可解释定时相位」的语义规则提升成
 * wire contract 会让真实 producer 输出被拒。语义过滤属于消费层（见 `scene/reloadBar.js`
 * 的 `isUsablePhase`），不属于 trust boundary。
 */
function assertNullableFiniteNumber(v: unknown, path: string): number | null {
  if (v === null) return null
  try {
    return assertFiniteNumber(v, path)
  } catch {
    throw new Error(`agent facets: ${path} 必须是有限数值或 null`)
  }
}

function validateReloadEvent(value: unknown, path: string): void {
  const e = assertObject(value, path)
  assertFiniteNumber(e.clock, `${path}.clock`)
  assertNonNegativeInteger(e.eid, `${path}.eid`, 0xffffffff)
  assertNonNegativeInteger(e.phase, `${path}.phase`, 0xff)
  assertNullableFiniteNumber(e.duration_s, `${path}.duration_s`)
  if (e.count !== null) assertNonNegativeInteger(e.count, `${path}.count`)
}

/**
 * method 35（0x23）「当前生效完整装填时长」：`finite && > 0` 是 **producer 自己的**
 * invariant（它表示一个完整装填配置的时长，取值必然为正），故这里是 wire contract 的
 * 合法收紧，与上面 raw `reloads[].duration_s` 的宽松口径不矛盾——两者不是同一个东西。
 */
function validateReloadEffectiveEvent(value: unknown, path: string): void {
  const e = assertObject(value, path)
  assertFiniteNumber(e.clock, `${path}.clock`)
  assertNonNegativeInteger(e.eid, `${path}.eid`, 0xffffffff)
  const d = assertFiniteNumber(e.duration_s, `${path}.duration_s`)
  if (d <= 0) throw new Error(`agent facets: ${path}.duration_s 必须为正数`)
}

/**
 * Type32 消耗品 lifecycle（v0.4.18 additive）：3D 名牌直接消费 facet 原始事件，
 * 时钟/实体/线码/状态必须在 trust boundary 锁定；派生字段（state_name/duration_s/
 * ends_at/ever_activated/slot/logical_item_id）缺省即旧产物，出现时校验形状。
 */
function validateConsumableEvent(value: unknown, path: string): void {
  const e = assertObject(value, path)
  assertFiniteNumber(e.clock, `${path}.clock`)
  assertNonNegativeInteger(e.eid, `${path}.eid`, 0xffffffff)
  assertNonNegativeInteger(e.wire_code, `${path}.wire_code`, 0xff)
  assertNonNegativeInteger(e.state, `${path}.state`, 0xff)
  if (e.state_name !== undefined && typeof e.state_name !== 'string') {
    throw new Error(`agent facets: ${path}.state_name 必须是字符串`)
  }
  if (e.duration_s !== undefined) assertNullableFiniteNumber(e.duration_s, `${path}.duration_s`)
  if (e.ends_at !== undefined) assertNullableFiniteNumber(e.ends_at, `${path}.ends_at`)
  if (e.ever_activated !== undefined && typeof e.ever_activated !== 'boolean') {
    throw new Error(`agent facets: ${path}.ever_activated 必须是布尔值`)
  }
  if (e.slot !== undefined && e.slot !== null) assertNonNegativeInteger(e.slot, `${path}.slot`, 2)
  if (e.logical_item_id !== undefined && e.logical_item_id !== null
    && typeof e.logical_item_id !== 'string') {
    throw new Error(`agent facets: ${path}.logical_item_id 必须是字符串或 null`)
  }
}

/** 切面契约版本锁定（v1 切面字段口径沿用；能力拆分见契约 v2 文档） */
function assertFacetVersion(v: unknown, path: string, expected: number = CONTRACT_VERSION): void {
  if (v !== expected) {
    throw new Error(`agent facets: ${path} = ${String(v)}，不支持的契约版本（期望 ${expected}）`)
  }
}

/**
 * BattleResult 形状校验：花名册齐备 + 身份键在册。
 * 轻校验（DTO 冻结、字段全透传；时序键出现视为非法形状——结果能力不得物化时序）。
 */
export function validateAgentBattleResult(value: unknown): AgentBattleResult {
  const r = assertObject(value, 'result')
  assertArray(r.players, 'result.players')
  if (typeof r.author_account_id !== 'number') throw new Error('agent facets: result.author_account_id 必须是数值')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    if (key in r) throw new Error(`agent facets: 结果能力不得物化时序键 ${key}`)
  }
  return value as unknown as AgentBattleResult
}

/**
 * 录像者初始世界位姿 trust boundary：合法返回只有 `null`（证据不足）或严格三字段对象。
 *
 * `author_eid` 必须是正 u32、`clock` 有限非负、`position` 恰好 3 个有限数值。缺字段、
 * NaN/Infinity、长度漂移一律 throw——不把未知伪装成 `[0,0,0]`，也不做 map/spawn 语义转换。
 */
export function validateAgentAuthorInitialPosition(value: unknown): AgentAuthorInitialPosition | null {
  if (value === null) return null
  const obj = assertObject(value, 'author_initial_position')
  const authorEid = assertNonNegativeInteger(obj.author_eid, 'author_initial_position.author_eid', 0xffffffff)
  if (authorEid === 0) throw new Error('agent facets: author_initial_position.author_eid 必须是正 u32')
  const clock = assertFiniteNumber(obj.clock, 'author_initial_position.clock')
  if (clock < 0) throw new Error('agent facets: author_initial_position.clock 必须非负')
  const rawPosition = assertArray(obj.position, 'author_initial_position.position')
  if (rawPosition.length !== 3) {
    throw new Error('agent facets: author_initial_position.position 长度必须为 3')
  }
  const [x, y, z] = rawPosition.map((v, i) => assertFiniteNumber(v, `author_initial_position.position[${i}]`))
  return { author_eid: authorEid, clock, position: [x, y, z] }
}

function assertAscendingClock(v: unknown, path: string): number[] {
  const values = assertArray(v, path).map((item, i) => assertFiniteNumber(item, `${path}[${i}]`))
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) throw new Error(`agent facets: ${path} 必须按时钟升序`)
  }
  return values
}

function assertColumn(v: unknown, path: string, length: number): number[] {
  const values = assertArray(v, path).map((item, i) => assertFiniteNumber(item, `${path}[${i}]`))
  if (values.length !== length) throw new Error(`agent facets: ${path} 长度必须等于时钟列`)
  return values
}

function assertU32Column(v: unknown, path: string, length: number): number[] {
  const values = assertArray(v, path).map((item, i) => assertNonNegativeInteger(item, `${path}[${i}]`, 0xffffffff))
  if (values.length !== length) throw new Error(`agent facets: ${path} 长度必须等于时钟列`)
  return values
}

/**
 * 录像者相机形状校验（`parseRecorderCamera`）：`null` 是上游结构校验未通过的合法结果；
 * 形状漂移一律 throw，由调用方按「不支持」处理，不做降级补值。
 */
export function validateAgentRecorderCamera(value: unknown): AgentRecorderCamera | null {
  if (value === null) return null
  const obj = assertObject(value, 'recorder_camera')
  if (obj.version !== 1) throw new Error('agent facets: recorder_camera.version 必须为 1')
  const authorEid = assertNonNegativeInteger(obj.author_eid, 'recorder_camera.author_eid', 0xffffffff)
  if (authorEid === 0) throw new Error('agent facets: recorder_camera.author_eid 必须是正 u32')
  const aim = assertObject(obj.aim, 'recorder_camera.aim')
  const aimT = assertAscendingClock(aim.t, 'recorder_camera.aim.t')
  if (aimT.length === 0) throw new Error('agent facets: recorder_camera.aim.t 不能为空')
  const mode = assertObject(obj.mode, 'recorder_camera.mode')
  const modeT = assertAscendingClock(mode.t, 'recorder_camera.mode.t')
  if (modeT.length === 0) throw new Error('agent facets: recorder_camera.mode.t 不能为空')
  const zoom = assertObject(obj.zoom, 'recorder_camera.zoom')
  const zoomT = assertAscendingClock(zoom.t, 'recorder_camera.zoom.t')
  const bloom = assertObject(obj.bloom, 'recorder_camera.bloom')
  const bloomT = assertAscendingClock(bloom.t, 'recorder_camera.bloom.t')
  const options = assertObject(obj.client_options, 'recorder_camera.client_options')
  const backwardZoom = options.backward_zoom
  if (backwardZoom !== null && typeof backwardZoom !== 'boolean') {
    throw new Error('agent facets: recorder_camera.client_options.backward_zoom 必须是 boolean 或 null')
  }
  return {
    version: 1,
    author_eid: authorEid,
    aim: {
      t: aimT,
      yaw: assertColumn(aim.yaw, 'recorder_camera.aim.yaw', aimT.length),
      pitch: assertColumn(aim.pitch, 'recorder_camera.aim.pitch', aimT.length),
      ray_x: assertColumn(aim.ray_x, 'recorder_camera.aim.ray_x', aimT.length),
      ray_y: assertColumn(aim.ray_y, 'recorder_camera.aim.ray_y', aimT.length),
      ray_z: assertColumn(aim.ray_z, 'recorder_camera.aim.ray_z', aimT.length),
    },
    mode: { t: modeT, raw: assertU32Column(mode.raw, 'recorder_camera.mode.raw', modeT.length) },
    zoom: { t: zoomT, raw: assertColumn(zoom.raw, 'recorder_camera.zoom.raw', zoomT.length) },
    bloom: { t: bloomT, raw: assertColumn(bloom.raw, 'recorder_camera.bloom.raw', bloomT.length) },
    client_options: { backward_zoom: backwardZoom },
  }
}

/**
 * PlaybackData 形状校验：version === PLAYBACK_CONTRACT_VERSION(2)、meta、必备数组 + v2 新键。
 * 未知键忽略 = 契约的同版本加字段策略；字段级取值语义由类型承载。
 */
export function validateAgentPlayback(value: unknown): AgentPlaybackFacet {
  const pb = assertObject(value, 'playback')
  assertFacetVersion(pb.version, 'playback.version', PLAYBACK_CONTRACT_VERSION)
  assertObject(pb.meta, 'playback.meta')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    assertArray(pb[key], `playback.${key}`)
  }
  // contract v2 additive 能力：在场时必须为数组（aim_frames 上游已移除，不再校验）
  for (const key of ['supremacy_bases', 'supremacy_points', 'assault_bases']) {
    if (pb[key] !== undefined) assertArray(pb[key], `playback.${key}`)
  }
  if (pb.reloads !== undefined) {
    const events = assertArray(pb.reloads, 'playback.reloads')
    events.forEach((event, i) => validateReloadEvent(event, `playback.reloads[${i}]`))
  }
  if (pb.reload_effective !== undefined) {
    const events = assertArray(pb.reload_effective, 'playback.reload_effective')
    events.forEach((event, i) => validateReloadEffectiveEvent(event, `playback.reload_effective[${i}]`))
  }
  if (pb.author_shell_timeline !== undefined) {
    const events = assertArray(pb.author_shell_timeline, 'playback.author_shell_timeline')
    const clocks = events.map((event, i) => {
      const ctx = `playback.author_shell_timeline[${i}]`
      const obj = assertObject(event, ctx)
      assertNonNegativeInteger(obj.shell_id, `${ctx}.shell_id`, 0xffffff)
      return obj.t
    })
    assertAscendingClock(clocks, 'playback.author_shell_timeline.t')
  }
  if (pb.consumables !== undefined) {
    const events = assertArray(pb.consumables, 'playback.consumables')
    events.forEach((event, i) => validateConsumableEvent(event, `playback.consumables[${i}]`))
  }
  if (pb.armor_states !== undefined) {
    const tracks = assertArray(pb.armor_states, 'playback.armor_states') as AgentArmorStateTrack[]
    tracks.forEach((track, i) => {
      const ctx = `playback.armor_states[${i}]`
      assertObject(track, ctx)
      assertArray(track.t, `${ctx}.t`)
      assertArray(track.state, `${ctx}.state`)
      if (track.t.length !== track.state.length) {
        throw new Error(`agent facets: ${ctx} 列长不一致（列式契约）`)
      }
      for (const v of track.state) {
        if (!Number.isInteger(v) || v < 0 || v > 255) {
          throw new Error(`agent facets: ${ctx}.state 必须是 u8 状态号`)
        }
      }
    })
  }
  // 目标存在性必须是布尔（跳空键按"无已证实目标"解读，与 assaultObjectivePresent 同义）
  if (pb.assault_objective_present !== undefined && typeof pb.assault_objective_present !== 'boolean') {
    throw new Error('agent facets: playback.assault_objective_present 必须是布尔')
  }
  // 可破坏地形（additive）：在场时校验为对象/事件数组，字段形状由消费端
  // scene/destructibles.js 容错（寻址失败逐事件跳过，不 fail 整场回放）
  if (pb.destructible_areas !== undefined) {
    assertArray(pb.destructible_areas, 'playback.destructible_areas')
  }
  if (pb.destructible_events !== undefined) {
    assertArray(pb.destructible_events, 'playback.destructible_events')
  }
  // 位姿关键帧（additive）：在场时列必须等长且 pos = 3×t（渲染逐帧读取，形状错误会变成
  // 每帧静默错位而不是一次性失败，故在边界拦下）
  const vehicles = assertArray(pb.vehicles, 'playback.vehicles')
  vehicles.forEach((vehicle, i) => {
    const kf = isObject(vehicle) ? vehicle.pose_kf : undefined
    if (kf === undefined || kf === null) return
    const kfObj = assertObject(kf, `playback.vehicles[${i}].pose_kf`)
    const t = assertArray(kfObj.t, `playback.vehicles[${i}].pose_kf.t`)
    const pos = assertArray(kfObj.pos, `playback.vehicles[${i}].pose_kf.pos`)
    assertArray(kfObj.yaw, `playback.vehicles[${i}].pose_kf.yaw`)
    assertArray(kfObj.pitch, `playback.vehicles[${i}].pose_kf.pitch`)
    if (pos.length !== t.length * 3) {
      throw new Error(
        `agent facets: playback.vehicles[${i}].pose_kf.pos 长度 ${pos.length} ≠ 3×t（${t.length}）`,
      )
    }
  })
  // 复活生命轨道（additive，上游 v0.4.8）：在场时必须为数组、数值有限、非负且非降序——
  // 消费端按「死亡 ↔ 复活」交替重建生命史（canonical lifeTransitions / defLifeAt / rosterState），
  // 形状漂移会静默篡改终态迁移，故在边界拦下。缺省 = 无复活证据（死亡终态，行为与既往逐位一致），
  // 不据数组长度反推复活模式。
  vehicles.forEach((vehicle, i) => {
    if (!isObject(vehicle)) return
    for (const key of ['death_times', 'resurrection_times'] as const) {
      const column = vehicle[key]
      if (column === undefined) continue
      const times = assertArray(column, `playback.vehicles[${i}].${key}`)
      let previous = Number.NEGATIVE_INFINITY
      for (let j = 0; j < times.length; j++) {
        const time = assertFiniteNumber(times[j], `playback.vehicles[${i}].${key}[${j}]`)
        if (time < 0 || time < previous) {
          throw new Error(`agent facets: playback.vehicles[${i}].${key} 必须非负且非降序`)
        }
        previous = time
      }
    }
  })
  // 独立炮塔必须带完整的原始实体轨迹。只校验新字段与车辆 eid 的联表，保持旧车辆形状兼容。
  if (pb.detached_turrets !== undefined) {
    const tracks = assertArray(pb.detached_turrets, 'playback.detached_turrets')
    const vehicleEids = new Set(vehicles.filter(isObject).map((vehicle) => vehicle.eid))
    const turretEids = new Set<number>()
    const ownerEids = new Set<number>()
    for (let i = 0; i < tracks.length; i++) {
      const ctx = `playback.detached_turrets[${i}]`
      const track = assertObject(tracks[i], ctx)
      const eid = assertNonNegativeInteger(track.eid, `${ctx}.eid`, 0xffffffff)
      const owner = assertNonNegativeInteger(track.vehicle_eid, `${ctx}.vehicle_eid`, 0xffffffff)
      if (eid === 0 || owner === 0) {
        throw new Error(`agent facets: ${ctx}.eid / vehicle_eid 必须是正 u32`)
      }
      if (turretEids.has(eid) || vehicleEids.has(eid) || eid === owner) {
        throw new Error(`agent facets: ${ctx}.eid 重复或与车辆实体冲突`)
      }
      if (!vehicleEids.has(owner)) {
        throw new Error(`agent facets: ${ctx}.vehicle_eid 未对应 playback.vehicles`)
      }
      if (ownerEids.has(owner)) {
        throw new Error(`agent facets: ${ctx}.vehicle_eid 对应多个独立炮塔，归属冲突`)
      }
      turretEids.add(eid)
      ownerEids.add(owner)

      const coverage = assertArray(track.coverage, `${ctx}.coverage`)
      if (coverage.length === 0 || coverage.length % 2 !== 0) {
        throw new Error(`agent facets: ${ctx}.coverage 必须是非空区间对`)
      }
      let previousEnd = -Infinity
      for (let j = 0; j < coverage.length; j += 2) {
        const start = assertFiniteNumber(coverage[j], `${ctx}.coverage[${j}]`)
        const end = assertFiniteNumber(coverage[j + 1], `${ctx}.coverage[${j + 1}]`)
        if (start < 0 || end < start || start <= previousEnd) {
          throw new Error(`agent facets: ${ctx}.coverage 区间必须有序且不重叠`)
        }
        previousEnd = end
      }

      const kf = assertObject(track.pose_kf, `${ctx}.pose_kf`)
      const t = assertArray(kf.t, `${ctx}.pose_kf.t`)
      if (t.length === 0) throw new Error(`agent facets: ${ctx}.pose_kf.t 必须至少有一帧`)
      for (const key of ['pos', 'yaw', 'pitch', 'roll']) {
        const column = assertArray(kf[key], `${ctx}.pose_kf.${key}`)
        const expected = t.length * (key === 'pos' ? 3 : 1)
        if (column.length !== expected) {
          throw new Error(`agent facets: ${ctx}.pose_kf.${key} 列长不一致（期望 ${expected}）`)
        }
        for (let j = 0; j < column.length; j++) {
          assertFiniteNumber(column[j], `${ctx}.pose_kf.${key}[${j}]`)
        }
      }
      let previousTime = -Infinity
      for (let j = 0; j < t.length; j++) {
        const time = assertFiniteNumber(t[j], `${ctx}.pose_kf.t[${j}]`)
        if (time < 0 || time <= previousTime) {
          throw new Error(`agent facets: ${ctx}.pose_kf.t 必须严格升序`)
        }
        previousTime = time
      }
      // 每个 AoI 段由 Type5 初帧锚定；末帧后可在段内保持，但不可把未来首帧或段间插值当观测。
      let sample = 0
      for (let j = 0; j < coverage.length; j += 2) {
        if (t[sample] !== coverage[j]) {
          throw new Error(`agent facets: ${ctx}.pose_kf.t 必须由每个 coverage 起点开段`)
        }
        const end = coverage[j + 1] as number
        while (sample < t.length && (t[sample] as number) <= end) sample++
      }
      if (sample !== t.length) {
        throw new Error(`agent facets: ${ctx}.pose_kf.t 必须位于 coverage 内`)
      }
    }
  }
  return value as unknown as AgentPlaybackFacet
}
