import { describe, expect, it } from 'vitest'
import { applyEraser, commit, redo, undo } from './annotation.js'

describe('applyEraser (semantic capsule)', () => {
  const pen = (points) => ({ type: 'pen', color: '#fff', width: 3, points })

  it('clips a stroke at capsule boundaries and splits into sub-segments', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }]
    const result = applyEraser([pen(points)], [{ x: 15, y: 0 }], 6) // 覆盖 [9,21]
    expect(result).toHaveLength(2)
    expect(result[0].points).toEqual([{ x: 0, y: 0 }, { x: 9, y: 0 }])
    expect(result[1].points).toEqual([{ x: 21, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 }])
  })

  it('clips an endpoint at the capsule boundary, preserving the rest', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]
    const result = applyEraser([pen(points)], [{ x: 2, y: 0 }], 4)
    expect(result).toHaveLength(1)
    expect(result[0].points).toEqual([{ x: 6, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])
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

  it('erases the middle of a sparse 10m segment that point-distance would miss', () => {
    const sparse = pen([{ x: 0, y: 0 }, { x: 10, y: 0 }])
    const result = applyEraser([sparse], [{ x: 5, y: 0 }], 1)
    expect(result).toHaveLength(2)
    expect(result[0].points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }])
    expect(result[1].points).toEqual([{ x: 6, y: 0 }, { x: 10, y: 0 }])
  })

  it('isolates bridge eraser from a coincident terrain stroke', () => {
    const terrain = pen([{ x: 0, y: 0 }, { x: 10, y: 0 }])
    const bridge = pen([{ x: 0, y: 0, surfaceY: 10 }, { x: 10, y: 0, surfaceY: 10 }])
    const result = applyEraser([terrain, bridge], [{ x: 5, y: 0, surfaceY: 10 }], 1)
    expect(result).toContain(terrain)
    const bridgePieces = result.filter((ann) => ann !== terrain)
    expect(bridgePieces).toHaveLength(2)
    expect(bridgePieces.every((ann) => ann.points.every((p) => p.surfaceY === 10))).toBe(true)
  })

  it('isolates terrain eraser from a coincident bridge stroke', () => {
    const terrain = pen([{ x: 0, y: 0 }, { x: 10, y: 0 }])
    const bridge = pen([{ x: 0, y: 0, surfaceY: 10 }, { x: 10, y: 0, surfaceY: 10 }])
    const result = applyEraser([terrain, bridge], [{ x: 5, y: 0 }], 1)
    expect(result).toContain(bridge)
    const terrainPieces = result.filter((ann) => ann !== bridge)
    expect(terrainPieces).toHaveLength(2)
    expect(terrainPieces.every((ann) => ann.points.every((p) => p.surfaceY === undefined))).toBe(true)
  })

  it('isolates different anchored surface heights at the same XZ', () => {
    const low = pen([{ x: 0, y: 0, surfaceY: 10 }, { x: 10, y: 0, surfaceY: 10 }])
    const high = pen([{ x: 0, y: 0, surfaceY: 20 }, { x: 10, y: 0, surfaceY: 20 }])
    const result = applyEraser([low, high], [{ x: 5, y: 0, surfaceY: 10 }], 1)
    expect(result).toContain(high)
    expect(result.filter((ann) => ann !== high)).toHaveLength(2)
  })

  it('does not connect a ground↔bridge transition with one capsule', () => {
    const transition = pen([{ x: 0, y: 0 }, { x: 10, y: 0, surfaceY: 10 }])
    const result = applyEraser([transition], [{ x: 5, y: 0, surfaceY: 10 }], 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(transition)
  })

  it('erases a stroke on the same 45° plane even when raw surfaceY differs by XZ offset', () => {
    const normal = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 }
    const bridge = pen([
      { x: 0, y: 1, surfaceY: 7, surfaceN: normal },
      { x: 10, y: 1, surfaceY: 7, surfaceN: normal },
    ])
    const result = applyEraser([bridge], [{ x: 5, y: 0, surfaceY: 8, surfaceN: normal }], 1.1)
    expect(result).toHaveLength(2)
    expect(result.every((ann) => ann !== bridge)).toBe(true)
  })

  it('clips only the layer-compatible prefix when a capsule interval crosses the layer threshold', () => {
    const slope = Math.tan((5 * Math.PI) / 180)
    const strokeNormal = { x: slope, y: 1, z: 0 }
    const stroke = pen([
      { x: 0, y: 0, surfaceY: 10.1, surfaceN: strokeNormal },
      { x: 10, y: 0, surfaceY: 10.1 + 10 * slope, surfaceN: strokeNormal },
    ])
    const result = applyEraser([stroke], [{ x: 5, y: 0, surfaceY: 10, surfaceN: { x: 0, y: 1, z: 0 } }], 12.26)
    expect(result).toHaveLength(1)
    const points = result[0].points
    expect(points[0].x).toBeGreaterThan(4.5)
    expect(points[0].x).toBeLessThan(4.7)
    expect(points[points.length - 1].x).toBeCloseTo(10, 6)
  })

  it('clips only the layer-compatible suffix for the reverse 5° slope', () => {
    const slope = Math.tan((5 * Math.PI) / 180)
    const strokeNormal = { x: -slope, y: 1, z: 0 }
    const stroke = pen([
      { x: 0, y: 0, surfaceY: 10.1 + 10 * slope, surfaceN: strokeNormal },
      { x: 10, y: 0, surfaceY: 10.1, surfaceN: strokeNormal },
    ])
    const result = applyEraser([stroke], [{ x: 5, y: 0, surfaceY: 10, surfaceN: { x: 0, y: 1, z: 0 } }], 12.26)
    expect(result).toHaveLength(1)
    const points = result[0].points
    expect(points[0].x).toBe(0)
    expect(points[points.length - 1].x).toBeGreaterThan(5.3)
    expect(points[points.length - 1].x).toBeLessThan(5.6)
  })

  it('does not erase a parallel plane 2m away on the same 45° normal', () => {
    const normal = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 }
    const bridge = pen([
      { x: 0, y: 1, surfaceY: 7, surfaceN: normal },
      { x: 10, y: 1, surfaceY: 7, surfaceN: normal },
    ])
    const annotations = [bridge]
    const result = applyEraser(annotations, [{ x: 5, y: 0, surfaceY: 10, surfaceN: normal }], 1.1)
    expect(result).toBe(annotations)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(bridge)
  })

  it('does not mutate annotation points on a no-op eraser pass', () => {
    const points = [{ x: 0, y: 0 }, { x: 0, y: 0, surfaceY: 10 }]
    const bridge = pen(points)
    const annotations = [bridge]
    const snapshot = structuredClone(annotations)
    const result = applyEraser(annotations, [{ x: 100, y: 100 }], 1)
    expect(result).toBe(annotations)
    expect(annotations).toEqual(snapshot)
  })

  it('treats a long eraser segment as a capsule, not as sparse points', () => {
    const result = applyEraser([pen([{ x: 0, y: 0 }, { x: 10, y: 0 }])], [{ x: 5, y: -50 }, { x: 5, y: 50 }], 1)
    expect(result).toHaveLength(2)
    expect(result[0].points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }])
    expect(result[1].points).toEqual([{ x: 6, y: 0 }, { x: 10, y: 0 }])
  })

  it('accepts a single-point eraser path', () => {
    const result = applyEraser([pen([{ x: 0, y: 0 }, { x: 10, y: 0 }])], [{ x: 5, y: 0 }], 2)
    expect(result).toHaveLength(2)
    expect(result[0].points[1].x).toBeCloseTo(3, 9)
    expect(result[1].points[0].x).toBeCloseTo(7, 9)
  })

  it('erases inside the start cap even when the rectangle body projection misses', () => {
    const stroke = pen([{ x: -1, y: -1 }, { x: -1, y: 1 }])
    expect(applyEraser([stroke], [{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)).toEqual([])
  })

  it('erases inside the end cap even when the rectangle body projection misses', () => {
    const stroke = pen([{ x: 11, y: -1 }, { x: 11, y: 1 }])
    expect(applyEraser([stroke], [{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)).toEqual([])
  })

  it('capsule endpoint caps are direction-symmetric', () => {
    const stroke = pen([{ x: -1, y: -1 }, { x: -1, y: 1 }])
    expect(applyEraser([stroke], [{ x: 10, y: 0 }, { x: 0, y: 0 }], 2)).toEqual([])
  })

  it('leaves the stroke untouched outside caps and body', () => {
    const stroke = pen([{ x: 5, y: 10 }, { x: 6, y: 10 }])
    const anns = [stroke]
    expect(applyEraser(anns, [{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)).toBe(anns)
  })

  it('clips only the cap-covered prefix of a stroke', () => {
    const stroke = pen([{ x: -3, y: 0 }, { x: 0, y: 0 }])
    const result = applyEraser([stroke], [{ x: 0, y: 0 }, { x: 10, y: 0 }], 2)
    expect(result).toHaveLength(1)
    expect(result[0].points).toEqual([{ x: -3, y: 0 }, { x: -2, y: 0 }])
  })

  it('undo restores the erased geometry and redo erases it again', () => {
    const original = pen([{ x: 0, y: 0 }, { x: 10, y: 0 }])
    let state = commit([[]], 0, [original])
    const erased = applyEraser(state.history[state.index], [{ x: 5, y: 0 }], 1)
    state = commit(state.history, state.index, erased)
    expect(state.history[state.index]).toHaveLength(2)
    state = undo(state.history, state.index)
    expect(state.history[state.index]).toHaveLength(1)
    expect(state.history[state.index][0]).toBe(original)
    state = redo(state.history, state.index)
    expect(state.history[state.index]).toHaveLength(2)
  })
})
