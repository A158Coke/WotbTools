// 点选卡"入射角/等效装甲"的几何换算（纯函数）：确定性几何，不含转正/口径规则。
// 厚度模式用它；判定模式的等效来自判定结果，不经过本函数。
import { describe, expect, it } from 'vitest'
import { faceAngleAndEffective } from './judgment.ts'

const n = (x: number, y: number, z: number) => ({ x, y, z })

describe('faceAngleAndEffective', () => {
  it('垂直入射：0°、等效 = 名义厚度', () => {
    const r = faceAngleAndEffective(100, n(0, 0, 1), n(0, 0, -1))
    expect(r.angleDeg).toBeCloseTo(0, 6)
    expect(r.effective).toBeCloseTo(100, 6)
  })

  it('45° 入射：等效 = 名义 × √2', () => {
    const d = n(Math.SQRT1_2, 0, -Math.SQRT1_2)
    const r = faceAngleAndEffective(100, n(0, 0, 1), d)
    expect(r.angleDeg).toBeCloseTo(45, 6)
    expect(r.effective).toBeCloseTo(100 * Math.SQRT2, 6)
  })

  it('法线方向正负不影响夹角（近背远正/背面同值）', () => {
    const a = faceAngleAndEffective(80, n(0, 0, 1), n(0, 0, -1))
    const b = faceAngleAndEffective(80, n(0, 0, -1), n(0, 0, -1))
    expect(a.angleDeg).toBeCloseTo(b.angleDeg!, 6)
    expect(a.effective).toBeCloseTo(b.effective!, 6)
  })

  it('掠射（cos→0）按 0.05 下限钳制，等效有限', () => {
    const r = faceAngleAndEffective(100, n(0, 0, 1), n(1, 0, -1e-9))
    expect(r.angleDeg).toBeGreaterThan(89)
    expect(r.effective).toBeCloseTo(2000, 0)   // 100 / 0.05
  })

  it('缺失法线/方向或非法厚度 → null（fail-closed，UI 显示 —）', () => {
    expect(faceAngleAndEffective(100, null, n(0, 0, -1))).toEqual({ angleDeg: null, effective: null })
    expect(faceAngleAndEffective(100, n(0, 0, 1), null)).toEqual({ angleDeg: null, effective: null })
    expect(faceAngleAndEffective(Number.NaN, n(0, 0, 1), n(0, 0, -1))).toEqual({ angleDeg: null, effective: null })
  })
})
