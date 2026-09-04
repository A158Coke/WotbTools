import { describe, expect, it } from 'vitest'
import {
  RADAR_AVERAGE_VALUE,
  RADAR_DISPLAY_CAP,
  RADAR_STRONG_VALUE,
  formatRadarVisualScore,
  radarAxisVisualScore,
  radarBoundedVisualValue,
  radarRadiusRatio,
  radarVisualValue,
  scaleBoundedRadarSeries,
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

  it('maps League V6 zero / cohort average / strong threshold / dimension max to 0 / 75 / 100 / 150', () => {
    const average = 40
    const max = 100
    expect(radarBoundedVisualValue(0, average, max)).toBe(0)
    expect(radarBoundedVisualValue(20, average, max)).toBe(37.5)
    expect(radarBoundedVisualValue(average, average, max)).toBe(RADAR_AVERAGE_VALUE)
    expect(radarBoundedVisualValue(average + (max - average) / 3, average, max)).toBe(RADAR_STRONG_VALUE)
    expect(radarBoundedVisualValue(max, average, max)).toBe(RADAR_DISPLAY_CAP)
  })

  it('maps the approved League V6 screenshot sample with average75/max150 semantics', () => {
    const player = [290, 90, 53, 75, 26, 148, 11]
    const average = [183, 69, 37, 35, 22, 89, 34]
    const max = [365, 110, 110, 75, 50, 180, 110]
    const expected = [119.1, 113.4, 91.4, 150, 85.7, 123.6, 24.3]
    player.forEach((value, index) => {
      expect(radarBoundedVisualValue(value, average[index], max[index])).toBeCloseTo(expected[index], 1)
    })
  })

  it('fails closed when bounded League V6 anchors are missing, invalid, or contradictory', () => {
    for (const [player, reference, max] of [
      [null, 20, 100], ['', 20, 100], [Number.NaN, 20, 100],
      [10, null, 100], [10, 0, 100], [10, Number.POSITIVE_INFINITY, 100],
      [10, 20, null], [10, 20, 0], [10, 20, Number.NaN],
      [-1, 20, 100], [101, 20, 100], [10, 100, 100], [10, 101, 100],
    ]) {
      expect(radarBoundedVisualValue(player, reference, max)).toBeNull()
    }
  })

  it('converts visual values into the invisible-150 geometry radius', () => {
    expect(radarRadiusRatio(75)).toBe(0.5)
    expect(radarRadiusRatio(100)).toBeCloseTo(2 / 3, 12)
    expect(radarRadiusRatio(150)).toBe(1)
    expect(radarRadiusRatio(200)).toBe(1)
  })

  it('resolves the shared 0..150 score for vertex labels and detail mode', () => {
    expect(radarAxisVisualScore({ available: true, visualValue: 124.4, normalized: 0.1 })).toBe(124.4)
    expect(radarAxisVisualScore({ available: true, visualValue: null, normalized: 0.5 })).toBe(75)
    expect(radarAxisVisualScore({ available: true, visualValue: 200, normalized: 1 })).toBe(150)
    expect(radarAxisVisualScore({ available: false, visualValue: 90, normalized: 0.6 })).toBeNull()
    expect(formatRadarVisualScore({ available: true, visualValue: 124.6 })).toBe('125')
    expect(formatRadarVisualScore({ available: false, visualValue: 90 })).toBe('--')
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

  it('scales League V6 by authoritative per-axis max while preserving a regular 75 reference ring', () => {
    const metrics = [
      { key: 'damage', rawValue: 80, displayValue: '80 / 100', available: true },
      { key: 'assist', rawValue: 20, displayValue: '20 / 120', available: true },
    ]
    const reference = [
      { key: 'assist', rawValue: 40, displayValue: '40 / 120', available: true },
      { key: 'damage', rawValue: 50, displayValue: '50 / 100', available: true },
    ]

    const scaled = scaleBoundedRadarSeries(metrics, reference, { damage: 100, assist: 120 })
    expect(scaled.metrics.map(axis => axis.key)).toEqual(['damage', 'assist'])
    expect(scaled.metrics[0].visualValue).toBe(120)
    expect(scaled.metrics[1].visualValue).toBe(37.5)
    expect(scaled.reference.map(axis => axis.key)).toEqual(['damage', 'assist'])
    expect(scaled.reference.map(axis => axis.visualValue)).toEqual([75, 75])
    expect(scaled.reference.map(axis => axis.normalized)).toEqual([0.5, 0.5])
  })

  it('marks League V6 player/reference unavailable when authoritative max metadata is absent', () => {
    const metric = { key: 'assist', rawValue: 60, displayValue: '60', available: true }
    const reference = { key: 'assist', rawValue: 40, displayValue: '40', available: true }
    for (const maxByKey of [{}, { assist: null }, { assist: 0 }, { assist: 40 }]) {
      const scaled = scaleBoundedRadarSeries([metric], [reference], maxByKey)
      expect(scaled.metrics[0]).toMatchObject({ key: 'assist', available: false, normalized: null })
      expect(scaled.reference[0]).toMatchObject({ key: 'assist', available: false, normalized: null })
    }
  })
})
