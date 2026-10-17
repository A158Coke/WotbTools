// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BroadcastCategoryView, BroadcastReplaySave } from './league-broadcasts.js'

const state = vi.hoisted(() => ({ auth: null as any, fetch: vi.fn(), online: true, epoch: 0 }))
vi.mock('../composables/useAuth.js', async original => ({ ...await original<object>(), useAuth: () => state.auth }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => state.online }) }))
vi.mock('../utils/http.js', async original => ({ ...await original<object>(), apiFetch: state.fetch }))
import { broadcastCoverUrl, createBroadcastNode, getBroadcastCategory, listBroadcasts, saveBroadcastReplay, validateBroadcast } from './league-broadcasts.js'

const season = { id: 1, server: 'CN' as const, year: 2026, nameZh: '夏季赛', nameEn: 'Summer', nameRu: null, startDate: null, createdAt: '2026-10-16T12:00:00Z', version: 0, rootCount: 1, replayCount: 0 }
const detail: BroadcastCategoryView = { season, category: { id: 2, seasonId: 1, type: 'POINTS' }, nodes: [{ id: 3, categoryId: 2, roundNumber: 1, format: null, replays: [] }], coverUploadAvailable: true }
const payload: BroadcastReplaySave = { expectedVersion: 0, title: 'Final', url: 'https://example.org/watch', matchDate: '2026-10-16', dayNumber: 7, groupNumber: 7, bracket: null, teams: ['A', 'B'], perspective: 'POV', coverAction: 'KEEP' }
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  vi.clearAllMocks(); state.online = true; state.epoch = 0
  state.auth = { authenticated: ref(true), tokenParsed: ref({ realm_access: { roles: ['wotbtools-admin'] } }), authEpoch: () => state.epoch,
    ensureToken: vi.fn(async () => true), token: () => 'access-token' }
  state.fetch.mockResolvedValue(response(detail))
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
    expect(state.fetch.mock.calls[0][0]).toBe('/api/tournament-broadcasts/categories/2')
    expect(state.fetch.mock.calls[0][1].headers).toEqual({})
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
    state.fetch.mockImplementation(async () => { state.epoch++; return response(detail) })
    await expect(createBroadcastNode(2, { expectedVersion: 0, roundNumber: 1, format: null })).rejects.toThrow('REQUEST_ABORTED')
  })
  it('uses multipart JSON and the selected raw image only when replacing a cover', async () => {
    const file = new File(['png'], 'cover.png', { type: 'image/png' })
    await saveBroadcastReplay({ nodeId: 3 }, { ...payload, coverAction: 'REPLACE' }, file)
    const [url, options] = state.fetch.mock.calls[0]
    expect(url).toBe('/api/admin/tournament-broadcasts/nodes/3/replays')
    expect(options.headers).toEqual({ Authorization: 'Bearer access-token' })
    expect(options.body.get('payload').type).toBe('application/json')
    expect(options.body.get('cover').name).toBe('cover.png')
    expect(() => saveBroadcastReplay({ nodeId: 3 }, payload, file)).toThrow('BROADCAST_COVER_INVALID')
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
