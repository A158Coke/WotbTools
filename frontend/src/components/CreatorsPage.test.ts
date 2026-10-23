// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { CREATOR_AVAILABILITY_KEY } from '../shared/creatorAvailability.js'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import videoCard from '../../../contracts/http/fixtures/recommendation-card.json'
const card = { ...videoCard, id: 1, type: 'UP' as const, externalId: '123', targetUrl: 'https://space.bilibili.com/123', imageUrl: null, categories: [{ id: 1, name: 'Published', type: 'UP' as const }] }
import videoDetail from '../../../contracts/http/fixtures/recommendation-detail.json'
const detail = { ...videoDetail, id: 1, type: 'UP' as const, externalId: '123', categoryIds: [1], imageUrl: null }
import { getRecommendationMetadata, listRecommendationCategories, listRecommendations, removeRecommendation, saveRecommendation } from '../api/creators.js'
import { ApiError } from '../utils/http.js'
import { confirm } from '../composables/useConfirm.js'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import CreatorsPage from './CreatorsPage.vue'
import type { RecommendationCard, RecommendationMetadata } from '../api/creators.js'

const state = vi.hoisted(() => ({ auth: null as any, cards: [] as any[], categories: [] as any[], online: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: state.online.value, pending: false }) }) }))
vi.mock('../composables/useConfirm.js', () => ({ confirm: vi.fn(async () => true) }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(),
  listRecommendationCategories: vi.fn(async () => state.categories), listRecommendations: vi.fn(async () => state.cards),
  getRecommendationMetadata: vi.fn(async () => ({ type: 'UP', categories: card.categories, levels: [], imageUploadsAvailable: false })),
  getRecommendationDetail: vi.fn(async () => detail), saveRecommendation: vi.fn(async () => detail),
  removeRecommendation: vi.fn(async () => { state.cards = [] }),
}))

let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.clearAllMocks(); state.cards = [structuredClone(card) as RecommendationCard]; state.categories = structuredClone(card.categories); state.online = ref(true)
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'admin', realm_access: { roles: ['content-admin'] } }), authEpoch: () => 1 }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

function availability() { return { typeAvailable: () => true, publicCategories: computed(() => state.categories), loading: ref(false), error: ref(null), contentKnown: ref(true), refresh: vi.fn(async () => {}), refreshPublicCategories: vi.fn(async () => {}) } }
async function publicPage(query = '') {
  state.auth.tokenParsed.value.realm_access.roles = []
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(`/?view=creators&lang=ru${query}#list`); await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'zh', messages })
  wrapper = mount(CreatorsPage, { attachTo: document.body, global: { plugins: [router, i18n], provide: { [CREATOR_AVAILABILITY_KEY as symbol]: availability() } } })
  await flushPromises()
  return { router, i18n }
}

describe('creator category disclosure', () => {
  it('starts collapsed and toggles without changing route, results or HTTP reads', async () => {
    const { router } = await publicPage()
    const toggle = wrapper!.get('[data-testid=creator-categories-toggle]')
    const options = wrapper!.get('[data-testid=creator-category-options]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-controls')).toBe(options.attributes('id'))
    expect(options.isVisible()).toBe(false)
    expect(wrapper!.get('[data-testid=creator-category-all]').attributes('aria-pressed')).toBe('true')
    const before = router.currentRoute.value.fullPath
    await toggle.trigger('click'); expect(options.isVisible()).toBe(true)
    await toggle.trigger('click'); expect(options.isVisible()).toBe(false)
    expect(document.activeElement).toBe(toggle.element)
    expect(router.currentRoute.value.fullPath).toBe(before)
    expect(listRecommendations).toHaveBeenCalledTimes(1); expect(listRecommendationCategories).not.toHaveBeenCalled()
    expect(wrapper!.findAll('.creator-card')).toHaveLength(1)
  })
  it('keeps the selected category visible in a collapsed summary and preserves state on refresh', async () => {
    const { router, i18n } = await publicPage()
    await wrapper!.get('[data-testid=creator-categories-toggle]').trigger('click')
    await wrapper!.get('[data-testid=creator-filter-1]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ creatorCategory: '1', lang: 'ru' })
    expect(router.currentRoute.value.hash).toBe('#list')
    await wrapper!.get('[data-testid=creator-categories-toggle]').trigger('click')
    expect(wrapper!.get('[data-testid=creator-selected-category]').text()).toContain(state.categories[0].name)
    const reads = vi.mocked(listRecommendations).mock.calls.length
    await wrapper!.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    expect(listRecommendations).toHaveBeenCalledTimes(reads + 1)
    expect(wrapper!.get('[data-testid=creator-category-options]').isVisible()).toBe(false)
    i18n.global.locale.value = 'ru'; await flushPromises()
    expect(wrapper!.get('[data-testid=creator-selected-category]').text()).toContain(state.categories[0].name)
    await wrapper!.get('[data-testid=creator-category-all]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.creatorCategory).toBeUndefined()
    expect(wrapper!.find('[data-testid=creator-selected-category]').exists()).toBe(false)
    expect(wrapper!.get('[data-testid=creator-category-options]').isVisible()).toBe(false)
  })
  it('opens for deep links and history transitions without resetting on an all-category transition', async () => {
    const { router } = await publicPage('&creatorCategory=1')
    expect(wrapper!.get('[data-testid=creator-category-options]').isVisible()).toBe(true)
    expect(wrapper!.get('[data-testid=creator-filter-1]').attributes('aria-pressed')).toBe('true')
    await wrapper!.get('[data-testid=creator-category-all]').trigger('click'); await flushPromises()
    expect(wrapper!.get('[data-testid=creator-category-options]').isVisible()).toBe(true)
    await wrapper!.get('[data-testid=creator-categories-toggle]').trigger('click')
    router.back(); await flushPromises()
    expect(wrapper!.get('[data-testid=creator-filter-1]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.get('[data-testid=creator-category-options]').isVisible()).toBe(true)
    router.forward(); await flushPromises()
    expect(wrapper!.get('[data-testid=creator-category-all]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.get('[data-testid=creator-category-options]').isVisible()).toBe(true)
  })
  it('replaces a missing public category with all while preserving query and hash', async () => {
    state.categories.push({ id: 99, name: 'Empty category', type: 'UP' as const }); state.cards = []
    const { router } = await publicPage('&creatorCategory=999')
    expect(wrapper!.get('[data-testid=creator-filter-99]').isVisible()).toBe(true)
    await wrapper!.get('[data-testid=creator-categories-toggle]').trigger('click')
    expect(router.currentRoute.value.query).toEqual({ view: 'creators', lang: 'ru' })
    expect(router.currentRoute.value.hash).toBe('#list')
    expect(wrapper!.get('[data-testid=creator-category-all]').attributes('aria-pressed')).toBe('true')
  })
  it('has no disclosure for an empty dictionary and does not hide the page', async () => {
    state.categories = []; state.cards = []
    await publicPage()
    expect(wrapper!.find('[data-testid=creators-page]').exists()).toBe(true)
    expect(wrapper!.get('[data-testid=creator-category-all]').isVisible()).toBe(true)
    expect(wrapper!.find('[data-testid=creator-categories-toggle]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=creator-category-options]').exists()).toBe(false)
  })
})

describe('creator public page management readiness', () => {
  it('refreshes added and removed empty administrator categories without publishing them', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    const publicState = availability()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })],
      provide: { [CREATOR_AVAILABILITY_KEY as symbol]: publicState } } })
    await flushPromises(); await wrapper.get('[data-testid=creator-categories-toggle]').trigger('click')
    let resolveMetadata!: (value: RecommendationMetadata) => void
    vi.mocked(getRecommendationMetadata).mockReturnValueOnce(new Promise(done => { resolveMetadata = done }))
    await wrapper.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    expect((wrapper.get('[data-testid=creator-refresh]').element as HTMLButtonElement).disabled).toBe(true)
    resolveMetadata({ type: 'UP', categories: [...card.categories, { id: 99, name: 'New empty category', type: 'UP' as const }], levels: [], imageUploadsAvailable: false })
    await flushPromises()
    expect(wrapper.get('[data-testid=creator-filter-99]').text()).toBe('New empty category')
    expect(publicState.publicCategories.value).toEqual(card.categories)
    await wrapper.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid=creator-filter-99]').exists()).toBe(false)
    expect(publicState.refresh).toHaveBeenCalledTimes(2)
    expect(listRecommendations).toHaveBeenCalledTimes(3)
  })
  it('preserves an open editor draft across a manual metadata refresh and keeps it on refresh failure', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })],
      provide: { [DIALOG_INLINE_KEY]: true, [CREATOR_AVAILABILITY_KEY as symbol]: availability() } } })
    await flushPromises(); await wrapper.get(`[data-testid=creator-edit-${card.id}]`).trigger('click'); await flushPromises()
    await wrapper.get('[data-testid=creator-name]').setValue('Unsaved editor draft')
    vi.mocked(getRecommendationMetadata).mockResolvedValueOnce({ type: 'UP', categories: [...card.categories, { id: 99, name: 'New empty category', type: 'UP' as const }], levels: [], imageUploadsAvailable: false })
    await wrapper.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('Unsaved editor draft')
    expect(wrapper.find('[data-testid=creator-category-99]').exists()).toBe(true)
    vi.mocked(getRecommendationMetadata).mockRejectedValueOnce(new ApiError({ errorCode: 'NETWORK_ERROR', retryable: true }))
    await wrapper.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    expect((wrapper.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('Unsaved editor draft')
    expect(wrapper.find('[data-testid=creator-category-99]').exists()).toBe(true)
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(saveRecommendation).not.toHaveBeenCalled()
  })
  it('shows full management categories only to administrators and removes them on role loss', async () => {
    state.categories = []
    vi.mocked(getRecommendationMetadata).mockResolvedValueOnce({ type: 'UP', categories: [{ id: 99, name: 'Empty admin category', type: 'UP' as const }], levels: [], imageUploadsAvailable: false })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators&creatorCategory=99&lang=ru#list'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })],
      provide: { [CREATOR_AVAILABILITY_KEY as symbol]: availability() } } })
    await flushPromises()
    expect(wrapper.get('[data-testid=creator-filter-99]').text()).toBe('Empty admin category')
    expect(router.currentRoute.value.query.creatorCategory).toBe('99')
    state.auth.tokenParsed.value.realm_access.roles = []; await flushPromises()
    expect(wrapper.find('[data-testid=creator-filter-99]').exists()).toBe(false)
    expect(router.currentRoute.value.query).toEqual({ view: 'creators', lang: 'ru' }); expect(router.currentRoute.value.hash).toBe('#list')
    expect(wrapper.find('[data-testid=creator-edit-1]').exists()).toBe(false)
  })
  it('disables an existing editor while reconnect refreshes metadata, then permits its save', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true, [CREATOR_AVAILABILITY_KEY as symbol]: availability() } } })
    await flushPromises(); await wrapper.get(`[data-testid=creator-edit-${card.id}]`).trigger('click'); await flushPromises()
    state.online.value = false; await flushPromises()
    let resolveMetadata!: (value: RecommendationMetadata) => void
    vi.mocked(getRecommendationMetadata).mockReturnValueOnce(new Promise(done => { resolveMetadata = done }))
    state.online.value = true; await flushPromises()
    const save = wrapper.get('[data-testid=creator-save]')
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    ;(save.element as HTMLButtonElement).click(); await flushPromises(); expect(saveRecommendation).not.toHaveBeenCalled()
    resolveMetadata({ type: 'UP', categories: card.categories, levels: [], imageUploadsAvailable: false }); await flushPromises()
    expect((save.element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.get('[data-testid=creator-form]').trigger('submit'); await flushPromises()
    expect(saveRecommendation).toHaveBeenCalledWith(card.id, expect.objectContaining({ externalId: detail.externalId, imageAction: 'KEEP' }), null, expect.any(AbortSignal))
    expect(wrapper.find('[data-testid=creator-editor-dialog]').exists()).toBe(false)
  })
  it('disables card management until slow metadata settles, then permits a confirmed removal', async () => {
    let resolveMetadata!: (value: RecommendationMetadata) => void
    vi.mocked(getRecommendationMetadata).mockReturnValueOnce(new Promise(done => { resolveMetadata = done }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true, [CREATOR_AVAILABILITY_KEY as symbol]: availability() } } })
    await flushPromises()
    const remove = wrapper.get(`[data-testid=creator-remove-${card.id}]`)
    expect((remove.element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get(`[data-testid=creator-edit-${card.id}]`).element as HTMLButtonElement).disabled).toBe(true)
    ;(remove.element as HTMLButtonElement).click(); await flushPromises()
    expect(confirm).not.toHaveBeenCalled(); expect(removeRecommendation).not.toHaveBeenCalled()

    resolveMetadata({ type: 'UP', categories: card.categories, levels: [], imageUploadsAvailable: false }); await flushPromises()
    expect((remove.element as HTMLButtonElement).disabled).toBe(false)
    ;(remove.element as HTMLButtonElement).click(); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(removeRecommendation).toHaveBeenCalledWith(card.id, 'UP', card.version, expect.any(AbortSignal))
    expect(wrapper.find(`[data-testid=creator-card-${card.id}]`).exists()).toBe(false)
  })
  it('captures the card version before confirmation and does not replace a newer list version when removing', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true, [CREATOR_AVAILABILITY_KEY as symbol]: availability() } } })
    await flushPromises()
    let accept!: (value: boolean) => void
    vi.mocked(confirm).mockReturnValueOnce(new Promise(resolve => { accept = resolve }))
    await wrapper.get(`[data-testid=creator-remove-${card.id}]`).trigger('click')
    state.cards = [{ ...card, version: card.version + 1 }]
    await wrapper.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    vi.mocked(removeRecommendation).mockRejectedValueOnce(new ApiError({ errorCode: 'CREATOR_CONFIG_CONFLICT', status: 409 }))
    accept(true); await flushPromises()
    expect(removeRecommendation).toHaveBeenCalledWith(card.id, 'UP', card.version, expect.any(AbortSignal))
    expect(wrapper.find(`[data-testid=creator-card-${card.id}]`).exists()).toBe(true)
  })
})
