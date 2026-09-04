import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('./playback-pc.css', import.meta.url)), 'utf8')

function ruleBody(selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const chunk of stripped.split('}')) {
    if (!chunk.includes('{')) continue
    const head = chunk.slice(0, chunk.lastIndexOf('{'))
    const own = head.slice(head.lastIndexOf('{') + 1)
    const selectors = own.split(',').map((part) => part.trim())
    if (selectors.includes(selector)) return chunk.slice(chunk.lastIndexOf('{') + 1).trim()
  }
  return null
}

describe('Battle Playback PC fullscreen HUD regression', () => {
  it('keeps HP and points as the horizontal map HUD when side slots are active', () => {
    const hud = ruleBody('.battle-playback.pb-form-pc:fullscreen.pb-side-slots .pb-hud')
    expect(hud).not.toBeNull()
    expect(hud).toContain('left: var(--pb-left-col)')
    expect(hud).toContain('right: var(--pb-details-w)')
    expect(hud).toContain('top: 0')
    expect(hud).toContain('bottom: auto')
    expect(hud).toContain('width: auto')
    expect(hud).not.toContain('right: 0')
    expect(hud).not.toContain('left: auto')

    const grid = ruleBody('.battle-playback.pb-form-pc:fullscreen.pb-side-slots .pb-hud-grid')
    expect(grid).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)')

    expect(ruleBody('.battle-playback.pb-form-pc:fullscreen.pb-side-slots .pb-hud-column-friendly'))
      .toContain('grid-column: 1')
    expect(ruleBody('.battle-playback.pb-form-pc:fullscreen.pb-side-slots .pb-hud-column-center'))
      .toContain('grid-column: 2')
    expect(ruleBody('.battle-playback.pb-form-pc:fullscreen.pb-side-slots .pb-hud-column-enemy'))
      .toContain('grid-column: 3')
  })
})
