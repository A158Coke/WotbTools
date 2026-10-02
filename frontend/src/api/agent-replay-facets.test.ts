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
import {
  PLAYBACK_CONTRACT_VERSION,
  normalizeAgentShotIndices,
  parseAgentPlaybackFromJson,
  parseAgentResultFromJson,
  projectHoF,
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

  it('contract v2 新键：缺省合法、非数组拒绝', () => {
    const ok = validateAgentPlayback(minimalPlayback())
    expect(ok.supremacy_bases).toBeUndefined()
    const bad = minimalPlayback()
    ;(bad as Record<string, unknown>).supremacy_bases = 'x'
    expect(() => validateAgentPlayback(bad)).toThrow(/playback\.supremacy_bases 必须是数组/)
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
    expect(o.others.total_launches).toBe(0)
    expect(o.shots).toHaveLength(2)
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
