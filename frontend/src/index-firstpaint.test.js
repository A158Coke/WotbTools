// @vitest-environment happy-dom
// 首屏防 FOUC 契约：index.html 内联脚本在任何渲染前按 localStorage 投影 data-ui-profile、
// 派生的 data-theme 与 theme-color；合法值 / 旧值映射 / 默认与 src/composables/useUiProfile.js 一致。
// 这里真实执行内联脚本，而不是匹配源码文本。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_COLOR, UI_PROFILES, themeForProfile } from './composables/useUiProfile.js'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

function firstInlineScript(source) {
  return (source.match(/<script\b[^>]*>([\s\S]*?)<\/script(?:[ \t\n\r\f/][^>]*)?>/i) || [])[1] || ''
}

const script = firstInlineScript(html)

function runFirstPaint(stored) {
  window.localStorage.clear()
  if (stored !== undefined) window.localStorage.setItem('wotb-ui-profile', stored)
  const root = document.documentElement
  root.removeAttribute('data-ui-profile')
  root.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#000000">'
  new Function(script)()
  return {
    profile: root.getAttribute('data-ui-profile'),
    theme: root.getAttribute('data-theme'),
    color: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
    stored: window.localStorage.getItem('wotb-ui-profile'),
  }
}

describe('index.html 首屏主题投影（无 FOUC）', () => {
  beforeEach(() => window.localStorage.clear())

  it.each(UI_PROFILES)('%s：首帧即投影 profile、深浅色与 theme-color', (profile) => {
    expect(runFirstPaint(profile)).toEqual({ profile, theme: themeForProfile(profile), color: THEME_COLOR[profile], stored: profile })
  })

  it.each(['showcase', 'classic', 'auto'])('旧值 %s 映射为盛夏并写回', (legacy) => {
    expect(runFirstPaint(legacy)).toEqual({ profile: 'summer', theme: 'dark', color: THEME_COLOR.summer, stored: 'summer' })
  })

  it('没有存储或非法值：盛夏，不写入存储', () => {
    expect(runFirstPaint(undefined)).toMatchObject({ profile: 'summer', theme: 'dark', stored: null })
    expect(runFirstPaint('legacy')).toMatchObject({ profile: 'summer', theme: 'dark', stored: 'legacy' })
  })

  it('静态默认与首屏 loader 底色覆盖四套主题；只有 wotb-ui-profile 一个 key', () => {
    expect(html).toContain('data-ui-profile="summer"')
    for (const profile of UI_PROFILES) expect(html).toContain(`html[data-ui-profile="${profile}"]{`)
    expect(html).toMatch(/html\[data-ui-profile="winter"\]\{color-scheme:light;/)
    expect(script).not.toContain("'wotb-theme'")
  })

  it('不把 script 内容里的非结束标签当成结束标签', () => {
    expect(firstInlineScript('<script>const marker="</script-x>"; ok()</script>'))
      .toBe('const marker="</script-x>"; ok()')
  })
})
