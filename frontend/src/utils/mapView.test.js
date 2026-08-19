import {describe, expect, it} from 'vitest'
import {createMapView} from './mapView.js'

const image = {
  width: 1000,
  height: 500,
  coordinateBounds: { xMin: -300, xMax: 300, yMin: -200, yMax: 200 }
}

describe('createMapView coordinate round-trip', () => {
  it('toX/toY map semantic coords into SVG pixels (y inverted)', () => {
    const v = createMapView(image, null)
    expect(v.toX(-300)).toBe(0)
    expect(v.toX(0)).toBe(500)
    expect(v.toX(300)).toBe(1000)
    expect(v.toY(200)).toBe(0)
    expect(v.toY(0)).toBe(250)
    expect(v.toY(-200)).toBe(500)
  })

  it('fromX/fromY invert toX/toY for edge and middle points', () => {
    const v = createMapView(image, null)
    const samples = [
      [-300, -200], [-300, 200], [300, -200], [300, 200],
      [0, 0], [123.45, -67.89], [-0.1, 0.1]
    ]
    for (const [x, y] of samples) {
      expect(v.fromX(v.toX(x))).toBeCloseTo(x, 9)
      expect(v.fromY(v.toY(y))).toBeCloseTo(y, 9)
    }
  })

  it('falls back to playableBounds when coordinateBounds missing', () => {
    const overview = { playableBounds: { xMin: 0, xMax: 100, yMin: -50, yMax: 50 } }
    const v = createMapView({ width: 200, height: 100 }, overview)
    expect(v.toX(0)).toBe(0)
    expect(v.fromX(100)).toBe(50)
    expect(v.fromY(0)).toBe(50)
  })

  it('returns null from fromX/fromY when no bounds are known', () => {
    const v = createMapView(null, null)
    expect(v.fromX(10)).toBeNull()
    expect(v.fromY(10)).toBeNull()
    expect(v.toX(10)).toBe(0)
  })
})
