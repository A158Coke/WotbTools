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

const PIVOTS = {
  'grille-15': { x: 160.1, y: 220.36 },
  maus: { x: 160, y: 193.23 },
  fv4005: { x: 160.28, y: 163.22 },
  'leopard-1': { x: 160, y: 143.61 }, // 轻度前置
}

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
    expect(pos.x).toBeCloseTo(99.64, 6)
    expect(pos.y).toBeCloseTo(160.1, 6)
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
    expect(child.transform).toBe('rotate(30deg)')
  })

  it('子层旋转 (T-H) + 父层旋转 H = 最终 world yaw T（炮管方向正确）', () => {
    for (const { hullDeg: H, turretWorldDeg: T } of CASES) {
      for (const [name, p] of Object.entries(PIVOTS)) {
        const v = { x: p.x, y: p.y - 1 }
        const child = turretImageTransform({ hullDeg: H, turretWorldDeg: T, pivot: p })
        const imgDeg = T - H
        const p1 = rotatePointAround({ point: v, origin: p, deg: imgDeg })
        const p2 = rotatePointAround({ point: p1, origin: C, deg: H })
        const ring = turretRingPosition({ pivot: p, hullDeg: H })
        const dir = { x: p2.x - ring.x, y: p2.y - ring.y }
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
  const MAUS = {
    raster: { logicalMinX: 112.19, logicalMinY: -19.64, logicalMaxX: 207.81, logicalMaxY: 267.24, pixelWidth: 191, pixelHeight: 574, pivotX: 47.81, pivotY: 212.87 },
    turretPivot: { x: 160, y: 193.23 },
  }
  const GRILLE = {
    raster: { logicalMinX: 120.01, logicalMinY: -211.92, logicalMaxX: 200.19, logicalMaxY: 292.86, pixelWidth: 160, pixelHeight: 1010, pivotX: 40.09, pivotY: 432.28 },
    turretPivot: { x: 160.1, y: 220.36 },
  }

  it('assembly 父层绕盒中心旋转 hullDeg（transform-origin 默认 50% 50%）', () => {
    const s = markerTurretAssemblyTransform({ hullDeg: 90 })
    expect(s.transform).toBe('rotate(90deg)')
    expect(s.transformOrigin).toBeUndefined()
  })

  it('image 子层：raster 百分比定位（相对 marker 盒）+ transform-origin 相对 image 自身盒（image-local pivot）', () => {
    const s = markerTurretImageTransform({ hullDeg: 90, turretWorldDeg: 0, raster: MAUS.raster })
    expect(s.left).toBe('35.0594%')
    expect(s.top).toBe('-6.1375%')
    expect(s.width).toBe('29.8438%')
    expect(s.height).toBe('89.6875%')
    expect(s.transformOrigin).toBe('50.0628% 74.1707%')
    expect(s.transform).toBe('rotate(-90deg)')
  })

  it('Grille 15（后置炮塔）：origin 同样相对 image 自身盒', () => {
    const s = markerTurretImageTransform({ hullDeg: 0, turretWorldDeg: 45, raster: GRILLE.raster })
    expect(s.transformOrigin).toBe('50.1125% 85.6000%')
    expect(s.transform).toBe('rotate(45deg)')
  })

  function composedPivot({ hullDeg, raster, turretPivot }) {
    const markerPivot = { x: raster.logicalMinX + raster.pivotX, y: raster.logicalMinY + raster.pivotY }
    expect(Math.abs(markerPivot.x - turretPivot.x)).toBeLessThanOrEqual(0.11)
    expect(Math.abs(markerPivot.y - turretPivot.y)).toBeLessThanOrEqual(0.11)
    return rotatePointAround({ point: markerPivot, origin: C, deg: hullDeg })
  }

  it('不变量：image-local pivot 复合位置 = turretRingPosition（Maus + Grille 15，H=0/90/180/270，T≠H）', () => {
    for (const { raster, turretPivot } of [MAUS, GRILLE]) {
      for (const H of [0, 90, 180, 270]) {
        for (const T of [0, 45, 120]) {
          if (T === H) continue
          const s = markerTurretImageTransform({ hullDeg: H, turretWorldDeg: T, raster })
          const [ox, oy] = s.transformOrigin.split(' ').map((v) => parseFloat(v))
          expect(ox).toBeCloseTo(raster.pivotX / (raster.pixelWidth / 2) * 100, 4)
          expect(oy).toBeCloseTo(raster.pivotY / (raster.pixelHeight / 2) * 100, 4)
          const composed = composedPivot({ hullDeg: H, raster, turretPivot })
          const ring = turretRingPosition({ pivot: turretPivot, hullDeg: H })
          expect(composed.x).toBeCloseTo(ring.x, 6)
          expect(composed.y).toBeCloseTo(ring.y, 6)
        }
      }
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
