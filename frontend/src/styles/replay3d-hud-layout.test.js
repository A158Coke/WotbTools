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

  it('D) HUD / banner 各自声明定位；三段式下 HUD 与传输控件只占中间一栏', () => {
    for (const selector of ['.hud', '.banner']) {
      expect(ruleFor(selector).body, `${selector} 缺少 position`).toContain('position: absolute')
    }
    // 两侧车道把中间一栏让给 HUD 与传输控件：左右偏移 = 外边距 + 车道宽 + 列间距
    const centre = ruleFor('.pb-root.roster-side .controls').body
    expect(centre).toContain('position: absolute')
    expect(centre).toContain('left: calc(var(--space-2) + var(--pb-lane-w) + var(--space-2))')
    expect(centre).toContain('right: calc(var(--space-2) + var(--pb-lane-w) + var(--space-2))')
    // Stage 之下为传输控件让出的高度来自实测（RO 写入 --pb-controls-h），不写死像素
    expect(ruleFor('.pb-root.roster-side > .pb-stage').body).toContain('var(--pb-controls-h)')
  })

  it('E) 场景画布铺满并建立局部层叠上下文', () => {
    expect(ruleFor('.scene').body).toContain('position: absolute')
    expect(ruleFor('.scene').body).toContain('inset: 0')
    expect(ruleFor('.pb-root').body).toContain('isolation: isolate')
  })

  /**
   * 阵容布局回归：双方名单在**左右两条侧边车道**上（未知阵营归左车道、常驻车道底部）。
   * 曾经被合成一条通栏（两队塞进一个 flex 容器），也曾把 unknown 放进中央车道与 HUD 相撞
   * （review blocker）；这类改动不会让行为测试失败，所以在这里锁结构。真实几何安全由
   * browser-workspace-interaction 的 roster 几何场景在真实 Chrome 里证明，这里只是 smoke。
   */
  it('F) 阵容是左右两条物理车道（网格第 1 / 第 3 列）；没有临时名册面；竖屏走纵向流', () => {
    const all = rules()
    const bodiesOf = (selector) => all.filter((r) => r.selector === selector).map((r) => r.body).join(' ')
    // 三段式：Team 1 恒在第 1 列、Team 2 恒在第 3 列（与录像者属于哪队无关）
    expect(bodiesOf('.pb-root.roster-side .side-left')).toContain('grid-column: 1')
    expect(bodiesOf('.pb-root.roster-side .side-right')).toContain('grid-column: 3')
    expect(bodiesOf('.pb-root.roster-side')).toContain('grid-template-columns: var(--pb-lane-w) minmax(0, 1fr) var(--pb-lane-w)')
    // unknown 不在中央车道：任何规则不得把它居中（left: 50% / translateX(-50%)）
    const unknown = all.filter((r) => r.selector.includes('.team-unknown')).map((r) => r.body).join(' ')
    expect(unknown).not.toContain('left: 50%')
    expect(unknown).not.toContain('translateX(-50%)')
    // 不再有把两队装进一个容器的 .side 布局（旧通栏结构），也不再有临时名册面
    expect(all.some((r) => r.selector === '.side' || r.selector.endsWith(' .side'))).toBe(false)
    expect(css).not.toContain('.transient')
    expect(css).not.toContain('roster-surface-header')
    // 竖屏纵向流：车道是流内内容块，不是绝对定位的侧栏
    expect(bodiesOf('.portrait-flow .team-lane')).toContain('position: static')
    expect(bodiesOf('.pb-root.portrait-flow')).toContain('flex-direction: column')
    // 车道与队伍的**基础**规则都不是滚动盒（审计 BZ-13：名册里不允许嵌套滚动条）
    for (const selector of ['.team-lane', '.team']) {
      const overflow = /overflow(-y)?:\s*([a-z]+)/.exec(bodiesOf(selector))
      expect(overflow?.[2] ?? 'visible').not.toMatch(/auto|scroll/)
    }
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
