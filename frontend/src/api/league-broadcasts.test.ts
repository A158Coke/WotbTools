// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BroadcastReplaySave } from './league-broadcasts.js'

const state = vi.hoisted(() => ({ auth: null as any, fetch: vi.fn(), online: true, epoch: 0 }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<object>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<object>(), apiFetch: state.fetch }))
import { broadcastCoverUrl, createBroadcastCategory, createBroadcastNode, createBroadcastSeason, deleteBroadcastResource, getBroadcastDeletionPreview, getBroadcastSeasonContents, listBroadcasts, saveBroadcastReplay, updateBroadcastSeason, validateBroadcast } from './league-broadcasts.js'

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
    expect(validateBroadcast('BroadcastTimedCategoryView', timedDetail).data.nodes[0].roundNumber).toBe(1)
    expect(() => validateBroadcast('BroadcastTimedCategoryView', { ...timedDetail, data: { ...detail, nodes: undefined } })).toThrow('INVALID_RESPONSE')
    expect(() => validateBroadcast('BroadcastSeason', { ...season, server: 'RU' })).toThrow('INVALID_RESPONSE')
    expect(() => validateBroadcast('BroadcastReplaySave', { ...payload, groupNumber: 5 })).not.toThrow()
    expect(() => validateBroadcast('BroadcastReplaySave', { ...payload, groupNumber: 0 })).toThrow('INVALID_RESPONSE')
    expect(() => validateBroadcast('BroadcastReplaySave', { ...payload, dayNumber: 7 })).not.toThrow()
  })
  it('uses public reads without waiting for authentication or attaching a bearer', async () => {
    state.fetch.mockResolvedValueOnce(response({ season, categories: [detail.category], nodes: detail.nodes, coverUploadAvailable: true, defaultTimeZone: 'Asia/Shanghai', replayStarts: [] }))
    await getBroadcastSeasonContents(1)
    expect(state.auth.ensureToken).not.toHaveBeenCalled()
    expect(state.fetch.mock.calls[0][0]).toBe('/api/tournament-broadcasts/seasons/1/contents')
    expect(state.fetch.mock.calls[0][1].headers).toEqual({})
  })
  it('adapts the validated time envelope and preserves historical date-only records', async () => {
    const replay = { id: 4, nodeId: 3, title: 'Match', url: 'https://example.org/video', matchDate: '2026-10-16', dayNumber: 1,
      groupNumber: null, bracket: null, teams: ['A', 'B'], perspective: 'OBSERVER', coverId: null }
    const data = { ...detail, nodes: [{ ...detail.nodes[0], replays: [replay, { ...replay, id: 5 }] }] }
    state.fetch.mockResolvedValueOnce(response({ data, defaultTimeZone: 'Europe/Berlin', replayStarts: [{ replayId: 4, startsAt: '2026-10-16T11:00:00Z' }] }))
    const value = await createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })
    expect(value.defaultTimeZone).toBe('Europe/Berlin')
    expect(value.nodes[0].replays.map(replay => replay.startsAt)).toEqual(['2026-10-16T11:00:00Z', null])
    state.fetch.mockResolvedValueOnce(response(detail))
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toThrow('INVALID_RESPONSE')
  })
  it('validates complete contents and maps replay starts at the transport boundary', async () => {
    const replay = { id: 4, nodeId: 3, title: 'Match', url: 'https://example.org/video', matchDate: '2026-10-16', dayNumber: 1,
      groupNumber: null, bracket: null, teams: ['A', 'B'], perspective: 'OBSERVER', coverId: null }
    const contents = { season, categories: [detail.category], nodes: [{ ...detail.nodes[0], replays: [replay, { ...replay, id: 5 }] }],
      coverUploadAvailable: true, defaultTimeZone: 'Asia/Shanghai', replayStarts: [{ replayId: 4, startsAt: '2026-10-16T11:00:00Z' }] }
    state.fetch.mockResolvedValueOnce(response(contents))
    const value = await getBroadcastSeasonContents(1)
    expect(value.nodes[0].replays.map(replay => replay.startsAt)).toEqual(['2026-10-16T11:00:00Z', null])
    expect(state.fetch.mock.calls[0][0]).toBe('/api/tournament-broadcasts/seasons/1/contents')
    state.fetch.mockResolvedValueOnce(response({ ...contents, nodes: undefined }))
    await expect(getBroadcastSeasonContents(1)).rejects.toThrow('INVALID_RESPONSE')
  })
  it('uses category deletion preview and sends its version with explicit confirmation', async () => {
    const preview = { seasonId: 1, expectedVersion: 7, rootCount: 3, replayCount: 6 }
    state.fetch.mockResolvedValueOnce(response(preview))
    expect(await getBroadcastDeletionPreview('categories', 2)).toEqual(preview)
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteBroadcastResource('categories', 2, 7)
    expect(state.fetch.mock.calls.map(call => call[0])).toEqual([
      '/api/admin/tournament-broadcasts/categories/2/deletion-preview',
      '/api/admin/tournament-broadcasts/categories/2?expectedVersion=7&confirm=true',
    ])
  })
  it('uses canonical catalogue and deletion routes while retaining optimistic locking and cover URLs', async () => {
    state.fetch.mockResolvedValueOnce(response({ servers: ['CN', 'ASIA', 'NA', 'EU', 'LESTA'], seasons: [season], coverUploadAvailable: true }))
    await listBroadcasts('CN')
    expect(state.fetch.mock.calls[0][0]).toBe('/api/tournament-broadcasts?server=CN')
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteBroadcastResource('replays', 40, 4)
    expect(state.fetch.mock.calls[1][0]).toBe('/api/admin/tournament-broadcasts/replays/40?expectedVersion=4&confirm=true')
    expect(state.fetch.mock.calls[1][1].method).toBe('DELETE')
    expect(broadcastCoverUrl('493199ec-c421-456b-a865-dcd69ef4c62a')).toBe('/api/tournament-broadcasts/covers/493199ec-c421-456b-a865-dcd69ef4c62a')
  })
  it('keeps season writes on the modern multilingual shape with canonical routes', async () => {
    const view = { season, categories: [detail.category], coverUploadAvailable: true }
    const signal = new AbortController().signal
    const fields = { year: season.year, nameZh: season.nameZh, nameEn: season.nameEn, nameRu: null, startDate: null }
    const create = { server: season.server, ...fields }
    const update = { ...fields, expectedVersion: season.version }
    state.fetch.mockImplementation(async () => response(view))
    expect(await createBroadcastSeason(create, signal)).toEqual(view)
    expect(await updateBroadcastSeason(1, update, signal)).toEqual(view)
    expect(await createBroadcastCategory(1, { expectedVersion: 0, type: 'POINTS' }, signal)).toEqual(view)
    expect(state.fetch.mock.calls.map(([path, options]) => [path, options.method ?? 'GET'])).toEqual([
      ['/api/admin/tournament-broadcasts/seasons', 'POST'],
      ['/api/admin/tournament-broadcasts/seasons/1', 'PUT'], ['/api/admin/tournament-broadcasts/seasons/1/categories', 'POST'],
    ])
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual(update)
    for (const [, options] of state.fetch.mock.calls) expect(options.signal).toBe(signal)
  })
  it('uses the time envelope for node creation and preserves the deletion preview version', async () => {
    const signal = new AbortController().signal
    const value = await createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null }, signal)
    expect(value).toEqual({ ...detail, defaultTimeZone: timedDetail.defaultTimeZone })
    expect(state.fetch.mock.calls[0][0]).toBe('/api/admin/tournament-broadcasts/categories/2/nodes')
    expect(state.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', signal, headers: { Authorization: 'Bearer access-token' } })
    const preview = { seasonId: 1, expectedVersion: 5, rootCount: 1, replayCount: 0 }
    state.fetch.mockResolvedValueOnce(response(preview))
    expect(await getBroadcastDeletionPreview('nodes', 3, signal)).toEqual(preview)
    expect(state.fetch.mock.calls[1][0]).toBe('/api/admin/tournament-broadcasts/nodes/3/deletion-preview')
  })
  it.each([401, 403, 404, 405, 429, 500, 502, 503])('propagates HTTP %s failures with one canonical read', async status => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status }))
    const signal = new AbortController().signal
    await expect(getBroadcastSeasonContents(1, signal)).rejects.toMatchObject({ status })
    expect(state.fetch).toHaveBeenCalledTimes(1)
    expect(state.fetch.mock.calls[0]).toEqual(['/api/tournament-broadcasts/seasons/1/contents', { headers: {}, signal }])
  })
  it('propagates network and cancellation errors without retrying', async () => {
    for (const error of [new TypeError('network'), new DOMException('aborted', 'AbortError')]) {
      state.fetch.mockRejectedValueOnce(error)
      await expect(getBroadcastSeasonContents(1)).rejects.toBe(error)
    }
    expect(state.fetch).toHaveBeenCalledTimes(2)
  })
  it('requires the backend time zone and rejects unknown envelope fields', async () => {
    for (const value of [{ ...timedDetail, defaultTimeZone: undefined }, { ...timedDetail, unknown: true }]) {
      state.fetch.mockResolvedValueOnce(response(value))
      await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toThrow('INVALID_RESPONSE')
    }
    expect(state.fetch).toHaveBeenCalledTimes(2)
  })
  it('sends canonical mutations once and propagates a missing category', async () => {
    state.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toMatchObject({ status: 404 })
    expect(state.fetch).toHaveBeenCalledTimes(1)
    expect(state.fetch.mock.calls[0][0]).toBe('/api/admin/tournament-broadcasts/categories/2/nodes')
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
  it.each([undefined, 4])('uses the timed multipart payload and raw replacement cover when saving replay %s', async replayId => {
    const file = new File(['png'], 'cover.png', { type: 'image/png' })
    const signal = new AbortController().signal
    await saveBroadcastReplay({ nodeId: 3, replayId }, { replay: { ...payload, coverAction: 'REPLACE' }, startsAt: '2026-10-16T11:00:00Z' }, file, signal)
    const [url, options] = state.fetch.mock.calls[0]
    expect(url).toBe(replayId ? '/api/admin/tournament-broadcasts/replays/4' : '/api/admin/tournament-broadcasts/nodes/3/replays')
    expect(options.method).toBe(replayId ? 'PUT' : 'POST')
    expect(options.signal).toBe(signal)
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

describe('league-broadcasts JSON decode failures', () => {
  const reads = [['json', (signal?: AbortSignal) => listBroadcasts(undefined, signal)], ['timed category', (signal?: AbortSignal) => createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null }, signal)], ['season contents', (signal?: AbortSignal) => getBroadcastSeasonContents(1, signal)]] as const
  it.each(reads)('normalizes malformed %s JSON without exposing the body', async (_, read) => {
    state.fetch.mockResolvedValueOnce(new Response('{private malformed body'))
    await expect(read()).rejects.toMatchObject({ name: 'ApiError', errorCode: 'INVALID_RESPONSE', retryable: false, errorMsg: null, details: {} })
  })
  it.each(reads)('preserves %s body cancellation and transport failures', async (_, read) => {
    const signal = new AbortController().signal
    for (const error of [new DOMException('aborted', 'AbortError'), new TypeError('body stream failed')]) {
      const response = new Response()
      vi.spyOn(response, 'json').mockRejectedValueOnce(error)
      state.fetch.mockResolvedValueOnce(response)
      await expect(read(signal)).rejects.toBe(error)
      expect(state.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ signal }))
    }
  })
})
