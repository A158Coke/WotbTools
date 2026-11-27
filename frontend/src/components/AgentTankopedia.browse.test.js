// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCache, createMountAt } from '../test/AgentTankopediaTestHelpers.js'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AgentTankopedia from './AgentTankopedia.vue'

const data = vi.hoisted(() => ({
  fetchTankEncyclopedia: vi.fn(),
  fetchTankData: vi.fn(),
  loadTankMechanics: vi.fn(async () => null),
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
  loadTankIconCrops: vi.fn(async () => null),
}))
vi.mock('../scene/agentData.js', () => data)

const catalogProvider = vi.hoisted(() => ({
  imageUrl: vi.fn(path => `https://assets.test${path}`),
  url: vi.fn(path => `https://assets.test${path}`),
}))
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: catalogProvider }))

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
describe('AgentTankopedia', () => {
  beforeEach(() => {
    layout.compact = false
    data.fetchTankEncyclopedia.mockReset().mockResolvedValue(makeCache())
    data.fetchTankData.mockReset().mockResolvedValue({
      name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      configs: [{ label: 'Stock', shells: [{ type: 'ap', penetration: 250 }] }, { label: 'Top', shells: [{ type: 'ap', penetration: 300 }] }],
    })
  })
  afterEach(() => vi.useRealTimers())

  it('首屏只渲染一页卡片，图片懒加载并带固定尺寸；可继续加载', async () => {
    const { wrapper } = await mountAt()
    const cards = wrapper.findAll('[data-testid="tank-card"]')
    expect(cards).toHaveLength(48)
    const img = cards[0].find('.tp-media > img')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('width')).toBeTruthy()
    expect(img.attributes('height')).toBeTruthy()
    expect(cards[0].element.tagName).toBe('BUTTON')
    await wrapper.find('[data-testid="tank-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(96)
  })

  it('默认按等级从高到低排序，排序控件高亮「等级 ↓」', async () => {
    const { wrapper } = await mountAt()
    const cache = makeCache()
    const tiers = wrapper.findAll('[data-testid="tank-card"]')
      .map(card => cache[card.attributes('data-tank-id')].tier)
    expect(tiers).toHaveLength(48)
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a))
    expect(wrapper.find('#tp-sort [data-value="tier"]').classes()).toContain('is-active')
  })

  it('封面图按内容框数据做展示裁剪；数据缺失时回退原始 contain', async () => {
    data.loadTankIconCrops.mockResolvedValue({
      1: { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 141, h: 101 },
      999: { canvas_w: 256, canvas_h: 128, x: 0, y: 0, w: 148, h: 101 },
    })
    const { wrapper } = await mountAt({ tank: '999' })
    const hero = wrapper.find('.tp-media-lg > img')
    expect(hero.attributes('style')).toContain('translate(')
    expect(hero.attributes('style')).toContain('scale(')
    expect(wrapper.find('.tp-media-lg [data-testid="tank-cover-nation"]').exists()).toBe(true)
    wrapper.unmount()

    data.loadTankIconCrops.mockResolvedValue(null)
    const { wrapper: w2 } = await mountAt({ tank: '999' })
    const hero2 = w2.find('.tp-media-lg > img')
    expect(hero2.attributes('style') ?? '').not.toContain('scale(')
    w2.unmount()
  })

  it('筛选读写 URL：从 query 恢复，修改时 replace 写回', async () => {
    const { wrapper, router } = await mountAt({ nation: 'germany', tier: '5' })
    const names = wrapper.findAll('[data-testid="tank-card"]')
    expect(names.length).toBeGreaterThan(0)
    expect(wrapper.find('#tp-nation [data-value="germany"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('[data-testid="filter-nation"]').text()).toContain('agentTanks.nations.ussr')

    const replace = vi.spyOn(router, 'replace')
    await wrapper.find('#tp-tier [data-value=""]').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'germany' })
  })

  it('车辆类别从 URL 恢复并筛选，点选类别 replace 写回且保留其他筛选', async () => {
    const cache = makeCache()
    for (const tank of Object.values(cache)) {
      tank.is_premium = false
      tank.is_collector = false
    }
    cache[4].is_collector = true
    cache[14].is_premium = true
    data.fetchTankEncyclopedia.mockResolvedValue(cache)
    const { wrapper, router } = await mountAt({ nation: 'germany', tier: '5', category: 'collector' })
    const visibleIds = () => wrapper.findAll('[data-testid="tank-card"]').map(card => card.attributes('data-tank-id'))

    expect(wrapper.find('#tp-category [data-value="collector"]').attributes('aria-checked')).toBe('true')
    expect(visibleIds()).toEqual(['4'])
    expect(wrapper.find('[data-testid="tank-card"]').classes()).toContain('is-collector')

    const replace = vi.spyOn(router, 'replace')
    await wrapper.find('#tp-category [data-value="premium"]').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'germany', tier: '5', category: 'premium' })
    expect(visibleIds()).toEqual(['14'])
    expect(wrapper.find('[data-testid="tank-card"]').classes()).toContain('is-premium')

    await wrapper.find('#tp-category [data-value=""]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'germany', tier: '5' })
    expect(visibleIds()).toContain('4')
    expect(visibleIds()).toContain('14')
    expect(visibleIds().length).toBeGreaterThan(2)
    wrapper.unmount()
  })

  it('搜索即时筛选，防抖后写进 URL；无结果时显示空状态并可清除', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountAt({ tier: '10' })
    await wrapper.find('[data-testid="tank-search"]').setValue('is7')
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('is7')

    await wrapper.find('[data-testid="tank-search"]').setValue('zzzz-no-match')
    expect(wrapper.find('[data-testid="tank-empty"]').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-clear-filters"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia' })
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
  })

  it('别名搜索命中目标车辆；卡片与详情标题都显示正式车名', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountAt()
    await wrapper.find('[data-testid="tank-search"]').setValue('大白兔')
    const cards = wrapper.findAll('[data-testid="tank-card"]')
    expect(cards.map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('大白兔')

    await cards[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBe('999')
    expect(wrapper.find('h1').text()).toBe('IS-7')
    expect(wrapper.text()).not.toContain('大白兔')
    wrapper.unmount()

    const { wrapper: restored } = await mountAt({ q: '大白兔' })
    expect(restored.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text()))
      .toEqual(['IS-7'])
    restored.unmount()
  })

  it('加载失败显示错误态，重试后恢复', async () => {
    data.fetchTankEncyclopedia.mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountAt()
    expect(wrapper.find('[data-testid="tank-list-error"]').attributes('role')).toBe('alert')
    await wrapper.find('[data-testid="tank-list-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-list-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
  })

  it('加载中显示骨架屏', async () => {
    data.fetchTankEncyclopedia.mockReturnValueOnce(new Promise(() => {}))
    const { wrapper } = await mountAt()
    expect(wrapper.find('[data-testid="tank-skeleton"]').attributes('aria-busy')).toBe('true')
  })

  it('点击卡片 push 详情，返回保留筛选；配置写进 ?config=，入口携带配置', async () => {
    const { wrapper, router } = await mountAt({ nation: 'ussr', q: 'is7' })
    const push = vi.spyOn(router, 'push')
    await wrapper.find('[data-testid="tank-card"]').trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'ussr', q: 'is7', tank: '999' })
    expect(data.fetchTankData).toHaveBeenCalledWith(999)
    expect(wrapper.find('h1').text()).toBe('IS-7')

    const config = wrapper.find('[data-testid="tank-config"]')
    expect(config.element.value).toBe('1')
    await config.setValue('0')
    await flushPromises()
    expect(router.currentRoute.value.query.config).toBe('0')

    await wrapper.find('[data-testid="tank-open3d"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-armor', tank: '999', config: '0' })
  })

  it('加载更多 → 详情 → 返回保留增量条数', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
    await wrapper.find('[data-testid="tank-load-more"]').trigger('click')
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(96)
    await wrapper.findAll('[data-testid="tank-card"]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('IS-7')
    await wrapper.find('[data-testid="tank-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(96)
  })

  it('防抖窗口内进入详情：计时器继续提交 q，返回列表保留搜索', async () => {
    vi.useFakeTimers()
    const { wrapper, router } = await mountAt()
    await wrapper.find('[data-testid="tank-search"]').setValue('is7')
    const cards = wrapper.findAll('[data-testid="tank-card"]')
    expect(cards).toHaveLength(1)
    await cards[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBe('999')
    expect(router.currentRoute.value.query.q).toBeUndefined()
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('is7')
    await wrapper.find('[data-testid="tank-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('#tp-search').element.value).toBe('is7')
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
  })

  it('装甲查看器入口对全员可见（匿名 / 非管理员也不缺席）；返回列表保留筛选', async () => {
    const { wrapper, router } = await mountAt({ nation: 'ussr', tank: '999' })
    expect(wrapper.find('[data-testid="tank-open3d-card"]').exists()).toBe(true)
    await wrapper.find('[data-testid="tank-back"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia', nation: 'ussr' })
    expect(wrapper.findAll('[data-testid="tank-card"]').length).toBeGreaterThan(0)

    router.back()
    await flushPromises()
    expect(router.currentRoute.value.query.tank).toBeUndefined()
  })

  it('详情加载失败显示错误态与重试', async () => {
    data.fetchTankData.mockRejectedValueOnce(new Error('404'))
    const { wrapper } = await mountAt({ tank: '5' })
    expect(wrapper.find('[data-testid="tank-detail-error"]').exists()).toBe(true)
  })

  it('手机：筛选收进 sheet，已生效条件显示为 chip，可移除', async () => {
    layout.compact = true
    const { wrapper, router } = await mountAt({ nation: 'ussr' })
    expect(wrapper.find('[data-testid="tank-filters"]').exists()).toBe(false)
    const chips = wrapper.findAll('[data-testid="filter-chip"]')
    expect(chips).toHaveLength(1)
    await chips[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'agent-tankopedia' })
    await wrapper.find('[data-testid="filter-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"] [data-testid="tank-filters"]').exists()).toBe(true)
  })

  it('俯仰角与弹种数值按紧凑小数呈现，不直出 f32 扩宽尾数', async () => {
    data.fetchTankData.mockResolvedValue({
      name: 'SU-100M1', tier: 7, nation: 'ussr', type: 'AT-SPG', hp: 1150,
      speed_forward: 50, speed_reverse: 14,
      gun_depression: 2.299999952316284, gun_elevation: 18.5,
      configs: [{
        label: 'Top', view_range: 240,
        shells: [{ type: 'ap', penetration: 155.3000030517578, damage: 310, penetration_far: 194, velocity: 1015 }],
      }],
    })
    const { wrapper } = await mountAt({ tank: '999' })
    const text = wrapper.text()
    expect(text).toContain('2.3° / 18.5°')
    expect(text).toContain('155.3')
    expect(text).toContain('240 m')
    expect(text).not.toContain('2.299999952316284')
    expect(text).not.toContain('155.3000030517578')
  })

  it('俯仰角字段缺失时回退当前配置 pitch_limits（dep=max、ele=−min）', async () => {
    data.fetchTankData.mockResolvedValue({
      name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      configs: [{ label: 'Top', view_range: 250, pitch_limits: { max: 6, min: -18 }, shells: [] }],
    })
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.text()).toContain('6° / 18°')
  })

  it('俯仰角三层来源都缺失时显示 -，不显示 NaN', async () => {
    data.fetchTankData.mockResolvedValue({
      name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400,
      configs: [{ label: 'Top', shells: [] }],
    })
    const { wrapper } = await mountAt({ tank: '999' })
    expect(wrapper.text()).toContain('-° / -°')
  })
})

