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
function panel(locale = 'zh', tank = black) {
  return mount(TankConfigPanel, {
    props: { ...tank, catalog, selection: { ...baseSelection(tank), upgrade: 'top' } },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
}

describe('XI 技能选择卡与效果反馈', () => {
  it.each([
    ['zh', ' 个百分点', '累计变化', '击毁目标后保留层数', '是', '否'],
    ['en', ' pp', 'Total change', 'Keep stacks after destroying a target', 'Yes', 'No'],
    ['ru', ' п. п.', 'Общее изменение', 'Сохранение уровней после уничтожения цели', 'Да', 'Нет'],
  ])('%s：百分数/百分点区分累计与选项变化，保留层数语义完整', async (locale, points, totalLabel, keepLabel, yes, no) => {
    const source = tanks.find(tank => tank.modules.tankId === 27905)
    const wrapper = panel(locale, { ...source, modules: { ...source.modules, vehicleAbilities: ['combatFrenzy'] } })
    const choose = async id => {
      await wrapper.get(`[data-testid="tank-ability-${id}"]`).trigger('click')
      await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...wrapper.emitted('update').at(-1)[0] } })
    }
    const keep = () => wrapper.get('[data-testid="tank-mechanic-COMBAT_FRENZY_ALLOW_SWITCH_AFTER_KILL"]')
    expect(keep().get('th').text()).toBe(keepLabel)
    expect(keep().findAll('td')[0].text()).toBe(no)
    expect(keep().get('strong').text()).toBe(yes)
    expect(wrapper.get('[data-testid="tank-ability-22"]').text()).toContain(keepLabel)
    expect(wrapper.get('[data-testid="tank-ability-22"] .tp-ability-value').text()).toBe(yes)
    await choose(23)
    const reload = wrapper.get('[data-testid="tank-mechanic-COMBAT_FRENZY_RELOAD_SPEED_BONUS_PER_STACK"]')
    expect(reload.findAll('td')[0].text()).toBe('4%')
    expect(reload.get('strong').text()).toBe('10%')
    expect(reload.get('.tp-effect-delta').text()).toBe(`${totalLabel} +6${points}`)
    expect(wrapper.get('[data-testid="tank-ability-23"] .tp-ability-value').text()).toBe(`+2${points}`)
    expect(keep().get('strong').text()).toBe(no)
    await choose(22)
    expect(keep().get('strong').text()).toBe(yes)
    await choose(24)
    expect(keep().get('strong').text()).toBe(no)
    wrapper.unmount()
    const hacker = tanks.find(tank => tank.modules.tankId === 30497)
    const h = panel(locale, { ...hacker, modules: { ...hacker.modules, vehicleAbilities: ['steadyAimSystem'] } })
    const aim = h.get('[data-testid="tank-mechanic-SAS_AIMING_SPEED"]')
    expect(aim.findAll('td')[0].text()).toBe('25%')
    expect(aim.get('strong').text()).toBe('70%')
    expect(aim.get('.tp-effect-delta').text()).toBe(`${totalLabel} +45${points}`)
    expect(h.get('[data-testid="tank-ability-22"] .tp-ability-value').text()).toBe(`+35${points}`)
    await h.get('[data-testid="tank-ability-24"]').trigger('click')
    await h.setProps({ selection: { ...h.props('selection'), ...h.emitted('update').at(-1)[0] } })
    const dispersion = h.get('[data-testid="tank-mechanic-SAS_GUN_DISPERSION"]')
    expect(dispersion.findAll('td')[0].text()).toBe('25%')
    expect(dispersion.get('strong').text()).toBe('50%')
    expect(dispersion.get('.tp-effect-delta').text()).toBe(`${totalLabel} +25${points}`)
    expect(h.get('[data-testid="tank-ability-24"] .tp-ability-value').text()).toBe(`+25${points}`)
    expect(aim.get('strong').text()).toBe('35%')
    h.unmount()
  })
  it.each([
    [28161, 'rammingConfiguration'], [15153, 'rechargeableNitro'],
  ])('%s 的技术系数保持原值展示，不统一乘100', (id, ability) => {
    const source = tanks.find(tank => tank.modules.tankId === id)
    const wrapper = panel('en', { ...source, modules: { ...source.modules, vehicleAbilities: [ability] } })
    expect(wrapper.get('[data-testid="tank-mechanic-effects"]').text()).not.toContain('%')
    expect(wrapper.get('.tp-ability-options').text()).not.toContain(' pp')
    expect(wrapper.props('modules')).toEqual({ ...source.modules, vehicleAbilities: [ability] })
    wrapper.unmount()
  })

  it.each([
    ['zh', '造成伤害', '命中'], ['en', 'On damage', 'On hit'], ['ru', 'При нанесении урона', 'При попадании'],
  ])('%s Hacker 条件显示真实前后语义而非开关或未知值', async (locale, damage, hit) => {
    const source = tanks.find(tank => tank.modules.tankId === 30497)
    const wrapper = panel(locale, { ...source, modules: { ...source.modules, vehicleAbilities: ['steadyAimSystem'] } })
    const row = () => wrapper.get('[data-testid="tank-mechanic-SAS_ALLOW_ACTIVATE_ON_HIT"]')
    expect(row().findAll('td').map(cell => cell.text())).toEqual([damage, damage])
    await wrapper.get('[data-testid="tank-ability-23"]').trigger('click')
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...wrapper.emitted('update').at(-1)[0] } })
    expect(row().findAll('td')[0].text()).toBe(damage)
    expect(row().get('strong').text()).toBe(hit)
    await wrapper.get('[data-testid="tank-ability-24"]').trigger('click')
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...wrapper.emitted('update').at(-1)[0] } })
    expect(row().get('strong').text()).toBe(damage)
    await wrapper.setProps({ catalog: { ...catalog, provisionsGameVersion: 'mismatch' } })
    expect(row().findAll('td').map(cell => cell.text())).toEqual(['—', '—'])
    wrapper.unmount()
  })
  it('BZ-79 加热时长展示8→13，切换选项恢复8', async () => {
    const source = tanks.find(tank => tank.modules.tankId === 15153)
    const wrapper = panel('zh', { ...source, modules: { ...source.modules, vehicleAbilities: ['rechargeableNitro'] } })
    const row = () => wrapper.get('[data-testid="tank-mechanic-RECHARGEABLE_NITRO_HEATING_DURATION"]')
    expect(row().findAll('td').map(cell => cell.text())).toEqual(['8', '13累计变化 +5'])
    await wrapper.get('[data-testid="tank-ability-23"]').trigger('click')
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...wrapper.emitted('update').at(-1)[0] } })
    expect(row().findAll('td').map(cell => cell.text())).toEqual(['8', '8'])
    wrapper.unmount()
  })

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
    expect(row().findAll('td').map(cell => cell.text())).toEqual(['2.5', '0.7累计变化 -1.8'])
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
