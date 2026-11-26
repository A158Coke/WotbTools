
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
})
