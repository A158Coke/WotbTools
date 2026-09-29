/**
 * Agent 回放切面接口测试：用上游契约样例（contracts/agent/samples/，随 PR #392 合并）
 * 锁定信封校验的真实不变量——version 锁定、三切面齐备、可见性事件必须可联表花名册。
 * 样例缺失时跳过（不伪造 fixture）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  normalizeAgentShotIndices,
  parseAgentFacetsFromJson,
  validateAgentFacetEnvelope,
} from './agent-replay-facets.js'

const SAMPLES_DIR = join(__dirname, '../../../contracts/agent/samples')

function readSample(name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(SAMPLES_DIR, name), 'utf-8')) as Record<string, any>
}

function hasSamples(): boolean {
  try {
    readSample('hof.sample.json')
    readSample('ai-review.sample.json')
    return true
  } catch {
    return false
  }
}

function minimalPlayback(): Record<string, unknown> {
  return {
    version: 1,
    meta: { map_id: 1, map_name: 'x', winner_team: 1, friendly_team: 1, author_eid: 0, t_start: 0, samples: 1, duration: 0.1 },
    vehicles: [],
    shots: [],
    kills: [],
    periods: [],
    visibility: [],
  }
}

describe.skipIf(!hasSamples())('agent replay facets（上游契约样例）', () => {
  const hof = readSample('hof.sample.json')
  const ai = readSample('ai-review.sample.json')

  it('真实样例通过信封校验（产物形状：信封无版本键，版本在切面层）', () => {
    const env = validateAgentFacetEnvelope({
      playback: minimalPlayback(),
      ai,
      hof,
    })
    expect(env.hof.version).toBe(1)
    expect(env.ai.version).toBe(1)
    expect(Array.isArray(env.hof.entries)).toBe(true)
    // 样例来自整场回放：花名册规模锁定在契约边界内
    expect(env.ai.rosters.length).toBeGreaterThanOrEqual(10)
  })

  it('切面 version 不匹配 fail-fast（信封级未知键忽略）', () => {
    const bad = structuredClone(ai) as Record<string, unknown>
    bad.version = 2
    expect(() =>
      validateAgentFacetEnvelope({ playback: minimalPlayback(), ai: bad, hof }),
    ).toThrow(/ai\.version = 2，不支持的契约版本/)
  })

  it('缺切面 fail-fast', () => {
    expect(() => validateAgentFacetEnvelope({ version: 1, playback: minimalPlayback(), ai })).toThrow(/hof 必须是对象/)
  })

  it('visibility 事件必须可联表花名册（裸 EID 不泄漏）', () => {
    const bad = {
      version: 1,
      playback: minimalPlayback(),
      ai: {
        ...ai,
        rosters: [],
        events: [{ type: 'visibility', t_in: 1, eid: 999 }],
      },
      hof,
    }
    expect(() => validateAgentFacetEnvelope(bad)).toThrow(/visibility eid 999/)
  })
})

describe('agent replay facets（合成用例）', () => {
  it('parseAgentFacetsFromJson 接受对象与 JSON 字符串', () => {
    const env = {
      version: 1,
      playback: minimalPlayback(),
      ai: { version: 1, battle: {}, rosters: [], events: [], settlements: [] },
      hof: { version: 1, battle: {}, entries: [] },
    }
    expect(parseAgentFacetsFromJson(env).playback.version).toBe(1)
    expect(parseAgentFacetsFromJson(JSON.stringify(env)).hof.version).toBe(1)
  })

  it('非对象输入 fail-fast', () => {
    expect(() => parseAgentFacetsFromJson('null')).toThrow()
  })
})

describe.skipIf(!hasSamples())('结构契约锁定（139c5092 评审 blocker 回归）', () => {
  const hof = readSample('hof.sample.json')
  const ai = readSample('ai-review.sample.json')

  function validEnvelope(): Record<string, unknown> {
    // 深拷贝：用例会就地变更（删键/改版本），不得污染 describe 级共享样例
    return { version: 1, playback: minimalPlayback(), ai: structuredClone(ai), hof: structuredClone(hof) }
  }

  /** 从合法信封删除指定键（或改写值）后必须被校验器拒绝 */
  function expectReject(mutate: (env: Record<string, unknown>) => void): void {
    const env = validEnvelope()
    mutate(env)
    expect(() => validateAgentFacetEnvelope(env)).toThrow()
  }

  function dropKey(section: 'playback' | 'ai' | 'hof', key: string) {
    return (env: Record<string, unknown>) => {
      const sec = env[section] as Record<string, unknown>
      delete sec[key]
    }
  }

  it.each([
    ['playback.shots', dropKey('playback', 'shots')],
    ['playback.kills', dropKey('playback', 'kills')],
    ['playback.periods', dropKey('playback', 'periods')],
    ['playback.visibility', dropKey('playback', 'visibility')],
    ['ai.battle', dropKey('ai', 'battle')],
    ['ai.settlements', dropKey('ai', 'settlements')],
    ['hof.battle', dropKey('hof', 'battle')],
  ])('缺失 %s → reject', (_name, mutate) => {
    expectReject(mutate)
  })

  it.each([
    ['playback.version', (env: Record<string, unknown>) => { (env.playback as Record<string, unknown>).version = 2 }],
    ['ai.version', (env: Record<string, unknown>) => { (env.ai as Record<string, unknown>).version = 0 }],
    ['hof.version', (env: Record<string, unknown>) => { delete (env.hof as Record<string, unknown>).version }],
  ])('切面 %s ≠ 1 → reject', (_name, mutate) => {
    expectReject(mutate)
  })

  it('playback.meta 缺失 → reject', () => {
    expectReject((env) => {
      const pb = env.playback as Record<string, unknown>
      delete pb.meta
    })
  })

  it('visibility 可联表不变量仍然锁定', () => {
    const env = validEnvelope()
    ;(env.ai as Record<string, unknown>).events = [{ type: 'visibility', t_in: 1, eid: 424242 }]
    expect(() => validateAgentFacetEnvelope(env)).toThrow(/visibility eid 424242/)
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
