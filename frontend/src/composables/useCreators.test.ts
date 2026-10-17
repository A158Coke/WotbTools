// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, nextTick, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import card from '../../../contracts/http/fixtures/creator-card.json'
import { useCreators } from './useCreators.js'
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
function fixture() {
  const online = ref(true), auth = { authenticated: ref(false), authInitState: ref('unauthenticated'), tokenParsed: ref(null) }
  const route = reactive({ path: '/', query: { view: 'creators', lang: 'ru' } as Record<string, string>, hash: '#list' })
  const api = { listCreatorCategories: vi.fn(async () => card.categories), listCreators: vi.fn(async () => [card]) }
  const availability = { publicCategories: ref(card.categories), loading: ref(false), error: ref(null), contentKnown: ref(true), refresh: vi.fn(async () => {}) }
  const router = { push: vi.fn(async () => {}), replace: vi.fn(async (location: any) => { route.query = location.query }) }, scope = effectScope()
  const owner = scope.run(() => useCreators({ api, auth, route, router, availability, network: () => ({ available: online.value }) } as any))!
  return { owner, api, auth, online, route, router, scope, availability }
}
describe('public creator directory ownership', () => {
  it.each(['authenticated', 'unauthenticated', 'failed'])('waits for slow authentication before reconciling an empty-category deep link: %s', async settledState => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/?view=creators&creatorCategory=99&lang=ru#list'); await router.isReady()
    const auth = { authenticated: ref(false), authInitState: ref('idle'), tokenParsed: ref<unknown>(null) }
    const availability = { publicCategories: ref(card.categories), contentKnown: ref(true), loading: ref(false), error: ref(null), refresh: vi.fn(async () => {}) }
    const api = { listCreators: vi.fn(async () => []) }
    const host = mount(defineComponent({ setup() { useCreators({ auth, availability, api } as any); return () => null } }), { global: { plugins: [router] } })
    try {
      await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBe('99')
      auth.authInitState.value = 'initializing'; await flushPromises()
      expect(router.currentRoute.value.query.creatorCategory).toBe('99')
      // Match useAuth.projectSession ordering: identity is projected before the settled state.
      if (settledState === 'authenticated') {
        auth.authenticated.value = true
        auth.tokenParsed.value = { realm_access: { roles: ['tournament-admin'] } }
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
    expect(f.api.listCreatorCategories).not.toHaveBeenCalled()
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
    f.auth.tokenParsed.value = { realm_access: { roles: ['tournament-admin'] } } as any
    f.availability.contentKnown.value = true; await flushPromises(); expect(f.router.replace).not.toHaveBeenCalled()
    f.auth.tokenParsed.value = null; await flushPromises(); expect(f.router.replace).toHaveBeenCalledTimes(1); f.scope.stop()
  })
  it('invalidates a pre-refresh list instead of accepting its stale content after a write', async () => {
    const f = fixture(); await flushPromises()
    let old!: (value: typeof card[]) => void
    f.api.listCreators.mockReturnValueOnce(new Promise(resolve => { old = resolve }))
    f.route.query.creatorCategory = '1'; await flushPromises()
    const oldSignal = (f.api.listCreators.mock.calls.at(-1) as any)[1] as AbortSignal
    f.api.listCreators.mockResolvedValueOnce([{ ...card, id: 2 }]); await f.owner.refresh()
    old([card]); await flushPromises()
    expect(oldSignal.aborted).toBe(true); expect(f.owner.creators.value.map(value => value.id)).toEqual([2]); f.scope.stop()
  })
  it('does not start a list refresh after the owning page was unmounted during content checking', async () => {
    const f = fixture(); await flushPromises()
    let done!: () => void; f.availability.refresh.mockReturnValueOnce(new Promise(resolve => { done = resolve }))
    const pending = f.owner.refresh(), reads = f.api.listCreators.mock.calls.length
    f.scope.stop(); done(); await pending; expect(f.api.listCreators).toHaveBeenCalledTimes(reads)
  })
  it('loads anonymous records and navigates categories without private-user requests', async () => {
    const f = fixture(); await flushPromises()
    expect(f.owner.creators.value).toEqual([card]); expect(f.owner.adminAllowed.value).toBe(false)
    await f.owner.selectCategory(2)
    expect(f.router.push).toHaveBeenCalledWith({ path: '/', query: { view: 'creators', lang: 'ru', creatorCategory: '2' }, hash: '#list' }); f.scope.stop()
  })
  it('discards a slower old-category response and clears membership when changing filters', async () => {
    const f = fixture(); f.availability.publicCategories.value = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]; await flushPromises()
    let resolve!: (value: typeof card[]) => void
    f.api.listCreators.mockReturnValueOnce(new Promise(done => { resolve = done }))
    f.route.query.creatorCategory = '1'; await nextTick()
    expect(f.owner.creators.value).toEqual([])
    f.api.listCreators.mockResolvedValueOnce([{ ...card, id: 2 }]); f.route.query.creatorCategory = '2'; await nextTick(); await flushPromises()
    resolve([card]); await flushPromises(); expect(f.owner.creators.value.map(value => value.id)).toEqual([2]); f.scope.stop()
  })
  it('cancels remote work offline and refreshes once on reconnect', async () => {
    const f = fixture(); await flushPromises(); const before = f.api.listCreators.mock.calls.length
    f.online.value = false; await nextTick(); expect(f.owner.loading.value).toBe(false)
    f.online.value = true; await nextTick(); await flushPromises(); expect(f.api.listCreators).toHaveBeenCalledTimes(before + 1); f.scope.stop()
  })
})
