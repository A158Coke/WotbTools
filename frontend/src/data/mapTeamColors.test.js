// PR3 §19 —— friendly tone 显式配置契约（新增地图未配置 → CI FAIL）。
// 禁止默认颜色 silent fallback：mapImages 每个 key 必须在 MAP_FRIENDLY_TONE 中有
// green|blue 显式配置；tone 值域合法；team token 集完整（green/blue/red × text/outline/glow）。
import { describe, expect, it } from 'vitest'
import { mapImages } from './mapImages'
import { MAP_FRIENDLY_TONE, TEAM_TOKENS, friendlyToneForMap } from './mapTeamColors'

describe('PR3 §19 map friendly tone config（每图显式配置，无默认回退）', () => {
  it('mapImages 每个地图 key 都有显式 friendly tone 配置（新增地图无配置 → FAIL）', () => {
    const mapKeys = Object.keys(mapImages)
    expect(mapKeys.length).toBeGreaterThanOrEqual(20)
    for (const key of mapKeys) {
      expect(MAP_FRIENDLY_TONE[key], '地图 ' + key + ' 缺少 friendly tone 配置').toBeDefined()
    }
  })

  it('tone 值域只允许 green | blue', () => {
    for (const [key, tone] of Object.entries(MAP_FRIENDLY_TONE)) {
      expect(['green', 'blue'], key + ' tone=' + tone).toContain(tone)
    }
  })

  it('配置表没有多余 key（与 mapImages 严格一致）', () => {
    expect(Object.keys(MAP_FRIENDLY_TONE).sort()).toEqual(Object.keys(mapImages).sort())
  })

  it('friendlyToneForMap 恒有返回值（green|blue）', () => {
    for (const key of Object.keys(mapImages)) {
      expect(['green', 'blue']).toContain(friendlyToneForMap(key))
    }
  })
})

describe('PR3 §20 team tokens（semantic token 完整）', () => {
  it('green/blue/red 三组 × text/outline/glow 齐全', () => {
    for (const tone of ['green', 'blue', 'red']) {
      const t = TEAM_TOKENS[tone]
      expect(t, tone).toBeDefined()
      expect(typeof t.text).toBe('string')
      expect(t.text.length).toBeGreaterThan(0)
      expect(t.outline).toContain('rgba(')
      expect(t.glow).toContain('rgba(')
    }
  })
})
