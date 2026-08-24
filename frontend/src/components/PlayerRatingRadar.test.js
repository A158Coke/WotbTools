// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerRatingRadar from './PlayerRatingRadar.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key })
}))

const LABELS = ['伤害', '助攻', '击杀', '换血', '阻挡', '存活/互换', '射击']

function mountRadar(scores, maxes) {
  return mount(PlayerRatingRadar, {
    props: { scores, maxes: maxes || [400, 100, 100, 150, 50, 100, 100], labels: LABELS },
    global: { mocks: { $t: key => key } }
  })
}

describe('PlayerRatingRadar (plan §10/§24)', () => {
  it('renders 7 axes (polygon rings, axis lines, dots, labels)', () => {
    const wrapper = mountRadar([200, 50, 50, 75, 25, 50, 50])
    expect(wrapper.findAll('.radar-axis')).toHaveLength(7)
    expect(wrapper.findAll('.radar-dot')).toHaveLength(7)
    expect(wrapper.findAll('.radar-label')).toHaveLength(7)
    expect(wrapper.find('.radar-data').exists()).toBe(true)
  })

  it('normalizes by score/max: 200/400 and 50/100 both map to 50% radius (plan §24)', () => {
    const wrapper = mountRadar([200, 50, 50, 75, 25, 50, 50])
    const pts = wrapper.find('.radar-data').attributes('points').split(' ').map(p => p.split(',').map(Number))
    // 50% 半径 → 距离中心 = RADIUS * 0.5 = 60
    const CENTER = 150
    const dist0 = Math.hypot(pts[0][0] - CENTER, pts[0][1] - CENTER)
    const dist1 = Math.hypot(pts[1][0] - CENTER, pts[1][1] - CENTER)
    expect(dist0).toBeCloseTo(60, 1)
    expect(dist1).toBeCloseTo(60, 1) // 50/100 = 50% → 与 200/400 半径一致
  })

  it('full scores map to outer ring radius', () => {
    const wrapper = mountRadar([400, 100, 100, 150, 50, 100, 100])
    const pts = wrapper.find('.radar-data').attributes('points').split(' ').map(p => p.split(',').map(Number))
    expect(Math.hypot(pts[0][0] - 150, pts[0][1] - 150)).toBeCloseTo(120, 1)
  })

  it('missing/non-finite scores normalize to 0 (no crash)', () => {
    const wrapper = mountRadar([null, undefined, NaN, 0, -5, null, 'x'])
    const pts = wrapper.find('.radar-data').attributes('points').split(' ').map(p => p.split(',').map(Number))
    const CENTER = 150
    // 全部归一化 0 → 所有点都在中心
    for (const p of pts) {
      expect(Math.hypot(p[0] - CENTER, p[1] - CENTER)).toBeCloseTo(0, 5)
    }
  })

  it('renders detail list with score/max/percentage (plan §10.3)', () => {
    const wrapper = mountRadar([342, 60, 70, 110, 40, 80, 100])
    const text = wrapper.text()
    expect(text).toContain('342 / 400')
    expect(text).toContain('85.5%')
    expect(text).toContain('100 / 100')
  })
})