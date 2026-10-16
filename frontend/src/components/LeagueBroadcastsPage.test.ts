// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import LeagueBroadcastsPage from './LeagueBroadcastsPage.vue'
import type { BroadcastCategoryView, BroadcastSeason } from '../api/league-broadcasts.js'

const state = vi.hoisted(() => ({ admin: null as any, list: vi.fn(), season: vi.fn(), category: vi.fn(), createNode: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ isLeagueBroadcastAdmin: state.admin, tokenParsed: ref({ sub: 'user' }), authEpoch: () => 1 }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true, pending: false }) }) }))
vi.mock('../api/league-broadcasts.js', async original => ({ ...await original<object>(), listBroadcasts: state.list, getBroadcastSeason: state.season, getBroadcastCategory: state.category, createBroadcastNode: state.createNode }))
const season: BroadcastSeason = { id: 10, server: 'CN', year: 2026, name: 'Independent season', startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 4, rootCount: 1, replayCount: 1 }
const detail: BroadcastCategoryView = { season, category: { id: 20, seasonId: 10, type: 'POINTS' }, coverUploadAvailable: true,
  nodes: [{ id: 30, categoryId: 20, roundNumber: 1, format: null, replays: [{ id: 40, nodeId: 30, title: 'League final', url: 'https://example.org/video', matchDate: '2026-10-16', dayNumber: 7, groupLabel: 'Group A', groupNumber: null, bracket: null, teams: ['Followed', 'Other'], perspective: 'POV', coverId: '493199ec-c421-456b-a865-dcd69ef4c62a' }] }] }
async function page(url = '/?view=league-broadcasts&lbServer=CN&lbSeason=10&lbCategory=20') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(url); await router.isReady()
  const wrapper = mount(LeagueBroadcastsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true } } })
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.clearAllMocks(); state.admin = ref(false)
  state.list.mockImplementation(async server => ({ servers: ['CN', 'ASIA', 'NA', 'EU', 'LESTA'], seasons: server === 'CN' ? [season] : [], coverUploadAvailable: true }))
  state.season.mockResolvedValue({ season, categories: [detail.category], coverUploadAvailable: true })
  state.category.mockResolvedValue(detail)
  state.createNode.mockResolvedValue(detail)
})
describe('shared broadcast catalogue rendering', () => {
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
  it('shows existing category cards as a separate layer and never mixes all roots into a season', async () => {
    const { wrapper, router } = await page('/?view=league-broadcasts&lbServer=CN&lbSeason=10')
    expect(wrapper.find('[data-testid=broadcast-category-20]').exists()).toBe(true)
    expect(wrapper.find('[data-testid=broadcast-node-toggle-30]').exists()).toBe(false)
    await wrapper.get('[data-testid=broadcast-category-20]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.lbCategory).toBe('20')
    expect(wrapper.find('[data-testid=broadcast-node-toggle-30]').exists()).toBe(true)
    wrapper.unmount()
  })
  it('presents all five fixed server cards and does not expose mutation controls for an admin query alone', async () => {
    const { wrapper } = await page('/?view=league-broadcasts&admin=1')
    expect(wrapper.findAll('[data-testid^=broadcast-server-]')).toHaveLength(5)
    expect(wrapper.find('[data-testid=broadcast-new-season]').exists()).toBe(false)
    wrapper.unmount()
  })
})
