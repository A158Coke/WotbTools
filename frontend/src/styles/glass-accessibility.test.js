
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./app-shell.css', import.meta.url)), 'utf8')

const mediaBlock = (feature, value) => {
  const match = css.match(new RegExp(`@media \\(${feature}: ${value}\\) \\{([\\s\\S]*?)\\n\\}`))
  expect(match, `app-shell.css @media (${feature}: ${value}) block`).not.toBeNull()
  return match[1]
}

describe('app-shell.css 玻璃表面可访问性降级（F-05）', () => {
  it('reduce 块把每个玻璃档位映射到对应的不透明语义表面 token', () => {
    const reduce = mediaBlock('prefers-reduced-transparency', 'reduce')
    for (const tier of [1, 2, 3]) {
      expect(reduce).toContain(`.surface-glass-${tier} { background: var(--color-surface-${tier}); }`)
    }
  })

  it('contrast 块给玻璃面 --color-border-strong 边界', () => {
    const contrast = mediaBlock('prefers-contrast', 'more')
    expect(contrast).toContain('border-color: var(--color-border-strong)')
  })
})
