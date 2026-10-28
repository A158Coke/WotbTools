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
    27905: { name: 'Object 432U', tier: 11, is_premium: true },
  })),
  fetchTankData: vi.fn(),
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
  // 逐车内容框（科技树/坦克百科同一裁剪实现）；夹具给一个合法框验证 transform 生效
  loadTankIconCrops: vi.fn(async () => ({
    1: { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 128, h: 100 },
  })),
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
    expect(previewCell.text()).toContain('Object 432U') // 名称来自 tank_cache
    expect(previewCell.text()).toContain('XI')
    // 连线：两端都在树上的一条
    expect(wrapper.findAll('path.tt-edge')).toHaveLength(1)
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

  it('等级条（客户端 LevelCell 语义）：minLevel..maxLevel 逐列罗马数字（other 树列 1..7 = IV..X）', async () => {
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
    expect(ruler[0].text()).toBe('IV')
    expect(ruler[1].text()).toBe('V')
  })

  it('XI 预览列：等级条窗口含 11（真实数据列连续 1..11 → I..XI）', async () => {
    // 真实 ussr 数据列 1..11 连续（每列 ≥1 节点）：XI 列末格 = 罗马 XI。
    research.loadTechTree.mockImplementation(async nation => ({
      meta: { nation, premiumRows: 2 },
      nodes: [
        ...Array.from({ length: 10 }, (_, i) => ({
          stem: `V${i + 1}`, tankId: i + 1, tier: i + 1, x: i + 1, y: 5,
        })),
        { stem: 'R230_Object_432U', tankId: 27905, tier: 11, x: 11, y: 8, preview: true },
      ],
      pending: [],
      edges: [],
    }))
    const { wrapper } = await mountView()
    const ruler = wrapper.findAll('.tt-ruler-cell')
    expect(ruler).toHaveLength(11)
    expect(ruler[0].text()).toBe('I')
    expect(ruler[9].text()).toBe('X')
    expect(ruler[10].text()).toBe('XI')
  })

  it('金币车带在树**顶部**：覆盖最小 y 起连续含金币车的行，标签在带内', async () => {
    // 数据事实：premium 车放最小 y 行（ussr y=2）。缓存里把 tank 1 标成金币车。
    data.fetchTankEncyclopedia.mockResolvedValueOnce({
      1: { name: 'T-26', tier: 1, is_premium: true },
      2: { name: 'MT-25', tier: 6 },
    })
    const { wrapper } = await mountView()
    const band = wrapper.find('[data-testid="techtree-premium-band"]')
    expect(band.exists()).toBe(true)
    // 高度 = 1 行 × 96（只有 y=5 这一行含金币车，y=9 不含 → 不扩到两行）
    expect(band.attributes('style')).toContain('height: 96px')
    expect(band.text()).toContain('research.premium_band')
  })

  it('树里没有金币车时不出带子（不渲染空占位）', async () => {
    data.fetchTankEncyclopedia.mockResolvedValueOnce({
      1: { name: 'T-26', tier: 1 },
      2: { name: 'MT-25', tier: 6 },
    })
    const { wrapper } = await mountView()
    expect(wrapper.find('[data-testid="techtree-premium-band"]').exists()).toBe(false)
  })
})

describe('研发态（?tank=）', () => {
  const MODULES = {
    tankId: 1, tier: 1, optDevicePreset: 'defaultPreset', consumableSlots: 1, provisionSlots: 1,
    chassis: [
      { stem: 'track0', localId: 0, level: 1, unlocks: [{ kind: 'chassis', stem: 'track1', cost: { xp: 500 } }], stats: {} },
      { stem: 'track1', localId: 1, level: 2, unlocks: [], stats: {} },
    ],
    engines: [{ stem: 'eng0', localId: 0, level: 1, unlocks: [], stats: {} }],
    turrets: [
      { stem: 't0', localId: 0, level: 1, unlocks: [], guns: [
        { stem: 'g0', localId: 0, level: 1, unlocks: [{ kind: 'gun', stem: 'g1', cost: { xp: 200 } }], stats: {} },
        { stem: 'g1', localId: 1, level: 2, unlocks: [], stats: {} },
      ] },
    ],
  }
  const DETAIL = {
    tank_id: 1, name: 'T-26', tier: 1, nation: 'ussr',
    configs: [
      { label: 'T-26', turret_local: 0, gun_local: 0 },
      { label: 'T-26', turret_local: 0, gun_local: 1 },
    ],
  }

  it('节点点击写 ?tank=；模块数据缺失时面板降级为提示', async () => {
    data.fetchTankData.mockResolvedValue(DETAIL)
    research.loadTankModules.mockRejectedValue(new Error('404'))
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-testid="techtree-cell-T-26"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBe('1')
    // 模块缺失：研发面板不出，但有降级提示
    expect(wrapper.find('[data-testid="research-panel"]').exists()).toBe(false)
  })

  it('客户端布局：左前驱车列 + 当前车面板 + 右模块网格；无配置下拉', async () => {
    data.fetchTankData.mockResolvedValue(DETAIL)
    research.loadTankModules.mockResolvedValue({ tanks: { 'T-26': MODULES } })
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-testid="techtree-cell-T-26"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="research-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="research-current-tank"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="research-grid"]').exists()).toBe(true)
    // 不再用下拉选配置（用户 2026-10-27 要求点击安装）
    expect(wrapper.find('[data-testid="research-config"]').exists()).toBe(false)
    expect(router.currentRoute.value.query.tank).toBe('1')
  })

  it('点击模块节点即安装：炮节点写对应 config；履带节点写 track 下标', async () => {
    data.fetchTankData.mockResolvedValue(DETAIL)
    research.loadTankModules.mockResolvedValue({ tanks: { 'T-26': MODULES } })
    const { wrapper, router } = await mountView()
    await wrapper.find('[data-testid="techtree-cell-T-26"]').trigger('click')
    await flushPromises()
    // 装 g1（炮塔 t0 的第二门炮）→ config 1
    await wrapper.find('[data-testid="research-node-gun-g1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.config).toBe('1')
    // 装 track1 → track 1，config 保持
    await wrapper.find('[data-testid="research-node-chassis-track1"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.track).toBe('1')
    expect(router.currentRoute.value.query.config).toBe('1')
  })
})
