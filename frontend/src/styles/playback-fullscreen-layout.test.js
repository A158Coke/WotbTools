// Source-level regression: Battle Playback fullscreen must turn the whole
// 100vw×100vh into a playback stage (map = primary surface), with HUD as a top
// overlay and controls/timeline as a bottom overlay — NOT a 3-row grid that
// compresses the map. Vitest does not execute global CSS layout, so the layout
// contract is asserted against the stylesheet source (same pattern as
// classic-theme-source-regression.test.js / classic-profile-css.test.js).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const css = read('./playback-responsive.css')
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

const rules = stripped.split(/}/).filter((chunk) => chunk.includes('{'))
function ruleBody(selector) {
  const chunk = rules.find((c) => {
    const sel = c.slice(0, c.indexOf('{')).trim()
    return sel === selector
  })
  return chunk ? chunk.slice(chunk.indexOf('{') + 1).trim() : null
}

const VIEWPORTS = [
  { name: '1920x1080', w: 1920, h: 1080 },
  { name: '1366x768', w: 1366, h: 768 },
  { name: 'tablet landscape (1024x768)', w: 1024, h: 768 },
  { name: 'mobile landscape (844x390)', w: 844, h: 390 },
]

describe('Battle Playback fullscreen layout (source regression)', () => {
  it('fullscreen root is the whole viewport, no page frame, no 3-row grid', () => {
    const body = ruleBody('.battle-playback:fullscreen')
    expect(body).not.toBeNull()
    expect(body).toContain('width: 100vw')
    expect(body).toContain('height: 100vh')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('padding: 0')
    expect(body).not.toContain('grid-template-rows')
  })

  it('pb-main and pb-map-stage fill the viewport as the primary surface', () => {
    expect(ruleBody('.battle-playback:fullscreen .pb-main')).toContain('position: absolute')
    expect(ruleBody('.battle-playback:fullscreen .pb-main')).toContain('inset: 0')
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('position: absolute')
    expect(stage).toContain('inset: 0')
    expect(stage).toContain('overflow: hidden')
  })

  it('HUD is a top overlay that does not consume map layout height', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-hud')
    expect(body).toContain('position: absolute')
    expect(body).toContain('top: 0')
    expect(body).toContain('left: 0')
    expect(body).toContain('right: 0')
    expect(body).toContain('z-index: 50')
  })

  it('controls + timeline are a bottom overlay that never leaves the first screen', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-mobile-overlay')
    expect(body).toContain('position: absolute')
    expect(body).toContain('bottom: 0')
    expect(body).toContain('left: 0')
    expect(body).toContain('right: 0')
    expect(body).toContain('z-index: 40')
    expect(body).toContain('pointer-events: auto')
  })

  it('map keeps its canonical aspect — no non-uniform X/Y stretch', () => {
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('min(100%, calc(100vh * var(--pb-map-ratio, 1)))')
    expect(map).toContain('max-height: 100%')
    // SVG stays aspect-preserving (height:auto) so the raster geometry is never
    // distorted by a non-aspect container box.
    expect(ruleBody('.battle-playback:fullscreen .pb-main .pb-map .pb-svg')).toContain('height: auto')
  })

  it('exits fullscreen back to the normal page layout (no fullscreen-only absolute on the base)', () => {
    const base = ruleBody('.battle-playback')
    expect(base).toContain('display: flex')
    expect(base).toContain('flex-direction: column')
    expect(base).not.toContain('width: 100vw')
    expect(base).not.toContain('position: absolute')
  })

  it.each(VIEWPORTS)('at $name the contained map stays inside the viewport and aspect-correct', ({ w, h }) => {
    // Mirror the fullscreen contain sizing: width = min(vw, vh * ratio), height = width / ratio.
    // The map geometry must never be stretched to fill a non-matching viewport ratio.
    const ratio = 766 / 769 // holland map fixture (near-square canonical aspect)
    const width = Math.min(w, h * ratio)
    const height = width / ratio
    // Float tolerance: the min(100%, calc(100vh * ratio)) / aspect math can land
    // a hair (≤1e-6) outside the viewport dimension without any real overflow.
    expect(width).toBeLessThanOrEqual(w + 1e-6)
    expect(height).toBeLessThanOrEqual(h + 1e-6)
    // aspect preserved → no non-uniform X/Y stretch despite a mismatched viewport ratio
    expect(width / height).toBeCloseTo(ratio, 5)
  })
})
