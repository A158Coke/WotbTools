// Classic 主题残余深色回归（theme-source 契约）。
//
// Classic(浅色) 与 Showcase(深色) 共用同一批组件 scoped 样式。修复原则：把「外圈 UI chrome」
// 组件的硬编码深色（#0…/#1…/rgba(0,…)）改为语义 token（var(--bg-card)/var(--text)/…），
// 让 Classic 继承浅色 token，而非继续在 classic-profile.css 堆 !important override。
//
// 本文件是 source-level scan：对已改动的 chrome 组件，断言旧的硬编码深色值已移除、以及
// 关键表面 class 必须消费语义 token，防止新增/回退把深色漏回 Classic。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const app = read('../App.vue')
const admin = read('../components/AdminUsersPage.vue')
const boost = read('../components/BoostPage.vue')
const profile = read('../components/ProfilePage.vue')
const md = read('../components/MarkdownContent.vue')
const ratingDocs = read('../components/RatingDocsPage.vue')
const drawer = read('../components/PlayerDetailDrawer.vue')
const rws = read('../components/ReplayWorkspace.vue')
const bpPanel = read('../components/BattlePlaybackPanel.vue')

// 提取第一条「selector{…}」规则的声明体（selector 允许跨行，但要求紧跟 { 前无逗号，
// 避免命中 :deep(th),:deep(td) 这类组合选择器）。
function ruleBody(src, selector) {
  const re = new RegExp('(?:^|\\n)\\s*' + selector + '\\s*\\{([^}]*)\\}')
  const m = src.match(re)
  if (!m) throw new Error('selector rule not found: ' + selector)
  return m[1]
}

describe('Classic 主题 residual-dark 回归（语义 token 契约）', () => {
  it('App.vue 列面板/列面板头/列列表 不得再写死深色面', () => {
    expect(ruleBody(app, '\\.colpanel ')).toContain('background: var(--bg-card)')
    expect(ruleBody(app, '\\.colpanel-head')).toContain('background: var(--bg-card2)')
    expect(ruleBody(app, '\\.cph-title')).toContain('color: var(--text-heading)')
    expect(ruleBody(app, '\\.collist li:hover')).toContain('background: var(--bg-list-hover)')
    expect(ruleBody(app, '\\.colpanel ')).not.toContain('rgba(15, 21, 25')
    expect(ruleBody(app, '\\.colpanel-head')).not.toContain('#171e22')
  })

  it('AdminUsersPage 搜索/表格/按钮 不得再写死深色面', () => {
    expect(ruleBody(admin, '\\.admin-search input')).toContain('background: var(--bg-card)')
    expect(ruleBody(admin, '\\.admin-table-wrap')).toContain('background: var(--bg-card)')
    expect(ruleBody(admin, '\\.admin-table th')).toContain('background: var(--bg-card2)')
    expect(ruleBody(admin, '\\.btn-sm')).toContain('background: var(--bg-card)')
    expect(ruleBody(admin, '\\.btn-sm')).not.toContain('#151d21')
  })

  it('BoostPage 申请/分配/用户搜索 不得再写死深色面', () => {
    expect(ruleBody(boost, '\\.application-item \\.form-row input')).toContain('background: var(--bg-card)')
    expect(ruleBody(boost, '\\.assign-box ')).toContain('background: var(--bg-card)')
    expect(ruleBody(boost, '\\.assign-box select, \\.assign-box input')).toContain('background: var(--bg-card)')
    expect(ruleBody(boost, '\\.assign-box select, \\.assign-box input')).toContain('color: var(--text)')
    expect(ruleBody(boost, '\\.user-search-dropdown')).toContain('background: var(--bg-card)')
    expect(ruleBody(boost, '\\.user-search-item:hover')).toContain('background: var(--bg-list-hover)')
    expect(ruleBody(boost, '\\.user-search-dropdown')).not.toContain('#11191d')
  })

  it('ProfilePage 编辑输入/记录表 不得再写死深色面', () => {
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

  it('RatingDocsPage 文档卡 不得再写死深色面', () => {
    expect(ruleBody(ratingDocs, '\\.rating-docs-card')).toContain('background: var(--bg-card)')
    expect(ruleBody(ratingDocs, '\\.rating-docs-card')).not.toContain('rgba(24, 30, 34')
  })

  it('PlayerDetailDrawer 导出评分卡 不得再写死深色面', () => {
    expect(ruleBody(drawer, '\\.rp-card')).toContain('background: var(--bg-card)')
    expect(ruleBody(drawer, '\\.rp-vehicle')).toContain('background: var(--bg-elevated)')
    expect(ruleBody(drawer, '\\.rp-player')).toContain('color: var(--text-heading)')
    expect(ruleBody(drawer, '\\.rp-card')).not.toContain('#14161a')
  })

  it('ReplayWorkspace / BattlePlaybackPanel 面板 不得再写死深色面', () => {
    expect(ruleBody(rws, '\\.workspace-tabs')).toContain('background: var(--bg-card)')
    expect(ruleBody(bpPanel, '\\.panel ')).toContain('background: var(--bg-card)')
    expect(ruleBody(bpPanel, '\\.panel ')).toContain('color: var(--text)')
    expect(ruleBody(bpPanel, '\\.panel ')).not.toContain('#303a40')
  })
})
