// F-05 玻璃表面可访问性守护：app-shell.css 的 media 查询降级块必须整体退化为
// 纯色语义表面并关闭 blur（不是只降模糊），contrast 块必须给 --color-border-strong
// 边界且排在 reduce 块之后（两种偏好叠加时更强的边界胜出）。默认玻璃规则保持
// glass token + blur(16px) 不变。computed 层由 scripts/browser-home-reduced-motion.mjs
// 的 home-glass-accessibility 场景在真实浏览器里验证；这里守护源码形状。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./app-shell.css', import.meta.url)), 'utf8')

const mediaBlock = (feature, value) => {
  const match = css.match(new RegExp(`@media \\(${feature}: ${value}\\) \\{([\\s\\S]*?)\\n\\}`))
  expect(match, `app-shell.css @media (${feature}: ${value}) block`).not.toBeNull()
  return match[1]
}

const reduce = mediaBlock('prefers-reduced-transparency', 'reduce')
const contrast = mediaBlock('prefers-contrast', 'more')
const defaultGlass = css.slice(css.indexOf('.surface-glass-1,'), css.indexOf('@supports'))

describe('app-shell.css 玻璃表面可访问性降级（F-05）', () => {
  it('reduce 块关闭两种 backdrop-filter 并映射到 --color-surface-1/2/3', () => {
    for (const tier of [1, 2, 3]) {
      expect(reduce).toContain(`.surface-glass-${tier} { background: var(--color-surface-${tier}); }`)
    }
    expect(reduce).toContain('backdrop-filter: none')
    expect(reduce).toContain('-webkit-backdrop-filter: none')
  })

  it('reduce 块不是只降模糊：backdrop-filter 只允许 none', () => {
    const values = [...reduce.matchAll(/(-webkit-)?backdrop-filter:\s*([^;]+);/g)].map((m) => m[2].trim())
    expect(values.length).toBeGreaterThan(0)
    expect(values.every((value) => value === 'none')).toBe(true)
  })

  it('contrast 块给出 --color-border-strong 边界并同样退化表面', () => {
    for (const tier of [1, 2, 3]) {
      expect(contrast).toContain(`.surface-glass-${tier} { background: var(--color-surface-${tier}); }`)
    }
    expect(contrast).toContain('border-color: var(--color-border-strong)')
    // 组件 scoped border 简写是 (0,2,0) 且晚于 app-shell 注入：必须三重类名抬到 (0,3,0) 才能覆盖。
    expect(contrast).toContain('.surface-glass-1.surface-glass-1.surface-glass-1')
    expect(contrast).toContain('backdrop-filter: none')
  })

  it('contrast 块排在 reduce 块之后：叠加偏好时边界与表面由更强规则给出', () => {
    expect(css.indexOf(contrast)).toBeGreaterThan(css.indexOf(reduce))
  })

  it('降级块只用语义 token，无硬编码色值', () => {
    for (const block of [reduce, contrast]) {
      expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(block).not.toMatch(/\b(?:rgba?|hsla?)\(/)
    }
  })

  it('默认玻璃视觉不变：glass token + blur(16px) saturate(1.2)', () => {
    expect(defaultGlass).toContain('backdrop-filter: blur(16px) saturate(1.2)')
    expect(defaultGlass).toContain('-webkit-backdrop-filter: blur(16px) saturate(1.2)')
    for (const tier of [1, 2, 3]) {
      expect(defaultGlass).toContain(`.surface-glass-${tier} { background: var(--color-surface-${tier}-glass); }`)
    }
  })
})
