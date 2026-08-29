// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerRatingRadar from './PlayerRatingRadar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key })
}))

/** 构造 metrics 轴对象（组件只消费 normalized，不负责任何业务公式）。 */
function metric(key, label, rawValue, normalized, displayValue, available = true, tip = '') {
  return { key, label, rawValue, normalized, displayValue, available, tip }
}

const SEVEN = [
  metric('league_damage_score', 'Damage', 200, 0.5, '200 / 400'),
  metric('league_shooting_score', 'Shooting', 50, 0.5, '50 / 100'),
  metric('league_kill_score', 'Kill', 50, 0.5, '50 / 100'),
  metric('league_survival_score', 'RC', 50, 0.5, '50 / 100', true, 'Survival/Trade tip'),
  metric('league_blocked_score', 'Blocked', 25, 0.5, '25 / 50'),
  metric('league_exchange_score', 'Exchange', 75, 0.5, '75 / 150'),
  metric('league_assist_score', 'Assist', 50, 0.5, '50 / 100'),
]

const REF = SEVEN.map(m => ({ ...m, rawValue: 150, normalized: 0.375, displayValue: '150 / 400' }))

function mountRadar(metrics, reference = null, props = {}) {
  return mount(PlayerRatingRadar, {
    props: { metrics: metrics || SEVEN, reference, referenceLabel: 'Battle Average', playerLabel: 'Alpha', ...props },
    global: { mocks: { $t: key => key } }
  })
}

describe('PlayerRatingRadar', () => {
  it('renders 7 axes / 3 visible grids / player+reference polygons / dots / labels', () => {
    const wrapper = mountRadar(SEVEN, REF)
    expect(wrapper.findAll('.radar-axis')).toHaveLength(7)
    expect(wrapper.findAll('.radar-grid')).toHaveLength(3)
    expect(wrapper.findAll('.radar-dot')).toHaveLength(7)
    expect(wrapper.findAll('.radar-label')).toHaveLength(7)
    expect(wrapper.find('.radar-data').exists()).toBe(true)
    expect(wrapper.find('.radar-ref').exists()).toBe(true)
    expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 340 340')
  })

  it('custom selection: axisCount = metrics.length, order follows metrics array (no perf metrics)', () => {
    const custom = [
      metric('league_damage_score', 'Damage', 342, 0.855, '342 / 400'),
      metric('league_kill_score', 'Kill', 70, 0.7, '70 / 100'),
    ]
    const wrapper = mountRadar(custom)
    expect(wrapper.findAll('.radar-axis')).toHaveLength(2)
    const labels = wrapper.findAll('.radar-label').map(n => n.text())
    expect(labels).toEqual(['Damage', 'Kill'])
  })

  it('reference: dashed no-fill no-dots (class present); player gets dots', () => {
    const wrapper = mountRadar(SEVEN, REF)
    expect(wrapper.find('.radar-ref').exists()).toBe(true)
    expect(wrapper.findAll('.radar-dot')).toHaveLength(7) // 仅 player 有点
  })

  it('grid scale labels: single side 25/50/75/100', () => {
    const wrapper = mountRadar(SEVEN, REF)
    const scales = wrapper.findAll('.radar-scale').map(n => n.text())
    expect(scales).toEqual(['25', '50', '75', '100'])
  })

  it('explains the regular average ring, strong line, and overflow without exposing 150', () => {
    const wrapper = mountRadar(SEVEN, REF)
    expect(wrapper.text()).toContain('radarScale.average')
    expect(wrapper.text()).toContain('radarScale.strong')
    expect(wrapper.text()).toContain('radarScale.overflow')
    expect(wrapper.find('desc').text()).toBe('radarScale.ariaDescription')
    expect(wrapper.findAll('.radar-scale').map(node => node.text())).not.toContain('150')
  })

  it('vertex text only shows dimension name, no numeric value', () => {
    const wrapper = mountRadar(SEVEN, REF)
    const labelText = wrapper.findAll('.radar-label').map(n => n.text()).join(',')
    expect(labelText).not.toMatch(/\d/)
    // RC 短标签 + native title 提示全称
    expect(labelText).toContain('RC')
    expect(labelText).toContain('Survival/Trade tip')
  })

  it('missing player dimension -> 整图 unavailable（不制造假闭合多边形）', () => {
    const mixed = [
      metric('league_damage_score', 'Damage', 300, 0.75, '300 / 400'),
      metric('league_kill_score', 'Kill', null, null, '--', false),
    ]
    const wrapper = mountRadar(mixed)
    expect(wrapper.find('[data-testid="radar-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('.radar-data').exists()).toBe(false)
    expect(wrapper.find('.radar-detail').exists()).toBe(false)
  })

  it('reference incomplete -> 不画 reference 多边形 + 提示 + detail 参考列 --', () => {
    const incompleteRef = [
      metric('league_damage_score', 'Damage', 300, 0.75, '300 / 400'),
      metric('league_kill_score', 'Kill', null, null, '--', false),
    ]
    const wrapper = mountRadar(SEVEN.slice(0, 2), incompleteRef)
    expect(wrapper.find('[data-testid="radar-ref-missing"]').exists()).toBe(true)
    expect(wrapper.find('.radar-ref').exists()).toBe(false)
    const rows = wrapper.findAll('.radar-detail tbody tr')
    expect(rows).toHaveLength(2)
    // 参考列（第二个数据列）显示 --
    const cells = rows[1].findAll('td')
    expect(cells[2].text()).toBe('--')
  })

  it('detail table shows score / max (no percentage), three columns Dimension/Player/Reference', () => {
    const wrapper = mountRadar(SEVEN, REF)
    const head = wrapper.findAll('.radar-detail thead th').map(n => n.text())
    expect(head).toEqual(['radar_lbl.dimension', 'radar_lbl.player', 'Battle Average'])
    const text = wrapper.text()
    expect(text).toContain('200 / 400')
    expect(text).not.toContain('%')
    expect(text).toContain('150 / 400')
  })

  it('no reference prop -> only player polygon, no ref column header', () => {
    const wrapper = mountRadar(SEVEN)
    expect(wrapper.find('.radar-ref').exists()).toBe(false)
    const head = wrapper.findAll('.radar-detail thead th').map(n => n.text())
    expect(head).toEqual(['radar_lbl.dimension', 'radar_lbl.player'])
  })

  it('100 strong grid is visible at 2/3 radius while no 150 outer boundary is rendered', () => {
    const wrapper = mountRadar(SEVEN)
    const strong = wrapper.findAll('.radar-grid').find(n => n.classes().includes('radar-grid-strong'))
    expect(strong).toBeTruthy()
    expect(wrapper.findAll('.radar-grid').map(n => n.attributes('class')).join(' ')).not.toContain('outer')
    expect(wrapper.findAll('.radar-scale').map(n => n.text())).not.toContain('150')
    const comp = readFileSync(resolve(process.cwd(), 'src/components/PlayerRatingRadar.vue'), 'utf8')
    expect(comp).toContain('var(--border-light-strong)')
    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    const showcase = readFileSync(resolve(process.cwd(), 'src/styles/showcase.css'), 'utf8')
    const classic = readFileSync(resolve(process.cwd(), 'src/styles/classic-profile.css'), 'utf8')
    expect(tokens).toContain('--border-light-strong:')
    expect(showcase).toContain('--border-light-strong:')
    expect(classic).toContain('--border-light-strong:')
  })
})
