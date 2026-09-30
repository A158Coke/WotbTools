// Agent 视觉面（列表页 + 3D/HUD 沉浸页）的配色源码契约守卫。
//
// 背景：这四个组件自上游独立 SPA 平移，用的是那套**深色单主题**的颜色名
// （--fg/--panel/--line/--muted/--danger/--dim/--txt…）。这些名字在本仓 token
// 体系里从未定义，于是 `var(--x, 深色 fallback)` 的 fallback 恒生效 = 等于写死
// 深色：浅色档（classic profile）下灰字落在白底上对比度仅 ~2.5:1（"文字发淡"），
// 面板/按钮/边框则是突兀深色块。当时没有任何测试覆盖 Agent 组件配色，坏了两档
// 主题也没人拦。
//
// 本文件固化两类契约：
//   A) Agent 组件不得引用"本仓任何地方都没定义"的 token（含 JS 内联样式）；
//   B) 沉浸页自建的配色 token，凡取值为颜色的，必须在 classic 档有成对浅色覆盖
//      ——否则浅色档会漏配，正是上面那类 bug 的复发路径。

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** 参与本契约的 Agent 视觉面文件（组件 + 场景内核里写内联样式的那份） */
const AGENT_FILES = {
  'AgentShots.vue': '../components/AgentShots.vue',
  'AgentTankopedia.vue': '../components/AgentTankopedia.vue',
  'AgentArmorView.vue': '../components/AgentArmorView.vue',
  'AgentReplay3D.vue': '../components/AgentReplay3D.vue',
  'tankViewer.js': '../scene/tankViewer.js',
}

/** 沉浸页：自建调色板的选择器 + 需要浅色覆盖的档位前缀 */
const IMMERSIVE = {
  'AgentArmorView.vue': { file: '../components/AgentArmorView.vue', selector: '.armor-view' },
  'AgentReplay3D.vue': { file: '../components/AgentReplay3D.vue', selector: '.pb-root' },
}

const CLASSIC_PREFIX = 'html[data-ui-profile="classic"]'
const REFERENCED = /var\(\s*(--[a-z0-9-]+)/gi
const DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi

/** 取出从 fragment 所在选择器起的第一个声明块里的 token 声明 */
function declarationsIn(source, fragment) {
  const at = source.indexOf(fragment)
  if (at < 0) return null
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  if (open < 0 || close < 0) return null
  const out = {}
  for (const m of source.slice(open + 1, close).matchAll(DECLARATION)) out[m[1]] = m[2].trim()
  return out
}

/** 取值看起来像颜色（半径/字体等非颜色 token 无需分档） */
const looksLikeColor = (value) => /#|rgb|hsl|gradient|color-mix/.test(value)

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
    // 因此可以合法继承该调色板（其余文件仍只认"仓库定义 + 自身定义"）。
    const armorPalette = new Set(
      Object.keys(declarationsIn(read(AGENT_FILES['AgentArmorView.vue']), '.armor-view') ?? {}),
    )

    for (const [label, rel] of Object.entries(AGENT_FILES)) {
      it(`${label} 不引用未定义 token`, () => {
        const src = read(rel)
        const selfDefined = new Set([...src.matchAll(DECLARATION)].map((m) => m[1]))
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
})
