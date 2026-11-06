// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
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
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
}

describe('XI 技能选择卡与效果反馈', () => {
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
    expect(wrapper.findAll('.tp-ability-option[aria-pressed="true"]')).toHaveLength(1)
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
