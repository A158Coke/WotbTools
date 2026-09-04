import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('./playback-mobile-fullscreen.css', import.meta.url)), 'utf8')
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = stripped.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : null
}

describe('mobile fullscreen playback map-first layout', () => {
  it('keeps the details shell in grid flow instead of overlaying the map', () => {
    const stage = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage')
    expect(stage).toContain('grid-template-columns: minmax(0, 1fr) auto')

    const shell = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell')
    expect(shell).toContain('position: static')
    expect(shell).toContain('grid-column: 2')
    expect(shell).toContain('width: 0')
    expect(shell).not.toContain('position: absolute')
    expect(shell).not.toContain('position: fixed')

    const active = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell.pb-details-active')
    expect(active).toContain('width: min(320px, 38vw)')
    expect(active).toContain('max-width: 40vw')
  })

  it('keeps the actual VehicleDetailsPanel in-flow and scrollable', () => {
    const sidebar = ruleBody('.battle-playback:fullscreen.pb-form-mobile .pb-map-stage > .pb-side-panel-shell.pb-details-active > .pb-sidebar')
    expect(sidebar).toContain('position: static')
    expect(sidebar).toContain('height: 100%')
    expect(sidebar).toContain('overflow-y: auto')
    expect(sidebar).toContain('animation: none')
  })

  it('falls back to an in-flow bottom row if orientation lock is unavailable', () => {
    expect(stripped).toContain('@media (orientation: portrait)')
    const portrait = stripped.slice(stripped.indexOf('@media (orientation: portrait)'))
    expect(portrait).toContain('grid-template-rows: minmax(0, 1fr) auto')
    expect(portrait).toContain('height: min(38dvh, 380px)')
    expect(portrait).toContain('border-top: 1px solid var(--border)')
  })
})
