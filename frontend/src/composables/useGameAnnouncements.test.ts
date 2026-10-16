// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import * as api from '../api/game-announcements.js'
import { ApiError } from '../utils/http.js'
import { useGameAnnouncements } from './useGameAnnouncements.js'

const article: api.NewsArticle = { sourceKey: 'update', title: 'Update', sourceUrl: 'https://asia.wotblitz.com/en/news/updates/update/', language: 'en', publishedAtRaw: null, coverImageId: null, revision: 'hash', blocks: [{ id: 'b1', html: '<p>Original</p>' }], sync: null }
const archive: api.NewsArchive = { id: 7, source: 'WG', version: '11.21', title: 'Saved', status: 'PUBLISHED', revision: 2, categories: [], articles: [article], createdAt: '2026-10-17T00:00:00Z', reviewedBy: 'one', publishedAt: '2026-10-17T00:00:00Z', errorCode: null }
const stops: (() => void)[] = []
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers() })
async function setup(url = '/?view=game-announcements', overrides = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(url); await router.isReady()
  let epoch = 0
  const allowed = ref(true), tokenParsed = ref({ sub: 'one' }), online = ref(true)
  const transport = { ...api,
    listNewsSources: vi.fn(async () => [{ id: 'WG', enabled: true }, { id: 'LESTA', enabled: false }]),
    listNewsCategories: vi.fn(async () => [{ id: 1, name: 'General', type: 'GENERAL' }]),
    listNewsArticles: vi.fn(async (page: number) => ({ items: [article], page, size: 20, totalItems: 40, sync: { lastSuccessfulFetchAt: null, nextRefreshAt: null, stale: false } })),
    getNewsArticle: vi.fn(async () => article),
    listNewsArchives: vi.fn(async () => ({ items: [archive], page: 1, size: 20, totalItems: 1 })),
    getNewsArchive: vi.fn(async () => archive), createNewsArchives: vi.fn(async () => ({ archiveIds: [7], deletedIds: [] })),
    changeNewsArchive: vi.fn(async () => archive), deleteNewsArchive: vi.fn(async () => undefined), deleteNewsCategory: vi.fn(async () => undefined), ...overrides }
  const confirm = vi.fn(async () => true), scope = effectScope()
  const route = { get query() { return router.currentRoute.value.query }, get hash() { return router.currentRoute.value.hash } }
  const state = scope.run(() => useGameAnnouncements(route as any, router, { api: transport, auth: { isNewsAdmin: allowed, tokenParsed, authEpoch: () => epoch },
    gate: { availability: () => ({ available: online.value }) }, confirm } as any))!
  stops.push(() => scope.stop()); await flushPromises()
  return { state, transport, router, allowed, tokenParsed, online, confirm, changeAccount: () => { epoch++; tokenParsed.value = { sub: 'two' } } }
}
describe('news state and route ownership', () => {
  it('restores details and pagination with router Back/Forward', async () => {
    const p = await setup('/?view=game-announcements&newsArticle=update')
    expect(p.state.article.value?.sourceKey).toBe('update')
    await p.state.navigate({ newsArticle: null, newsPage: 2 }); await flushPromises()
    expect(p.state.page.value).toBe(2); expect(p.state.article.value).toBeNull()
    p.router.back(); await flushPromises(); expect(p.state.article.value?.sourceKey).toBe('update')
    p.router.forward(); await flushPromises(); expect(p.state.page.value).toBe(2)
  })
  it('normalizes a Lesta deep link without asking the transport to fetch Lesta', async () => {
    const p = await setup('/?view=game-announcements&newsSource=LESTA')
    expect(p.router.currentRoute.value.query.newsSource).toBe('WG')
    expect(p.transport.listNewsArticles.mock.calls.every(call => typeof call[0] === 'number')).toBe(true)
  })
  it('retains last good content when a refresh fails instead of showing empty news', async () => {
    const p = await setup()
    p.transport.listNewsArticles.mockRejectedValueOnce(new ApiError({ errorCode: 'NEWS_SOURCE_UNAVAILABLE', status: 503 }))
    await p.state.refresh()
    expect(p.state.articlePage.value?.items).toEqual([article]); expect(p.state.error.value).toBeTruthy()
  })
  it('discards a delayed detail after navigation even if fetch ignores abort', async () => {
    const p = await setup()
    let finish!: (article: api.NewsArticle) => void
    p.transport.getNewsArticle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
    await p.state.navigate({ newsArticle: 'update' }); await flushPromises()
    await p.state.switchTab('history'); await flushPromises()
    finish(article); await flushPromises()
    expect(p.state.article.value).toBeNull(); expect(p.state.archivePage.value?.items[0].id).toBe(7)
  })
  it('clears selection and rejects an account-A mutation after switching accounts', async () => {
    const p = await setup(); await p.state.selectArticle('update')
    expect(p.state.selected.value).toHaveLength(1)
    let finish!: () => void, signal!: AbortSignal
    const saving = p.state.mutate(value => { signal = value; return new Promise<void>(resolve => { finish = resolve }) })
    p.changeAccount(); await flushPromises()
    expect(signal.aborted).toBe(true); expect(p.state.selected.value).toEqual([])
    finish(); expect(await saving).toBe(false)
  })
  it('does not show a withdrawn management response after role loss', async () => {
    const p = await setup('/?view=game-announcements&newsTab=history&newsManage=1&newsArchive=7')
    expect(p.state.archive.value?.id).toBe(7)
    p.allowed.value = false; await flushPromises()
    expect(p.state.denied.value).toBe(true); expect(p.state.archive.value).toBeNull(); expect(p.state.archivePage.value).toBeNull()
    expect(p.transport.listNewsArchives).toHaveBeenCalledTimes(1)
  })
  it('saves the reviewed selection once and navigates to the new management snapshot', async () => {
    const p = await setup()
    const request = { idempotencyKey: '93c607c9-a410-4789-bd49-679496c4bc87', archives: [{ version: '11.21', title: 'Saved', categoryIds: [], articles: [{ sourceKey: 'update', revision: 'hash', blockIds: ['b1'] }] }] }
    expect(await p.state.save(request)).toBe(true); await flushPromises()
    expect(p.router.currentRoute.value.query).toMatchObject({ newsTab: 'history', newsManage: '1', newsArchive: '7' })
    expect(p.transport.createNewsArchives).toHaveBeenCalledTimes(1)
  })
  it('cancels category deletion when identity changes while confirmation is open', async () => {
    const p = await setup(); let finish!: (answer: boolean) => void
    p.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const deletion = p.state.removeCategory({ id: 1, name: 'General', type: 'GENERAL' }, 'Delete?')
    p.changeAccount(); await flushPromises(); finish(true); await deletion
    expect(p.transport.deleteNewsCategory).not.toHaveBeenCalled()
  })
  it('keeps the review session across disconnects so its frozen idempotency key survives', async () => {
    const p = await setup(); await p.state.selectArticle('update')
    const editorEpoch = p.state.editorEpoch.value
    p.online.value = false; await flushPromises()
    expect(p.state.editorEpoch.value).toBe(editorEpoch); expect(p.state.selected.value).toEqual([article])
    p.online.value = true; await flushPromises()
    expect(p.state.editorEpoch.value).toBe(editorEpoch)
  })
  it('requires a new source preview after a revision conflict', async () => {
    const p = await setup(); await p.state.selectArticle('update')
    const editorEpoch = p.state.editorEpoch.value
    p.transport.createNewsArchives.mockRejectedValueOnce(new ApiError({ errorCode: 'NEWS_REVISION_CONFLICT', status: 409 }))
    expect(await p.state.save({ idempotencyKey: '93c607c9-a410-4789-bd49-679496c4bc87', archives: [] })).toBe(false)
    expect(p.state.selected.value).toEqual([]); expect(p.state.editorEpoch.value).toBeGreaterThan(editorEpoch)
  })
  it.each(['cancel', 'failure'])('resumes preparing-state polling after a %s without clearing the current error', async outcome => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = await setup('/?view=game-announcements&newsTab=history&newsManage=1&newsArchive=7', {
      getNewsArchive: vi.fn(async () => ({ ...archive, status: 'PREPARING' })),
    })
    const failure = new ApiError({ errorCode: 'NEWS_CATEGORY_IN_USE', status: 409 })
    if (outcome === 'cancel') p.confirm.mockResolvedValueOnce(false)
    else p.transport.deleteNewsCategory.mockRejectedValueOnce(failure)
    await p.state.removeCategory({ id: 1, name: 'General', type: 'GENERAL' }, 'Delete?')
    expect(p.state.busy.value).toBe(false)
    expect(p.state.error.value).toBe(outcome === 'failure' ? failure : null)
    expect(p.state.archive.value?.status).toBe('PREPARING')
    p.transport.getNewsArchive.mockResolvedValueOnce(archive)
    await vi.advanceTimersByTimeAsync(5000); await flushPromises()
    expect(p.transport.getNewsArchive).toHaveBeenCalledTimes(2)
    expect(p.state.archive.value?.status).toBe('PUBLISHED')
    await vi.advanceTimersByTimeAsync(5000); await flushPromises()
    expect(p.transport.getNewsArchive).toHaveBeenCalledTimes(2)
  })
})
