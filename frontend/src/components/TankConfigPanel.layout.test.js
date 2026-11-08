import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./TankConfigPanel.vue', import.meta.url)), 'utf8')

describe('TankConfigPanel mobile module layout', () => {
  it('手机按类型分组，不再按选项序号拼 2 列矩阵', () => {
    expect(source).toMatch(/class="tp-module-groups"/)
    expect(source).toMatch(/v-for="row in moduleGroups"/)
    expect(source).toMatch(/class="tp-module-group-head"/)
    expect(source).not.toMatch(/tp-module-cell-head/)
  })

  it('桌面保留 4 列矩阵，手机分组标题只出现在有选项的类型下', () => {
    expect(source).toMatch(/class="tp-module-matrix"[\s\S]*?class="tp-module-head"/)
    expect(source).toMatch(/moduleRows\.value\.filter\(row => row\.options\.length > 0\)/)
    expect(source).toMatch(/@media \(width < 768px\)[\s\S]*?\.tp-module-groups \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
  })

  it('手机模块卡片紧凑但仍保留 44px 触控高度，装备与补给不小于 44px', () => {
    const mobile = source.slice(source.indexOf('@media (width < 768px)'))
    expect(mobile).toMatch(/\.tp-module-tile \{[\s\S]*?min-block-size: var\(--hit-min-comfortable\);/)
    expect(mobile).toMatch(/\.tp-dev-btn \{[^}]*min-inline-size: var\(--hit-min-comfortable\); min-block-size: var\(--hit-min-comfortable\);/)
    expect(mobile).toMatch(/\.tp-dev-btn img \{ inline-size: 32px; block-size: 32px;/)
    expect(mobile).toMatch(/\.tp-icon-tile \{ inline-size: var\(--hit-min-comfortable\); block-size: var\(--hit-min-comfortable\);/)
    expect(mobile).toMatch(/\.tp-icon-tile img \{ inline-size: 32px; block-size: 32px;/)
  })
})
