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

  it('在 main.js 中必须最后导入(§43D / §33 顺序契约)', () => {
    expect(stylesheetImports[stylesheetImports.length - 1]).toMatch(/classic-profile\.css$/)
    const classicIdx = stylesheetImports.findIndex((p) => p.endsWith('classic-profile.css'))
    expect(classicIdx).toBe(stylesheetImports.length - 1)
    const lastShowcase = stylesheetImports.map((p) => p.endsWith('showcase-regressions.css')).indexOf(true)
    expect(classicIdx).toBeGreaterThan(lastShowcase)
  })
})
