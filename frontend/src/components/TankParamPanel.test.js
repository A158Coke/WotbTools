// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TankParamPanel from './TankParamPanel.vue'
import { messages } from '../locales/messages.js'

const groups = [
  { group: 'protectability', rows: [{ key: 'maxHealth', value: 2900, digits: 0, delta: 100, good: true }] },
  { group: 'mobility', rows: [{ key: 'maxFrontSpeed', value: 38, digits: 0, unit: 'KILOMETER_PER_HOUR', delta: 0, good: null }] },
  { group: 'gun', rows: [{ key: 'gunShellReloadTime', value: 9.21, digits: 2, unit: 'SECOND', delta: -0.65, good: true }] },
]
function panel(extra = {}) {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  const wrapper = mount(TankParamPanel, { props: {
    groups, current: { maxHealth: 2900, baseShellAvgDamage: 410, baseShellAvgPiercingPower: 265, maxFrontSpeed: 38, circularVisionRadius: 267.5 },
    shells: [{ index: 0, selected: true, label: 'AP', tunedPenetration: 265, tunedDamage: 410, tunedVelocity: 1200, tunedPenetrationFar: 250, tunedModuleDamage: 100, normalization: 5, ricochet: 70 }, { index: 1, selected: false, label: 'HEAT', iconUrl: '/shell.webp' }],
    ...extra,
  }, global: { plugins: [i18n] } })
  return { wrapper, i18n }
}

describe('TankParamPanel 数据展示', () => {
  it('每个参数只显示一次，防护和机动共列，主值与单位先于变化量', () => {
    const { wrapper } = panel()
    const columns = wrapper.findAll('.tp-param-column')
    expect(columns).toHaveLength(2)
    expect(columns[0].findAll('.tp-param-group').map(group => group.attributes('data-testid')))
      .toEqual(['tank-params-protectability', 'tank-params-mobility'])
    expect(wrapper.findAll('.tp-param-row')).toHaveLength(3)
    const reload = wrapper.get('[data-testid=tank-param-gunShellReloadTime]')
    expect(reload.find('.tp-param-value').text()).toBe('9.21')
    expect(reload.find('.tp-param-unit').text()).toBe(messages.en.agentTanks.units.SECOND)
    expect(reload.find('.tp-param-delta').classes()).toContain('is-good')
    expect(reload.find('.tp-param-delta').text()).toContain('▼')
    expect(reload.get('dd').element.firstElementChild.classList.contains('tp-param-reading')).toBe(true)
    expect(wrapper.get('[data-testid=tank-param-maxFrontSpeed]').find('.tp-param-delta').exists()).toBe(false)
    wrapper.unmount()
  })

  it('数值使用当前语言千分位；切语言只改变显示', async () => {
    const { wrapper, i18n } = panel()
    const hp = () => wrapper.get('[data-testid=tank-param-maxHealth] .tp-param-value').text()
    expect(hp()).toBe('2,900')
    i18n.global.locale.value = 'ru'
    await wrapper.vm.$nextTick()
    expect(hp()).toBe(new Intl.NumberFormat('ru').format(2900))
    expect(wrapper.props('groups')[0].rows[0].value).toBe(2900)
    wrapper.unmount()
  })

  it('弹种名称有图标仍可见，点击输出原索引，明细显示单位', async () => {
    const { wrapper } = panel()
    const heat = wrapper.get('[data-testid=tank-shell-1]')
    expect(heat.find('img').exists()).toBe(true)
    expect(heat.text()).toBe('HEAT')
    await heat.trigger('click')
    expect(wrapper.emitted('select-shell')).toEqual([[1]])
    const detail = wrapper.get('[data-testid=tank-shell-detail]')
    expect(detail.text()).toContain('1,200')
    expect(detail.findAll('.tp-param-unit').map(unit => unit.text())).toContain(messages.en.agentTanks.units.METER_PER_SECOND)
    wrapper.unmount()
  })
})
