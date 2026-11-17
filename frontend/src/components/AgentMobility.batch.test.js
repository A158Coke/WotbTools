// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick, ref } from 'vue'
import zh from '../locales/zh.json'
import AgentMobility from './AgentMobility.vue'
import { saveComparison, readComparison } from '../composables/tankMobility'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { comparison: 'undo-test' } }), useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock('../composables/tankMobility', async original => ({
  ...await original(), useMobilityDataset: () => ref('wg'),
}))

it('commits only selected targets together and restores their exact original entries on undo', async () => {
  const entries = [1,2,3].map(n => ({ id: String(n), tank: n, alias: 'Build ' + n, dataset: 'wg', activations: {} }))
  saveComparison('undo-test', entries)
  const wrapper = mount(AgentMobility, { global: {
    plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
    stubs: {
      MobilityVehicleColumn: { name:'MobilityVehicleColumn', props:['entry','dataset'], template:'<div />' }, MobilityChart: { props:['vehicles','dataset'], template:'<div />' }, TankCatalogMenu: true,
      AppDialog: { props: { open:Boolean }, template: '<div v-if="open"><slot/><slot name="actions"/></div>' },
    },
  } })
  try {
    const cols = wrapper.findAllComponents({ name: 'MobilityVehicleColumn' })
    const selection = {
      canConfigure:true, turret:0, gun:0, engine:0, track:0, config:0, shell:1,
      skills:{}, consumables:[], provisions:[], devices:Array(9).fill(null),
    }
    const context = {
      modules:{turrets:[{stem:'T', guns:[{stem:'G'}]}],engines:[{stem:'E'}],chassis:[{stem:'C'}]},
      provisions:[{stem:'improved_fuel'}], provisionSlots:3, selection,
    }
    cols.forEach((col,i) => col.vm.$emit('context', i ? context :
      {...context, selection:{...selection,provisions:['improved_fuel']}}))
    cols[0].vm.$emit('batch','provisions')
    await nextTick()
    await wrapper.findAll('.mb-targets input')[1].setValue(false)
    expect(readComparison('undo-test')).toEqual(entries)
    await wrapper.getComponent({name:'MobilityBatchDialog'}).findAll('button').at(-1).trigger('click')
    const changed = readComparison('undo-test')
    expect(changed.map(row => row.id)).toEqual(['1','2','3'])
    expect(changed[0]).toEqual(entries[0])
    expect(changed[2]).toEqual(entries[2])
    expect(changed[1].config).toMatchObject({prov:['improved_fuel'], shell:1, cons:[]})
    await wrapper.get('.mob-page-actions button:last-child').trigger('click')
    expect(readComparison('undo-test')).toEqual(entries)
  } finally { wrapper.unmount() }
})
