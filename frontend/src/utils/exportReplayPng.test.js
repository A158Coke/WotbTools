// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  getExportTarget,
  computeExportDimensions,
  exportPngFilename,
  sanitizeFilename,
  downloadBlob,
  MAX_CANVAS_DIMENSION,
  MAX_SCALE
} from './exportReplayPng.js'

describe('getExportTarget', () => {
  it('returns aggregateRef for aggregate tab', () => {
    const agg = {}
    const battles = []
    expect(getExportTarget('aggregate', agg, battles)).toBe(agg)
  })

  it('returns null when aggregateRef is null', () => {
    expect(getExportTarget('aggregate', null, [])).toBeNull()
  })

  it('returns battle ref for valid battle tab', () => {
    const battles = [{ tagName: 'DIV' }, { tagName: 'DIV' }]
    expect(getExportTarget('b0', null, battles)).toBe(battles[0])
    expect(getExportTarget('b1', null, battles)).toBe(battles[1])
  })

  it('returns null for out-of-range battle index', () => {
    expect(getExportTarget('b99', null, [])).toBeNull()
  })

  it('returns null for NaN battle index', () => {
    expect(getExportTarget('bx', null, [{}])).toBeNull()
  })
})

describe('computeExportDimensions', () => {
  function el(w, h) {
    return { scrollWidth: w, scrollHeight: h }
  }

  it('uses scroll dimensions', () => {
    const d = computeExportDimensions(el(2000, 500))
    expect(d.width).toBe(2000)
    expect(d.height).toBe(500)
    expect(d.scale).toBeGreaterThan(0)
  })

  it('does not exceed MAX_SCALE', () => {
    const d = computeExportDimensions(el(500, 300))
    expect(d.scale).toBeLessThanOrEqual(MAX_SCALE)
  })

  it('normal size uses high scale', () => {
    const d = computeExportDimensions(el(1920, 1080))
    expect(d.scale).toBeGreaterThan(1.9)
    expect(d.scale).toBeLessThanOrEqual(MAX_SCALE)
  })

  it('falls back for zero dimensions', () => {
    const d = computeExportDimensions(el(0, 0))
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('falls back for negative dimensions', () => {
    const d = computeExportDimensions(el(-100, -200))
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('handles NaN scrollWidth gracefully', () => {
    const d = computeExportDimensions(el(NaN, 500))
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('handles Infinity scrollHeight gracefully', () => {
    const d = computeExportDimensions(el(500, Infinity))
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  function assertFiniteWithin(d, label) {
    expect(Number.isFinite(d.width), `${label} width`).toBe(true)
    expect(Number.isFinite(d.height), `${label} height`).toBe(true)
    expect(Number.isFinite(d.scale), `${label} scale finite`).toBe(true)
    expect(d.scale, `${label} scale > 0`).toBeGreaterThan(0)
    expect(d.width * d.scale, `${label} width*scale`).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale, `${label} height*scale`).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  }

  it('40000 x 1000', () => {
    assertFiniteWithin(computeExportDimensions(el(40000, 1000)), '40kx1k')
  })

  it('1000 x 40000', () => {
    assertFiniteWithin(computeExportDimensions(el(1000, 40000)), '1kx40k')
  })

  it('40000 x 40000', () => {
    assertFiniteWithin(computeExportDimensions(el(40000, 40000)), '40kx40k')
  })

  it('100000 x 100000', () => {
    assertFiniteWithin(computeExportDimensions(el(100000, 100000)), '100kx100k')
  })

  it('2000000 x 1000', () => {
    assertFiniteWithin(computeExportDimensions(el(2000000, 1000)), '2Mx1k')
  })

  it('1000 x 2000000', () => {
    assertFiniteWithin(computeExportDimensions(el(1000, 2000000)), '1kx2M')
  })

  it('2000000 x 2000000', () => {
    assertFiniteWithin(computeExportDimensions(el(2000000, 2000000)), '2Mx2M')
  })

  it('1920 x 1080 stays within limit', () => {
    assertFiniteWithin(computeExportDimensions(el(1920, 1080)), '1920x1080')
  })

  // Ultra-large finite dimensions must never produce scale=0
  it('very large finite dimension keeps scale > 0', () => {
    const d = computeExportDimensions(el(1e12, 1e12))
    expect(d.scale).toBeGreaterThan(0)
    assertFiniteWithin(d, '1e12')
  })

  it('extremely large finite dimension keeps scale > 0', () => {
    const d = computeExportDimensions(el(1e15, 1e15))
    expect(d.scale).toBeGreaterThan(0)
    assertFiniteWithin(d, '1e15')
  })
})

describe('exportPngFilename', () => {
  it('generates aggregate filename', () => {
    const name = exportPngFilename('aggregate', 0)
    expect(name).toMatch(/^wotb-replay-\d{8}-\d{6}-aggregate\.png$/)
  })

  it('generates battle filename with map name', () => {
    const name = exportPngFilename('b0', 0, 'Lagoon')
    expect(name).toMatch(/^wotb-replay-\d{8}-\d{6}-Lagoon\.png$/)
  })

  it('generates battle filename without map name', () => {
    const name = exportPngFilename('b2', 2)
    expect(name).toMatch(/^wotb-replay-\d{8}-\d{6}-battle-3\.png$/)
  })

  it('sanitizes map name in filename', () => {
    const name = exportPngFilename('b0', 0, 'Maps/Test: Zone')
    expect(name).not.toContain('/')
    expect(name).not.toContain(':')
    expect(name).toMatch(/\.png$/)
  })

  it('does not contain invalid filename characters', () => {
    const name = exportPngFilename('aggregate', 0)
    expect(name).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/)
  })
})

describe('sanitizeFilename', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('a/b:c*d?')).toBe('a_b_c_d')
  })

  it('replaces backslash', () => {
    expect(sanitizeFilename('a\\b')).toBe('a_b')
  })

  it('replaces angle brackets', () => {
    expect(sanitizeFilename('<tag>')).toBe('tag')
  })

  it('collapses multiple underscores', () => {
    expect(sanitizeFilename('a   b')).toBe('a_b')
  })

  it('trims leading and trailing underscores', () => {
    expect(sanitizeFilename('__hello__')).toBe('hello')
  })

  it('returns default for empty result', () => {
    expect(sanitizeFilename('')).toBe('export')
  })

  it('returns default for only-invalid input', () => {
    expect(sanitizeFilename('<>:"/\\|?*')).toBe('export')
  })
})

describe('downloadBlob', () => {
  let origCreateObjectURL
  let origRevokeObjectURL

  beforeEach(() => {
    origCreateObjectURL = URL.createObjectURL
    origRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = origCreateObjectURL
    URL.revokeObjectURL = origRevokeObjectURL
  })

  it('rejects null blob', async () => {
    await expect(downloadBlob(null, 'test.png')).rejects.toThrow('Blob is null')
  })

  it('cleans up anchor and revokes URL after download', async () => {
    const appendChild = vi.spyOn(document.body, 'appendChild')
    const removeChild = vi.spyOn(document.body, 'removeChild')

    await downloadBlob(new Blob(['test']), 'out.png')
    await new Promise(r => setTimeout(r, 200))

    expect(appendChild).toHaveBeenCalled()
    expect(removeChild).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('rejects and cleans up when a.click() throws', async () => {
    // Create an anchor whose click() throws
    const origCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag)
      if (tag === 'a') {
        el.click = () => { throw new Error('click failed') }
      }
      return el
    })

    const appendChild = vi.spyOn(document.body, 'appendChild')

    await expect(downloadBlob(new Blob(['test']), 'out.png')).rejects.toThrow('click failed')

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    createSpy.mockRestore()
  })
})
