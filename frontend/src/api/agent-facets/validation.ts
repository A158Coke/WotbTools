
import type { AgentAiReviewFacet, AiReviewValidationMode } from './aiTypes.js'
import type { AgentBattleResult, AgentAuthorInitialPosition, AgentRecorderCamera } from './resultTypes.js'
import type { AgentPlaybackFacet, AgentArmorStateTrack } from './playbackTypes.js'
import { AI_HP_STATE_SET, AI_REVIEW_CONTRACT_VERSION } from './aiTypes.js'


export function validateAgentAiReview(value: unknown, mode: AiReviewValidationMode): AgentAiReviewFacet {
  const doc = assertObject(value, 'ai_review')
  assertFacetVersion(doc.version, 'ai_review.version', AI_REVIEW_CONTRACT_VERSION)
  const battle = assertObject(doc.battle, 'ai_review.battle')
  assertArray(battle.periods, 'ai_review.battle.periods')
  for (const key of ['rosters', 'events', 'settlements']) assertArray(doc[key], `ai_review.${key}`)
  for (const key of ['poses', 'turrets']) {
    if (!Array.isArray(doc[key])) throw new Error(`agent facets: ai_review.${key} 缺失（canonical 投影需要上游 ≥ v0.3.7）`)
  }
  for (const e of doc.events as unknown[]) {
    if (!isObject(e) || typeof e.type !== 'string') throw new Error('agent facets: ai_review.events[] 必须是带 type 的对象')
    if (e.type === 'damage' && typeof e.hp_raw !== 'number') {
      throw new Error('agent facets: ai_review damage.hp_raw 缺失（canonical 投影需要上游 ≥ v0.3.7）')
    }
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
  const evts = doc.events as Array<Record<string, unknown>>
  if (evts.some((e) => e.type === 'damage') && !evts.some((e) => e.type === 'health')) {
    throw new Error('agent facets: ai_review 缺 health（prop3）事件（canonical 投影需要上游 ≥ v0.3.7）')
  }
  return value as unknown as AgentAiReviewFacet
}



export const PLAYBACK_CONTRACT_VERSION = 2

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

function validateReloadEffectiveEvent(value: unknown, path: string): void {
  const e = assertObject(value, path)
  assertFiniteNumber(e.clock, `${path}.clock`)
  assertNonNegativeInteger(e.eid, `${path}.eid`, 0xffffffff)
  const d = assertFiniteNumber(e.duration_s, `${path}.duration_s`)
  if (d <= 0) throw new Error(`agent facets: ${path}.duration_s 必须为正数`)
}

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

function assertFacetVersion(v: unknown, path: string, expected: number = CONTRACT_VERSION): void {
  if (v !== expected) {
    throw new Error(`agent facets: ${path} = ${String(v)}，不支持的契约版本（期望 ${expected}）`)
  }
}

export function validateAgentBattleResult(value: unknown): AgentBattleResult {
  const r = assertObject(value, 'result')
  assertArray(r.players, 'result.players')
  if (typeof r.author_account_id !== 'number') throw new Error('agent facets: result.author_account_id 必须是数值')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    if (key in r) throw new Error(`agent facets: 结果能力不得物化时序键 ${key}`)
  }
  return value as unknown as AgentBattleResult
}

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

export function validateAgentPlayback(value: unknown): AgentPlaybackFacet {
  const pb = assertObject(value, 'playback')
  assertFacetVersion(pb.version, 'playback.version', PLAYBACK_CONTRACT_VERSION)
  assertObject(pb.meta, 'playback.meta')
  for (const key of ['vehicles', 'shots', 'kills', 'periods', 'visibility']) {
    assertArray(pb[key], `playback.${key}`)
  }
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
  if (pb.assault_objective_present !== undefined && typeof pb.assault_objective_present !== 'boolean') {
    throw new Error('agent facets: playback.assault_objective_present 必须是布尔')
  }
  if (pb.destructible_areas !== undefined) {
    assertArray(pb.destructible_areas, 'playback.destructible_areas')
  }
  if (pb.destructible_events !== undefined) {
    assertArray(pb.destructible_events, 'playback.destructible_events')
  }
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
