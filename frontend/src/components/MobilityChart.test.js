// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import MobilityChart from './MobilityChart.vue'

const vehicle = id => ({
  id, name: id, color: 'blue', summary: '', carried: [], windows: [],
  phases: [{ start: 0, input: { mass: 30, power: 500, limit: 50, permeability: { Firm: 100 } } }],
})

it('shows the remaining vehicles after the isolated vehicle is removed', async () => {
  const [a, b] = ['A', 'B'].map(vehicle)
  const wrapper = mount(MobilityChart, {
    props: { vehicles: [a, b], dataset: 'fixture' },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })] },
  })
  try {
    await wrapper.get('.mob-solo').trigger('click')
    expect(wrapper.findAll('polyline')).toHaveLength(1)
    await wrapper.setProps({ vehicles: [b] })
    expect(wrapper.get('.mob-identity strong').text()).toBe('B')
    expect(wrapper.get('polyline').attributes('points')).not.toBe('')
    expect(wrapper.get('.mob-solo').attributes('aria-pressed')).toBe('false')
  } finally {
    wrapper.unmount()
  }
})
