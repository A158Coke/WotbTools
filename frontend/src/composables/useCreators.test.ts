// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import card from '../../../contracts/http/fixtures/creator-card.json'
import { useCreators } from './useCreators.js'

vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fixture(authed = true) {
  let epoch = 1
  const online = ref(true)
  const auth = { authenticated: ref(authed), authInitState: ref(authed ? 'authenticated' : 'unauthenticated'), tokenParsed: ref({ sub: 'a', realm_access: { roles: ['wotbtools-user'] } }), authEpoch: () => epoch, login: vi.fn(async () => true) }
  const route = reactive({ path: '/', query: { view: 'creators', lang: 'ru' } as Record<string, string>, hash: '#list' })
  const transport = { listCreatorCategories: vi.fn(async () => card.categories), listCreators: vi.fn(async () => [{ ...card }]),
    getCreatorFavorites: vi.fn(async () => ({ creatorIds: [] as number[] })), setCreatorFavorite: vi.fn(async (_id: number, active: boolean) => ({ creator: { ...card, score: 7, favoriteCount: 200 }, active })) }
  const router = { push: vi.fn(async () => {}) }, scope = effectScope()
  const owner = scope.run(() => useCreators({ api: transport, auth, route, router, network: () => ({ available: online.value }) } as any))!
  return { owner, transport, auth, online, route, router, scope, changeIdentity: () => { epoch++; auth.tokenParsed.value = { sub: 'b', realm_access: { roles: ['wotbtools-user'] } } } }
}
describe('creator catalog and account-private favorite ownership', () => {
  it('renders public data anonymously and keeps the complete destination when requesting login', async () => {
    const f = fixture(false); await flushPromises()
    expect(f.owner.creators.value).toHaveLength(1)
    expect(f.transport.getCreatorFavorites).not.toHaveBeenCalled()
    await f.owner.toggleFavorite(card.id)
    expect(f.auth.login).toHaveBeenCalledWith({ path: '/', query: { view: 'creators', lang: 'ru' }, hash: '#list' })
    expect(f.transport.setCreatorFavorite).not.toHaveBeenCalled(); f.scope.stop()
  })
  it('applies authoritative score/count to the one shared record and deduplicates pending clicks', async () => {
    const f = fixture(); await flushPromises()
    const pending = deferred<any>(); f.transport.setCreatorFavorite.mockReturnValueOnce(pending.promise)
    const first = f.owner.toggleFavorite(card.id)
    await f.owner.toggleFavorite(card.id)
    expect(f.transport.setCreatorFavorite).toHaveBeenCalledTimes(1)
    pending.resolve({ creator: { ...card, score: 7, favoriteCount: 200 }, active: true }); await first
    expect(f.owner.favoriteIds.value.has(card.id)).toBe(true)
    expect(f.owner.creators.value[0].score).toBe(7)
    expect(f.owner.creators.value[0].favoriteCount).toBe(200)
    await f.owner.toggleFavorite(card.id)
    expect(f.transport.setCreatorFavorite).toHaveBeenLastCalledWith(card.id, false, expect.any(AbortSignal))
    expect(f.owner.favoriteIds.value.has(card.id)).toBe(false); f.scope.stop()
  })
  it('rejects a delayed favorite result after an account switch', async () => {
    const f = fixture(); await flushPromises()
    const pending = deferred<any>(); f.transport.setCreatorFavorite.mockReturnValueOnce(pending.promise)
    const first = f.owner.toggleFavorite(card.id)
    f.changeIdentity(); await nextTick(); await flushPromises()
    pending.resolve({ creator: { ...card, score: 10, favoriteCount: 900 }, active: true }); await first
    expect(f.owner.favoriteIds.value.size).toBe(0)
    expect(f.owner.creators.value[0].score).toBe(card.score)
    expect(f.owner.pendingIds.value.size).toBe(0); f.scope.stop()
  })
  it('isolates late category reads, preserves router ownership and only sorts by final score/creation/id', async () => {
    const f = fixture(); await flushPromises()
    const old = deferred<any>(); f.transport.listCreators.mockReturnValueOnce(old.promise)
    f.route.query.creatorCategory = '1'; await nextTick()
    f.transport.listCreators.mockResolvedValueOnce([{ ...card, id: 3, score: 8, favoriteCount: 0 }, { ...card, id: 2, score: 7, favoriteCount: 10000 }])
    f.route.query.creatorCategory = '2'; await nextTick(); await flushPromises()
    old.resolve([{ ...card, id: 99, score: 10 }]); await flushPromises()
    expect(f.owner.creators.value.map(value => value.id)).toEqual([3, 2])
    await f.owner.selectCategory(null)
    expect(f.router.push).toHaveBeenCalledWith({ path: '/', query: { view: 'creators', lang: 'ru' }, hash: '#list' }); f.scope.stop()
  })
  it('does not let a slower public refresh overwrite a successful favorite and resumes once after reconnect', async () => {
    const f = fixture(); await flushPromises()
    const old = deferred<any>(); f.transport.listCreators.mockReturnValueOnce(old.promise)
    const refresh = f.owner.refresh(); await f.owner.toggleFavorite(card.id)
    old.resolve([{ ...card, score: 2 }]); await refresh
    expect(f.owner.creators.value[0].score).toBe(7)
    f.online.value = false; await nextTick()
    const before = f.transport.listCreators.mock.calls.length
    f.online.value = true; await nextTick(); await flushPromises()
    expect(f.transport.listCreators).toHaveBeenCalledTimes(before + 1); f.scope.stop()
  })
  it('preserves new category membership when a favorite completes during the category read', async () => {
    const f = fixture(); await flushPromises()
    let resolveFavorite!: (value: any) => void
    f.transport.setCreatorFavorite.mockReturnValueOnce(new Promise(done => { resolveFavorite = done }))
    const favorite = f.owner.toggleFavorite(card.id), category = deferred<any>()
    f.transport.listCreators.mockReturnValueOnce(category.promise)
    f.route.query.creatorCategory = '2'; await nextTick()
    resolveFavorite({ creator: { ...card, score: 8 }, active: true }); await favorite
    category.resolve([{ ...card, id: 2, score: 6 }]); await flushPromises()
    expect(f.owner.creators.value.map(value => value.id)).toEqual([2])
    expect(f.owner.favoriteIds.value.has(card.id)).toBe(true); f.scope.stop()
  })
})
