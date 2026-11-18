// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import AgentMobility from './AgentMobility.vue'

vi.mock('../scene/agentData.js', () => ({ fetchTankEncyclopedia: async () => ({ 14977: { name: 'CS-63' } }) }))
vi.mock('../composables/tankMobility', async original => ({
  ...await original(), useMobilityDataset: () => ref('wg'),
}))

it.each([
  { view: 'agent-tankopedia', q: 'CS', tier: '10', sort: 'speed', assets: 'https://assets.test' },
  { view: 'agent-tankopedia', tank: '14977', dev: '000', prov: 'improved_fuel', upgrade: 'stock', lang: 'zh', data: '11.21.0_1' },
])('returns to the original encyclopedia context after adding and editing a vehicle ($tank)', async source => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  const origin = router.resolve({ path: '/', query: source, hash: '#parameters' }).fullPath
  await router.push({ path: '/', query: { view: 'agent-mobility', mobilityReturn: origin } })
  const wrapper = mount(AgentMobility, { global: {
    plugins: [router, createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
    stubs: {
      MobilityVehicleColumn: { name: 'MobilityVehicleColumn', props: ['entry', 'dataset'], template: '<div />' },
      MobilityChart: { props: ['vehicles', 'dataset', 'initialView'], methods: { snapshotView: () => undefined, restoreView: () => {} }, template: '<div />' },
      TankCatalogMenu: true,
      AppDialog: { props: { open: Boolean }, template: '<div v-if="open"><slot /></div>' },
    },
  } })
  try {
    expect(wrapper.get('[data-testid=mobility-back]').text()).toContain('返回')
    await wrapper.get('[data-testid=mobility-add]').trigger('click')
    await flushPromises()
    wrapper.getComponent({ name: 'TankCatalogMenu' }).vm.$emit('confirm', [{ id: 14977, name: 'CS-63' }])
    await flushPromises()
    const vehicle = wrapper.getComponent({ name: 'MobilityVehicleColumn' })
    vehicle.vm.$emit('update', { ...vehicle.props('entry'), alias: 'Edited configuration' })
    await flushPromises()
    expect(router.currentRoute.value.query.mobilityReturn).toBe(origin)
    await wrapper.get('[data-testid=mobility-back]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe(origin)
  } finally { wrapper.unmount() }
})

it.each([undefined, 'https://example.com/', '//example.com/', '/?view=admin-users'])('falls back to the encyclopedia for an unavailable origin (%s)', async origin => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push({ path: '/', query: { view: 'agent-mobility', comparison: 'missing', mobilityReturn: origin } })
  const wrapper = mount(AgentMobility, { global: {
    plugins: [router, createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
  } })
  try {
    await wrapper.get('[data-testid=mobility-back]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia' })
  } finally { wrapper.unmount() }
})
