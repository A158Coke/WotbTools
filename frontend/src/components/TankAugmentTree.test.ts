// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TankAugmentTree from './TankAugmentTree.vue'
import { messages } from '../locales/messages.js'
import TANKS from '../replay-local/compute/__fixtures__/upgrades/tanks.json'

const bz = TANKS.find(t => t.modules.tankId === 15153)!

function render(overrides: {
  installed?: number[]
  chosen?: Record<string, number>
  vehicleAbilities?: string[]
} = {}) {
  const modules = overrides.vehicleAbilities
    ? { ...bz.modules, vehicleAbilities: overrides.vehicleAbilities }
    : { ...bz.modules }
  return mount(TankAugmentTree, {
    props: { modules, installed: overrides.installed ?? [], chosen: overrides.chosen ?? {} },
    global: { plugins: [createI18n({ locale: 'en', messages })] },
  })
}

describe('TankAugmentTree（XI 研发树复刻）机制文案', () => {
  it('机制名/描述按真实 stem（vehicleAbilities）读三语表，不显示原始键', () => {
    const wrapper = render({ vehicleAbilities: ['rechargeableNitro'] })
    const text = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(text).toContain('Liquid Fuel Boosters')
    expect(text).toContain('temporarily raises the forward speed limit')
    expect(text).not.toContain('rechargeableNitro')
    wrapper.unmount()
  })

  it('无机制绑定时退回键名且不抛错', () => {
    const wrapper = render()
    const text = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(text).toContain('XI')
    wrapper.unmount()
  })
})
