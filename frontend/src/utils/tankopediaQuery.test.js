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
import TANK_ALIASES from '../../../common/tank_aliases.json'

describe('parseTankopediaQuery', () => {
  it('空 query 得到默认状态', () => {
    expect(parseTankopediaQuery({})).toEqual({
      q: '', tier: '', nation: '', type: '', sort: 'name', tank: null, config: null,
      engine: null, track: null, shell: null, dev: '', eq: null, cons: null, prov: null, skills: {}, camo: false,
    })
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

  it('配置器键：下标 / 装备槽 / 物品表 / 涂装', () => {
    expect(parseTankopediaQuery({
      tank: '5', engine: '2', track: '1', shell: '1', dev: '01-1', cons: 'afterburning,berserk', prov: 'ration', skills: 'smooth_driving:7,camouflage:3', camo: '1',
    })).toMatchObject({
      engine: 2, track: 1, shell: 1, dev: '01-1', cons: ['afterburning', 'berserk'], prov: ['ration'], skills: { smooth_driving: 7, camouflage: 3 }, camo: true,
    })
  })

  it('装备槽只保留 0/1/- 且最多 9 位；物品表去重、剔非法 stem', () => {
    expect(parseTankopediaQuery({ tank: '5', dev: '0123456789xyz-' }).dev).toBe('01')
    expect(parseTankopediaQuery({ tank: '5', cons: 'a,a,b,c,d,!!' }).cons).toEqual(['a', 'b', 'c', 'd'])
    expect(parseTankopediaQuery({ tank: '5', cons: '' }).cons).toEqual([])
    expect(parseTankopediaQuery({ tank: '5', camo: '0' }).camo).toBe(false)
  })

  it('配置器键只在详情态解析（列表态不保留别车残留）', () => {
    expect(parseTankopediaQuery({ dev: '01', cons: 'a', camo: '1' })).toMatchObject({
      shell: null, dev: '', cons: null, prov: null, camo: false,
    })
  })
})

describe('serializeTankopediaQuery', () => {
  it('默认值不写进 URL', () => {
    expect(serializeTankopediaQuery(parseTankopediaQuery({}))).toEqual({})
  })

  it('往返保持一致', () => {
    const query = {
      q: 'e100', tier: '10', nation: 'germany', type: 'heavyTank', sort: 'hp', tank: '9', config: '2',
      engine: '1', track: '0', shell: '1', dev: '01-1', cons: 'afterburning,berserk', prov: 'ration', skills: 'smooth_driving:7,camouflage:3', camo: '1',
    }
    expect(serializeTankopediaQuery(parseTankopediaQuery(query))).toEqual(query)
  })

  it('config 只在详情态写出', () => {
    expect(serializeTankopediaQuery({ config: 2 })).toEqual({})
    expect(serializeTankopediaQuery({ tank: 3, config: 0 })).toEqual({ tank: '3', config: '0' })
  })

  it('配置器键：缺省不写；空物品表写成空值（区分“用户清空”与“默认表”）', () => {
    expect(serializeTankopediaQuery({ tank: 3 })).toEqual({ tank: '3' })
    expect(serializeTankopediaQuery({ tank: 3, dev: '', cons: null, prov: null, camo: false }))
      .toEqual({ tank: '3' })
    expect(serializeTankopediaQuery({ tank: 3, cons: [], prov: [] })).toEqual({ tank: '3', cons: '', prov: '' })
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
    const all = serializeTankopediaQuery({
      q: 'x', tier: 1, nation: 'a', type: 'b', sort: 'hp', tank: 1, config: 0,
      engine: 0, track: 0, shell: 0, dev: '0', cons: [], prov: [], skills: { smooth_turn: 7 }, camo: true,
      eq: [103],
    })
    expect(Object.keys(all).sort()).toEqual([...TANKOPEDIA_QUERY_KEYS].sort())
  })

  it('eq（回放装配 id 透传）：正整数集合序列化；非法/空不写', () => {
    expect(serializeTankopediaQuery({ tank: 3, eq: [103, 110] })).toEqual({ tank: '3', eq: '103,110' })
    expect(serializeTankopediaQuery({ tank: 3, eq: [] })).toEqual({ tank: '3' })
    // 解析：0=空槽垫底过滤、越界剔除、去重、上限 9
    const parsed = parseTankopediaQuery({ tank: '3', eq: '103,0,110,103,999,abc' })
    expect(parsed.eq).toEqual([103, 110])
    expect(parseTankopediaQuery({ tank: '3' }).eq).toBeNull()
    expect(parseTankopediaQuery({ eq: '103' }).eq).toBeNull() // 仅详情态有效
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

describe('selectTanks — 别名搜索', () => {
  // alias 只扩召回：命中后的身份与显示名仍然是 tank_cache 的正式车名。
  const tanks = [
    { id: 9297, name: 'FV215b 183', tier: 10, nation: 'uk', type: 'AT-SPG', aliases: ['183', '大白兔', '死星', 'Death Star'] },
    { id: 2, name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', aliases: [] },
    { id: 3, name: 'E 100', tier: 10, nation: 'germany', type: 'heavyTank' },
  ]
  const names = list => list.map(tank => tank.name)

  it('正式车名搜索不受 alias 影响', () => {
    expect(names(selectTanks(tanks, { q: 'FV215b 183' }))).toEqual(['FV215b 183'])
    expect(names(selectTanks(tanks, { q: 'is7' }))).toEqual(['IS-7'])
    expect(names(selectTanks(tanks, { q: 'e100' }))).toEqual(['E 100'])
  })

  it('中文俗称命中，返回正式车名', () => {
    const hits = selectTanks(tanks, { q: '大白兔' })
    expect(names(hits)).toEqual(['FV215b 183'])
    expect(hits[0].name).toBe('FV215b 183')
  })

  it('英文 nickname 不受大小写与 UI 语言限制', () => {
    expect(names(selectTanks(tanks, { q: 'death star' }))).toEqual(['FV215b 183'])
    expect(names(selectTanks(tanks, { q: 'DEATH STAR' }))).toEqual(['FV215b 183'])
  })

  it('alias 也走现有模糊匹配（前缀 / 子序列）', () => {
    expect(names(selectTanks(tanks, { q: 'death' }))).toEqual(['FV215b 183'])
    expect(names(selectTanks(tanks, { q: '死星' }))).toEqual(['FV215b 183'])
  })

  it('alias 与筛选叠加，且不改变相关度排序', () => {
    expect(names(selectTanks(tanks, { q: '大白兔', nation: 'ussr' }))).toEqual([])
    // 正式车名精确前缀命中的车排在仅 alias 子序列命中的车之前（现有 fuzzy ranking 不变）。
    const ranked = selectTanks(
      [
        { id: 1, name: 'Death Dealer', aliases: [] },
        { id: 2, name: 'FV215b 183', aliases: ['Death Star'] },
      ],
      { q: 'death' },
    )
    expect(names(ranked)).toEqual(['Death Dealer', 'FV215b 183'])
  })

  it('空白 / 缺失 alias 不产生假命中', () => {
    const noisy = [{ id: 1, name: 'IS-7', aliases: ['', '   '] }, { id: 2, name: 'E 100' }]
    expect(selectTanks(noisy, { q: 'zzz' })).toEqual([])
    expect(names(selectTanks(noisy, { q: 'is7' }))).toEqual(['IS-7'])
  })
})

describe('normalizeTankCache — alias 投影', () => {
  it('缺 key 的车辆得到 aliases=[]，空 alias map 下搜索行为与旧版一致', () => {
    const rows = normalizeTankCache({ 12345: { name: 'FV215b 183' } }, {})
    expect(rows[0].aliases).toEqual([])
    expect(selectTanks(rows, { q: 'fv215b' }).map(tank => tank.name)).toEqual(['FV215b 183'])
    expect(selectTanks(rows, { q: '大白兔' })).toEqual([])
  })

  it('稀疏数据集：只有配置过的车辆拿到 alias，其余一律 []', () => {
    const cache = {}
    for (let id = 1; id <= 200; id += 1) cache[id] = { name: `Tank ${id}` }
    cache[12345] = { name: 'FV215b 183' }
    const rows = normalizeTankCache(cache, { 12345: ['大白兔'] })
    const configured = rows.filter(row => row.aliases.length)
    expect(configured).toHaveLength(1)
    expect(configured[0]).toMatchObject({ id: 12345, name: 'FV215b 183', aliases: ['大白兔'] })
    expect(rows.every(row => Array.isArray(row.aliases))).toBe(true)
    // 搜索别名命中后，展示用的仍然是正式车名。
    expect(selectTanks(rows, { q: '大白兔' }).map(tank => tank.name)).toEqual(['FV215b 183'])
  })

  it('默认从仓库数据按 tank_id 投影，未配置车辆仍只按正式车名搜索', () => {
    // 不固定名称总量；所有已配置条目都必须接入默认搜索路径。
    const entries = Object.entries(TANK_ALIASES)
    const cache = Object.fromEntries(entries.map(([id]) => [id, { name: `Tank ${id}` }]))
    cache[1] = { name: 'Unconfigured' }
    const rows = normalizeTankCache(cache)
    expect(rows.every(row => Array.isArray(row.aliases))).toBe(true)
    for (const [id, aliases] of entries) {
      expect(rows.find(row => row.id === Number(id)).aliases).toEqual(aliases)
    }
    expect(rows.find(row => row.id === 1).aliases).toEqual([])
    // 没有别名的车型仍可按正式车名搜索。
    expect(selectTanks(rows, { q: 'unconfigured' }).map(tank => tank.name)).toEqual(['Unconfigured'])
  })
})

describe('国服名称快照 — 默认搜索接线', () => {
  const rows = normalizeTankCache({
    6929: { name: 'Maus' },
    10113: { name: 'Carro 45t' },
    19825: { name: 'AC Atlas' },
    7041: { name: 'Turbo' },
  })

  it.each([
    ['鼠式', 6929, 'Maus'],
    ['45t战车', 10113, 'Carro 45t'],
    ['45t战斗战车', 10113, 'Carro 45t'],
    ['AC阿特拉斯', 19825, 'AC Atlas'],
    ['AC-10阿特拉斯', 19825, 'AC Atlas'],
  ])('国服名称 %s 命中正确车型且保留英文展示名', (q, id, name) => {
    expect(selectTanks(rows, { q }).map(tank => ({ id: tank.id, name: tank.name })))
      .toEqual([{ id, name }])
    expect(selectTanks(rows, { q: name })[0]).toMatchObject({ id, name })
  })

  describe('T34、T-34 与国服 T-34* 是不同车辆', () => {
    const rows = normalizeTankCache({
      1: { name: 'T-34' },
      2849: { name: 'T34' },
      5489: { name: 'Y5 T-34' },
      4657: { name: 'Type T-34' },
    })

    it.each([
      ['T-34', [1, 2849, 5489, 4657]],
      ['t34', [2849, 1, 5489, 4657]],
    ])('搜索 %s 时精确正式车名优先，其余车型保持相关度', (q, ids) => {
      expect(selectTanks(rows, { q }).map(tank => tank.id)).toEqual(ids)
    })

    it.each(['T34*', 'T-34*', 't34*'])('搜索 %s 只命中国服星号车型', q => {
      expect(selectTanks(rows, { q }).map(tank => ({ id: tank.id, name: tank.name })))
        .toEqual([{ id: 4657, name: 'Type T-34' }])
    })
  })

  describe('别名召回与精确车名排序', () => {
    it.each(['Mk I重型坦克', '重型坦克'])('不带星号的 %s 仍可命中 Mk I 中文名称', q => {
      const rows = normalizeTankCache({ 64081: { name: 'Mk I* Heavy Tank' } })
      expect(selectTanks(rows, { q }).map(tank => tank.id)).toEqual([64081])
    })

    it.each(['AMX M4 45', ' amx m4 45 '])('精确正式车名 %s 排在其他车型的模糊别名之前', q => {
      const rows = normalizeTankCache({
        4417: { name: 'AMX M4 mle. 54' },
        6977: { name: 'AMX M4 45' },
      })
      expect(selectTanks(rows, { q }).map(tank => tank.id)).toEqual([6977, 4417])
    })

    it.each(['T-22中型', 'Т-22中型'])('T-22 中文名称接受拉丁及官方西里尔拼法 %s', q => {
      const rows = normalizeTankCache({ 19969: { name: 'T-22 medium' } })
      expect(selectTanks(rows, { q }).map(tank => tank.id)).toEqual([19969])
    })
  })

  it('缺少国服名称的车辆正常保留英文搜索', () => {
    expect(rows.find(row => row.id === 7041).aliases).toEqual([])
    expect(selectTanks(rows, { q: 'Turbo' }).map(tank => tank.id)).toEqual([7041])
  })
})

describe('normalizeTankCache', () => {
  it('对象与数组两种形状都能转换，最大穿深取弹种最大值', () => {
    const fromObject = normalizeTankCache({ 7: { name: 'A', tier: 3, shells: [{ penetration: 50 }, { penetration: 80 }] } })
    expect(fromObject).toEqual([{ id: 7, name: 'A', aliases: [], tier: 3, nation: 'unknown', type: 'unknown', is_premium: false, is_collector: false, hp: null, pen_max: 80 }])
    expect(normalizeTankCache([{ id: 8, name: 'B', is_premium: 1 }])[0]).toMatchObject({ id: 8, is_premium: true, pen_max: null })
  })

  it('收藏车（is_collector）透传到行上——百科据此上蓝色边框', () => {
    expect(normalizeTankCache([{ id: 49, name: 'Type 59', is_collector: true }])[0].is_collector).toBe(true)
  })

  it('金币车（is_premium）透传到行上——百科据此上警告色边框', () => {
    expect(normalizeTankCache([{ id: 49, name: 'Type 59', is_premium: true }])[0].is_premium).toBe(true)
  })

  it('异常输入双 true 时 normalize 不改写上游字段（互斥不在这里伪造）', () => {
    // 上游正常数据两者互斥（tanks.pb field13：1=金币 2=收藏），但 projection 的职责只是
    // 布尔归一化：两个 flag 都原样透传。视觉 precedence 由样式层确定（premium > collector，
    // 见 AgentTankopedia.vue 的 `.tp-card.is-collector:not(.is-premium)` 及其 source 级 gate）。
    expect(normalizeTankCache([{ id: 49, name: 'Type 59', is_collector: 1, is_premium: 1 }])[0])
      .toMatchObject({ is_collector: true, is_premium: true })
  })

  it('丢掉无效条目', () => {
    expect(normalizeTankCache({ x: { name: 'bad' }, 1: null })).toEqual([])
    expect(normalizeTankCache(null)).toEqual([])
  })
})
