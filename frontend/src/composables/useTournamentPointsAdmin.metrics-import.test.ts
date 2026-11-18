// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { effectScope } from 'vue'
import { useTournamentPointsAdmin } from './useTournamentPointsAdmin.js'
import { fixture, settle } from '../test/useTournamentPointsAdminTestHelpers'

beforeEach(() => { vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}) })
describe('starting statistics against inherited default rules', () => {
  it('sends the observed global version and rejects mixed event reads before enabling statistics', async () => {
    const f = fixture()
    f.transport.getTournamentRuleSource.mockResolvedValue({ eventVersion: 1, source: 'INHERIT', defaultVersion: 9, isDefaultSource: false, defaultOutdated: false } as any)
    const scope = effectScope()
    const owner = scope.run(() => useTournamentPointsAdmin({ api: f.transport, auth: f.auth } as any))!
    owner.eventId.value = 7; await settle()
    await owner.setExpected(2)
    expect(f.transport.setTournamentExpectedGroups.mock.calls[0][3].expectedDefaultVersion).toBe(9)
    f.transport.getTournamentRuleSource.mockResolvedValue({ eventVersion: 0, source: 'INHERIT', defaultVersion: 9, isDefaultSource: false, defaultOutdated: false } as any)
    await owner.loadSelection()
    expect(owner.stale.value).toBe(true)
    expect(owner.editable.value).toBe(false)
    scope.stop()
  })
})

describe('CSV cumulative snapshot owner', () => {
  function setup() {
    const f = fixture()
    f.state.status = 'FINALIZED'
    f.state.published = true
    f.state.groups = []
    const preview = { standings: f.state.standings, sourceName: 'scores.csv', sourceSha256: 'c'.repeat(64),
      sourceRowCount: 200, clanCount: 200, missingCellCount: 1800, eventVersion: 1,
      changes: { addedClans: 200, changedClans: 0, removedClans: 0, addedScores: 200, changedScores: 0, removedScores: 0, preservedClears: 0 } }
    const transport = { ...f.transport, supportsTournamentCsvImport: vi.fn(async () => true),
      previewTournamentCsvImport: vi.fn(async (..._args: any[]) => structuredClone(preview)),
      importTournamentCsv: vi.fn(async (..._args: any[]) => structuredClone(preview)) }
    const scope = effectScope()
    const owner = scope.run(() => useTournamentPointsAdmin({ api: transport, auth: f.auth } as any))!
    const file = new File(['source data'], 'scores.csv', { type: 'text/csv' })
    return { ...f, transport, scope, owner, file, preview }
  }
  it('accepts finalized tournaments, stages the file without parsing, and binds confirmation to the preview hash', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    expect(f.owner.canImportHistorical.value).toBe(false)
    expect(f.owner.canImportCsv.value).toBe(true)
    f.owner.selectCsvFile(f.file)
    expect(f.transport.previewTournamentCsvImport).not.toHaveBeenCalled()
    await f.owner.previewCsv()
    expect(f.owner.csvPreview.value?.clanCount).toBe(200)
    expect(f.transport.importTournamentCsv).not.toHaveBeenCalled()
    await f.owner.publishCsv()
    expect(f.transport.importTournamentCsv.mock.calls[0].slice(0, 3)).toEqual([7, f.file, {
      expectedEventVersion: 1, sourceSha256: 'c'.repeat(64), confirm: true, idempotencyKey: expect.any(String),
    }])
    expect(f.owner.notice.value).toBe('csvImported')
    expect(f.owner.csvPreview.value).toBeNull()
    expect(f.owner.csvFile.value).toBeNull()
    expect(f.transport.getTournamentDataSource).toHaveBeenCalledTimes(2)
    f.scope.stop()
  })
  it('preserves the exact file, SHA and idempotency key after an uncertain response', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    f.owner.selectCsvFile(f.file); await f.owner.previewCsv()
    f.transport.importTournamentCsv.mockRejectedValueOnce(new Error('uncertain network response'))
    await f.owner.publishCsv()
    expect(f.owner.csvPreview.value?.sourceSha256).toBe('c'.repeat(64))
    expect(f.owner.csvFile.value).toBe(f.file)
    await f.owner.publishCsv()
    expect(f.transport.importTournamentCsv.mock.calls[1][2]).toEqual(f.transport.importTournamentCsv.mock.calls[0][2])
    f.scope.stop()
  })
  it('invalidates an old preview on a file change, day change and another write', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    f.owner.selectCsvFile(f.file); await f.owner.previewCsv()
    f.owner.selectCsvFile(new File(['next'], 'next.csv'))
    expect(f.owner.csvPreview.value).toBeNull()
    await f.owner.publishCsv()
    expect(f.transport.importTournamentCsv).not.toHaveBeenCalled()
    await f.owner.previewCsv()
    f.owner.day.value = 2; await settle()
    expect(f.owner.csvFile.value).toBeNull()
    f.owner.selectCsvFile(f.file); await f.owner.previewCsv()
    await f.owner.clearPoints('A', 2, 'Correction', false)
    expect(f.owner.csvPreview.value).toBeNull()
    f.scope.stop()
  })
  it('does not apply late CSV preview results to another tournament or account', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    let finish!: (value: any) => void
    f.transport.previewTournamentCsvImport.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    f.owner.selectCsvFile(f.file)
    const pending = f.owner.previewCsv()
    f.owner.eventId.value = 8; await settle()
    finish(f.preview); await pending
    expect(f.owner.csvPreview.value).toBeNull()
    expect(f.owner.csvFile.value).toBeNull()
    f.owner.eventId.value = 7; await settle()
    f.owner.selectCsvFile(f.file)
    const previous = f.owner.previewCsv()
    f.auth.tokenParsed.value = { sub: 'admin-b', realm_access: { roles: ['tournament-admin'] } }; await settle()
    finish(f.preview); await previous
    expect(f.owner.csvPreview.value).toBeNull()
    f.scope.stop()
  })
  it('drops an in-flight CSV result when the network is lost', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    let finish!: (value: any) => void
    f.transport.previewTournamentCsvImport.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    f.owner.selectCsvFile(f.file)
    const pending = f.owner.previewCsv()
    f.owner.networkAvailable.value = false; await settle()
    finish(f.preview); await pending
    expect(f.owner.csvPreview.value).toBeNull()
    expect(f.owner.canImportCsv.value).toBe(false)
    f.scope.stop()
  })
  it('does not refresh another tournament or attach success notices after a late import completes', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    f.owner.selectCsvFile(f.file); await f.owner.previewCsv()
    let finish!: (value: any) => void
    f.transport.importTournamentCsv.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = f.owner.publishCsv()
    f.owner.eventId.value = 8; await settle()
    const requestsBeforeResponse = f.transport.getTournamentConfig.mock.calls.length
    finish(f.preview); await pending
    expect(f.transport.getTournamentConfig.mock.calls.length).toBe(requestsBeforeResponse)
    expect(f.owner.notice.value).toBe('')
    expect(f.owner.csvPreview.value).toBeNull()
    f.scope.stop()
  })
  it('blocks visible drafts and corrections while accepting ordinary published targets', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    for (const status of ['DRAFT', 'CORRECTION'] as const) {
      f.owner.dayState.value!.status = status
      f.owner.selectCsvFile(f.file); await f.owner.previewCsv()
      expect(f.owner.csvWorkspaceBusy.value).toBe(true)
    }
    expect(f.transport.previewTournamentCsvImport).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('rejects unsupported, empty and oversized files before upload', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    for (const file of [new File(['json'], 'scores.json'), new File([], 'empty.csv'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.csv')]) {
      f.owner.selectCsvFile(file); await f.owner.previewCsv()
      expect(f.owner.csvFile.value).toBeNull()
      expect(f.owner.csvFileIssue.value).not.toBe('')
    }
    expect(f.transport.previewTournamentCsvImport).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('retains canonical server workspace errors without clearing the staged file', async () => {
    const f = setup()
    f.owner.eventId.value = 7; await settle()
    f.owner.selectCsvFile(f.file)
    f.transport.previewTournamentCsvImport.mockRejectedValueOnce({ errorCode: 'TOURNAMENT_CSV_WORKSPACE_BUSY', status: 409 })
    await f.owner.previewCsv()
    expect(f.owner.error.value).toMatchObject({ errorCode: 'TOURNAMENT_CSV_WORKSPACE_BUSY' })
    expect(f.owner.csvFile.value).toBe(f.file)
    expect(f.owner.csvPreview.value).toBeNull()
    f.scope.stop()
  })
})
