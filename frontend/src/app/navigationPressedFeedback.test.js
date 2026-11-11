import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// F-03 导航按压反馈契约（DC-CMP-01 active 状态）：主导航的三个入口必须有 :active 按压反馈，
// 且按压色必须压过悬停色（规则在悬停之后、特异性对齐）、当前页高亮在按压时不得丢失、
// focus-visible 不得被覆盖。
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
    const pressedBlock = sidebar.indexOf('/* 按压反馈（DC-CMP-01 active 状态）')
    expect(hoverBlock).toBeGreaterThan(-1)
    expect(pressedBlock).toBeGreaterThan(hoverBlock)
  })

  it('pressed state uses surface tokens and adds no layout-affecting properties', () => {
    const activeBlock = sidebar.slice(sidebar.indexOf('.sidebar-link:not(.is-active):active'), sidebar.length)
    expect(activeBlock).not.toMatch(/\bmargin\b|\bpadding\b|\btransform\b|\bwidth\b/)
    // focus-visible 规则仍然存在（按压反馈不覆盖焦点可见性）
    expect(sidebar).toMatch(/\.sidebar-link:focus-visible[\s\S]*?\{/)
    expect(topBar).toMatch(/\.menu-button:focus-visible[\s\S]*?\{/)
  })
})
