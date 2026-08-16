/**
 * pivot 旋转数学测试（Blocker 2）：turret.svg 必须真正绕 metadata.turretPivot 旋转。
 * 核心断言：非中心 pivot 在 0°/90°/180°/270° 下屏幕位置保持不变（不动点）。
 */
import { describe, expect, it } from 'vitest'
import { VIEWBOX } from './types.js'
import { hullLayerTransform, pivotLayerTransform } from './pivot.js'

// 测试用非中心 pivot：证明实现不是碰巧只支持中心 pivot（正式资产如 Maus turretPivot=(160,193.23)）
const PIVOT = { x: 160, y: 150 }
const ANGLES = [0, 90, 180, 270]

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

describe('rotatePointAround（2D 仿射不动点）', () => {
  it('pivot 绕自身旋转在 0/90/180/270 下不动', () => {
    for (const deg of ANGLES) {
      const img = rotatePointAround({ point: PIVOT, origin: PIVOT, deg })
      expect(img.x).toBeCloseTo(PIVOT.x, 9)
      expect(img.y).toBeCloseTo(PIVOT.y, 9)
    }
  })

  it('任意点绕 pivot 旋转 90° 的像正确（验证矩阵方向）', () => {
    // 点 (180,150) 在 pivot 右侧 → 绕 pivot 顺时针(屏幕 y 向下)旋转 90° 后到 (160,170)
    const img = rotatePointAround({ point: { x: 180, y: 150 }, origin: PIVOT, deg: 90 })
    expect(img.x).toBeCloseTo(160, 9)
    expect(img.y).toBeCloseTo(170, 9)
  })

  it('180° 旋转后点落在 pivot 的对称位置', () => {
    const img = rotatePointAround({ point: { x: 180, y: 150 }, origin: PIVOT, deg: 180 })
    expect(img.x).toBeCloseTo(140, 9)
    expect(img.y).toBeCloseTo(150, 9)
  })
})

describe('pivotLayerTransform（turret 层）', () => {
  it('transform-origin 精确等于 pivot（1:1 渲染）', () => {
    const s = pivotLayerTransform({ deg: 45, pivot: PIVOT })
    expect(s.transformOrigin).toBe('160px 150px')
    expect(s.transform).toBe('rotate(45deg)')
  })

  it('renderScale 放大时 origin 按比例换算（画布 480 = 320×1.5）', () => {
    const s = pivotLayerTransform({ deg: 90, pivot: PIVOT, renderScale: 1.5 })
    expect(s.transformOrigin).toBe('240px 225px')
  })

  it('0/90/180/270 下 pivot 屏幕位置不变（origin 恒定 + 数学不动点）', () => {
    const scale = 1.5
    const screenOrigin = { x: PIVOT.x * scale, y: PIVOT.y * scale }
    for (const deg of ANGLES) {
      const s = pivotLayerTransform({ deg, pivot: PIVOT, renderScale: scale })
      // transform-origin 就是旋转不动点的屏幕位置
      expect(s.transformOrigin).toBe(`${screenOrigin.x}px ${screenOrigin.y}px`)
      // 数学不动点：pivot 经旋转矩阵仍回到自身
      const img = rotatePointAround({ point: PIVOT, origin: PIVOT, deg })
      expect(img.x).toBeCloseTo(PIVOT.x, 9)
      expect(img.y).toBeCloseTo(PIVOT.y, 9)
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
})
