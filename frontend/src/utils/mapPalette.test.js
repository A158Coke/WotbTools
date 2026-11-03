// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  LUMINANCE_THRESHOLD,
  darkMapPalette,
  lightMapPalette,
  luminanceOfImage,
  paletteForLuminance
} from './mapPalette'

describe('mapPalette', () => {
  it('uses the dark palette below the threshold and the light palette at/above it', () => {
    expect(paletteForLuminance(LUMINANCE_THRESHOLD - 0.01)).toBe(darkMapPalette)
    expect(paletteForLuminance(LUMINANCE_THRESHOLD)).toBe(lightMapPalette)
    expect(paletteForLuminance(0.1)).toBe(darkMapPalette)
    expect(paletteForLuminance(0.8)).toBe(lightMapPalette)
  })

  it('falls back to the dark palette when luminance is unknown or invalid', () => {
    expect(paletteForLuminance(null)).toBe(darkMapPalette)
    expect(paletteForLuminance(undefined)).toBe(darkMapPalette)
    expect(paletteForLuminance(Number.NaN)).toBe(darkMapPalette)
    expect(paletteForLuminance(Number.POSITIVE_INFINITY)).toBe(darkMapPalette)
    expect(paletteForLuminance(Number.NEGATIVE_INFINITY)).toBe(darkMapPalette)
  })

  it('keeps warm/cool route separation and high-contrast grid on light maps', () => {
    expect(lightMapPalette.friendlyColors).toHaveLength(7)
    expect(lightMapPalette.enemyColors).toHaveLength(7)
    expect(lightMapPalette.regionStroke).toContain('0,0,0')
    expect(darkMapPalette.regionStroke).toContain('255,255,255')
  })

  it('exposes a clearly visible Battle Playback grid stroke (each column separated)', () => {
    expect(darkMapPalette.gridStrokeStrong).toContain('255,255,255')
    expect(lightMapPalette.gridStrokeStrong).toContain('0,0,0')
  })
})

// ---------- luminanceOfImage（issue #861 补口：此前零测试） ----------
// happy-dom 的 drawImage 不做真缩放：用受控像素 canvas stub 保持「读 64×64」
// 的采样路径语义不被测试改写；环境 pragma 在文件头。
describe('luminanceOfImage（64×64 降采样亮度，issue #861）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** happy-dom 的 Image 不触发 onload：src 赋值后异步回 onload（失败用例单独 stub onerror）。 */
  function stubLoadedImage() {
    const realImage = global.Image
    class LoadedImage {
      set src(_v) { setTimeout(() => this.onload?.(), 0) }
    }
    vi.stubGlobal('Image', LoadedImage)
    return realImage
  }

  /** 铺受控像素的 canvas stub：happy-dom 的 canvas 无 2D 后端（node-canvas 缺席），
   *  直接返回受控 ImageData 的 2D context——drawImage 只记尺寸，getImageData 返回
   *  整面单色的 Uint8ClampedArray，保住「读 64×64」的采样路径语义。 */
  function stubCanvasPixels(r, g, b) {
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreateElement(tag)
      if (tag === 'canvas') {
        el.getContext = (kind) => {
          if (kind !== '2d') return null
          return {
            drawImage: (_img, _dx, _dy, _w, _h) => {},
            getImageData: (_sx, _sy, w, h) => {
              const data = new Uint8ClampedArray(w * h * 4)
              for (let i = 0; i < w * h; i++) {
                data[i * 4] = r
                data[i * 4 + 1] = g
                data[i * 4 + 2] = b
                data[i * 4 + 3] = 255
              }
              return { data, width: w, height: h }
            },
          }
        }
      }
      return el
    })
  }

  it('缺少 image / image.src → null（调用方回退暗图色板）', async () => {
    await expect(luminanceOfImage(null)).resolves.toBeNull()
    await expect(luminanceOfImage({})).resolves.toBeNull()
    await expect(luminanceOfImage({ src: '' })).resolves.toBeNull()
  })

  it('图片加载失败（onerror）→ null，不抛错', async () => {
    const realImage = global.Image
    class FailingImage {
      set src(_v) { setTimeout(() => this.onerror?.(new Error('404')), 0) }
    }
    vi.stubGlobal('Image', FailingImage)
    try {
      await expect(luminanceOfImage({ src: '/missing.webp' })).resolves.toBeNull()
    } finally {
      global.Image = realImage
    }
  })

  it('纯白 → 亮度接近 1；纯黑 → 接近 0（sRGB 线性化 0.2126/0.7152/0.0722 加权）', async () => {
    stubLoadedImage()
    stubCanvasPixels(255, 255, 255)
    await expect(luminanceOfImage({ src: 'white.webp' })).resolves.toBeCloseTo(1, 3)
    stubCanvasPixels(0, 0, 0)
    await expect(luminanceOfImage({ src: 'black.webp' })).resolves.toBeCloseTo(0, 3)
  })

  it('中灰 (128) 线性化 ≈ 0.216：锁线性化与加权公式不漂移（落在暗图阈值侧）', async () => {
    stubLoadedImage()
    stubCanvasPixels(128, 128, 128)
    const gray = await luminanceOfImage({ src: 'gray.webp' })
    expect(gray).toBeGreaterThan(0.2)
    expect(gray).toBeLessThan(0.235)
  })

  it('canvas 2D context 不可用 → null', async () => {
    stubLoadedImage()
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreateElement(tag)
      if (tag === 'canvas') el.getContext = () => null
      return el
    })
    await expect(luminanceOfImage({ src: 'white.webp' })).resolves.toBeNull()
  })
})
