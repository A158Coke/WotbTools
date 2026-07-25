import { describe, it, expect } from 'vitest'
import {
  computeExportDimensions,
  exportPngFilename,
  sanitizeFilename,
  MAX_CANVAS_DIMENSION,
  MAX_SCALE
} from './exportReplayPng.js'

describe('computeExportDimensions', () => {
  function mockEl(scrollW, scrollH, clientW, clientH) {
    return { scrollWidth: scrollW, scrollHeight: scrollH, clientWidth: clientW, clientHeight: clientH }
  }

  it('uses scrollWidth when larger than clientWidth', () => {
    const el = mockEl(2000, 500, 800, 400)
    const d = computeExportDimensions(el)
    expect(d.width).toBe(2000)
    expect(d.scale).toBeGreaterThan(0)
  })

  it('does not let scale exceed MAX_SCALE', () => {
    const el = mockEl(500, 300, 500, 300)
    const d = computeExportDimensions(el)
    expect(d.scale).toBeLessThanOrEqual(MAX_SCALE)
  })

  it('reduces scale for very wide content to stay within MAX_CANVAS_DIMENSION', () => {
    const el = mockEl(MAX_CANVAS_DIMENSION * 2, 500, MAX_CANVAS_DIMENSION * 2, 500)
    const d = computeExportDimensions(el)
    expect(d.width * d.scale).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  })

  it('returns fallback dimensions for zero-size element', () => {
    const el = mockEl(0, 0, 0, 0)
    const d = computeExportDimensions(el)
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
    const el = mockEl(1800, 400, 375, 400)
    const d = computeExportDimensions(el)
    expect(d.width).toBe(1800)
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

  it('collapses multiple underscores', () => {
    expect(sanitizeFilename('a   b')).toBe('a_b')
  })

  it('returns default for empty result', () => {
    expect(sanitizeFilename('')).toBe('export')
  })
})
