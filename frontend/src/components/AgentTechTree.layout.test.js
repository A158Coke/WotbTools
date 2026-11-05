import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./AgentTechTree.vue', import.meta.url)), 'utf8')
const css = source.slice(source.indexOf('<style scoped>'))

describe('AgentTechTree layout', () => {
  it('树滚动区吃外壳剩余高度，不用视口魔法数', () => {
    // 4.0 外壳有 48px 顶栏 + 56px 底部 Tab 栏；`100dvh - 220px` 会把滚动区压到 Tab 栏下面，
    // 吸底等级条永久不可见。预算必须来自 --header-h / --tabbar-h 这两个唯一 token。
    expect(css).not.toMatch(/100dvh\s*-\s*220px/)
    expect(css).toMatch(/\.techtree \{[^}]*block-size:\s*calc\(100dvh - var\(--header-h\) - var\(--tabbar-h\)/s)
    expect(css).toMatch(/\.tt-scroll \{[^}]*flex:\s*1 1 0;/s)
    expect(css).toMatch(/\.tt-scroll \{[^}]*min-block-size:\s*0;/s)
  })

  it('手机国别页签单行横滑，不再换行吃掉树高', () => {
    expect(css).toMatch(/@media \(width < 768px\)[\s\S]*?\.tt-tabs \{[^}]*flex-wrap:\s*nowrap;/s)
    expect(css).toMatch(/@media \(width < 768px\)[\s\S]*?\.tt-tabs \{[^}]*overflow-x:\s*auto;/s)
  })

  it('矮视口隐藏页头描述，把高度让给树', () => {
    expect(css).toMatch(/@media \(height <= 520px\)[\s\S]*?\.page-header-description\)? \{[^}]*display:\s*none;/s)
  })
})