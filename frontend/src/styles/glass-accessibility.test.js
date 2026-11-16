// F-05 玻璃表面可访问性守护（源码 token 映射半句）。computed 层——包括每个玻璃档位
// 在 reduce 下退化为对应 --color-surface-N、contrast 下 --color-border-strong 边界、
// backdrop-filter 归零、块序层叠结果——由 scripts/browser-home-reduced-motion.mjs 的
// home-glass-accessibility 场景在真实浏览器里逐档验证；这里只锁定 stylelint 与浏览器
// 门禁都无法表达的「降级块必须存在语义 token 映射」这一源码契约。

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
