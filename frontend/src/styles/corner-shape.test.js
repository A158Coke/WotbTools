// squircle 渐进增强守护：scale.css 在 @supports (corner-shape: squircle) 里给所有元素套 squircle，
// 因此胶囊 / 圆形（--radius-full、50%）必须在同一条规则里声明 corner-shape: round，否则头像会变成方圆。
// 规则见 docs/frontend/design-language.md §5「圆角」。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('..', import.meta.url))
const tokensDir = join(srcDir, 'styles', 'tokens')

function sources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, acc)
    else if (/\.(css|vue)$/.test(name) && !path.startsWith(tokensDir)) acc.push(path)
  }
  return acc
}

describe('corner-shape 渐进增强', () => {
  it('--radius-full / 50% 圆角紧跟 corner-shape: round', () => {
    const offenders = []
    for (const file of sources(srcDir)) {
      const css = readFileSync(file, 'utf8')
      const all = css.match(/border-radius:\s*(?:var\(--radius-full\)|50%);/g) ?? []
      const guarded = css.match(/border-radius:\s*(?:var\(--radius-full\)|50%);\s*corner-shape:\s*round;/g) ?? []
      if (all.length !== guarded.length) offenders.push(`${file}: ${all.length - guarded.length} 处缺 corner-shape: round`)
    }
    expect(offenders).toEqual([])
  })

  it('squircle 只在 @supports 里启用，且 scale.css 保留全局规则', () => {
    const css = readFileSync(join(tokensDir, 'scale.css'), 'utf8')
    expect(css).toMatch(/@supports \(corner-shape: squircle\)\s*\{[\s\S]*--corner-shape: squircle;[\s\S]*corner-shape: var\(--corner-shape\)/)
    // 不支持的平台使用的基准半径保持原值
    expect(css).toMatch(/--radius-sm: 6px;[\s\S]*--radius-md: 8px;[\s\S]*--radius-lg: 12px;/)
  })
})
