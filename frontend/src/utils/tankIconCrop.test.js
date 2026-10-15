import { describe, expect, it } from 'vitest'
import { tankIconCropMetrics, tankIconCropTransform } from './tankIconCrop.js'

/** 容器宽归一化为 1；返回内容框在应用变换后的几何（供断言）。 */
function artGeometryAfterTransform(crop, boxAspect) {
  const { canvas_w: cw, canvas_h: ch, x, y, w, h } = crop
  const m = tankIconCropMetrics(crop, boxAspect)
  const den = Math.min(1 / cw, 1 / (boxAspect * ch))
  const s = den // 容器宽 = 1 时的 contain 缩放
  const bx = (1 - cw * s) / 2 // contain 后图片在容器内的偏移（居中）
  const by = (1 / boxAspect - ch * s) / 2
  // 内容框中心（变换前，容器坐标）
  const cx = bx + (x + w / 2) * s
  const cy = by + (y + h / 2) * s
  // 先以容器中心 scale、再平移；translateY(%) 相对元素高度（= 容器高）换算回宽单位
  const cx2 = 0.5 + m.scale * (cx - 0.5) + m.tx
  const cy2 = 0.5 / boxAspect + m.scale * (cy - 0.5 / boxAspect) + m.ty / boxAspect
  return {
    cx: cx2,
    cy: cy2,
    dispW: w * s * m.scale,
    dispH: h * s * m.scale,
    boxH: 1 / boxAspect,
  }
}

describe('tankIconCropTransform（数据驱动封面图展示裁剪）', () => {
  it('256×128 画布左上锚定内容框：内容中心对回容器中心，且按短边铺满', () => {
    const crop = { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 141, h: 101 }
    const A = 8 / 5
    const g = artGeometryAfterTransform(crop, A)
    expect(g.cx).toBeCloseTo(0.5, 4)
    expect(g.cy).toBeCloseTo(g.boxH / 2, 4)
    // 内容框高 101/128 小于画布高 → 以高度受限：应恰好铺满容器高
    expect(g.dispH).toBeCloseTo(g.boxH, 4)
    expect(g.dispW).toBeLessThanOrEqual(1 + 1e-6)
  })

  it('内容框为整张画布时退化为无缩放平移（scale=1, tx=ty=0）', () => {
    const crop = { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 256, h: 128 }
    const m = tankIconCropMetrics(crop, 8 / 5)
    expect(m.scale).toBeCloseTo(1, 6)
    expect(m.tx).toBeCloseTo(0, 6)
    expect(m.ty).toBeCloseTo(0, 6)
  })

  it('128×128 画布：水平居中内容框不产生水平平移', () => {
    const crop = { canvas_w: 128, canvas_h: 128, x: 0, y: 0, w: 128, h: 99 }
    const m = tankIconCropMetrics(crop, 8 / 5)
    expect(m.tx).toBeCloseTo(0, 6)
    expect(m.ty).toBeGreaterThan(0)
  })

  it('非法/缺字段输入返回 null 与空串（回退原始 contain 展示）', () => {
    expect(tankIconCropMetrics(null, 1.6)).toBeNull()
    expect(tankIconCropMetrics({ canvas_w: 0, canvas_h: 128, x: 0, y: 0, w: 10, h: 10 }, 1.6)).toBeNull()
    expect(tankIconCropMetrics({ canvas_w: 256, canvas_h: 128, x: 100, y: 0, w: 200, h: 10 }, 1.6))
      .toBeNull() // 越界
    expect(tankIconCropTransform({ canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 141, h: 101 }, 0)).toBe('')
    expect(tankIconCropTransform(null, 1.6)).toBe('')
  })

  it('transform 字符串可被 CSS 解析（translate% + scale）', () => {
    const t = tankIconCropTransform({ canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 141, h: 101 }, 1.6)
    expect(t).toMatch(/^translate\(-?[\d.]+%, -?[\d.]+%\) scale\([\d.]+\)$/)
  })
})
