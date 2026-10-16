import { describe, expect, it } from 'vitest'
import { fixtureFacets, requireFixtures } from '../__golden__/agentWasmNode.js'
import { buildCanonicalReplayFacts, resolveReplayClock } from './facts.js'
import { classifyHpRaw, isTerminalHpState, knownHpOf } from './hpRawState.js'
import { toBattlePlaybackDataset } from '../playback/toBattlePlaybackDataset.js'

/**
 * 血量终态族（2026-10-16 裁决，上游 docs/wotbtools-cross-reference.md §七）：
 * 终态 = 0x0000 ∨ 负 i16 全族；上游 `hp_state` 在场时以其为唯一权威。
 * 回归动因：本层曾只认 {0x0000, 0xFFFD}，0xFFFE 档的弹药架殉爆死亡被判成存活
 * （血量冻在最后正值、装填条继续播放；实例 1910 局 Intotherainy）。
 */
describe('血量终态族分类', () => {
  it('终态族逐值同判：0 → zero，负 i16 全族 → terminal（含事故实例 0xFFFE）', () => {
    expect(classifyHpRaw(0x0000)).toBe('HP_ZERO_TERMINAL')
    for (const raw of [0xffff, 0xfffe, 0xfffd, 0xfff0, 0x8000]) {
      expect(classifyHpRaw(raw), `0x${raw.toString(16)}`).toBe('DEATH_TERMINAL')
    }
    for (const raw of [1, 18, 2664, 0x7fff]) {
      expect(classifyHpRaw(raw), `${raw}`).toBe('CURRENT_HP')
    }
    expect(isTerminalHpState('HP_ZERO_TERMINAL')).toBe(true)
    expect(isTerminalHpState('DEATH_TERMINAL')).toBe(true)
    expect(isTerminalHpState('CURRENT_HP')).toBe(false)
    // 终态哨兵 = 血量未知（≠ 0）：显示层的 0 由 DESTROYED 覆盖，facts 层不改写
    expect(knownHpOf(0xfffe)).toBeNull()
    expect(knownHpOf(0xfffd)).toBeNull()
    expect(knownHpOf(0x0000)).toBe(0)
    expect(knownHpOf(1406)).toBe(1406)
  })

  it('上游 hp_state 在场 = 权威（两条路径同判；字段与 raw 冲突时以字段为准，不二次解释）', () => {
    expect(classifyHpRaw(1406, 'current')).toBe('CURRENT_HP')
    expect(classifyHpRaw(0x0000, 'zero')).toBe('HP_ZERO_TERMINAL')
    expect(classifyHpRaw(1406, 'terminal')).toBe('DEATH_TERMINAL')
    expect(classifyHpRaw(0xfffe, 'current')).toBe('CURRENT_HP')
  })
})

describe('终态族 → canonical 死亡面（两种产物形态）', () => {
  it.each([
    ['旧产物（无 hp_state，按 hp_raw 现算）', { hp_raw: 0xfffe }],
    ['新产物（hp_state 权威分类）', { hp_raw: 22, hp_state: 'terminal' as const }],
  ])('%s 在注入时刻产出终态证据与 DESTROYED 迁移', async (_name, healthFields) => {
    const f = requireFixtures(await fixtureFacets('random-battle-example.wotbreplay'))
    const victim = f.aiReview.rosters.find((r) => r.account_id && r.account_id !== f.result.author_account_id)!
    const clock = resolveReplayClock(f.aiReview.battle.periods, f.result, f.playback.meta.duration)!
    const start = clock.startRaw
    // 注入必须晚于该实体全部既有证据（终态采样在血量帧里取最后一条），且留在战斗时长内
    const lastRaw = f.aiReview.events.reduce((acc, e) => {
      const mine = (e.type === 'health' && e.eid === victim.eid)
        || (e.type === 'damage' && e.victim_eid === victim.eid)
        || (e.type === 'visibility' && e.eid === victim.eid)
      if (!mine) return acc
      return Math.max(acc, 't' in e ? e.t : e.t_in)
    }, start)
    const t = Math.min(lastRaw + 1, start + clock.durationSec - 0.5)
    const aiReview = {
      ...f.aiReview,
      events: [...f.aiReview.events,
        { type: 'health' as const, t, eid: victim.eid, ...healthFields },
        { type: 'damage' as const, t, victim_eid: victim.eid, hp: 0, hp_raw: 0xfffe, source_eid: 999, cause: 0 },
      ],
    }
    const facts = buildCanonicalReplayFacts({ result: f.result, aiReview })!
    // ① 事件 → 血量采样：终态分类落在 canonical fact 上（exact + alive=false）
    const sample = facts.hpSamples.get(victim.eid)!.find((s) => Math.abs(s.t - (t - start)) < 1e-6)!
    expect(sample.rawState).toBe('DEATH_TERMINAL')
    expect(sample.alive).toBe(false)
    expect(sample.exact).toBe(true)
    // ② canonical → 2D/3D 生命轨道：注入时刻起 DESTROYED（修复前 0xFFFE 档这里没有迁移）
    const dataset = toBattlePlaybackDataset(f.playback, f.result, aiReview, { canonicalFacts: facts })!
    const track = dataset.vehicles.find((v) => v.accountId === victim.account_id)!
    expect(track.lifeTransitions.some((l) =>
      l.lifeState === 'DESTROYED'
      && Math.abs((l.destroyedKnownAtSec ?? Number.NaN) - (t - start)) < 1e-6)).toBe(true)
  })
})
