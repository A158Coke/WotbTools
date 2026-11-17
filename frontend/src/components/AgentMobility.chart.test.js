// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref, watch } from 'vue'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import { saveComparison, readComparison } from '../composables/tankMobility'
import AgentMobility from './AgentMobility.vue'
import MobilityChart from './MobilityChart.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { comparison: 'chart-test' } }),
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('../composables/tankMobility', async original => ({
  ...await original(), useMobilityDataset: () => ref('wg'),
}))
vi.mock('../utils/researchCatalog', async original => ({
  ...await original(), loadResearchCatalog: async () => ({
    skills: { virtuoso: { name_en: 'Virtuoso', 'name_zh-Hans': '快速转弯', effects: {} } },
    crewSkillClasses: { mediumTank: ['virtuoso'] },
  }),
}))

const VehicleColumn = defineComponent({
  name: 'MobilityVehicleColumn', props: ['entry', 'crew'], emits: ['curve', 'remove'],
  setup(props, { emit }) {
    watch(() => [props.entry, props.crew], () => emit('curve', {
      id: props.entry.id, name: props.entry.alias, color: 'blue', summary: '', carried: [], windows: [],
      phases: [{ start: 0, input: { mass: 30, power: 500 + (props.crew.skills.virtuoso || 0),
        limit: 50, permeability: { Firm: 100 } } }],
    }), { immediate: true })
    return () => null
  },
})

it.each(['clear and undo', 'global skills'])('keeps the last vehicle isolated through %s across animation frames', async action => {
  const frames = new Map()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  async function advance() {
    const pending = [...frames]
    frames.clear()
    for (const [, callback] of pending) callback(0)
    await flushPromises()
  }
  async function finish() {
    for (let i = 0; frames.size && i < 10; i++) await advance()
    expect(frames.size).toBe(0)
  }
  const entries = Array.from({ length: 17 }, (_, i) => ({
    id: String(i + 1), tank: i + 1, alias: 'Build ' + (i + 1), dataset: 'wg', activations: {},
  }))
  saveComparison('chart-test', entries)
  let wrapper
  try {
    wrapper = mount(AgentMobility, { global: {
      plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
      stubs: { MobilityVehicleColumn: VehicleColumn, TankCatalogMenu: true,
        AppDialog: { props: { open: Boolean }, template: '<div v-if="open"><slot/><slot name="actions"/></div>' } },
    } })
    await flushPromises()
    await finish()
    let chart = wrapper.getComponent(MobilityChart)
    expect(chart.props('vehicles').map(car => car.id)).toEqual(entries.map(entry => entry.id))
    await chart.findAll('.mob-solo').at(-1).trigger('click')
    expect(chart.vm.snapshotView().isolated).toBe('17Firm')
    if (action === 'clear and undo') {
      await wrapper.get('[data-testid=mobility-clear]').trigger('click')
      expect(wrapper.findComponent(MobilityChart).exists()).toBe(false)
      await wrapper.get('[data-testid=mobility-undo]').trigger('click')
    } else {
      await wrapper.get('[data-testid=mobility-crew]').trigger('click')
      wrapper.getComponent({ name: 'CrewSkillsPanel' }).vm.$emit('cycle-skill', 'virtuoso', true)
      await wrapper.get('[data-testid=mobility-crew-apply]').trigger('click')
    }
    chart = wrapper.getComponent(MobilityChart)
    expect(chart.props('loading')).toBe(true)
    await advance()
    expect(chart.props('vehicles').some(car => car.id === '17')).toBe(false)
    expect(chart.vm.snapshotView().isolated).toBe('17Firm')
    await finish()
    expect(chart.props('loading')).toBe(false)
    expect(readComparison('chart-test')).toEqual(entries)
    expect(chart.props('vehicles').map(car => car.id)).toEqual(entries.map(entry => entry.id))
    expect(chart.vm.snapshotView().isolated).toBe('17Firm')
    expect(chart.findAll('polyline')).toHaveLength(1)
    wrapper.findAllComponents(VehicleColumn).at(-1).vm.$emit('remove')
    await flushPromises()
    await finish()
    expect(chart.vm.snapshotView().isolated).toBe('')
    expect(chart.findAll('polyline')).toHaveLength(16)
  } finally {
    wrapper?.unmount()
    vi.unstubAllGlobals()
  }
})
