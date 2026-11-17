// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick, ref } from 'vue'
import zh from '../locales/zh.json'
import AgentMobility from './AgentMobility.vue'
import { saveComparison, readComparison, readComparisonDocument } from '../composables/tankMobility'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { comparison: 'undo-test' } }), useRouter: () => ({ replace: vi.fn() }),
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
const chartView = { terrain:'Soft', hidden:['2Firm'], isolated:'', cursor:4.88, windowEnd:180,
  zoom:[2,15], search:'Build', pairA:'1Soft', pairB:'2Soft' }
function mountComparison() {
  return mount(AgentMobility, { global: {
    plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
    stubs: {
      MobilityVehicleColumn: { name:'MobilityVehicleColumn', props:['entry','dataset','crew'], template:'<div />' },
      MobilityChart: { name:'MobilityChart', props:['vehicles','dataset','initialView'], methods:{snapshotView:()=>JSON.parse(JSON.stringify(chartView)),restoreView:()=>{}}, template:'<div />' },
      TankCatalogMenu: true,
      AppDialog: { props: { open:Boolean }, template: '<div v-if="open"><slot/><slot name="actions"/></div>' },
    },
  } })
}

it('commits only selected targets together and restores their exact original entries on undo', async () => {
  const entries = [1,2,3].map(n => ({ id: String(n), tank: n, alias: 'Build ' + n, dataset: 'wg', activations: {} }))
  saveComparison('undo-test', entries)
  const wrapper = mountComparison()
  await flushPromises()
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
    await wrapper.get('[data-testid=mobility-undo]').trigger('click')
    expect(readComparison('undo-test')).toEqual(entries)
  } finally { wrapper.unmount() }
})


it('preserves legacy crew differences through clear/undo and explicitly unifies skills for present and new vehicles', async () => {
  const config = {config:0,engine:0,track:0,shell:0,dev:'',prov:[],cons:[],skills:{virtuoso:3},conditionalSkills:false,camo:true,abilities:[]}
  const entries = [1,2].map(n => ({id:String(n),tank:n,dataset:'wg',alias:'Build '+n,seriesIndex:n-1,
    stems:['T','G','E','C'],activations:{},config:{...config,skills:{virtuoso:n===1?3:7}}}))
  saveComparison('undo-test',entries)
  const wrapper = mountComparison()
  try {
    await flushPromises()
    let cols = wrapper.findAllComponents({name:'MobilityVehicleColumn'})
    expect(cols.map(c=>c.props('crew').skills.virtuoso)).toEqual([3,7])
    const oldColumn = cols[0]
    await wrapper.get('[data-testid=mobility-clear]').trigger('click')
    expect(wrapper.findComponent({name:'MobilityChart'}).exists()).toBe(false)
    expect(readComparison('undo-test')).toEqual([])
    expect(readComparisonDocument('undo-test')).toMatchObject({document:{crew:{skills:{virtuoso:3}}}})
    oldColumn.vm.$emit('curve',{id:'1',name:'stale'})
    await nextTick()
    expect(wrapper.findComponent({name:'MobilityChart'}).exists()).toBe(false)
    await wrapper.get('[data-testid=mobility-undo]').trigger('click')
    await flushPromises()
    expect(readComparison('undo-test')).toEqual(entries)
    expect(wrapper.getComponent({name:'MobilityChart'}).props('initialView')).toEqual(chartView)
    oldColumn.vm.$emit('curve',{id:'1',name:'stale-after-undo'})
    await nextTick()
    expect(wrapper.getComponent({name:'MobilityChart'}).props('vehicles').some(curve => curve.name === 'stale-after-undo')).toBe(false)
    cols = wrapper.findAllComponents({name:'MobilityVehicleColumn'})
    expect(cols.map(c=>c.props('crew').skills.virtuoso)).toEqual([3,7])
    await wrapper.get('[data-testid=mobility-crew]').trigger('click')
    expect(wrapper.text()).toContain('旧配置包含不同技能')
    await wrapper.getComponent({name:'CrewSkillsPanel'}).vm.$emit('cycle-skill','virtuoso',true)
    await wrapper.get('[data-testid=mobility-crew-apply]').trigger('click')
    await flushPromises()
    expect(readComparisonDocument('undo-test')).toMatchObject({document:{crew:{skills:{virtuoso:7}}}})
    const stored = readComparisonDocument('undo-test')
    expect(stored.document.legacyCrewOverrides).toBeUndefined()
    expect(wrapper.findAllComponents({name:'MobilityVehicleColumn'}).map(c=>c.props('crew').skills.virtuoso)).toEqual([7,7])
    await wrapper.get('[data-testid=mobility-undo]').trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents({name:'MobilityVehicleColumn'}).map(c=>c.props('crew').skills.virtuoso)).toEqual([3,7])
    await wrapper.get('[data-testid=mobility-crew]').trigger('click')
    await wrapper.getComponent({name:'CrewSkillsPanel'}).vm.$emit('cycle-skill','virtuoso',true)
    await wrapper.get('[data-testid=mobility-crew-apply]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid=mobility-add]').trigger('click')
    wrapper.getComponent({name:'TankCatalogMenu'}).vm.$emit('confirm',[{id:3,name:'New'}])
    await flushPromises()
    expect(wrapper.findAllComponents({name:'MobilityVehicleColumn'}).map(c=>c.props('crew').skills.virtuoso)).toEqual([7,7,7])
    expect(wrapper.find('[data-testid=mobility-undo]').exists()).toBe(false)
    await wrapper.get('[data-testid=mobility-clear]').trigger('click')
    expect(readComparisonDocument('undo-test')).toMatchObject({document:{entries:[],crew:{skills:{virtuoso:7}}}})
  } finally { wrapper.unmount() }
})
