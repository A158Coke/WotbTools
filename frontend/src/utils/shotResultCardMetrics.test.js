import { describe, expect, it } from 'vitest'
import { isCompactShotResultCard, shotResultCardMaxWidth, shotResultCardMetrics } from './shotResultCardMetrics.js'

describe('shot result card metrics', () => {
  it('uses compact metrics for narrow portrait and short landscape viewports', () => {
    expect(isCompactShotResultCard(390, 844)).toBe(true)
    expect(isCompactShotResultCard(320, 568)).toBe(true)
    expect(isCompactShotResultCard(844, 390)).toBe(true)   // 横屏手机
    expect(isCompactShotResultCard(667, 375)).toBe(true)
    expect(isCompactShotResultCard(1280, 720)).toBe(false) // 桌面
    expect(isCompactShotResultCard(1024, 600)).toBe(false)
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

describe('shotResultCardMaxWidth', () => {
  it('caps compact cards at 420px and follows the canvas width', () => {
    expect(shotResultCardMaxWidth(757, 844, 390)).toBe(420)   // 横屏手机：封顶
    expect(shotResultCardMaxWidth(357, 390, 844)).toBe(341)   // 竖屏窄画布：画布-16
    expect(shotResultCardMaxWidth(900, 1280, 720)).toBe(868)  // 桌面：画布-32
    expect(shotResultCardMaxWidth(0, 1280, 720)).toBeNull()
  })
})
