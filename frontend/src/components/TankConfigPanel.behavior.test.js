// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TankConfigPanel from './TankConfigPanel.vue'
import { baseSelection } from '../replay-local/compute/tankSetup'
import tanks from '../replay-local/compute/__fixtures__/upgrades/tanks.json'
import mechanics from '../replay-local/compute/__fixtures__/upgrades/mechanics.json'
import { messages } from '../locales/messages'

const source = tanks.find(t => t.modules.tankId === 30241)
const black = { ...source, modules: { ...source.modules, vehicleAbilities: ['burstMode'] } }
const catalog = { devices: [], devicePresets: {}, ...mechanics, consumablesGameVersion: mechanics.gameVersion,
  provisionsGameVersion: mechanics.gameVersion, crewSkillClasses: {}, skills: {} }
function panel(locale = 'zh') {
  return mount(TankConfigPanel, {
    props: { ...black, catalog, selection: { ...baseSelection(black), upgrade: 'top' } },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
}

describe('XI 技能选择卡与效果反馈', () => {
  it('卡片保留单选语义、单个 Tab 入口及方向键/Home/End，禁用时不可选择', async () => {
    const wrapper = panel()
    await flushPromises()
    const group = wrapper.get('.tp-ability-options[role="radiogroup"]')
    const options = group.findAll('[role="radio"]')
    expect(options).toHaveLength(3)
    group.element.focus()
    await flushPromises()
    expect(document.activeElement).toBe(options[0].element)
    expect(options.slice(1).every(option => option.attributes('tabindex') === '-1')).toBe(true)
    for (const [key, index] of [['ArrowRight', 1], ['End', 2], ['Home', 0]]) {
      const focused = group.findAll('[role="radio"]').find(option => option.element === document.activeElement)
      await focused.trigger('keydown', { key })
      await flushPromises()
      const patch = wrapper.emitted('update').at(-1)[0]
      expect(patch.abilities).toEqual([Number(options[index].attributes('data-value'))])
      await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...patch } })
      expect(group.findAll('[aria-checked="true"]')).toHaveLength(1)
    }
    await wrapper.setProps({ upgradeSupported: false })
    expect(group.findAll('[role="radio"]').every(option => option.attributes('disabled') !== undefined)).toBe(true)
    const count = wrapper.emitted('update').length
    await options[1].trigger('click')
    expect(wrapper.emitted('update')).toHaveLength(count)
    wrapper.unmount()
  })
  it('选择另一技能即输出互斥节点，当前累计值随父级选择变化，stock状态不显示生效值', async () => {
    const wrapper = panel()
    const interval = black.modules.upgradeProgression.nodes.find(node => node.type === 'NODETYPE_ALTERNATIVE_MECHANIC'
      && node.attributes.some(a => a.name === 'BURST_MODE_INTERVAL'))
    const row = () => wrapper.get('[data-testid="tank-mechanic-BURST_MODE_INTERVAL"]')
    expect(row().text()).toContain('-0.9')
    await wrapper.get(`[data-testid="tank-ability-${interval.id}"]`).trigger('click')
    const patch = wrapper.emitted('update').at(-1)[0]
    expect(patch).toEqual({ abilities: [interval.id] })
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...patch } })
    expect(row().findAll('td').map(cell => cell.text())).toEqual(['2.5', '0.7变化 -1.8'])
    expect(wrapper.findAll('.tp-ability-options [role="radio"][aria-checked="true"]')).toHaveLength(1)
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), upgrade: 'stock' } })
    expect(row().findAll('td').map(cell => cell.text())).toEqual(['2.5', '2.5'])
    expect(wrapper.get('[data-testid="tank-mechanic-effects"]').text()).toContain('未生效')
    wrapper.unmount()
  })
  it.each(['zh', 'en', 'ru'])('%s 的变化说明与技能标签均有本地化', locale => {
    const wrapper = panel(locale)
    expect(wrapper.get('[data-testid="tank-mechanic-effects"]').text()).not.toContain('agentTanks.')
    expect(wrapper.get('[data-testid="tank-upgrade-skills"]').text()).not.toContain('agentTanks.')
    wrapper.unmount()
  })
})
