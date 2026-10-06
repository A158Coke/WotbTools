import { describe, it, expect } from 'vitest'
import {
  buildDestructibleIndex, resolveDestructibleEvent, fallTipVector, fallRotation, fallDurationS,
  fallStopAngle, foldDestructibleStates, treeFrame, TREE_FALL_MIN_S, TREE_FALL_MAX_S,
  TREE_FALL_DEFAULT_HEIGHT_M, TREE_FALL_MIN_STOP_RAD,
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
    const r = fallRotation(192, fallDurationS(8), 8)
    expect(r.axis[0]).toBeCloseTo(0)
    expect(r.axis[1]).toBeCloseTo(1)
    expect(r.axis[2]).toBeCloseTo(0)
    expect(r.angle).toBeCloseTo(Math.PI / 2)
  })
  it('elapsed<0 → null；恒角速度线性增长；时长处 = 停止角并钳位（硬停）', () => {
    const L = 8
    const T = fallDurationS(L)
    expect(fallRotation(0, -0.1, L)).toBeNull()
    const q = fallRotation(0, T / 4, L)
    const mid = fallRotation(0, T / 2, L)
    const end = fallRotation(0, T, L)
    const past = fallRotation(0, T * 3, L)
    expect(q.angle).toBeCloseTo(Math.PI / 8, 6)
    expect(mid.angle).toBeCloseTo(Math.PI / 4, 6)
    expect(end.angle).toBeCloseTo(Math.PI / 2)
    expect(past.angle).toBeCloseTo(Math.PI / 2)
  })
  it('停止角可小于 90°（触地限制）：传入 stopRad 后终态即该角', () => {
    const L = 8
    const T = fallDurationS(L)
    const stop = (50 * Math.PI) / 180
    const mid = fallRotation(0, T / 2, L, stop)
    const end = fallRotation(0, T * 2, L, stop)
    expect(mid.angle).toBeCloseTo(stop / 2, 6)
    expect(end.angle).toBeCloseTo(stop, 6)
    expect(fallRotation(0, T, L, stop).stopRad).toBeCloseTo(stop, 9)
    expect(fallRotation(0, T, L, NaN).angle).toBeCloseTo(Math.PI / 2, 6)
    expect(fallRotation(0, T, L, 3).angle).toBeCloseTo(Math.PI / 2, 6)
  })
})

describe('fallStopAngle（停止角 = 树干触地角；随位置与倒向变化）', () => {
  const base = { x: 0, y: 0, z: 0 }
  it('平坦地面 → 90°（完全倒平）', () => {
    expect(fallStopAngle(0, base, 10, () => 0)).toBeCloseTo(Math.PI / 2, 9)
  })
  it('朝上坡倒（地面沿倒向升高）→ 停得更早；坡度越大停得越早（θ ≈ atan(1/k)）', () => {
    const slope = (k) => (lx, ly) => Math.max(0, -ly * k)
    const gentle = fallStopAngle(0, base, 10, slope(0.2))
    const steep = fallStopAngle(0, base, 10, slope(1.0))
    expect(gentle).toBeCloseTo(Math.atan(1 / 0.2), 1)
    expect(steep).toBeCloseTo(Math.atan(1 / 1.0), 1)
    expect(steep).toBeLessThan(gentle)
    expect(gentle).toBeLessThan(Math.PI / 2)
    expect(fallStopAngle(0, base, 10, slope(5))).toBeCloseTo(TREE_FALL_MIN_STOP_RAD, 6)
  })
  it('前方有坎（台阶）→ 撞击点更低的高度即停；下坡 → 仍到 90°', () => {
    const step = () => 3
    const s = fallStopAngle(0, base, 10, step)
    expect(s).toBeLessThan(Math.PI / 2)
    const c = Math.cos(s), sn = Math.sin(s)
    const hits = Array.from({ length: 10 }, (_, i) => ((i + 1) * 10) / 10)
      .some((h) => h * c <= 3 && h * sn <= 10)
    expect(hits).toBe(true)
    const downhill = () => -5
    expect(fallStopAngle(0, base, 10, downhill)).toBeCloseTo(Math.PI / 2, 9)
  })
  it('地面采样缺失 / 非有限值 → 按平坦地面 90°；倒向不同 → 触地角不同', () => {
    expect(fallStopAngle(0, base, 10, null)).toBeCloseTo(Math.PI / 2, 9)
    expect(fallStopAngle(0, base, 10, () => NaN)).toBeCloseTo(Math.PI / 2, 9)
    const hill = (lx, ly) => (ly < -1 ? 6 : 0)
    const intoHill = fallStopAngle(0, base, 10, hill)
    const awayHill = fallStopAngle(128, base, 10, hill)
    expect(intoHill).toBeLessThan(awayHill)
    expect(awayHill).toBeCloseTo(Math.PI / 2, 9)
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
  it('恒定角速度：等时长步进的角增量相等（客户端 angle += dt 累积语义）', () => {
    const T = fallDurationS(10)
    const step = T / 8
    const deltas = []
    let prev = 0
    for (let i = 1; i <= 8; i++) {
      const a = fallRotation(0, i * step, 10).angle
      deltas.push(a - prev)
      prev = a
    }
    for (const d of deltas) expect(d).toBeCloseTo(Math.PI / 2 / 8, 9)
  })
})

describe('foldDestructibleStates', () => {
  it('同物体取最早事件，按 clock 排序，未解析事件剔除', () => {
    const idx = buildDestructibleIndex(doc)
    const areas = new Map([[11, { eid: 11, x: -150.2, z: -254.5 }], [12, { eid: 12, x: -160, z: -240 }]])
    const states = foldDestructibleStates([
      { clock: 20, area_eid: 11, slot: 17, prop: 1, fall_dir: 5 },
      { clock: 12.68, area_eid: 11, slot: 17, prop: 1, fall_dir: 5 },
      { clock: 24.88, area_eid: 12, slot: 99, prop: 3, fall_dir: 1 },
    ], areas, idx)
    expect(states).toHaveLength(1)
    expect(states[0].clock).toBe(12.68)
    expect(states[0].inst.id).toBe(1)
  })

  it('树的 settled 缓存随 pivot 实际角度自校验：倒带 identity / 动画中间态会重新变 false', () => {
    const idx = buildDestructibleIndex(doc)
    const areas = new Map([[21, { eid: 21, x: -184.4, z: -116.1 }]])
    const [state] = foldDestructibleStates([
      { clock: 10, area_eid: 21, slot: 1, prop: 3, fall_dir: 0 },
    ], areas, idx)
    expect(state).toBeTruthy()
    state.stopRad = Math.PI / 2
    state.pivot = { quaternion: { w: Math.cos(Math.PI / 4) } }
    state.settled = true
    expect(state.settled).toBe(true)

    // seek 到事件前：场景会 quaternion.identity()；缓存必须自动失效
    state.pivot.quaternion.w = 1
    expect(state.settled).toBe(false)

    // seek 回动画中间：仍不能误判终态；到 stopRad 后才再次视为 settled
    state.pivot.quaternion.w = Math.cos(Math.PI / 8)
    expect(state.settled).toBe(false)
    state.pivot.quaternion.w = Math.cos(Math.PI / 4)
    expect(state.settled).toBe(true)
  })

  it('空事件流 / 空 areas → 空数组', () => {
    expect(foldDestructibleStates(null, new Map(), buildDestructibleIndex(doc))).toEqual([])
  })
})

describe('treeFrame（场景每帧树推进决策；锁定倒带序列）', () => {
  const mkState = () => ({ clock: 10, prop: 3, fallDir: 0, heightM: 15, stopRad: 1.2, settled: false })

  it('未激活 / 事件前 → null；动画帧 = 恒定角速度旋转并标 animating', () => {
    const st = mkState()
    expect(treeFrame(st, false, 50)).toBeNull()
    expect(treeFrame(st, true, 5)).toBeNull()          // active 但 elapsed < 0：不写终态
    const dur = fallDurationS(15)
    const mid = treeFrame(st, true, 10 + dur * 0.5)
    expect(mid.animating).toBe(true)
    expect(mid.angle).toBeCloseTo(0.6, 9)              // stop·u，恒定角速度
    expect(mid.axis).toEqual(fallRotation(0, dur, 15, 1.2).axis)
  })

  it('终态帧：精确停止角 + settled 置位；此后再越过终点 → null（缓存跳过）', () => {
    const st = mkState()
    const dur = fallDurationS(15)
    const fin = treeFrame(st, true, 10 + dur + 1)
    expect(fin.animating).toBe(false)
    expect(fin.angle).toBe(1.2)                        // 停止角精确写入
    expect(st.settled).toBe(true)
    expect(treeFrame(st, true, 10 + dur + 2)).toBeNull()
  })

  it('倒带序列（评审 P0 回归）：终态 → 事件前 → 动画中 → 终态，最终旋转必须重写', () => {
    const st = mkState()
    const dur = fallDurationS(15)
    // ① 播过倒伏终点：终态落盘
    const t1 = treeFrame(st, true, 10 + dur + 1)
    expect(t1.angle).toBe(1.2)
    expect(st.settled).toBe(true)
    // ② seek 回事件前：场景 rewind 分支清 settled + pivot 归 identity（未激活 → null）
    st.settled = false
    expect(treeFrame(st, false, 5)).toBeNull()
    // ③ 重播：动画中帧正常推进
    const mid = treeFrame(st, true, 10 + dur * 0.5)
    expect(mid.animating).toBe(true)
    expect(mid.angle).toBeLessThan(1.2)
    // ④ 再次越过终点：终态旋转**再次精确写入**（settled 未重置时这里会是 null）
    const t2 = treeFrame(st, true, 10 + dur + 1)
    expect(t2.animating).toBe(false)
    expect(t2.angle).toBe(1.2)
    expect(t2.axis).toEqual(t1.axis)
  })

  it('fold 产出的树状态：rewind 显式清零走 setter，getter 同步；终态重写不受 pivot 缺失影响', () => {
    const idx = buildDestructibleIndex(doc)
    const areas = new Map([[21, { eid: 21, x: -184.4, z: -116.1 }]])
    const [state] = foldDestructibleStates([
      { clock: 10, area_eid: 21, slot: 1, prop: 3, fall_dir: 0 },
    ], areas, idx)
    state.stopRad = 1.2
    state.settled = true
    expect(state.settled).toBe(true)     // pivot 缺失 → getter 回落存储值
    state.settled = false                // 场景 rewind 分支的显式清零（走 setter）
    expect(state.settled).toBe(false)
    expect(treeFrame(state, true, 10 + fallDurationS(15) + 1).angle).toBe(1.2)
  })
})
