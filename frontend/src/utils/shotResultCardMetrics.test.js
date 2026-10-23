import { describe, expect, it } from 'vitest'
import { isCompactShotResultCard, shotResultCardMetrics } from './shotResultCardMetrics.js'

describe('shot result card metrics', () => {
  it('uses compact metrics for narrow portrait viewports', () => {
    expect(isCompactShotResultCard(390, 844)).toBe(true)
    expect(isCompactShotResultCard(320, 568)).toBe(true)
    expect(isCompactShotResultCard(844, 390)).toBe(false)
    expect(isCompactShotResultCard(800, 1000)).toBe(false)
  })

  it('compact metrics are strictly smaller than desktop metrics', () => {
    const compact = shotResultCardMetrics(true)
    const desktop = shotResultCardMetrics(false)
    for (const key of ['topFont', 'titleFont', 'damageFont', 'chanceFont', 'expectedFont', 'expectedLine',
      'layerFont', 'layerLine', 'bulletWidth', 'indexWidth', 'inlineGap', 'damageGap', 'marginTight', 'marginNormal']) {
      expect(compact[key], key).toBeLessThan(desktop[key])
    }
    expect(compact.padding).not.toBe(desktop.padding)
  })
})
