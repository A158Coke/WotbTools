import { describe, expect, it } from 'vitest'
import { fixtureFacets, requireFixtures } from '../__golden__/agentWasmNode.js'
import { buildCanonicalReplayFacts, resolveReplayClock } from './facts.js'
import { classifyHpRaw, isTerminalHpState, knownHpOf } from './hpRawState.js'
import { toBattlePlaybackDataset } from '../playback/toBattlePlaybackDataset.js'

/**
 * 血量分类的两条路径（上游 docs/wotbtools-cross-reference.md §七 + 本仓评审）：
 *  - `hp_state` 在场 = 权威（`terminal` = 负 i16 全族）；
 *  - 字段缺省（旧产物）= **legacy 分类不放宽**（仅 0/0xFFFD 终态，0xFFFF/0xFFFE 仍属未证明哨兵）。
 *
 * 回归动因：0xFFFE 档弹药架殉爆的死亡（实例 1910 局 Intotherainy）曾在 2D/3D 被判成存活
 * （血量冻在最后正值、装填条继续播放）；而"缺省路径放宽为全族终态"会在旧产物上产生
 * 无旁证的死亡判定（存量语料把 0xFFFF 记为 unavailable）。
 */
describe('血量分类（legacy 缺省 + 字段权威）', () => {
  it('字段缺省 = legacy 逐值分类：仅 0/0xFFFD 终态，−1/−2 仍未知', () => {
    expect(classifyHpRaw(0x0000)).toBe('HP_ZERO_TERMINAL')
    expect(classifyHpRaw(0xfffd)).toBe('DEATH_TERMINAL_FFFD')
    expect(classifyHpRaw(0xffff)).toBe('UNKNOWN_FFFF')
    expect(classifyHpRaw(0xfffe)).toBe('UNKNOWN_OTHER')
    expect(classifyHpRaw(0xfff0)).toBe('UNKNOWN_OTHER')
    for (const raw of [1, 18, 2664, 0x7fff]) expect(classifyHpRaw(raw), `${raw}`).toBe('CURRENT_HP')

    expect(isTerminalHpState('HP_ZERO_TERMINAL')).toBe(true)
    expect(isTerminalHpState('DEATH_TERMINAL_FFFD')).toBe(true)
    expect(isTerminalHpState('DEATH_TERMINAL')).toBe(true)
    expect(isTerminalHpState('UNKNOWN_FFFF')).toBe(false)
    expect(isTerminalHpState('UNKNOWN_OTHER')).toBe(false)
    // 终态哨兵 = 血量未知（≠ 0）：显示层的 0 由 DESTROYED 覆盖，facts 层不改写
    expect(knownHpOf(0xfffe)).toBeNull()
    expect(knownHpOf(0xfffd)).toBeNull()
    expect(knownHpOf(0x0000)).toBe(0)
    expect(knownHpOf(1406)).toBe(1406)
  })

  it('hp_state 在场 = 权威（负 i16 全族 → DEATH_TERMINAL；与 raw 冲突时以字段为准）', () => {
    expect(classifyHpRaw(1406, 'current')).toBe('CURRENT_HP')
    expect(classifyHpRaw(0x0000, 'zero')).toBe('HP_ZERO_TERMINAL')
    expect(classifyHpRaw(0xfffe, 'terminal')).toBe('DEATH_TERMINAL')
    expect(classifyHpRaw(0xffff, 'terminal')).toBe('DEATH_TERMINAL')
    expect(classifyHpRaw(22, 'terminal')).toBe('DEATH_TERMINAL')
    expect(classifyHpRaw(0xfffe, 'current')).toBe('CURRENT_HP')
    expect(knownHpOf(0xfffe, 'terminal')).toBeNull()
  })
})

describe('终态族 → canonical 死亡面（字段权威 / legacy 缺省两条路径）', () => {
  it.each([
    // 字段权威：上游判终态（此处置 0xFFFE，事故实例）→ 必须产出 DESTROYED
    ['字段权威 hp_state=terminal（0xFFFE）', { hp_raw: 0xfffe, hp_state: 'terminal' as const }, 'DEATH_TERMINAL', true],
    // 字段权威：同样覆盖 0xFFFF / 其余负值
    ['字段权威 hp_state=terminal（0xFFFF）', { hp_raw: 0xffff, hp_state: 'terminal' as const }, 'DEATH_TERMINAL', true],
    // legacy 缺省不放宽：0xFFFE 无字段 → 未证明哨兵（血量/生死未知），不得凭空判死
    ['legacy 缺省 0xFFFE（无 hp_state）→ 不判死', { hp_raw: 0xfffe }, 'UNKNOWN_OTHER', false],
    // legacy 已证明值：0xFFFD 仍判死（行为不变）
    ['legacy 缺省 0xFFFD → 判死（行为不变）', { hp_raw: 0xfffd }, 'DEATH_TERMINAL_FFFD', true],
  ])('%s', async (_name, healthFields, expectedState, expectDestroyed) => {
    const f = requireFixtures(await fixtureFacets('random-battle-example.wotbreplay'))
    const victim = f.aiReview.rosters.find((r) => r.account_id && r.account_id !== f.result.author_account_id)!
    const clock = resolveReplayClock(f.aiReview.battle.periods, f.result, f.playback.meta.duration)!
    const start = clock.startRaw
    // 注入必须晚于该实体全部既有证据（血量帧取最后一条），且留在战斗时长内
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
    // ① 事件 → 血量采样：分类落在 canonical fact 上（exact 只对可用血量与已判终态成立）
    const sample = facts.hpSamples.get(victim.eid)!.find((s) => Math.abs(s.t - (t - start)) < 1e-6)!
    expect(sample.rawState).toBe(expectedState)
    expect(sample.alive).toBe(expectDestroyed ? false : null)
    expect(sample.exact).toBe(expectDestroyed)
    // ② canonical → 2D/3D 生命轨道：字段权威判死；legacy 未证明哨兵不产生 DESTROYED
    const dataset = toBattlePlaybackDataset(f.playback, f.result, aiReview, { canonicalFacts: facts })!
    const track = dataset.vehicles.find((v) => v.accountId === victim.account_id)!
    const atInjectedTime = track.lifeTransitions.some((l) =>
      l.lifeState === 'DESTROYED'
      && Math.abs((l.destroyedKnownAtSec ?? Number.NaN) - (t - start)) < 1e-6)
    expect(atInjectedTime).toBe(expectDestroyed)
  })
})
