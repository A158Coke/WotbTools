
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const app = read('./app-shell.css')
const adminList = read('../components/admin-list.css')
const profile = read('../components/ProfilePage.vue') + '\n' + read('../components/profile.css')
const md = read('../components/MarkdownContent.vue')
const drawer = read('../components/PlayerDetailDrawer.vue') + '\n' + read('../components/player-detail.css')
const capabilityTabs = read('../components/ReplayCapabilityTabs.vue')
const segmented = read('../components/SegmentedControl.vue')
const bpPanel = read('../components/BattlePlaybackPanel.vue')

function ruleBody(src, selector) {
  const re = new RegExp('(?:^|\\n)\\s*' + selector + '\\s*\\{([^}]*)\\}')
  const m = src.match(re)
  if (!m) throw new Error('selector rule not found: ' + selector)
  return m[1]
}

describe('浅色主题 residual-dark 回归（语义 token 契约）', () => {
  it('应用壳 / 管理列表 / 导出评分卡的关键表面消费语义 token', () => {
    expect(ruleBody(app, '\\.colpanel ')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(app, '\\.colpanel-head')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(app, '\\.cph-title')).toContain('color: var(--color-text-primary)')
    expect(ruleBody(app, 'tr:hover td, \\.collist li:hover')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(adminList, '\\.admin-list-table-wrap')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(adminList, '\\.admin-list-table th')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(adminList, '\\.admin-list-input')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(drawer, '\\.rp-card')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(drawer, '\\.rp-vehicle')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(drawer, '\\.rp-player')).toContain('color: var(--color-text-primary)')
  })

  it('ProfilePage 编辑输入/记录表不得再写死深色面（legacy 基线文件，负半句仍在此守护）', () => {
    expect(ruleBody(profile, '\\.edit-input')).toContain('background: var(--bg-card)')
    expect(ruleBody(profile, '\\.records-table tbody tr:hover')).toContain('background: var(--bg-list-hover)')
    expect(ruleBody(profile, '\\.records-table td')).toContain('border-bottom: 1px solid var(--border-light)')
    expect(ruleBody(profile, '\\.edit-input')).not.toContain('#0f1518')
  })

  it('MarkdownContent 表格/代码/引用 不得再写死深色面', () => {
    expect(ruleBody(md, '\\.markdown-content :deep\\(th\\)')).toContain('background: var(--bg-card2)')
    expect(ruleBody(md, '\\.markdown-content :deep\\(code\\)')).toContain('background: var(--bg-elevated)')
    expect(ruleBody(md, '\\.markdown-content :deep\\(pre\\)')).toContain('background: var(--bg-elevated)')
    expect(ruleBody(md, '\\.markdown-content :deep\\(blockquote\\)')).toContain('background: var(--bg-card)')
    expect(ruleBody(md, '\\.markdown-content :deep\\(code\\)')).not.toContain('rgba(10, 15, 18')
  })

  it('PlayerDetailDrawer 导出评分卡 不得再写死深色面', () => {
    expect(drawer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(ruleBody(drawer, '\\.rp-card')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(drawer, '\\.rp-vehicle')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(drawer, '\\.rp-player')).toContain('color: var(--color-text-primary)')
  })

  it('ReplayCapabilityTabs / BattlePlaybackPanel 面板 不得再写死深色面', () => {
    expect(capabilityTabs).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(capabilityTabs).not.toContain('<style')
    expect(capabilityTabs).toContain('SegmentedControl')
    expect(ruleBody(segmented, '\\.segmented-option\\.is-active')).toContain('var(--color-')
    expect(ruleBody(bpPanel, '\\.map-panel ')).toContain('color: var(--text)')
    expect(bpPanel.slice(bpPanel.indexOf('<style'))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
