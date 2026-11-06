// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ArmorShotHud from './ArmorShotHud.vue'

const data = vi.hoisted(() => ({ fetchTankData: vi.fn() }))
vi.mock('../scene/agentData.js', () => data)
const research = vi.hoisted(() => ({ loadDevices: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadDevices: research.loadDevices,
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key }) }))

const TANK = {
  tank_id: 1,
  configs: [
    { label: 'Gun A', shells: [{ type: 'ap', damage: 400, penetration: 200 }, { type: 'he', damage: 500, penetration: 60 }] },
    { label: 'Gun B', shells: [{ type: 'ap', damage: 300, penetration: 220 }, { type: 'ap_cr_premium', damage: 280, penetration: 300 }, { type: 'he', damage: 400, penetration: 70 }] },
  ],
}
const CATALOG = { devices: [{ id: 103, icon: 'calibrated' }, { id: 110, icon: 'enhanced' }, { id: 122, icon: 'improvedPitchLimitsSystem' }] }

beforeEach(() => {
  data.fetchTankData.mockReset().mockResolvedValue(TANK)
  research.loadDevices.mockReset().mockResolvedValue(CATALOG)
})

describe('ArmorShotHud（右上角弹种 + 装备图标）', () => {
  it('按射击方配置渲染弹种图标与装备图标', async () => {
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, scfg: 1 } })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([true])
    expect(wrapper.findAll('[data-testid^="hud-shell-"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="hud-calibrated"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-enhanced"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-shell-0"]').attributes('aria-pressed')).toBe('true')
  })

  it('目标车可用 122 时显示俯仰配件按钮；默认值来自回放，点击发出反向值', async () => {
    const wrapper = mount(ArmorShotHud, {
      props: { shooterId: 1, scfg: 1, pitchAvailable: true, pitchDefault: true },
    })
    await flushPromises()
    const button = wrapper.find('[data-testid="hud-pitch-device"]')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-pressed')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('pitch').at(-1)).toEqual([false])

    const manual = mount(ArmorShotHud, {
      props: { shooterId: 1, scfg: 1, pitchAvailable: true, eqpitch: '0' },
    })
    await flushPromises()
    expect(manual.find('[data-testid="hud-pitch-device"]').attributes('aria-pressed')).toBe('false')
  })

  it('目标车没有 122 槽位时不显示俯仰配件按钮', async () => {
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, scfg: 1, pitchAvailable: false } })
    await flushPromises()
    expect(wrapper.find('[data-testid="hud-pitch-device"]').exists()).toBe(false)
  })

  it('缺省 scfg/config 时使用最后一档（与 viewer 的缺省一致）', async () => {
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1 } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="hud-shell-"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="hud-shell-0"]').attributes('aria-pressed')).toBe('true')
  })

  it('config shells 为空时回退坦克顶层弹表；完全没有弹表时不发 ready', async () => {
    data.fetchTankData.mockResolvedValueOnce({
      tank_id: 1,
      configs: [{ label: 'Gun A', shells: [] }],
      shells: [{ type: 'ap', damage: 300, penetration: 220 }],
    })
    const fallback = mount(ArmorShotHud, { props: { shooterId: 1 } })
    await flushPromises()
    expect(fallback.emitted('ready').at(-1)).toEqual([true])
    expect(fallback.findAll('[data-testid^="hud-shell-"]')).toHaveLength(1)

    data.fetchTankData.mockResolvedValueOnce({ tank_id: 1, configs: [] })
    const none = mount(ArmorShotHud, { props: { shooterId: 1 } })
    await flushPromises()
    expect(none.emitted('ready').at(-1)).toEqual([false])
    expect(none.findAll('[data-testid^="hud-shell-"]')).toHaveLength(0)
  })

  it('切换到无弹表配置时 ready 变 false，交还原生控件', async () => {
    data.fetchTankData.mockResolvedValueOnce({
      tank_id: 1,
      configs: [
        { label: 'Gun A', shells: [{ type: 'ap', damage: 300, penetration: 220 }] },
        { label: 'Empty', shells: [] },
      ],
    })
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, scfg: 0 } })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([true])
    await wrapper.setProps({ scfg: 1 })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([false])
    expect(wrapper.findAll('[data-testid^="hud-shell-"]')).toHaveLength(0)
  })

  it('点击弹种与装备图标发出事件；URL 覆盖优先于回放真值', async () => {
    const wrapper = mount(ArmorShotHud, {
      props: { shooterId: 1, scfg: 1, calibratedDefault: true, enhancedDefault: true, eqcal: '0' },
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="hud-calibrated"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[data-testid="hud-enhanced"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[data-testid="hud-shell-2"]').trigger('click')
    await wrapper.get('[data-testid="hud-calibrated"]').trigger('click')
    await wrapper.get('[data-testid="hud-enhanced"]').trigger('click')
    expect(wrapper.emitted('shell').at(-1)).toEqual([2])
    expect(wrapper.emitted('calibrated').at(-1)).toEqual([true])
    expect(wrapper.emitted('enhanced').at(-1)).toEqual([false])
  })

  it('defaults XI shooter to top and only reloads when an explicit stock is selected', async () => {
    let resolveStock
    data.fetchTankData.mockReturnValueOnce(new Promise(resolve => { resolveStock = resolve }))
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1 } })
    // 缺省（无 upgrade prop）= XI top；首个在途响应仍是 top 请求。
    expect(data.fetchTankData).toHaveBeenLastCalledWith(1, { upgrade: 'top', abilities: null })
    const upgraded = structuredClone(TANK)
    upgraded.configs[1].shells[0].penetration = 330
    data.fetchTankData.mockResolvedValueOnce(upgraded)
    await wrapper.setProps({ upgrade: 'top', abilities: '101,201' })
    await flushPromises()
    expect(data.fetchTankData).toHaveBeenLastCalledWith(1, { upgrade: 'top', abilities: '101,201' })
    expect(wrapper.get('[data-testid="hud-shell-0"]').attributes('title')).toContain('330mm')
    resolveStock(TANK)
    await flushPromises()
    expect(wrapper.get('[data-testid="hud-shell-0"]').attributes('title')).toContain('330mm')
    data.fetchTankData.mockResolvedValueOnce(TANK)
    await wrapper.setProps({ upgrade: 'stock' })
    await flushPromises()
    expect(data.fetchTankData).toHaveBeenLastCalledWith(1, { upgrade: 'stock', abilities: '101,201' })
    expect(wrapper.get('[data-testid="hud-shell-0"]').attributes('title')).toContain('220mm')
  })
})
