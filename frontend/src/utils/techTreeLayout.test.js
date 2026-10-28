import { describe, expect, it } from 'vitest'
import { moduleTreeLayout, techTreeGrid, techTreeNations } from './techTreeLayout.js'

describe('techTreeNations', () => {
  it('与上游导出器 NATIONS 同序（9 国）', () => {
    expect(techTreeNations()).toEqual(['ussr', 'germany', 'usa', 'china', 'france', 'uk', 'japan', 'other', 'european'])
  })
})

describe('techTreeGrid（车辆科技树网格）', () => {
  const tree = {
    meta: { nation: 'ussr', premiumRows: 2 },
    nodes: [
      { stem: 'T-26', tankId: 1, tier: 1, x: 1, y: 5 },
      { stem: 'MT25', tankId: 2, tier: 6, x: 6, y: 9 },
      // other 树式特例：列≠tier（同列两车 tier 不同 → 该列 tier 标注留空）
      { stem: 'Odd_A', tankId: 3, tier: 4, x: 7, y: 4 },
      { stem: 'Odd_B', tankId: 4, tier: 5, x: 7, y: 5 },
    ],
    edges: [
      { from: 'T-26', to: 'MT25', cost: { xp: 31000 }, sourceModule: 'gun' },
      // from 车不在树上（如 ussr:MS-1）→ 保留数据但不画线
      { from: 'MS-1', to: 'T-26', cost: { xp: 0 }, sourceModule: 'gun' },
      // 环 / 自环不成线
      { from: 'MT25', to: 'MT25', cost: { xp: 1 }, sourceModule: 'gun' },
    ],
    pending: [{ stem: 'R228_KR_1', x: 11, y: 5 }],
  }

  it('列/行取坐标并集并压缩空洞；tier 按列判定（mixed → null）', () => {
    const grid = techTreeGrid(tree)
    expect(grid.columns).toEqual([1, 6, 7])
    expect(grid.rows).toEqual([4, 5, 9])
    expect(grid.tierByColumn.get(1)).toBe(1)
    expect(grid.tierByColumn.get(7)).toBeNull() // 4/5 混列 → 不猜
    expect(grid.premiumRows).toBe(2)
  })

  it('连线只保留两端可解析的边，坐标换算为列/行下标', () => {
    const grid = techTreeGrid(tree)
    expect(grid.drawnEdges).toHaveLength(1)
    const edge = grid.drawnEdges[0]
    expect(edge.from).toBe('T-26')
    expect(edge.to).toBe('MT25')
    expect([edge.x1, edge.y1]).toEqual([0, 1])
    expect([edge.x2, edge.y2]).toEqual([1, 2])
  })

  it('cells 按 x,y 建索引；pending 原样透传（不造名称/价格）', () => {
    const grid = techTreeGrid(tree)
    expect(grid.cells.get('1,5')?.stem).toBe('T-26')
    expect(grid.pending).toEqual([{ stem: 'R228_KR_1', x: 11, y: 5 }])
  })

  it('等级条窗口 = minLevel..maxLevel（客户端 LevelCell 可见区间）', () => {
    const grid = techTreeGrid(tree)
    expect(grid.minTier).toBe(1)
    expect(grid.maxTier).toBe(6) // 夹具最高 tier 6（MT25）
    expect(techTreeGrid(null).minTier).toBeNull()
  })

  it('同格冲突显式上报（不静默覆盖）', () => {
    const grid = techTreeGrid({
      meta: {},
      nodes: [
        { stem: 'A', tankId: 1, tier: 1, x: 1, y: 1 },
        { stem: 'B', tankId: 2, tier: 1, x: 1, y: 1 },
      ],
      edges: [],
    })
    expect(grid.conflicts).toEqual(['1,1'])
    expect(grid.cells.get('1,1')?.stem).toBe('A')
  })

  it('缺 nodes/edges（旧包 404 之外的数据缺失）fail-closed 为空网格', () => {
    const grid = techTreeGrid(null)
    expect(grid.columns).toEqual([])
    expect(grid.drawnEdges).toEqual([])
    expect(grid.pending).toEqual([])
  })
})

describe('moduleTreeLayout（单车模块研发图，列=深度、行=模块族）', () => {
  const gun = (stem, level, unlocks) => ({ stem, level, unlocks, stats: {} })
  const modules = {
    tankId: 999,
    optDevicePreset: 'defaultPreset',
    consumableSlots: 1, provisionSlots: 1,
    chassis: [
      { stem: 'track0', level: 4, unlocks: [{ kind: 'chassis', stem: 'track1', cost: { xp: 7000 } }] },
      { stem: 'track1', level: 5, unlocks: [] },
    ],
    engines: [{ stem: 'eng0', level: 4, unlocks: [] }],
    turrets: [
      { stem: 't0', level: 4, unlocks: [{ kind: 'turret', stem: 't1', cost: { xp: 3000 } }], guns: [
        gun('L11', 4, [{ kind: 'gun', stem: 'F34', cost: { xp: 2000 } }]),
        gun('F34', 5, [{ kind: 'vehicle', stem: 'MT25', cost: { xp: 31000 } }, { kind: 'gun', stem: 'ZiS4', cost: { xp: 31000 } }]),
      ] },
      { stem: 't1', level: 5, unlocks: [], guns: [
        // 同一门炮挂多炮塔：去重（一份拓扑）
        gun('L11', 4, [{ kind: 'gun', stem: 'F34', cost: { xp: 2200 } }]),
        gun('ZiS4', 6, []),
      ] },
    ],
  }

  it('深度 = 本车内部解锁链最长链；vehicle 目标进 nextVehicles 不进网格', () => {
    const layout = moduleTreeLayout(modules)
    expect(layout.derived).toBe(true)
    const depth = Object.fromEntries(layout.nodes.map(n => [n.stem, n.col]))
    expect(depth.track0).toBe(0)
    expect(depth.track1).toBe(1)
    expect(depth.L11).toBe(0)
    expect(depth.F34).toBe(1)
    expect(depth.ZiS4).toBe(2)
    // gun 出现在两个炮塔但网格里只有一份
    expect(layout.nodes.filter(n => n.stem === 'L11')).toHaveLength(1)
    expect(layout.hasChain).toBe(true)
    // vehicle 目标单列：两炮塔的 F34 各带一条 → 汇总为 MT25（成本取最小 31000）
    expect(layout.nextVehicles).toEqual([
      { stem: 'MT25', cost: { xp: 31000 }, sourceModule: 'F34', sourceKind: 'gun' },
    ])
  })

  it('行 = 模块族（chassis/turret/gun/engine 顺序固定），入边成本取最小', () => {
    const layout = moduleTreeLayout(modules)
    const rowOf = Object.fromEntries(layout.nodes.map(n => [n.stem, n.row]))
    expect(rowOf.track0).toBe(rowOf.track1) // chassis 同行
    expect(rowOf.t0).toBe(rowOf.t1)
    expect(rowOf.L11).toBe(rowOf.F34)
    expect(rowOf.track0).toBeLessThan(rowOf.t0)
    expect(rowOf.t0).toBeLessThan(rowOf.L11)
    expect(rowOf.L11).toBeLessThan(rowOf.eng0)
    // F34 的入边：L11 → F34 有 2000/2200 两条（数值独立），显示最小
    expect(layout.nodes.find(n => n.stem === 'F34').cost).toBe(2000)
  })

  it('installed 按 stem 对号（不按下标）：当前搭载的炮塔/炮/发动机/履带', () => {
    const selection = { canConfigure: true, turret: 1, gun: 1, engine: 0, track: 1 }
    const layout = moduleTreeLayout(modules, selection)
    const flagOf = stem => layout.nodes.find(n => n.stem === stem)?.installed
    expect(flagOf('t1')).toBe(true)
    expect(flagOf('ZiS4')).toBe(true) // t1 的 guns[1]
    expect(flagOf('t0')).toBe(false)
    expect(flagOf('L11')).toBe(false)
    expect(flagOf('eng0')).toBe(true)
    expect(flagOf('track1')).toBe(true)
    // canConfigure=false（模块缺失等）→ 全部未安装
    const none = moduleTreeLayout(modules, { canConfigure: false, turret: 0, gun: 0, engine: 0, track: 0 })
    expect(none.nodes.every(n => !n.installed)).toBe(true)
  })

  it('解锁环 = 数据异常显式抛出（不猜深度）', () => {
    const cyclic = {
      chassis: [
        { stem: 'a', unlocks: [{ kind: 'chassis', stem: 'b' }] },
        { stem: 'b', unlocks: [{ kind: 'chassis', stem: 'a' }] },
      ],
      turrets: [], engines: [],
    }
    expect(() => moduleTreeLayout(cyclic)).toThrow(/cycle/)
  })

  it('XI 型无链车：零解锁边 → hasChain=false（数据可证的注记依据）', () => {
    const xi = {
      chassis: [{ stem: 'track0', level: 11, unlocks: [] }],
      engines: [{ stem: 'eng0', level: 11, unlocks: [] }],
      turrets: [{ stem: 't0', level: 11, unlocks: [], guns: [{ stem: 'g0', level: 11, unlocks: [] }] }],
    }
    const layout = moduleTreeLayout(xi)
    expect(layout.hasChain).toBe(false)
    expect(layout.nodes.every(n => n.cost == null)).toBe(true)
  })

  it('空模块 → null（不渲染半残图）', () => {
    expect(moduleTreeLayout(null)).toBeNull()
  })
})
