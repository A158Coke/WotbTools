import { vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useTournamentPointsAdmin } from '../composables/useTournamentPointsAdmin.js'
import type { TournamentImageReview } from '../composables/useTournamentPointsAdmin.js'
import type { TournamentConfig, TournamentDayView } from '../api/tournament-points.js'
export function fixture() {
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
    getTournamentRuleSource: vi.fn(async (..._args: any[]) => null),
    supportsTournamentCsvImport: vi.fn(async (..._args: any[]) => false),
    getTournamentDataSource: vi.fn(async (..._args: any[]) => null),
    getTournamentHistoricalState: vi.fn(async (..._args: any[]) => ({ eventVersion: 1, imported: false, canImport: false, historical: false })),
    finalizeTournamentDay: vi.fn(async (..._args: any[]) => ({ ...structuredClone(state), status: 'FINALIZED', published: true, version: 2, eventVersion: 2 })),
    setTournamentExpectedGroups: vi.fn(async (..._args: any[]) => structuredClone(state)), startTournamentCorrection: vi.fn(async (..._args: any[]) => ({ ...structuredClone(state), status: 'CORRECTION', groups: [], published: true })),
    discardTournamentDraft: vi.fn(async (..._args: any[]) => structuredClone(state)), clearTournamentPoints: vi.fn(async (..._args: any[]) => state.standings),
    recognizeTournamentImage: vi.fn(async (..._args: any[]) => ({ evidenceId: group.evidenceId, result: { groupNumber: 1, imageHash: group.imageHash, teams: group.teams.map(team => ({ ...team, rankText: String(team.rank) })), complete: true, issues: [] } })),
  }
  return { cfg, state, auth, transport, group }
}
export async function settle() { for (let i = 0; i < 8; i++) await nextTick() }
export function mountOwner(f = fixture()) {
  const scope = effectScope()
  const owner = scope.run(() => useTournamentPointsAdmin({ api: f.transport, auth: f.auth } as any))!
  return { ...f, owner, scope }
}
export function reviewFrom(f: ReturnType<typeof fixture>): TournamentImageReview {
  return { file: new File(['image'], 'one.png', { type: 'image/png' }), url: 'blob:test', evidenceId: f.group.evidenceId,
    result: { groupNumber: 1, imageHash: f.group.imageHash, teams: f.group.teams.map(team => ({ ...team, rankText: String(team.rank) })), complete: true, issues: [] },
    groupNumber: 1, teams: structuredClone(f.group.teams), complete: true, duplicateAction: 'ERROR', confirmedClans: [], error: null }
}
