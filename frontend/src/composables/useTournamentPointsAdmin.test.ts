// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useTournamentPointsAdmin, tournamentGroupReviewError, normalizeTournamentClan } from './useTournamentPointsAdmin.js'
import { tournamentRulesFromInputs } from './useTournamentPointsConfig.js'
import { tournamentAdminAllowed } from '../api/tournament-points.js'
import type { TournamentImageReview } from './useTournamentPointsAdmin.js'
import type { TournamentConfig, TournamentDayView } from '../api/tournament-points.js'

function fixture() {
  const event = { id: 7, version: 1, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: true }
  const group = { groupNumber: 1, evidenceId: 'ad60d534-515d-4ed9-ae6f-0b6b4b614769', imageHash: 'a'.repeat(64), teams: [{ clanTag: 'A', rank: 1 }, { clanTag: 'B', rank: 2 }, { clanTag: 'C', rank: 3 }] }
  const cfg = { event, clans: ['A', 'B', 'C'], rounds: Array.from({ length: 5 }, (_, i) => ({
    roundNumber: i + 1, rulesVersion: 1, complete: true, locked: false,
    days: [1, 2].map(dayNumber => ({ dayNumber, points: [1, 2, 3, 4].map(rank => ({ rank, points: (5 - rank) * 100 })) })),
  })) } as TournamentConfig
  const state = { eventId: 7, roundNumber: 1, dayNumber: 1, eventVersion: 1, rulesVersion: 1, version: 1, status: 'DRAFT', expectedGroupCount: 1,
    groups: [group], published: false, standings: { event, days: [], rows: [] } } as TournamentDayView
  const auth = { authenticated: ref(true), tokenParsed: ref({ sub: 'admin-a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: vi.fn(() => 1) }
  const transport = {
    listTournamentEvents: vi.fn(async (..._args: any[]) => [event]), getTournamentConfig: vi.fn(async (..._args: any[]) => structuredClone(cfg)), getTournamentDay: vi.fn(async (_id: number, round: number, day: number, ..._args: any[]) => ({ ...structuredClone(state), roundNumber: round, dayNumber: day })),
    getTournamentAudit: vi.fn(async (..._args: any[]) => []), previewTournamentDay: vi.fn(async (..._args: any[]) => structuredClone(state)), saveTournamentDraft: vi.fn(async (..._args: any[]) => structuredClone(state)),
    getTournamentHistoricalState: vi.fn(async (..._args: any[]) => ({ eventVersion: 1, imported: false, canImport: false, historical: false })),
    finalizeTournamentDay: vi.fn(async (..._args: any[]) => ({ ...structuredClone(state), status: 'FINALIZED', published: true, version: 2, eventVersion: 2 })),
    setTournamentExpectedGroups: vi.fn(async (..._args: any[]) => structuredClone(state)), startTournamentCorrection: vi.fn(async (..._args: any[]) => ({ ...structuredClone(state), status: 'CORRECTION', groups: [], published: true })),
    discardTournamentDraft: vi.fn(async (..._args: any[]) => structuredClone(state)), clearTournamentPoints: vi.fn(async (..._args: any[]) => state.standings),
    recognizeTournamentImage: vi.fn(async (..._args: any[]) => ({ evidenceId: group.evidenceId, result: { groupNumber: 1, imageHash: group.imageHash, teams: group.teams.map(team => ({ ...team, rankText: String(team.rank) })), complete: true, issues: [] } })),
  }
  return { cfg, state, auth, transport, group }
}
async function settle() { for (let i = 0; i < 8; i++) await nextTick() }
function mountOwner(f = fixture()) {
  const scope = effectScope()
  const owner = scope.run(() => useTournamentPointsAdmin({ api: f.transport, auth: f.auth } as any))!
  return { ...f, owner, scope }
}
function reviewFrom(f: ReturnType<typeof fixture>): TournamentImageReview {
  return { file: new File(['image'], 'one.png', { type: 'image/png' }), url: 'blob:test', evidenceId: f.group.evidenceId,
    result: { groupNumber: 1, imageHash: f.group.imageHash, teams: f.group.teams.map(team => ({ ...team, rankText: String(team.rank) })), complete: true, issues: [] },
    groupNumber: 1, teams: structuredClone(f.group.teams), complete: true, duplicateAction: 'ERROR', confirmedClans: [], error: null }
}
beforeEach(() => { vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}) })

describe('tournament rules and identities', () => {
  it('uses the wire contract Unicode character limit for clan tags', () => {
    const f = fixture()
    const review = reviewFrom(f)
    const tag = '😀'.repeat(20)
    f.cfg.clans.push(tag)
    review.teams[0].clanTag = tag
    expect(tournamentGroupReviewError(review, f.cfg, 1, 1)).toBeNull()
    review.teams[0].clanTag = '😀'.repeat(33)
    expect(tournamentGroupReviewError(review, f.cfg, 1, 1)).toBe('invalidGroup')
  })
  it('retains clan punctuation and strips only a paired outer display bracket', () => {
    expect(normalizeTournamentClan('  [-KSR-] ')).toBe('-KSR-')
    expect(normalizeTournamentClan('[REQM')).toBe('[REQM')
    expect(normalizeTournamentClan('UC浏览器')).toBe('UC浏览器')
  })
  it('does not turn blank required rules into zero, and omits the optional fifth', () => {
    expect(tournamentRulesFromInputs([[0, 2, 3, '', ''], [1, 2, 3, 4, '']])).toBeNull()
    const days = tournamentRulesFromInputs([[0, 2, 3, 4, ''], [1, 2, 3, 4, '']])!
    expect(days[0].points).toHaveLength(4)
    expect(days[0].points[0].points).toBe(0)
    expect(tournamentRulesFromInputs([[1, 2, 3, 4, 0.5], [1, 2, 3, 4, '']])).toBeNull()
  })
  it('uses real realm roles and does not grant access from convenience isAdmin or URL state', () => {
    const f = fixture()
    expect(tournamentAdminAllowed(f.auth as any)).toBe(true)
    f.auth.tokenParsed.value.realm_access.roles = ['HoF-admin']
    expect(tournamentAdminAllowed({ ...f.auth, isAdmin: ref(true) } as any)).toBe(false)
    f.auth.tokenParsed.value.realm_access.roles = ['tournament-admin']
    expect(tournamentAdminAllowed(f.auth as any)).toBe(true)
    f.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    expect(tournamentAdminAllowed(f.auth as any)).toBe(false)
    f.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin', 'tournament-admin']
    expect(tournamentAdminAllowed(f.auth as any)).toBe(true)
    f.auth.authenticated.value = false
    f.auth.tokenParsed.value.realm_access.roles = ['wotbtools-admin']
    expect(tournamentAdminAllowed(f.auth as any)).toBe(false)
  })
  it('requires fifth-place rules and reupload for an incomplete or multi-group image', () => {
    const f = fixture(), review = reviewFrom(f)
    review.teams.push({ clanTag: 'D', rank: 4 }, { clanTag: 'E', rank: 5 })
    review.confirmedClans = ['D', 'E']
    expect(tournamentGroupReviewError(review, f.cfg, 1, 1)).toBe('fifthMissing')
    review.result!.issues = ['MULTIPLE_GROUPS']
    expect(tournamentGroupReviewError(review, f.cfg, 1, 1)).toBe('imageIncomplete')
  })
})

describe('historical import owner', () => {
  function setup() {
    const f = fixture()
    f.state.status = 'EMPTY'
    f.state.groups = []
    f.transport.getTournamentHistoricalState.mockResolvedValue({ eventVersion: 1, imported: false, canImport: true, historical: false })
    f.cfg.event.configLocked = false
    f.auth.tokenParsed.value.realm_access.roles = ['tournament-admin']
    const preview = { standings: f.state.standings, sourceRowCount: 1, clanCount: 1, missingCellCount: 9, eventVersion: 1 }
    const transport = { ...f.transport, previewTournamentHistoricalImport: vi.fn(async (..._args: any[]) => preview),
      importTournamentHistorical: vi.fn(async (..._args: any[]) => preview) }
    const scope = effectScope()
    const owner = scope.run(() => useTournamentPointsAdmin({ api: transport, auth: f.auth } as any))!
    const file = new File([JSON.stringify({ year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2,
      sourceName: '2026 summer top 32', sourceSha256: 'a'.repeat(64), rows: [{ clanTag: '-TOP-', points: [100, ...Array(9).fill(null)], sourceTotal: 100 }] })], 'history.json')
    return { ...f, transport, scope, owner, file, preview }
  }
  it('previews historical scores without requiring ranked-group configuration and preserves retry identity', async () => {
    const f = setup()
    f.cfg.rounds.forEach(rule => { rule.complete = false; rule.days = [] })
    f.owner.eventId.value = 7
    await settle()
    await f.owner.previewHistorical(f.file)
    expect(f.owner.historicalPreview.value?.missingCellCount).toBe(9)
    expect(f.owner.historicalRequest.value?.rows[0].points[1]).toBeNull()
    f.transport.importTournamentHistorical.mockRejectedValueOnce(new Error('uncertain network response'))
    await f.owner.publishHistorical()
    const firstKey = f.transport.importTournamentHistorical.mock.calls[0][1].idempotencyKey
    expect(f.owner.historicalPreview.value).not.toBeNull()
    await f.owner.publishHistorical()
    expect(f.transport.importTournamentHistorical.mock.calls[1][1].idempotencyKey).toBe(firstKey)
    expect(f.owner.notice.value).toBe('historicalImported')
    f.scope.stop()
  })
  it('drops a slow file read after administrator permission is lost', async () => {
    const f = setup()
    f.owner.eventId.value = 7
    await settle()
    let complete!: (text: string) => void
    const slow = { name: 'history.json', size: 20, text: () => new Promise<string>(resolve => { complete = resolve }) } as File
    const pending = f.owner.previewHistorical(slow)
    f.auth.tokenParsed.value.realm_access.roles = []
    await settle()
    complete(await f.file.text())
    await pending
    expect(f.transport.previewTournamentHistoricalImport).not.toHaveBeenCalled()
    expect(f.owner.historicalRequest.value).toBeNull()
    expect(f.owner.historicalPreview.value).toBeNull()
    f.scope.stop()
  })
  it('refuses wrong-event files and published targets without creating an import request', async () => {
    const f = setup()
    f.owner.eventId.value = 7
    await settle()
    const wrong = JSON.parse(await f.file.text())
    wrong.year = 2025
    await f.owner.previewHistorical(new File([JSON.stringify(wrong)], 'wrong.json'))
    expect(f.owner.historicalFileIssue.value).toBe('historicalEventMismatch')
    expect(f.transport.previewTournamentHistoricalImport).not.toHaveBeenCalled()
    f.owner.dayState.value!.standings.days.push({ roundNumber: 2, dayNumber: 1, label: 'Day 1', published: true })
    await f.owner.previewHistorical(f.file)
    expect(f.transport.previewTournamentHistoricalImport).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('disables one-time import after a committed all-null roster while its days remain empty', async () => {
    const f = setup()
    f.owner.eventId.value = 7
    await settle()
    expect(f.owner.canImportHistorical.value).toBe(true)
    f.cfg.clans = ['缺席']
    f.cfg.event.configLocked = true
    f.transport.getTournamentHistoricalState.mockResolvedValue({ eventVersion: 2, imported: true, canImport: false, historical: false })
    await f.owner.loadSelection()
    expect(f.owner.dayState.value?.status).toBe('EMPTY')
    expect(f.owner.dayState.value?.standings.days.some(day => day.published)).toBe(false)
    expect(f.owner.canImportHistorical.value).toBe(false)
    await f.owner.previewHistorical(f.file)
    expect(f.transport.previewTournamentHistoricalImport).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('keeps ordinary administration working when the previous backend has no historical endpoint', async () => {
    const f = fixture()
    f.transport.getTournamentHistoricalState.mockResolvedValue(null as any)
    const scope = effectScope()
    const owner = scope.run(() => useTournamentPointsAdmin({ api: f.transport, auth: f.auth } as any))!
    owner.eventId.value = 7
    await settle()
    expect(owner.error.value).toBeNull()
    expect(owner.dayState.value?.groups).toHaveLength(1)
    expect(owner.canUpload.value).toBe(true)
    expect(owner.canImportHistorical.value).toBe(false)
    scope.stop()
  })
})
describe('shared tournament draft owner', () => {
  it('does not request or retain administrator data after role loss', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    expect(f.owner.dayState.value?.groups).toHaveLength(1)
    f.auth.tokenParsed.value.realm_access.roles = []
    await settle()
    expect(f.owner.dayState.value).toBeNull()
    expect(f.owner.config.value).toBeNull()
    expect(f.owner.events.value).toEqual([])
    expect(f.owner.audit.value).toEqual([])
    f.scope.stop()
  })
  it('blocks screenshot calls until expected group count and the whole round are ready', async () => {
    const f = mountOwner()
    f.state.expectedGroupCount = null
    f.owner.eventId.value = 7
    await settle()
    await f.owner.recognize([new File(['x'], 'x.png')])
    expect(f.transport.recognizeTournamentImage).not.toHaveBeenCalled()
    f.owner.dayState.value!.expectedGroupCount = 1
    f.owner.config.value!.rounds[0].complete = false
    await f.owner.recognize([new File(['x'], 'x.png')])
    expect(f.transport.recognizeTournamentImage).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('requires explicit duplicate replacement, previews on the server and saves the resulting draft', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.owner.reviews.value = [reviewFrom(f)]
    expect(f.owner.reviewError.value).toBe('duplicate')
    await f.owner.preview()
    expect(f.transport.previewTournamentDay).not.toHaveBeenCalled()
    f.owner.reviews.value[0].duplicateAction = 'REPLACE'
    await f.owner.preview()
    expect(f.transport.previewTournamentDay.mock.calls[0][3].groups[0].duplicateAction).toBe('REPLACE')
    await f.owner.saveDraft()
    expect(f.transport.saveTournamentDraft.mock.calls[0][3].expectedRulesVersion).toBe(1)
    expect(f.owner.reviews.value).toEqual([])
    f.scope.stop()
  })
  it('does not finalize an incomplete day, and finalized dates stop ordinary upload', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.owner.dayState.value!.expectedGroupCount = 2
    await f.owner.finalize()
    expect(f.transport.finalizeTournamentDay).not.toHaveBeenCalled()
    f.owner.dayState.value!.expectedGroupCount = 1
    await f.owner.finalize()
    expect(f.transport.finalizeTournamentDay.mock.calls[0][3]).toEqual({
      expectedEventVersion: 1, expectedDayVersion: 1, expectedRulesVersion: 1, idempotencyKey: expect.any(String),
    })
    expect(f.owner.dayState.value!.status).toBe('FINALIZED')
    expect(f.owner.canUpload.value).toBe(false)
    f.scope.stop()
  })
  it('lets final confirmation publish a reviewed preview without requiring a separate draft click', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.owner.reviews.value = [reviewFrom(f)]
    f.owner.reviews.value[0].duplicateAction = 'REPLACE'
    await f.owner.preview()
    expect(f.owner.canFinalize.value).toBe(true)
    await f.owner.finalize()
    expect(f.transport.saveTournamentDraft).toHaveBeenCalledOnce()
    expect(f.transport.finalizeTournamentDay).toHaveBeenCalledOnce()
    expect(f.transport.saveTournamentDraft.mock.invocationCallOrder[0]).toBeLessThan(f.transport.finalizeTournamentDay.mock.invocationCallOrder[0])
    expect(f.owner.dayState.value!.status).toBe('FINALIZED')
    f.scope.stop()
  })
  it('prompts duplicate replacement for groups repeated within the same image batch', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    const first = reviewFrom(f), second = reviewFrom(f)
    first.groupNumber = 2; second.groupNumber = 2
    f.owner.reviews.value = [first, second]
    expect(f.owner.reviewError.value).toBe('duplicate')
    f.owner.reviews.value[1].duplicateAction = 'SKIP'
    expect(f.owner.reviewError.value).toBeNull()
    await f.owner.preview()
    expect(f.transport.previewTournamentDay.mock.calls[0][3].groups).toHaveLength(1)
    expect(f.transport.previewTournamentDay.mock.calls[0][3].groups[0].teams).toEqual(first.teams)
    f.scope.stop()
  })
  it('submits only the explicitly selected replacement with its own evidence and clan confirmations', async () => {
    const f = mountOwner()
    f.state.groups = []
    f.owner.eventId.value = 7
    await settle()
    const first = reviewFrom(f), replacement = reviewFrom(f)
    first.groupNumber = 2; replacement.groupNumber = 2
    first.teams[0].clanTag = 'OLD'
    first.confirmedClans = ['OLD']
    replacement.teams[0].clanTag = 'LATEST'
    replacement.confirmedClans = ['LATEST']
    replacement.evidenceId = 'e7c7197d-6a9b-4e94-a870-c9f5e99ca97a'
    replacement.result!.imageHash = 'b'.repeat(64)
    f.owner.reviews.value = [first, replacement]
    expect(f.owner.reviewError.value).toBe('duplicate')
    await f.owner.saveDraft()
    expect(f.transport.saveTournamentDraft).not.toHaveBeenCalled()
    // An invalid superseded image cannot block its explicitly reviewed replacement.
    f.owner.reviews.value[0].complete = false
    f.owner.reviews.value[1].duplicateAction = 'REPLACE'
    expect(f.owner.reviewError.value).toBeNull()
    f.transport.saveTournamentDraft.mockImplementation(async (_id, _round, _day, request) => ({
      ...structuredClone(f.state), groups: request.groups.map(({ duplicateAction, complete, ...group }) => group),
    }))
    await f.owner.saveDraft()
    const submitted = f.transport.saveTournamentDraft.mock.calls[0][3]
    expect(submitted.groups).toHaveLength(1)
    expect(submitted.groups[0]).toMatchObject({ groupNumber: 2, evidenceId: replacement.evidenceId, imageHash: 'b'.repeat(64),
      teams: replacement.teams, duplicateAction: 'REPLACE' })
    expect(submitted.confirmedNewClans).toEqual(['LATEST'])
    expect(f.owner.dayState.value!.groups).toHaveLength(1)
    expect(f.owner.reviews.value).toEqual([])
    f.scope.stop()
  })
  it('uses a new publication key after an owned correction starts on the same page', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    await f.owner.finalize()
    const firstKey = f.transport.finalizeTournamentDay.mock.calls[0][3].idempotencyKey
    await f.owner.correction(1, 'Replace the complete day')
    const reupload = reviewFrom(f)
    reupload.evidenceId = 'e7c7197d-6a9b-4e94-a870-c9f5e99ca97a'
    reupload.result!.imageHash = 'c'.repeat(64)
    f.owner.reviews.value = [reupload]
    await f.owner.saveDraft()
    await f.owner.finalize()
    expect(f.transport.finalizeTournamentDay).toHaveBeenCalledTimes(2)
    expect(f.transport.finalizeTournamentDay.mock.calls[1][3].idempotencyKey).not.toBe(firstKey)
    f.scope.stop()
  })
  it('retains the publication key when a network failure leaves the outcome uncertain', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.transport.finalizeTournamentDay.mockRejectedValueOnce({ errorCode: 'NETWORK_ERROR', retryable: true })
    await f.owner.finalize()
    expect(f.owner.dayState.value!.status).toBe('DRAFT')
    await f.owner.finalize()
    expect(f.transport.finalizeTournamentDay.mock.calls[1][3].idempotencyKey)
      .toBe(f.transport.finalizeTournamentDay.mock.calls[0][3].idempotencyKey)
    f.scope.stop()
  })
  it('does not rotate another day’s pending publication key from a late correction response', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.owner.dayState.value!.status = 'FINALIZED'
    let completeCorrection!: (value: any) => void
    f.transport.startTournamentCorrection.mockImplementation(() => new Promise(resolve => { completeCorrection = resolve }))
    const previous = f.owner.correction(1, 'Replace the old day')
    f.owner.day.value = 2
    await settle()
    f.transport.finalizeTournamentDay.mockImplementation(async (_id, round, day) => ({
      ...structuredClone(f.state), roundNumber: round, dayNumber: day, status: 'FINALIZED', published: true, version: 2, eventVersion: 2,
    }))
    f.transport.finalizeTournamentDay.mockRejectedValueOnce({ errorCode: 'NETWORK_ERROR', retryable: true })
    await f.owner.finalize()
    completeCorrection({ ...structuredClone(f.state), status: 'CORRECTION', groups: [] })
    await previous
    expect(f.owner.dayState.value!.dayNumber).toBe(2)
    expect(f.owner.dayState.value!.status).toBe('DRAFT')
    await f.owner.finalize()
    expect(f.transport.finalizeTournamentDay.mock.calls[1][3].idempotencyKey)
      .toBe(f.transport.finalizeTournamentDay.mock.calls[0][3].idempotencyKey)
    f.scope.stop()
  })
  it('starts correction as an empty workspace while keeping the published marker', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.owner.dayState.value!.status = 'FINALIZED'
    f.owner.dayState.value!.published = true
    await f.owner.correction(2, 'Missing group')
    expect(f.transport.startTournamentCorrection.mock.calls[0][3].expectedGroupCount).toBe(2)
    expect(f.owner.dayState.value!.groups).toEqual([])
    expect(f.owner.dayState.value!.published).toBe(true)
    expect(f.owner.dayState.value!.status).toBe('CORRECTION')
    f.scope.stop()
  })
  it('marks stale versions and blocks writes until refreshed', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    f.transport.setTournamentExpectedGroups.mockRejectedValue({ errorCode: 'TOURNAMENT_VERSION_CONFLICT', status: 409 })
    await f.owner.setExpected(3)
    expect(f.owner.stale.value).toBe(true)
    expect(f.owner.canUpload.value).toBe(false)
    await f.owner.finalize()
    expect(f.transport.finalizeTournamentDay).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('rejects a late recognition result after day selection changes', async () => {
    const f = mountOwner()
    f.owner.eventId.value = 7
    await settle()
    let finish!: (value: any) => void
    f.transport.recognizeTournamentImage.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = f.owner.recognize([new File(['x'], 'x.png')])
    f.owner.day.value = 2
    await settle()
    finish({ result: reviewFrom(f).result, evidenceId: f.group.evidenceId })
    await pending
    expect(f.owner.reviews.value).toEqual([])
    expect(f.owner.dayState.value?.dayNumber).toBe(2)
    f.scope.stop()
  })
})
