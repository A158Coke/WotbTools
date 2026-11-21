import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const readSrc = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
// scoped 样式已拆至 sidecar css；源码契约断言仍需看到样式文本
const source = readSrc('./TankResearchPanel.vue') + readSrc('./tank-research-panel.css')

describe('TankResearchPanel layout', () => {
  it('研发图按自然尺寸渲染，窄屏由滚动容器承接而不是整图缩放', () => {
    expect(source).not.toContain('fitScale')
    expect(source).not.toContain('transformOrigin')
    expect(source).not.toMatch(/transform:\s*`scale\(\$\{/)
    expect(source).toMatch(/<div class="tr-scroll">/)
    expect(source).toMatch(/\.tr-scroll \{[^}]*overflow: auto;/s)
  })

  it('窄屏覆盖 has-side，前驱车与研发图纵向堆叠', () => {
    expect(source).toMatch(/@media \(width < 1200px\)[\s\S]*?\.tr-panel\.has-side \{ grid-template-columns: minmax\(0, 1fr\);/)
  })
})
