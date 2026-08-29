// @vitest-environment happy-dom

import { defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RatingV2RadarPanel from './RatingV2RadarPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: key => key, locale: ref('en-US') }),
}))

const RadarStub = defineComponent({
  name: 'PlayerRatingRadar',
  props: ['metrics', 'reference', 'referenceLabel', 'playerLabel', 'referenceUnavailableLabel'],
  template: '<div class="player-radar-stub" />',
})

const KEYS = ['potential_damage_avg', 'kast', 'impact', 'assist_avg', 'multi_damage_rate', 'kills_avg']

function row(name, values) {
  return {
    cells: { nickname: name, rating: 1200 },
    radar: KEYS.map((key, index) => ({
      key,
      rawValue: values[index][0],
      normalized: values[index][1],
      available: true,
    })),
  }
}

function mountPanel(props) {
  return mount(RatingV2RadarPanel, {
    props,
    global: { stubs: { PlayerRatingRadar: RadarStub } },
  })
}

describe('RatingV2RadarPanel', () => {
  it('passes the fixed V2 player axes and full-batch average to the shared V5 radar renderer', () => {
    const alpha = row('Alpha', [[4000, 0.8], [75, 0.75], [300, 1], [3000, 0.75], [55, 0.55], [1.5, 0.6]])
    const beta = row('Beta', [[2000, 0.4], [25, 0.25], [100, 0.4], [1000, 0.25], [25, 0.25], [0.5, 0.2]])
    const wrapper = mountPanel({ row: alpha, rows: [alpha, beta] })
    const radar = wrapper.findComponent(RadarStub)

    expect(radar.props('playerLabel')).toBe('Alpha')
    expect(radar.props('referenceLabel')).toBe('ratingV2.radar.batchAverage')
    expect(radar.props('metrics').map(metric => metric.key)).toEqual(KEYS)
    expect(radar.props('reference')[0].rawValue).toBe(3000)
    expect(radar.props('reference')[0].normalized).toBeCloseTo(0.6, 10)
  })

  it('does not mount a fake radar when the selected player has a missing V2 axis', () => {
    const alpha = row('Alpha', [[4000, 0.8], [75, 0.75], [300, 1], [3000, 0.75], [55, 0.55], [1.5, 0.6]])
    alpha.radar[2] = { key: 'impact', rawValue: null, normalized: null, available: false }
    const wrapper = mountPanel({ row: alpha, rows: [alpha] })

    expect(wrapper.find('[data-testid="rating-v2-radar-unavailable"]').text()).toBe('ratingV2.radar.unavailable')
    expect(wrapper.findComponent(RadarStub).exists()).toBe(false)
  })

  it('emits close from the accessible close button', async () => {
    const alpha = row('Alpha', [[4000, 0.8], [75, 0.75], [300, 1], [3000, 0.75], [55, 0.55], [1.5, 0.6]])
    const wrapper = mountPanel({ row: alpha, rows: [alpha] })

    await wrapper.find('.rating-v2-radar-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
