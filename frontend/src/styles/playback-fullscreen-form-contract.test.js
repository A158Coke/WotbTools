import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('./playback-fullscreen-form-contract.css', import.meta.url)), 'utf8')
const main = readFileSync(fileURLToPath(new URL('../main.js', import.meta.url)), 'utf8')
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBody(selector) {
  for (const chunk of stripped.split('}')) {
    if (!chunk.includes('{')) continue
    const head = chunk.slice(0, chunk.lastIndexOf('{'))
    const own = head.slice(head.lastIndexOf('{') + 1)
    const selectors = own.split(',').map((part) => part.trim())
    if (selectors.includes(selector)) return chunk.slice(chunk.lastIndexOf('{') + 1).trim()
  }
  return null
}

describe('Battle Playback fullscreen form ownership', () => {
  it('keeps tablet HP / points / bases in the horizontal map HUD', () => {
    const hud = ruleBody('.battle-playback.pb-form-tablet:fullscreen.pb-side-slots .pb-hud')
    expect(hud).not.toBeNull()
    expect(hud).toContain('left: var(--pb-left-col)')
    expect(hud).toContain('right: var(--pb-details-w)')
    expect(hud).toContain('bottom: auto')
    expect(hud).toContain('width: auto')

    const grid = ruleBody('.battle-playback.pb-form-tablet:fullscreen.pb-side-slots .pb-hud-grid')
    expect(grid).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)')
  })

  it('keeps mobile HP / points / bases in the horizontal top HUD', () => {
    const hud = ruleBody('.battle-playback.pb-form-mobile:fullscreen.pb-side-slots .pb-hud')
    expect(hud).not.toBeNull()
    expect(hud).toContain('left: var(--pb-left-col)')
    expect(hud).toContain('right: 0')
    expect(hud).toContain('bottom: auto')
    expect(hud).toContain('width: auto')

    const grid = ruleBody('.battle-playback.pb-form-mobile:fullscreen.pb-side-slots .pb-hud-grid')
    expect(grid).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)')
  })

  it('does not let side slots turn the mobile transient controller into a side rail', () => {
    const overlay = ruleBody('.battle-playback.pb-form-mobile:fullscreen.pb-side-slots .pb-mobile-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay).toContain('left: 0')
    expect(overlay).toContain('right: 0')
    expect(overlay).toContain('width: auto')
    expect(overlay).toContain('display: block')
    expect(overlay).toContain('padding: 0')
    expect(overlay).not.toContain('width: var(--pb-slot-w)')

    const controls = ruleBody('.battle-playback.pb-form-mobile:fullscreen.pb-side-slots .pb-controls')
    expect(controls).toContain('flex-direction: row')
    expect(controls).toContain('flex-wrap: wrap')

    const speed = ruleBody('.battle-playback.pb-form-mobile:fullscreen.pb-side-slots .pb-controls .pb-speed')
    expect(speed).toContain('display: inline-flex')
  })

  it('loads the ownership guard after mobile fullscreen geometry', () => {
    const mobileFullscreen = "import './styles/playback-mobile-fullscreen.css'"
    const ownership = "import './styles/playback-fullscreen-form-contract.css'"
    expect(main).toContain(mobileFullscreen)
    expect(main).toContain(ownership)
    expect(main.indexOf(ownership)).toBeGreaterThan(main.indexOf(mobileFullscreen))
  })
})
