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
  it('显示全部弹种的整数穿深，按场景系数联动校准弹并仅在最后取整', async () => {
    const shells = [
      { type: 'ap', penetration: 200.49 },
      { type: 'ap_cr_premium', penetration: 300.49 },
      { type: 'heat', penetration: 310.5 },
      { type: 'he', penetration: 60.5 },
      { type: 'he', type_id: 0, penetration: 200.49 },
      { type: 'unknown', penetration: 201.49 },
    ]
    data.fetchTankData.mockResolvedValueOnce({ configs: [{ shells }] })
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, eqcal: '0' } })
    await flushPromises()
    const values = () => wrapper.findAll('[data-testid="hud-penetration"]').map(node => node.text())
    expect(values()).toEqual(['200 mm', '300 mm', '311 mm', '61 mm', '200 mm', '201 mm'])
    await wrapper.setProps({ eqcal: '1' })
    expect(values()).toEqual(['213 mm', '319 mm', '332 mm', '65 mm', '213 mm', '201 mm'])
    wrapper.findAll('[data-testid^="hud-shell-"]').forEach((button, index) => {
      expect(button.attributes('title')).toContain(values()[index].replace(' ', ''))
      expect(button.attributes('title')).toContain('armor.shell_penetration_basis')
      expect(button.attributes('aria-label')).toBe(button.attributes('title'))
    })
    await wrapper.setProps({ eqenh: '1', eqpitch: '1', pitchAvailable: true })
    expect(values()).toEqual(['213 mm', '319 mm', '332 mm', '65 mm', '213 mm', '201 mm'])
    await wrapper.setProps({ eqcal: '0' })
    expect(values()[0]).toBe('200 mm')
    expect(data.fetchTankData).toHaveBeenCalledOnce()
    expect(shells[0].penetration).toBe(200.49)
  })

  it('回放校准默认值参与穿深，显式关闭优先', async () => {
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, calibratedDefault: true } })
    await flushPromises()
    expect(wrapper.get('[data-testid="hud-shell-0"]').text()).toBe('233 mm')
    await wrapper.setProps({ eqcal: '0' })
    expect(wrapper.get('[data-testid="hud-shell-0"]').text()).toBe('220 mm')
    await wrapper.setProps({ eqcal: null })
    expect(wrapper.get('[data-testid="hud-shell-0"]').text()).toBe('233 mm')
  })

  it('缺失和非法穿深显示破折号，不伪造成零', async () => {
    data.fetchTankData.mockResolvedValueOnce({ configs: [{ shells: [undefined, null, NaN, Infinity, -1, 0].map(penetration => ({ type: 'ap', penetration })) }] })
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, eqcal: '1' } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="hud-penetration"]').map(node => node.text())).toEqual(['— mm', '— mm', '— mm', '— mm', '— mm', '0 mm'])
  })

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
    expect(wrapper.get('[data-testid="hud-shell-0"]').text()).toBe('330 mm')
    resolveStock(TANK)
    await flushPromises()
    expect(wrapper.get('[data-testid="hud-shell-0"]').attributes('title')).toContain('330mm')
    data.fetchTankData.mockResolvedValueOnce(TANK)
    await wrapper.setProps({ upgrade: 'stock' })
    await flushPromises()
    expect(data.fetchTankData).toHaveBeenLastCalledWith(1, { upgrade: 'stock', abilities: '101,201' })
    expect(wrapper.get('[data-testid="hud-shell-0"]').attributes('title')).toContain('220mm')
    expect(wrapper.get('[data-testid="hud-shell-0"]').text()).toBe('220 mm')
  })

  it('卸载后迟到资产不会重新发出ready', async () => {
    let resolve
    data.fetchTankData.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const onReady = vi.fn()
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, onReady } })
    expect(onReady).toHaveBeenLastCalledWith(false)
    wrapper.unmount()
    resolve(TANK)
    await flushPromises()
    expect(onReady).toHaveBeenCalledOnce()
  })
})
