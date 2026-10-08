// CSS source contract guard for Classic Profile (frontend/AGENTS.md D1/D2).
//
// Presentation profiles share DOM and business state. Migrated surfaces use semantic tokens;
// remaining legacy surfaces retain namespaced Classic bridges until their owner is migrated.
// This guard covers ownership and source boundaries; actual layout/contrast needs browser QA.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const classic = read('./classic-profile.css')
const mainJs = read('../main.js')
const playbackFixture = read('../../scripts/browser-fixtures/playback-controls.js')
const appShell = read('./app-shell.css')
const workspaces = read('./showcase-workspaces.css')
const home = read('../components/HomePage.vue')
const contact = read('../components/ContactPage.vue')

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// 提取第一条 selector 片段包含 fragment 的规则体,把 selector 与其声明绑定。
function ruleBody(css, selectorFragment) {
  const start = css.indexOf(selectorFragment)
  expect(start, 'selector ' + selectorFragment + ' must exist').toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

// 收集 main.js 中按顺序导入的所有 css。
const stylesheetImports = [...mainJs.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1])

describe('Classic Profile CSS contract', () => {
  it('每条规则都必须带 [data-ui-profile="classic"] namespace(§43A,严禁污染 Showcase)', () => {
    const css = stripComments(classic)
    const rules = css.split(/}/).filter((chunk) => chunk.includes('{'))
    expect(rules.length).toBeGreaterThan(0)
    for (const chunk of rules) {
      const selector = chunk.slice(0, chunk.indexOf('{'))
      expect(selector, 'rule missing namespace: ' + selector.trim().slice(0, 80)).toMatch(/data-ui-profile=/)
    }
  })

  it('不得用 display:none 隐藏业务元素(§43B)', () => {
    const css = stripComments(classic)
    expect(css).not.toMatch(/display:\s*none/)
  })

  it('工作区不再加载全屏 AI 背景层，两种 Profile 共用纯色页面', () => {
    expect(stylesheetImports.some(path => /showcase-backgrounds/.test(path))).toBe(false)
    expect(ruleBody(appShell, 'body {')).toContain('background: var(--color-canvas)')
  })

  it('首页拥有自己的装饰插槽，Classic 不再覆盖业务卡片', () => {
    expect(stripComments(classic)).not.toMatch(/\.(feature-visual|feature-card|showcase-hero|record-card)\b/)
    expect(home).toContain('var(--color-surface-1)')
    expect(home).toContain('var(--color-text-primary)')
  })

  it('在 main.js 中必须最后导入(§43D / §33 顺序契约)', () => {
    expect(stylesheetImports[stylesheetImports.length - 1]).toMatch(/classic-profile\.css$/)
    const classicIdx = stylesheetImports.findIndex((p) => p.endsWith('classic-profile.css'))
    expect(classicIdx).toBe(stylesheetImports.length - 1)
    const lastShowcase = stylesheetImports.map((p) => p.endsWith('showcase-regressions.css')).indexOf(true)
    expect(classicIdx).toBeGreaterThan(lastShowcase)
    // The browser gate must exercise the same cascade as production, including deleted sheets.
    const fixtureSheets = [...playbackFixture.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map(m => m[1].replace(/^.*?styles\//, ''))
    expect(fixtureSheets).toEqual(stylesheetImports.map(path => path.replace(/^.*?styles\//, '')))
  })
})

describe('Classic Profile — 真浅色主题契约（Theme 计划：Classic=Light, Showcase=Dark）', () => {
  const css = stripComments(classic)
  const tokenBlock = (css.match(/html\[data-ui-profile="classic"\]\s*\{[\s\S]*?\}/) || [])[0] || ''

  it('完整浅色语义 token:color-scheme light + 浅色背景/卡片/深色文字/浅边框/橙金强调', () => {
    expect(tokenBlock).toContain('color-scheme: light')
    expect(tokenBlock).toContain('--bg: #f4f5f2')
    expect(tokenBlock).toContain('--bg-card: #ffffff')
    expect(tokenBlock).toContain('--text: #2a2f28')
    expect(tokenBlock).toContain('--text-heading: #11140f')
    expect(tokenBlock).toContain('--border: #d9dde3')
    expect(tokenBlock).toContain('--accent: #c9762e')
    // 阵营战术色保持 hue(不反色、不变蓝),提高对比
    expect(tokenBlock).toContain('--friendly: #22c55e')
    expect(tokenBlock).toContain('--enemy: #ef4444')
  })

  it('同步 --showcase-tactical* 浅色 token(Reconstruction/地图外围面板)', () => {
    expect(css).toContain('--showcase-tactical: linear-gradient(160deg, #fbfbf9')
    expect(css).toContain('--showcase-tactical-heading: #1c2018')
    expect(css).toContain('--showcase-tactical-soft-2: rgba(255, 255, 255, .85)')
  })

  it('禁止 filter:invert / 全局 html * 覆盖(性能与脏覆盖)', () => {
    expect(css).not.toMatch(/filter:\s*invert/)
    expect(css).not.toMatch(/^\s*html\s+\*/m)
    expect(css).not.toMatch(/\b\*\s*\{/)
  })

  // 应用外壳（顶栏 / 底部 Tab 栏 / 更多）只用设计语言语义 token，浅色由 tokens/color.css 的
  // [data-theme="light"] 映射提供，不再需要 classic 覆盖规则。
  it('未迁移 modal 保留 Classic 桥接，已迁移回放表格不建立第二个 owner', () => {
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.modal\s*\{/)
    expect(css).not.toMatch(/\.layout-data-workspace\s+(?:table|\.tablewrap)/)
    expect(css).not.toMatch(/display:\s*none/)
  })
})

describe('Classic 迁移边界：语义 owner 与仍需要的 legacy 桥接', () => {
  const css = stripComments(classic)
  const declOf = (frag) => {
    for (const preferHtml of [true, false]) {
      for (const chunk of css.split(/}/).filter((c2) => c2.includes('{'))) {
        const sel = chunk.slice(0, chunk.indexOf('{'))
        if (sel.includes(frag) && (preferHtml ? sel.includes('html[data-ui-profile') : sel.includes('[data-ui-profile'))) {
          return chunk.slice(chunk.indexOf('{') + 1)
        }
      }
    }
    throw new Error('selector not found in classic-profile.css: ' + frag)
  }
  // 断言声明体含片段（值必须带 !important，证明最终级联战胜 Showcase 的 !important 深色规则）。
  const has = (frag, subs) => {
    const body = declOf(frag)
    for (const sub of subs) expect(body + '', 'selector ' + frag + ' 缺 ' + sub).toContain(sub)
  }

  it('首页标题与操作不受全局深浅色补丁接管', () => {
    expect(css).not.toMatch(/\.(hero-copy|hero-btn|mini-action|record-meta)\b/)
  })

  it('通用 Ghost / Tabs 由 app-shell 的语义 token 定义', () => {
    expect(ruleBody(appShell, '.ghost {')).toContain('color: var(--color-text-primary)')
    expect(ruleBody(appShell, '.tabs button.active')).toContain('color: var(--color-accent-text)')
    expect(css).not.toMatch(/\.filebtn|classic"\] \.tabs button/)
  })

  it('Replay 表格与 sticky cells 共用不透明语义表面，不依赖 Classic 补丁', () => {
    expect(ruleBody(appShell, '.tablewrap')).toContain('background: var(--color-surface-1)')
    expect(ruleBody(workspaces, '.layout-data-workspace table thead th {')).toContain('background: var(--color-surface-2)')
    expect(ruleBody(workspaces, '.layout-data-workspace table td:first-child')).toContain('background: var(--color-surface-1)')
    expect(css).not.toContain('.layout-data-workspace .tablewrap')
  })

  it('HoF：Toolbar/Table Header 浅色 !important（上传弹窗已改用 AppDialog token）', () => {
    has('.lb-toolbar', ['background: color-mix(in srgb, var(--bg-card) 94%, transparent) !important'])
    has('.lb-wrap thead th', ['background: var(--bg-card2) !important'])
  })

  it('HoF 公开页残留缺口：submit row/普通行基础背景/分隔线/pending/下载/分页 浅色 !important（PR #151 收尾）', () => {
    // 提交记录行（showcase-cohesion .lb-submit-row rgba(10,16,19,.50) !important）
    has('.lb-wrap .lb-submit-row', ['background: var(--bg-card) !important', 'color: var(--text) !important'])
    // 普通排名行基础背景（showcase-cohesion .lb-wrap table tbody tr rgba(13,19,22,.86)）
    has('.lb-wrap table tbody tr', ['background: var(--bg-card) !important', 'color: var(--text) !important'])
    // 行分隔线（浅灰）
    has('.lb-wrap table tbody td', ['border-bottom: 1px solid var(--border-light) !important'])
    // 行 hover（showcase-cohesion 深色 hover 必须被覆盖）
    has('.lb-wrap tbody tr:hover', ['background: var(--bg-list-hover) !important'])
    // 表头 sticky（不透明浅色 + 次级文字）
    has('.lb-wrap thead th', ['background: var(--bg-card2) !important', 'color: var(--text-sub) !important'])
    // 百场/三环 pending 状态卡
    has('.lb-wrap .h100-pending-card', ['background: var(--bg-card) !important'])
    has('.lb-wrap .h100-pending-meta strong', ['color: var(--accent-dark) !important'])
    // 下载 / 分页
    has('.lb-wrap .lb-download', ['background: var(--bg-card) !important', 'color: var(--text) !important'])
    has('.lb-wrap .pagination button', ['background: var(--bg-card) !important', 'color: var(--text-sub) !important'])
  })

  it('Contact 组件拥有浅深色语义表面，Classic 不再覆盖', () => {
    expect(css).not.toContain('.contact-card')
    expect(contact).toContain('var(--color-surface-1)')
    expect(contact).toContain('var(--color-text-primary)')
  })

  // 用户管理 / 名人堂管理 / 玩家详情抽屉已迁到设计语言语义 token（design-language §13）：
  // 浅色由 tokens/color.css 的语义映射提供，classic 不得再用 !important 覆盖其内部元素（避免第二个样式 owner）。
  it('已迁移组件（Admin Users / HoF Admin / Player Drawer）不再有 classic 覆盖', () => {
    for (const chunk of css.split(/}/).filter((c2) => c2.includes('{'))) {
      const sel = chunk.slice(0, chunk.indexOf('{'))
      if (/::(after|before)/.test(sel)) continue // 关闭装饰背景的 content:none 规则保留
      expect(sel, 'migrated selector: ' + sel.trim().slice(0, 80)).not.toMatch(/\.(admin-page|admin-table|hof-admin|player-drawer)\b/)
    }
  })
})
