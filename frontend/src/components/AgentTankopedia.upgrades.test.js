// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CATALOG, makeCache, UPGRADE_TANKS, createMountAt } from '../test/AgentTankopediaTestHelpers.js'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentTankopedia from './AgentTankopedia.vue'
import GunArcDiagram from './GunArcDiagram.vue'

const data = vi.hoisted(() => ({
  fetchTankEncyclopedia: vi.fn(),
  fetchTankData: vi.fn(),
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
  loadTankIconCrops: vi.fn(async () => null),
}))
vi.mock('../scene/agentData.js', () => data)

const research = vi.hoisted(() => ({ loadTankModules: vi.fn(), loadResearchCatalog: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async importOriginal => ({
  ...(await importOriginal()),
  loadTankModules: research.loadTankModules,
  loadResearchCatalog: research.loadResearchCatalog,
}))

const layout = vi.hoisted(() => ({ compact: false }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { useBreakpoint: () => ({ isCompact: computed(() => layout.compact), isExpanded: computed(() => !layout.compact) }) }
})
vi.mock('../../../common/tank_aliases.json', () => ({ default: { 999: ['大白兔', 'Death Star'] } }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: key => key === 'agentTanks.nations.ussr',
  }),
}))
const mountAt = createMountAt(AgentTankopedia)
describe('AgentTankopedia — XI 两端升级（真实客户端模块，受控弹表/装甲映射场景）', () => {
  beforeEach(() => {
    data.fetchTankEncyclopedia.mockReset().mockResolvedValue(makeCache())
    research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
  })

  function useTank(fixture) {
    const { detail, modules } = structuredClone(fixture)
    data.fetchTankData.mockReset().mockResolvedValue(detail)
    research.loadTankModules.mockReset().mockResolvedValue({ tanks: { [modules.stem]: modules } })
  }

  it.each(UPGRADE_TANKS)('$modules.name：缺省顶级，切 stock 再切回 top 的参数/装甲/俯角联动，技能三选一', async (fixture) => {
    useTank(fixture)
    const { wrapper, router } = await mountAt({ tank: String(fixture.modules.tankId), config: '0' })
    const hp = () => wrapper.find('[data-testid="tank-param-maxHealth"] .tp-param-value').text()
    const topHp = hp()
    const armorValues = () => wrapper.findAll('.tp-armor-table .tp-param-value').map(value => value.text())
    const topArmor = armorValues()
    const topPitch = JSON.parse(JSON.stringify(wrapper.findComponent(GunArcDiagram).props('pitchLimits')))
    expect(wrapper.find('[data-testid="tank-upgrade-top"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[data-testid="tank-upgrade-stock"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.findAll('[data-testid^="tank-ability-"]')).toHaveLength(3)
    expect(wrapper.findAll('.tp-skill-btn')).toHaveLength(20)
    const choices = fixture.modules.upgradeProgression.alternativeGroups[0].choices
    await wrapper.find(`[data-testid="tank-ability-${choices[2]}"]`).trigger('click')
    await flushPromises()
    expect(hp()).toBe(topHp)
    expect(router.currentRoute.value.query.abilities).toBe(String(choices[2]))
    await wrapper.find('[data-testid="tank-upgrade-stock"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ upgrade: 'stock', config: '0', abilities: String(choices[2]) })
    expect(hp()).not.toBe(topHp)
    if ([27905, 30241, 30497].includes(fixture.modules.tankId)) expect(armorValues()).not.toEqual(topArmor)
    else expect(armorValues()).toEqual(topArmor)
    const stockPitch = wrapper.findComponent(GunArcDiagram).props('pitchLimits')
    expect(stockPitch.max).toBeLessThan(topPitch.max)
    await wrapper.find('[data-testid="tank-upgrade-top"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ upgrade: 'top', config: '0', abilities: String(choices[2]) })
    expect(hp()).toBe(topHp)
    expect(armorValues()).toEqual(topArmor)
    expect(wrapper.findComponent(GunArcDiagram).props('pitchLimits')).toEqual(topPitch)
    expect(wrapper.findAll('[data-testid^="tank-ability-"][aria-checked="true"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('深链、浏览器前后导航及装甲跳转保留升级和所选技能', async () => {
    const fixture = UPGRADE_TANKS[0]
    useTank(fixture)
    const { wrapper, router } = await mountAt({ tank: String(fixture.modules.tankId), upgrade: 'stock', assets: 'https://assets.test' })
    const initial = wrapper.find('[data-testid="tank-param-maxHealth"] .tp-param-value').text()
    await router.push({ query: { ...router.currentRoute.value.query, upgrade: 'top', abilities: '24' } })
    await flushPromises()
    const top = wrapper.find('[data-testid="tank-param-maxHealth"] .tp-param-value').text()
    expect(top).not.toBe(initial)
    router.back()
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-param-maxHealth"] .tp-param-value').text()).toBe(initial)
    router.forward()
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-param-maxHealth"] .tp-param-value').text()).toBe(top)
    await wrapper.find('[data-testid="tank-open3d"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ view: 'agent-armor', upgrade: 'top', abilities: '24', assets: 'https://assets.test' })
    wrapper.unmount()
  })

  it('升级数据缺失时明确说明；不将普通车辆切到升级模式', async () => {
    const fixture = structuredClone(UPGRADE_TANKS[0])
    delete fixture.modules.upgradeProgression
    useTank(fixture)
    const { wrapper } = await mountAt({ tank: String(fixture.modules.tankId) })
    expect(wrapper.find('[data-testid="tank-upgrade-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-upgrades"]').exists()).toBe(false)
    wrapper.unmount()
    const normal = { detail: { ...fixture.detail, tier: 10 }, modules: { ...fixture.modules, tier: 10 } }
    useTank(normal)
    const { wrapper: old } = await mountAt({ tank: String(fixture.modules.tankId), upgrade: 'top', abilities: '24' })
    expect(old.find('[data-testid="tank-upgrade-unavailable"]').exists()).toBe(false)
    expect(old.find('[data-testid="tank-upgrades"]').exists()).toBe(false)
    expect(old.find('.tp-module-matrix').exists()).toBe(true)
    old.unmount()
  })

  it('XI 研发树消费归一化状态：手工多选同组备选只显示一项已研发（URL 互斥）', async () => {
    const fixture = UPGRADE_TANKS[0]
    useTank(fixture)
    const choices = fixture.modules.upgradeProgression.alternativeGroups[0].choices
    const opened = await mountAt({
      tank: String(fixture.modules.tankId), config: '0', upgrade: 'custom', abilities: choices.join(','),
    })
    await opened.wrapper.find('[data-testid="tank-open-research"]').trigger('click')
    await flushPromises()
    for (const [index, id] of choices.entries()) {
      expect(opened.wrapper.find(`[data-testid="tank-augment-sector-${id}"]`).attributes('aria-pressed'))
        .toBe(String(index === 0))
    }
    opened.wrapper.unmount()
  })
})

