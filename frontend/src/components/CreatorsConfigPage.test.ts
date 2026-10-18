// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { CREATOR_AVAILABILITY_KEY } from '../shared/creatorAvailability.js'
import { confirm } from '../composables/useConfirm.js'
import { messages } from '../locales/messages.js'
import CreatorsConfigPage from './CreatorsConfigPage.vue'
import { addRecommendationCategory, addCreatorLevel, saveRecommendation } from '../api/creators.js'

const state = vi.hoisted(() => ({ auth: null as any, epoch: 1 }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<typeof import('../composables/useAuth.js')>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
vi.mock('../api/creators.js', async original => ({ ...await original<typeof import('../api/creators.js')>(),
  getRecommendationMetadata: vi.fn(async (type: string) => ({ type, categories: [{ id: type === 'UP' ? 1 : 2, name: 'category', type }], levels: type === 'UP' ? [{ id: 1, name: 'level' }] : [], imageUploadsAvailable: false })), saveRecommendation: vi.fn(async () => ({ id: 1 })),
  addRecommendationCategory: vi.fn(async (type: string, name: string) => ({ id: 2, name })), addCreatorLevel: vi.fn(async (name: string) => ({ id: 2, name })),
}))
vi.mock('../composables/useConfirm.js', () => ({ confirm: vi.fn(async () => true) }))
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.clearAllMocks()
  state.epoch = 1
  state.auth = { authenticated: ref(true), authInitState: ref('authenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['content-admin'] } }), authEpoch: () => state.epoch }
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function host(stub = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?view=creators-config&keep=yes#form'); await router.isReady()
  wrapper = mount(CreatorsConfigPage, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh', messages })],
    provide: { [CREATOR_AVAILABILITY_KEY as symbol]: { recommendationsSupported: ref(true), typeAvailable: () => true, refreshPublicCategories: vi.fn(async () => {}) } },
    stubs: stub ? { CreatorForm: { template: '<div />' } } : {} } })
  await flushPromises(); return router
}
describe('creator configuration drafts', () => {
  it('locks type and route transitions until an in-flight save finishes', async () => {
    const router = await host(false)
    await wrapper!.get('[data-testid=creator-name]').setValue('New creator')
    await wrapper!.get('[data-testid=creator-uid]').setValue('123')
    await wrapper!.get('[data-testid=creator-category-1]').setValue(true)
    let reject!: (error: Error) => void
    vi.mocked(saveRecommendation).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    await wrapper!.get('[data-testid=creator-form]').trigger('submit'); await flushPromises()
    expect((wrapper!.get('[data-testid=recommendation-type-VIDEO]').element as HTMLButtonElement).disabled).toBe(true)
    await router.push('/?view=creators-config&recommendationType=VIDEO'); await flushPromises()
    expect(router.currentRoute.value.query.recommendationType).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()
    reject(new Error('network')); await flushPromises()
    expect((wrapper!.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('New creator')
    expect((wrapper!.get('[data-testid=recommendation-type-VIDEO]').element as HTMLButtonElement).disabled).toBe(false)
  })
  it('guards type switches and browser navigation, preserving rejected drafts and clearing only after approval', async () => {
    const router = await host(false)
    await wrapper!.get('[data-testid=creator-name]').setValue('Private draft')
    vi.mocked(confirm).mockResolvedValueOnce(false)
    await wrapper!.get('[data-testid=recommendation-type-VIDEO]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.recommendationType).toBeUndefined()
    expect((wrapper!.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('Private draft')
    vi.mocked(confirm).mockResolvedValueOnce(true)
    await wrapper!.get('[data-testid=recommendation-type-VIDEO]').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ recommendationType: 'VIDEO', keep: 'yes' })
    expect(router.currentRoute.value.hash).toBe('#form')
    expect(wrapper!.find('[data-testid=creator-assessed]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid=creator-new-level]').exists()).toBe(false)
    expect((wrapper!.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('')
    await wrapper!.get('[data-testid=creator-name]').setValue('Video draft')
    vi.mocked(confirm).mockResolvedValueOnce(false)
    router.back(); await flushPromises()
    expect(router.currentRoute.value.query.recommendationType).toBe('VIDEO')
    expect((wrapper!.get('[data-testid=creator-name]').element as HTMLInputElement).value).toBe('Video draft')
    vi.mocked(confirm).mockResolvedValueOnce(true)
    router.back(); await flushPromises()
    expect(router.currentRoute.value.query.recommendationType).toBeUndefined()
  })
  it.each([['category', addRecommendationCategory], ['level', addCreatorLevel]] as const)('accepts 100 emoji %s names and rejects 101 without UTF16 truncation', async (kind, add) => {
    await host()
    await flushPromises()
    const input = wrapper!.get(`[data-testid=creator-new-${kind}]`), form = input.element.closest('form')!
    expect(input.attributes('maxlength')).toBeUndefined()
    await input.setValue('😀'.repeat(100)); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(add).toHaveBeenCalledWith(...(kind === 'category' ? ['UP', '😀'.repeat(100), true, expect.any(AbortSignal)] : ['😀'.repeat(100), expect.any(AbortSignal)]))
    await input.setValue('😀'.repeat(101)); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(add).toHaveBeenCalledTimes(1)
    expect(wrapper!.find('[role=alert]').exists()).toBe(true)
  })
  it('clears dictionary drafts when switching between equally privileged administrators', async () => {
    await host()
    await flushPromises()
    await wrapper!.get('[data-testid=creator-new-category]').setValue('Account A private category')
    await wrapper!.get('[data-testid=creator-new-level]').setValue('Account A private level')
    state.epoch++; state.auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['content-admin'] } }
    await flushPromises()
    expect((wrapper!.get('[data-testid=creator-new-category]').element as HTMLInputElement).value).toBe('')
    expect((wrapper!.get('[data-testid=creator-new-level]').element as HTMLInputElement).value).toBe('')
  })
})
