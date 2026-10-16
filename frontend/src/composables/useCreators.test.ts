// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import card from '../../../contracts/http/fixtures/creator-card.json'
import { useCreators } from './useCreators.js'
vi.mock('./useFeatureGate.js', () => ({ useFeatureGate: () => ({ availability: () => ({ available: true }) }) }))
function fixture() {
  const online = ref(true), auth = { authenticated: ref(false), tokenParsed: ref(null) }
  const route = reactive({ path: '/', query: { view: 'creators', lang: 'ru' } as Record<string, string>, hash: '#list' })
  const api = { listCreatorCategories: vi.fn(async () => card.categories), listCreators: vi.fn(async () => [card]) }
  const router = { push: vi.fn(async () => {}) }, scope = effectScope()
  const owner = scope.run(() => useCreators({ api, auth, route, router, network: () => ({ available: online.value }) } as any))!
  return { owner, api, auth, online, route, router, scope }
}
describe('public creator directory ownership', () => {
  it('loads anonymous records and navigates categories without private-user requests', async () => {
    const f = fixture(); await flushPromises()
    expect(f.owner.creators.value).toEqual([card]); expect(f.owner.adminAllowed.value).toBe(false)
    await f.owner.selectCategory(2)
    expect(f.router.push).toHaveBeenCalledWith({ path: '/', query: { view: 'creators', lang: 'ru', creatorCategory: '2' }, hash: '#list' }); f.scope.stop()
  })
  it('discards a slower old-category response and clears membership when changing filters', async () => {
    const f = fixture(); await flushPromises()
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
