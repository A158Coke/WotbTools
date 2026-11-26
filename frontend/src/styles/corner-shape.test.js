
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
    const offenders = []
    for (const file of [...sources(srcDir), indexHtml]) {
      const css = readFileSync(file, 'utf8')
      const all = css.match(FULL_RADIUS) ?? []
      const guarded = css.match(GUARDED_RADIUS) ?? []
      if (all.length !== guarded.length) offenders.push(`${file}: ${all.length - guarded.length} 处缺 corner-shape: round`)
    }
    expect(offenders, 'radius+corner-shape 配对违规').toEqual([])

    const css = readFileSync(join(tokensDir, 'scale.css'), 'utf8')
    expect(css).toMatch(/@supports \(corner-shape: squircle\)\s*\{[\s\S]*--corner-shape: squircle;[\s\S]*corner-shape: var\(--corner-shape\)/)
    expect(css).toMatch(/--radius-sm: 6px;[\s\S]*--radius-md: 8px;[\s\S]*--radius-lg: 12px;/)
  })
})
