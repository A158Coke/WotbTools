import { describe, expect, it, vi } from 'vitest'
import {
  computeMap3dRenderTarget,
  getMaxRenderBufferSize,
} from './map3dRenderSizing.js'

const source = { textureWidth: 4048, textureHeight: 4048, maxRenderBufferSize: 8192 }

describe('computeMap3dRenderTarget', () => {
  it('tracks fit, 2× and 4× layout-scaled CSS sizes at DPR 1', () => {
    const fit = computeMap3dRenderTarget({ cssWidth: 768, cssHeight: 763, devicePixelRatio: 1, ...source })
    const zoom2 = computeMap3dRenderTarget({ cssWidth: 1536, cssHeight: 1526, devicePixelRatio: 1, ...source })
    const zoom4 = computeMap3dRenderTarget({ cssWidth: 3072, cssHeight: 3052, devicePixelRatio: 1, ...source })

    expect(fit).toMatchObject({ pixelRatio: 1, drawingBufferWidth: 768, drawingBufferHeight: 763 })
    expect(zoom2).toMatchObject({ pixelRatio: 1, drawingBufferWidth: 1536, drawingBufferHeight: 1526 })
    expect(zoom4).toMatchObject({ pixelRatio: 1, drawingBufferWidth: 3072, drawingBufferHeight: 3052 })
  })

  it('uses DPR 2 while the source has headroom at 2×', () => {
    const target = computeMap3dRenderTarget({
      cssWidth: 1536,
      cssHeight: 1526,
      devicePixelRatio: 2,
      ...source,
    })

    expect(target.pixelRatio).toBe(2)
    expect(target.drawingBufferWidth).toBe(3072)
    expect(target.drawingBufferHeight).toBe(3052)
  })

  it('caps DPR 2 at 4× by the 4048 source texture instead of over-rendering', () => {
    const target = computeMap3dRenderTarget({
      cssWidth: 3072,
      cssHeight: 3052,
      devicePixelRatio: 2,
      ...source,
    })

    expect(target.pixelRatio).toBeCloseTo(4048 / 3072, 8)
    expect(target.drawingBufferWidth).toBe(4048)
    expect(target.drawingBufferHeight).toBe(4022)
  })
})

describe('getMaxRenderBufferSize', () => {
  it('reads MAX_RENDERBUFFER_SIZE from the active WebGL context', () => {
    const getParameter = vi.fn(() => 4096)
    const renderer = {
      getContext: () => ({ MAX_RENDERBUFFER_SIZE: 0x84e8, getParameter }),
    }

    expect(getMaxRenderBufferSize(renderer)).toBe(4096)
    expect(getParameter).toHaveBeenCalledWith(0x84e8)
  })

  it('returns null when the context cannot provide a renderbuffer limit', () => {
    expect(getMaxRenderBufferSize({ getContext: () => ({}) })).toBeNull()
    expect(
      getMaxRenderBufferSize({
        getContext: () => { throw new Error('lost context') },
      }),
    ).toBeNull()
  })
})
