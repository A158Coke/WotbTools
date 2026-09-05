import { describe, expect, it } from 'vitest'
import { mapRasterDensity } from './mapRasterDensity.js'

describe('mapRasterDensity', () => {
  it.each([
    [1, 1, 768, true],
    [2, 1, 1536, true],
    [4, 1, 3072, true],
    [2, 2, 3072, true],
    [4, 2, 6144, false],
  ])('measures %sx at DPR %s as %s required device px wide', (viewScale, devicePixelRatio, requiredDeviceWidth, sufficient) => {
    const density = mapRasterDensity({
      naturalWidth: 4048,
      naturalHeight: 4048,
      renderedCssWidth: 768,
      renderedCssHeight: 768,
      viewScale,
      devicePixelRatio,
    })
    expect(density).toMatchObject({
      requiredDeviceWidth,
      requiredDeviceHeight: requiredDeviceWidth,
      widthSufficient: sufficient,
      heightSufficient: sufficient,
    })
    expect(density.effectiveSourcePxPerDevicePx).toBeCloseTo(4048 / requiredDeviceWidth, 8)
  })

  it('returns null for incomplete runtime measurements', () => {
    expect(mapRasterDensity({ naturalWidth: 4048, renderedCssWidth: 768 })).toBeNull()
    expect(mapRasterDensity({ naturalWidth: 4048, naturalHeight: 4048, renderedCssWidth: 0, renderedCssHeight: 768 })).toBeNull()
  })
})
