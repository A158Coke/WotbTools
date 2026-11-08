// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

// 每个用例重新加载模块：useBreakpoint 在模块级共享一组 matchMedia 监听
function stubMatchMedia(width, coarse = false, { landscape = false, height = 800 } = {}) {
  const listeners = []
  const evaluate = (query) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    if (min) return width >= Number(min[1])
    if (query.includes('(pointer: coarse) and (orientation: landscape)')) {
      return width < 768 || (coarse && landscape && height <= 520)
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

  it('手机竖屏（宽 < 768）→ 抽屉外壳', async () => {
    stubMatchMedia(390, true, { height: 664 })
    const bp = (await import('./useBreakpoint.js')).useBreakpoint()
    expect(bp.isDrawerShell.value).toBe(true)
  })

  it('手机横屏宽度 ≥ 768（844×340）仍是抽屉外壳，不回到侧边栏', async () => {
    stubMatchMedia(844, true, { landscape: true, height: 340 })
    const bp = (await import('./useBreakpoint.js')).useBreakpoint()
    expect(bp.tier.value).toBe('medium')
    expect(bp.isDrawerShell.value).toBe(true)
  })

  it('平板（触屏但高度足够）与非触屏横屏 → 侧边栏', async () => {
    stubMatchMedia(1024, true, { landscape: true, height: 768 })
    let bp = (await import('./useBreakpoint.js')).useBreakpoint()
    expect(bp.isDrawerShell.value).toBe(false)
    vi.resetModules()
    stubMatchMedia(900, false, { landscape: true, height: 390 })
    bp = (await import('./useBreakpoint.js')).useBreakpoint()
    expect(bp.isDrawerShell.value).toBe(false)
  })
})
