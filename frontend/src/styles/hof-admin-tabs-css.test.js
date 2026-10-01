// CSS ownership guard：名人堂管理页的 Tab 条 / 筛选 / 表格只由 HoFAdminPage.vue 定义。
//
// 历史回归：showcase-regressions.css（main.js 最后加载）曾把 .hof-admin-tabs 从 sticky 改成
// relative，而 showcase-rankings.css 的 top 偏移仍在，Tab 条滑到筛选栏下面（生产「百场审核
// Tab 不可见」）。根因是同一元素有多个样式 owner。迁到设计语言 token 后（design-language §13），
// 组件 scoped 样式是唯一 owner；这里只锁定「全局样式表不再触碰这些内部元素」这一归属约束，
// 真实布局几何仍由浏览器级测试覆盖。

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = fileURLToPath(new URL('.', import.meta.url))
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const globalSheets = readdirSync(dir).filter((name) => name.endsWith('.css'))

describe('HoF admin CSS ownership', () => {
  it('全局样式表不定义 Tab 条 / 筛选 / 管理表格规则', () => {
    expect(globalSheets.length).toBeGreaterThan(0)
    for (const sheet of globalSheets) {
      const css = stripComments(readFileSync(dir + sheet, 'utf8'))
      expect(css, sheet + ' must not style HoF admin internals').not.toMatch(/\.hof-admin-(tabs|filters|table)\b/)
    }
  })

  it('组件自身定义吸顶 Tab 条：偏移读顶栏高度 token，层级用 token，窄屏可横向滚动', () => {
    const source = readFileSync(fileURLToPath(new URL('../components/HoFAdminPage.vue', import.meta.url)), 'utf8')
    const style = source.slice(source.indexOf('<style scoped>'))
    const body = style.slice(style.indexOf('.hof-admin-tabs {'), style.indexOf('}', style.indexOf('.hof-admin-tabs {')))
    expect(body).toMatch(/position:\s*sticky/)
    expect(body).toMatch(/top:\s*calc\(var\(--header-h\)/)
    expect(body).toMatch(/z-index:\s*var\(--z-sticky\)/)
    expect(body).toMatch(/overflow-x:\s*auto/)
  })
})
