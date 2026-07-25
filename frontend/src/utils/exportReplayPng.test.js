import { describe, it, expect } from 'vitest'
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
  function mockEl(scrollW, scrollH, clientW, clientH) {
    return { scrollWidth: scrollW, scrollHeight: scrollH, clientWidth: clientW, clientHeight: clientH }
  }

  it('uses scrollWidth when larger than clientWidth', () => {
    const d = computeExportDimensions(mockEl(2000, 500, 800, 400))
    expect(d.width).toBe(2000)
    expect(d.height).toBe(500)
    expect(d.scale).toBeGreaterThan(0)
  })

  it('does not let scale exceed MAX_SCALE for small content', () => {
    const d = computeExportDimensions(mockEl(500, 300, 500, 300))
    expect(d.scale).toBeLessThanOrEqual(MAX_SCALE)
  })

  it('reduces scale for very wide content to stay within MAX_CANVAS_DIMENSION', () => {
    const d = computeExportDimensions(mockEl(MAX_CANVAS_DIMENSION * 2, 500, MAX_CANVAS_DIMENSION * 2, 500))
    expect(d.width * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  })

  it('returns fallback dimensions for zero-size element', () => {
    const d = computeExportDimensions(mockEl(0, 0, 0, 0))
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('ignores scrollLeft and always exports full content', () => {
    const el = mockEl(1500, 400, 600, 400)
    el.scrollLeft = 300
    const d = computeExportDimensions(el)
    expect(d.width).toBe(1500)
  })

  it('narrow viewport still uses full scroll width', () => {
    const d = computeExportDimensions(mockEl(1800, 400, 375, 400))
    expect(d.width).toBe(1800)
  })

  // Extreme dimension tests from PR review
  it('40000 x 1000 stays within limit', () => {
    const d = computeExportDimensions(mockEl(40000, 1000, 40000, 1000))
    expect(d.width * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  })

  it('1000 x 40000 stays within limit', () => {
    const d = computeExportDimensions(mockEl(1000, 40000, 1000, 40000))
    expect(d.width * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  })

  it('40000 x 40000 both dimensions stay within limit', () => {
    const d = computeExportDimensions(mockEl(40000, 40000, 40000, 40000))
    expect(d.width * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  })

  it('100000 x 100000 returns finite positive scale and stays within limit', () => {
    const d = computeExportDimensions(mockEl(100000, 100000, 100000, 100000))
    expect(d.scale).toBeGreaterThan(0)
    expect(Number.isFinite(d.scale)).toBe(true)
    expect(Number.isFinite(d.width)).toBe(true)
    expect(Number.isFinite(d.height)).toBe(true)
    expect(d.width * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  })

  it('normal size still gets high quality scale', () => {
    const d = computeExportDimensions(mockEl(1920, 1080, 1920, 1080))
    expect(d.scale).toBe(MAX_SCALE)
  })

  it('scale is never negative', () => {
    const d = computeExportDimensions(mockEl(1, 1, 1, 1))
    expect(d.scale).toBeGreaterThan(0)
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
  it('rejects null blob', async () => {
    await expect(downloadBlob(null, 'test.png')).rejects.toThrow('Blob is null')
  })
})
