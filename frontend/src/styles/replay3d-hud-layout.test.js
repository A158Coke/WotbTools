import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Intrinsic touch controls keep their targets when space is constrained.
describe('SegmentedControl 选项不得被 flex 压缩', () => {
  const source = readFileSync(fileURLToPath(new URL('../components/SegmentedControl.vue', import.meta.url)), 'utf8')
  const css = source.slice(source.indexOf('<style'), source.indexOf('</style>'))
  const bodyOf = (selector) => {
    const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
    if (!m) throw new Error(`rule not found: ${selector}`)
    return m[1].replace(/\s+/g, ' ').trim()
  }

  it('选项 flex: none（不收缩），容器横向滚动', () => {
    expect(bodyOf('.segmented-option')).toContain('flex: none')
    expect(bodyOf('.segmented-option')).not.toContain('flex: 1 1 0')
    expect(bodyOf('.segmented.is-scrollable')).toContain('overflow-x: auto')
  })

  it('coarse 档把选项点击区域抬到 --hit-min（token，不写死像素）', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toContain('min-height: var(--hit-min)')
    expect(coarse).toContain('min-width: var(--hit-min)')
  })
})
