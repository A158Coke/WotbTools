// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import card from '../../../contracts/http/fixtures/creator-card.json'
import detail from '../../../contracts/http/fixtures/creator-detail.json'
import { getCreatorMetadata, removeCreator, saveCreator } from '../api/creators.js'
import { confirm } from '../composables/useConfirm.js'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import CreatorsPage from './CreatorsPage.vue'
import type { CreatorCard, CreatorMetadata } from '../api/creators.js'

const state = vi.hoisted(() => ({ auth: null as any, cards: [] as any[], online: null as any }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: state.online.value, pending: false }) }) }))
vi.mock('../composables/useConfirm.js', () => ({ confirm: vi.fn(async () => true) }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(),
  listCreatorCategories: vi.fn(async () => card.categories), listCreators: vi.fn(async () => state.cards),
  getCreatorMetadata: vi.fn(async () => ({ categories: card.categories, levels: [], avatarUploadsAvailable: false })),
  getCreatorDetail: vi.fn(async () => detail), saveCreator: vi.fn(async () => detail),
  removeCreator: vi.fn(async () => { state.cards = [] }),
}))

let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.clearAllMocks(); state.cards = [structuredClone(card) as CreatorCard]; state.online = ref(true)
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'admin', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => 1 }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

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
    expect(removeCreator).toHaveBeenCalledWith(card.id, expect.any(AbortSignal))
    expect(wrapper.find(`[data-testid=creator-card-${card.id}]`).exists()).toBe(false)
  })
})
