// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import card from '../../../contracts/http/fixtures/creator-card.json'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import { getCreatorMetadata, listCreatorCategories, listCreators, removeCreator, saveCreator } from '../api/creators.js'
import { ApiError } from '../utils/http.js'
import { confirm } from '../composables/useConfirm.js'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import CreatorsPage from './CreatorsPage.vue'
import type { CreatorCard, CreatorMetadata } from '../api/creators.js'

const state = vi.hoisted(() => ({ auth: null as any, cards: [] as any[], categories: [] as any[], online: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: state.online.value, pending: false }) }) }))
vi.mock('../composables/useConfirm.js', () => ({ confirm: vi.fn(async () => true) }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(),
  listCreatorCategories: vi.fn(async () => state.categories), listCreators: vi.fn(async () => state.cards),
  getCreatorMetadata: vi.fn(async () => ({ categories: card.categories, levels: [], avatarUploadsAvailable: false })),
  getCreatorDetail: vi.fn(async () => detail), saveCreator: vi.fn(async () => detail),
  removeCreator: vi.fn(async () => { state.cards = [] }),
}))

let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.clearAllMocks(); state.cards = [structuredClone(card) as CreatorCard]; state.categories = structuredClone(card.categories); state.online = ref(true)
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'admin', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => 1 }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

async function publicPage(query = '') {
  state.auth.tokenParsed.value.realm_access.roles = []
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(`/?view=creators&lang=ru${query}#list`); await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'zh', messages })
  wrapper = mount(CreatorsPage, { attachTo: document.body, global: { plugins: [router, i18n] } })
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
    expect(listCreators).toHaveBeenCalledTimes(1); expect(listCreatorCategories).toHaveBeenCalledTimes(1)
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
    const reads = vi.mocked(listCreators).mock.calls.length
    await wrapper!.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    expect(listCreators).toHaveBeenCalledTimes(reads + 1)
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
  it('retains empty categories and uses a neutral summary for a missing category', async () => {
    state.categories.push({ id: 99, name: 'Empty category' }); state.cards = []
    await publicPage('&creatorCategory=999')
    expect(wrapper!.get('[data-testid=creator-filter-99]').isVisible()).toBe(true)
    await wrapper!.get('[data-testid=creator-categories-toggle]').trigger('click')
    expect(wrapper!.get('[data-testid=creator-selected-category]').text()).toBe('当前筛选')
    expect(wrapper!.get('[data-testid=creator-category-all]').attributes('aria-pressed')).toBe('false')
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
  it('disables an existing editor while reconnect refreshes metadata, then permits its save', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true } } })
    await flushPromises(); await wrapper.get(`[data-testid=creator-edit-${card.id}]`).trigger('click'); await flushPromises()
    state.online.value = false; await flushPromises()
    let resolveMetadata!: (value: CreatorMetadata) => void
    vi.mocked(getCreatorMetadata).mockReturnValueOnce(new Promise(done => { resolveMetadata = done }))
    state.online.value = true; await flushPromises()
    const save = wrapper.get('[data-testid=creator-save]')
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    ;(save.element as HTMLButtonElement).click(); await flushPromises(); expect(saveCreator).not.toHaveBeenCalled()
    resolveMetadata({ categories: card.categories, levels: [], avatarUploadsAvailable: false }); await flushPromises()
    expect((save.element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.get('[data-testid=creator-form]').trigger('submit'); await flushPromises()
    expect(saveCreator).toHaveBeenCalledWith(card.id, expect.objectContaining({ bilibiliUid: detail.bilibiliUid, avatarAction: 'KEEP' }), null, expect.any(AbortSignal))
    expect(wrapper.find('[data-testid=creator-editor-dialog]').exists()).toBe(false)
  })
  it('disables card management until slow metadata settles, then permits a confirmed removal', async () => {
    let resolveMetadata!: (value: CreatorMetadata) => void
    vi.mocked(getCreatorMetadata).mockReturnValueOnce(new Promise(done => { resolveMetadata = done }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true } } })
    await flushPromises()
    const remove = wrapper.get(`[data-testid=creator-remove-${card.id}]`)
    expect((remove.element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get(`[data-testid=creator-edit-${card.id}]`).element as HTMLButtonElement).disabled).toBe(true)
    ;(remove.element as HTMLButtonElement).click(); await flushPromises()
    expect(confirm).not.toHaveBeenCalled(); expect(removeCreator).not.toHaveBeenCalled()

    resolveMetadata({ categories: card.categories, levels: [], avatarUploadsAvailable: false }); await flushPromises()
    expect((remove.element as HTMLButtonElement).disabled).toBe(false)
    ;(remove.element as HTMLButtonElement).click(); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(removeCreator).toHaveBeenCalledWith(card.id, card.version, expect.any(AbortSignal))
    expect(wrapper.find(`[data-testid=creator-card-${card.id}]`).exists()).toBe(false)
  })
  it('captures the card version before confirmation and does not replace a newer list version when removing', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true } } })
    await flushPromises()
    let accept!: (value: boolean) => void
    vi.mocked(confirm).mockReturnValueOnce(new Promise(resolve => { accept = resolve }))
    await wrapper.get(`[data-testid=creator-remove-${card.id}]`).trigger('click')
    state.cards = [{ ...card, version: card.version + 1 }]
    await wrapper.get('[data-testid=creator-refresh]').trigger('click'); await flushPromises()
    vi.mocked(removeCreator).mockRejectedValueOnce(new ApiError({ errorCode: 'CREATOR_CONFIG_CONFLICT', status: 409 }))
    accept(true); await flushPromises()
    expect(removeCreator).toHaveBeenCalledWith(card.id, card.version, expect.any(AbortSignal))
    expect(wrapper.find(`[data-testid=creator-card-${card.id}]`).exists()).toBe(true)
  })
})
