// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TankConfigPanel from './TankConfigPanel.vue'
import { baseSelection } from '../replay-local/compute/tankSetup'
import tanks from '../replay-local/compute/__fixtures__/upgrades/tanks.json'
import mechanics from '../replay-local/compute/__fixtures__/upgrades/mechanics.json'
import crew from '../replay-local/compute/__fixtures__/research/skills.json'
import { messages } from '../locales/messages'

const source = tanks.find(t => t.modules.tankId === 30241)
const black = { ...source, modules: { ...source.modules, vehicleAbilities: ['burstMode'] } }
const catalog = { devices: [], devicePresets: {}, ...mechanics, consumablesGameVersion: mechanics.gameVersion,
  provisionsGameVersion: mechanics.gameVersion, crewSkillClasses: {}, skills: {} }
function panel(locale = 'zh', tank = black, props = {}) {
  return mount(TankConfigPanel, {
    props: { ...tank, catalog, selection: { ...baseSelection(tank), upgrade: 'top' }, ...props },
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale, messages })] },
  })
}

describe('配置器紧凑呈现保持交互', () => {
  it.each(['zh', 'en', 'ru'])('%s 嵌入已有面板时只保留一组升级控件、重置与必要警告', async locale => {
    const wrapper = panel(locale, black, {
      embedded: true, showCrew: false, showEquipment: false, showConsumables: false, showProvisions: false,
    })
    expect(wrapper.get('[data-testid="tank-configurator"]').attributes('aria-label')).toBeTruthy()
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tank-upgrades"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="radiogroup"]')).toHaveLength(1)
    await wrapper.get('[data-testid="tank-upgrade-stock"]').trigger('click')
    expect(wrapper.emitted('update').at(-1)[0]).toEqual({ upgrade: 'stock' })
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), upgrade: 'stock' } })
    await wrapper.get('[data-testid="tank-upgrade-top"]').trigger('click')
    expect(wrapper.emitted('update').at(-1)[0]).toEqual({ upgrade: 'top' })
    await wrapper.get('[data-testid="tank-config-reset"]').trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
    await wrapper.setProps({ upgradeSupported: false })
    expect(wrapper.get('[data-testid="tank-upgrade-top"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[role="status"]').text()).not.toContain('agentTanks.')
    wrapper.unmount()
  })

  it('四类技能保持20个训练入口、Shift操作和条件触发状态', async () => {
    const wrapper = panel('zh', black, {
      catalog: { ...catalog, skills: crew.items, crewSkillClasses: crew.classes },
      selection: { ...baseSelection(black), upgrade: 'top', skills: { battle_rage: 4 }, conditionalSkills: false },
    })
    const groups = wrapper.findAll('.tp-skill-group[role="group"]')
    expect(groups).toHaveLength(4)
    for (const group of groups) {
      expect(group.attributes('aria-label')).toBeTruthy()
      expect(group.findAll('button')).toHaveLength(5)
    }
    const rage = wrapper.get('[data-testid="tank-skill-battle_rage"]')
    expect(rage.attributes('aria-pressed')).toBe('true')
    expect(rage.get('.tp-skill-level').text()).toBe('4')
    expect(rage.classes()).toContain('is-pending')
    await rage.trigger('click', { shiftKey: true })
    expect(wrapper.emitted('cycle-skill').at(-1)).toEqual(['battle_rage', true])
    await wrapper.get('[data-testid="tank-skill-repair"]').trigger('click')
    expect(wrapper.emitted('cycle-skill').at(-1)).toEqual(['repair', false])
    await wrapper.get('[data-testid="tank-skill-triggers"]').setValue(true)
    expect(wrapper.emitted('update').at(-1)[0]).toEqual({ conditionalSkills: true })
    expect(wrapper.props('selection').conditionalSkills).toBe(false)
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), conditionalSkills: true } })
    expect(rage.classes()).not.toContain('is-pending')
    expect(rage.get('.tp-skill-level').text()).toBe('4')
    await wrapper.get('[data-testid="tank-skills-max"]').trigger('click')
    await wrapper.get('[data-testid="tank-skills-clear"]').trigger('click')
    expect(wrapper.emitted('max-skills')).toHaveLength(1)
    expect(wrapper.emitted('clear-skills')).toHaveLength(1)
    wrapper.unmount()
  })
})

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

  it('custom 下配置卡换选备选会补齐组前置（与研发树同口径），并显示部分研发状态', async () => {
    const source = tanks.find(tank => tank.modules.tankId === 15153)
    const modules = source.modules
    const group = modules.upgradeProgression.alternativeGroups[0]
    const root = modules.upgradeProgression.nodes.find(node => node.gridPosition && !(node.requiredNodes ?? []).length)
    const wrapper = panel('zh', source, {
      selection: { ...baseSelection(source), upgrade: 'custom', abilities: [root.id] },
    })
    await wrapper.get(`[data-testid="tank-ability-${group.choices[0]}"]`).trigger('click')
    const patch = wrapper.emitted('update').at(-1)[0]
    const abilities = new Set(patch.abilities)
    expect(abilities.has(group.choices[0])).toBe(true)
    // 三条组前置链全部补齐（不再出现“缺前置却生效”的非法状态）
    const byTech = new Map(modules.upgradeProgression.nodes.map(node => [node.techName, node.id]))
    for (const req of group.requiredNodes) expect(abilities.has(byTech.get(req))).toBe(true)
    await wrapper.setProps({ selection: { ...wrapper.props('selection'), ...patch } })
    // 部分研发状态不再显示“未生效”
    expect(wrapper.get('[data-testid="tank-mechanic-effects"]').text()).toContain('部分研发')
    wrapper.unmount()
  })
})
