/**
 * Agent 回放切面接口测试：用上游契约样例（contracts/agent/samples/，随 PR #392 合并）
 * 锁定信封校验的真实不变量——version 锁定、三切面齐备、可见性事件必须可联表花名册。
 * 样例缺失时跳过（不伪造 fixture）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  parseAgentFacetsFromJson,
  validateAgentFacetEnvelope,
} from './agent-replay-facets.js'

const SAMPLES_DIR = join(__dirname, '../../../contracts/agent/samples')

function readSample(name: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLES_DIR, name), 'utf-8'))
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

  it('真实样例通过信封校验', () => {
    const env = validateAgentFacetEnvelope({
      version: 1,
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

  it('version 不匹配 fail-fast', () => {
    expect(() =>
      validateAgentFacetEnvelope({ version: 2, playback: minimalPlayback(), ai, hof }),
    ).toThrow(/不支持的契约版本/)
  })

  it('缺切面 fail-fast', () => {
    expect(() => validateAgentFacetEnvelope({ version: 1, playback: minimalPlayback(), ai })).toThrow(/缺 hof/)
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
