// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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

function interactiveChart() {
  return mount(MobilityChart, {
    attachTo: document.body,
    props: { vehicles: Array.from({ length: 19 }, (_, i) => vehicle(String(i))),
      initialView: { ...defaultChartView(), zoom: [0, 20], cursor: 1.38 } },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages: { zh } })],
      stubs: { AppDialog: { name: 'AppDialog', props: { open: Boolean }, template: '<div v-if="open" role="dialog"><slot /></div>' } } },
  })
}
function alt(type, target = window, modifiers = {}) {
  const event = new KeyboardEvent(type, { key: 'Alt', altKey: type === 'keydown', bubbles: true, cancelable: true, ...modifiers })
  target.dispatchEvent(event)
  return event
}

it('expands all readings only while Alt is held over this chart, without changing curves or time', async () => {
  const wrapper = interactiveChart()
  try {
    expect(alt('keydown').defaultPrevented).toBe(false)
    await wrapper.get('svg[role=img]').trigger('pointerenter')
    expect(wrapper.findAll('.mob-tip > div')).toHaveLength(4)
    expect(alt('keydown', window, { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(alt('keydown', wrapper.get('input[type=search]').element).defaultPrevented).toBe(false)
    expect(alt('keydown').defaultPrevented).toBe(true)
    await nextTick()
    expect(wrapper.findAll('.mob-tip > div')).toHaveLength(19)
    await wrapper.get('svg[role=img]').trigger('pointermove', { clientX: 500 })
    await wrapper.get('.mob-tip').trigger('wheel', { deltaY: 100 })
    expect(wrapper.vm.snapshotView().cursor).toBe(1.38)
    expect(wrapper.findAll('polyline')).toHaveLength(19)
    expect(alt('keyup').defaultPrevented).toBe(true)
    await nextTick()
    expect(wrapper.findAll('.mob-tip > div')).toHaveLength(4)
    await wrapper.get('.mob-visibility').trigger('click')
    alt('keydown')
    await nextTick()
    expect(wrapper.findAll('.mob-tip > div')).toHaveLength(18)
    expect(wrapper.findAll('polyline')).toHaveLength(18)
  } finally { wrapper.unmount() }
  expect(alt('keydown').defaultPrevented).toBe(false)
})

it.each(['blur', 'visibilitychange', 'leave', 'dialog'])('clears temporary Alt expansion on %s', async reason => {
  const wrapper = interactiveChart()
  try {
    await wrapper.get('svg[role=img]').trigger('pointerenter')
    alt('keydown')
    await nextTick()
    expect(wrapper.find('.mob-tip.is-expanded').exists()).toBe(true)
    if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    else if (reason === 'visibilitychange') document.dispatchEvent(new Event('visibilitychange'))
    else if (reason === 'leave') await wrapper.get('.mob-area').trigger('pointerleave')
    else await wrapper.get('.mob-readings-button').trigger('click')
    await nextTick()
    expect(wrapper.find('.mob-tip.is-expanded').exists()).toBe(false)
    alt('keyup')
    if (reason !== 'dialog') {
      await wrapper.get('svg[role=img]').trigger('pointerenter')
      expect(wrapper.findAll('.mob-tip > div')).toHaveLength(4)
    }
  } finally { wrapper.unmount() }
})

it('coalesces range inputs per frame, commits the last value on release, and refreshes the covered plot on close', async () => {
  const frames = new Map()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', frame => frames.delete(frame))
  const wrapper = interactiveChart()
  try {
    await wrapper.get('.mob-readings-button').trigger('click')
    let range = wrapper.get('[role=dialog] input[type=range]')
    const input = async value => { range.element.value = String(value); await range.trigger('input') }
    await input(1.4)
    await input(1.42)
    await input(1.98)
    expect(frames.size).toBe(1)
    expect(wrapper.get('[role=dialog] output').text()).toBe('1.38 s')
    for (const callback of [...frames.values()]) callback()
    await nextTick()
    expect(wrapper.get('[role=dialog] output').text()).toBe('1.98 s')
    expect(wrapper.get('.mob-plot .mob-scrubber output').text()).toBe('1.38 s')
    await input(2.02)
    await range.trigger('pointerup')
    expect(frames.size).toBe(0)
    expect(wrapper.vm.snapshotView().cursor).toBe(2.02)
    wrapper.findAllComponents({ name: 'AppDialog' }).at(-1).vm.$emit('close')
    await nextTick()
    expect(wrapper.get('.mob-plot .mob-scrubber output').text()).toBe('2.02 s')
    await wrapper.get('.mob-readings-button').trigger('click')
    range = wrapper.get('[role=dialog] input[type=range]')
    await input(10.02)
    wrapper.vm.restoreView({ ...defaultChartView(), zoom: [0, 2], cursor: 1 })
    await nextTick()
    expect(frames.size).toBe(0)
    expect(wrapper.vm.snapshotView().cursor).toBe(1)
  } finally { wrapper.unmount(); vi.unstubAllGlobals() }
})

it('preserves a restored time while loading and clamps to the available extent when loading completes', async () => {
  const wrapper = interactiveChart()
  try {
    await wrapper.setProps({ loading: true })
    wrapper.vm.restoreView({ ...defaultChartView(), cursor: 25 })
    await nextTick()
    expect(wrapper.vm.snapshotView().cursor).toBe(25)
    await wrapper.setProps({ loading: false })
    expect(wrapper.vm.snapshotView().cursor).toBeLessThanOrEqual(Number(wrapper.get('input[type=range]').attributes('max')))
  } finally { wrapper.unmount() }
})
