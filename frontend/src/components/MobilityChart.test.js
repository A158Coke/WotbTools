// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import { defaultChartView } from '../composables/mobilityChartView'
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


it('keeps one cursor for ranked full readings, hidden/solo terrain curves and view restoration', async () => {
  const vehicles = [100,700,500,300,900].map((power,i)=>{
    const car=vehicle(String(i));car.phases[0].input.power=power
    car.phases[0].input.permeability={Firm:100,Medium:90,Soft:70}
    return car
  })
  const wrapper=mount(MobilityChart,{
    props:{vehicles,dataset:'fixture'},
    global:{plugins:[createI18n({legacy:false,locale:'zh',messages:{zh}})],
      stubs:{AppDialog:{props:{open:Boolean},template:'<div v-if="open"><slot /></div>'}}},
  })
  try {
    wrapper.vm.restoreView({...defaultChartView(),cursor:1})
    await wrapper.get('.mob-readings-button').trigger('click')
    const names=()=>wrapper.findAll('.mob-reading-table tbody th').map(c=>c.text())
    expect(names()).toEqual(['4','1','2','3','0'])
    const shown=wrapper.findAll('.mob-reading-table tbody td:last-child').map(c=>c.text())
    expect(shown.every(v=>v!=='—')).toBe(true)
    wrapper.vm.restoreView({...defaultChartView(),cursor:1,hidden:['4Firm']})
    await wrapper.vm.$nextTick()
    expect(names()).toEqual(['1','2','3','0'])
    wrapper.vm.restoreView({...defaultChartView(),cursor:1,isolated:'3Firm'})
    await wrapper.vm.$nextTick()
    expect(names()).toEqual(['3'])
    wrapper.vm.restoreView({...defaultChartView(),terrain:'all',cursor:1})
    await wrapper.vm.$nextTick()
    expect(names()).toHaveLength(15)
    expect(wrapper.findAll('.mob-reading-table tbody td:first-of-type').map(c=>c.text())).toContain('软地')
    const state={...defaultChartView(),terrain:'Soft',cursor:2,windowEnd:180,zoom:[1,20],search:'0',pairA:'0Soft',pairB:'1Soft',hidden:['4Soft']}
    wrapper.vm.restoreView(state)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.snapshotView()).toEqual(state)
  }finally{wrapper.unmount()}
})


it('keeps a restored cursor while only a fast partial curve has loaded', async () => {
  const fast=vehicle('fast');fast.phases[0].input.power=9000
  const slow=vehicle('slow')
  const wrapper=mount(MobilityChart,{props:{vehicles:[],loading:true,initialView:{...defaultChartView(),cursor:4.88}},
    global:{plugins:[createI18n({legacy:false,locale:'zh',messages:{zh}})]}})
  try{
    expect(wrapper.vm.snapshotView().cursor).toBe(4.88)
    await wrapper.setProps({vehicles:[fast]})
    expect(wrapper.vm.snapshotView().cursor).toBe(4.88)
    await wrapper.setProps({vehicles:[fast,slow],loading:false})
    expect(wrapper.vm.snapshotView().cursor).toBe(4.88)
  }finally{wrapper.unmount()}
})

it.each(['initial view', 'recalculation'])('preserves isolation during partial loading from %s', async source => {
  const [early, late] = ['early', 'late'].map(vehicle)
  const view = { ...defaultChartView(), isolated: 'lateFirm' }
  const wrapper = mount(MobilityChart, {
    props: source === 'initial view'
      ? { vehicles: [], loading: true, initialView: view }
      : { vehicles: [early, late] },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })] },
  })
  try {
    if (source === 'recalculation') {
      wrapper.vm.restoreView(view)
      await wrapper.setProps({ vehicles: [], loading: true })
    }
    await wrapper.setProps({ vehicles: [early] })
    expect(wrapper.vm.snapshotView().isolated).toBe('lateFirm')
    expect(wrapper.findAll('polyline')).toHaveLength(0)
    await wrapper.setProps({ vehicles: [early, late], loading: false })
    expect(wrapper.vm.snapshotView().isolated).toBe('lateFirm')
    expect(wrapper.findAll('polyline')).toHaveLength(1)
    expect(wrapper.findAll('.mob-solo').at(-1).attributes('aria-pressed')).toBe('true')
  } finally { wrapper.unmount() }
})

it('exits isolation when loading ends with the isolated curve still absent', async () => {
  const early = vehicle('early')
  const wrapper = mount(MobilityChart, {
    props: { vehicles: [], loading: true, initialView: { ...defaultChartView(), isolated: 'missingFirm' } },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })] },
  })
  try {
    await wrapper.setProps({ vehicles: [early] })
    expect(wrapper.vm.snapshotView().isolated).toBe('missingFirm')
    await wrapper.setProps({ loading: false })
    expect(wrapper.vm.snapshotView().isolated).toBe('')
    expect(wrapper.findAll('polyline')).toHaveLength(1)
  } finally { wrapper.unmount() }
})
