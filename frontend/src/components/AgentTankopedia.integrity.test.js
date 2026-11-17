// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { CATALOG, makeCache, UPGRADE_TANKS, createMountAt } from './AgentTankopedia.test-helpers.js'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentTankopedia from './AgentTankopedia.vue'

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
describe('AgentTankopedia — XI 数据完整性', () => {
  it('客户端规则存在但投影源缺字段时，不把初始数值标为已满级', async () => {
    const { detail, modules } = structuredClone(UPGRADE_TANKS[0])
    delete detail.configs[0].shells[0].damage
    data.fetchTankData.mockReset().mockResolvedValue(detail)
    data.fetchTankEncyclopedia.mockReset().mockResolvedValue(makeCache())
    research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
    research.loadTankModules.mockReset().mockResolvedValue({ tanks: { [modules.stem]: modules } })
    const { wrapper } = await mountAt({ tank: String(modules.tankId), upgrade: 'top' })
    expect(wrapper.find('[data-testid="tank-upgrade-top"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('agentTanks.configurator.upgrade_unsupported')
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('升级数据 unsupported 时 custom 也 fail-closed：不显示 stock 数值冒充已研发', async () => {
    const { detail, modules } = structuredClone(UPGRADE_TANKS[0])
    modules.gameVersion = 'release/11.99' // 版本不匹配 → supported=false
    data.fetchTankData.mockReset().mockResolvedValue(detail)
    data.fetchTankEncyclopedia.mockReset().mockResolvedValue(makeCache())
    research.loadResearchCatalog.mockReset().mockResolvedValue(CATALOG)
    research.loadTankModules.mockReset().mockResolvedValue({ tanks: { [modules.stem]: modules } })
    const { wrapper } = await mountAt({ tank: String(modules.tankId), upgrade: 'custom', abilities: '3,7,11,12' })
    expect(wrapper.find('[data-testid="tank-param-maxHealth"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

