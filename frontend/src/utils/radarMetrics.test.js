// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CW_DIM_KEYS } from './playerSummaryMerge.js'
import {
  RADAR_METRIC_DEFS,
  RADAR_AVAILABLE_KEYS,
  RADAR_MIN_AXES,
  RADAR_MAX_AXES,
  loadRadarPreference,
  saveRadarPreference,
  resolveRadarMetric,
} from './radarMetrics.js'

function freshStorage() {
  const store = new Map()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: k => store.delete(k)
    },
    configurable: true
  })
  return store
}

describe('Radar League 维度 normalization 使用后端 metadata（禁止 frontend hardcoded domain max）', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('提供 metadata：league_damage_score max=400 → 342 归一化 0.855，显示 "342 / 400 · 85.5%"', () => {
    const m = resolveRadarMetric('league_damage_score', 342, { league_damage_score: 400 })
    expect(m.available).toBe(true)
    expect(m.normalized).toBeCloseTo(0.855, 3)
    expect(m.displayValue).toBe('342 / 400 \u00B7 85.5%')
  })

  it('把测试 metadata 改成 max=500：Radar 自动使用 500（证明 frontend 无 hardcoded max）', () => {
    const m = resolveRadarMetric('league_damage_score', 342, { league_damage_score: 500 })
    expect(m.available).toBe(true)
    expect(m.normalized).toBeCloseTo(0.684, 3)
    expect(m.displayValue).toBe('342 / 500 \u00B7 68.4%')
  })

  it('后端未提供满分（max 缺失/非有限/<=0）→ unavailable "--"，不伪造 0/0%', () => {
    for (const maxByKey of [{}, { league_damage_score: 0 }, { league_damage_score: NaN }]) {
      const m = resolveRadarMetric('league_damage_score', 342, maxByKey)
      expect(m.available).toBe(false)
      expect(m.displayValue).toBe('--')
    }
  })

  it('raw 缺失（Rating-ineligible 场）→ "--"，不冒充 0', () => {
    const m = resolveRadarMetric('league_damage_score', null, { league_damage_score: 400 })
    expect(m.available).toBe(false)
    expect(m.rawValue).toBeNull()
    expect(m.displayValue).toBe('--')
  })

  it('Performance（contribution/kast）继续按 /100 归一化', () => {
    const c = resolveRadarMetric('contribution', 22.4, {})
    expect(c.normalized).toBeCloseTo(0.224, 3)
    expect(c.displayValue).toBe('22.4%')
    const k = resolveRadarMetric('kast', 100, {})
    expect(k.normalized).toBe(1)
    expect(k.displayValue).toBe('100%')
  })

  it('七维 invariant：League source 维度恰好 7 个，顺序与 CW_DIM_KEYS 一致', () => {
    expect(CW_DIM_KEYS).toHaveLength(7)
    const leagueKeys = Object.entries(RADAR_METRIC_DEFS)
      .filter(([, d]) => d.source === 'league')
      .map(([k]) => k)
    expect(leagueKeys).toEqual(CW_DIM_KEYS)
    expect(leagueKeys).toHaveLength(7)
  })

  it('Impact 不在 Radar picker（无稳定 normalization contract），贡献度/KAST 在', () => {
    expect(RADAR_AVAILABLE_KEYS).toEqual([...CW_DIM_KEYS, 'contribution', 'kast'])
    expect(RADAR_AVAILABLE_KEYS).not.toContain('impact')
  })

  it('axis 数量约束 min 3 / max 8', () => {
    expect(RADAR_MIN_AXES).toBe(3)
    expect(RADAR_MAX_AXES).toBe(8)
  })

  it('偏好加载：非法 key 被过滤；不足 min → fallback 默认七维', () => {
    saveRadarPreference(['removed_metric', 'kast'])
    expect(loadRadarPreference()).toEqual(CW_DIM_KEYS)
    saveRadarPreference(['kast', 'contribution', 'league_damage_score', 'league_kill_score'])
    expect(loadRadarPreference()).toEqual(['kast', 'contribution', 'league_damage_score', 'league_kill_score'])
  })
})
