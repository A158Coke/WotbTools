import { describe, expect, it } from 'vitest'
import { isCompactShotResultCard, shotResultCardMaxWidth, shotResultCardMetrics, shotResultCardScale } from './shotResultCardMetrics.js'

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

  it('手机档按视口短边比例缩小，桌面恒为 1（2026-11-15 用户裁示）', () => {
    expect(shotResultCardScale(390, 844)).toBe(0.88)   // 竖屏手机：下限
    expect(shotResultCardScale(844, 390)).toBe(0.88)   // 横屏手机：下限
    expect(shotResultCardScale(520, 800)).toBe(1)      // 紧凑档短边 520：不缩
    expect(shotResultCardScale(1280, 720)).toBe(1)     // 桌面：不缩
  })

  it('缩放只作用于字号/行高/间距与 padding，圆角与边框保持不变', () => {
    const base = shotResultCardMetrics(true)
    const scaled = shotResultCardMetrics(true, 0.88)
    for (const key of ['topFont', 'titleFont', 'damageFont', 'chanceFont', 'expectedFont', 'expectedLine',
      'layerFont', 'layerLine', 'bulletWidth', 'indexWidth', 'inlineGap', 'damageGap', 'marginTight', 'marginNormal']) {
      expect(scaled[key], key).toBeLessThan(base[key])
    }
    expect(scaled.padding).toBe('3.5px 7px')
    expect(scaled.radius).toBe(base.radius)
    expect(scaled.borderWidth).toBe(base.borderWidth)
    // 非法 scale 按 1 处理（渲染端不做二次兜底）
    expect(shotResultCardMetrics(true, 0)).toEqual(base)
  })
})

describe('shotResultCardMaxWidth', () => {
  it('caps compact cards at 360px, 82% of the canvas width and follows the canvas', () => {
    expect(shotResultCardMaxWidth(757, 844, 390)).toBe(360)   // 横屏手机：360 封顶更紧
    expect(shotResultCardMaxWidth(357, 390, 844)).toBe(293)   // 竖屏窄画布：画布宽 82%
    expect(shotResultCardMaxWidth(900, 1280, 720)).toBe(868)  // 桌面：画布-32
    expect(shotResultCardMaxWidth(0, 1280, 720)).toBeNull()
  })
})
