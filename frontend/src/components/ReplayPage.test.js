import { describe, it, expect } from 'vitest'
import {
  getExportTarget,
  computeExportDimensions,
  exportPngFilename,
  sanitizeFilename,
  downloadBlob
} from '../utils/exportReplayPng.js'

// ======== Utility tests from exportReplayPng ========

describe('getExportTarget', () => {
  it('returns aggregateRef for aggregate tab', () => {
    const agg = {}
    const battles = []
    expect(getExportTarget('aggregate', agg, battles)).toBe(agg)
  })

  it('returns battle ref for battle tab', () => {
    const b0 = { tagName: 'DIV' }
    const b1 = { tagName: 'DIV' }
    expect(getExportTarget('b1', null, [b0, b1])).toBe(b1)
  })

  it('returns null for out-of-range battle index', () => {
    expect(getExportTarget('b99', null, [])).toBeNull()
  })

  it('returns null for missing aggregate ref', () => {
    expect(getExportTarget('aggregate', null, [])).toBeNull()
  })
})

describe('computeExportDimensions', () => {
  function el(sw, sh, cw, ch) {
    return { scrollWidth: sw, scrollHeight: sh, clientWidth: cw, clientHeight: ch }
  }

  it('uses scroll dimensions', () => {
    const d = computeExportDimensions(el(2000, 500, 800, 400))
    expect(d.width).toBe(2000)
    expect(d.height).toBe(500)
  })

  it('caps scale to avoid exceeding MAX_CANVAS_DIMENSION', () => {
    const d = computeExportDimensions(el(30000, 500, 30000, 500))
    expect(d.width * d.scale).toBeLessThanOrEqual(16384)
  })

  it('returns fallback for zero dimensions', () => {
    const d = computeExportDimensions(el(0, 0, 0, 0))
    expect(d.width).toBe(800)
    expect(d.height).toBe(600)
    expect(d.scale).toBe(1)
  })
})

describe('exportPngFilename', () => {
  it('matches expected pattern', () => {
    expect(exportPngFilename('aggregate', 0)).toMatch(/^wotb-replay-\d{8}-\d{6}-aggregate\.png$/)
    expect(exportPngFilename('b0', 0, 'Lagoon')).toMatch(/^wotb-replay-\d{8}-\d{6}-Lagoon\.png$/)
    expect(exportPngFilename('b2', 2)).toMatch(/^wotb-replay-\d{8}-\d{6}-battle-3\.png$/)
  })
})

describe('sanitizeFilename', () => {
  it('removes invalid chars', () => { expect(sanitizeFilename('a/b:c')).toBe('a_b_c') })
  it('collapses spaces', () => { expect(sanitizeFilename('a  b')).toBe('a_b') })
  it('returns default for empty input', () => { expect(sanitizeFilename('')).toBe('export') })
})

describe('downloadBlob', () => {
  it('rejects null blob', async () => {
    await expect(downloadBlob(null, 'test.png')).rejects.toThrow('Blob is null')
  })
})
