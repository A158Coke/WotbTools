// 首屏 防 FOUC 契约:index.html 内联脚本必须在任何渲染前按 localStorage 设置
// data-ui-profile 与派生的 data-theme(showcase→dark, classic→light),并给浅色 loader 提供 token。
// 与 src/composables/useUiProfile.js 的 key/校验/默认保持一致。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')

const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''

describe('index.html 首屏 profile/theme 派生（Theme 计划：无 FOUC）', () => {
  it('默认 :root 为 dark,且提供 html[data-theme="light"] 浅色 loader token(Classic 首屏不成黑) ', () => {
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('html[data-theme="light"]')
    expect(html).toMatch(/html\[data-theme="light"\]\{[^}]*color-scheme:light[^}]*\}/)
    expect(html).toMatch(/html\[data-theme="light"\]\{[^}]*--bg:#f4f5f2[^}]*\}/)
  })

  it('内联 FOUC 脚本同时设置 data-ui-profile 与派生的 data-theme', () => {
    expect(script).toContain("setAttribute('data-ui-profile', p)")
    expect(script).toContain("setAttribute('data-theme', p === 'classic' ? 'light' : 'dark')")
  })

  it('非法值回退 showcase→dark(与 useUiProfile 默认一致)', () => {
    expect(script).toContain("if (p !== 'classic' && p !== 'showcase') p = 'showcase'")
    expect(script).toContain("setAttribute('data-theme', 'dark')")
  })

  it('首屏不新增独立主题状态(只有 wotb-ui-profile 一个 key)', () => {
    expect(script).toContain("localStorage.getItem('wotb-ui-profile')")
    expect(script).not.toContain("'wotb-theme'")
    expect(html).not.toMatch(/data-theme="[^"]*"\s+data-theme/)
  })
})
