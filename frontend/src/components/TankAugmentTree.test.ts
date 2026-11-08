// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TankAugmentTree from './TankAugmentTree.vue'
import { messages } from '../locales/messages.js'
import TANKS from '../replay-local/compute/__fixtures__/upgrades/tanks.json'

const bz = TANKS.find(t => t.modules.tankId === 15153)!

function render(overrides: {
  installed?: number[]
  chosen?: Record<string, number>
  vehicleAbilities?: string[]
} = {}) {
  const modules = overrides.vehicleAbilities
    ? { ...bz.modules, vehicleAbilities: overrides.vehicleAbilities }
    : { ...bz.modules }
  return mount(TankAugmentTree, {
    props: { modules, installed: overrides.installed ?? [], chosen: overrides.chosen ?? {} },
    global: { plugins: [createI18n({ locale: 'en', messages })] },
  })
}

describe('TankAugmentTree（XI 研发树复刻）机制文案', () => {
  it('机制名/描述按真实 stem（vehicleAbilities）读三语表，不显示原始键', () => {
    const wrapper = render({ vehicleAbilities: ['rechargeableNitro'] })
    const text = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(text).toContain('Liquid Fuel Boosters')
    expect(text).toContain('temporarily raises the forward speed limit')
    expect(text).not.toContain('rechargeableNitro')
    wrapper.unmount()
  })

  it('无机制绑定时退回键名且不抛错', () => {
    const wrapper = render()
    const text = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(text).toContain('XI')
    wrapper.unmount()
  })
})

describe('TankAugmentTree 可访问性与操作文案', () => {
  it('节点/组/备选是原生 button，带 aria-label 与 aria-pressed，可键盘触发', async () => {
    const wrapper = render()
    const nodes = wrapper.findAll('button[data-testid^="tank-augment-node-"]')
    expect(nodes.length).toBeGreaterThan(0)
    const first = nodes[0]!
    expect(first.attributes('type')).toBe('button')
    expect(first.attributes('aria-label')).toBeTruthy()
    expect(first.attributes('aria-pressed')).toBe('false')
    // 原生 button：trigger('click') 即等价键盘 Enter/Space 的激活路径
    await first.trigger('click')
    expect(wrapper.emitted('research')).toBeTruthy()
    expect(wrapper.find('button[data-testid="tank-augment-group"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('操作文案随语言变化（不再硬编码英文）', () => {
    const modules = { ...bz.modules }
    const zh = mount(TankAugmentTree, {
      props: { modules, installed: [], chosen: {} },
      global: { plugins: [createI18n({ locale: 'zh', messages })] },
    })
    expect(zh.get('[data-testid="tank-augment-all"]').text()).toBe('全部研发')
    expect(zh.get('[data-testid="tank-augment-none"]').text()).toBe('清空')
    zh.unmount()
  })

  it('选中组圆：标题/描述回退到本地化机制文案，不显示客户端资源键', async () => {
    const wrapper = render({ vehicleAbilities: ['rechargeableNitro'] })
    await wrapper.get('[data-testid="tank-augment-group"]').trigger('click')
    const text = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(text).not.toContain('Upgrades/Group')
    expect(text).toContain('Liquid Fuel Boosters')
    wrapper.unmount()
  })

  it('组详情三项备选标题可读（不泄露 */Upgrades/Alternative 资源键），组按钮无障碍名同口径', async () => {
    const wrapper = render({ vehicleAbilities: ['rechargeableNitro'] })
    const groupButton = wrapper.get('[data-testid="tank-augment-group"]')
    expect(groupButton.attributes('aria-label')).not.toContain('Upgrades/Group')
    expect(groupButton.attributes('aria-label')).toContain('Liquid Fuel Boosters')
    await groupButton.trigger('click')
    const panel = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(panel).not.toContain('Upgrades/Alternative')
    // 三项分别有可读文案（属性标签），不是空行/内部键
    const rows = wrapper.findAll('.at-optrow')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.text().trim().length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('MODIFIER_MULTIPLY 属性按系数（×）展示，不显示为加法', async () => {
    const wrapper = render()
    // BZ-79 节点 5（tier11_stabilisation_01）：散布系数 0.98 = 乘数语义（降 2%）
    await wrapper.get('[data-testid="tank-augment-node-5"]').trigger('click')
    const text = wrapper.get('[data-testid="tank-augment-info"]').text()
    expect(text).toContain('×0.98')
    expect(text).not.toContain('+0.98')
    wrapper.unmount()
  })
})
