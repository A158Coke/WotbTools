// 3D 回放面板的 HUD 定位契约（源码级）。
//
// 背景：`.panel` 从「绝对定位容器」收敛成纯视觉面（background / border / radius）之后，
// `.controls` 里的 `bottom` / `left` / `transform` 全部失效——元素掉回文档流，控制条不再贴在
// 场景底部。这类缺陷不会让任何单测失败，只会让线上 HUD 错位，所以在这里锁死：
//
//   A) 用了定位属性（top/bottom/left/right/inset）的规则必须自己声明 `position`；
//   B) `.panel` 只是视觉面，不得再隐含 `position: absolute`；
//   C) 底部控制条确实绝对定位并水平居中。
//
// 真几何（贴底 / 居中 / 不溢出）由 `npm run test:browser-interaction` 在真实 Chrome 里验证。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../components/Replay3DPane.vue', import.meta.url)), 'utf8')
const css = source.slice(source.indexOf('<style'), source.indexOf('</style>'))

/** 取最内层规则（选择器取块前最后一行，@media 内的规则同样被取出） */
function rules() {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? '',
    body: m[2].replace(/\s+/g, ' ').trim(),
  }))
}

function ruleFor(selector) {
  const rule = rules().find((r) => r.selector === selector)
  if (!rule) throw new Error(`rule not found: ${selector}`)
  return rule
}

/** 声明体里是否设置了某个属性 */
const has = (body, prop) => new RegExp(`(^|;|\\s)${prop}\\s*:`).test(body)

describe('Replay3DPane HUD 定位契约', () => {
  it('A) 用了 top/bottom/left/right/inset 的规则必须自己（或同选择器的其它规则）声明 position', () => {
    const all = rules()
    /** 同一选择器的任意规则里声明过 position 即可（例如 @media 里只覆盖 top/bottom） */
    const declaresPosition = (selector) =>
      all.some((r) => r.selector === selector && has(r.body, 'position'))
    const offenders = all
      .filter((r) => !r.selector.startsWith('@'))
      .filter((r) => ['top', 'bottom', 'left', 'right', 'inset'].some((p) => has(r.body, p)))
      .filter((r) => !declaresPosition(r.selector))
      .map((r) => r.selector)
    expect(offenders, '这些规则用了定位属性却没有 position（会掉回文档流）').toEqual([])
  })

  it('B) .panel 只是视觉面，不再隐含 position: absolute', () => {
    const panel = ruleFor('.panel')
    expect(has(panel.body, 'position')).toBe(false)
    expect(panel.body).toContain('background: var(--color-surface-2)')
  })

  it('C) 底部控制条绝对定位、贴底并水平居中', () => {
    const controls = ruleFor('.controls')
    expect(controls.body).toContain('position: absolute')
    expect(controls.body).toContain('bottom: var(--space-2)')
    expect(controls.body).toContain('left: 50%')
    expect(controls.body).toContain('transform: translateX(-50%)')
    expect(controls.body).toContain('z-index: var(--pb-z-hud)')
  })

  it('D) 其余 HUD 区域各自声明定位（roster / hud / banner）', () => {
    for (const selector of ['.roster', '.hud', '.banner']) {
      expect(ruleFor(selector).body, `${selector} 缺少 position`).toContain('position: absolute')
    }
  })

  it('E) 场景画布铺满并建立局部层叠上下文', () => {
    expect(ruleFor('.scene').body).toContain('position: absolute')
    expect(ruleFor('.scene').body).toContain('inset: 0')
    expect(ruleFor('.pb-root').body).toContain('isolation: isolate')
  })
})
