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
    // 炮挂在所属炮塔下：L11 = 炮塔深度 + 1（不再是第 0 列的孤立根）
    expect(depth.t0).toBe(0)
    expect(depth.L11).toBe(1)
    expect(depth.F34).toBe(2)
    expect(depth.ZiS4).toBe(3)
    // gun 出现在两个炮塔但网格里只有一份
    expect(layout.nodes.filter(n => n.stem === 'L11')).toHaveLength(1)
    expect(layout.hasChain).toBe(true)
    // vehicle 目标单列：汇总为 MT25（含解锁来源，供页面把边接到图上）
    expect(layout.nextVehicles).toEqual([
      { stem: 'MT25', cost: { xp: 31000 }, sourceModule: 'F34', sourceKind: 'gun' },
    ])
    expect(layout.nodes.some(n => n.kind === 'vehicle')).toBe(false) // 未传 nextVehicles 时不造节点
  })

  it('分层 DAG：炮就着自己的炮塔放（不按模块族强行分行），入边成本取最小', () => {
    const layout = moduleTreeLayout(modules)
    const at = key => layout.nodes.find(n => n.key === key)
    // 底盘链同一行（无分支的长链不跳行）
    expect(at('chassis:track0').row).toBe(at('chassis:track1').row)
    // 炮与它的炮塔相邻列、行不强制同族（这正是客户端拓扑排布）
    expect(at('gun:L11').col).toBe(at('turret:t0').col + 1)
    // 引擎是另一条根分支，行与底盘/炮塔不同
    expect(at('engine:eng0').col).toBe(0)
    // F34 的入边：L11 → F34 有 2000/2200 两条（数值独立），显示最小
    expect(at('gun:F34').cost).toBe(2000)
    // 每列不重叠
    const used = new Set()
    for (const n of layout.nodes) {
      const slot = `${n.col},${n.row}`
      expect(used.has(slot)).toBe(false)
      used.add(slot)
    }
  })

  it('下一级坦克是图里的节点，由解锁它的模块连出去（客户端同构）', () => {
    const layout = moduleTreeLayout(modules, null, {
      nextVehicles: [{ stem: 'MT25', name: 'MT-25', tankId: 2 }],
    })
    const vehicle = layout.nodes.find(n => n.key === 'vehicle:MT25')
    expect(vehicle).toBeTruthy()
    expect(vehicle.kind).toBe('vehicle')
    expect(vehicle.tankId).toBe(2)
    // 边来自解锁它的炮（F34 的 vehicle 边），且位于炮的右侧一列
    const edge = layout.edges.find(e => e.to === 'vehicle:MT25')
    expect(edge.from).toBe('gun:F34')
    const source = layout.nodes.find(n => n.key === edge.from)
    expect(vehicle.col).toBe(source.col + 1)
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

  it('不同族同名模块不串味（实测 A-20：底盘与炮塔都叫 A-20_mod_1938）', () => {
    const same = {
      chassis: [
        { stem: 'A-20_mod_1938', localId: 16, level: 3, unlocks: [{ kind: 'chassis', stem: 'A-20_mod_1941' }] },
        { stem: 'A-20_mod_1941', localId: 17, level: 4, unlocks: [] },
      ],
      engines: [{ stem: 'V-2', level: 5, unlocks: [] }],
      turrets: [
        { stem: 'A-20_mod_1938', localId: 14, level: 3, unlocks: [], guns: [{ stem: 'g0', level: 3, unlocks: [] }] },
      ],
    }
    // 只装初始履带：同名炮塔的 tick 不该把升级履带也点亮
    const first = moduleTreeLayout(same, { canConfigure: true, turret: 0, gun: 0, engine: 0, track: 0 })
    const chassisInstalled = first.nodes.filter(n => n.kind === 'chassis' && n.installed).map(n => n.stem)
    expect(chassisInstalled).toEqual(['A-20_mod_1938'])
    // 只装升级履带：同名炮塔的 tick 不该把初始履带也点亮
    const second = moduleTreeLayout(same, { canConfigure: true, turret: 0, gun: 0, engine: 0, track: 1 })
    const chassisInstalled2 = second.nodes.filter(n => n.kind === 'chassis' && n.installed).map(n => n.stem)
    expect(chassisInstalled2).toEqual(['A-20_mod_1941'])
    // 研发深度按 kind:stem 计算：底盘链 0→1 不与同名炮塔合并
    const depth = Object.fromEntries(second.nodes.map(n => [`${n.kind}:${n.stem}`, n.col]))
    expect(depth['chassis:A-20_mod_1938']).toBe(0)
    expect(depth['chassis:A-20_mod_1941']).toBe(1)
    expect(depth['turret:A-20_mod_1938']).toBe(0)
  })

  it('炮塔→炮的挂载线：每个炮塔连到它挂的每一门炮；节点不重叠', () => {
    const layout = moduleTreeLayout(modules)
    const mounts = layout.edges.filter(e => e.mount)
    // t0 挂 L11/F34，t1 挂 L11/ZiS4（夹具）→ 4 条挂载线；共享的 L11 只出一个节点、两个炮塔各连一条
    expect(mounts.map(e => `${e.from}->${e.to}`).sort()).toEqual([
      'turret:t0->gun:F34',
      'turret:t0->gun:L11',
      'turret:t1->gun:L11',
      'turret:t1->gun:ZiS4',
    ])
    // 一格一节点
    const cells = new Set()
    for (const n of layout.nodes) {
      const cell = `${n.col},${n.row}`
      expect(cells.has(cell)).toBe(false)
      cells.add(cell)
    }
  })

  it('非首个炮副本上的 vehicle 边也要收进图（实测 japan NC27 形态）', () => {
    const nc = {
      chassis: [{ stem: 'c0', level: 1, unlocks: [] }],
      engines: [{ stem: 'e0', level: 1, unlocks: [] }],
      turrets: [
        { stem: 't0', level: 1, unlocks: [{ kind: 'turret', stem: 't1', cost: { xp: 100 } }], guns: [
          { stem: 'g0', level: 1, unlocks: [] },
        ] },
        { stem: 't1', level: 2, unlocks: [], guns: [
          // 同一门炮的第二份副本才带 vehicle 边
          { stem: 'g0', level: 1, unlocks: [{ kind: 'vehicle', stem: 'Chi_Ni', cost: { xp: 9000 } }] },
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
