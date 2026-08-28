// CSS source contract guard for Classic Profile (frontend/AGENTS.md D1/D2).
//
// Classic = 仅「从简」视觉精简(结构性不变,D1)。本文件用 [data-ui-profile="classic"]
// namespace 关闭 Showcase 的全屏 AI/装饰性背景、readability veil、装饰性 hero surface。
// 契约(对应计划 §43 A/B/D):
//   A) 每条规则都必须带 [data-ui-profile="classic"] 前缀,严禁无 namespace 的全局规则泄漏进 Showcase;
//   B) 不得用 display:none 隐藏任何业务元素(HoF Admin tabs / Replay actions / AI Review / League Rating 等);
//   D) 必须在 main.js 中于所有 showcase*.css 之后导入。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

const classic = read('./classic-profile.css')
const mainJs = read('../main.js')

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

  it('必须关闭全屏 AI 背景(backdrop ::after/::before 用 content:none 移除)', () => {
    const css = stripComments(classic)
    const rule = css.split(/}/).find((chunk) => /::after|::before/.test(chunk) && chunk.includes('content: none'))
    expect(rule, 'should contain a backdrop-pseudo rule that removes the AI backdrop').toBeTruthy()
    expect(rule).toMatch(/data-ui-profile/)
    expect(rule).toMatch(/layout-data-workspace/)
  })

  it('Classic 去掉首页四张 AI 装饰卡片图并清除装饰渐变(Home)', () => {
    const css = stripComments(classic)
    // 去图:.feature-visual img 用 visibility:hidden(保留盒子 -> 不改卡片结构/尺寸/间距)
    expect(ruleBody(css, '.feature-visual img')).toContain('visibility: hidden')
    // 清除 .feature-visual::after 装饰渐变
    expect(ruleBody(css, '.feature-visual::after')).toContain('content: none')
    // 清除 .showcase-hero::before 装饰渐变
    expect(ruleBody(css, '.showcase-hero::before')).toContain('content: none')
  })

  it('在 main.js 中必须最后导入(§43D / §33 顺序契约)', () => {
    expect(stylesheetImports[stylesheetImports.length - 1]).toMatch(/classic-profile\.css$/)
    const classicIdx = stylesheetImports.findIndex((p) => p.endsWith('classic-profile.css'))
    expect(classicIdx).toBe(stylesheetImports.length - 1)
    const lastShowcase = stylesheetImports.map((p) => p.endsWith('showcase-regressions.css')).indexOf(true)
    expect(classicIdx).toBeGreaterThan(lastShowcase)
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
    expect(tokenBlock).toContain('--friendly: #a9661a')
    expect(tokenBlock).toContain('--enemy: #2e7ea8')
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

  it('覆盖核心页面面:topbar/user-menu/tabs/table/form/modal 均带 namespace 且不隐藏业务', () => {
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.topbar\s*\{/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.user-menu-panel\s*\{/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.modal\s*\{/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.layout-data-workspace\s+:is\(input, select, textarea\)/)
    expect(css).toMatch(/\[data-ui-profile="classic"\]\s+\.layout-data-workspace\s+table\s+thead\s+th/)
    // 不隐藏业务组件(白底白字/低对比风险用 token 覆盖,而非 display:none)
    expect(css).not.toMatch(/display:\s*none/)
  })
})

describe('Classic 深色冲突 selector→declaration 绑定（须带 !important 战胜 Showcase 深色）', () => {
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

  it('Home：hero 标题/副标题/次级 CTA/Record Card 白底深字且带 !important', () => {
    has('.showcase-hero h1', ['color: var(--text-heading) !important', 'text-shadow: none !important'])
    has('.hero-subtitle', ['color: var(--text-sub) !important'])
    has('.hero-btn.secondary', ['background: var(--bg-card) !important', 'color: var(--text) !important'])
    has('.record-card', ['background: var(--bg-card) !important', 'color: var(--text-heading) !important'])
    has('.record-card > span', ['color: var(--text-sub) !important'])
    has('.mini-action', ['background: var(--bg-card) !important', 'color: var(--text) !important'])
  })

  it('用户菜单：菜单项/Hover/Danger/分段控件 浅底深字 !important', () => {
    has('.user-menu-panel .user-menu-item', ['color: var(--text) !important'])
    has('.user-menu-panel .user-menu-item:hover', ['background: var(--bg-list-hover) !important'])
    has('.user-menu-panel .user-menu-item.danger', ['color: var(--delete) !important'])
    has('.ui-profile-option.active', ['background: var(--accent) !important', 'color: var(--accent-text) !important'])
  })

  it('Replay 上传区：Heading/Card/Filebar/Ghost 按钮 浅底深字 !important', () => {
    has('.uploadhead h1', ['color: var(--text-heading) !important'])
    has('.uploadcard', ['background: var(--bg-upload) !important'])
    has('.uploadcard .up-title', ['color: var(--text-heading) !important'])
    has('.filebar', ['background: var(--bg-upload) !important'])
    has('.filebtn.ghost', ['background: var(--bg-card) !important', 'color: var(--text) !important'])
    has('.tabs button', ['color: var(--text-sub) !important'])
    has('.upload-points span', ['background:', 'border-color:', 'color: var(--text-sub) !important'])
  })

  it('回归：Replay .tablewrap 必须 background/border-color/color/box-shadow 全带 !important', () => {
    has('.layout-data-workspace .tablewrap', [
      'background: var(--bg-card) !important',
      'border-color: var(--border) !important',
      'color: var(--text) !important',
      'box-shadow: var(--surface-shadow) !important',
    ])
  })

  it('回归：Replay 处理面板 / Export 任务卡 浅色 token + !important（scoped 写死深色面板/进度条/按钮）', () => {
    has('.replay-processing-panel', ['background: var(--bg-card) !important', 'border-color: var(--border) !important', 'color: var(--text) !important'])
    has('.replay-processing-panel .rpp-title', ['color: var(--text-heading) !important'])
    has('.replay-processing-panel .rpp-ok', ['color: var(--status-ok-fg) !important'])
    has('.replay-processing-panel .rpp-bar', ['background: var(--border) !important'])
    has('.replay-processing-panel .rpp-bar-fill', ['background: var(--accent) !important'])
    has('.replay-processing-panel .rpp-btn', ['background: var(--bg-card) !important', 'color: var(--text) !important', 'border-color: var(--border) !important'])
    has('.replay-task-card', ['background: var(--bg-card) !important', 'border-color: var(--border) !important'])
    has('.replay-task-card .etc-bar', ['background: var(--border) !important'])
    has('.replay-task-card .etc-bar-fill', ['background: var(--accent) !important'])
    has('.replay-task-card .etc-btn.primary', ['background: var(--accent) !important', 'color: var(--accent-text) !important'])
  })

  it('Boost：Topbar/Tabs/Card/List 浅底深字 !important', () => {
    has('.boost-topbar', ['background: var(--bg-card) !important'])
    has('.boost-tabs button', ['color: var(--text-sub) !important'])
    has('.boost-card', ['background: var(--bg-card) !important'])
    has('.boost-page :is(.boost-list, .request-list, .booster-list, .admin-list)', ['background: var(--bg-card) !important'])
  })

  it('HoF：Toolbar/Table Header/Upload Modal 浅色 !important', () => {
    has('.lb-toolbar', ['background: color-mix(in srgb, var(--bg-card) 94%, transparent) !important'])
    has('.lb-wrap thead th', ['background: var(--bg-card2) !important'])
    has('.hof-upload-modal', ['background: var(--bg-card) !important'])
  })

  it('HoF Admin：Tabs(默认+active)/Filters/Table/Pagination 浅色 !important', () => {
    has('.hof-admin-tabs button', ['color: var(--text-sub) !important'])
    has('.hof-admin-tabs button.active', ['color: var(--accent-dark) !important'])
    has('.hof-admin-filters :is(input, select)', ['background: var(--bg-card) !important'])
    has('admin-hof-page) thead th', ['background: var(--bg-card2) !important'])
    has('.hof-admin .pagination button', ['background: var(--bg-card) !important', 'color: var(--text-sub) !important'])
  })

  it('回归：HoF Admin tbody td 必须 color var(--text) !important（防白底浅字）', () => {
    has('admin-hof-page) tbody td', ['color: var(--text) !important'])
  })

  it('回归：HoF Admin .tablewrap 必须 background/border-color/color/box-shadow 全带 !important（防浅色主题残留深色边框/阴影）', () => {
    has(':is(.hof-admin, .hof-admin-page, .hofadmin-page, .admin-hof-page) .tablewrap', [
      'background: var(--bg-card) !important',
      'border-color: var(--border) !important',
      'color: var(--text) !important',
      'box-shadow: var(--surface-shadow) !important',
    ])
  })

  it('回归：HoF Admin 表格行基础背景 / denied 标题 / dmg 值 浅色 token + !important（Blocker 3 收尾）', () => {
    has('hof-admin-table tbody tr', ['background: var(--bg-card) !important'])
    has('hof-admin-denied h2', ['color: var(--text-heading) !important'])
    has('admin-hof-page) .dmg', ['color: var(--accent-dark) !important'])
  })

  it('回归：HoF Admin denied 提示段落 / 登录态 / 表格行分隔线 浅色 token + !important（Blocker 4；.denied/.login 选择器修正为真实类防不命中）', () => {
    has('admin-hof-page) .hof-admin-login', ['color: var(--text) !important'])
    has('admin-hof-page) .hof-admin-denied p', ['color: var(--text-sub) !important'])
    has('admin-hof-page) .hof-admin-table td', ['border-bottom-color: var(--border-light) !important'])
  })

  it('回归：选择 battle 后动态 .mcards/.mc 指标卡 浅色 token + !important（Blocker 2，防 App.vue 深色卡残留）', () => {
    has('.layout-data-workspace .mc', ['background: var(--bg-card) !important', 'border-color: var(--border) !important', 'box-shadow: var(--surface-shadow) !important'])
    has('.layout-data-workspace .mc .v', ['color: var(--text-heading) !important'])
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

  it('Version/Contact/Admin/Player Drawer 浅色 !important', () => {
    has('.version-page .ver', ['background: var(--bg-card) !important'])
    has('.contact-card', ['background: var(--bg-card) !important'])
    has('.admin-table th', ['background: var(--bg-card2) !important'])
    has('.player-drawer .pd-vehicle', ['background: var(--bg-card) !important', 'border-color: var(--border-light) !important'])
  })
})
