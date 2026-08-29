// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CW_DIM_KEYS } from './playerSummaryMerge.js'
import {
  RADAR_METRIC_DEFS,
  RADAR_AVAILABLE_KEYS,
  RADAR_MIN_AXES,
  RADAR_MAX_AXES,
  RADAR_DEFAULT_ORDER,
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

describe('Radar League raw geometry 与 max 明细解释解耦', () => {
  beforeEach(() => { freshStorage(); vi.clearAllMocks() })

  it('提供 metadata：max 只格式化 score/max，不产生 geometry normalized', () => {
    const m = resolveRadarMetric('league_damage_score', 342, { league_damage_score: 400 })
    expect(m.available).toBe(true)
    expect(m.normalized).toBeNull()
    expect(m.displayValue).toBe('342 / 400')
    expect(m.displayValue).not.toContain('%')
  })

  it('改变 metadata max 只改变 detail 文案，不改变 raw/availability/geometry input', () => {
    const m = resolveRadarMetric('league_damage_score', 342, { league_damage_score: 500 })
    expect(m.available).toBe(true)
    expect(m.rawValue).toBe(342)
    expect(m.normalized).toBeNull()
    expect(m.displayValue).toBe('342 / 500')
  })

  it('后端 max 缺失/非有限/<=0：raw 仍 available，明细降级为 raw，不阻断 geometry', () => {
    for (const maxByKey of [{}, { league_damage_score: 0 }, { league_damage_score: NaN }]) {
      const m = resolveRadarMetric('league_damage_score', 342, maxByKey)
      expect(m.available).toBe(true)
      expect(m.rawValue).toBe(342)
      expect(m.normalized).toBeNull()
      expect(m.displayValue).toBe('342')
    }
  })

  it('raw 缺失（Rating-ineligible 场）→ "--"，不冒充 0', () => {
    const m = resolveRadarMetric('league_damage_score', null, { league_damage_score: 400 })
    expect(m.available).toBe(false)
    expect(m.rawValue).toBeNull()
    expect(m.displayValue).toBe('--')
  })

  it('七维 invariant：League source 维度恰好 7 个，顺序与 CW_DIM_KEYS 一致', () => {
    expect(CW_DIM_KEYS).toHaveLength(7)
    const leagueKeys = Object.entries(RADAR_METRIC_DEFS)
      .filter(([, d]) => d.source === 'league')
      .map(([k]) => k)
    expect(leagueKeys).toEqual(CW_DIM_KEYS)
    expect(leagueKeys).toHaveLength(7)
  })

  it('仅 League 七维可选进 Radar：contribution/kast/impact 不在 picker（属于 Performance Metrics）', () => {
    expect(RADAR_AVAILABLE_KEYS).toEqual(CW_DIM_KEYS)
    expect(RADAR_AVAILABLE_KEYS).not.toContain('contribution')
    expect(RADAR_AVAILABLE_KEYS).not.toContain('kast')
    expect(RADAR_AVAILABLE_KEYS).not.toContain('impact')
  })

  it('axis 数量约束 min 3 / max 7', () => {
    expect(RADAR_MIN_AXES).toBe(3)
    expect(RADAR_MAX_AXES).toBe(7)
  })

  it('默认顺序 =Damage/Shooting/Kill/RC/Blocked/Exchange/Assist', () => {
    expect(RADAR_DEFAULT_ORDER).toEqual([
      'league_damage_score',
      'league_shooting_score',
      'league_kill_score',
      'league_survival_score',
      'league_blocked_score',
      'league_exchange_score',
      'league_assist_score',
    ])
  })

  it('偏好加载：旧值 contribution/kast/impact 被静默过滤（§66）；不足 min → fallback 默认七维', () => {
    saveRadarPreference(['removed_metric', 'contribution', 'kast', 'impact'])
    expect(loadRadarPreference()).toEqual(RADAR_DEFAULT_ORDER)
    saveRadarPreference(['league_damage_score', 'league_kill_score', 'league_assist_score'])
    expect(loadRadarPreference()).toEqual(['league_damage_score', 'league_kill_score', 'league_assist_score'])
  })

  it('无偏好时 fallback 默认顺序', () => {
    expect(loadRadarPreference()).toEqual(RADAR_DEFAULT_ORDER)
  })
})
