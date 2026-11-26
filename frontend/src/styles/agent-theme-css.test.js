
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const AGENT_FILES = {
  'Replay3DPane.vue': '../components/Replay3DPane.vue',
  'ReplayShotsPane.vue': '../components/ReplayShotsPane.vue',
  'AgentTankopedia.vue': '../components/AgentTankopedia.vue',
  'TankCatalogMenu.vue': '../components/TankCatalogMenu.vue',
  'AgentArmorView.vue': '../components/AgentArmorView.vue',
  'tankViewer.js': '../scene/tankViewer.js',
}

const MARKER_COLOR_ALLOWLIST = [
  '#ff6622',
  '#00ccff',
  '#00ff00',
  '#ffcc00',
  '#ffaa00',
  '#ff2222',
  '#00aaff',
  '#00ffcc',
  '#33ff66',
  '#ffdd33',
  '#cc66ff',
  '#fff',    // 偏差线
]

const LIGHT_PREFIX = ':root[data-ui-profile="winter"]'
const REFERENCED = /var\(\s*(--[a-z0-9-]+)/gi
const DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
const BARE_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/
const looksLikeColor = (value) => /#|rgb|hsl|gradient|color-mix/.test(value)

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function styleBlockOf(src) {
  const m = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return m ? stripComments(m[1]) : ''
}

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

  it('组件只引用已定义 token、回放面板不自建调色板、装甲查看器别名指向全局 token', () => {
    const violations = []

    const armorSource = [
      AGENT_FILES['AgentArmorView.vue'],
      '../components/agent-armor-view.css',
      '../components/agent-armor-view-responsive.css',
      '../components/agent-armor-view-hud-responsive.css',
    ].map((rel) => read(rel)).join('\n')
    const armorPalette = new Set(
      Object.keys(declarationsIn(armorSource, '.armor-view') ?? {}),
    )

    for (const [label, rel] of Object.entries(AGENT_FILES)) {
      const src = label === 'AgentArmorView.vue' ? armorSource : read(rel)
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
    const allowed = new Set(MARKER_COLOR_ALLOWLIST.map((c) => c.toLowerCase()))
    const offenders = used.filter((c) => !allowed.has(c))
    expect(
      offenders,
      'tankViewer 内联色出现白名单外的裸色——HUD 文本请用 token（var(--muted)/var(--blue)…），'
      + '确属标记色则加入 MARKER_COLOR_ALLOWLIST 并与标记材质同步',
    ).toEqual([])
  })
})
