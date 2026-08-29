import { describe, expect, it } from 'vitest'
import {
  RADAR_AVERAGE_VALUE,
  RADAR_DISPLAY_CAP,
  RADAR_STRONG_VALUE,
  radarRadiusRatio,
  radarVisualValue,
  scaleRadarSeries,
} from './radarScale.js'

describe('radarScale', () => {
  it('maps the approved relative-performance anchors exactly', () => {
    expect(radarVisualValue(0, 20)).toBe(0)
    expect(radarVisualValue(10, 20)).toBe(37.5)
    expect(radarVisualValue(20, 20)).toBe(RADAR_AVERAGE_VALUE)
    expect(radarVisualValue(40, 20)).toBe(RADAR_STRONG_VALUE)
    expect(radarVisualValue(80, 20)).toBe(125)
    expect(radarVisualValue(160, 20)).toBe(RADAR_DISPLAY_CAP)
    expect(radarVisualValue(1000, 20)).toBe(RADAR_DISPLAY_CAP)
  })

  it('converts visual values into the invisible-150 geometry radius', () => {
    expect(radarRadiusRatio(75)).toBe(0.5)
    expect(radarRadiusRatio(100)).toBeCloseTo(2 / 3, 12)
    expect(radarRadiusRatio(150)).toBe(1)
    expect(radarRadiusRatio(200)).toBe(1)
  })

  it('fails closed for missing, non-finite, negative, or zero-reference inputs', () => {
    for (const [player, reference] of [
      [null, 10], ['', 10], [Number.NaN, 10], [Number.POSITIVE_INFINITY, 10],
      [-1, 10], [10, null], [10, ''], [10, 0], [10, -1],
    ]) {
      expect(radarVisualValue(player, reference)).toBeNull()
    }
  })

  it('preserves raw/display values and produces a regular reference ring in player order', () => {
    const metrics = [
      { key: 'damage', rawValue: 40, displayValue: '40 / 100', normalized: 0.4, available: true },
      { key: 'assist', rawValue: 10, displayValue: '10 / 100', normalized: 0.1, available: true },
    ]
    const reference = [
      { key: 'assist', rawValue: 20, displayValue: '20 / 100', normalized: 0.2, available: true },
      { key: 'damage', rawValue: 20, displayValue: '20 / 100', normalized: 0.2, available: true },
    ]

    const scaled = scaleRadarSeries(metrics, reference)
    expect(scaled.metrics.map(axis => axis.key)).toEqual(['damage', 'assist'])
    expect(scaled.metrics.map(axis => axis.visualValue)).toEqual([100, 37.5])
    expect(scaled.metrics.map(axis => axis.displayValue)).toEqual(['40 / 100', '10 / 100'])
    expect(scaled.reference.map(axis => axis.key)).toEqual(['damage', 'assist'])
    expect(scaled.reference.map(axis => axis.rawValue)).toEqual([20, 20])
    expect(scaled.reference.map(axis => axis.visualValue)).toEqual([75, 75])
    expect(scaled.reference.map(axis => axis.normalized)).toEqual([0.5, 0.5])
  })

  it('marks both sides unavailable when the same-key reference cannot support comparison', () => {
    const metric = { key: 'assist', rawValue: 10, displayValue: '10', available: true }
    for (const reference of [
      [],
      [{ key: 'other', rawValue: 20, displayValue: '20', available: true }],
      [{ key: 'assist', rawValue: 0, displayValue: '0', available: true }],
      [{ key: 'assist', rawValue: 20, displayValue: '--', available: false }],
    ]) {
      const scaled = scaleRadarSeries([metric], reference)
      expect(scaled.metrics[0]).toMatchObject({ key: 'assist', available: false, normalized: null })
      expect(scaled.reference[0]).toMatchObject({ available: false, normalized: null })
    }
  })
})
