// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { ApiError } from '../utils/http.js'
import { createMemoryHistory, createRouter } from 'vue-router'
import HoFPage from './HoFPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

let authenticated = true
let tokenClaims = null
const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined)),
  logout: vi.fn(() => Promise.resolve(undefined))
}))

const lbApi = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofVehicleOptions: vi.fn(() => Promise.resolve([])),
  hofUpload: vi.fn(() => Promise.resolve({ status: 'ok', arenaId: 'a1' })),
  hofDownload: vi.fn(() => Promise.resolve(undefined)),
  hofHundredList: vi.fn(() => Promise.resolve({ vehicleId: null, vehicleName: '', items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofHundredSubmit: vi.fn(() => Promise.resolve({ id: 1, status: 'PENDING' })),
  hofHundredCancel: vi.fn(() => Promise.resolve({ id: 1, status: 'CANCELLED' })),
  hofHundredMyStatus: vi.fn(() => Promise.resolve({ current: [], pending: [], rejected: [] })),
  hofMark3List: vi.fn(() => Promise.resolve({ vehicleId: null, vehicleName: '', items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofMark3Submit: vi.fn(() => Promise.resolve({ id: 3, status: 'PENDING' })),
  hofMark3Cancel: vi.fn(() => Promise.resolve({ id: 3, status: 'CANCELLED' })),
  hofMark3MyStatus: vi.fn(() => Promise.resolve({ current: [], pending: [], rejected: [] }))
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    isAuthenticated: () => authenticated,
    login: api.login,
    logout: api.logout,
    initPromise: Promise.resolve(true),
    tokenParsed: ref(tokenClaims)
  })
}))

vi.mock('../utils/api.js', () => lbApi)

const layout = vi.hoisted(() => ({ compact: false }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { useBreakpoint: () => ({ isCompact: computed(() => layout.compact), isExpanded: computed(() => !layout.compact) }) }
})

vi.mock('../utils/helpers.js', () => ({
  mapLabel: () => '',
  fileKey: file => [file.webkitRelativePath || file.name, file.size, file.lastModified].join(':')
}))

vi.mock('../utils/display.js', () => ({
  apiErrorLabel: (t, te, error) => (error?.code ? 'err:' + error.code : 'api-error'),
  replayValueLabel: (t, te, value) => value,
  formatDateTimeMinute: value => value || ''
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: key => key,
    te: () => true
  })
}))


/** 审计 PG-08：Tab / 筛选 / 页码进 URL，返回 / 刷新 / 分享都能恢复。 */
describe('HoFPage URL 状态', () => {
  async function mountAt(query) {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push({ path: '/', query: { view: 'hof', ...query } })
    const wrapper = mount(HoFPage, { global: { plugins: [router], mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } } })
    await flushPromises()
    return { wrapper, router }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    layout.compact = false
    lbApi.hofList.mockResolvedValue({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 5 })
    lbApi.hofVehicleOptions.mockResolvedValue([])
    lbApi.hofHundredList.mockResolvedValue({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })
    lbApi.hofHundredMyStatus.mockResolvedValue({ current: [], pending: [], rejected: [] })
  })

  it('打开带筛选的链接：按 URL 请求单场榜', async () => {
    await mountAt({ page: '3', tank: '4657', bt: 'RATING', nick: 'abc', limit: '100' })
    expect(lbApi.hofList).toHaveBeenCalledWith(expect.objectContaining({ page: 3, size: 100, tankId: 4657, battleType: 'RATING', nickname: 'abc' }))
  })

  // 审计 BZ-17：深链里的车辆不在当前选项中时，选择器仍显示为已选（能解析车名就显示车名，否则 #id）
  it('深链车辆不在选项里：选择器仍显示为已选，未知车名回退为 #id', async () => {
    const { wrapper } = await mountAt({ tank: '4657' })
    const box = wrapper.find('.hof-vehicle-select input[role="combobox"]')
    expect(box.attributes('data-value')).toBe('4657')
    expect(box.element.value).toBe('#4657')
    expect(wrapper.find('.lb-filter-hint strong').text()).toBe('#4657')
  })

  it('深链车辆能从 Tier X 车表或榜单行解析出车名时显示真实车名，而不是 #id', async () => {
    const { wrapper } = await mountAt({ tank: '385' })
    expect(wrapper.find('.hof-vehicle-select input[role="combobox"]').element.value).toBe('Progetto 65')

    lbApi.hofVehicleOptions.mockResolvedValue([{ tankId: 4657, tankName: '#4657', nation: 'GERMANY', type: 'HEAVY_TANK', tier: 8 }])
    lbApi.hofList.mockResolvedValue({
      items: [{ id: 9, rank: 1, nickname: 'A', tankId: 4657, tankName: 'Löwe', battleType: 'RANDOM', damageDealt: 5000, mapName: 'm', replayAvailable: false }],
      page: 1, size: 50, totalItems: 1, totalPages: 1,
    })
    const second = await mountAt({ tank: '4657' })
    expect(second.wrapper.find('.hof-vehicle-select input[role="combobox"]').element.value).toBe('Löwe')
    const labels = second.wrapper.findAll('.hof-vehicle-select [role="option"] .vp-label').map(label => label.text())
    expect(labels).toContain('Löwe')
    expect(labels).not.toContain('#4657')
  })

  it('打开百场链接：直接进入百场 Tab 并按车辆请求', async () => {
    await mountAt({ tab: 'hundred', tank: '12345', page: '2' })
    expect(lbApi.hofHundredList).toHaveBeenCalledWith(expect.objectContaining({ page: 2, vehicleId: 12345 }))
    expect(lbApi.hofList).not.toHaveBeenCalled()
  })

  it('切换 Tab 写进 URL；后退恢复上一个 Tab', async () => {
    const { wrapper, router } = await mountAt({})
    expect(router.currentRoute.value.query).toEqual({ view: 'hof' })
    const tabs = wrapper.findAll('.tabs button')
    await tabs[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'hof', tab: 'hundred' })
    // 外部导航（前进 / 后退）到单场第 2 页 → 页面跟随并重新请求
    lbApi.hofList.mockClear()
    await router.replace({ query: { view: 'hof', page: '2' } })
    await flushPromises()
    expect(wrapper.findAll('.tabs button')[0].classes()).toContain('active')
    expect(lbApi.hofList).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('离开名人堂（view 变了）后不再改写 URL', async () => {
    const { router } = await mountAt({})
    await router.replace({ query: { view: 'replay' } })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'replay' })
  })
})


/** 审计 PG-05：手机上筛选收进 sheet、已生效条件显示为 chip、列表改为卡片。 */
describe('HoFPage 手机布局', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    layout.compact = true
    lbApi.hofVehicleOptions.mockResolvedValue([])
    lbApi.hofList.mockResolvedValue({
      items: [{ id: 1, rank: 1, nickname: 'A', tankId: 7, tankName: 'Leopard 1', battleType: 'RANDOM', damageDealt: 10483, mapName: 'm', replayAvailable: true }],
      page: 1, size: 50, totalItems: 1, totalPages: 1,
    })
  })

  async function mountCompact(query = {}) {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push({ path: '/', query: { view: 'hof', ...query } })
    const wrapper = mount(HoFPage, { global: { plugins: [router], mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } } })
    await flushPromises()
    return wrapper
  }

  it('默认只显示「筛选」按钮与卡片，工具栏收起；点筛选打开 sheet', async () => {
    const wrapper = await mountCompact()
    expect(wrapper.find('[data-testid="hof-cards"]').exists()).toBe(true)
    expect(wrapper.find('.tablewrap').exists()).toBe(false)
    expect(wrapper.find('.lb-toolbar').exists()).toBe(false)
    await wrapper.findAll('[data-testid="filter-toggle"]')[0].trigger('click')
    expect(wrapper.find('.lb-toolbar-host.is-sheet .lb-toolbar').exists()).toBe(true)
    await wrapper.get('[data-testid="filter-done"]').trigger('click')
    expect(wrapper.find('.lb-toolbar').exists()).toBe(false)
  })

  it('已生效的筛选显示为 chip；移除 chip 清掉该条件并重新请求', async () => {
    const wrapper = await mountCompact({ bt: 'RATING', nick: 'abc' })
    const chips = wrapper.findAll('[data-testid="filter-chip"]').map(c => c.attributes('data-key'))
    expect(chips).toEqual(['bt', 'nick'])
    lbApi.hofList.mockClear()
    await wrapper.find('[data-testid="filter-chip"][data-key="bt"]').trigger('click')
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenCalledWith(expect.objectContaining({ battleType: '', nickname: 'abc', page: 1 }))
  })
})
