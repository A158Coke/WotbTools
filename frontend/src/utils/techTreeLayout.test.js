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
      { from: 'MT25', to: 'MT25', cost: { xp: 1 }, sourceModule: 'gun' },
    ],
    pending: [{ stem: 'R228_KR_1', x: 11, y: 5 }],
  }

  it('列/行取已定义节点与有效 pending 坐标的并集；pending 不进 cells/tier', () => {
    const grid = techTreeGrid(tree)
    expect(grid.columns).toEqual([1, 6, 7, 11])
    expect(grid.rows).toEqual([4, 5, 9])
    expect(grid.colIndex.get(11)).toBe(3)
    expect(grid.tierByColumn.get(1)).toBe(1)
    expect(grid.tierByColumn.get(7)).toBeNull() // 4/5 混列 → 不猜
    expect(grid.tierByColumn.get(11)).toBeNull() // pending 列不是车辆事实
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
    expect(grid.maxTier).toBe(6)
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

  it('缺 nodes/edges 时 fail-closed 为空网格', () => {
    const grid = techTreeGrid(null)
    expect(grid.columns).toEqual([])
    expect(grid.drawnEdges).toEqual([])
    expect(grid.pending).toEqual([])
  })
})

/**
 * 模块研发图夹具（客户端截图口径）：
 * - 炮链 L11 → F34 → ZiS4（F34 解锁车辆 MT25）
 * - 炮塔 t0（挂 L11/F34）；t1 挂 L11/ZiS4
 * - 发动机 eng0；履带 track0 → track1
 * 期望行：火炮行0 / 炮塔行1 / 发动机行2 / 履带行3（与 KV-1 实机截图一致）
 */
const gun = (stem, level, unlocks) => ({ stem, localId: null, level, unlocks, stats: {} })
const modules = {
  hasTurret: true,
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
      gun('L11', 4, []),
      gun('ZiS4', 6, []),
    ] },
  ],
}

describe('moduleTreeLayout（客户端分行规则）', () => {
  it('列 = 链上研发步进；vehicle 目标进 nextVehicles', () => {
    const layout = moduleTreeLayout(modules)
    const col = key => layout.nodes.find(n => n.key === key).col
    expect(col('gun:L11')).toBe(0)
    expect(col('gun:F34')).toBe(1)
    expect(col('gun:ZiS4')).toBe(2)
    expect(col('chassis:track0')).toBe(0)
    expect(col('chassis:track1')).toBe(1)
    expect(layout.nextVehicles).toEqual([
      { stem: 'MT25', cost: { xp: 31000 }, sourceModule: 'F34', sourceKind: 'gun' },
    ])
  })

  it('分行：火炮 → 炮塔 → 发动机 → 履带 各一行；同链同一行', () => {
    const layout = moduleTreeLayout(modules)
    const at = key => layout.nodes.find(n => n.key === key)
    expect([at('gun:L11').row, at('gun:F34').row, at('gun:ZiS4').row]).toEqual([0, 0, 0])
    expect(at('turret:t0').row).toBe(1)
    expect(at('turret:t1').row).toBe(1)
    expect(at('engine:eng0').row).toBe(2)
    expect([at('chassis:track0').row, at('chassis:track1').row]).toEqual([3, 3])
    expect(layout.branches.map(b => b.rootKey).sort()).toEqual(
      ['chassis:track0', 'engine:eng0', 'gun:L11', 'turret:t0'],
    )
    const cells = new Set()
    for (const n of layout.nodes) {
      const cell = `${n.col},${n.row}`
      expect(cells.has(cell)).toBe(false)
      cells.add(cell)
    }
  })

  it('多个子分支：主链留本行，坦克分支落到下一行（SU-100M1 截图形态）', () => {
    const su = {
      hasTurret: false,
      chassis: [{ stem: 'c0', level: 7, unlocks: [] }],
      engines: [{ stem: 'e0', level: 6, unlocks: [] }],
      turrets: [{ stem: 'fake', level: 7, unlocks: [], guns: [
        gun('g0', 7, [
          { kind: 'gun', stem: 'g1', cost: { xp: 100 } },
          { kind: 'vehicle', stem: 'SU-101', cost: { xp: 200 } },
        ]),
        gun('g1', 7, [{ kind: 'gun', stem: 'g2', cost: { xp: 300 } }]),
        gun('g2', 9, []),
      ] }],
    }
    const layout = moduleTreeLayout(su, null, { nextVehicles: [{ stem: 'SU-101', name: 'SU-101', tankId: 12850 }] })
    const at = key => layout.nodes.find(n => n.key === key)
    // 无炮塔车：客户端不显示炮塔行（SU-100M1 截图只有 炮/发动机/履带）
    expect(at('turret:fake')).toBeUndefined()
    expect([at('gun:g0').row, at('gun:g1').row, at('gun:g2').row]).toEqual([0, 0, 0])
    const vehicle = at('vehicle:SU-101')
    expect(vehicle.row).toBe(1)
    expect(vehicle.col).toBe(at('gun:g0').col + 1)
    expect(at('engine:e0').row).toBeGreaterThan(1)
    expect(at('chassis:c0').row).toBeGreaterThan(at('engine:e0').row)
  })

  it('每个非根节点只有一条上级连线（6 向箭头 = 树；挂载不画线）', () => {
    const layout = moduleTreeLayout(modules)
    const incoming = new Map()
    for (const edge of layout.edges) incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1)
    expect([...incoming.values()].every(count => count === 1)).toBe(true)
    const roots = layout.nodes.filter(n => !incoming.has(n.key))
    expect(layout.edges.length).toBe(layout.nodes.length - roots.length)
    expect(layout.edges.some(e => e.mount)).toBe(false)
  })

  it('多父目标只保留成本最低的一条上级边；重复炮塔副本不产生重复边', () => {
    const multi = {
      hasTurret: true,
      chassis: [{ stem: 'c0', level: 1, unlocks: [] }],
      engines: [{ stem: 'e0', level: 1, unlocks: [] }],
      turrets: [
        { stem: 't0', level: 1, unlocks: [], guns: [
          gun('g0', 1, [{ kind: 'gun', stem: 'g2', cost: { xp: 100 } }]),
          gun('g1', 1, [{ kind: 'gun', stem: 'g2', cost: { xp: 50 } }]),
          gun('g2', 2, []),
        ] },
        { stem: 't1', level: 1, unlocks: [], guns: [
          // 同一门炮的另一炮塔副本：候选 (g0 -> g2) 重复
          gun('g0', 1, [{ kind: 'gun', stem: 'g2', cost: { xp: 100 } }]),
        ] },
      ],
    }
    const layout = moduleTreeLayout(multi)
    const incoming = layout.edges.filter(e => e.to === 'gun:g2')
    expect(incoming).toHaveLength(1)
    expect(incoming[0].from).toBe('gun:g1')
    const pairs = layout.edges.map(e => `${e.from}->${e.to}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('下一级坦克是树里的节点，接在解锁它的模块右侧（同链优先本行）', () => {
    const layout = moduleTreeLayout(modules, null, {
      nextVehicles: [{ stem: 'MT25', name: 'MT-25', tankId: 2 }],
    })
    const vehicle = layout.nodes.find(n => n.key === 'vehicle:MT25')
    expect(vehicle).toBeTruthy()
    expect(vehicle.tankId).toBe(2)
    const edge = layout.edges.find(e => e.to === 'vehicle:MT25')
    expect(edge.from).toBe('gun:F34')
    const source = layout.nodes.find(n => n.key === edge.from)
    expect(vehicle.col).toBe(source.col + 1)
    // 主链（F34 的 gun 子节点）优先占本行 → 车辆落在下一行
    expect(vehicle.row).toBe(source.row + 1)
  })

  it('installed 按当前搭载对号（炮/发动机/履带/炮塔各一）', () => {
    const selection = { canConfigure: true, turret: 1, gun: 1, engine: 0, track: 1 }
    const layout = moduleTreeLayout(modules, selection)
    const installed = layout.nodes.filter(n => n.installed).map(n => n.key).sort()
    expect(installed).toEqual(['chassis:track1', 'engine:eng0', 'gun:ZiS4', 'turret:t1'])
    const none = moduleTreeLayout(modules, { canConfigure: false })
    expect(none.nodes.every(n => !n.installed)).toBe(true)
  })

  it('非首个炮副本上的 vehicle 边也要收进图（实测 japan NC27 形态）', () => {
    const nc = {
      hasTurret: true,
      chassis: [{ stem: 'c0', level: 1, unlocks: [] }],
      engines: [{ stem: 'e0', level: 1, unlocks: [] }],
      turrets: [
        { stem: 't0', level: 1, unlocks: [{ kind: 'turret', stem: 't1', cost: { xp: 100 } }], guns: [
          gun('g0', 1, []),
        ] },
        { stem: 't1', level: 2, unlocks: [], guns: [
          gun('g0', 1, [{ kind: 'vehicle', stem: 'Chi_Ni', cost: { xp: 9000 } }]),
        ] },
      ],
    }
    const layout = moduleTreeLayout(nc, null, { nextVehicles: [{ stem: 'Chi_Ni', name: 'Chi-Ni', tankId: 7 }] })
    expect(layout.nextVehicles).toEqual([{ stem: 'Chi_Ni', cost: { xp: 9000 }, sourceModule: 'g0', sourceKind: 'gun' }])
    expect(layout.edges.some(e => e.from === 'gun:g0' && e.to === 'vehicle:Chi_Ni')).toBe(true)
    expect(layout.nodes.find(n => n.key === 'vehicle:Chi_Ni')?.tankId).toBe(7)
  })

  it('解锁环 = 数据异常显式抛出（不猜深度）', () => {
    const cyclic = {
      hasTurret: true,
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
      hasTurret: true,
      chassis: [{ stem: 'track0', level: 11, unlocks: [] }],
      engines: [{ stem: 'eng0', level: 11, unlocks: [] }],
      turrets: [{ stem: 't0', level: 11, unlocks: [], guns: [gun('g0', 11, [])] }],
    }
    const layout = moduleTreeLayout(xi)
    expect(layout.hasChain).toBe(false)
    expect(layout.edges).toEqual([])
    expect(layout.nodes.every(n => n.cost == null)).toBe(true)
  })

  it('空模块 → null（不渲染半残图）', () => {
    expect(moduleTreeLayout(null)).toBeNull()
  })
})
