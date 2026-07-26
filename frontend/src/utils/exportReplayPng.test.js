// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  getExportTarget,
  computeExportDimensions,
  maxFiniteDimension,
  exportPngFilename,
  sanitizeFilename,
  downloadBlob,
  MAX_CANVAS_DIMENSION,
  MAX_SCALE
} from './exportReplayPng.js'

describe('maxFiniteDimension', () => {
  it('returns largest positive finite number', () => {
    expect(maxFiniteDimension(100, 200, 300)).toBe(300)
  })

  it('ignores NaN', () => {
    expect(maxFiniteDimension(NaN, 100)).toBe(100)
  })

  it('ignores Infinity', () => {
    expect(maxFiniteDimension(Infinity, 100)).toBe(100)
  })

  it('ignores negative numbers', () => {
    expect(maxFiniteDimension(-10, 100)).toBe(100)
  })

  it('ignores zero', () => {
    expect(maxFiniteDimension(0, 100, 200)).toBe(200)
  })

  it('returns 0 when all invalid', () => {
    expect(maxFiniteDimension(NaN, Infinity, -1, 0)).toBe(0)
  })
})

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
  function assertFiniteWithin(d, label) {
    expect(Number.isFinite(d.width), `${label} width`).toBe(true)
    expect(Number.isFinite(d.height), `${label} height`).toBe(true)
    expect(Number.isFinite(d.scale), `${label} scale finite`).toBe(true)
    expect(d.scale, `${label} scale > 0`).toBeGreaterThan(0)
    expect(d.width * d.scale, `${label} width*scale`).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(d.height * d.scale, `${label} height*scale`).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  }

  it('1920 x 1080', () => {
    const d = computeExportDimensions({ width: 1920, height: 1080 })
    expect(d.width).toBe(1920)
    expect(d.height).toBe(1080)
    expect(d.scale).toBeGreaterThan(1.9)
    assertFiniteWithin(d, '1920x1080')
  })

  it('2232 x 632', () => {
    const d = computeExportDimensions({ width: 2232, height: 632 })
    expect(d.width).toBe(2232)
    expect(d.height).toBe(632)
    expect(d.scale).toBeGreaterThan(0)
    assertFiniteWithin(d, '2232x632')
  })

  it('40000 x 1000', () => {
    const d = computeExportDimensions({ width: 40000, height: 1000 })
    expect(d.width).toBe(40000)
    expect(d.height).toBe(1000)
    assertFiniteWithin(d, '40kx1k')
  })

  it('1000 x 40000', () => {
    const d = computeExportDimensions({ width: 1000, height: 40000 })
    expect(d.width).toBe(1000)
    expect(d.height).toBe(40000)
    assertFiniteWithin(d, '1kx40k')
  })

  it('40000 x 40000', () => {
    const d = computeExportDimensions({ width: 40000, height: 40000 })
    assertFiniteWithin(d, '40kx40k')
  })

  it('2000000 x 2000000', () => {
    const d = computeExportDimensions({ width: 2000000, height: 2000000 })
    assertFiniteWithin(d, '2Mx2M')
  })

  it('1e15 x 1e15', () => {
    const d = computeExportDimensions({ width: 1e15, height: 1e15 })
    expect(d.scale).toBeGreaterThan(0)
    assertFiniteWithin(d, '1e15')
  })

  it('preserves width/height for valid input', () => {
    const d = computeExportDimensions({ width: 500, height: 300 })
    expect(d.width).toBe(500)
    expect(d.height).toBe(300)
  })

  it('does not exceed MAX_SCALE', () => {
    const d = computeExportDimensions({ width: 500, height: 300 })
    expect(d.scale).toBeLessThanOrEqual(MAX_SCALE)
  })

  it('returns fallback for width = 0', () => {
    const d = computeExportDimensions({ width: 0, height: 500 })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for height = 0', () => {
    const d = computeExportDimensions({ width: 500, height: 0 })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for NaN width', () => {
    const d = computeExportDimensions({ width: NaN, height: 500 })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for Infinity height', () => {
    const d = computeExportDimensions({ width: 500, height: Infinity })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for negative width', () => {
    const d = computeExportDimensions({ width: -100, height: 500 })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for missing width', () => {
    const d = computeExportDimensions({ height: 500 })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for missing height', () => {
    const d = computeExportDimensions({ width: 500 })
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })

  it('returns fallback for null input', () => {
    const d = computeExportDimensions(null)
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
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
    const anchor = appendChild.mock.calls[0][0]
    expect(anchor).toBeTruthy()
    expect(anchor.nodeName).toBe('A')
    expect(removeChild).toHaveBeenCalledWith(anchor)
    expect(anchor.parentNode).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('rejects and cleans up when a.click() throws', async () => {
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag)
      if (tag === 'a') {
        el.click = () => { throw new Error('click failed') }
      }
      return el
    })

    const appendChild = vi.spyOn(document.body, 'appendChild')

    await expect(downloadBlob(new Blob(['test']), 'out.png')).rejects.toThrow('click failed')

    const anchor = appendChild.mock.calls[0][0]
    expect(anchor.parentNode).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })
})
