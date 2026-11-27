import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const topBar = read('./AppTopBar.vue')
const sidebar = read('./AppSidebar.vue')

describe('navigation pressed feedback', () => {
  it('menu button has an :active pressed state', () => {
    expect(topBar).toContain('.menu-button:active { background: var(--color-surface-3); }')
  })

  it('sidebar close button has an :active pressed state', () => {
    expect(sidebar).toContain('.sidebar-close:active { background: var(--color-surface-3); color: var(--color-text-primary); }')
  })

  it('sidebar links have an :active pressed state and keep the active highlight while pressed', () => {
    expect(sidebar).toContain('.sidebar-link:not(.is-active):active { background: var(--color-surface-3); color: var(--color-text-primary); }')
    expect(sidebar).toContain(
      '.sidebar-link.is-active:active { background: color-mix(in oklab, var(--color-accent) 20%, var(--color-surface-1)); }',
    )
  })

  it('pressed rules come after the hover rules so pressing overrides hover color', () => {
    const hoverBlock = sidebar.indexOf('@media (hover: hover)')
    const pressedBlock = sidebar.indexOf('.sidebar-link:not(.is-active):active {')
    expect(hoverBlock).toBeGreaterThan(-1)
    expect(pressedBlock).toBeGreaterThan(hoverBlock)
  })

  it('pressed state uses surface tokens and adds no layout-affecting properties', () => {
    const activeBlock = sidebar.slice(sidebar.indexOf('.sidebar-link:not(.is-active):active'), sidebar.length)
    expect(activeBlock).not.toMatch(/\bmargin\b|\bpadding\b|\btransform\b|\bwidth\b/)
    expect(sidebar).toMatch(/\.sidebar-link:focus-visible[\s\S]*?\{/)
    expect(topBar).toMatch(/\.menu-button:focus-visible[\s\S]*?\{/)
  })
})
