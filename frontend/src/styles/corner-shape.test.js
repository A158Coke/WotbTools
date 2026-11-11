// squircle 渐进增强守护：scale.css 在 @supports (corner-shape: squircle) 里给所有元素套 squircle，
// 因此胶囊 / 圆形（--radius-full、50%、9999px）必须在同一条规则里声明 corner-shape: round，否则头像会变成方圆。
// 首屏 index.html 的内联 loader 在 Vue 挂载前就已渲染（构建产物契约），同样要扫描，不能只覆盖 src/。
// 规则见 docs/frontend/design-language.md §5「圆角」。
//
// radius 与 corner-shape 的跨声明配对是 stylelint（无自定义规则插件）表达不了的，
// 所以按 #827 处置合并为一条数据驱动断言：对每处全圆角声明，同一声明块内必须有
// corner-shape: round；再锁定 squircle 只在 @supports 里启用与基准半径不变。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('..', import.meta.url))
const tokensDir = join(srcDir, 'styles', 'tokens')
const indexHtml = join(srcDir, '..', 'index.html')

function sources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, acc)
    else if (/\.(css|vue)$/.test(name) && !path.startsWith(tokensDir)) acc.push(path)
  }
  return acc
}

const FULL_RADIUS = /border-radius:\s*(?:var\(--radius-full\)|50%|9999px);/g
const GUARDED_RADIUS = /border-radius:\s*(?:var\(--radius-full\)|50%|9999px);\s*corner-shape:\s*round;/g

describe('corner-shape 渐进增强', () => {
  it('全圆角声明紧跟 corner-shape: round（含首屏 index.html），squircle 只在 @supports 启用', () => {
    // 1) 配对扫描：每处全圆角声明必须有同位置的 corner-shape: round 守卫
    const offenders = []
    for (const file of [...sources(srcDir), indexHtml]) {
      const css = readFileSync(file, 'utf8')
      const all = css.match(FULL_RADIUS) ?? []
      const guarded = css.match(GUARDED_RADIUS) ?? []
      if (all.length !== guarded.length) offenders.push(`${file}: ${all.length - guarded.length} 处缺 corner-shape: round`)
    }
    expect(offenders, 'radius+corner-shape 配对违规').toEqual([])

    // 2) squircle 只在 @supports 里启用，且 scale.css 保留全局规则与基准半径
    const css = readFileSync(join(tokensDir, 'scale.css'), 'utf8')
    expect(css).toMatch(/@supports \(corner-shape: squircle\)\s*\{[\s\S]*--corner-shape: squircle;[\s\S]*corner-shape: var\(--corner-shape\)/)
    // 不支持的平台使用的基准半径保持原值
    expect(css).toMatch(/--radius-sm: 6px;[\s\S]*--radius-md: 8px;[\s\S]*--radius-lg: 12px;/)
  })
})
