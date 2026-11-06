// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ArmorSideConfig from './ArmorSideConfig.vue'
import TankConfigPanel from './TankConfigPanel.vue'
import upgradeFixtures from '../replay-local/compute/__fixtures__/upgrades/tanks.json'

const data = vi.hoisted(() => ({ fetchTankData: vi.fn() }))
vi.mock('../scene/agentData.js', () => data)
const research = vi.hoisted(() => ({ loadTankModules: vi.fn(), loadResearchCatalog: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTankModules: research.loadTankModules,
  loadResearchCatalog: research.loadResearchCatalog,
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key), te: () => false }),
}))

const MODULES = {
  tankId: 999, tier: 10, optDevicePreset: 'defaultPreset', consumableSlots: 2, provisionSlots: 1,
  chassis: [{ stem: 'track0', localId: 0, level: 1 }, { stem: 'track1', localId: 1, level: 2 }],
  engines: [{ stem: 'eng0', localId: 0, level: 1 }, { stem: 'eng1', localId: 1, level: 2 }],
  turrets: [{ stem: 't0', localId: 0, level: 1, guns: [{ stem: 'g0', localId: 0, level: 1 }] }],
}
const DETAIL = {
  tank_id: 999, name: 'IS-7', tier: 10, nation: 'ussr',
  configs: [{ label: 'Stock', turret_local: 0, gun_local: 0, shells: [{ type: 'ap', damage: 480, penetration: 250 }] }],
}
const CATALOG = { devices: [], devicePresets: {}, consumables: [], provisions: [] }

beforeEach(() => {
  data.fetchTankData.mockReset().mockResolvedValue(DETAIL)
  research.loadTankModules.mockReset().mockResolvedValue({ tanks: { 'IS-7': MODULES } })
  research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
})

describe('ArmorSideConfig（一侧的模块 + 配件完整选择）', () => {
  it('渲染详情页同款模块矩阵（装备/消耗品/补给/乘员/涂装都不在装甲页）', async () => {
    const wrapper = mount(ArmorSideConfig, { props: { tankId: 999 }, global: { mocks: { $t: key => key } } })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([true])
    expect(wrapper.find('[data-testid="tank-configurator"]').exists()).toBe(true)
    expect(wrapper.getComponent(TankConfigPanel).props('embedded')).toBe(true)
    expect(wrapper.findAll('.tp-module-tile')).toHaveLength(6) // 炮塔1+火炮1+发动机2+履带2
    expect(wrapper.findAll('.tp-dev-btn')).toHaveLength(0)
    expect(wrapper.find('.tp-skills-block').exists()).toBe(false)
    expect(wrapper.find('.tp-camo-block').exists()).toBe(false)
  })

  it('配置与模块无法对号时不报告 ready（保留原生配置回退）', async () => {
    data.fetchTankData.mockResolvedValueOnce({ ...DETAIL, configs: [{ label: 'Stock' }] })
    const wrapper = mount(ArmorSideConfig, { props: { tankId: 999 }, global: { mocks: { $t: key => key } } })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([false])
  })

  it('点模块即 emit apply（config/engine/track/dev 四项 URL 载荷）', async () => {
    const wrapper = mount(ArmorSideConfig, { props: { tankId: 999 }, global: { mocks: { $t: key => key } } })
    await flushPromises()
    await wrapper.get('[data-testid="tank-track-0"]').trigger('click')
    await flushPromises()
    const payload = wrapper.emitted('apply').at(-1)[0]
    expect(payload.track).toBe(0)
    expect(payload.config).toBe(0)
    // engine 未显式传入：保持 resolveSetup 的最后一档，而不是 Number(null) -> 0
    expect(payload.engine).toBe(1)
    expect(payload.configChanged).toBe(false)
    expect(typeof payload.dev).toBe('string')
    expect(payload).not.toHaveProperty('upgrade')
    expect(payload).not.toHaveProperty('abilities')
  })

  it('provides XI initial/max controls with unchanged module IDs and resets to the top default', async () => {
    const { detail, modules } = upgradeFixtures[0]
    data.fetchTankData.mockResolvedValueOnce(detail)
    research.loadTankModules.mockResolvedValueOnce({ tanks: { [modules.stem]: modules } })
    const wrapper = mount(ArmorSideConfig, {
      props: { tankId: detail.tank_id, upgrade: 'top', expanded: false }, global: { mocks: { $t: key => key } },
    })
    await flushPromises()
    expect(wrapper.emitted('ready').at(-1)).toEqual([true])
    expect(wrapper.get('[data-testid="armor-side-config"]').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="tank-upgrade-top"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.findAll('.tp-module-tile')).toHaveLength(0)
    expect(wrapper.find('[data-testid="tank-upgrade-skills"]').exists()).toBe(false)
    await wrapper.get('[data-testid="tank-upgrade-stock"]').trigger('click')
    const stock = wrapper.emitted('apply').at(-1)[0]
    expect(stock).toMatchObject({ config: 0, configChanged: false, upgrade: 'stock' })
    expect(stock.abilities.every(Number.isInteger)).toBe(true)
    await wrapper.get('[data-testid="tank-config-reset"]').trigger('click')
    expect(wrapper.emitted('apply').at(-1)[0]).toMatchObject({ upgrade: 'top', abilities: [] })
  })

  it('keeps ordinary modules collapsed until expanded', async () => {
    const wrapper = mount(ArmorSideConfig, { props: { tankId: 999, expanded: false }, global: { mocks: { $t: key => key } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="armor-side-config"]').element.style.display).toBe('none')
    await wrapper.setProps({ expanded: true })
    expect(wrapper.get('[data-testid="armor-side-config"]').element.style.display).not.toBe('none')
  })
})
