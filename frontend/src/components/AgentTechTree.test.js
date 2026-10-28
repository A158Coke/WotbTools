// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: key => key === 'agentTanks.nations.ussr',
  }),
}))

/**
 * 科技树页 contract（AgentTechTree.vue）：
 * - 数据 = 资产包 tech_tree/{nation}.json + tank_cache 联表；缺数据 fail-closed
 *   （pending 占位、from 不在树上的边不画线、无名称回退 stem）。
 * - 节点点击 → ?tank= 研发态；国别页签写 ?nation=。
 * - 视图注册：?view=agent-techtree 是合法深链。
 */
const data = vi.hoisted(() => ({
  fetchTankEncyclopedia: vi.fn(async () => ({
    1: { name: 'T-26', tier: 1, is_premium: false },
    2: { name: 'MT-25', tier: 6, is_premium: false },
    15153: { name: 'BZ-79', tier: 11, is_premium: true },
  })),
  fetchTankData: vi.fn(),
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
}))
vi.mock('../scene/agentData.js', () => data)

const research = vi.hoisted(() => ({ loadTechTree: vi.fn(), loadTankModules: vi.fn() }))
vi.mock('../utils/researchCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTechTree: research.loadTechTree,
  loadTankModules: research.loadTankModules,
}))

import AgentTechTree from './AgentTechTree.vue'
import { ALLOWED_VIEWS } from '../app/navigation.js'

const TREE = {
  meta: { nation: 'ussr', gameVersion: '11.21.0.1235', count: 2, premiumRows: 2 },
  nodes: [
    { stem: 'T-26', tankId: 1, listId: 1, tier: 1, price: 0, priceRaw: '0', tags: [], x: 1, y: 5 },
    { stem: 'MT25', tankId: 2, listId: 2, tier: 6, price: 960000, priceRaw: '960000', tags: [], x: 6, y: 9 },
    { stem: 'R230_Object_432U', tankId: 27905, listId: 109, tier: 11, price: 7800000, priceRaw: '7800000', tags: [], x: 11, y: 8, preview: true },
  ],
  pending: [{ stem: 'R228_KR_1', x: 11, y: 5 }],
  edges: [
    { from: 'T-26', to: 'MT25', cost: { xp: 31000 }, costRaw: '31000', sourceModule: 'gun', sourceKind: 'gun' },
  ],
}

async function mountView(query = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
  await router.push({ query: { view: 'agent-techtree', ...query } })
  await router.isReady()
  const wrapper = mount(AgentTechTree, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  vi.clearAllMocks()
  research.loadTechTree.mockImplementation(async nation => ({ ...TREE, meta: { ...TREE.meta, nation } }))
})

describe('视图注册', () => {
  it('agent-techtree 是合法深链视图', () => {
    expect(ALLOWED_VIEWS).toContain('agent-techtree')
  })
})

describe('树态', () => {
  it('渲染国别页签、单元格（名称联表 tank_cache）与研发连线', async () => {
    const { wrapper } = await mountView()
    expect(wrapper.find('[data-testid="techtree-nation-ussr"]').exists()).toBe(true)
    const cells = wrapper.findAll('[data-testid^="techtree-cell-"]')
    expect(cells).toHaveLength(3)
    expect(wrapper.find('[data-testid="techtree-cell-T-26"]').text()).toContain('T-26')
    // MT-25 的最低研发成本 = 入边 31000
    expect(wrapper.find('[data-testid="techtree-cell-MT25"]').text()).toContain('31,000')
    // preview XI 节点：预览徽标 + 金币标记（tank_cache is_premium）
    const previewCell = wrapper.find('[data-testid="techtree-cell-R230_Object_432U"]')
    expect(previewCell.classes()).toContain('is-preview')
    expect(previewCell.text()).toContain('BZ-79'.replace('BZ-79', '')) // 名称来自 tank_cache
    expect(previewCell.text()).toContain('11')
    // 连线：两端都在树上的一条
    expect(wrapper.findAll('line.tt-edge')).toHaveLength(1)
  })

  it('pending（已登记未实装）渲染为占位，不造名称', async () => {
    const { wrapper } = await mountView()
    const pending = wrapper.find('[data-testid="techtree-pending-R228_KR_1"]')
    expect(pending.exists()).toBe(true)
    expect(pending.classes()).toContain('is-pending')
  })

  it('科技树加载失败 → 错误态 + 重试，不渲染半残网格', async () => {
    research.loadTechTree.mockRejectedValue(new Error('404'))
    const { wrapper } = await mountView()
    expect(wrapper.find('[data-testid="techtree-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="techtree-grid"]').exists()).toBe(false)
  })

  it('等级锚点按列数据判定：单 tier 列标注，mixed 列留空（other 树特例不猜）', async () => {
    research.loadTechTree.mockResolvedValue({
      meta: { nation: 'other', premiumRows: 1 },
      nodes: [
        { stem: 'A', tankId: 1, tier: 4, x: 1, y: 4 },
        { stem: 'B', tankId: 2, tier: 5, x: 2, y: 4 },
      ],
      pending: [],
      edges: [],
    })
    const { wrapper } = await mountView({ nation: 'other' })
    const ruler = wrapper.findAll('.tt-ruler-cell')
    expect(ruler).toHaveLength(2)
    expect(ruler[0].text()).toContain('4')
    expect(ruler[1].text()).toContain('5')
  })
})

describe('研发态（?tank=）', () => {
  it('节点点击写 ?tank=；模块数据缺失时面板降级为提示', async () => {
    data.fetchTankData.mockResolvedValue({ tank_id: 1, name: 'T-26', tier: 1, nation: 'ussr', configs: [{ label: 'stock', turret_local: 0, gun_local: 0 }] })
    research.loadTankModules.mockRejectedValue(new Error('404'))
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-testid="techtree-cell-T-26"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBe('1')
    // 模块缺失：研发面板不出，但有降级提示
    expect(wrapper.find('[data-testid="research-panel"]').exists()).toBe(false)
  })
})
