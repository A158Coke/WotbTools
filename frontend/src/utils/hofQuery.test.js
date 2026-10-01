import { describe, expect, it } from 'vitest'
import { parseHofQuery, sameHofQuery, serializeHofQuery } from './hofQuery.js'

describe('hofQuery', () => {
  it('默认值：空 query → 单场第 1 页、50 条，序列化为空', () => {
    const state = parseHofQuery({ view: 'hof' })
    expect(state).toEqual({ tab: 'single', page: 1, tank: null, nation: '', type: '', tier: '', bt: '', nick: '', limit: 50 })
    expect(serializeHofQuery(state)).toEqual({})
  })

  it('单场筛选往返', () => {
    const query = { tab: 'single', page: '3', tank: '4657', nation: 'germany', type: 'heavyTank', tier: '10', bt: 'rating', nick: ' 玩家 ', limit: '100' }
    const state = parseHofQuery(query)
    expect(state).toMatchObject({ page: 3, tank: 4657, bt: 'RATING', nick: '玩家', limit: 100 })
    expect(serializeHofQuery(state)).toEqual({ page: '3', tank: '4657', nation: 'germany', type: 'heavyTank', tier: '10', bt: 'RATING', nick: '玩家', limit: '100' })
  })

  it('百场 / 三环不写单场专属键', () => {
    const state = parseHofQuery({ tab: 'hundred', tank: '1', nick: 'x', bt: 'RANDOM', limit: '20' })
    expect(state.nick).toBe('')
    expect(serializeHofQuery(state)).toEqual({ tab: 'hundred', tank: '1' })
  })

  it('非法值回落到默认值', () => {
    expect(parseHofQuery({ tab: 'evil', page: '-2', tank: 'abc', bt: 'X', limit: '7' }))
      .toMatchObject({ tab: 'single', page: 1, tank: null, bt: '', limit: 50 })
    expect(parseHofQuery({ page: ['4', '5'] }).page).toBe(4)
  })

  it('sameHofQuery 忽略 view 与键顺序', () => {
    expect(sameHofQuery({ view: 'hof', page: '2', tank: '1' }, { tank: '1', page: '2' })).toBe(true)
    expect(sameHofQuery({ page: '2' }, { page: '3' })).toBe(false)
    expect(sameHofQuery({ limit: '50' }, {})).toBe(true)
  })
})
