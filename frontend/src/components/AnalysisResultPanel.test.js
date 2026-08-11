// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AnalysisResultPanel from './AnalysisResultPanel.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t })
}))

describe('AnalysisResultPanel preBattleSection', () => {
  it('renders the collapsible pre-battle block when preBattleSection is present', () => {
    const wrapper = mount(AnalysisResultPanel, {
      props: {
        result: {
          analysis: 'report text',
          preBattleSection: '## 赛前预测\n\n队伍1画像：重坦正面推进'
        }
      },
      global: { mocks: { $t: i18n.t } }
    })

    // 区块标题 + 内容默认展开可见
    expect(wrapper.text()).toContain('recon.prebattle.title')
    expect(wrapper.text()).toContain('recon.prebattle.collapse')
    expect(wrapper.text()).toContain('重坦正面推进')
    expect(wrapper.text()).toContain('report text')
  })

  it('does not render the pre-battle block when preBattleSection is null or empty', () => {
    for (const preBattleSection of [null, undefined, '']) {
      const wrapper = mount(AnalysisResultPanel, {
        props: { result: { analysis: 'report text', preBattleSection } },
        global: { mocks: { $t: i18n.t } }
      })
      expect(wrapper.text()).not.toContain('recon.prebattle.title')
      expect(wrapper.text()).toContain('report text')
    }
  })

  it('collapses and expands on toggle click', async () => {
    const wrapper = mount(AnalysisResultPanel, {
      props: {
        result: {
          analysis: 'report text',
          preBattleSection: '## 赛前预测\n\n关键对阵：GRID_REGION_5'
        }
      },
      global: { mocks: { $t: i18n.t } }
    })

    const toggle = wrapper.get('.prebattle-toggle')
    expect(wrapper.find('.prebattle-content').exists()).toBe(true)

    // 折叠：内容隐藏，状态文案切换
    await toggle.trigger('click')
    expect(wrapper.find('.prebattle-content').exists()).toBe(false)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).toContain('recon.prebattle.expand')

    // 展开：内容恢复可见
    await toggle.trigger('click')
    expect(wrapper.find('.prebattle-content').exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('recon.prebattle.collapse')
  })

  it('renders the map overview block when mapOverview has an asset', async () => {
    const wrapper = mount(AnalysisResultPanel, {
      props: {
        result: {
          analysis: 'report',
          mapOverview: {
            mapCode: 'desert_train',
            displayName: 'Desert Sands',
            friendlyTeam: 2,
            playableBounds: { xMin: -256, xMax: 260, yMin: -251, yMax: 254.3 },
            gridCells: [],
            spawnPoints: [],
            phases: [],
            heatmaps: {
              friendly: { dwell: [], damage: [], deaths: [] },
              enemy: { dwell: [], damage: [], deaths: [] }
            },
            routes: []
          }
        }
      },
      global: { mocks: { $t: i18n.t } }
    })
    expect(wrapper.find('[data-test="map-block"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('recon.map.title')
    // 默认收起：点击展开后渲染 MapOverview
    await wrapper.get('.prebattle-toggle').trigger('click')
    expect(wrapper.find('.map-overview-content').exists()).toBe(true)
  })

  it('does not render the map block when the map has no image asset', () => {
    const wrapper = mount(AnalysisResultPanel, {
      props: {
        result: {
          analysis: 'report',
          mapOverview: { mapCode: 'rift', displayName: 'Hellas' }
        }
      },
      global: { mocks: { $t: i18n.t } }
    })
    expect(wrapper.find('[data-test="map-block"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('report')
  })
})
