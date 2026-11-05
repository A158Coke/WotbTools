import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('./PageHeader.vue', import.meta.url)), 'utf8')
const css = source.slice(source.indexOf('<style scoped>'))

describe('PageHeader layout', () => {
  it('compact 页头按 DC-ARC-02 收敛为「标题 + 操作」一行，说明隐藏', () => {
    expect(css).toMatch(/@media \(width < 768px\)[\s\S]*?\.page-header-description \{[^}]*display:\s*none;/s)
    expect(css).toMatch(/@media \(width < 768px\)[\s\S]*?\.page-header \{[^}]*align-items:\s*center;/s)
    expect(css).toMatch(/@media \(width < 768px\)[\s\S]*?\.page-header \{[^}]*padding-block:\s*var\(--space-1\);/s)
  })
})