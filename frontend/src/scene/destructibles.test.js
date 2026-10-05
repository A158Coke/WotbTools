import { describe, it, expect } from 'vitest'
import {
  buildDestructibleIndex, resolveDestructibleEvent, fallTipVector, fallRotation,
  foldDestructibleStates, TREE_FALL_DURATION_S,
} from './destructibles.js'

const doc = {
  instances: [
    { id: 1, name: 'tent', pos: [-196.6, -205.3, 0], serverId: { cell: [-2, -3], slot: 17 } },
    { id: 2, name: 'palm1', pos: [-184.4, -116.1, 0], serverId: { cell: [-2, -2], slot: 1 } },
    { id: 3, name: 'fence', pos: [150, 250, 0], serverId: { cell: [1, 2], slot: 29 } },
  ],
}

describe('buildDestructibleIndex', () => {
  it('按 (cell,slot) 建索引并跳过无 serverId 实例', () => {
    const idx = buildDestructibleIndex(doc)
    expect(idx.get('-2,-3,17')).toBe(doc.instances[0])
    expect(idx.get('-2,-2,1')).toBe(doc.instances[1])
    expect(idx.size).toBe(3)
  })
  it('空文档 / 缺 instances 返回空索引（fail-open：功能整体静默禁用）', () => {
    expect(buildDestructibleIndex(null).size).toBe(0)
    expect(buildDestructibleIndex({}).size).toBe(0)
  })
})

describe('resolveDestructibleEvent', () => {
  const idx = buildDestructibleIndex(doc)
  const areas = new Map([[11, { eid: 11, x: -150.2, z: -254.5 }]])
  it('锚点 floor 到格 + 槽位命中（受控实验 帐篷1：area(-150,-254) slot17 → tent）', () => {
    const hit = resolveDestructibleEvent({ area_eid: 11, slot: 17 }, areas, idx)
    expect(hit?.id).toBe(1)
  })
  it('贴边锚点经 ±1 邻域兜底命中', () => {
    // 锚点 x=-99.9 → floor=-1，但物体在 -2 格：邻域必须救回
    const areas2 = new Map([[12, { eid: 12, x: -99.9, z: -205 }]])
    const hit = resolveDestructibleEvent({ area_eid: 12, slot: 17 }, areas2, idx)
    expect(hit?.id).toBe(1)
  })
  it('未知区域 / 无 lka 条目 → null', () => {
    expect(resolveDestructibleEvent({ area_eid: 99, slot: 1 }, areas, idx)).toBeNull()
    expect(resolveDestructibleEvent({ area_eid: 11, slot: 99 }, areas, idx)).toBeNull()
  })
})

describe('fallTipVector / fallRotation（倒向运动学）', () => {
  it('fall_dir 指向冲量来源，树向反向倒（dir8=0 → 来源北 → 倒向南 = -y）', () => {
    const [dx, dy] = fallTipVector(0)
    expect(dx).toBeCloseTo(0)
    expect(dy).toBeCloseTo(-1)
  })
  it('反向平行对照（受控实验 1447：dir8 114 vs 231 → 倒向差 ~164°）', () => {
    const a = fallTipVector(114)
    const b = fallTipVector(231)
    const dot = a[0] * b[0] + a[1] * b[1]
    expect(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toBeCloseTo(164.5, 0)
  })
  it('tip=(1,0) 时旋转轴=(0,1,0)（右手法则把 +z 转向 +x）', () => {
    // dir8 使 tip=(1,0)：tip=(-sin a, -cos a)=(1,0) → a=270° → dir8=192
    const r = fallRotation(192, TREE_FALL_DURATION_S)
    expect(r.axis[0]).toBeCloseTo(0)
    expect(r.axis[1]).toBeCloseTo(1)
    expect(r.axis[2]).toBeCloseTo(0)
    expect(r.angle).toBeCloseTo(Math.PI / 2)
  })
  it('elapsed<0 → null；中段 smoothstep 单调且 ≤ 终态', () => {
    expect(fallRotation(0, -0.1)).toBeNull()
    const mid = fallRotation(0, TREE_FALL_DURATION_S / 2)
    const end = fallRotation(0, TREE_FALL_DURATION_S * 3)
    expect(mid.angle).toBeGreaterThan(0)
    expect(mid.angle).toBeLessThan(end.angle)
    expect(end.angle).toBeCloseTo(Math.PI / 2)
  })
})

describe('foldDestructibleStates', () => {
  it('同物体取最早事件，按 clock 排序，未解析事件剔除', () => {
    const idx = buildDestructibleIndex(doc)
    const areas = new Map([[11, { eid: 11, x: -150.2, z: -254.5 }], [12, { eid: 12, x: -160, z: -240 }]])
    const states = foldDestructibleStates([
      { clock: 20, area_eid: 11, slot: 17, prop: 1, fall_dir: 5 },   // tent 第二次（resync）
      { clock: 12.68, area_eid: 11, slot: 17, prop: 1, fall_dir: 5 }, // tent 首次
      { clock: 24.88, area_eid: 12, slot: 99, prop: 3, fall_dir: 1 }, // 无 lka → 剔除
    ], areas, idx)
    expect(states).toHaveLength(1)
    expect(states[0].clock).toBe(12.68)
    expect(states[0].inst.id).toBe(1)
  })
  it('空事件流 / 空 areas → 空数组', () => {
    expect(foldDestructibleStates(null, new Map(), buildDestructibleIndex(doc))).toEqual([])
  })
})
