// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTournamentDataSource, importTournamentCsv, previewTournamentCsvImport, supportsTournamentCsvImport, validateTournament } from './tournament-points.js'

vi.mock('../composables/useAuth.js', async importOriginal => ({
  ...await importOriginal<typeof import('../composables/useAuth.js')>(),
  useAuth: () => ({ authenticated: { value: true }, tokenParsed: { value: { realm_access: { roles: ['tournament-admin'] } } },
    authEpoch: () => 1, token: () => 'fixture-token', ensureToken: async () => true }),
}))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => true }) }))

afterEach(() => vi.unstubAllGlobals())

const event = { id: 1, version: 2, year: 2026, region: 'CN', season: 'FIRE_CUP', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: true }
const preview = {
  standings: { event, days: [], rows: [] }, sourceName: '2026战火杯积分榜.csv', sourceSha256: 'a'.repeat(64),
  sourceRowCount: 200, clanCount: 200, missingCellCount: 1800, eventVersion: 2,
  changes: { addedClans: 3, changedClans: 4, removedClans: 1, addedScores: 3, changedScores: 4, removedScores: 1, preservedClears: 2 },
}
const dataSource = { csvImported: true, attribution: { name: '_EK_', url: 'https://b23.tv/rqx5iYX' } }
const jsonResponse = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status: 200, headers: { 'Content-Type': 'application/json', ...headers },
})

describe('CSV tournament rollout compatibility', () => {
  it('probes the existing authenticated route without interpreting a missing header as support', async () => {
    const signal = new AbortController().signal
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(supportsTournamentCsvImport(signal)).resolves.toBe(false)
    expect(fetch.mock.calls[0]).toEqual(['/api/admin/tournaments', expect.objectContaining({
      method: 'HEAD', signal, headers: { Authorization: 'Bearer fixture-token' },
    })])
    fetch.mockResolvedValueOnce(new Response(null, { status: 200, headers: { 'X-Tournament-Csv-Import': '1' } }))
    await expect(supportsTournamentCsvImport()).resolves.toBe(true)
  })
  it.each([400, 403, 500])('does not hide a failed capability probe (%i)', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })))
    await expect(supportsTournamentCsvImport()).rejects.toMatchObject({ status })
    await expect(getTournamentDataSource(1)).rejects.toMatchObject({ status })
  })
  it('avoids requesting public metadata from old backends and does not attach bearer credentials', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetch)
    await expect(getTournamentDataSource(1)).resolves.toBeNull()
    expect(fetch.mock.calls).toEqual([['/api/tournaments', expect.objectContaining({ headers: {} })]])
  })
  it('loads public metadata only after a successful capability negotiation', async () => {
    const signal = new AbortController().signal
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([], { 'X-Tournament-Csv-Import': '1' }))
      .mockResolvedValueOnce(jsonResponse(dataSource))
    vi.stubGlobal('fetch', fetch)
    await expect(getTournamentDataSource(1, signal)).resolves.toEqual(dataSource)
    expect(fetch.mock.calls.map(([url, options]) => [url, options?.signal, options?.headers])).toEqual([
      ['/api/tournaments', signal, {}], ['/api/tournaments/1/data-source', signal, {}],
    ])
  })
  it.each([404, 500])('reports metadata errors after advertised support (%i)', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse([], { 'X-Tournament-Csv-Import': '1' }))
      .mockResolvedValueOnce(new Response(null, { status }))
    vi.stubGlobal('fetch', fetch)
    await expect(getTournamentDataSource(1)).rejects.toMatchObject({ status })
  })
})

describe('CSV tournament HTTP boundary', () => {
  it('uploads the original file with server-side preview identity and explicit confirmation', async () => {
    const file = new File(['\uFEFF军团,R1D1\r\n"A,B",0\r\n'], preview.sourceName, { type: 'text/csv' })
    const signal = new AbortController().signal
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(preview))
    vi.stubGlobal('fetch', fetch)
    await expect(previewTournamentCsvImport(1, file, 2, signal)).resolves.toEqual(preview)
    await expect(importTournamentCsv(1, file, {
      expectedEventVersion: 2, sourceSha256: preview.sourceSha256, confirm: true, idempotencyKey: 'csv-import-1',
    }, signal)).resolves.toEqual(preview)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/tournaments/1/csv-import/preview', '/api/admin/tournaments/1/csv-import',
    ])
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({ method: 'POST', signal, headers: { Authorization: 'Bearer fixture-token' } })
      expect(new Headers(options?.headers).has('Content-Type')).toBe(false)
      expect(options?.body).toBeInstanceOf(FormData)
      const data = options?.body as FormData
      expect(data.get('file')).toBe(file)
      expect(data.get('expectedEventVersion')).toBe('2')
    }
    expect([...((fetch.mock.calls[0]?.[1]?.body as FormData).keys())]).toEqual(['file', 'expectedEventVersion'])
    const committed = fetch.mock.calls[1]?.[1]?.body as FormData
    expect(committed.get('sourceSha256')).toBe(preview.sourceSha256)
    expect(committed.get('confirm')).toBe('true')
    expect(committed.get('idempotencyKey')).toBe('csv-import-1')
  })
  it('requires replacement counts and a server-computed hash rather than accepting an old historical preview', () => {
    expect(validateTournament('TournamentCsvImportPreview', preview)).toEqual(preview)
    const { sourceName: _sourceName, sourceSha256: _hash, changes: _changes, ...historical } = preview
    expect(() => validateTournament('TournamentCsvImportPreview', historical)).toThrow('INVALID_RESPONSE')
    expect(() => validateTournament('TournamentCsvImportPreview', { ...preview, sourceSha256: 'incorrect' })).toThrow('INVALID_RESPONSE')
    expect(() => validateTournament('TournamentCsvImportPreview', { ...preview, changes: { ...preview.changes, removedScores: -1 } })).toThrow('INVALID_RESPONSE')
    expect(() => validateTournament('TournamentStandings', { ...preview.standings, csvImported: true })).toThrow('INVALID_RESPONSE')
  })
  it('accepts explicit absent attribution and rejects incomplete source metadata', () => {
    expect(validateTournament('TournamentDataSource', { csvImported: false, attribution: null })).toEqual({ csvImported: false, attribution: null })
    expect(validateTournament('TournamentDataSource', dataSource)).toEqual(dataSource)
    expect(() => validateTournament('TournamentDataSource', { csvImported: false })).toThrow('INVALID_RESPONSE')
    expect(() => validateTournament('TournamentDataSource', { csvImported: true, attribution: { name: '_EK_' } })).toThrow('INVALID_RESPONSE')
  })
})
