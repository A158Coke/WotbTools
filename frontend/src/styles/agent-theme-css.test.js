// Agent 视觉面（列表页 + 3D/HUD 沉浸页）的配色源码契约守卫。
//
// 背景：这四个组件自上游独立 SPA 平移，用的是那套**深色单主题**的颜色名
// （--fg/--panel/--line/--muted/--danger/--dim/--txt…）。这些名字在本仓 token
// 体系里从未定义，于是 `var(--x, 深色 fallback)` 的 fallback 恒生效 = 等于写死
// 深色：浅色档（classic profile）下灰字落在白底上对比度仅 ~2.6:1（"文字发淡"），
// 面板/按钮/边框则是突兀深色块。当时没有任何测试覆盖 Agent 组件配色，坏了两档
// 主题也没人拦。
//
// 复审进一步指出：只查 `var(--x)` 是否定义**不够**——裸的 `background: rgba(10,13,17,.94)`
// 或 `color: #ffcf5c` 同样绕过主题（AgentReplay3D 的整页 .loader overlay 就是这样
// 漏掉的：全屏 UI 却写死深色，浅色档根本看不到底下的 --root-bg）。
//
// 因此本文件固化四类契约：
//   A) Agent 组件不得引用"本仓任何地方都没定义"的 token（含 JS 内联样式）；
//   B) 沉浸页自建调色板里每个**颜色** token，必须在 classic 档有成对覆盖；
//   C) 沉浸页样式块里不得出现裸色（#hex/rgb/rgba/hsl），白名单只放"非主题色"——
//      即 three.js 场景底/标记图例这类数据可视化色；
//   D) tankViewer 的 JS 内联色只允许白名单里的标记/图例色。

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 参与本契约的 Agent 视觉面文件 */
const AGENT_FILES = {
  'AgentShots.vue': '../components/AgentShots.vue',
  'AgentTankopedia.vue': '../components/AgentTankopedia.vue',
  'AgentArmorView.vue': '../components/AgentArmorView.vue',
  'AgentReplay3D.vue': '../components/AgentReplay3D.vue',
  'tankViewer.js': '../scene/tankViewer.js',
}

/** 沉浸页：自建调色板选择器 */
const IMMERSIVE = {
  'AgentArmorView.vue': { file: '../components/AgentArmorView.vue', selector: '.armor-view' },
  'AgentReplay3D.vue': { file: '../components/AgentReplay3D.vue', selector: '.pb-root' },
}

/**
 * C) 样式块里允许出现裸色的选择器（**非主题色**，硬编码是对的）。
 * 每项都必须写明理由；往里加东西前先问：这是数据/场景色，还是本该跟随主题的 UI 色？
 */
const BARE_COLOR_SELECTOR_ALLOWLIST = {
  'AgentArmorView.vue': [
    '#canvas-container', // three.js 视口底色（游戏视觉，见 classic-profile 的同类约定）
  ],
  'AgentReplay3D.vue': [], // 3D 场景由 three.js 画进 canvas，CSS 层不应有裸色
}

/**
 * D) tankViewer 内联色白名单：与 three.js 标记材质 / 图例圆点**一一对应**的调色板
 * （改这里必须同步改标记材质，故不能 token 化）。
 */
const MARKER_COLOR_ALLOWLIST = [
  '#ff6622', // LaunchPoint / 倒车
  '#00ccff', // 速度向量 / 位移方向 / tick 路径
  '#00ff00', // 弹道弦
  '#ffcc00', // 落点 / 服务器终点
  '#ffaa00', // 弹跳点
  '#ff2222', // 弹着点
  '#00aaff', // 基准点·射手
  '#00ffcc', // 基准点·受击
  '#33ff66', // 履带朝向
  '#ffdd33', // 转向
  '#cc66ff', // 炮闩（图例/调试点色；时间滑块已另用 --scrub）
  '#fff',    // 偏差线
]

const CLASSIC_PREFIX = 'html[data-ui-profile="classic"]'
const REFERENCED = /var\(\s*(--[a-z0-9-]+)/gi
const DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
const BARE_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/
/** 取值看起来像颜色（半径/字体等非颜色 token 无需分档） */
const looksLikeColor = (value) => /#|rgb|hsl|gradient|color-mix/.test(value)

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function styleBlockOf(src) {
  const m = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return m ? stripComments(m[1]) : ''
}

/** 取出从 fragment 所在选择器起的第一个声明块里的 token 声明 */
function declarationsIn(rawSource, fragment) {
  const source = stripComments(rawSource)
  const at = source.indexOf(fragment)
  if (at < 0) return null
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  if (open < 0 || close < 0) return null
  const out = {}
  for (const m of source.slice(open + 1, close).matchAll(DECLARATION)) out[m[1]] = m[2].trim()
  return out
}

/** 简单规则切分（本仓这些样式块无 @media 嵌套；有嵌套时会在测试里显式失败） */
function rulesIn(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? '',
    body: m[2],
  }))
}

describe('Agent 视觉面配色契约', () => {
  const repoDefined = new Set(
    readdirSync(stylesDir)
      .filter((f) => f.endsWith('.css'))
      .flatMap((f) => [...readFileSync(stylesDir + f, 'utf8').matchAll(DECLARATION)].map((m) => m[1])),
  )

  it('样式源里确实解析到了 token（防契约测试自身空跑）', () => {
    expect(repoDefined.size).toBeGreaterThan(80)
  })

  describe('A) 组件只引用已定义的 token', () => {
    // tankViewer.js 无样式块：它的面板 DOM 渲染在 .armor-view 子树内，
    // 因此可以合法继承该调色板（其余文件仍只认"仓库定义 + 自身**默认**档定义"）。
    const armorPalette = new Set(
      Object.keys(declarationsIn(read(AGENT_FILES['AgentArmorView.vue']), '.armor-view') ?? {}),
    )

    for (const [label, rel] of Object.entries(AGENT_FILES)) {
      it(`${label} 不引用未定义 token`, () => {
        const src = read(rel)
        // 只统计 classic 覆盖块**之前**的声明：仅在浅色档定义的 token 不算"有定义"
        // （否则 A 会把"默认档缺失、只有 classic 有"的 token 误判为合法）
        const classicAt = src.indexOf(CLASSIC_PREFIX)
        const defaultPart = classicAt > 0 ? src.slice(0, classicAt) : src
        const selfDefined = new Set([...defaultPart.matchAll(DECLARATION)].map((m) => m[1]))
        const permitted = label === 'tankViewer.js'
          ? new Set([...repoDefined, ...selfDefined, ...armorPalette])
          : new Set([...repoDefined, ...selfDefined])
        const undefinedRefs = [...new Set([...src.matchAll(REFERENCED)].map((m) => m[1]))]
          .filter((t) => !permitted.has(t))
        expect(
          undefinedRefs,
          `${label} 引用了仓库与自身都未定义的 token（浅色档会落到深色 fallback）`,
        ).toEqual([])
      })
    }
  })

  describe('B) 沉浸页自建调色板在 classic 档有成对覆盖', () => {
    for (const [label, { file, selector }] of Object.entries(IMMERSIVE)) {
      it(`${label} 的每个颜色 token 都有浅色覆盖`, () => {
        const src = read(file)
        const dark = declarationsIn(src, selector)
        expect(dark, `${label} 未解析到 ${selector} 调色板块`).not.toBeNull()
        const classic = declarationsIn(src, `${CLASSIC_PREFIX} ${selector}`)
        expect(classic, `${label} 缺少 ${CLASSIC_PREFIX} ${selector} 浅色覆盖块`).not.toBeNull()

        const missing = Object.entries(dark)
          .filter(([, value]) => looksLikeColor(value))
          .map(([name]) => name)
          .filter((name) => !(name in classic))
        expect(missing, `${label} 的颜色 token 在 classic 档缺覆盖（浅色档会漏配）`).toEqual([])
      })
    }
  })

  describe('C) 沉浸页样式块不留裸色（除白名单的非主题色）', () => {
    for (const [label, { file }] of Object.entries(IMMERSIVE)) {
      it(`${label} 的规则只经 token 取色`, () => {
        const css = styleBlockOf(read(file))
        expect(css, `${label} 未解析到样式块`).not.toBe('')
        expect(css.includes('@media'), `${label} 样式块出现 @media 嵌套，需扩展本测试的规则切分`).toBe(false)

        const allowed = BARE_COLOR_SELECTOR_ALLOWLIST[label] ?? []
        const offenders = []
        for (const { selector, body } of rulesIn(css)) {
          if (allowed.some((frag) => selector.includes(frag))) continue
          for (const decl of body.split(';')) {
            const [prop, ...rest] = decl.split(':')
            const value = rest.join(':')
            if (!prop || !value) continue
            if (prop.trim().startsWith('--')) continue   // 自定义属性=token 定义，允许放颜色
            if (BARE_COLOR.test(value)) offenders.push(`${selector} { ${prop.trim()}:${value.trim()} }`)
          }
        }
        expect(
          offenders,
          `${label} 的 UI/HUD 规则里出现裸色——浅色档不会跟随主题。请 token 化；`
          + '确属数据/场景色时加入 BARE_COLOR_SELECTOR_ALLOWLIST 并写明理由',
        ).toEqual([])
      })
    }
  })

  describe('D) tankViewer 内联色只用标记/图例白名单', () => {
    it('内联 color 均为 three.js 标记/图例色', () => {
      const src = read(AGENT_FILES['tankViewer.js'])
      const used = [...new Set([...src.matchAll(/color:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => m[1].toLowerCase()))]
      // 白名单同样按小写比较（源码里大小写混用）
      const allowed = new Set(MARKER_COLOR_ALLOWLIST.map((c) => c.toLowerCase()))
      const offenders = used.filter((c) => !allowed.has(c))
      expect(
        offenders,
        'tankViewer 内联色出现白名单外的裸色——HUD 文本请用 token（var(--muted)/var(--blue)…），'
        + '确属标记色则加入 MARKER_COLOR_ALLOWLIST 并与标记材质同步',
      ).toEqual([])
    })
  })
})
