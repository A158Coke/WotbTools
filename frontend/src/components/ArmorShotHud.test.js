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
const CATALOG = { devices: [{ id: 103, icon: 'calibrated' }, { id: 110, icon: 'enhanced' }] }

beforeEach(() => {
  data.fetchTankData.mockReset().mockResolvedValue(TANK)
  research.loadDevices.mockReset().mockResolvedValue(CATALOG)
})

describe('ArmorShotHud（右上角弹种 + 校准弹/强化装甲图标）', () => {
  it('按射击方配置渲染弹种图标与两枚装备图标', async () => {
    const wrapper = mount(ArmorShotHud, { props: { shooterId: 1, scfg: 1 } })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([true])
    expect(wrapper.findAll('[data-testid^="hud-shell-"]')).toHaveLength(3)
    expect(wrapper.find('[data-testid="hud-calibrated"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-enhanced"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hud-shell-0"]').attributes('aria-pressed')).toBe('true')
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
})
