// @vitest-environment happy-dom
/**
 * Vehicle label 的垂直信息层级与两个 combat indicator 的尺寸 ownership。
 *
 * Contract（固定，不得重排）：
 *
 *   PlayerName → TankName → HP → Reload
 *
 * HP 是主要 combat state（更宽、更厚），reload 是最下方次级瞬时状态（更短、更细）。
 * 2D 与 3D 共用本组件，所以这里锁的就是两个 renderer 的共同呈现。
 *
 * 为什么用 `?raw` 源码断言量尺寸：happy-dom 不跑布局，`getComputedStyle` 拿不到
 * token 解析后的像素值。尺寸的单一事实源是 token + `var()` 引用，直接在源码上断言
 * 「谁引用哪个 token」既确定又不会因为环境差异变成假绿。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mount } from '@vue/test-utils'
import PlaybackVehicleLabel from './PlaybackVehicleLabel.vue'
import labelSource from './PlaybackVehicleLabel.vue?raw'
// CSS 走 fs 而不是 `?raw`：vitest 的 CSS 处理链会把 stylesheet 的 `?raw` 变成空串。
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const scaleTokens = read('../styles/tokens/scale.css')

const mountLabel = (props = {}) => mount(PlaybackVehicleLabel, {
  props: {
    playerName: 'You',
    tankName: 'Maus',
    friendly: true,
    showPlayerName: true,
    showTankName: true,
    showHp: true,
    showReload: true,
    hp: { current: 1250, pct: 76, state: 'CURRENT' },
    reload: [{ state: 'full', progress: 1 }],
    ...props,
  },
})

/** 组件源码里某条**独立**规则块的正则（选择器必须自成一行的开头，避免误配共享规则）。 */
const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(labelSource)
  return match ? match[1] : null
}
/** tokens/scale.css 里某个自定义属性的声明值。 */
const tokenValue = (name) => {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(scaleTokens)
  return match ? match[1].trim() : null
}
/** 把 `var(--space-1)` / `calc(var(--space-1) * 2)` 这类表达式解析成 px。 */
const SPACE_PX = { '--space-0': 0, '--space-1': 4, '--space-2': 8, '--space-3': 12, '--space-4': 16 }
function resolvePx(expression) {
  if (!expression) return null
  const body = expression.trim()
  const calc = /^calc\(var\((--space-\d)\)\s*\*\s*([\d.]+)\)$/.exec(body)
  if (calc) return SPACE_PX[calc[1]] * Number(calc[2])
  const single = /^var\((--space-\d)\)$/.exec(body)
  if (single) return SPACE_PX[single[1]]
  return null
}

describe('PlaybackVehicleLabel 垂直层级', () => {
  it('DOM 顺序严格是 PlayerName → TankName → HP → Reload', () => {
    const wrapper = mountLabel()
    const order = [...wrapper.element.querySelectorAll('[data-test]')]
      .map(el => el.getAttribute('data-test'))
      .filter(id => ['pb-label-player', 'pb-label-tank', 'pb-hp-hud', 'pb-reload'].includes(id))
    expect(order).toEqual(['pb-label-player', 'pb-label-tank', 'pb-hp-hud', 'pb-reload'])
  })

  it('HP 与 Reload 同属 combat-state 块，且 reload 在 HP 之后', () => {
    const wrapper = mountLabel()
    const block = wrapper.get('.pb-combat-state')
    // 只看块的直接子级，忽略 HP 内部更深层的 pb-hp-num / pb-hp-bar 等
    const ids = [...block.element.children].map(el => el.getAttribute('data-test'))
    expect(ids).toEqual(['pb-hp-hud', 'pb-reload'])
    // 身份两行不在 combat block 里：它们是独立的信息层级
    expect(block.find('[data-test="pb-label-player"]').exists()).toBe(false)
    expect(block.find('[data-test="pb-label-tank"]').exists()).toBe(false)
  })

  it('combat block 内部间距比「身份块 → combat block」更紧', () => {
    const identityGap = resolvePx(ruleBody('.vehicle-label')?.match(/gap:\s*([^;]+);/)?.[1])
    const combatGap = resolvePx(ruleBody('.pb-combat-state')?.match(/gap:\s*([^;]+);/)?.[1])
    expect(identityGap).toBe(8)
    expect(combatGap).toBe(4)
    expect(combatGap).toBeLessThan(identityGap)
  })

  it('条件渲染没有被重排破坏：关掉的项整块不渲染', () => {
    expect(mountLabel({ showHp: false }).find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(mountLabel({ showReload: false }).find('[data-test="pb-reload"]').exists()).toBe(false)
    expect(mountLabel({ showPlayerName: false }).find('[data-test="pb-label-player"]').exists()).toBe(false)
    expect(mountLabel({ showTankName: false }).find('[data-test="pb-label-tank"]').exists()).toBe(false)
    // 身份两行都关掉时 .pb-labels 整块不存在，但 combat 块仍在
    const bare = mountLabel({ showPlayerName: false, showTankName: false })
    expect(bare.find('.pb-labels').exists()).toBe(false)
    expect(bare.find('[data-test="pb-hp-hud"]').exists()).toBe(true)
    expect(bare.find('[data-test="pb-reload"]').exists()).toBe(true)
  })

  it('destroyed：不渲染 reload；existing 删除线语义保留', () => {
    const destroyed = mountLabel({ destroyed: true })
    expect(destroyed.find('[data-test="pb-reload"]').exists()).toBe(false)
    expect(destroyed.find('[data-test="pb-hp-hud"]').exists()).toBe(false)
    expect(destroyed.get('.pb-labels').exists()).toBe(true)
    expect(destroyed.classes()).toContain('label-destroyed')
  })

  it('last-known：只弱化文字与 HP 块，不做整块 opacity', () => {
    const lastKnown = mountLabel({ lastKnown: true })
    expect(lastKnown.classes()).toContain('label-last-known')
    // 整块 opacity 会把背景一起淡化——那条契约被重写过一次，这里继续锁住
    expect(labelSource).not.toMatch(/\.label-last-known \.vehicle-label \{[^}]*opacity/)
    expect(labelSource).toMatch(/\.label-last-known \.pb-label-tank,\s*\.label-last-known \.pb-label-player \{ opacity: \.65; \}/)
    expect(labelSource).toMatch(/\.label-last-known \.pb-hp-hud \{ opacity: \.55; \}/)
  })

  it('reload 只在 friendly 且有 shell 数据时出现', () => {
    expect(mountLabel({ friendly: false }).find('[data-test="pb-reload"]').exists()).toBe(false)
    expect(mountLabel({ friendly: null }).find('[data-test="pb-reload"]').exists()).toBe(false)
    expect(mountLabel({ reload: [] }).find('[data-test="pb-reload"]').exists()).toBe(false)
    expect(mountLabel({ reload: null }).find('[data-test="pb-reload"]').exists()).toBe(false)
  })
})

describe('PlaybackVehicleLabel indicator 尺寸 ownership', () => {
  it('HP 与 reload 各自消费自己的宽度 token，不再共用通用 bar token', () => {
    const hpBar = ruleBody('.pb-hp-bar')
    const reloadBar = ruleBody('.reload-bar')
    expect(hpBar).toContain('width: var(--pb-label-hp-bar-width)')
    expect(reloadBar).toContain('width: var(--pb-label-reload-bar-width)')
    // 通用 token 已废除：组件里不得再出现
    expect(labelSource).not.toContain('--pb-label-bar-width')
    expect(scaleTokens).not.toContain('--pb-label-bar-width')
  })

  it('reload 比 HP 短', () => {
    const hpWidth = parseFloat(tokenValue('--pb-label-hp-bar-width'))
    const reloadWidth = parseFloat(tokenValue('--pb-label-reload-bar-width'))
    expect(Number.isFinite(hpWidth) && Number.isFinite(reloadWidth)).toBe(true)
    expect(reloadWidth).toBeLessThan(hpWidth)
  })

  it('reload 比 HP 细', () => {
    const hpHeight = resolvePx(ruleBody('.pb-hp-bar')?.match(/height:\s*([^;]+);/)?.[1])
    const reloadHeight = parseFloat(tokenValue('--pb-label-reload-bar-height'))
    expect(hpHeight).toBe(4)
    expect(Number.isFinite(reloadHeight)).toBe(true)
    expect(reloadHeight).toBeLessThan(hpHeight)
  })

  it('两个 token 都是语义 token，组件里没有散落的硬编码尺寸', () => {
    expect(tokenValue('--pb-label-hp-bar-width')).toMatch(/px$/)
    expect(tokenValue('--pb-label-reload-bar-width')).toMatch(/px$/)
    expect(tokenValue('--pb-label-reload-bar-height')).toMatch(/px$/)
    // 组件只允许通过 token 表达尺寸：不得出现 width/height 的裸 px
    expect(labelSource).not.toMatch(/\.reload-bar \{[^}]*height:\s*\d+px/)
    expect(labelSource).not.toMatch(/\.pb-hp-bar \{[^}]*width:\s*\d+px/)
  })

  it('没有靠 opacity 掩盖 reload 的视觉权重', () => {
    const reloadBar = ruleBody('.reload-bar')
    const shell = ruleBody('.reload-shell')
    expect(reloadBar).not.toMatch(/opacity/)
    expect(shell).not.toMatch(/opacity/)
  })
})

describe('PlaybackVehicleLabel magazine segmentation', () => {
  const threeShells = [
    { state: 'full', progress: 1 },
    { state: 'loading', progress: 0.5 },
    { state: 'empty', progress: 0 },
  ]

  it('shell 数量与输入 reload.length 一致，并保留每段 state', () => {
    const wrapper = mountLabel({ reload: threeShells })
    const shells = wrapper.findAll('.reload-shell')
    expect(shells).toHaveLength(3)
    expect(shells.map(s => s.attributes('data-state'))).toEqual(['full', 'loading', 'empty'])
  })

  it('loading 段按 progress 显示部分填充，full / empty 是 0 与 100', () => {
    const wrapper = mountLabel({ reload: threeShells })
    const widths = wrapper.findAll('.reload-fill').map(f => f.attributes('style'))
    expect(widths[0]).toContain('width: 100%')
    expect(widths[1]).toContain('width: 50%')
    expect(widths[2]).toContain('width: 0%')
  })

  it('locked 段仍由 data-state 区分，不需要额外 class', () => {
    const wrapper = mountLabel({ reload: [{ state: 'locked', progress: 1 }] })
    expect(wrapper.get('.reload-shell').attributes('data-state')).toBe('locked')
    expect(labelSource).toMatch(/\.reload-shell\[data-state="locked"\]/)
  })
})
