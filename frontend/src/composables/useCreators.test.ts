// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, effectScope, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, useRoute } from 'vue-router'
import videoCard from '../../../contracts/http/fixtures/recommendation-card.json'
const card = { ...videoCard, id: 1, type: 'UP' as const, externalId: '123', targetUrl: 'https://space.bilibili.com/123', imageUrl: null, categories: [{ id: 1, name: 'Published', type: 'UP' as const }] }
import { useCreators } from './useCreators.js'
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
function fixture() {
  const type = ref<'UP' | 'VIDEO'>('UP')
  const online = ref(true), auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null) }
  const route = reactive({ path: '/', query: { view: 'creators', lang: 'ru' } as Record<string, string>, hash: '#list' })
  const api = { listRecommendationCategories: vi.fn(async () => card.categories), listRecommendations: vi.fn(async () => [card]) }
  const availability = { typeAvailable: () => true, publicCategories: ref(card.categories), loading: ref(false), error: ref(null), contentKnown: ref(true), refresh: vi.fn(async () => {}) }
  const router = { push: vi.fn(async () => {}), replace: vi.fn(async (location: any) => { route.query = location.query }) }, scope = effectScope()
  const owner = scope.run(() => useCreators({ type, api, auth, route, router, availability, network: () => ({ available: online.value }) } as any))!
  return { type, owner, api, auth, online, route, router, scope, availability }
}
describe('public creator directory ownership', () => {
  it('reconciles category after route-driven type props commit during push and browser history', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators&creatorCategory=1&keep=yes#list'); await router.isReady()
    const auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null) }
    const availability = { publicCategories: ref([{ id: 1, name: 'UP', type: 'UP' }, { id: 5, name: 'Video', type: 'VIDEO' }]), contentKnown: ref(true), loading: ref(false), error: ref(null), refresh: vi.fn(async () => {}) }
    const api = { listRecommendations: vi.fn(async () => []) }
    const Child = defineComponent({ props: ['type'], setup(props) { useCreators({ type: () => props.type, auth, availability, api } as any); return () => null } })
    const Parent = defineComponent({ components: { Child }, setup() { const route = useRoute(); const type = computed(() => route.query.view === 'recommended-videos' ? 'VIDEO' : 'UP'); return { type, shown: computed(() => availability.publicCategories.value.some(category => category.type === type.value)) } }, template: '<Child v-if="shown" :type="type" />' })
    const host = mount(Parent, { global: { plugins: [router] } })
    try {
      await flushPromises()
      await router.push('/?view=recommended-videos&creatorCategory=5&keep=yes#list'); await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBe('5')
      router.back(); await flushPromises(); expect(router.currentRoute.value.query.creatorCategory).toBe('1')
      router.forward(); await flushPromises(); expect(router.currentRoute.value.query.creatorCategory).toBe('5')
      expect(router.currentRoute.value.query.keep).toBe('yes'); expect(router.currentRoute.value.hash).toBe('#list')
      await router.push('/?view=recommended-videos&creatorCategory=1&keep=yes#list'); await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBeUndefined()
      await router.push('/?view=recommended-videos&creatorCategory=5&keep=yes#list'); await flushPromises()
      availability.publicCategories.value = []; await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBeUndefined()
      expect(router.currentRoute.value.query.keep).toBe('yes'); expect(router.currentRoute.value.hash).toBe('#list')
    } finally { host.unmount() }
  })
  it('never lets a late UP list replace a newer video list', async () => {
    const f = fixture(); await flushPromises()
    let done!: (value: typeof card[]) => void
    f.api.listRecommendations.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const old = f.owner.refresh(); await flushPromises()
    const video = { ...card, type: 'VIDEO', id: 12, externalId: 'BV1xx411c7mD' }
    f.api.listRecommendations.mockResolvedValueOnce([video] as any)
    f.type.value = 'VIDEO'; f.route.query.view = 'recommended-videos'; await flushPromises()
    expect(f.owner.categories.value).toEqual([])
    done([card]); await old; await flushPromises()
    expect(f.owner.creators.value).toEqual([video]); f.scope.stop()
  })
  it.each(['authenticated', 'unauthenticated', 'failed'])('waits for slow authentication before reconciling an empty-category deep link: %s', async settledState => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators&creatorCategory=99&lang=ru#list'); await router.isReady()
    const auth = { authenticated: ref(false), authInitState: ref('idle'), tokenParsed: ref<unknown>(null) }
    const availability = { typeAvailable: () => true, publicCategories: ref(card.categories), contentKnown: ref(true), loading: ref(false), error: ref(null), refresh: vi.fn(async () => {}) }
    const api = { listRecommendations: vi.fn(async () => []) }
    const host = mount(defineComponent({ setup() { useCreators({ auth, availability, api } as any); return () => null } }), { global: { plugins: [router] } })
    try {
      await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBe('99')
      auth.authInitState.value = 'initializing'; await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBe('99')
      // Match useAuth.projectSession ordering: identity is projected before the settled state.
      if (settledState === 'authenticated') {
        auth.authenticated.value = true
        auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } }
      }
      auth.authInitState.value = settledState; await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBe(settledState === 'authenticated' ? '99' : undefined)
      expect(router.currentRoute.value.query.lang).toBe('ru')
      expect(router.currentRoute.value.hash).toBe('#list')
    } finally { host.unmount() }
  })
  it('uses the shared public dictionary on mount and category switches, refreshing it only on request', async () => {
    const f = fixture(); await flushPromises()
    f.route.query.creatorCategory = '1'; await flushPromises()
    expect(f.api.listRecommendationCategories).not.toHaveBeenCalled()
    expect(f.availability.refresh).not.toHaveBeenCalled()
    await f.owner.refresh(); expect(f.availability.refresh).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it('replaces a disappeared public category without dropping unrelated location state', async () => {
    const f = fixture(); await flushPromises(); f.route.query.creatorCategory = '1'; await flushPromises()
    f.availability.publicCategories.value = []; await flushPromises()
    expect(f.router.replace).toHaveBeenCalledWith({ path: '/', query: { view: 'creators', lang: 'ru' }, hash: '#list' })
    f.scope.stop()
  })
  it('retains an unknown category until a successful snapshot and exempts ready administrators', async () => {
    const f = fixture(); f.availability.contentKnown.value = false; f.route.query.creatorCategory = '99'; await flushPromises()
    expect(f.router.replace).not.toHaveBeenCalled()
    f.auth.authenticated.value = true; f.auth.authInitState.value = 'authenticated'
    f.auth.tokenParsed.value = { realm_access: { roles: ['content-admin'] } } as any
    f.availability.contentKnown.value = true; await flushPromises(); expect(f.router.replace).not.toHaveBeenCalled()
    f.auth.tokenParsed.value = null; await flushPromises(); expect(f.router.replace).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it('invalidates a pre-refresh list instead of accepting its stale content after a write', async () => {
    const f = fixture(); await flushPromises()
    let old!: (value: typeof card[]) => void
    f.api.listRecommendations.mockReturnValueOnce(new Promise(resolve => { old = resolve }))
    f.route.query.creatorCategory = '1'; await flushPromises()
    const oldSignal = (f.api.listRecommendations.mock.calls.at(-1) as any)[2] as AbortSignal
    f.api.listRecommendations.mockResolvedValueOnce([{ ...card, id: 2 }]); await f.owner.refresh()
    old([card]); await flushPromises()
    expect(oldSignal.aborted).toBe(true); expect(f.owner.creators.value.map(value => value.id)).toEqual([2]); f.scope.stop()
  })
  it('does not start a list refresh after the owning page was unmounted during content checking', async () => {
    const f = fixture(); await flushPromises()
    let done!: () => void; f.availability.refresh.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const pending = f.owner.refresh(), reads = f.api.listRecommendations.mock.calls.length
    f.scope.stop(); done(); await pending; expect(f.api.listRecommendations).toHaveBeenCalledTimes(reads)
  })
  it('loads anonymous records and navigates categories without private-user requests', async () => {
    const f = fixture(); await flushPromises()
    expect(f.owner.creators.value).toEqual([card]); expect(f.owner.adminAllowed.value).toBe(false)
    await f.owner.selectCategory(2)
    expect(f.router.push).toHaveBeenCalledWith({ path: '/', query: { view: 'creators', lang: 'ru', creatorCategory: '2' }, hash: '#list' }); f.scope.stop()
  })
  it('discards a slower old-category response and clears membership when changing filters', async () => {
    const f = fixture(); f.availability.publicCategories.value = [{ id: 1, name: 'a', type: 'UP' as const }, { id: 2, name: 'b', type: 'UP' as const }]; await flushPromises()
    let resolve!: (value: typeof card[]) => void
    f.api.listRecommendations.mockReturnValueOnce(new Promise(done => { resolve = done }))
    f.route.query.creatorCategory = '1'; await nextTick()
    expect(f.owner.creators.value).toEqual([])
    f.api.listRecommendations.mockResolvedValueOnce([{ ...card, id: 2 }]); f.route.query.creatorCategory = '2'; await nextTick(); await flushPromises()
    resolve([card]); await flushPromises(); expect(f.owner.creators.value.map(value => value.id)).toEqual([2]); f.scope.stop()
  })
  it('cancels remote work offline and refreshes once on reconnect', async () => {
    const f = fixture(); await flushPromises(); const before = f.api.listRecommendations.mock.calls.length
    f.online.value = false; await nextTick(); expect(f.owner.loading.value).toBe(false)
    f.online.value = true; await nextTick(); await flushPromises(); expect(f.api.listRecommendations).toHaveBeenCalledTimes(before + 1); f.scope.stop()
  })
})
