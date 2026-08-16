/**
 * pivot 旋转数学测试（Blocker 2 — OFF_CENTER_TURRET_HULL_COMPOSITION）：
 * turret 是「随 hull 移动的装配」——hull 旋转后炮塔座圈屏幕位置
 * P' = C + rotate(P - C, H)，不是固定不动点；最终 turret world yaw = T。
 * 覆盖车型：Grille 15（明显后置 pivot）、Maus、FV4005、Leopard-1。
 */
import { describe, expect, it } from 'vitest'
import { VIEWBOX } from './types.js'
import {
  hullLayerTransform,
  markerTurretAssemblyTransform,
  markerTurretImageTransform,
  turretAssemblyTransform,
  turretImageTransform,
  turretRingPosition,
} from './pivot.js'

const C = { x: VIEWBOX.width / 2, y: VIEWBOX.height / 2 }

// 真实 metadata.turretPivot（viewBox 绝对坐标）
const PIVOTS = {
  'grille-15': { x: 160.1, y: 220.36 }, // 明显后置（offset ≈ +60px）
  maus: { x: 160, y: 193.23 }, // 轻度后置
  fv4005: { x: 160.28, y: 163.22 }, // 近中心
  'leopard-1': { x: 160, y: 143.61 }, // 轻度前置
}

/** 数学验证辅助：以 origin 为不动点的 rotate(deg) 下，点 point 的像（2D 仿射，角度制）。 */
function rotatePointAround({ point, origin, deg }) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

describe('turretRingPosition（座圈随 hull 移动，P2 = C + rotate(P-C, H)）', () => {
  it('H=0 时座圈停留在 turretPivot（0° 渲染不变）', () => {
    for (const [name, p] of Object.entries(PIVOTS)) {
      const pos = turretRingPosition({ pivot: p, hullDeg: 0 })
      expect(pos.x).toBeCloseTo(p.x, 9)
      expect(pos.y).toBeCloseTo(p.y, 9)
    }
  })

  it('Grille 15（后置 pivot）hull 90° 后座圈必须移动，不再是固定 screen point', () => {
    const p = PIVOTS['grille-15']
    const pos = turretRingPosition({ pivot: p, hullDeg: 90 })
    // P-C = (0.1, 60.36) → R90 = (-60.36, 0.1) → P' = (99.64, 160.1)
    expect(pos.x).toBeCloseTo(99.64, 6)
    expect(pos.y).toBeCloseTo(160.1, 6)
    // 旧错误假设：座圈停在 (160.1, 220.36) 不动 —— 必须 FAIL
    expect(pos.x).not.toBeCloseTo(p.x, 1)
    expect(pos.y).not.toBeCloseTo(p.y, 1)
  })

  it('hull 180° 时后置座圈对称到车辆中心另一侧（上移）', () => {
    const p = PIVOTS['grille-15']
    const pos = turretRingPosition({ pivot: p, hullDeg: 180 })
    expect(pos.x).toBeCloseTo(159.9, 6)
    expect(pos.y).toBeCloseTo(99.64, 6)
  })

  it('hull 270° 时座圈回到 P 的顺时针旋转位（P2 = C - R90(P-C)）', () => {
    const p = PIVOTS['grille-15']
    const pos = turretRingPosition({ pivot: p, hullDeg: 270 })
    // R270(-60.36, 0.1) = (60.36, -0.1) → P' = (220.36, 159.9)
    expect(pos.x).toBeCloseTo(220.36, 6)
    expect(pos.y).toBeCloseTo(159.9, 6)
  })

  it('Maus / FV4005 / Leopard-1 也随 hull 移动（与参考 rotatePointAround 一致）', () => {
    for (const deg of [0, 90, 180, 270]) {
      for (const [name, p] of Object.entries(PIVOTS)) {
        const pos = turretRingPosition({ pivot: p, hullDeg: deg })
        const ref = rotatePointAround({ point: p, origin: C, deg })
        expect(pos.x).toBeCloseTo(ref.x, 9)
        expect(pos.y).toBeCloseTo(ref.y, 9)
      }
    }
  })
})

describe('嵌套 transform composition（最终 world yaw = T，座圈 = P2）', () => {
  // H/T 组合（用户指定 + 全车辆）
  const CASES = [
    { hullDeg: 0, turretWorldDeg: 0 },
    { hullDeg: 90, turretWorldDeg: 0 },
    { hullDeg: 90, turretWorldDeg: 90 },
    { hullDeg: 180, turretWorldDeg: 45 },
    { hullDeg: 270, turretWorldDeg: 10 },
  ]

  it('transform-origin 与旋转角度正确（父层绕 C、子层绕 image-local pivot）', () => {
    const parent = turretAssemblyTransform({ hullDeg: 90 })
    expect(parent.transformOrigin).toBe('160px 160px')
    expect(parent.transform).toBe('rotate(90deg)')
    const child = turretImageTransform({ hullDeg: 90, turretWorldDeg: 120, pivot: { x: 40.09, y: 432.28 } })
    expect(child.transformOrigin).toBe('40.09px 432.28px')
    expect(child.transform).toBe('rotate(30deg)') // T - H
  })

  it('子层旋转 (T-H) + 父层旋转 H = 最终 world yaw T（炮管方向正确）', () => {
    for (const { hullDeg: H, turretWorldDeg: T } of CASES) {
      for (const [name, p] of Object.entries(PIVOTS)) {
        // 炮管指向图片上方（viewBox y 向下 → up = -y）：v = P + (0, -1)
        const v = { x: p.x, y: p.y - 1 }
        const child = turretImageTransform({ hullDeg: H, turretWorldDeg: T, pivot: p })
        const imgDeg = T - H
        // 模拟 CSS 嵌套：子层绕 P 旋转 (T-H)，父层绕 C 旋转 H
        const p1 = rotatePointAround({ point: v, origin: p, deg: imgDeg })
        const p2 = rotatePointAround({ point: p1, origin: C, deg: H })
        const ring = turretRingPosition({ pivot: p, hullDeg: H })
        const dir = { x: p2.x - ring.x, y: p2.y - ring.y }
        // 期望方向 = R(T)·(0,-1) = (sin T, -cos T)
        const rad = (T * Math.PI) / 180
        expect(dir.x).toBeCloseTo(Math.sin(rad), 6)
        expect(dir.y).toBeCloseTo(-Math.cos(rad), 6)
      }
    }
  })

  it('座圈像素经嵌套 transform 落在 P2（炮塔不脱离车体）', () => {
    for (const { hullDeg: H, turretWorldDeg: T } of CASES) {
      const p = PIVOTS['grille-15']
      const imgDeg = T - H
      // 子层原点像素（image-local pivot）经嵌套 transform 的像
      const p1 = rotatePointAround({ point: p, origin: p, deg: imgDeg })
      const p2 = rotatePointAround({ point: p1, origin: C, deg: H })
      const ring = turretRingPosition({ pivot: p, hullDeg: H })
      expect(p2.x).toBeCloseTo(ring.x, 9)
      expect(p2.y).toBeCloseTo(ring.y, 9)
    }
  })

  it('renderScale 放大时 origin 按比例换算', () => {
    const parent = turretAssemblyTransform({ hullDeg: 45, renderScale: 1.5 })
    expect(parent.transformOrigin).toBe('240px 240px')
    const child = turretImageTransform({ hullDeg: 10, turretWorldDeg: 30, pivot: { x: 40, y: 432 }, renderScale: 1.5 })
    expect(child.transformOrigin).toBe('60px 648px')
    expect(child.transform).toBe('rotate(20deg)')
  })
})

describe('marker 百分比变换（Battle Playback marker，盒尺寸 CSS 控制）', () => {
  const RASTER = { logicalMinX: 112.19, logicalMinY: -19.64, logicalMaxX: 207.81, logicalMaxY: 267.24, pixelWidth: 191, pixelHeight: 574, pivotX: 47.81, pivotY: 212.87 }

  it('assembly 父层绕盒中心旋转 hullDeg（transform-origin 默认 50% 50%）', () => {
    const s = markerTurretAssemblyTransform({ hullDeg: 90 })
    expect(s.transform).toBe('rotate(90deg)')
    expect(s.transformOrigin).toBeUndefined() // 默认 = 元素中心 = 盒中心
  })

  it('image 子层：raster 百分比定位 + 绕 image-local pivot 旋转 (T - H)', () => {
    const s = markerTurretImageTransform({ hullDeg: 90, turretWorldDeg: 0, raster: RASTER })
    expect(s.left).toBe('35.0594%') // 112.19/320
    expect(s.top).toBe('-6.1375%') // -19.64/320
    expect(s.width).toBe('29.8438%') // (191/2)/320
    expect(s.height).toBe('89.6875%') // (574/2)/320
    expect(s.transformOrigin).toBe('14.9406% 66.5219%') // 47.81/320, 212.87/320
    expect(s.transform).toBe('rotate(-90deg)') // T - H
  })

  it('H/T 组合：子层旋转 (T-H) + 父层旋转 H = world yaw T（同 px 版数学）', () => {
    for (const { H, T } of [{ H: 0, T: 0 }, { H: 90, T: 0 }, { H: 90, T: 90 }, { H: 180, T: 45 }, { H: 270, T: 10 }]) {
      const child = markerTurretImageTransform({ hullDeg: H, turretWorldDeg: T, raster: RASTER })
      expect(child.transform).toBe(`rotate(${T - H}deg)`)
      const parent = markerTurretAssemblyTransform({ hullDeg: H })
      expect(parent.transform).toBe(`rotate(${H}deg)`)
    }
  })
})

describe('hullLayerTransform（hull 层）', () => {
  it('绕画布中心旋转（viewBox 中心 = hull 中心契约）', () => {
    const s = hullLayerTransform({ deg: 30 })
    const cx = VIEWBOX.width / 2
    const cy = VIEWBOX.height / 2
    expect(s.transformOrigin).toBe(`${cx}px ${cy}px`)
    expect(s.transform).toBe('rotate(30deg)')
  })

  it('turretAssemblyTransform 与 hullLayerTransform 同一数学（同绕车辆中心）', () => {
    expect(turretAssemblyTransform({ hullDeg: 90, renderScale: 2 })).toEqual(hullLayerTransform({ deg: 90, renderScale: 2 }))
  })
})
