// Agent 视觉面（3D / 射击回放面板 + 装甲查看器 + 坦克百科）的配色源码契约守卫。
//
// 背景：这些组件自上游独立 SPA 平移，用的是那套**深色单主题**的颜色名
// （--fg/--panel/--line/--muted/--danger/--dim…）。这些名字在本仓 token 体系里从未定义，
// 于是 `var(--x, 深色 fallback)` 的 fallback 恒生效 = 等于写死深色：浅色档（寒冬 winter）
// 下灰字落在白底上对比度仅 ~2.6:1（"文字发淡"），面板/按钮/边框则是突兀深色块。
//
// 3D / 射击回放面板和装甲查看器已迁到设计语言语义 token，两档主题共用同一份规则。
// 装甲查看器保留的短名仅为全局 token 的别名，供场景脚本的内联样式继承。本文件固化三类契约：
//   1) var() 完整性 + 别名契约 + 回放面板不自建调色板（合并为一条数据驱动断言，
//      token 目录即数据源；stylelint 无法表达正向 token 映射，见 #827）；
//   2) token 自检 meta（防契约测试自身空跑）；
//   3) tankViewer 内联标记色白名单（与 three.js 标记材质一一对应，不能 token 化）。
//
// 裸色（#hex/rgb/hsl）禁令已由 stylelint（color-no-hex + function-disallowed-list +
// declaration-strict-value）在非 legacy 文件上接管，不再在 vitest 里逐文件重扫。

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 参与契约的视觉面文件 */
const AGENT_FILES = {
  'Replay3DPane.vue': '../components/Replay3DPane.vue',
  'ReplayShotsPane.vue': '../components/ReplayShotsPane.vue',
  'AgentTankopedia.vue': '../components/AgentTankopedia.vue',
  'TankCatalogMenu.vue': '../components/TankCatalogMenu.vue',
  'AgentArmorView.vue': '../components/AgentArmorView.vue',
  'tankViewer.js': '../scene/tankViewer.js',
}

/**
 * tankViewer 内联色白名单：与 three.js 标记材质 / 图例圆点**一一对应**的调色板
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

const LIGHT_PREFIX = ':root[data-ui-profile="winter"]'
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

describe('Agent 视觉面配色契约', () => {
  // 含设计语言 token 目录（styles/tokens/*.css：--header-h / --color-* 等）
  const cssFiles = [
    ...readdirSync(stylesDir).filter((f) => f.endsWith('.css')),
    ...readdirSync(stylesDir + 'tokens/').filter((f) => f.endsWith('.css')).map((f) => 'tokens/' + f),
  ]
  const repoDefined = new Set(
    cssFiles.flatMap((f) => [...readFileSync(stylesDir + f, 'utf8').matchAll(DECLARATION)].map((m) => m[1])),
  )

  it('样式源里确实解析到了 token（防契约测试自身空跑）', () => {
    expect(repoDefined.size).toBeGreaterThan(80)
  })

  // var() 完整性 ×6 + 回放面板不自建调色板 + 装甲查看器别名契约：合并为一条断言，
  // 以 token 目录为数据源逐文件归集违规——stylelint（declaration-strict-value/color-no-hex）
  // 只能禁值，表达不了「引用的 token 必须有定义」与「别名必须指向全局 token」。
  it('组件只引用已定义 token、回放面板不自建调色板、装甲查看器别名指向全局 token', () => {
    const violations = []

    // tankViewer.js 无样式块：它的面板 DOM 渲染在 .armor-view 子树内，
    // 因此可以合法继承这些语义别名（其余文件仍只认"仓库定义 + 自身**默认**档定义"）。
    const armorPalette = new Set(
      Object.keys(declarationsIn(read(AGENT_FILES['AgentArmorView.vue']), '.armor-view') ?? {}),
    )

    for (const [label, rel] of Object.entries(AGENT_FILES)) {
      const src = read(rel)
      // 只统计浅色档覆盖块**之前**的声明：仅在浅色档定义的 token 不算"有定义"
      // （否则会把"默认档缺失、只有浅色档有"的 token 误判为合法）
      const lightAt = src.indexOf(LIGHT_PREFIX)
      const defaultPart = lightAt > 0 ? src.slice(0, lightAt) : src
      const selfDefined = new Set([...defaultPart.matchAll(DECLARATION)].map((m) => m[1]))
      const permitted = label === 'tankViewer.js'
        ? new Set([...repoDefined, ...selfDefined, ...armorPalette])
        : new Set([...repoDefined, ...selfDefined])
      const undefinedRefs = [...new Set([...src.matchAll(REFERENCED)].map((m) => m[1]))]
        .filter((t) => !permitted.has(t))
      if (undefinedRefs.length > 0) {
        violations.push(`${label} 引用了仓库与自身都未定义的 token（浅色档会落到深色 fallback）: ${undefinedRefs.join(', ')}`)
      }

      if (label === 'Replay3DPane.vue' || label === 'ReplayShotsPane.vue') {
        const colorTokens = [...stripComments(src).matchAll(DECLARATION)]
          .filter((m) => looksLikeColor(m[2]))
          .map((m) => m[1])
        if (colorTokens.length > 0) violations.push(`${label} 仍在自建颜色 palette（应只用语义色 token）: ${colorTokens.join(', ')}`)
      }

      if (label === 'AgentArmorView.vue') {
        const aliases = declarationsIn(src, '.armor-view')
        if (!aliases || Object.keys(aliases).length === 0) {
          violations.push('AgentArmorView.vue 未解析到装甲查看器别名块（别名契约空跑）')
        } else {
          for (const [name, value] of Object.entries(aliases)) {
            if (BARE_COLOR.test(value)) violations.push(`AgentArmorView.vue ${name} 自建颜色值或深色 fallback`)
            const refs = [...value.matchAll(REFERENCED)].map((m) => m[1])
            if (refs.length === 0) violations.push(`AgentArmorView.vue ${name} 未引用全局 token`)
            const foreign = refs.filter((token) => !repoDefined.has(token))
            if (foreign.length > 0) violations.push(`AgentArmorView.vue ${name} 引用了非全局 token: ${foreign.join(', ')}`)
          }
        }
        if (declarationsIn(src, `${LIGHT_PREFIX} .armor-view`) !== null) {
          violations.push('AgentArmorView.vue 存在独立浅色档覆盖（主题映射应由全局 Profile token 所有）')
        }
      }
    }
    expect(violations, 'Agent 视觉面 token 契约违规').toEqual([])
  })

  it('tankViewer 内联色只用标记/图例白名单', () => {
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
