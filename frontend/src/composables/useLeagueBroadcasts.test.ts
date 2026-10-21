// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import * as api from '../api/league-broadcasts.js'
import { useLeagueBroadcasts } from './useLeagueBroadcasts.js'

const servers: api.BroadcastServer[] = ['CN', 'ASIA', 'NA', 'EU', 'LESTA']
const season: api.BroadcastSeason = { id: 10, server: 'CN', year: 2026, nameZh: '夏季赛', nameEn: 'Summer', nameRu: null, startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 4, rootCount: 1, replayCount: 0 }
const category: api.BroadcastCategory = { id: 20, seasonId: 10, type: 'POINTS' }
const node: api.BroadcastNode = { id: 30, categoryId: 20, roundNumber: 1, format: null, replays: [] }
async function setup(url = '/?view=league-broadcasts&lbServer=CN&lbSeason=10&lbCategory=20', overrides = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push(url); await router.isReady()
  let epoch = 0
  const allowed = ref(true), tokenParsed = ref({ sub: 'one' }), online = ref(true)
  const transport = { ...api, listBroadcasts: vi.fn(async (server?: string) => ({ servers, seasons: server === 'CN' ? [season] : [], coverUploadAvailable: true })),
    getBroadcastSeasonContents: vi.fn(async () => ({ defaultTimeZone: 'Asia/Shanghai', replayStarts: [], season, categories: [category], nodes: [node], coverUploadAvailable: true })),
    getBroadcastCategory: vi.fn(async () => ({ defaultTimeZone: 'Asia/Shanghai', season, categories: [category], replayStarts: [], nodes: [node], coverUploadAvailable: true })),
    getBroadcastDeletionPreview: vi.fn(async () => ({ seasonId: 10, expectedVersion: 4, rootCount: 1, replayCount: 2 })),
    deleteBroadcastResource: vi.fn(async () => undefined), ...overrides }
  const confirm = vi.fn(async (_value: any) => true)
  // useRoute returns a stable reactive projection, unlike currentRoute.value. Bridge that contract for this owner test.
  const liveScope = effectScope()
  const route = { get query() { return router.currentRoute.value.query }, get hash() { return router.currentRoute.value.hash } }
  const live = liveScope.run(() => useLeagueBroadcasts(route as any, router, {
    api: transport, auth: { isLeagueBroadcastAdmin: allowed, tokenParsed, authEpoch: () => epoch }, gate: { availability: () => ({ available: online.value }) }, confirm,
  } as any))!
  await flushPromises()
  return { state: live, transport, router, allowed, tokenParsed, online, confirm, stop: () => liveScope.stop(), changeAccount: () => { epoch++; tokenParsed.value = { sub: 'two' } } }
}

describe('broadcast route and request ownership', () => {
  it('derives the default zone from each category envelope rather than retaining the previous server zone', async () => {
    localStorage.clear()
    const p = await setup()
    expect(p.state.displayTimeZone.value).toBe('Asia/Shanghai')
    p.transport.getBroadcastSeasonContents.mockResolvedValueOnce({ defaultTimeZone: 'America/Los_Angeles', season, categories: [category], replayStarts: [], nodes: [node], coverUploadAvailable: true })
    await p.state.refresh()
    expect(p.state.displayTimeZone.value).toBe('America/Los_Angeles')
    p.state.displayTimeZonePreference.value = 'UTC'
    await p.state.refresh()
    expect(p.state.defaultTimeZone.value).toBe('Asia/Shanghai')
    expect(p.state.displayTimeZone.value).toBe('UTC')
    p.stop(); localStorage.clear()
  })
  it('restores category deep links and keeps Back/Forward under Vue Router', async () => {
    const p = await setup()
    expect(p.state.category.value?.id).toBe(20)
    await p.state.navigate({ server: 'CN', season: 10 }); await flushPromises()
    expect(p.state.category.value).toBeNull()
    expect(p.state.categories.value).toEqual([category])
    p.router.back(); await flushPromises()
    expect(p.state.category.value?.id).toBe(20)
    p.router.forward(); await flushPromises()
    expect(p.state.categories.value).toEqual([category])
    p.stop()
  })
  it('repairs an unrelated season/category instead of mixing server ownership', async () => {
    const p = await setup('/?view=league-broadcasts&lbServer=EU&lbSeason=10&lbCategory=20&lang=en')
    expect(p.router.currentRoute.value.query).toEqual({ view: 'league-broadcasts', lbServer: 'EU', lang: 'en' })
    expect(p.transport.getBroadcastSeasonContents).not.toHaveBeenCalled()
    p.stop()
  })
  it('ignores an old public response after another navigation, even if the transport ignores abort', async () => {
    const p = await setup()
    let finish!: (value: api.BroadcastSeasonContents) => void
    p.transport.getBroadcastSeasonContents.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as any)
    const old = p.state.refresh(); await flushPromises()
    await p.state.navigate({ server: 'EU' }); await flushPromises()
    finish({ defaultTimeZone: 'Asia/Shanghai', season, categories: [category], replayStarts: [], nodes: [node], coverUploadAvailable: true }); await old
    expect(p.state.server.value).toBe('EU')
    expect(p.state.category.value).toBeNull()
    expect(p.state.seasons.value).toEqual([])
    p.stop()
  })
  it('cancels visible admin editors and rejects a late mutation when the role is revoked', async () => {
    const p = await setup()
    let finish!: () => void, signal!: AbortSignal
    const editor = p.state.editorEpoch.value
    const saving = p.state.mutate(value => { signal = value; return new Promise<void>(resolve => { finish = resolve }) })
    p.allowed.value = false; await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(p.state.editorEpoch.value).toBeGreaterThan(editor)
    finish(); expect(await saving).toBe(false)
    expect(p.state.category.value?.id).toBe(20)
    p.stop()
  })
  it('does not let account A complete a pending write in account B', async () => {
    const p = await setup()
    let finish!: () => void
    const saving = p.state.mutate(() => new Promise<void>(resolve => { finish = resolve }))
    p.changeAccount(); await flushPromises()
    finish(); expect(await saving).toBe(false)
    expect(p.state.notice.value).not.toBe('saved')
    p.stop()
  })
  it('confirms the latest root count and version before deletion', async () => {
    const p = await setup()
    await p.state.remove('nodes', 30, 'Round 1', (key, values) => JSON.stringify({ key, values }))
    expect(p.confirm.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('"replays":2') })
    expect(p.transport.deleteBroadcastResource.mock.calls[0].slice(0, 3)).toEqual(['nodes', 30, 4])
    p.stop()
  })
  it('keeps every category root on the season page without extra category requests', async () => {
    const other = { id: 21, seasonId: 10, type: 'SEMI_FINALS' as const }
    const p = await setup('/?view=league-broadcasts&lbServer=CN&lbSeason=10', {
      getBroadcastSeasonContents: vi.fn(async () => ({ season, categories: [category, other], nodes: [node, { ...node, id: 31, categoryId: 21, roundNumber: null }], defaultTimeZone: 'Asia/Shanghai', replayStarts: [], coverUploadAvailable: true })),
    })
    expect(p.state.nodes.value.map(node => node.id)).toEqual([30, 31])
    expect(p.transport.getBroadcastCategory).not.toHaveBeenCalled()
    expect(p.state.category.value).toBeNull()
    p.stop()
  })
  it('cancels category deletion without changing any root', async () => {
    const p = await setup()
    p.confirm.mockResolvedValueOnce(false)
    await p.state.remove('categories', 20, 'Points', (key, values) => JSON.stringify({ key, values }))
    expect(p.transport.getBroadcastDeletionPreview).toHaveBeenCalledWith('categories', 20, expect.any(AbortSignal))
    expect(p.transport.deleteBroadcastResource).not.toHaveBeenCalled()
    expect(p.state.nodes.value).toEqual([node])
    p.stop()
  })
  it('invalidates a pending category confirmation when its owner changes', async () => {
    const p = await setup()
    let finish!: (value: boolean) => void
    p.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const removing = p.state.remove('categories', 20, 'Points', key => key)
    await flushPromises()
    const signal = p.confirm.mock.calls[0][0].signal
    p.changeAccount(); await flushPromises()
    expect(signal.aborted).toBe(true)
    finish(true); await removing
    expect(p.transport.deleteBroadcastResource).not.toHaveBeenCalled()
    p.stop()
  })

  it('rejects nodes owned by another category before publishing the season snapshot', async () => {
    const p = await setup(undefined, { getBroadcastSeasonContents: vi.fn(async () => ({ season, categories: [category],
      nodes: [{ ...node, categoryId: 999 }], replayStarts: [], defaultTimeZone: 'Asia/Shanghai', coverUploadAvailable: true })) })
    expect(p.state.readFailed.value).toBe(true)
    expect(p.state.nodes.value).toEqual([])
    expect(p.state.error.value).toMatchObject({ errorCode: 'INVALID_RESPONSE' })
    p.stop()
  })

})
