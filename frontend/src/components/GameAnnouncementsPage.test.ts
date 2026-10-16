// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { messages } from '../locales/messages.js'
import GameAnnouncementsPage from './GameAnnouncementsPage.vue'
const state = vi.hoisted(() => ({ allowed: null as any, status: 'PUBLISHED', list: vi.fn(), detail: vi.fn(), latest: vi.fn() }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ isNewsAdmin: state.allowed, tokenParsed: ref({ sub: 'one' }), authEpoch: () => 1 }) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
vi.mock('../api/game-announcements.js', async original => ({ ...await original<object>(),
  listNewsSources: async () => [{ id: 'WG', enabled: true }, { id: 'LESTA', enabled: false }], listNewsCategories: async () => [],
  listNewsArticles: state.latest, listNewsArchives: state.list, getNewsArchive: state.detail,
}))
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  state.allowed = ref(true); state.status = 'PUBLISHED'; vi.clearAllMocks()
  state.detail.mockImplementation(async () => ({ id: 7, source: 'WG', title: 'Archive', version: '11.21', revision: 0, status: state.status,
    articles: [], categories: [], createdAt: '2026-10-17T00:00:00Z', reviewedBy: 'one', publishedAt: null, errorCode: null }))
  state.list.mockResolvedValue({ items: [], page: 1, size: 20, totalItems: 0 })
  state.latest.mockResolvedValue({ items: [], page: 1, size: 20, totalItems: 0, sync: { stale: false, lastSuccessfulFetchAt: null, nextRefreshAt: null } })
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
async function page(url = '/?view=game-announcements&newsTab=history&newsManage=1&newsArchive=7') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(url); await router.isReady()
  const wrapper = mount(GameAnnouncementsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'en', messages })] } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
describe('news public and management presentation', () => {
  it.each([
    ['PREPARING', []], ['FAILED', ['Retry preparation', 'Delete permanently']],
    ['PUBLISHED', ['Withdraw']], ['WITHDRAWN', ['Restore publication', 'Delete permanently']],
  ])('only offers legal lifecycle actions in %s', async (status, actions) => {
    state.status = status as string
    const wrapper = await page()
    expect(wrapper.get('[data-testid=news-archive-detail]').findAll('button').map(button => button.text())).toEqual(actions)
    expect(wrapper.find('[data-testid=news-archive-detail] input').exists()).toBe(false)
  })
  it('never loads private archives for a visitor at an explicit management deep link', async () => {
    state.allowed.value = false
    const wrapper = await page()
    expect(state.list).not.toHaveBeenCalled(); expect(state.detail).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('News or tournament administrator access is required.')
    expect(wrapper.find('.news-category-manager').exists()).toBe(false)
  })
  it('keeps Lesta disabled and does not attach admin UI to public source browsing', async () => {
    state.allowed.value = false
    const wrapper = await page('/?view=game-announcements')
    expect(wrapper.get('[data-testid=news-lesta]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid=news-open-editor]').exists()).toBe(false)
    expect(state.latest).toHaveBeenCalledWith(1, expect.any(AbortSignal))
    expect(wrapper.text()).toContain('Official cache refreshes every 12 hours.')
  })
})
