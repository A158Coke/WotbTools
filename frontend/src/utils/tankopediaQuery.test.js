import { describe, expect, it } from 'vitest'
import {
  TANKOPEDIA_QUERY_KEYS,
  normalizeTankCache,
  parseTankopediaQuery,
  sameTankopediaQuery,
  selectTanks,
  serializeTankopediaQuery,
  withTankopediaState,
} from './tankopediaQuery.js'

describe('parseTankopediaQuery', () => {
  it('空 query 得到默认状态', () => {
    expect(parseTankopediaQuery({})).toEqual({ q: '', tier: '', nation: '', type: '', sort: 'name', tank: null, config: null })
  })

  it('校验并回落非法值', () => {
    expect(parseTankopediaQuery({ tier: '0', sort: 'dpm', tank: 'abc', config: '1' })).toMatchObject({
      tier: '', sort: 'name', tank: null, config: null,
    })
    expect(parseTankopediaQuery({ tier: '10', sort: 'pen', tank: '5', config: '-1' })).toMatchObject({
      tier: '10', sort: 'pen', tank: 5, config: null,
    })
  })

  it('数组取第一个值，搜索词裁掉首尾空白并限长', () => {
    const state = parseTankopediaQuery({ q: ['  is7  ', 'x'], nation: ['ussr'], tank: '7', config: '0' })
    expect(state).toMatchObject({ q: 'is7', nation: 'ussr', tank: 7, config: 0 })
    expect(parseTankopediaQuery({ q: 'a'.repeat(200) }).q).toHaveLength(64)
  })
})

describe('serializeTankopediaQuery', () => {
  it('默认值不写进 URL', () => {
    expect(serializeTankopediaQuery(parseTankopediaQuery({}))).toEqual({})
  })

  it('往返保持一致', () => {
    const query = { q: 'e100', tier: '10', nation: 'germany', type: 'heavyTank', sort: 'hp', tank: '9', config: '2' }
    expect(serializeTankopediaQuery(parseTankopediaQuery(query))).toEqual(query)
  })

  it('config 只在详情态写出', () => {
    expect(serializeTankopediaQuery({ config: 2 })).toEqual({})
    expect(serializeTankopediaQuery({ tank: 3, config: 0 })).toEqual({ tank: '3', config: '0' })
  })
})

describe('sameTankopediaQuery / withTankopediaState', () => {
  it('忽略 view 等其他键与默认值', () => {
    expect(sameTankopediaQuery({ view: 'agent-tankopedia', sort: 'name' }, { lang: 'en' })).toBe(true)
    expect(sameTankopediaQuery({ tier: '5' }, { tier: '6' })).toBe(false)
  })

  it('保留非百科键，覆盖全部百科键', () => {
    const next = withTankopediaState(
      { view: 'agent-tankopedia', lang: 'en', tank: '5', config: '1', q: 'old' },
      { q: 'new', tank: null },
    )
    expect(next).toEqual({ view: 'agent-tankopedia', lang: 'en', q: 'new' })
  })

  it('导出的键清单覆盖序列化的全部键', () => {
    const all = serializeTankopediaQuery({ q: 'x', tier: 1, nation: 'a', type: 'b', sort: 'hp', tank: 1, config: 0 })
    expect(Object.keys(all).sort()).toEqual([...TANKOPEDIA_QUERY_KEYS].sort())
  })
})

describe('selectTanks', () => {
  const tanks = [
    { id: 1, name: 'T-34', tier: 5, nation: 'ussr', type: 'mediumTank', hp: 900, pen_max: 120 },
    { id: 2, name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400, pen_max: 300 },
    { id: 3, name: 'E 100', tier: 10, nation: 'germany', type: 'heavyTank', hp: 2700, pen_max: 334 },
    { id: 4, name: 'Hellcat', tier: 7, nation: 'usa', type: 'AT-SPG', hp: null, pen_max: null },
  ]
  const names = list => list.map(tank => tank.name)

  it('按名称排序并精确筛选', () => {
    expect(names(selectTanks(tanks, {}))).toEqual(['E 100', 'Hellcat', 'IS-7', 'T-34'])
    expect(names(selectTanks(tanks, { tier: '10', nation: 'ussr' }))).toEqual(['IS-7'])
    expect(names(selectTanks(tanks, { type: 'heavyTank', sort: 'hp' }))).toEqual(['E 100', 'IS-7'])
  })

  it('数值排序把缺失值放在最后', () => {
    expect(names(selectTanks(tanks, { sort: 'pen' }))).toEqual(['E 100', 'IS-7', 'T-34', 'Hellcat'])
  })

  it('搜索词模糊匹配并与筛选叠加', () => {
    expect(names(selectTanks(tanks, { q: 'is7' }))).toEqual(['IS-7'])
    expect(names(selectTanks(tanks, { q: 'is7', nation: 'germany' }))).toEqual([])
  })

  it('不修改输入数组', () => {
    const copy = tanks.slice()
    selectTanks(tanks, { sort: 'tier' })
    expect(tanks).toEqual(copy)
  })
})

describe('normalizeTankCache', () => {
  it('对象与数组两种形状都能转换，最大穿深取弹种最大值', () => {
    const fromObject = normalizeTankCache({ 7: { name: 'A', tier: 3, shells: [{ penetration: 50 }, { penetration: 80 }] } })
    expect(fromObject).toEqual([{ id: 7, name: 'A', tier: 3, nation: 'unknown', type: 'unknown', is_premium: false, hp: null, pen_max: 80 }])
    expect(normalizeTankCache([{ id: 8, name: 'B', is_premium: 1 }])[0]).toMatchObject({ id: 8, is_premium: true, pen_max: null })
  })

  it('丢掉无效条目', () => {
    expect(normalizeTankCache({ x: { name: 'bad' }, 1: null })).toEqual([])
    expect(normalizeTankCache(null)).toEqual([])
  })
})
