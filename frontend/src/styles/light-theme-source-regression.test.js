// 浅色主题（寒冬）残余深色回归（theme-source 契约）。
//
// 寒冬（浅色）与春 / 夏 / 秋（深色）共用同一批组件 scoped 样式。修复原则：把「外圈 UI chrome」
// 组件的硬编码深色（#0…/#1…/rgba(0,…)）改为语义 token（var(--bg-card)/var(--text)/…），
// 让各主题继承语义 token，而不是按主题堆 !important override。
//
// 本文件是 source-level scan：对已改动的 chrome 组件，断言旧的硬编码深色值已移除、以及
// 关键表面 class 必须消费语义 token，防止新增/回退把深色漏回浅色主题。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const app = read('./app-shell.css')
const adminList = read('../components/admin-list.css')
const profile = read('../components/ProfilePage.vue')
const md = read('../components/MarkdownContent.vue')
const drawer = read('../components/PlayerDetailDrawer.vue')
const capabilityTabs = read('../components/ReplayCapabilityTabs.vue')
const segmented = read('../components/SegmentedControl.vue')
const bpPanel = read('../components/BattlePlaybackPanel.vue')

// 提取第一条「selector{…}」规则的声明体（selector 允许跨行，但要求紧跟 { 前无逗号，
// 避免命中 :deep(th),:deep(td) 这类组合选择器）。
function ruleBody(src, selector) {
  const re = new RegExp('(?:^|\\n)\\s*' + selector + '\\s*\\{([^}]*)\\}')
  const m = src.match(re)
  if (!m) throw new Error('selector rule not found: ' + selector)
  return m[1]
}

describe('浅色主题 residual-dark 回归（语义 token 契约）', () => {
  // 「不再写死深色」的负半句由 stylelint（color-no-hex / function-disallowed-list）接管：
  // app-shell.css、AdminUsersPage.vue、admin-list.css、PlayerDetailDrawer.vue 均不在
  // stylelint.legacy.json 基线内，受严格规则约束；这里只保留正半句（正向 token 映射），
  // 三组合并为一条断言（stylelint 表达不了正向映射，见 #827）。
  it('应用壳 / 管理列表 / 导出评分卡的关键表面消费语义 token', () => {
    expect(ruleBody(app, '\\.colpanel ')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(app, '\\.colpanel-head')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(app, '\\.cph-title')).toContain('color: var(--color-text-primary)')
    expect(ruleBody(app, 'tr:hover td, \\.collist li:hover')).toContain('background: var(--color-surface-2)')
    // 表格 / 输入的共享样式在管理列表模板 admin-list.css
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
    // 设计语言组件：只用语义 token（--color-*），导出卡同样跟随主题，不写死任何色值
    expect(drawer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(ruleBody(drawer, '\\.rp-card')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(drawer, '\\.rp-vehicle')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(drawer, '\\.rp-player')).toContain('color: var(--color-text-primary)')
  })

  it('ReplayCapabilityTabs / BattlePlaybackPanel 面板 不得再写死深色面', () => {
    // 能力切换是 canonical SegmentedControl 的薄 adapter：自己不持有任何选项样式，
    // 因此这里断言的是"没有第二套视觉"，token 契约由 SegmentedControl 自己承担。
    expect(capabilityTabs).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(capabilityTabs).not.toContain('<style')
    expect(capabilityTabs).toContain('SegmentedControl')
    expect(ruleBody(segmented, '\\.segmented-option\\.is-active')).toContain('var(--color-')
    expect(ruleBody(bpPanel, '\\.panel ')).toContain('background: var(--bg-card)')
    expect(ruleBody(bpPanel, '\\.panel ')).toContain('color: var(--text)')
    expect(ruleBody(bpPanel, '\\.panel ')).not.toContain('#303a40')
  })
})
