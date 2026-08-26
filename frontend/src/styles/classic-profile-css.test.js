// CSS source contract guard for Classic Profile (docs/current-plan.md D1/D2).
//
// Classic = 仅「从简」视觉精简(结构性不变,D1)。本文件用 [data-ui-profile="classic"]
// namespace 关闭 Showcase 的全屏 AI/装饰性背景、readability veil、装饰性 hero surface。
// 契约(对应计划 §43 A/B/D):
//   A) 每条规则都必须带 [data-ui-profile="classic"] 前缀,严禁无 namespace 的全局规则泄漏进 Showcase;
//   B) 不得用 display:none 隐藏任何业务元素(HoF Admin tabs / Replay actions / AI Review / League Rating 等);
//   D) 必须在 main.js 中于所有 showcase*.css 之后导入。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const classic = read('./classic-profile.css')
const mainJs = read('../main.js')

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// 提取第一条 selector 片段包含 fragment 的规则体,把 selector 与其声明绑定。
function ruleBody(css, selectorFragment) {
  const start = css.indexOf(selectorFragment)
  expect(start, 'selector ' + selectorFragment + ' must exist').toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

// 收集 main.js 中按顺序导入的所有 css。
const stylesheetImports = [...mainJs.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1])

describe('Classic Profile CSS contract', () => {
  it('每条规则都必须带 [data-ui-profile="classic"] namespace(§43A,严禁污染 Showcase)', () => {
    const css = stripComments(classic)
    const rules = css.split(/}/).filter((chunk) => chunk.includes('{'))
    expect(rules.length).toBeGreaterThan(0)
    for (const chunk of rules) {
      const selector = chunk.slice(0, chunk.indexOf('{'))
      expect(selector, 'rule missing namespace: ' + selector.trim().slice(0, 80)).toMatch(/data-ui-profile=/)
    }
  })

  it('不得用 display:none 隐藏业务元素(§43B)', () => {
    const css = stripComments(classic)
    expect(css).not.toMatch(/display:\s*none/)
  })

  it('必须关闭全屏 AI 背景(backdrop ::after/::before 用 content:none 移除)', () => {
    const css = stripComments(classic)
    const rule = css.split(/}/).find((chunk) => /::after|::before/.test(chunk) && chunk.includes('content: none'))
    expect(rule, 'should contain a backdrop-pseudo rule that removes the AI backdrop').toBeTruthy()
    expect(rule).toMatch(/data-ui-profile/)
    expect(rule).toMatch(/layout-data-workspace/)
  })

  it('Classic 去掉首页四张 AI 装饰卡片图并清除装饰渐变(Home)', () => {
    const css = stripComments(classic)
    // 去图:.feature-visual img 用 visibility:hidden(保留盒子 -> 不改卡片结构/尺寸/间距)
    expect(ruleBody(css, '.feature-visual img')).toContain('visibility: hidden')
    // 清除 .feature-visual::after 装饰渐变
    expect(ruleBody(css, '.feature-visual::after')).toContain('content: none')
    // 清除 .showcase-hero::before 装饰渐变
    expect(ruleBody(css, '.showcase-hero::before')).toContain('content: none')
  })

  it('在 main.js 中必须最后导入(§43D / §33 顺序契约)', () => {
    expect(stylesheetImports[stylesheetImports.length - 1]).toMatch(/classic-profile\.css$/)
    const classicIdx = stylesheetImports.findIndex((p) => p.endsWith('classic-profile.css'))
    expect(classicIdx).toBe(stylesheetImports.length - 1)
    const lastShowcase = stylesheetImports.map((p) => p.endsWith('showcase-regressions.css')).indexOf(true)
    expect(classicIdx).toBeGreaterThan(lastShowcase)
  })
})

describe('Classic Profile — 真浅色主题契约（Theme 计划：Classic=Light, Showcase=Dark）', () => {
  const css = stripComments(classic)
  const tokenBlock = (css.match(/html\[data-ui-profile="classic"\]\s*\{[\s\S]*?\}/) || [])[0] || ''

  it('完整浅色语义 token:color-scheme light + 浅色背景/卡片/深色文字/浅边框/橙金强调', () => {
    expect(tokenBlock).toContain('color-scheme: light')
    expect(tokenBlock).toContain('--bg: #f4f5f2')
    expect(tokenBlock).toContain('--bg-card: #ffffff')
    expect(tokenBlock).toContain('--text: #2a2f28')
    expect(tokenBlock).toContain('--text-heading: #11140f')
    expect(tokenBlock).toContain('--border: #d9dde3')
    expect(tokenBlock).toContain('--accent: #c9762e')
    // 阵营战术色保持 hue(不反色、不变蓝),提高对比
    expect(tokenBlock).toContain('--friendly: #a9661a')
    expect(tokenBlock).toContain('--enemy: #2e7ea8')
  })

  it('同步 --showcase-tactical* 浅色 token(Reconstruction/地图外围面板)', () => {
    expect(css).toContain('--showcase-tactical: linear-gradient(160deg, #fbfbf9')
    expect(css).toContain('--showcase-tactical-heading: #1c2018')
    expect(css).toContain('--showcase-tactical-soft-2: rgba(255, 255, 255, .85)')
  })

  it('禁止 filter:invert / 全局 html * 覆盖(性能与脏覆盖)', () => {
    expect(css).not.toMatch(/filter:\s*invert/)
    expect(css).not.toMatch(/^\s*html\s+\*/m)
    expect(css).not.toMatch(/\b\*\s*\{/)
  })

  it('覆盖核心页面面:topbar/user-menu/tabs/table/form/modal 均带 namespace 且不隐藏业务', () => {
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.topbar\s*\{/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.user-menu-panel\s*\{/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.modal\s*\{/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.layout-data-workspace\s+:is\(input, select, textarea\)/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.layout-data-workspace\s+table\s+thead\s+th/)
    // 不隐藏业务组件(白底白字/低对比风险用 token 覆盖,而非 display:none)
    expect(css).not.toMatch(/display:\s*none/)
  })
})
