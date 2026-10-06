import { describe, it, expect } from 'vitest'
import {
  nameChainOf, nearestDestructibleState, stateVisualLabel, formatPickReport,
} from './pickDebug.js'

const chainObj = (names) => {
  // names 自顶向下 → 返回最底端节点（parent 链向上）
  let node = null
  let parent = null
  for (const nm of names) {
    node = { name: nm, parent }
    parent = node
  }
  return node
}

describe('nameChainOf', () => {
  it('自底向上收集命名层级，到 stopAt 为止且不含 stopAt', () => {
    const root = { name: 'gltf.scene' }
    const mid = { name: 'stn_07_stnddo2.sc2', parent: root }
    const mesh = { name: 'mesh_0', parent: mid }
    expect(nameChainOf(mesh, root)).toEqual(['mesh_0', 'stn_07_stnddo2.sc2'])
  })
  it('匿名层级跳过；无 stopAt 时收集到根', () => {
    const a = { name: 'a' }
    const anon = { parent: a }
    const b = { name: 'b', parent: anon }
    expect(nameChainOf(b)).toEqual(['b', 'a'])
  })
})

describe('nearestDestructibleState', () => {
  const states = [
    { inst: { id: 1, pos: [10, 10, 0] } },
    { inst: { id: 2, pos: [12, 10, 0] } },
    { inst: { id: 3, pos: [100, 100, 0] } },
  ]
  it('半径内取最近实例', () => {
    expect(nearestDestructibleState(states, 11, 10, 3)?.inst.id).toBe(2)
  })
  it('半径外 / 空 states → null', () => {
    expect(nearestDestructibleState(states, 50, 50, 3)).toBeNull()
    expect(nearestDestructibleState([], 0, 0, 3)).toBeNull()
    expect(nearestDestructibleState(null, 0, 0, 3)).toBeNull()
  })
  it('inst 缺 pos 的状态被跳过（不抛错）', () => {
    expect(nearestDestructibleState([{ inst: {} }, ...states], 11, 10, 3)?.inst.id).toBe(2)
  })
})

describe('stateVisualLabel', () => {
  it('prop=3：pivot 带旋转 = fallen，恒等四元数 = standing', () => {
    expect(stateVisualLabel({ prop: 3, pivot: { quaternion: { x: 0.1, y: 0, z: 0, w: 0.9 } } }).label).toBe('fallen/falling')
    expect(stateVisualLabel({ prop: 3, pivot: { quaternion: { x: 0, y: 0, z: 0, w: 1 } } }).label).toBe('standing')
    expect(stateVisualLabel({ prop: 3 }).label).toBe('standing')
  })
  it('prop=1/2：损毁态可见且完好态不可见 = destroyed', () => {
    const vis = (v) => ({ visible: v })
    expect(stateVisualLabel({ prop: 1, deadMeshes: [vis(true)], intactMeshes: [vis(false)] }).label).toBe('destroyed')
    expect(stateVisualLabel({ prop: 2, deadMeshes: [vis(false)], intactMeshes: [vis(true)] }).label).toBe('intact')
  })
  it('null 状态 → null（非可破坏物）', () => {
    expect(stateVisualLabel(null)).toBeNull()
  })
})

describe('formatPickReport', () => {
  it('包含时刻/节点/场景坐标/实例 id+serverId/当前状态', () => {
    const text = formatPickReport({
      clock: 31.2,
      kind: 'scenery',
      node: 'stn_07_stnddo2.sc2',
      world: [1.234, 2.345, 3.456],
      scene: [-50.5, -54.5, 34.5],
      inst: { id: 24190, kind: 'tree', name: 'Spruce1.sc2', serverId: { cell: [0, -2], slot: 16 }, pos: [-50.5, -54.5, 34.5] },
      vis: { prop: 3, label: 'standing' },
    })
    expect(text).toContain('[scene-pick] t=31.20s kind=scenery')
    expect(text).toContain('node: stn_07_stnddo2.sc2')
    expect(text).toContain('scene: (-50.5, -54.5, 34.5)')
    expect(text).toContain('id=24190 tree Spruce1.sc2 serverId={cell:[0,-2],slot:16}')
    expect(text).toContain('当前=standing(prop=3/tree-fall)')
  })
  it('空点击带 err；车辆行输出 eid 与车型', () => {
    expect(formatPickReport({ clock: 1, kind: 'empty', err: 'no hit' })).toContain('err: no hit')
    const v = formatPickReport({ clock: 2, kind: 'vehicle', vehicle: { eid: 7, tank_id: 12345 } })
    expect(v).toContain('vehicle: eid=7 tank_12345')
  })
  it('无 serverId 的实例显式标注（不在 lka）', () => {
    const text = formatPickReport({
      clock: 0, kind: 'scenery', node: 'x.sc2', inst: { id: 9, kind: 'switcher', name: 'x.sc2' },
    })
    expect(text).toContain('serverId=无(不在lka)')
  })
})
