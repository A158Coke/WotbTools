/**
 * Agent 回放数据消费接口测试（契约 v2）。
 *
 * 契约 v2 = 独立能力（Result / Playback / Shots），giant envelope 与 HofFacet 已从
 * Agent 公开面拆除（breaking，评审 P0-1）。本文件锁定：
 * - 结果能力轻校验（花名册齐备 + 不得物化时序键——"Result-only 不 materialize
 *   Playback"的消费侧镜像）；
 * - Playback 校验（version 锁定 + 数组齐备）；
 * - shots 全局重编号（上游 /api/replay/shots 同规则）；
 * - HoF = BattleResult 的消费方投影（字段映射与上游 HofFacet.from_settlement 逐项
 *   对齐——职责移入消费方，映射语义不变）；
 * - 旧接口（giant envelope 装载 / validateAgentFacetEnvelope）不复存在。
 */

import { describe, expect, it } from 'vitest'

import * as api from './agent-replay-facets.js'
import { buildCanonicalReplayFacts } from '../replay-local/canonical/facts.js'
import {
  AI_HP_STATES,
  PLAYBACK_CONTRACT_VERSION,
  normalizeAgentShotIndices,
  parseAgentPlaybackFromJson,
  parseAgentResultFromJson,
  projectHoF,
  validateAgentAiReview,
  validateAgentBattleResult,
  validateAgentPlayback,
} from './agent-replay-facets.js'

function minimalResult(): Record<string, unknown> {
  return {
    file_name: 'x.wotbreplay',
    timestamp: 1780000000,
    datetime: '2026-06-04 12:00:00',
    room_type: 'Rating',
    map_id: 1,
    map_name: 'x',
    battle_duration_secs: 300,
    winner_team: 1,
    author_account_id: 7,
    author_nickname: 'a',
    author_tank_id: 1,
    author_tank_name: 'T-34',
    author_team: 1,
    author_won: true,
    author: {},
    players: [{
      account_id: 7,
      nickname: 'a',
      team: 1,
      tank_id: 1,
      tank_name: 'T-34',
      base_xp: 900,
      credits_earned: 50000,
      n_shots: 10,
      n_hits_dealt: 6,
      n_penetrations_dealt: 4,
      damage_dealt: 2000,
      damage_blocked: 300,
      damage_assisted_1: 250,
      damage_assisted_2: 120,
      n_hits_received: 3,
      n_penetrations_received: 1,
      n_enemies_damaged: 5,
      n_enemies_destroyed: 2,
      survived: true,
    }, {
      account_id: 8,
      nickname: 'b',
      team: 2,
      tank_id: 2,
      tank_name: 'B',
      base_xp: 400,
      credits_earned: 30000,
      n_shots: 8,
      n_hits_dealt: 3,
      n_penetrations_dealt: 1,
      damage_dealt: 800,
      damage_blocked: 0,
      damage_assisted_1: 0,
      damage_assisted_2: 0,
      n_hits_received: 5,
      n_penetrations_received: 4,
      n_enemies_damaged: 2,
      n_enemies_destroyed: 1,
      survived: false,
      killer_id: 7,
    }],
  }
}

function minimalPlayback(): Record<string, unknown> {
  return {
    version: PLAYBACK_CONTRACT_VERSION,
    meta: { map_id: 1, map_name: 'x', winner_team: 1, friendly_team: 1, author_eid: 0, t_start: 0, samples: 1, duration: 0.1 },
    vehicles: [],
    shots: [],
    kills: [],
    periods: [],
    visibility: [],
  }
}

describe('结果能力（BattleResult 轻校验）', () => {
  it('合法结果通过校验且形状透传', () => {
    const r = validateAgentBattleResult(minimalResult())
    expect(r.players).toHaveLength(2)
    expect(r.winner_team).toBe(1)
  })

  it('players 缺失/非数组 → reject', () => {
    const bad = minimalResult()
    delete (bad as Record<string, unknown>).players
    expect(() => validateAgentBattleResult(bad)).toThrow(/result\.players 必须是数组/)
    expect(() => validateAgentBattleResult({ ...bad, players: 'x' })).toThrow(/result\.players 必须是数组/)
  })

  it('author_account_id 缺失 → reject', () => {
    const bad = minimalResult()
    delete (bad as Record<string, unknown>).author_account_id
    expect(() => validateAgentBattleResult(bad)).toThrow(/author_account_id/)
  })

  it('结果能力物化时序键 → reject（Result-only 不 materialize Playback 的消费侧锁定）', () => {
    const bad = { ...minimalResult(), vehicles: [] }
    expect(() => validateAgentBattleResult(bad)).toThrow(/不得物化时序键 vehicles/)
  })

  it('JSON 通道与对象通道等价', () => {
    expect(parseAgentResultFromJson(JSON.stringify(minimalResult())).players).toHaveLength(2)
  })
})

describe('时序能力（PlaybackData 校验）', () => {
  it('合法 playback 通过且 version 锁定（contract v2）', () => {
    const pb = validateAgentPlayback(minimalPlayback())
    expect(pb.version).toBe(PLAYBACK_CONTRACT_VERSION)
    expect(PLAYBACK_CONTRACT_VERSION).toBe(2)
  })

  it('version 错版 → reject（含 v1 旧产物：错版 WASM 不允许静默半残解析）', () => {
    expect(() => validateAgentPlayback({ ...minimalPlayback(), version: 1 })).toThrow(/不支持的契约版本/)
    expect(() => validateAgentPlayback({ ...minimalPlayback(), version: 3 })).toThrow(/不支持的契约版本/)
    expect(() => {
      const bad = minimalPlayback()
      delete (bad as Record<string, unknown>).version
      validateAgentPlayback(bad)
    }).toThrow(/不支持的契约版本/)
  })

  it('author_shell_timeline：additive，在场时校验 24 位 id 与时钟升序', () => {
    const withTimeline = (author_shell_timeline: unknown) => ({ ...minimalPlayback(), author_shell_timeline })
    expect(validateAgentPlayback(minimalPlayback()).author_shell_timeline).toBeUndefined()
    const ok = [{ t: 5, shell_id: 32362 }, { t: 29.4, shell_id: 32618 }]
    expect(validateAgentPlayback(withTimeline(ok)).author_shell_timeline).toEqual(ok)
    expect(() => validateAgentPlayback(withTimeline([{ t: 5, shell_id: 0x1000000 }]))).toThrow(/shell_id/)
    expect(() => validateAgentPlayback(withTimeline([{ t: 9, shell_id: 1 }, { t: 5, shell_id: 2 }]))).toThrow(/升序/)
  })

  it('contract v2 新键：缺省合法、非数组拒绝', () => {
    const ok = validateAgentPlayback(minimalPlayback())
    expect(ok.supremacy_bases).toBeUndefined()
    const bad = minimalPlayback()
    ;(bad as Record<string, unknown>).supremacy_bases = 'x'
    expect(() => validateAgentPlayback(bad)).toThrow(/playback\.supremacy_bases 必须是数组/)
  })

  it('消耗品 lifecycle（v0.4.18 additive）：缺省合法、形状错误 fail closed', () => {
    const ok = minimalPlayback()
    ;(ok as Record<string, unknown>).consumables = [{
      clock: 10, eid: 7, wire_code: 9, state: 2, state_name: 'ACTIVATED',
      duration_s: 20, ends_at: 30, ever_activated: true, slot: 1, logical_item_id: 'ADRENALINE',
    }]
    expect(validateAgentPlayback(ok).consumables).toHaveLength(1)
    expect(() => validateAgentPlayback({ ...minimalPlayback(), consumables: {} }))
      .toThrow(/playback\.consumables 必须是数组/)
    expect(() => validateAgentPlayback({
      ...minimalPlayback(),
      consumables: [{ clock: 10, eid: 7, wire_code: 9, state: '2' }],
    })).toThrow(/consumables\[0\]\.state/)
    expect(() => validateAgentPlayback({
      ...minimalPlayback(),
      consumables: [{ clock: 10, eid: 7, wire_code: 9, state: 2, slot: 3 }],
    })).toThrow(/consumables\[0\]\.slot/)
  })

  it('装填遥测（v0.3.9）：缺省合法、合法 shape 通过、数组/元素 primitive 漂移 fail closed', () => {
    const ok = minimalPlayback()
    ;(ok as Record<string, unknown>).reloads = [
      { clock: 10, eid: 7, phase: 3, duration_s: 8, count: null },
      { clock: 14, eid: 7, phase: 1, duration_s: null, count: 2 },
    ]
    ;(ok as Record<string, unknown>).reload_effective = [
      { clock: 9.5, eid: 7, duration_s: 8 },
      { clock: 14, eid: 7, duration_s: 4 },
    ]
    const validated = validateAgentPlayback(ok)
    expect(validated.reloads).toHaveLength(2)
    expect(validated.reload_effective).toHaveLength(2)

    expect(() => validateAgentPlayback({ ...minimalPlayback(), reloads: { clock: 1 } }))
      .toThrow(/playback\.reloads 必须是数组/)
    expect(() => validateAgentPlayback({ ...minimalPlayback(), reloads: [42] }))
      .toThrow(/playback\.reloads\[0\] 必须是对象/)
    expect(() => validateAgentPlayback({
      ...minimalPlayback(),
      reloads: [{ clock: 10, eid: 7, phase: '3', duration_s: 8, count: null }],
    })).toThrow(/reloads\[0\]\.phase/)
    expect(() => validateAgentPlayback({
      ...minimalPlayback(),
      reloads: [{ clock: 10, eid: 7, phase: 3, duration_s: undefined, count: null }],
    })).toThrow(/reloads\[0\]\.duration_s/)
    expect(() => validateAgentPlayback({
      ...minimalPlayback(),
      reload_effective: [{ clock: 14, eid: 7, duration_s: null }],
    })).toThrow(/reload_effective\[0\]\.duration_s/)
  })

  /**
   * raw `reloads[]` = producer 的原始透传（arena update subtype 15/16/17 的原始 f3）。
   * producer **没有**「正时长」invariant：真实 `cw-training-15-14-example.wotbreplay`
   * 就含 `duration_s: -0.03939394`（`reloads[50]`，phase=4 的时长变更差值）。
   * trust boundary 只锁定 producer 真正保证的线形状 = **`null` 或有限数值**；
   * `> 0` 是消费方（`scene/reloadBar.js#isUsablePhase`）的语义规则，不得提升成 wire contract。
   */
  it('raw reloads[].duration_s（v0.3.9 producer 原始透传）：null / 0 / 负 finite / 正 finite 全部接受', () => {
    const cases: Array<number | null> = [null, 0, -0.03939394, -3, 0.89, 8]
    for (const duration_s of cases) {
      const pb = minimalPlayback()
      ;(pb as Record<string, unknown>).reloads = [{ clock: 10, eid: 7, phase: 3, duration_s, count: null }]
      const validated = validateAgentPlayback(pb)
      // 忠实保留：trust boundary 不得改写 / 丢弃原始 producer 事实
      expect(validated.reloads?.[0].duration_s, `duration_s=${String(duration_s)}`).toBe(duration_s)
    }
  })

  it('raw reloads[].duration_s：非有限 / 非数值一律 fail closed（不得静默降级）', () => {
    const rejects: Array<[unknown, RegExp]> = [
      [Number.NaN, /reloads\[0\]\.duration_s 必须是有限数值或 null/],
      [Number.POSITIVE_INFINITY, /reloads\[0\]\.duration_s 必须是有限数值或 null/],
      [Number.NEGATIVE_INFINITY, /reloads\[0\]\.duration_s 必须是有限数值或 null/],
      ['8', /reloads\[0\]\.duration_s 必须是有限数值或 null/],
      [undefined, /reloads\[0\]\.duration_s 必须是有限数值或 null/],
      [true, /reloads\[0\]\.duration_s 必须是有限数值或 null/],
    ]
    for (const [duration_s, pattern] of rejects) {
      expect(() => validateAgentPlayback({
        ...minimalPlayback(),
        reloads: [{ clock: 10, eid: 7, phase: 3, duration_s, count: null }],
      }), `duration_s=${String(duration_s)}`).toThrow(pattern)
    }
  })

  it('raw reloads[] 其余字段（v0.3.9）：clock/eid/phase/count 漂移一律 fail closed', () => {
    const base = { clock: 10, eid: 7, phase: 3, duration_s: 8, count: null }
    const rejects: Array<[Record<string, unknown>, RegExp]> = [
      [{ ...base, clock: Number.NaN }, /reloads\[0\]\.clock/],
      [{ ...base, clock: '10' }, /reloads\[0\]\.clock/],
      [{ ...base, eid: -1 }, /reloads\[0\]\.eid/],
      [{ ...base, eid: 1.5 }, /reloads\[0\]\.eid/],
      [{ ...base, eid: '7' }, /reloads\[0\]\.eid/],
      [{ ...base, phase: 256 }, /reloads\[0\]\.phase/],
      [{ ...base, phase: null }, /reloads\[0\]\.phase/],
      [{ ...base, count: -1 }, /reloads\[0\]\.count/],
      [{ ...base, count: 2.5 }, /reloads\[0\]\.count/],
      [{ ...base, count: '2' }, /reloads\[0\]\.count/],
    ]
    for (const [event, pattern] of rejects) {
      expect(() => validateAgentPlayback({ ...minimalPlayback(), reloads: [event] }), JSON.stringify(event))
        .toThrow(pattern)
    }
  })

  /**
   * `reload_effective[]`（method 35）与 raw `reloads[]` 不是同一个东西：它表示「当前生效的
   * **完整装填配置时长**」，`finite && > 0` 是 producer 自己的 invariant——这里继续严格锁定。
   */
  it('reload_effective[].duration_s（method 35）保持严格：finite 且 > 0', () => {
    const base = { clock: 14, eid: 7 }
    const rejects: Array<[unknown, RegExp]> = [
      [0, /reload_effective\[0\]\.duration_s 必须为正数/],
      [-1, /reload_effective\[0\]\.duration_s 必须为正数/],
      [Number.NaN, /reload_effective\[0\]\.duration_s 必须是有限数值/],
      [Number.POSITIVE_INFINITY, /reload_effective\[0\]\.duration_s 必须是有限数值/],
      [null, /reload_effective\[0\]\.duration_s 必须是有限数值/],
      ['8', /reload_effective\[0\]\.duration_s 必须是有限数值/],
      [undefined, /reload_effective\[0\]\.duration_s 必须是有限数值/],
    ]
    for (const [duration_s, pattern] of rejects) {
      expect(() => validateAgentPlayback({
        ...minimalPlayback(),
        reload_effective: [{ ...base, duration_s }],
      }), `duration_s=${String(duration_s)}`).toThrow(pattern)
    }
    // method 35 只存在于本方；`eid` 越界同样 fail closed
    expect(() => validateAgentPlayback({
      ...minimalPlayback(),
      reload_effective: [{ clock: 14, eid: -1, duration_s: 4 }],
    })).toThrow(/reload_effective\[0\]\.eid/)
  })

  it('单基地键（v0.3.1）：缺省合法、assault_bases 非数组拒绝、objective 非布尔拒绝', () => {
    const ok = validateAgentPlayback(minimalPlayback())
    expect(ok.assault_bases).toBeUndefined()
    // 目标存在性独立于进度：只有 objective 没有 bases 也合法（无占领活动的单基地场次）
    const objOnly = minimalPlayback()
    ;(objOnly as Record<string, unknown>).assault_objective_present = true
    expect(validateAgentPlayback(objOnly).assault_objective_present).toBe(true)
    const badArr = minimalPlayback()
    ;(badArr as Record<string, unknown>).assault_bases = 'x'
    expect(() => validateAgentPlayback(badArr)).toThrow(/playback\.assault_bases 必须是数组/)
    const badBool = minimalPlayback()
    ;(badBool as Record<string, unknown>).assault_objective_present = 'yes'
    expect(() => validateAgentPlayback(badBool)).toThrow(/assault_objective_present 必须是布尔/)
  })

  it('缺数组键 → reject', () => {
    const bad = minimalPlayback()
    delete (bad as Record<string, unknown>).shots
    expect(() => validateAgentPlayback(bad)).toThrow(/playback\.shots 必须是数组/)
  })

  it('JSON 通道等价', () => {
    expect(parseAgentPlaybackFromJson(JSON.stringify(minimalPlayback())).meta.map_id).toBe(1)
  })
})

describe('独立炮塔实体（PlaybackData additive，原始轨迹边界）', () => {
  // 合成实体与坐标；不持久化用户回放中的实体/账号/轨迹。
  function turret(): api.AgentDetachedTurretTrack {
    return {
      eid: 101,
      vehicle_eid: 7,
      coverage: [10, 12],
      pose_kf: { t: [10, 11], pos: [1, 2, 3, 4, 5, 6], yaw: [0, 0.2], pitch: [0.1, 0.3], roll: [0, 0.4] },
    }
  }

  function playback(track: unknown): Record<string, unknown> {
    return { ...minimalPlayback(), vehicles: [{ eid: 7 }], detached_turrets: [track] }
  }

  it('旧产物缺省与空数组兼容，不提升原有车辆字段校验', () => {
    const old = { ...minimalPlayback(), vehicles: [{ eid: 0, pose_kf: null }, null] }
    expect(validateAgentPlayback(old).detached_turrets).toBeUndefined()
    expect(validateAgentPlayback({ ...old, detached_turrets: [] }).detached_turrets).toEqual([])
    const kf = { t: [0], pos: [0, 0, 0], yaw: [0], pitch: [0] }
    expect(validateAgentPlayback({ ...minimalPlayback(), vehicles: [{ eid: 7, pose_kf: kf }] }).vehicles[0].pose_kf)
      .toBe(kf)
  })

  it('合法多帧原样透传；段内末帧后保持不要求额外伪造末端帧', () => {
    const track = turret()
    const pb = playback(track)
    expect(validateAgentPlayback(pb)).toBe(pb)
    expect(validateAgentPlayback(pb).detached_turrets?.[0]).toBe(track)
    expect(parseAgentPlaybackFromJson(JSON.stringify(pb)).detached_turrets?.[0]).toEqual(track)
  })

  it('单帧零长覆盖区间合法，正 u32 上界合法', () => {
    const track = turret()
    track.eid = 0xffffffff
    track.coverage = [10, 10]
    track.pose_kf = { t: [10], pos: [1, 2, 3], yaw: [0], pitch: [0], roll: [0] }
    expect(validateAgentPlayback(playback(track)).detached_turrets?.[0]).toBe(track)
  })

  it('多 AoI 段分别由初帧锚定，空档不生成观测', () => {
    const track = turret()
    track.coverage = [10, 11, 20, 22]
    track.pose_kf = {
      t: [10, 10.5, 20, 21], pos: [1, 2, 3, 2, 3, 4, 8, 9, 10, 9, 10, 11],
      yaw: [0, 0.2, 1, 1.2], pitch: [0, 0.1, 0.2, 0.3], roll: [0, 0.3, 0.4, 0.5],
    }
    expect(validateAgentPlayback(playback(track)).detached_turrets?.[0]).toEqual(track)
  })

  it.each([null, {}, 42, 'x'])('字段非数组 fail closed：%s', (value) => {
    expect(() => validateAgentPlayback({ ...minimalPlayback(), detached_turrets: value }))
      .toThrow(/agent facets: playback\.detached_turrets 必须是数组/)
  })

  it.each([null, [], 42, 'x'])('轨迹非对象 fail closed：%s', (value) => {
    expect(() => validateAgentPlayback(playback(value))).toThrow(/detached_turrets\[0\] 必须是对象/)
  })

  it('对象通道中的稀疏数组也 fail closed，不跳过缺失元素', () => {
    expect(() => validateAgentPlayback({ ...playback(turret()), detached_turrets: Array(1) }))
      .toThrow(/detached_turrets\[0\] 必须是对象/)
    for (const key of ['t', 'pos', 'yaw', 'pitch', 'roll'] as const) {
      const track = turret()
      delete track.pose_kf[key][1]
      expect(() => validateAgentPlayback(playback(track))).toThrow(/必须是有限数值/)
    }
  })

  it.each(['eid', 'vehicle_eid'] as const)('%s 必须为正 u32，不能用零/负数/浮点/非有限数/越界/字符串', (key) => {
    for (const value of [0, -1, 1.5, NaN, Infinity, 0x100000000, '7', null, undefined]) {
      const track = { ...turret(), [key]: value }
      expect(() => validateAgentPlayback(playback(track)), `${key}=${String(value)}`).toThrow(/detached_turrets\[0\]/)
    }
  })

  it('炮塔 ID 不得自指、冒充车辆或与另一炮塔重复；未知所属车辆拒绝', () => {
    expect(() => validateAgentPlayback(playback({ ...turret(), eid: 7 }))).toThrow(/eid 重复或与车辆实体冲突/)
    expect(() => validateAgentPlayback(playback({ ...turret(), vehicle_eid: 101 }))).toThrow(/eid 重复或与车辆实体冲突/)
    expect(() => validateAgentPlayback(playback({ ...turret(), vehicle_eid: 8 }))).toThrow(/vehicle_eid 未对应 playback\.vehicles/)
    expect(() => validateAgentPlayback({ ...playback(turret()), detached_turrets: [turret(), turret()] }))
      .toThrow(/detached_turrets\[1\]\.eid 重复/)
    expect(() => validateAgentPlayback({ ...playback(turret()), detached_turrets: [turret(), { ...turret(), eid: 102 }] }))
      .toThrow(/vehicle_eid 对应多个独立炮塔/)
    expect(() => validateAgentPlayback({ ...playback(turret()), vehicles: [{ eid: 7 }, { eid: 101 }] }))
      .toThrow(/eid 重复或与车辆实体冲突/)
  })

  it.each([null, {}, [], [10], [10, 12, 20], [12, 10], [10, 12, 11, 13], [10, 12, 12, 13], [20, 22, 10, 12], [10, NaN], [10, Infinity], [-1, 12]])
    ('coverage 必须是有限、有序、互不重叠的非空区间对：%s', (coverage) => {
      expect(() => validateAgentPlayback(playback({ ...turret(), coverage }))).toThrow(/coverage/)
    })

  it.each([null, [], 42, undefined])('pose_kf 必须为对象：%s', (pose_kf) => {
    expect(() => validateAgentPlayback(playback({ ...turret(), pose_kf }))).toThrow(/pose_kf 必须是对象/)
  })

  it.each(['t', 'pos', 'yaw', 'pitch', 'roll'] as const)('pose_kf.%s 缺省/非数组/非有限元素拒绝', (key) => {
    for (const value of [undefined, null, 'x', [NaN], [Infinity], ['1']]) {
      const track = turret()
      track.pose_kf = { ...track.pose_kf, [key]: value } as never
      expect(() => validateAgentPlayback(playback(track)), `${key}=${String(value)}`).toThrow(/pose_kf/)
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      const track = turret()
      track.pose_kf[key][0] = value
      expect(() => validateAgentPlayback(playback(track)), `${key}=${value}`).toThrow(/必须是有限数值/)
    }
  })

  it.each(['pos', 'yaw', 'pitch', 'roll'] as const)('pose_kf.%s 长度必须严格对应 N', (key) => {
    for (const delta of [-1, 1]) {
      const track = turret()
      const column = track.pose_kf[key]
      if (delta < 0) column.pop()
      else column.push(0)
      expect(() => validateAgentPlayback(playback(track))).toThrow(/列长不一致/)
    }
  })

  it('时间至少一帧、必须严格升序；不接受重复或倒序', () => {
    const track = turret()
    track.pose_kf.t = []
    expect(() => validateAgentPlayback(playback(track))).toThrow(/至少有一帧/)
    for (const t of [[10, 10], [11, 10]]) {
      expect(() => validateAgentPlayback(playback({ ...turret(), pose_kf: { ...turret().pose_kf, t } })))
        .toThrow(/必须严格升序/)
    }
  })

  it('不接受开段未来首帧、段外采样、覆盖空段或跨未知段采样', () => {
    const cases = [
      { coverage: [9, 12], t: [10, 11] },
      { coverage: [10.5, 12], t: [10, 11] },
      { coverage: [10, 10.5], t: [10, 11] },
      { coverage: [10, 12, 20, 22], t: [10, 11] },
      { coverage: [10, 10.5, 20, 22], t: [10, 11] },
    ]
    for (const { coverage, t } of cases) {
      const track = turret()
      track.coverage = coverage
      track.pose_kf.t = t
      expect(() => validateAgentPlayback(playback(track))).toThrow(/pose_kf\.t 必须/)
    }
  })
})

describe('复活生命轨道（PlaybackData additive，上游 v0.4.8）', () => {
  const lifePlayback = (vehicle: Record<string, unknown>) =>
    ({ ...minimalPlayback(), vehicles: [{ eid: 7, death_t: 10, ...vehicle }] })
  const vehicleOf = (pb: unknown) =>
    (validateAgentPlayback(pb).vehicles[0] as unknown as Record<string, unknown>)

  it('缺省与空数组兼容：缺字段 = 死亡终态，不提升原有车辆字段校验', () => {
    const legacy = { ...minimalPlayback(), vehicles: [{ eid: 7 }] }
    expect(vehicleOf(legacy).death_times).toBeUndefined()
    expect(vehicleOf(legacy).resurrection_times).toBeUndefined()
    expect(vehicleOf(lifePlayback({ death_times: [], resurrection_times: [] })).death_times)
      .toEqual([])
  })

  it('合法多死多复活原样透传（对象通道与 JSON 通道同规则）', () => {
    const pb = lifePlayback({ death_times: [10, 20], resurrection_times: [15] })
    expect(vehicleOf(pb).death_times).toEqual([10, 20])
    expect(vehicleOf(pb).resurrection_times).toEqual([15])
    expect(vehicleOf(parseAgentPlaybackFromJson(JSON.stringify(pb))).death_times).toEqual([10, 20])
  })

  it('非数组漂移 fail closed（不静默降级为缺省）', () => {
    for (const value of [10, '10', { t: 10 }]) {
      expect(() => validateAgentPlayback(lifePlayback({ death_times: value })))
        .toThrow(/vehicles\[0\]\.death_times 必须是数组/)
      expect(() => validateAgentPlayback(lifePlayback({ resurrection_times: value })))
        .toThrow(/vehicles\[0\]\.resurrection_times 必须是数组/)
    }
  })

  it('元素必须是有限、非负、非降序时刻', () => {
    const bad = [[Number.NaN], [Number.POSITIVE_INFINITY], [-1], [10, 5], [0, Number.NaN]]
    for (const times of bad) {
      expect(() => validateAgentPlayback(lifePlayback({ death_times: times })))
        .toThrow(/vehicles\[0\]\.death_times/)
    }
    // 同刻允许（非降序）：边界只拦下不可能的生命史，不为上游排序保证代替 fail
    expect(() => validateAgentPlayback(lifePlayback({ death_times: [10, 10] }))).not.toThrow()
  })
})

describe('normalizeAgentShotIndices（/api/replay/shots 同规则全局重编号）', () => {
  it('time_s 排序 + index 从 1 起连续重编（作者/他人两路局部 index 收敛）', () => {
    const shots = [
      { index: 0, time_s: 22.6, shooter_name: 'b' },
      { index: 3, time_s: 20.6, shooter_name: 'a' },
      { index: 0, time_s: 47.1, shooter_name: 'c' },
    ]
    const out = normalizeAgentShotIndices(shots as never[])
    expect(out.map((s) => s.index)).toEqual([1, 2, 3])
    expect(out.map((s) => s.shooter_name)).toEqual(['a', 'b', 'c'])
  })

  it('不改输入数组的顺序（slice 后排序；index 就地重写——同一对象流向查看器）', () => {
    const a = { index: 9, time_s: 30 }
    const b = { index: 1, time_s: 10 }
    const shots = [a, b]
    const out = normalizeAgentShotIndices(shots as never[])
    expect(shots.map((s) => s.time_s)).toEqual([30, 10])
    expect(out[0]).toBe(b)
    expect(out.map((s) => s.index)).toEqual([1, 2])
  })
})

describe('projectHoF（BattleResult 的消费方投影；上游 HofFacet.from_settlement 映射逐项对齐）', () => {
  it('字段映射：结算原名 → HoF 提交名（damage_assisted_1/2、n_hits_dealt、base_xp、credits_earned）', () => {
    const sub = projectHoF(validateAgentBattleResult(minimalResult()))
    expect(sub.version).toBe(1)
    expect(sub.battle).toEqual({
      start_time: 1780000000,
      map_id: 1,
      map_name: 'x',
      room_type: 'Rating',
      winner: 1,
      duration_secs: null, // root5 未解码；宁缺勿冒充
    })
    const [p1, p2] = sub.entries
    expect(p1).toMatchObject({
      account_id: 7,
      nickname: 'a',
      team: 1,
      tank_id: 1,
      damage_dealt: 2000,
      damage_blocked: 300,
      damage_assisted_spot: 250,   // damage_assisted_1
      damage_assisted_track: 120,  // damage_assisted_2
      kills: 2,                    // n_enemies_destroyed
      n_shots: 10,
      n_hits: 6,                   // n_hits_dealt
      n_penetrations: 4,           // n_penetrations_dealt
      survived: true,
      xp: 900,                     // base_xp
      credits: 50000,              // credits_earned
    })
    // 无对应结算值 → 键不存在（unknown ≠ 0；undefined 键不序列化）
    expect('killer_id' in p1).toBe(false)
    expect(p2.killer_id).toBe(7)
  })

  it('投影是纯函数：不修改输入 Result', () => {
    const r = validateAgentBattleResult(minimalResult())
    const snapshot = JSON.stringify(r)
    projectHoF(r)
    expect(JSON.stringify(r)).toBe(snapshot)
  })
})

describe('契约 v2 边界（评审 P0-1 验收的消费侧锁定）', () => {
  it('旧 giant-envelope 接口不复存在（parseAgentFacets*/validateAgentFacetEnvelope 已拆除）', () => {
    expect((api as Record<string, unknown>).parseAgentFacetsFromBytes).toBeUndefined()
    expect((api as Record<string, unknown>).parseAgentFacetsFromJson).toBeUndefined()
    expect((api as Record<string, unknown>).validateAgentFacetEnvelope).toBeUndefined()
  })

  it('Agent 公开面无 HoF 能力：模块只暴露 HoF 投影（消费方职责），无 HofFacet 装载', () => {
    expect(typeof api.projectHoF).toBe('function')
    expect((api as Record<string, unknown>).HofFacet).toBeUndefined()
    expect((api as Record<string, unknown>).parseAgentHofFromBytes).toBeUndefined()
  })
})

// ---------- AiReview 信任边界：hp_state 两条口径（当前 producer / legacy 兼容） ----------

/**
 * `hp_state` 的两条路径在信任边界必须分开（本 PR 的 blocker）：
 *
 *  - `current-producer`（= `parseAgentAiReviewFromBytes`，当前正式 pin v0.4.9 的 WASM 路径）：
 *    `damage`/`health.hp_state` **必填**。producer 漂移（字段消失）必须 fail closed——静默回退
 *    legacy 会把 0xFFFE 档弹药架殉爆重新判成存活（正是本 PR 修的 bug）。
 *  - `legacy-compatible`（旧 artifact / 旧 JSON fixture / 显式 legacy 摄入）：字段可缺省，
 *    缺省即 legacy raw 分类（仅 0/0xFFFD 终态，其余负值仍是未证明哨兵）。
 */
describe('AiReview 信任边界（hp_state：current-producer 必填 / legacy 可缺省）', () => {
  function minimalAiReview(events: unknown[]): Record<string, unknown> {
    return {
      version: 1,
      battle: {
        start_time: 1780000000, map_id: 1, map_name: 'x', room_type: 'Rating', winner: 1,
        duration_secs: 100,
        periods: [
          { clock: 10, period: 3, remaining_s: 0, duration_s: 100 },
          { clock: 110, period: 4, remaining_s: 0, duration_s: 0 },
        ],
      },
      rosters: [{ eid: 21, account_id: 7, team: 1, tank_id: 1, tank_name: 'T-34', is_author: true }],
      events,
      settlements: [],
      poses: [],
      turrets: [],
    }
  }

  const healthEvent = (over: Record<string, unknown> = {}) =>
    ({ type: 'health', t: 20, eid: 21, hp_raw: 0xfffe, hp_state: 'terminal', ...over })
  const damageEvent = (over: Record<string, unknown> = {}) =>
    ({ type: 'damage', t: 20, victim_eid: 21, hp: 0, hp_raw: 0xfffe, hp_state: 'terminal', source_eid: 22, cause: 0, ...over })

  /** 去掉 hp_state 键（缺省 = 旧产物线形状；undefined 键与"不发送"在 JSON 上等价，这里显式删除更贴近产物） */
  const withoutState = (e: Record<string, unknown>) => {
    const { hp_state: _state, ...rest } = e
    return rest
  }

  /** canonical 层对最后一条 health 事件的分类（legacy 路径要走真分类，不只是形状检查） */
  function sampleOf(events: unknown[]) {
    const facet = validateAgentAiReview(minimalAiReview(events), 'legacy-compatible')
    const facts = buildCanonicalReplayFacts({ aiReview: facet })!
    return facts.hpSamples.get(21)!.at(-1)!
  }

  it('current-producer：合法 current/zero/terminal 全部放行（含 damage 与 health 两处）', () => {
    for (const hp_state of AI_HP_STATES) {
      expect(
        () => validateAgentAiReview(minimalAiReview([damageEvent({ hp_state }), healthEvent({ hp_state })]), 'current-producer'),
        `hp_state=${hp_state}`,
      ).not.toThrow()
    }
  })

  it('current-producer：damage.hp_state 缺失 → reject（不得静默进入 legacy 回退）', () => {
    expect(() => validateAgentAiReview(minimalAiReview([withoutState(damageEvent()), healthEvent()]), 'current-producer'))
      .toThrow(/damage\.hp_state 缺失/)
  })

  it('current-producer：health.hp_state 缺失 → reject', () => {
    expect(() => validateAgentAiReview(minimalAiReview([damageEvent(), withoutState(healthEvent())]), 'current-producer'))
      .toThrow(/health\.hp_state 缺失/)
  })

  it('current-producer：非法枚举 / 非字符串 → reject（不静默回退 hp_raw）', () => {
    for (const bad of ['dead', 'TERMINAL', 'DEATH_TERMINAL', 1, null, true]) {
      expect(
        () => validateAgentAiReview(minimalAiReview([damageEvent({ hp_state: bad }), healthEvent()]), 'current-producer'),
        String(bad),
      ).toThrow(/hp_state 非法/)
    }
  })

  it('legacy-compatible：字段缺省放行，缺省分类仍是 legacy（0xFFFE/0xFFFF 未知、0xFFFD 终态）', () => {
    const cases: Array<[number, string, boolean | null]> = [
      [0xfffe, 'UNKNOWN_OTHER', null],        // −2：未证明哨兵 → 不判死
      [0xffff, 'UNKNOWN_FFFF', null],         // −1：未证明哨兵 → 不判死
      [0xfffd, 'DEATH_TERMINAL_FFFD', false], // −3：legacy 已证明终态（行为不变）
      [0x0000, 'HP_ZERO_TERMINAL', false],
      [1406, 'CURRENT_HP', true],
    ]
    for (const [hp_raw, expectedState, alive] of cases) {
      const sample = sampleOf([
        withoutState(healthEvent({ hp_raw })),
        withoutState(damageEvent({ hp_raw })),
      ])
      expect(sample.rawState, `hp_raw=0x${hp_raw.toString(16)}`).toBe(expectedState)
      expect(sample.alive, `hp_raw=0x${hp_raw.toString(16)}`).toBe(alive)
    }
  })

  it('legacy-compatible 也拒绝在场非法枚举（只放宽「缺省」，不放宽「漂移」）', () => {
    expect(() => validateAgentAiReview(
      minimalAiReview([damageEvent({ hp_state: 'dead' }), healthEvent()]), 'legacy-compatible'))
      .toThrow(/hp_state 非法/)
  })
})

// ---------- 契约 v0.1.9：parseShotReplays 包装形状 + eid 联表富化 ----------

describe('normalizeAgentShotsOutcome', () => {
  const shot = { index: 1, time_s: 1, damage: 100, target_name: 'x', is_kill: false, shooter_eid: 2 }

  it('v0.1.9 包装形状：ok 态透传 others 统计与 author_eid', () => {
    const o = api.normalizeAgentShotsOutcome({
      shots: [shot],
      author_path: 'ok',
      author_eid: 7,
      others: { total_launches: 30, skipped_no_endpoint: 1, skipped_no_target_state: 2, muzzle_fallback: 3 },
    })
    expect(o.author_path).toBe('ok')
    expect(o.author_error).toBeUndefined()
    expect(o.author_eid).toBe(7)
    expect(o.others).toEqual({ total_launches: 30, skipped_no_endpoint: 1, skipped_no_target_state: 2, muzzle_fallback: 3 })
    expect(o.shots).toHaveLength(1)
  })

  it('v0.1.9 包装形状：error 态必须携带 author_error（fail-visible）', () => {
    const o = api.normalizeAgentShotsOutcome({
      shots: [],
      author_path: 'error',
      author_error: 'shot #1: 受击者实体 0x123 不在 type=5 名册中',
      author_eid: 7,
      others: { total_launches: 9, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 },
    })
    expect(o.author_path).toBe('error')
    expect(o.author_error).toContain('type=5 名册')
    expect(() => api.normalizeAgentShotsOutcome({ shots: [], author_path: 'error' })).toThrow(/author_error/)
  })

  it('旧裸数组产物归一化（author 状态不可知 → ok / eid 0 / others 全 0）', () => {
    const o = api.normalizeAgentShotsOutcome([shot, { ...shot, index: 2 }])
    expect(o.author_path).toBe('ok')
    expect(o.author_eid).toBe(0)
    expect(o.others?.total_launches).toBe(0)
    expect(o.shots).toHaveLength(2)
  })

  it('上游 v0.4.20：others 缺失而 others_error 在场 → 透传（fail-visible）', () => {
    const o = api.normalizeAgentShotsOutcome({
      shots: [shot],
      author_path: 'ok',
      author_eid: 7,
      others_error: '他人路径: shotId=9 非续段发射缺少命中通知窗口（build_notice_windows 不变量破坏）',
    })
    expect(o.others).toBeUndefined()
    expect(o.others_error).toContain('build_notice_windows 不变量破坏')
  })

  it('上游 v0.4.20：others 与 others_error 皆缺 = schema drift（拒绝）', () => {
    expect(() => api.normalizeAgentShotsOutcome({ shots: [], author_path: 'ok', author_eid: 0 }))
      .toThrow(/others_error/)
  })

  it('非法顶层拒绝', () => {
    expect(() => api.normalizeAgentShotsOutcome({ nope: true })).toThrow(/shots 数组或/)
  })

  it('trust boundary 严格化：对象形状的 author_path 只收 "ok"|"error"', () => {
    // 缺失（schema drift / 错版 WASM）→ throw，不得静默伪装成正常解析
    expect(() => api.normalizeAgentShotsOutcome({ shots: [] })).toThrow(/author_path/)
    // 值漂移（大小写/未知枚举）→ throw
    expect(() => api.normalizeAgentShotsOutcome({ shots: [], author_path: 'Error', author_error: 'x' })).toThrow(/author_path/)
    expect(() => api.normalizeAgentShotsOutcome({ shots: [], author_path: 'OK' })).toThrow(/author_path/)
    // 合法值放行
    expect(api.normalizeAgentShotsOutcome({ shots: [], author_path: 'ok', author_eid: 1, others: {} }).author_path).toBe('ok')
  })
})

describe('isShotHit（hit authority = target_eid，评审 blocker 回归）', () => {
  it('作者在案命中（target_eid 有值）即使 hit_flags=0 也是命中——不再误判 miss', () => {
    expect(api.isShotHit({ target_eid: 283127376 })).toBe(true)
  })
  it('无受击方 eid → 未命中（不回退昵称/hit_flags 双语义）', () => {
    // 契约类型是 number | undefined；null 属坏生产者输出，运行时同样按缺失处理
    expect(api.isShotHit({ target_eid: undefined })).toBe(false)
    expect(api.isShotHit({ target_eid: null } as unknown as api.AgentShotReplay)).toBe(false)
  })
  it('非作者同规则（单一权威，无双语义）', () => {
    expect(api.isShotHit({ target_eid: 1 })).toBe(true)
  })
})

describe('enrichShotsFromRoster（eid 联表）', () => {
  // 国服场次同构 fixture：7v7 中文昵称 + 1 台 team=0（联表失败的观察者）
  const vehicles = [
    ...Array.from({ length: 7 }, (_, i) => ({ eid: 100 + i, nickname: `兰亭公子苏${i}`, team: 1, tank_id: 30085 + i, is_author: i === 0 })),
    ...Array.from({ length: 7 }, (_, i) => ({ eid: 200 + i, nickname: `他们都叫我袁弟呀${i}`, team: 2, tank_id: 40085 + i })),
    { eid: 999, nickname: '', team: 0, tank_id: 0 }, // 未知阵营
  ]
  const shot = (over: Record<string, unknown>) => ({
    index: 1, time_s: 1, damage: 100, target_name: '', is_kill: false,
    shooter_eid: 100, target_eid: 200, ...over,
  } as api.AgentShotReplay)

  it('eid 联表：昵称缺失/冲突不影响 tank_id 与阵营归属', () => {
    const shots = [
      shot({ shooter_eid: 100, target_eid: 200 }),           // 常规
      shot({ shooter_eid: 200, target_eid: 101 }),           // 敢打我方（敌视角联表）
      shot({ shooter_eid: 999, target_eid: 205 }),           // 未知阵营射手
      shot({ shooter_eid: 100, target_eid: 999 }),           // 打向未知阵营（不产 tank_id）
    ]
    api.enrichShotsFromRoster(shots, vehicles)
    expect(shots[0].shooter_tank_id).toBe(30085)
    expect(shots[0].target_tank_id).toBe(40085)
    expect(shots[0].shooter_team).toBe('ally')      // 射手 = 作者（eid 100, is_author）
    expect(shots[1].shooter_team).toBe('enemy')     // eid 200 ∈ team2 ≠ 作者 team1
    expect(shots[1].target_tank_id).toBe(30086)
    expect(shots[2].shooter_team).toBeUndefined()   // team=0：不归入任何一队
    expect(shots[3].target_tank_id).toBeUndefined() // team=0 无 tank_id：富化缺省
  })

  it('unknown team（team=0）带非零 tank_id：tank_id 正常富化、阵营必须 undefined（评审 blocker 回归）', () => {
    const withUnknownTank = [
      ...vehicles,
    ]
    withUnknownTank[withUnknownTank.length - 1] = { eid: 999, nickname: '观察者', team: 0, tank_id: 555 }
    const shots = [
      shot({ shooter_eid: 999, target_eid: 200 }),   // unknown 射手有真实坦克
      shot({ shooter_eid: 100, target_eid: 999 }),   // 打向 unknown（有坦克）
    ]
    api.enrichShotsFromRoster(shots, withUnknownTank)
    expect(shots[0].shooter_tank_id).toBe(555)          // 富化照常
    expect(shots[0].shooter_team).toBeUndefined()       // 绝不因 0 !== 1 被染成 enemy
    expect(shots[1].target_tank_id).toBe(555)
  })

  it('作者自身 team=0（无法定向）：所有射击不做 ally/enemy 分类', () => {
    const noAuthorSide = [
      { eid: 100, nickname: 'a', team: 0, tank_id: 1, is_author: true },
      { eid: 200, nickname: 'b', team: 2, tank_id: 2 },
    ]
    const shots = [shot({ shooter_eid: 100, target_eid: 200 })]
    api.enrichShotsFromRoster(shots, noAuthorSide)
    expect(shots[0].shooter_tank_id).toBe(1)
    expect(shots[0].target_tank_id).toBe(2)
    expect(shots[0].shooter_team).toBeUndefined()       // authorTeam=0：0===0 不得伪装 ally
  })

  it('已知敌方缺车型（team=2, tank_id=0）→ 阵营照常 enemy（评审 blocker 回归）', () => {
    const noTank = [...vehicles]
    noTank[noTank.length - 1] = { eid: 999, nickname: '无车型敌方', team: 2, tank_id: 0 }
    const shots = [shot({ shooter_eid: 999, target_eid: 100 })]
    api.enrichShotsFromRoster(shots, noTank)
    expect(shots[0].shooter_tank_id).toBeUndefined()   // 车型富化缺省
    expect(shots[0].shooter_team).toBe('enemy')        // 阵营不受车型缺失影响
  })

  it('eid 缺失（旧产物）不断链：仅跳过富化', () => {
    const shots = [shot({ shooter_eid: 100, target_eid: undefined })]
    api.enrichShotsFromRoster(shots, vehicles)
    expect(shots[0].shooter_tank_id).toBe(30085)
    expect(shots[0].target_tank_id).toBeUndefined()
  })

  it('同名昵称两实体：eid 联表不受名称冲突影响（昵称反查的旧缺陷回归锚）', () => {
    const dup = [
      { eid: 300, nickname: '同名', team: 1, tank_id: 111 },
      { eid: 301, nickname: '同名', team: 2, tank_id: 222 },
    ]
    const shots = [shot({ shooter_eid: 100, target_eid: 301 })]
    api.enrichShotsFromRoster(shots, dup)
    expect(shots[0].target_tank_id).toBe(222)  // 按 eid 精确命中，而非昵称首匹配的 111
  })
})
