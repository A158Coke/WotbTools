// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { BROADCAST_DISPLAY_ZONES } from '../utils/broadcastTime.js'
import LeagueBroadcastsPage from './LeagueBroadcastsPage.vue'
import type { BroadcastCategoryView, BroadcastSeason } from '../api/league-broadcasts.js'

const state = vi.hoisted(() => ({ admin: null as any, list: vi.fn(), season: vi.fn(), category: vi.fn(), createNode: vi.fn(), createSeason: vi.fn(), updateSeason: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ isLeagueBroadcastAdmin: state.admin, tokenParsed: ref({ sub: 'user' }), authEpoch: () => 1 }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true, pending: false }) }) }))
vi.mock('../api/league-broadcasts.js', async original => ({ ...await original<object>(), listBroadcasts: state.list, getBroadcastSeasonContents: state.category, createBroadcastNode: state.createNode, createBroadcastSeason: state.createSeason, updateBroadcastSeason: state.updateSeason }))
const season: BroadcastSeason = { id: 10, server: 'CN', year: 2026, nameZh: '独立赛事', nameEn: 'Independent season', nameRu: null, startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 4, rootCount: 1, replayCount: 1 }
const detail: BroadcastCategoryView = { defaultTimeZone: 'Asia/Shanghai', season, category: { id: 20, seasonId: 10, type: 'POINTS' }, coverUploadAvailable: true,
  nodes: [{ id: 30, categoryId: 20, roundNumber: 1, format: null, replays: [{ startsAt: null, id: 40, nodeId: 30, title: 'League final', url: 'https://example.org/video', matchDate: '2026-10-16', dayNumber: 7, groupNumber: 7, bracket: null, teams: ['Followed', 'Other'], perspective: 'POV', coverId: '493199ec-c421-456b-a865-dcd69ef4c62a' }] }] }
async function page(url = '/?view=league-broadcasts&lbServer=CN&lbSeason=10') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(url); await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'zh', messages })
  const wrapper = mount(LeagueBroadcastsPage, { global: { plugins: [router, i18n], provide: { [DIALOG_INLINE_KEY]: true } } })
  await flushPromises()
  return { wrapper, router, i18n }
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); state.admin = ref(false)
  state.list.mockImplementation(async server => ({ servers: ['CN', 'ASIA', 'NA', 'EU', 'LESTA'], seasons: server === 'CN' ? [season] : [], coverUploadAvailable: true }))
  state.season.mockResolvedValue({ season, categories: [detail.category], coverUploadAvailable: true })
  state.category.mockResolvedValue({ ...detail, categories: [detail.category] })
  state.createNode.mockResolvedValue(detail)
  state.createSeason.mockResolvedValue({ season, categories: [], coverUploadAvailable: true })
  state.updateSeason.mockResolvedValue({ season, categories: [], coverUploadAvailable: true })
})
describe('shared broadcast catalogue rendering', () => {
  it('uses server time by default, remembers only the viewing preference and keeps admin input independent', async () => {
    state.admin.value = true
    state.category.mockResolvedValue({ ...detail, categories: [detail.category], nodes: detail.nodes.map(node => ({ ...node, replays: node.replays.map(replay => ({ ...replay, startsAt: '2026-10-16T11:00:00Z' })) })) })
    const { wrapper } = await page()
    await wrapper.get('[data-testid=broadcast-node-toggle-30]').trigger('click')
    expect(wrapper.get('[data-testid=broadcast-replay-40]').text()).toContain('2026-10-16 19:00 UTC+8')
    await wrapper.get('[data-testid=broadcast-display-time-zone]').setValue('UTC')
    expect(wrapper.get('[data-testid=broadcast-replay-40]').text()).toContain('2026-10-16 11:00 UTC')
    await wrapper.get('[data-testid=broadcast-edit-replay-40]').trigger('click')
    expect((wrapper.get('[data-testid=broadcast-input-time-zone]').element as HTMLSelectElement).value).toBe('480')
    expect((wrapper.get('[data-testid=broadcast-time]').element as HTMLInputElement).value).toBe('19:00')
    wrapper.unmount()
    const next = await page()
    expect((next.wrapper.get('[data-testid=broadcast-display-time-zone]').element as HTMLSelectElement).value).toBe('UTC')
    next.wrapper.unmount()
  })
  it('keeps a date-only replay stable when selecting another viewing zone', async () => {
    const { wrapper } = await page()
    await wrapper.get('[data-testid=broadcast-node-toggle-30]').trigger('click')
    for (const zone of BROADCAST_DISPLAY_ZONES) {
      await wrapper.get('[data-testid=broadcast-display-time-zone]').setValue(zone)
      const text = wrapper.get('[data-testid=broadcast-replay-40]').text()
      expect(text).toContain('2026-10-16')
      expect(text).not.toContain('00:00')
      expect(text).not.toContain('UTC')
    }
    wrapper.unmount()
  })
  it.each([false, true])('shows empty categories and their management controls only to administrators (admin=%s)', async admin => {
    state.admin.value = admin
    const quarter = { id: 21, seasonId: 10, type: 'QUARTER_FINALS' }
    const semi = { id: 22, seasonId: 10, type: 'SEMI_FINALS' }
    state.category.mockResolvedValue({ ...detail, categories: [detail.category, quarter, semi], nodes: [...detail.nodes,
      { id: 31, categoryId: 21, roundNumber: null, format: 'KNOCKOUT', replays: [] }] })
    const { wrapper } = await page()
    expect(wrapper.find('[data-testid=broadcast-category-20]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=broadcast-category-21]').exists()).toBe(admin)
    expect(wrapper.find('[data-testid=broadcast-category-22]').exists()).toBe(admin)
    expect(wrapper.find('[data-testid=broadcast-new-node-22]').exists()).toBe(admin)
    expect(wrapper.find('[data-testid=broadcast-new-replay-31]').exists()).toBe(admin)
    if (admin) {
      await wrapper.get('[data-testid=broadcast-category-menu-22]').trigger('click')
      expect(wrapper.find('[data-testid=broadcast-delete-category-22]').exists()).toBe(true)
    }
    wrapper.unmount()
  })
  it.each([false, true])('keeps an empty state when all categories lack replays (empty nodes=%s)', async withEmptyNode => {
    state.category.mockResolvedValue({ ...detail, categories: [detail.category],
      nodes: withEmptyNode ? detail.nodes.map(node => ({ ...node, replays: [] })) : [] })
    const { wrapper } = await page()
    expect(wrapper.find('[data-testid=broadcast-category-20]').exists()).toBe(false)
    expect(wrapper.get('[data-testid=broadcast-nodes]').text()).toContain(messages.zh.leagueBroadcasts.noCategories)
    wrapper.unmount()
  })
  it.each([false, true])('does not reveal an empty category through an old deep link (empty nodes=%s)', async withEmptyNode => {
    state.category.mockResolvedValue({ ...detail, categories: [detail.category],
      nodes: withEmptyNode ? detail.nodes.map(node => ({ ...node, replays: [] })) : [] })
    const { wrapper } = await page('/?view=league-broadcasts&lbServer=CN&lbSeason=10&lbCategory=20')
    expect(wrapper.find('[data-testid=broadcast-category-20]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-node-toggle-30]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('hides empty categories after an administrator loses management permission', async () => {
    state.admin.value = true
    const semi = { id: 22, seasonId: 10, type: 'SEMI_FINALS' }
    state.category.mockResolvedValue({ ...detail, categories: [detail.category, semi] })
    const { wrapper } = await page()
    expect(wrapper.find('[data-testid=broadcast-category-22]').exists()).toBe(true)
    state.admin.value = false; await flushPromises()
    expect(wrapper.find('[data-testid=broadcast-category-22]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-category-20]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=broadcast-category-menu-22]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keeps roots collapsed, retains text on cover failure and retries the image on explicit refresh', async () => {
    const { wrapper } = await page()
    expect(wrapper.find('[data-testid=broadcast-replay-40]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-new-replay-30]').exists()).toBe(false)
    await wrapper.get('[data-testid=broadcast-node-toggle-30]').trigger('click')
    const row = wrapper.get('[data-testid=broadcast-replay-40]')
    expect(row.text()).toContain('第 7 天')
    expect(row.text()).toContain('第 1 轮积分赛')
    expect(row.get('a').attributes()).toMatchObject({ href: 'https://example.org/video', rel: 'noopener noreferrer', target: '_blank' })
    await row.get('img').trigger('error')
    expect(row.find('img').exists()).toBe(false)
    expect(row.text()).toContain('League final')
    expect(row.text()).toContain('追随 Followed')
    await wrapper.get('[data-testid=broadcast-refresh]').trigger('click')
    await flushPromises()
    expect(state.category).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid=broadcast-replay-40] img').attributes('src')).toContain(detail.nodes[0].replays[0].coverId)
    wrapper.unmount()
  })
  it('uses fixed translated group numbers while preserving replay titles and team names', async () => {
    const { wrapper, i18n } = await page()
    await wrapper.get('[data-testid=broadcast-node-toggle-30]').trigger('click')
    for (const [locale, label] of [['zh', '第7组'], ['en', 'Group 7'], ['ru', 'Группа 7']] as const) {
      i18n.global.locale.value = locale; await flushPromises()
      const row = wrapper.get('[data-testid=broadcast-replay-40]')
      expect(row.text()).toContain(label)
      expect(row.get('h3').text()).toBe('League final')
      expect(row.text()).toContain('Followed')
      expect(row.text()).toContain('Other')
    }
    wrapper.unmount()
  })
  it('omits an optional empty group in every language', async () => {
    state.category.mockResolvedValue({ ...detail, categories: [detail.category], nodes: detail.nodes.map(node => ({ ...node, replays: node.replays.map(replay => ({ ...replay, groupNumber: null })) })) })
    const { wrapper, i18n } = await page()
    await wrapper.get('[data-testid=broadcast-node-toggle-30]').trigger('click')
    for (const [locale, label] of [['zh', '组号待补'], ['en', 'Group number pending'], ['ru', 'Номер группы не указан']] as const) {
      i18n.global.locale.value = locale; await flushPromises()
      expect(wrapper.get('[data-testid=broadcast-replay-40]').text()).not.toContain(label)
    }
    wrapper.unmount()
  })
  it('shows management in the same subtree only for a real administrator and closes an editor when revoked', async () => {
    state.admin.value = true
    const { wrapper } = await page()
    await wrapper.get('[data-testid=broadcast-new-replay-30]').trigger('click')
    expect(wrapper.find('[data-testid=broadcast-replay-dialog]').exists()).toBe(true)
    state.admin.value = false; await flushPromises()
    expect(wrapper.find('[data-testid=broadcast-replay-dialog]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-new-replay-30]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=broadcast-node-toggle-30]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('renders season roots inline and expands old category deep links without a detail page', async () => {
    const { wrapper, router } = await page()
    expect(wrapper.find('[data-testid=broadcast-node-toggle-30]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=broadcast-replay-40]').exists()).toBe(false)
    await router.push('/?view=league-broadcasts&lbServer=CN&lbSeason=10&lbCategory=20'); await flushPromises()
    expect(wrapper.find('[data-testid=broadcast-replay-40]').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toContain('独立赛事')
    wrapper.unmount()
  })
  it('keeps category and individual-round management distinct without expanding a round', async () => {
    state.admin.value = true
    const { wrapper } = await page()
    await wrapper.get('[data-testid=broadcast-category-menu-20]').trigger('click')
    expect(wrapper.get('[role=menu]').text()).toContain('删除整个分类')
    await wrapper.get('[role=menu]').trigger('keydown', { key: 'Escape' })
    await wrapper.get('[data-testid=broadcast-node-menu-30]').trigger('click')
    expect(wrapper.find('[data-testid=broadcast-delete-node-30]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=broadcast-delete-category-20]').exists()).toBe(false)
    expect(wrapper.get('[data-testid=broadcast-node-toggle-30]').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })
  it('updates the list, heading, breadcrumbs and replay context with the current locale', async () => {
    state.admin.value = true
    const { wrapper, router, i18n } = await page('/?view=league-broadcasts&lbServer=CN')
    expect(wrapper.get('[data-testid=broadcast-season-10] h2').text()).toContain('独立赛事')
    i18n.global.locale.value = 'en'; await flushPromises()
    expect(wrapper.get('[data-testid=broadcast-season-10] h2').text()).toContain('Independent season')
    await router.push('/?view=league-broadcasts&lbServer=CN&lbSeason=10'); await flushPromises()
    expect(wrapper.get('h1').text()).toContain('Independent season')
    i18n.global.locale.value = 'ru'; await flushPromises()
    expect(wrapper.get('h1').text()).toContain('Independent season')
    expect(wrapper.get('.broadcast-breadcrumbs').text()).toContain('Independent season')
    await wrapper.get('[data-testid=broadcast-new-replay-30]').trigger('click')
    expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('Independent season')
    i18n.global.locale.value = 'zh'; await flushPromises()
    expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('独立赛事')
    expect(state.category).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('binds node creation and replay editing to their own inline category', async () => {
    state.admin.value = true
    const quarter = { id: 21, seasonId: 10, type: 'QUARTER_FINALS' }
    const semi = { id: 22, seasonId: 10, type: 'SEMI_FINALS' }
    state.category.mockResolvedValue({ ...detail, categories: [detail.category, quarter, semi], nodes: [...detail.nodes,
      { id: 31, categoryId: 21, roundNumber: null, format: 'KNOCKOUT', replays: [] }] })
    const { wrapper } = await page()
    await wrapper.get('[data-testid=broadcast-new-replay-31]').trigger('click')
    expect(wrapper.get('[data-testid=broadcast-replay-context]').text()).toContain('八强')
    await wrapper.findAll('[data-testid=broadcast-replay-dialog] button').find(button => button.text() === '取消')!.trigger('click')
    await wrapper.get('[data-testid=broadcast-new-node-22]').trigger('click')
    await wrapper.get('#broadcast-structure-form').trigger('submit'); await flushPromises()
    expect(state.createNode.mock.calls[0].slice(0, 2)).toEqual([22, { expectedVersion: 4, roundNumber: null, format: null }])
    wrapper.unmount()
  })
  it('requires trimmed Chinese and English names, limits all names and saves blank Russian as null', async () => {
    state.admin.value = true
    const { wrapper } = await page('/?view=league-broadcasts&lbServer=CN')
    await wrapper.get('[data-testid=broadcast-new-season]').trigger('click')
    const input = (language: string) => wrapper.get(`[data-testid=broadcast-season-name-${language}]`)
    expect(input('zh').attributes('required')).toBeDefined()
    expect(input('en').attributes('required')).toBeDefined()
    expect(input('ru').attributes('required')).toBeUndefined()
    await input('en').setValue(' New Horizons ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(state.createSeason).not.toHaveBeenCalled()
    await input('zh').setValue(' 新视野大师赛 ')
    await input('en').setValue(' ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(state.createSeason).not.toHaveBeenCalled()
    await input('en').setValue(' New Horizons ')
    for (const language of ['zh', 'en', 'ru']) {
      const original = (input(language).element as HTMLInputElement).value
      await input(language).setValue('x'.repeat(101))
      await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(state.createSeason).not.toHaveBeenCalled()
      await input(language).setValue(original)
    }
    await input('ru').setValue('  ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(state.createSeason.mock.calls[0][0]).toEqual({ server: 'CN', year: new Date().getFullYear(), nameZh: '新视野大师赛', nameEn: 'New Horizons', nameRu: null, startDate: null })
    wrapper.unmount()
  })
  it('edits all translations without using the currently displayed name as the stored value', async () => {
    state.admin.value = true
    const { wrapper, i18n } = await page('/?view=league-broadcasts&lbServer=CN')
    i18n.global.locale.value = 'ru'; await flushPromises()
    await wrapper.get('[data-testid=broadcast-edit-season-10]').trigger('click')
    expect((wrapper.get('[data-testid=broadcast-season-name-zh]').element as HTMLInputElement).value).toBe('独立赛事')
    expect((wrapper.get('[data-testid=broadcast-season-name-en]').element as HTMLInputElement).value).toBe('Independent season')
    expect((wrapper.get('[data-testid=broadcast-season-name-ru]').element as HTMLInputElement).value).toBe('')
    await wrapper.get('[data-testid=broadcast-season-name-ru]').setValue(' Независимый турнир ')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(state.updateSeason.mock.calls[0].slice(0, 2)).toEqual([10, { year: 2026, nameZh: '独立赛事', nameEn: 'Independent season', nameRu: 'Независимый турнир', startDate: null, expectedVersion: 4 }])
    wrapper.unmount()
  })
  it('presents all five fixed server cards and does not expose mutation controls for an admin query alone', async () => {
    const { wrapper } = await page('/?view=league-broadcasts&admin=1')
    expect(wrapper.findAll('[data-testid^=broadcast-server-]')).toHaveLength(5)
    for (const server of ['CN', 'ASIA', 'NA', 'EU', 'LESTA']) {
      const card = wrapper.get(`[data-testid=broadcast-server-${server}]`)
      expect(card.get('svg use').attributes('href')).toContain(`/broadcast-globes/${server.toLowerCase()}.svg#globe`)
      expect(card.get('svg').attributes('aria-hidden')).toBe('true')
      expect(card.get('.broadcast-server-code').text()).toBe(server === 'ASIA' ? 'APAC' : server)
    }
    expect(wrapper.find('[data-testid=broadcast-new-season]').exists()).toBe(false)
    wrapper.unmount()
  })
})
