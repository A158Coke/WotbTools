// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BroadcastReplaySave } from './league-broadcasts.js'

const state = vi.hoisted(() => ({ auth: null as any, fetch: vi.fn(), online: true, epoch: 0 }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<object>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<object>(), apiFetch: state.fetch }))
import { broadcastCoverUrl, createBroadcastNode, deleteBroadcastResource, getBroadcastCategory, listBroadcasts, saveBroadcastReplay, validateBroadcast } from './league-broadcasts.js'

const season = { id: 1, server: 'CN' as const, year: 2026, nameZh: '夏季赛', nameEn: 'Summer', nameRu: null, startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 0, rootCount: 1, replayCount: 0 }
const detail = { season, category: { id: 2, seasonId: 1, type: 'POINTS' }, nodes: [{ id: 3, categoryId: 2, roundNumber: 1, format: null, replays: [] }], coverUploadAvailable: true }
const timedDetail = { data: detail, defaultTimeZone: 'Asia/Shanghai', replayStarts: [] }
const payload: BroadcastReplaySave = { expectedVersion: 0, title: 'Final', url: 'https://example.org/watch', matchDate: '2026-10-16', dayNumber: 7, groupNumber: 7, bracket: null, teams: ['A', 'B'], perspective: 'POV', coverAction: 'KEEP' }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  vi.clearAllMocks(); state.online = true; state.epoch = 0
  state.auth = { authenticated: ref(true), tokenParsed: ref({ realm_access: { roles: ['wotbtools-admin'] } }), authEpoch: () => state.epoch,
    ensureToken: vi.fn(async () => true), token: () => 'access-token' }
  state.fetch.mockResolvedValue(response(timedDetail))
})
afterEach(() => vi.unstubAllEnvs())

describe('broadcast HTTP boundary', () => {
  it('validates required nullable fields and rejects producer drift instead of treating it as empty data', () => {
    expect(validateBroadcast('BroadcastCategoryView', detail).nodes[0].roundNumber).toBe(1)
    expect(() => validateBroadcast('BroadcastCategoryView', { ...detail, nodes: undefined })).toThrow('INVALID_RESPONSE')
    expect(() => validateBroadcast('BroadcastSeason', { ...season, server: 'RU' })).toThrow('INVALID_RESPONSE')
    expect(() => validateBroadcast('BroadcastReplaySave', { ...payload, groupNumber: 5 })).not.toThrow()
    expect(() => validateBroadcast('BroadcastReplaySave', { ...payload, groupNumber: 0 })).toThrow('INVALID_RESPONSE')
    expect(() => validateBroadcast('BroadcastReplaySave', { ...payload, dayNumber: 7 })).not.toThrow()
  })
  it('uses public reads without waiting for authentication or attaching a bearer', async () => {
    await getBroadcastCategory(2)
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    expect(state.fetch.mock.calls[0][0]).toBe('/api/tournament-broadcasts/v3/categories/2')
    expect(state.fetch.mock.calls[0][1].headers).toEqual({})
  })
  it('adapts a validated v3 envelope and leaves old date-only records without a time', async () => {
    const replay = { id: 4, nodeId: 3, title: 'Match', url: 'https://example.org/video', matchDate: '2026-10-16', dayNumber: 1,
      groupNumber: null, bracket: null, teams: ['A', 'B'], perspective: 'OBSERVER', coverId: null }
    const data = { ...detail, nodes: [{ ...detail.nodes[0], replays: [replay, { ...replay, id: 5 }] }] }
    state.fetch.mockResolvedValueOnce(response({ data, defaultTimeZone: 'Europe/Berlin', replayStarts: [{ replayId: 4, startsAt: '2026-10-16T11:00:00Z' }] }))
    const value = await getBroadcastCategory(2)
    expect(value.defaultTimeZone).toBe('Europe/Berlin')
    expect(value.nodes[0].replays.map(replay => replay.startsAt)).toEqual(['2026-10-16T11:00:00Z', null])
    state.fetch.mockResolvedValueOnce(response(detail))
    await expect(getBroadcastCategory(2)).rejects.toThrow('INVALID_RESPONSE')
  })
  it('uses v2 for the catalogue and versioned deletion while retaining shared cover URLs', async () => {
    state.fetch.mockResolvedValueOnce(response({ servers: ['CN', 'ASIA', 'NA', 'EU', 'LESTA'], seasons: [season], coverUploadAvailable: true }))
    await listBroadcasts('CN')
    expect(state.fetch.mock.calls[0][0]).toBe('/api/tournament-broadcasts/v2?server=CN')
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteBroadcastResource('replays', 40, 4)
    expect(state.fetch.mock.calls[1][0]).toBe('/api/admin/tournament-broadcasts/v2/replays/40?expectedVersion=4&confirm=true')
    expect(state.fetch.mock.calls[1][1].method).toBe('DELETE')
    expect(broadcastCoverUrl('493199ec-c421-456b-a865-dcd69ef4c62a')).toBe('/api/tournament-broadcasts/covers/493199ec-c421-456b-a865-dcd69ef4c62a')
  })
  it.each([401, 403, 404, 405])('reads date-only v2 data when the old backend rejects v3 with %s', async status => {
    const replay = { id: 4, nodeId: 3, title: 'Match', url: 'https://example.org/video', matchDate: '2026-10-16', dayNumber: 1,
      groupNumber: null, bracket: null, teams: ['A', 'B'], perspective: 'OBSERVER', coverId: null }
    const data = { ...detail, season: { ...season, server: 'NA' }, nodes: [{ ...detail.nodes[0], replays: [replay] }] }
    const signal = new AbortController().signal
    state.fetch.mockResolvedValueOnce(new Response(null, { status })).mockResolvedValueOnce(response(data))
    const value = await getBroadcastCategory(2, signal)
    expect(value.defaultTimeZone).toBe('America/Los_Angeles')
    expect(value.nodes[0].replays[0]).toEqual({ ...replay, startsAt: null })
    expect(value.coverUploadAvailable).toBe(data.coverUploadAvailable)
    expect(state.fetch.mock.calls.map(call => call[0])).toEqual(['/api/tournament-broadcasts/v3/categories/2', '/api/tournament-broadcasts/v2/categories/2'])
    for (const [, options] of state.fetch.mock.calls) expect(options).toMatchObject({ headers: {}, signal })
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
  })
  it.each([
    ['CN', 'Asia/Shanghai'], ['ASIA', 'Asia/Shanghai'], ['NA', 'America/Los_Angeles'],
    ['EU', 'Europe/Berlin'], ['LESTA', 'Europe/Moscow'],
  ])('supplies only the released v2 zone for %s', async (server, zone) => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(response({ ...detail, season: { ...season, server } }))
    expect((await getBroadcastCategory(2)).defaultTimeZone).toBe(zone)
  })
  it('retries v3 on the next read after the backend becomes available', async () => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(response(detail))
    await getBroadcastCategory(2)
    state.fetch.mockResolvedValueOnce(response({ ...timedDetail, defaultTimeZone: 'Europe/Berlin' }))
    expect((await getBroadcastCategory(2)).defaultTimeZone).toBe('Europe/Berlin')
    expect(state.fetch).toHaveBeenCalledTimes(3)
    expect(state.fetch.mock.calls[2][0]).toBe('/api/tournament-broadcasts/v3/categories/2')
  })
  it.each([429, 500, 502, 503])('does not hide a v3 HTTP %s failure behind v2 data', async status => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status }))
    await expect(getBroadcastCategory(2)).rejects.toMatchObject({ status })
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })
  it('propagates network and cancellation errors without a fallback read', async () => {
    for (const error of [new TypeError('network'), new DOMException('aborted', 'AbortError')]) {
      state.fetch.mockRejectedValueOnce(error)
      await expect(getBroadcastCategory(2)).rejects.toBe(error)
    }
    expect(state.fetch).toHaveBeenCalledTimes(2)
  })
  it('validates v2 strictly and propagates a missing category instead of showing an empty one', async () => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(response({ ...detail, nodes: undefined }))
    await expect(getBroadcastCategory(2)).rejects.toThrow('INVALID_RESPONSE')
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(getBroadcastCategory(2)).rejects.toMatchObject({ status: 404 })
  })
  it('never retries a v3 mutation through v2 when the new backend is unavailable', async () => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toMatchObject({ status: 404 })
    expect(state.fetch).toHaveBeenCalledTimes(1)
    expect(state.fetch.mock.calls[0][0]).toBe('/api/admin/tournament-broadcasts/v3/categories/2/nodes')
  })
  it('does not send a mutation for points-only roles or a failed token refresh', async () => {
    state.auth.tokenParsed.value = { realm_access: { roles: ['tournament-admin'] } }
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toMatchObject({ status: 403 })
    state.auth.tokenParsed.value = { realm_access: { roles: ['wotbtools-admin'] } }
    state.auth.ensureToken.mockResolvedValue(false)
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toMatchObject({ status: 401 })
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it('rejects a role change during token refresh before sending a mutation', async () => {
    state.auth.ensureToken.mockImplementation(async () => { state.auth.tokenParsed.value = null; return true })
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toMatchObject({ status: 403 })
    expect(state.fetch).not.toHaveBeenCalled()
  })
  it('rejects a delayed response belonging to an old account', async () => {
    state.fetch.mockImplementation(async () => { state.epoch++; return response(timedDetail) })
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toThrow('REQUEST_ABORTED')
  })
  it('uses multipart JSON and the selected raw image only when replacing a cover', async () => {
    const file = new File(['png'], 'cover.png', { type: 'image/png' })
    await saveBroadcastReplay({ nodeId: 3 }, { replay: { ...payload, coverAction: 'REPLACE' }, startsAt: '2026-10-16T11:00:00Z' }, file)
    const [url, options] = state.fetch.mock.calls[0]
    expect(url).toBe('/api/admin/tournament-broadcasts/v3/nodes/3/replays')
    expect(options.headers).toEqual({ Authorization: 'Bearer access-token' })
    expect(options.body.get('payload').type).toBe('application/json')
    expect(JSON.parse(await options.body.get('payload').text())).toEqual({ replay: { ...payload, coverAction: 'REPLACE' }, startsAt: '2026-10-16T11:00:00Z' })
    expect(options.body.get('cover').name).toBe('cover.png')
    expect(() => saveBroadcastReplay({ nodeId: 3 }, { replay: payload, startsAt: null }, file)).toThrow('BROADCAST_COVER_INVALID')
  })
  it('keeps business cover reads on the production API origin in Android', () => {
    vi.stubEnv('MODE', 'android')
    expect(broadcastCoverUrl('493199ec-c421-456b-a865-dcd69ef4c62a')).toBe('https://wotbtools.com/api/tournament-broadcasts/covers/493199ec-c421-456b-a865-dcd69ef4c62a')
  })
  it('fails closed while the network feature is unavailable', async () => {
    state.online = false
    await expect(listBroadcasts()).rejects.toThrow('NETWORK_ERROR')
    expect(state.fetch).not.toHaveBeenCalled()
  })
})
