// Source-level regression: Battle Playback fullscreen must turn the whole
// 100vw×100vh into a 3-column stage — Left Rail | Map Workspace | Persistent
// Right Details — with HUD as a top overlay and controls/timeline as a bottom
// overlay confined to the Map Workspace (right edge stops at the Details column).
// NOT a 3-row grid that compresses the map, and NOT Details as an overlay
// covering the map. Vitest does not execute global CSS layout, so the layout
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

describe('Battle Playback fullscreen layout (source regression)', () => {
  it('fullscreen root is the whole viewport, no page frame, no 3-row grid', () => {
    const body = ruleBody('.battle-playback:fullscreen')
    expect(body).not.toBeNull()
    expect(body).toContain('width: 100vw')
    expect(body).toContain('height: 100vh')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('padding: 0')
    expect(body).toContain('grid-template-columns: var(--pb-left-col) minmax(0, 1fr)')
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

  it('Left Rail is fullscreen-only left column; Right Details is a persistent column (not an overlay)', () => {
    expect(ruleBody('.battle-playback .pb-left-rail')).toContain('display: none')
    const rail = ruleBody('.battle-playback:fullscreen .pb-left-rail')
    expect(rail).toContain('grid-column: 1')
    expect(rail).toContain('display: flex')
    expect(ruleBody('.battle-playback .pb-rail-btn')).toContain('cursor: pointer')
    // fullscreen 下隐藏旧右上角 tab launcher（Left Rail 是唯一入口）
    expect(ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell .pb-panel-launcher')).toContain('display: none')
    // §3 真三列：Right Details 是 map-stage grid 的 persistent col2 列（非绝对 overlay 覆盖地图）
    const shell = ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell')
    expect(shell).toContain('position: static')
    expect(shell).toContain('grid-column: 2')
    const panel = ruleBody('.battle-playback:fullscreen .pb-map-stage > .pb-side-panel-shell .pb-side-panel')
    expect(panel).toContain('position: static')
    expect(panel).toContain('flex: 1 1 auto')
  })

  it('HUD is a top overlay covering only the Map Workspace (stops at the Details column)', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-hud')
    expect(body).toContain('position: absolute')
    expect(body).toContain('top: 0')
    expect(body).toContain('left: var(--pb-left-col)')
    expect(body).toContain('right: var(--pb-details-w)')
    expect(body).toContain('z-index: 50')
  })

  it('controls + timeline are a bottom overlay over the Map Workspace (stops at the Details column)', () => {
    const body = ruleBody('.battle-playback:fullscreen .pb-mobile-overlay')
    expect(body).toContain('position: absolute')
    expect(body).toContain('bottom: 0')
    expect(body).toContain('left: var(--pb-left-col)')
    expect(body).toContain('right: var(--pb-details-w)')
    expect(body).toContain('z-index: 40')
    expect(body).toContain('pointer-events: auto')
  })

  it('map workspace is a true 2-column grid (Map | Persistent Details)', () => {
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('display: grid')
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr) var(--pb-details-w)')
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('grid-column: 1')
  })

  it('annotation surface and orientation hint stay over the Map Workspace (stop at the Details column)', () => {
    expect(ruleBody('.battle-playback:fullscreen .pb-annotation-surface')).toContain('right: calc(var(--pb-details-w, min(340px, 32vw)) + 8px)')
    expect(ruleBody('.battle-playback:fullscreen .pb-orientation-hint')).toContain('right: calc(var(--pb-details-w, min(340px, 32vw)) + 12px)')
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

  it('cover-fill sizing: the map fills the workspace width and never force-contains to a viewport ratio', () => {
    // §3 cover-fill：地图填满 Map Workspace 宽度（width:100%），高度按 canonical aspect 推导，
    // 允许高于视口（裁切可被 pan/viewport 到达），绝不横向拉伸成 viewport 比例。这也是对
    // 「旧 contain 假几何回归」的替换——真实几何由 battlePlayback.test.js 的 clampViewPan /
    // mapRenderRect 宽视口回归覆盖。
    const map = ruleBody('.battle-playback:fullscreen .pb-main .pb-map')
    expect(map).toContain('width: 100%')
    expect(map).toContain('max-width: none')
    expect(map).not.toContain('aspect-ratio')
    // the stage clips (overflow hidden) so cover can legally extend beyond the viewport.
    expect(ruleBody('.battle-playback:fullscreen .pb-map-stage')).toContain('overflow: hidden')
  })

  it('Fix2 widths: Left Rail 列是独立的小 collapsed rail（~60px），不再复用 --pb-details-w；Right Details 单独 ~340px', () => {
    const base = ruleBody('.battle-playback')
    expect(base).toContain('--pb-rail-w: 60px')
    expect(base).toContain('--pb-panel-w: 300px')
    // fullscreen grid col1 用 --pb-left-col（collapsed rail 60px / 展开 panel 300px），而非 --pb-details-w
    const fs = ruleBody('.battle-playback:fullscreen')
    expect(fs).toContain('grid-template-columns: var(--pb-left-col) minmax(0, 1fr)')
    expect(fs).not.toContain('grid-template-columns: var(--pb-details-w)')
    // Right Details 是 map-stage 的独立 col2（--pb-details-w）
    const stage = ruleBody('.battle-playback:fullscreen .pb-map-stage')
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr) var(--pb-details-w)')
  })

  it('mobile fullscreen contract: 手机 fullscreen+landscape 保持单列、无 rail、details 为 sheet、controls 为 bottom overlay', () => {
    const fsM = ruleBody('.battle-playback:fullscreen.pb-device-mobile')
    expect(fsM).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(ruleBody('.battle-playback:fullscreen.pb-device-mobile .pb-left-rail')).toContain('display: none')
    expect(ruleBody('.battle-playback:fullscreen.pb-device-mobile .pb-main')).toContain('grid-column: 1')
    expect(ruleBody('.battle-playback:fullscreen.pb-device-mobile .pb-hud')).toContain('left: 0; right: 0')
    expect(ruleBody('.battle-playback:fullscreen.pb-device-mobile .pb-map-stage')).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(ruleBody('.battle-playback:fullscreen.pb-device-mobile .pb-map-stage > .pb-side-panel-shell')).toContain('position: absolute')
    expect(ruleBody('.battle-playback:fullscreen.pb-device-mobile .pb-mobile-overlay')).toContain('left: 0; right: 0')
  })
})
