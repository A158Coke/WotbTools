// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import card from '../../../contracts/http/fixtures/creator-card.json'
import { listCreatorAdminCategories, removeCreator } from '../api/creators.js'
import { confirm } from '../composables/useConfirm.js'
import { messages } from '../locales/messages.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import CreatorsPage from './CreatorsPage.vue'
import type { CreatorCard, CreatorCategory } from '../api/creators.js'

const state = vi.hoisted(() => ({ auth: null as any, cards: [] as any[] }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true, pending: false }) }) }))
vi.mock('../composables/useConfirm.js', () => ({ confirm: vi.fn(async () => true) }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(),
  listCreatorCategories: vi.fn(async () => card.categories), listCreators: vi.fn(async () => state.cards),
  getCreatorFavorites: vi.fn(async () => ({ creatorIds: [] })),
  listCreatorAdminCategories: vi.fn(async () => card.categories), listCreatorLevels: vi.fn(async () => []),
  getCreatorSettings: vi.fn(async () => ({ favoriteThreshold: 200, avatarUploadsAvailable: false })),
  removeCreator: vi.fn(async () => { state.cards = [] }),
}))

let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.clearAllMocks(); state.cards = [structuredClone(card) as CreatorCard]
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'admin', realm_access: { roles: ['tournament-admin'] } }), authEpoch: () => 1 }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('creator public page management readiness', () => {
  it('disables card management until slow metadata settles, then permits a confirmed removal', async () => {
    let resolveCategories!: (value: CreatorCategory[]) => void
    vi.mocked(listCreatorAdminCategories).mockReturnValueOnce(new Promise(done => { resolveCategories = done }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators'); await router.isReady()
    wrapper = mount(CreatorsPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })], provide: { [DIALOG_INLINE_KEY]: true } } })
    await flushPromises()
    const remove = wrapper.get(`[data-testid=creator-remove-${card.id}]`)
    expect((remove.element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get(`[data-testid=creator-edit-${card.id}]`).element as HTMLButtonElement).disabled).toBe(true)
    ;(remove.element as HTMLButtonElement).click(); await flushPromises()
    expect(confirm).not.toHaveBeenCalled(); expect(removeCreator).not.toHaveBeenCalled()

    resolveCategories(card.categories); await flushPromises()
    expect((remove.element as HTMLButtonElement).disabled).toBe(false)
    ;(remove.element as HTMLButtonElement).click(); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(removeCreator).toHaveBeenCalledWith(card.id, expect.any(AbortSignal))
    expect(wrapper.find(`[data-testid=creator-card-${card.id}]`).exists()).toBe(false)
  })
})
