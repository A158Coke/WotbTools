import { describe, it, expect } from 'vitest'
import {
  buildDestructibleIndex, resolveDestructibleEvent, fallTipVector, fallRotation, fallDurationS,
  foldDestructibleStates, TREE_FALL_MIN_S, TREE_FALL_MAX_S, TREE_FALL_DEFAULT_HEIGHT_M,
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
    const r = fallRotation(192, fallDurationS(8), 8)
    expect(r.axis[0]).toBeCloseTo(0)
    expect(r.axis[1]).toBeCloseTo(1)
    expect(r.axis[2]).toBeCloseTo(0)
    expect(r.angle).toBeCloseTo(Math.PI / 2)
  })
  it('elapsed<0 → null；单调递增；时长处 = 90°（落地硬停）', () => {
    const L = 8
    const T = fallDurationS(L)
    expect(fallRotation(0, -0.1, L)).toBeNull()
    const mid = fallRotation(0, T / 2, L)
    const end = fallRotation(0, T, L)
    const past = fallRotation(0, T * 3, L)
    expect(mid.angle).toBeGreaterThan(0)
    expect(mid.angle).toBeLessThan(end.angle)
    expect(end.angle).toBeCloseTo(Math.PI / 2)
    expect(past.angle).toBeCloseTo(Math.PI / 2)   // 超出后钳位，不回弹
  })
})

describe('fallDurationS（倒伏时长 ∝ √(L/g)，客户端逐类型物理的近似）', () => {
  it('随树高单调增：15m 冷杉 ≈ 1.8s、3m 灌木 ≈ 0.8s、1m 草丛 ≈ 0.5s', () => {
    const tall = fallDurationS(15)
    const bush = fallDurationS(3)
    const grass = fallDurationS(1)
    expect(tall).toBeGreaterThan(bush)
    expect(bush).toBeGreaterThan(grass)
    expect(tall).toBeCloseTo(1.51 * Math.sqrt(15 / 9.81), 2)
    expect(bush).toBeCloseTo(1.51 * Math.sqrt(3 / 9.81), 2)
    expect(grass).toBeCloseTo(0.48, 1)
  })
  it('钳位 [min,max]，缺省/非法高度退化为中型树', () => {
    expect(fallDurationS(1000)).toBe(TREE_FALL_MAX_S)
    expect(fallDurationS(0.01)).toBe(TREE_FALL_MIN_S)
    for (const bad of [undefined, null, 0, -5, NaN, Infinity]) {
      expect(fallDurationS(bad)).toBe(fallDurationS(TREE_FALL_DEFAULT_HEIGHT_M))
    }
  })
  it('角速度单调加速（重力矩 ∝ sinθ）：半程位移 < 线性半程（前慢后快、落地最快）', () => {
    const T = fallDurationS(10)
    const half = fallRotation(0, T / 2, 10).angle
    expect(half).toBeLessThan(Math.PI / 4)
    // 相邻等步长的位移增量递增（加速）
    const step = T / 8
    let prev = 0
    const deltas = []
    for (let i = 1; i <= 8; i++) {
      const a = fallRotation(0, i * step, 10).angle
      deltas.push(a - prev)
      prev = a
    }
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]).toBeGreaterThan(deltas[i - 1])
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
