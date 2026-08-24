// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerRatingRadar from './PlayerRatingRadar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key })
}))

/** 构造 metrics 轴数据（review PR#134 BLOCKER 6.14：组件只消费 normalized，不负责任何业务公式）。 */
function metric(key, label, rawValue, normalized, displayValue, available = true) {
  return { key, label, rawValue, normalized, displayValue, available }
}

const SEVEN = [
  metric('league_damage_score', '伤害', 200, 0.5, '200 / 400 · 50%'),
  metric('league_assist_score', '助攻', 50, 0.5, '50 / 100 · 50%'),
  metric('league_kill_score', '击杀', 50, 0.5, '50 / 100 · 50%'),
  metric('league_exchange_score', '换血', 75, 0.5, '75 / 150 · 50%'),
  metric('league_blocked_score', '阻挡', 25, 0.5, '25 / 50 · 50%'),
  metric('league_survival_score', '存活/互换', 50, 0.5, '50 / 100 · 50%'),
  metric('league_shooting_score', '射击', 50, 0.5, '50 / 100 · 50%'),
]

function mountRadar(metrics) {
  return mount(PlayerRatingRadar, {
    props: { metrics: metrics || SEVEN },
    global: { mocks: { $t: key => key } }
  })
}

describe('PlayerRatingRadar (plan §10/§24; review PR#134 BLOCKER 6.14)', () => {
  it('renders axes per metrics length (default 7)', () => {
    const wrapper = mountRadar()
    expect(wrapper.findAll('.radar-axis')).toHaveLength(7)
    expect(wrapper.findAll('.radar-dot')).toHaveLength(7)
    expect(wrapper.findAll('.radar-label')).toHaveLength(7)
    expect(wrapper.find('.radar-data').exists()).toBe(true)
  })

  it('custom selection: axisCount = metrics.length, order follows metrics array (BLOCKER 6.2/6.3)', () => {
    const custom = [
      metric('kast', 'KAST', 78.4, 0.784, '78.4%'),
      metric('contribution', '贡献度', 22.4, 0.224, '22.4%'),
      metric('league_damage_score', '伤害', 342, 0.855, '342 / 400 · 85.5%'),
      metric('league_kill_score', '击杀', 70, 0.7, '70 / 100 · 70%'),
    ]
    const wrapper = mountRadar(custom)
    expect(wrapper.findAll('.radar-axis')).toHaveLength(4)
    const labels = wrapper.findAll('.radar-label').map(n => n.text())
    expect(labels).toEqual(['KAST', '贡献度', '伤害', '击杀'])
  })

  it('normalizes by score/max: 200/400 and 50/100 both map to 50% radius (plan §24)', () => {
    const wrapper = mountRadar()
    const pts = wrapper.find('.radar-data').attributes('points').split(' ').map(p => p.split(',').map(Number))
    const CENTER = 150
    const dist0 = Math.hypot(pts[0][0] - CENTER, pts[0][1] - CENTER)
    const dist1 = Math.hypot(pts[1][0] - CENTER, pts[1][1] - CENTER)
    expect(dist0).toBeCloseTo(60, 1)
    expect(dist1).toBeCloseTo(60, 1) // 50/100 = 50% → 与 200/400 半径一致
  })

  it('full scores map to outer ring radius', () => {
    const wrapper = mountRadar(SEVEN.map(m => ({ ...m, rawValue: m.rawValue * 2, normalized: 1 })))
    const pts = wrapper.find('.radar-data').attributes('points').split(' ').map(p => p.split(',').map(Number))
    expect(Math.hypot(pts[0][0] - 150, pts[0][1] - 150)).toBeCloseTo(120, 1)
  })

  it('unavailable axis: not drawn on polygon, detail shows -- (BLOCKER 6.12, 不冒充 0%)', () => {
    const mixed = [
      metric('kast', 'KAST', 78.4, 0.784, '78.4%'),
      metric('league_damage_score', '伤害', null, null, '--', false), // Rating-ineligible 场
      metric('impact', 'Impact', 151.2, 0.756, '151.2%'),
    ]
    const wrapper = mountRadar(mixed)
    // polygon 只连接 available 顶点（BLOCKER 6.12）
    const pts = wrapper.find('.radar-data').attributes('points').split(' ').map(p => p.split(',').map(Number))
    expect(pts).toHaveLength(2)
    expect(wrapper.findAll('.radar-dot')).toHaveLength(2)
    // detail 显示 '--'，不冒充 0/0%
    const text = wrapper.text()
    expect(text).toContain('--')
    expect(text).not.toContain('0%')
  })

  it('renders detail list with displayValue (score/max/percentage; BLOCKER 6.14)', () => {
    const wrapper = mountRadar([
      metric('league_damage_score', '伤害', 342, 0.855, '342 / 400 · 85.5%'),
      metric('league_shooting_score', '射击', 100, 1, '100 / 100 · 100%'),
    ])
    const text = wrapper.text()
    expect(text).toContain('342 / 400')
    expect(text).toContain('85.5%')
    expect(text).toContain('100 / 100')
  })

  it('reorder: SVG / labels order follows metrics array (BLOCKER 6.9)', () => {
    const reordered = [
      metric('impact', 'Impact', 151.2, 0.756, '151.2%'),
      metric('league_damage_score', '伤害', 200, 0.5, '200 / 400 · 50%'),
      metric('kast', 'KAST', 78.4, 0.784, '78.4%'),
    ]
    const wrapper = mountRadar(reordered)
    const labels = wrapper.findAll('.radar-label').map(n => n.text())
    expect(labels).toEqual(['Impact', '伤害', 'KAST'])
  })
})
