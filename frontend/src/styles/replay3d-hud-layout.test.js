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

  it('D) 其余 HUD 区域各自声明定位（阵容面板 / hud / banner）', () => {
    for (const selector of ['.team', '.hud', '.banner']) {
      expect(ruleFor(selector).body, `${selector} 缺少 position`).toContain('position: absolute')
    }
    expect(ruleFor('.team1').body, '.team1 缺少 left').toContain('left:')
    expect(ruleFor('.team2').body, '.team2 缺少 right').toContain('right:')
    expect(ruleFor('.team-unknown').body).toContain('left: 50%')
  })

  /**
   * 阵容布局回归：双方名单是**两块独立面板**（己方贴左 / 敌方贴右 + 未知阵营居中块）。
   * 曾经被合成一条通栏（两队塞进一个 flex 容器各占一半），视觉上"双方队伍栏并成一条"；
   * 这类改动不会让任何行为测试失败，所以在这里锁死结构。紧凑档打开时两块各占半宽——
   * 旧版两块 240px 绝对定位互相重叠盖住场景（审计 3D-15），不得回退成重叠。
   */
  it('F) 阵容是左右两块独立面板；紧凑档打开时各占半宽、不重叠', () => {
    const all = rules()
    const bodiesOf = (selector) => all.filter((r) => r.selector === selector).map((r) => r.body).join(' ')
    // 桌面：两块面板各自贴边、互不覆盖（team1 只声明 left、team2 只声明 right）
    expect(bodiesOf('.team1')).toContain('left: var(--space-2)')
    expect(bodiesOf('.team1')).not.toContain('right:')
    expect(bodiesOf('.team2')).toContain('right: var(--space-2)')
    expect(bodiesOf('.team2')).not.toContain('left:')
    // 不再有把两队装进一个容器的 .side 布局
    expect(all.some((r) => r.selector === '.side' || r.selector.endsWith(' .side'))).toBe(false)
    // 紧凑档：打开后左右各半（两侧边界都声明），互不重叠
    expect(bodiesOf('.pb-root.roster-open .team1')).toContain('right: 51%')
    expect(bodiesOf('.pb-root.roster-open .team2')).toContain('left: 51%')
    expect(bodiesOf('.pb-root.roster-open .team')).toContain('display: block')
  })

  it('E) 场景画布铺满并建立局部层叠上下文', () => {
    expect(ruleFor('.scene').body).toContain('position: absolute')
    expect(ruleFor('.scene').body).toContain('inset: 0')
    expect(ruleFor('.pb-root').body).toContain('isolation: isolate')
  })
})

/**
 * 触屏点击区域的源码级回归：CI 实测过 canonical SegmentedControl 的选项在 375px coarse
 * 容器里被 flex-shrink 压到 42px（低于 44px 下限）。组件行为测试无法覆盖 CSS 收缩，
 * 这里锁住「选项不参与收缩 + 容器横向滚动」，真几何由 test:browser-interaction 验证。
 */
describe('SegmentedControl 选项不得被 flex 压缩', () => {
  const source = readFileSync(fileURLToPath(new URL('../components/SegmentedControl.vue', import.meta.url)), 'utf8')
  const css = source.slice(source.indexOf('<style'), source.indexOf('</style>'))
  const bodyOf = (selector) => {
    const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
    if (!m) throw new Error(`rule not found: ${selector}`)
    return m[1].replace(/\s+/g, ' ').trim()
  }

  it('选项 flex: none（不收缩），容器横向滚动', () => {
    expect(bodyOf('.segmented-option')).toContain('flex: none')
    expect(bodyOf('.segmented-option')).not.toContain('flex: 1 1 0')
    expect(bodyOf('.segmented.is-scrollable')).toContain('overflow-x: auto')
  })

  it('coarse 档把选项点击区域抬到 --hit-min（token，不写死像素）', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toContain('min-height: var(--hit-min)')
    expect(coarse).toContain('min-width: var(--hit-min)')
  })
})
