import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./TankConfigPanel.vue', import.meta.url)), 'utf8')

describe('TankConfigPanel mobile module matrix', () => {
  it('2 列折行时每个控件自带类型标题，顶部标题行隐藏', () => {
    expect(source).toMatch(/class="tp-module-cell-head"/)
    expect(source).toMatch(/\.tp-module-cell-head \{ display: none; \}/)
    expect(source).toMatch(/@media \(width < 768px\)[\s\S]*?\.tp-module-head \{ display: none; \}/)
  })
})
