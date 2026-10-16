// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useTournamentPointsConfig } from './useTournamentPointsConfig.js'
import type { TournamentConfig, TournamentDefaultRules, TournamentRuleSource } from '../api/tournament-points.js'

function fixture() {
  const cfg: TournamentConfig = { event: { id: 7, version: 1, year: 2026, region: 'CN', season: 'SUMMER', roundCount: 5, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false }, clans: [],
    rounds: Array.from({ length: 5 }, (_, i) => ({ roundNumber: i + 1, rulesVersion: 1, complete: true, locked: false,
      days: [1, 2].map(dayNumber => ({ dayNumber, points: [1, 2, 3, 4].map(rank => ({ rank, points: rank * 100 })) })) })) }
  const defaults: TournamentDefaultRules = { version: 2, active: true, sourceEventId: null, sourceLabel: '2026 FIRE_CUP', updatedAt: null, rounds: cfg.rounds.map(({ roundNumber, days }) => ({ roundNumber, days })) }
  const source: TournamentRuleSource = { eventVersion: 1, source: 'INHERIT', defaultVersion: 2, isDefaultSource: false, defaultOutdated: false }
  const auth = { authenticated: ref(true), tokenParsed: ref({ sub: 'admin-a', realm_access: { roles: ['tournament-admin'] } }), authEpoch: vi.fn(() => 1) }
  const transport = {
    listTournamentEvents: vi.fn(async () => [cfg.event]), getTournamentConfig: vi.fn(async () => structuredClone(cfg)),
    getTournamentRuleSource: vi.fn(async () => structuredClone(source)), getTournamentDefaultRules: vi.fn(async () => structuredClone(defaults)),
    saveTournamentDefaultConfiguration: vi.fn(async (value: { rounds: TournamentDefaultRules['rounds'] }, ..._args: any[]) => { Object.assign(defaults, { version: 3, active: true, sourceEventId: null, rounds: JSON.parse(JSON.stringify(value.rounds)) }); return structuredClone(defaults) }),
    setTournamentDefaultRules: vi.fn(async (..._args: any[]) => { Object.assign(defaults, { version: 3, sourceEventId: 7 }); return structuredClone(defaults) }),
    clearTournamentDefaultRules: vi.fn(async (..._args: any[]) => { Object.assign(defaults, { version: 3, active: false, sourceEventId: null, rounds: [] }); return structuredClone(defaults) }),
    saveTournamentRules: vi.fn(async (..._args: any[]) => { source.source = 'CUSTOM'; source.defaultVersion = null; return structuredClone(cfg) }),
    updateTournament: vi.fn(async (..._args: any[]) => structuredClone(cfg)), createTournament: vi.fn(async (..._args: any[]) => structuredClone(cfg)), deleteTournament: vi.fn(),
  }
  const scope = effectScope()
  const owner = scope.run(() => useTournamentPointsConfig({ api: transport, auth } as any))!
  const select = async () => { owner.eventId.value = 7; await flushPromises() }
  return { cfg, defaults, source, auth, transport, scope, owner, select }
}

describe('default tournament rules state ownership', () => {
  it('checks latest state, cancels without a write, then publishes the explicitly confirmed version', async () => {
    const f = fixture(); await f.select()
    expect(f.owner.canSetDefault.value).toBe(true)
    expect(f.owner.isDefaultSource.value).toBe(false)
    await f.owner.requestDefault('set')
    expect(f.owner.defaultConfirmation.value?.version).toBe(2)
    expect(f.transport.setTournamentDefaultRules).not.toHaveBeenCalled()
    f.owner.cancelDefault()
    await f.owner.confirmDefault()
    expect(f.transport.setTournamentDefaultRules).not.toHaveBeenCalled()
    await f.owner.requestDefault('set'); await f.owner.confirmDefault()
    expect(f.transport.setTournamentDefaultRules.mock.calls[0][0]).toEqual({ eventId: 7, expectedEventVersion: 1, expectedDefaultVersion: 2, confirm: true })
    expect(f.owner.isDefaultSource.value).toBe(true)
    expect(f.owner.notice.value).toBe('defaultSaved')
    f.scope.stop()
  })
  it('can clear the seeded default with no event selected and keeps cancellation harmless', async () => {
    const f = fixture(); await flushPromises()
    await f.owner.requestDefault('clear')
    f.owner.cancelDefault()
    expect(f.owner.defaults.value?.active).toBe(true)
    await f.owner.requestDefault('clear'); await f.owner.confirmDefault()
    expect(f.transport.clearTournamentDefaultRules.mock.calls[0][0]).toEqual({ expectedDefaultVersion: 2, confirm: true })
    expect(f.owner.defaults.value?.active).toBe(false)
    f.scope.stop()
  })
  it('creates the first default without a replacement dialog', async () => {
    const f = fixture(); f.defaults.active = false; f.defaults.rounds = []; f.source.source = 'CUSTOM'; f.source.defaultVersion = null
    await f.select(); await f.owner.requestDefault('set')
    expect(f.transport.setTournamentDefaultRules).toHaveBeenCalledTimes(1)
    expect(f.owner.defaultConfirmation.value).toBeNull()
    f.scope.stop()
  })
  it('blocks dirty settings/rules and preserves edits after a failed rule save', async () => {
    const f = fixture(); await f.select()
    f.owner.ruleInputs.value[0][0] = 555
    await f.owner.requestDefault('set')
    expect(f.transport.setTournamentDefaultRules).not.toHaveBeenCalled()
    expect(f.owner.canSetDefault.value).toBe(false)
    f.transport.saveTournamentRules.mockRejectedValueOnce(new Error('offline'))
    await f.owner.saveRules()
    expect(f.owner.ruleInputs.value[0][0]).toBe(555)
    expect(f.owner.dirty.value).toBe(true)
    await f.owner.refresh()
    f.owner.form.value.year = 2027
    expect(f.owner.canSetDefault.value).toBe(false)
    f.scope.stop()
  })
  it('sends the observed default token when inherited rules become custom', async () => {
    const f = fixture(); await f.select(); await f.owner.saveRules()
    expect(f.transport.saveTournamentRules.mock.calls[0][2].expectedDefaultVersion).toBe(2)
    expect(f.owner.ruleSource.value?.source).toBe('CUSTOM')
    expect(f.owner.notice.value).toBe('rulesSaved')
    f.scope.stop()
  })
  it('keeps the committed switch unchanged on failure and requires refresh for conflicts', async () => {
    const f = fixture(); await f.select(); await f.owner.requestDefault('set')
    f.transport.setTournamentDefaultRules.mockRejectedValueOnce({ errorCode: 'TOURNAMENT_VERSION_CONFLICT' })
    await f.owner.confirmDefault()
    expect(f.owner.stale.value).toBe(true)
    expect(f.owner.isDefaultSource.value).toBe(false)
    expect(f.owner.notice.value).toBe('')
    await f.owner.confirmDefault()
    expect(f.transport.setTournamentDefaultRules).toHaveBeenCalledTimes(1)
    f.scope.stop()
  })
  it('ignores late committed responses after losing the administrator session', async () => {
    const f = fixture(); await f.select(); await f.owner.requestDefault('set')
    let finish!: (value: TournamentDefaultRules) => void
    f.transport.setTournamentDefaultRules.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = f.owner.confirmDefault()
    f.auth.authenticated.value = false
    finish({ ...f.defaults, version: 3, sourceEventId: 7 }); await pending
    expect(f.owner.defaults.value).toBeNull()
    expect(f.owner.config.value).toBeNull()
    expect(f.owner.notice.value).toBe('')
    expect(f.owner.defaultConfirmation.value).toBeNull()
    f.scope.stop()
  })
  it('does not uncheck the current source when clearing fails', async () => {
    const f = fixture(); f.defaults.sourceEventId = 7; await f.select()
    await f.owner.requestDefault('clear')
    f.transport.clearTournamentDefaultRules.mockRejectedValueOnce(new Error('network failure'))
    await f.owner.confirmDefault()
    expect(f.owner.isDefaultSource.value).toBe(true)
    expect(f.owner.defaults.value?.active).toBe(true)
    expect(f.owner.notice.value).toBe('')
    f.scope.stop()
  })
  it('rejects a default change found by the precheck before publishing inherited cells', async () => {
    const f = fixture(); await f.select(); f.defaults.version = 3
    await f.owner.requestDefault('set')
    expect(f.owner.stale.value).toBe(true)
    expect(f.owner.defaultConfirmation.value).toBeNull()
    expect(f.transport.setTournamentDefaultRules).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('reads source before config and refuses mixed event versions', async () => {
    const f = fixture(); f.source.eventVersion = 0; await f.select()
    expect(f.transport.getTournamentRuleSource.mock.invocationCallOrder[0]).toBeLessThan(f.transport.getTournamentConfig.mock.invocationCallOrder[0])
    expect(f.owner.stale.value).toBe(true)
    expect(f.owner.config.value).toBeNull()
    f.scope.stop()
  })
  it('clears pending confirmation on event/account changes and ignores a delayed precheck', async () => {
    const f = fixture(); await f.select(); await f.owner.requestDefault('set')
    f.owner.eventId.value = null
    expect(f.owner.defaultConfirmation.value).toBeNull()
    await f.select()
    let finish!: (value: TournamentDefaultRules) => void
    f.transport.getTournamentDefaultRules.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const pending = f.owner.requestDefault('set')
    f.auth.tokenParsed.value = { sub: 'admin-b', realm_access: { roles: ['tournament-admin'] } }
    await flushPromises(); finish(f.defaults); await pending
    expect(f.owner.defaultConfirmation.value).toBeNull()
    expect(f.transport.setTournamentDefaultRules).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('keeps ordinary configuration on an older backend and lists uncovered inherited days', async () => {
    const f = fixture(); f.cfg.rounds[4].days = []; f.cfg.rounds[4].complete = false
    await f.select()
    expect(f.owner.missingDefaultDays.value).toEqual([{ round: 5, day: 1 }, { round: 5, day: 2 }])
    expect(f.owner.canSetDefault.value).toBe(false)
    f.transport.getTournamentDefaultRules.mockResolvedValue(null as any); f.transport.getTournamentRuleSource.mockResolvedValue(null as any)
    await f.owner.refresh()
    expect(f.owner.defaults.value).toBeNull(); expect(f.owner.config.value?.event.id).toBe(7)
    await f.owner.saveRules()
    expect(f.transport.saveTournamentRules.mock.calls[0][2]).not.toHaveProperty('expectedDefaultVersion')
    f.scope.stop()
  })
})

describe('editing the global configuration independently of seasons', () => {
  it('loads seed rules without an event and preserves edits in multiple rounds before saving the whole set', async () => {
    const f = fixture(); await flushPromises(); f.owner.selectGlobal(); await flushPromises()
    expect(f.owner.config.value).toBeNull(); expect(f.owner.eventId.value).toBeNull()
    expect(f.owner.ruleInputs.value[0][0]).toBe(100)
    f.owner.ruleInputs.value[0][0] = 700
    f.owner.round.value = 2; await nextTick(); f.owner.ruleInputs.value[1][0] = 900
    f.owner.round.value = 1; await nextTick()
    expect(f.owner.ruleInputs.value[0][0]).toBe(700)
    await f.owner.saveRules()
    expect(f.owner.defaultConfirmation.value?.action).toBe('save')
    expect(f.transport.saveTournamentDefaultConfiguration).not.toHaveBeenCalled()
    f.owner.cancelDefault()
    expect(f.owner.ruleInputs.value[0][0]).toBe(700)
    await f.owner.saveRules(); await f.owner.confirmDefault()
    const payload = f.transport.saveTournamentDefaultConfiguration.mock.calls[0][0]
    expect(payload).toMatchObject({ expectedDefaultVersion: 2, confirm: true })
    expect(payload.rounds).toHaveLength(5)
    expect(payload.rounds[0].days[0].points[0].points).toBe(700)
    expect(payload.rounds[1].days[1].points[0].points).toBe(900)
    expect(f.owner.dirty.value).toBe(false)
    expect(f.transport.createTournament).not.toHaveBeenCalled()
    expect(f.transport.updateTournament).not.toHaveBeenCalled()
    expect(f.transport.saveTournamentRules).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('preserves drafts on save failure and refuses overwriting a changed default at precheck', async () => {
    const f = fixture(); f.owner.selectGlobal(); await flushPromises()
    f.owner.ruleInputs.value[0][0] = 800
    f.transport.saveTournamentDefaultConfiguration.mockRejectedValueOnce(new Error('offline'))
    await f.owner.saveRules(); await f.owner.confirmDefault()
    expect(f.owner.ruleInputs.value[0][0]).toBe(800)
    expect(f.owner.dirty.value).toBe(true)
    f.owner.cancelDefault(); f.defaults.version = 5
    await f.owner.saveRules()
    expect(f.owner.stale.value).toBe(true)
    expect(f.transport.saveTournamentDefaultConfiguration).toHaveBeenCalledTimes(1)
    expect(f.owner.ruleInputs.value[0][0]).toBe(800)
    f.scope.stop()
  })
  it('requires all selected days and rounds and preserves hidden edits when changing dimensions', async () => {
    const f = fixture(); f.owner.selectGlobal(); await flushPromises()
    f.owner.form.value.daysPerRound = 3; await nextTick()
    expect(f.owner.canSetDefault.value).toBe(false)
    for (let rank = 0; rank < 4; rank++) f.owner.ruleInputs.value[2][rank] = rank + 1
    expect(f.owner.canSetDefault.value).toBe(false)
    f.owner.form.value.daysPerRound = 2; f.owner.form.value.roundCount = 4; await nextTick()
    expect(f.owner.canSetDefault.value).toBe(true)
    expect(f.owner.globalRules.value).toHaveLength(4)
    f.owner.form.value.daysPerRound = 3; await nextTick()
    expect(f.owner.ruleInputs.value[2]).toEqual([1, 2, 3, 4, ''])
    f.scope.stop()
  })
  it('closes global confirmation when returning to an event and never sends a global save for the new selection', async () => {
    const f = fixture(); await f.select(); f.owner.selectGlobal(); await flushPromises()
    await f.owner.saveConfig()
    expect(f.owner.defaultConfirmation.value?.action).toBe('save')
    f.owner.selectEvent(7)
    expect(f.owner.defaultConfirmation.value).toBeNull()
    await flushPromises(); await f.owner.confirmDefault()
    expect(f.owner.globalMode.value).toBe(false)
    expect(f.owner.config.value?.event.id).toBe(7)
    expect(f.transport.saveTournamentDefaultConfiguration).not.toHaveBeenCalled()
    expect(f.transport.createTournament).not.toHaveBeenCalled()
    f.scope.stop()
  })
  it('can switch off global rules and enable the retained full draft again without a source event', async () => {
    const f = fixture(); f.owner.selectGlobal(); await flushPromises()
    await f.owner.requestDefault('clear'); await f.owner.confirmDefault()
    expect(f.owner.defaultEnabled.value).toBe(false)
    expect(f.owner.ruleInputs.value[0][0]).toBe(100)
    await f.owner.requestDefault('set')
    expect(f.transport.saveTournamentDefaultConfiguration).toHaveBeenCalledTimes(1)
    expect(f.owner.defaultEnabled.value).toBe(true)
    f.scope.stop()
  })
})
