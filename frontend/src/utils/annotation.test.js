import { describe, expect, it } from 'vitest'
import { createMapView } from './mapView.js'
import {
  ANNOT_COLORS,
  ANNOT_FONT_SIZE,
  ANNOT_WIDTH_MAX,
  ANNOT_WIDTH_MIN,
  UNDO_LIMIT,
  applyEraser,
  arrowHeadPoints,
  canRedo,
  canUndo,
  circleFromCorners,
  commit,
  polylinePoints,
  rectFromCorners,
  redo,
  screenToSemantic,
  screenToSvg,
  svgToScreen,
  undo
} from './annotation.js'

const mapView = createMapView({
  width: 1000,
  height: 500,
  coordinateBounds: { xMin: -300, xMax: 300, yMin: -200, yMax: 200 }
}, null)

describe('annotation constants', () => {
  it('color palette has 8 hex colors', () => {
    expect(ANNOT_COLORS).toHaveLength(8)
    for (const c of ANNOT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('width slider bounds are sane', () => {
    expect(ANNOT_WIDTH_MIN).toBeLessThan(ANNOT_WIDTH_MAX)
    expect(ANNOT_WIDTH_MIN).toBeGreaterThan(0)
  })
})

describe('screenToSemantic', () => {
  it('converts screen to semantic coords at scale 1', () => {
    // toX(0)=500, toY(0)=250（bounds 中点）
    expect(screenToSemantic({ scale: 1, tx: 0, ty: 0 }, mapView, 500, 250)).toEqual({ x: 0, y: 0 })
  })
  it('converts correctly under translate and scale', () => {
    // view: tx=100, ty=50, scale=2 → svgX=(600-100)/2=250 → x=-150；svgY=(250-50)/2=100 → y=120
    const p = screenToSemantic({ scale: 2, tx: 100, ty: 50 }, mapView, 600, 250)
    expect(p.x).toBeCloseTo(-150, 9)
    expect(p.y).toBeCloseTo(120, 9)
  })
  it('returns null for missing view/mapView/NaN input', () => {
    expect(screenToSemantic(null, mapView, 500, 250)).toBeNull()
    expect(screenToSemantic({ scale: 1, tx: 0, ty: 0 }, null, 500, 250)).toBeNull()
    expect(screenToSemantic({ scale: 1, tx: 0, ty: 0 }, mapView, NaN, 250)).toBeNull()
  })
})

describe('CSS ↔ SVG ↔ semantic conversion (rendered size)', () => {
  // Holland 同款：viewBox W=766 H=769，语义 ±300
  const holland = createMapView({
    width: 766,
    height: 769,
    coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
  }, null)
  const identity = { scale: 1, tx: 0, ty: 0 }

  it('desktop responsive: rendered map center (300,301) → semantic 0,0 (CSS px ≠ SVG unit)', () => {
    // 渲染尺寸 600×602（.pb-map clientWidth/clientHeight），点击中心
    const p = screenToSemantic(identity, holland, 300, 301, 600, 602)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)
    // 对应 SVG viewBox 坐标 ≈ 383, 384.5（300×766/600、301×769/602）
    const svg = screenToSvg(identity, holland, 300, 301, 600, 602)
    expect(svg.x).toBeCloseTo(383, 6)
    expect(svg.y).toBeCloseTo(384.5, 6)
  })

  it('mobile: rendered width 360 — center click semantic x = 0 (fromX(180) 回归防护)', () => {
    const p = screenToSemantic(identity, holland, 180, 181, 360, 361)
    expect(p.x).toBeCloseTo(0, 6)
    expect(Math.abs(p.y)).toBeLessThan(1) // 渲染高 361 取整，y 允许 ±1
  })

  it('screenToSvg ↔ svgToScreen round-trip at scale 1', () => {
    const css = { x: 123.4, y: 456.7 }
    const svg = screenToSvg(identity, holland, css.x, css.y, 600, 602)
    const back = svgToScreen(holland, identity, svg.x, svg.y, 600, 602)
    expect(back.x).toBeCloseTo(css.x, 9)
    expect(back.y).toBeCloseTo(css.y, 9)
  })

  it('zoom + pan round-trip (scale=2, tx=40, ty=-20)', () => {
    const view = { scale: 2, tx: 40, ty: -20 }
    const css = { x: 200, y: 250 }
    const svg = screenToSvg(view, holland, css.x, css.y, 600, 602)
    const back = svgToScreen(holland, view, svg.x, svg.y, 600, 602)
    expect(back.x).toBeCloseTo(css.x, 9)
    expect(back.y).toBeCloseTo(css.y, 9)
    // 完整语义往返：screen → semantic → toX/toY → screen
    const sem = screenToSemantic(view, holland, css.x, css.y, 600, 602)
    const round = svgToScreen(holland, view, holland.toX(sem.x), holland.toY(sem.y), 600, 602)
    expect(round.x).toBeCloseTo(css.x, 6)
    expect(round.y).toBeCloseTo(css.y, 6)
  })

  it('falls back to viewBox 1:1 when rendered size is missing (≤0)', () => {
    const svg = screenToSvg(identity, holland, 383, 384, 0, 0)
    expect(svg.x).toBeCloseTo(383, 9)
    expect(svg.y).toBeCloseTo(384, 9)
    const svg2 = screenToSvg(identity, holland, 383, 384)
    expect(svg2.x).toBeCloseTo(383, 9)
  })

  it('returns null for missing inputs', () => {
    expect(screenToSvg(null, holland, 1, 1, 600, 602)).toBeNull()
    expect(screenToSvg(identity, null, 1, 1, 600, 602)).toBeNull()
    expect(svgToScreen(null, identity, 1, 1, 600, 602)).toBeNull()
    expect(svgToScreen(holland, null, 1, 1, 600, 602)).toBeNull()
  })
})

describe('geometry normalization', () => {
  it('rectFromCorners anchors at top-left', () => {
    expect(rectFromCorners({ x: 10, y: 20 }, { x: -5, y: 5 })).toEqual({ x: -5, y: 5, w: 15, h: 15 })
  })
  it('circleFromCorners computes center and radius', () => {
    expect(circleFromCorners({ x: 0, y: 0 }, { x: 6, y: 8 })).toEqual({ cx: 3, cy: 4, r: 5 })
  })
  it('arrowHeadPoints starts at the tip and has 3 points', () => {
    const s = arrowHeadPoints(0, 0, 100, 0)
    expect(s.startsWith('100.00,0.00 ')).toBe(true)
    expect(s.split(' ')).toHaveLength(3)
  })
  it('polylinePoints maps semantic to SVG via toX/toY', () => {
    // toY(-100) = (200-(-100))/400*500 = 375
    expect(polylinePoints([{ x: 0, y: 0 }, { x: 100, y: -100 }], mapView.toX, mapView.toY))
      .toBe('500.00,250.00 666.67,375.00')
  })
})

describe('applyEraser (point-erase)', () => {
  const pen = (points) => ({ type: 'pen', color: '#fff', width: 3, points })

  it('removes pen points within radius and splits into segments', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }]
    const result = applyEraser([pen(points)], [{ x: 15, y: 0 }], 6) // 半径 6 覆盖 (10,0)/(20,0)
    expect(result).toHaveLength(1) // 只剩 (30,0)-(40,0) 段；(0,0) 单点段被丢弃
    expect(result[0].points).toEqual([{ x: 30, y: 0 }, { x: 40, y: 0 }])
  })

  it('removes an endpoint locally', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
    const result = applyEraser([pen(points)], [{ x: 2, y: 0 }], 4)
    expect(result).toHaveLength(1)
    expect(result[0].points).toEqual([{ x: 10, y: 0 }, { x: 20, y: 0 }])
  })

  it('erases whole pen when nothing remains with 2+ points', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
    const result = applyEraser([pen(points)], [{ x: 10, y: 0 }], 12)
    expect(result).toHaveLength(0)
  })

  it('removes whole shapes touched by the eraser and keeps untouched ones', () => {
    const line = { type: 'line', color: '#fff', width: 2, x1: 0, y1: 0, x2: 100, y2: 0 }
    const circle = { type: 'circle', color: '#fff', width: 2, cx: 0, cy: 0, r: 10 }
    const far = { type: 'circle', color: '#fff', width: 2, cx: 500, cy: 500, r: 10 }
    // (10,0) 同时在直线上（距离 0）与圆边框上（|10-10|=0）
    const result = applyEraser([line, circle, far], [{ x: 10, y: 0 }], 2)
    expect(result).toEqual([far])
  })

  it('touching the circle border erases the circle', () => {
    const circle = { type: 'circle', color: '#fff', width: 2, cx: 0, cy: 0, r: 10 }
    expect(applyEraser([circle], [{ x: 10, y: 0 }], 1)).toHaveLength(0)
    expect(applyEraser([circle], [{ x: 25, y: 0 }], 1)).toHaveLength(1) // 圆心距 25 > 1+2，未命中
  })

  it('erases text near its anchor', () => {
    const text = { type: 'text', color: '#fff', x: 0, y: 0, text: 'hi' }
    expect(applyEraser([text], [{ x: 0, y: 0 }], 1)).toHaveLength(0)
  })

  it('returns the same array for empty eraser path', () => {
    const anns = [pen([{ x: 0, y: 0 }, { x: 1, y: 0 }])]
    expect(applyEraser(anns, [], 4)).toBe(anns)
  })

  it('returns the same array when the eraser misses everything (no-op)', () => {
    const anns = [pen([{ x: 0, y: 0 }, { x: 10, y: 0 }]), { type: 'circle', color: '#fff', width: 2, cx: 0, cy: 0, r: 10 }]
    expect(applyEraser(anns, [{ x: 500, y: 500 }], 4)).toBe(anns)
  })
})

describe('snapshot undo/redo', () => {
  it('commits, undoes, redoes in order', () => {
    let { history, index } = commit([[]], 0, ['a'])
    ;({ history, index } = commit(history, index, ['a', 'b']))
    expect(index).toBe(2)
    expect(history[index]).toEqual(['a', 'b'])
    ;({ history, index } = undo(history, index))
    expect(index).toBe(1)
    expect(history[index]).toHaveLength(1)
    ;({ history, index } = redo(history, index))
    expect(index).toBe(2)
    expect(history[index]).toHaveLength(2)
  })

  it('cannot undo at the initial snapshot and cannot redo at the tail', () => {
    expect(canUndo(0)).toBe(false)
    expect(canRedo([[], [{ type: 'pen', color: '#fff', width: 3, points: [{ x: 0, y: 0 }] }]], 1)).toBe(false)
    expect(canRedo([[], []], 0)).toBe(true) // 快照 1 已提交，可从 0 前进到 1
    expect(canRedo([[], []], 1)).toBe(false)
  })

  it('a new commit after undo truncates the redo side', () => {
    let { history, index } = commit([[]], 0, ['a'])
    ;({ history, index } = commit(history, index, ['a', 'b']))
    ;({ history, index } = undo(history, index))
    ;({ history, index } = commit(history, index, ['a', 'x']))
    expect(history).toEqual([[], ['a'], ['a', 'x']])
    expect(index).toBe(2)
  })

  it('caps history at UNDO_LIMIT snapshots', () => {
    let history = [[]]
    let index = 0
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      ;({ history, index } = commit(history, index, [i]))
    }
    expect(history).toHaveLength(UNDO_LIMIT)
    expect(index).toBe(UNDO_LIMIT - 1)
    expect(history[index]).toEqual([UNDO_LIMIT + 4])
  })
})
