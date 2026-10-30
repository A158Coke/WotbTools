// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

// 每个用例重新加载模块：useBreakpoint 在模块级共享一组 matchMedia 监听
function stubMatchMedia(width, coarse = false, { landscape = false, height = 800 } = {}) {
  const listeners = []
  const evaluate = (query) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    if (min) return width >= Number(min[1])
    if (query.includes('(pointer: coarse) and (orientation: landscape)')) {
      return coarse && landscape && height <= 520 && width <= 1199.98
    }
    if (query.includes('pointer: coarse')) return coarse
    return false
  }
  vi.stubGlobal('matchMedia', (query) => ({
    get matches() { return evaluate(query) },
    addEventListener: (_type, cb) => listeners.push(cb),
  }))
  return {
    resize(next) { width = next; listeners.forEach(cb => cb()) },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('useBreakpoint', () => {
  it.each([[375, 'compact'], [767, 'compact'], [768, 'medium'], [1199, 'medium'], [1200, 'expanded']])(
    'classifies %ipx as %s', async (width, tier) => {
      stubMatchMedia(width)
      const { useBreakpoint } = await import('./useBreakpoint.js')
      expect(useBreakpoint().tier.value).toBe(tier)
    })

  it('updates when the viewport crosses a breakpoint', async () => {
    const media = stubMatchMedia(1024)
    const { useBreakpoint } = await import('./useBreakpoint.js')
    const { tier, isCompact } = useBreakpoint()
    expect(tier.value).toBe('medium')
    media.resize(390)
    expect(isCompact.value).toBe(true)
  })

  it('reports the pointer type independently of width', async () => {
    stubMatchMedia(1366, true)
    const { useBreakpoint, usePointer } = await import('./useBreakpoint.js')
    expect(useBreakpoint().tier.value).toBe('expanded')
    expect(usePointer().coarse.value).toBe(true)
  })

  it('compact + 触屏横屏矮视口 → 左侧图标栏形态', async () => {
    stubMatchMedia(740, true, { landscape: true, height: 390 })
    const { useBreakpoint } = await import('./useBreakpoint.js')
    const bp = useBreakpoint()
    expect(bp.isCompact.value).toBe(true)
    expect(bp.isCompactLandscape.value).toBe(true)
  })

  it('横屏但不是触屏 / 高度足够 → 保持底部 Tab 形态', async () => {
    stubMatchMedia(740, false, { landscape: true, height: 390 })
    let bp = (await import('./useBreakpoint.js')).useBreakpoint()
    expect(bp.isCompactLandscape.value).toBe(false)
    vi.resetModules()
    stubMatchMedia(740, true, { landscape: true, height: 900 })
    bp = (await import('./useBreakpoint.js')).useBreakpoint()
    expect(bp.isCompactLandscape.value).toBe(false)
  })
})
