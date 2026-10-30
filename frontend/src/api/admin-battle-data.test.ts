import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { getSummary, getBattles, getBattle } from './admin-battle-data.js'

const gate = vi.hoisted(() => ({ available: true }))
const auth = vi.hoisted(() => ({ authenticated: { value: true }, initPromise: Promise.resolve(), token: vi.fn(() => 'token'), ensureToken: vi.fn(async () => true) }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => gate.available }) }))
vi.mock('../composables/useAuth.js', () => ({ useAuth: () => auth }))
const battle = { id: '9223372036854775807', arenaId: '18446744073709551615', schemaVersion: 1, arenaBonusType: 1, mapId: 42, mapKey: 'rift', clientVersion: '11.18', winnerTeam: 0, team1Spawn: 'NORTH', team2Spawn: 'SOUTH', receivedAt: '2026-10-29T00:00:00Z' }
const summary = { asOf: '2026-10-29T00:00:00Z', totalBattles: 0, last24Hours: 0, last7Days: 0, last30Days: 0, windowBattles: 0, latestReceivedAt: null, distinctMaps: 0, distinctClientVersions: 0, modes: [], winnerTeams: [], schemaVersions: [], daily: [], maps: [], clientVersions: [] }
beforeEach(() => { vi.clearAllMocks(); gate.available = true; auth.authenticated.value = true; vi.stubGlobal('fetch', vi.fn(async () => Response.json(summary))) })
afterEach(() => vi.unstubAllGlobals())
describe('admin battle data transport', () => {
  it('sends authenticated, encoded filters', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
    await getBattles({ arenaId: '18446744073709551615', cursor: 'a/b', winnerTeam: 0 })
    expect(fetch).toHaveBeenCalledWith('/api/admin/battle-data/battles?arenaId=18446744073709551615&cursor=a%2Fb&winnerTeam=0', expect.objectContaining({ headers: { Authorization: 'Bearer token' } }))
  })
  it('keeps a bigint battle id as a path string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ battle, vehicles: [] }))
    await getBattle('9223372036854775807')
    expect(fetch).toHaveBeenCalledWith('/api/admin/battle-data/battles/9223372036854775807', expect.objectContaining({ headers: { Authorization: 'Bearer token' } }))
  })
  it('rejects malformed payloads', async () => { vi.mocked(fetch).mockResolvedValueOnce(Response.json({ totalBattles: 0 })); await expect(getSummary({})).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE' }) })
  it.each([401, 403, 500])('preserves HTTP %s errors', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status }))
    await expect(getSummary({})).rejects.toMatchObject({ status })
  })
  it('does not fetch if connectivity is lost while refreshing the token', async () => {
    auth.ensureToken.mockImplementationOnce(async () => { gate.available = false; return true })
    await expect(getSummary({})).rejects.toMatchObject({ errorCode: 'NETWORK_ERROR' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not fetch while offline before the request', async () => {
    gate.available = false
    await expect(getSummary({})).rejects.toMatchObject({ errorCode: 'NETWORK_ERROR' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not issue a request without authentication', async () => { auth.authenticated.value = false; await expect(getSummary({})).rejects.toMatchObject({ status: 401 }); expect(fetch).not.toHaveBeenCalled() })
})
