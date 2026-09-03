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
    expect(body).toContain('grid-template-columns: 64px 1fr')
    expect(body).not.toContain('grid-template-rows')
  })

  it('pb-main is the map-workspace column (grid col 2) and pb-map-stage fills it', () => {
    const main = ruleBody('.battle-playback:fullscreen .pb-main')
    expect(main).toContain('grid-column: 2')
    expect(main).toContain('position: relative')
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('position: absolute')
    expect(stage).toContain('inset: 0')
    expect(stage).toContain('overflow: hidden')
  })

  it('Left Rail is fullscreen-only left column; Right Details docks right', () => {
    expect(ruleBody('.battle-playback .pb-left-rail')).toContain('display: none')
    const rail = ruleBody('.battle-playback:fullscreen .pb-left-rail')
    expect(rail).toContain('grid-column: 1')
    expect(rail).toContain('display: flex')
    expect(ruleBody('.battle-playback:fullscreen .pb-rail-btn')).toContain('cursor: pointer')
    // fullscreen 下隐藏旧右上角 tab launcher（Left Rail 是唯一入口）
    expect(ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell .pb-panel-launcher')).toContain('display: none')
    const panel = ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell .pb-side-panel')
    expect(panel).toContain('position: absolute')
    expect(panel).toContain('right: 0')
  })

  it('HUD is a top overlay covering only the Map Workspace (after the 64px rail)', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-hud')
    expect(body).toContain('position: absolute')
    expect(body).toContain('top: 0')
    expect(body).toContain('left: 64px')
    expect(body).toContain('right: 0')
    expect(body).toContain('z-index: 50')
  })

  it('controls + timeline are a bottom overlay over the Map Workspace (after 64px rail)', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-mobile-overlay')
    expect(body).toContain('position: absolute')
    expect(body).toContain('bottom: 0')
    expect(body).toContain('left: 64px')
    expect(body).toContain('right: 0')
    expect(body).toContain('z-index: 40')
    expect(body).toContain('pointer-events: auto')
  })

  it('map keeps its canonical aspect — cover-fill, no non-uniform X/Y stretch', () => {
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('width: 100%')
    expect(map).toContain('max-width: none')
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
