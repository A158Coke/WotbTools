// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { ratingV2RadarBatchAverage, ratingV2RadarComplete, ratingV2RadarMetrics } from './ratingV2Radar.js'

const t = key => key
const KEYS = ['potential_damage_avg', 'kast', 'impact', 'assist_avg', 'multi_damage_rate', 'kills_avg']

function row(values) {
  return {
    radar: KEYS.map((key, index) => ({
      key,
      rawValue: values[index][0],
      normalized: values[index][1],
      available: true,
    })),
  }
}

describe('ratingV2Radar', () => {
  it('keeps V2’s fixed six-axis order and formats raw values without recalculating geometry', () => {
    const metrics = ratingV2RadarMetrics(row([
      [4000, 0.8], [75, 0.75], [300, 1], [3000, 0.75], [55, 0.55], [1.5, 0.6],
    ]), t, 'en-US')

    expect(metrics.map(metric => metric.key)).toEqual(KEYS)
    expect(metrics.map(metric => metric.normalized)).toEqual([0.8, 0.75, 1, 0.75, 0.55, 0.6])
    expect(metrics[0].displayValue).toBe('4,000')
    expect(metrics[1].displayValue).toBe('75%')
    expect(metrics[5].displayValue).toBe('1.5')
    expect(ratingV2RadarComplete(metrics)).toBe(true)
  })

  it('uses the full V2 batch as one reference cohort and averages server-provided values', () => {
    const reference = ratingV2RadarBatchAverage([
      row([[4000, 0.8], [75, 0.75], [300, 1], [3000, 0.75], [55, 0.55], [1.5, 0.6]]),
      row([[2000, 0.4], [25, 0.25], [100, 0.4], [1000, 0.25], [25, 0.25], [0.5, 0.2]]),
    ], t, 'en-US')

    expect(reference[0]).toMatchObject({ rawValue: 3000, available: true })
    expect(reference[0].normalized).toBeCloseTo(0.6, 10)
    expect(reference[1]).toMatchObject({ rawValue: 50, available: true })
    expect(reference[1].normalized).toBeCloseTo(0.5, 10)
    expect(reference[5]).toMatchObject({ rawValue: 1, available: true })
    expect(reference[5].normalized).toBeCloseTo(0.4, 10)
  })

  it('marks a missing axis unavailable instead of substituting zero or shrinking the cohort', () => {
    const complete = row([[4000, 0.8], [75, 0.75], [300, 1], [3000, 0.75], [55, 0.55], [1.5, 0.6]])
    for (const [rawValue, normalized] of [[null, null], ['', '']]) {
      const incomplete = row([[2000, 0.4], [25, 0.25], [100, 0.4], [1000, 0.25], [25, 0.25], [0.5, 0.2]])
      incomplete.radar[2] = { key: 'impact', rawValue, normalized, available: true }

      const metrics = ratingV2RadarMetrics(incomplete, t, 'en-US')
      const reference = ratingV2RadarBatchAverage([complete, incomplete], t, 'en-US')

      expect(metrics[2]).toMatchObject({ available: false, rawValue: null, displayValue: '--' })
      expect(ratingV2RadarComplete(metrics)).toBe(false)
      expect(reference[2]).toMatchObject({ available: false, rawValue: null, displayValue: '--' })
      expect(reference[0]).toMatchObject({ available: true })
      expect(reference[0].normalized).toBeCloseTo(0.6, 10)
    }
  })
})
