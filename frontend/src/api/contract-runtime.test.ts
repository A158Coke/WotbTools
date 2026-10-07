import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { validateApiError, validateBattlePlaybackDataset } from './contract-runtime.js'
import { API_ERROR_CODES } from './generated/api-error-codes.js'
import { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'

it('loads generated validators as native ESM and enforces Unicode tag lengths', () => {
  // Vitest's transform can supply require; a separate native ESM process cannot.
  const validatorUrl = new URL('./generated/contract-validators.js', import.meta.url).href
  const event = {
    id: 7, version: 1, year: 2026, region: 'CN', season: 'SUMMER',
    roundCount: 4, daysPerRound: 2, dayLabels: ['Day 1', 'Day 2'], configLocked: false,
  }
  const day = {
    eventId: 7, roundNumber: 1, dayNumber: 1, eventVersion: 1, rulesVersion: 1, version: 1,
    status: 'DRAFT', expectedGroupCount: 1, published: false,
    groups: [{
      groupNumber: 1, evidenceId: '00000000-0000-4000-8000-000000000001', imageHash: 'a'.repeat(64),
      teams: [{ clanTag: '😀'.repeat(20), rank: 1 }, { clanTag: 'B', rank: 2 }, { clanTag: 'C', rank: 3 }],
    }],
    standings: { event, days: [], rows: [] },
  }
  const program = `
    const validators = await import(${JSON.stringify(validatorUrl)});
    const event = ${JSON.stringify(event)};
    if (!validators.tournamentEventValidator(event)) throw new Error('Valid event rejected');
    const day = ${JSON.stringify(day)};
    if (!validators.tournamentDayViewValidator(day)) throw new Error('Unicode tag rejected');
    day.groups[0].teams[0].clanTag = 'x'.repeat(500);
    if (validators.tournamentDayViewValidator(day)) throw new Error('Length limit ignored');
    console.log('native-esm validators OK');
  `
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' }))
    .toContain('native-esm validators OK')
})

function dataset(confidence = 'HIGH') {
  return {
    durationSec: 60,
    mapCode: null,
    friendlyTeam: 1,
    recorderAccountId: 7,
    vehicles: [{
      accountId: 7,
      playerName: 'Player',
      tankId: 123,
      tankName: 'Tank',
      tankClass: 'medium',
      tankTier: null,
      team: 1,
      friendly: true,
      loadout: {
        replayVersion: null,
        consumables: [null, 'REPAIR_KIT', null],
        consumableWireCodes: [null, 13, null],
        provisions: [null, null, null],
        provisionWireCodes: [null, null, null],
        equipmentIds: [null, 1, null, null, null, null, null, null, null],
        confidence,
      },
      positionSegments: [],
      orientationSegments: [],
      healthTransitions: [],
      lifeTransitions: [],
      damageLosses: [],
      consumableTransitions: [],
      moduleCrewTransitions: [],
    }],
    events: [],
    pointsSamples: [],
    baseStates: [],
    limitations: [],
    capability: 'FULL',
    arenaBonusType: null,
  }
}

it('accepts optional recorded totals while retaining compatibility with datasets without them', () => {
  const playback = makeBattlePlaybackDataset()
  expect(validateBattlePlaybackDataset(playback).data).not.toBeNull()
  playback.vehicles[0].damageDealtSamples = [{ timeSec: 10, total: 900 }]
  expect(validateBattlePlaybackDataset(playback).data).not.toBeNull()
  playback.vehicles[0].damageDealtSamples[0].total = -1
  expect(validateBattlePlaybackDataset(playback).data).toBeNull()
  playback.vehicles[0].damageDealtSamples[0] = { timeSec: -1, total: 900 }
  expect(validateBattlePlaybackDataset(playback).data).toBeNull()
})

describe('HTTP contract runtime validator', () => {
  it('accepts the production-shaped Playback V2 envelope', () => {
    const result = validateBattlePlaybackDataset(dataset())
    expect(result.data?.vehicles[0].loadout?.confidence).toBe('HIGH')
    expect(result.diagnostics).toEqual([])
  })

  it('accepts the shared component fixture at the runtime contract boundary', () => {
    const result = validateBattlePlaybackDataset(makeBattlePlaybackDataset())
    expect(result.diagnostics).toEqual([])
  })

  it('rejects a domain confidence value at the HTTP boundary', () => {
    const result = validateBattlePlaybackDataset(dataset('EXACT'))
    expect(result.data).toBeNull()
    expect(result.diagnostics[0]).toMatchObject({
      endpoint: 'local replay dataset (client-side projection)',
      schema: 'BattlePlaybackDataset',
      path: '/vehicles/0/loadout/confidence',
    })
  })

  it('accepts the generated server ApiError wire shape', () => {
    const result = validateApiError({
      id: 'error-1',
      errorCode: 'DATASET_REFERENCE_REQUIRED',
      errorMsg: null,
      status: 400,
      retryable: false,
      details: {},
      timestamp: null,
    })
    expect(result.data?.errorCode).toBe('DATASET_REFERENCE_REQUIRED')
    expect(result.diagnostics).toEqual([])
  })

  it('rejects a lowercase ApiError machine code', () => {
    const result = validateApiError({
      id: 'error-1',
      errorCode: 'invalid_request',
      errorMsg: null,
      status: 400,
      retryable: false,
      details: {},
      timestamp: null,
    })
    expect(result.data).toBeNull()
  })

  it('keeps client-local failures out of the generated server registry', () => {
    expect(API_ERROR_CODES).toContain('DATASET_REFERENCE_REQUIRED')
    expect(API_ERROR_CODES).not.toEqual(expect.arrayContaining([
      'NETWORK_ERROR', 'REQUEST_ABORTED', 'MALFORMED_ERROR_RESPONSE', 'UNKNOWN_ERROR',
    ]))
  })

  it('rejects an incomplete ApiError envelope instead of widening the wire contract', () => {
    const result = validateApiError({
      id: 'error-1', errorCode: 'INTERNAL_ERROR', status: null,
      retryable: true, details: {}, timestamp: null,
    })
    expect(result.data).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ schema: 'ApiError', path: '$' }),
    ]))
  })

  // PR #229 rolling-deployment compatibility: baseStates is an additive wire field.
  it('legacy payload without baseStates validates and normalizes to []', () => {
    const legacy = { ...dataset() } as Record<string, unknown>
    delete legacy.baseStates
    const result = validateBattlePlaybackDataset(legacy)
    expect(result.diagnostics).toEqual([])
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data!.baseStates)).toBe(true)
    expect(result.data!.baseStates).toEqual([])
  })

  it('payload with valid baseStates preserves values', () => {
    const states = [
      { timeSec: 0, baseId: 'A' as const, ownerTeam: 1, capturingTeam: null, captureProgress: 0 },
    ]
    const withStates = { ...dataset(), baseStates: states }
    const result = validateBattlePlaybackDataset(withStates)
    expect(result.diagnostics).toEqual([])
    expect(result.data!.baseStates).toEqual(states)
  })

  it('malformed baseStates still fails validation', () => {
    const bad = { ...dataset(), baseStates: 'not-an-array' }
    expect(validateBattlePlaybackDataset(bad).data).toBeNull()
  })

  it('accepts independent Assault objective evidence with no progress and rejects non-boolean values', () => {
    const payload = { ...dataset(), assaultObjectivePresent: true, baseStates: [] }
    expect(validateBattlePlaybackDataset(payload).data?.assaultObjectivePresent).toBe(true)
    expect(validateBattlePlaybackDataset({ ...payload, assaultObjectivePresent: 2 }).data).toBeNull()
  })

  it('accepts Assault BASE at 100 and rejects progress outside the wire domain', () => {
    const state = { timeSec: 0, baseId: 'BASE', ownerTeam: null, capturingTeam: null, captureProgress: 100 }
    expect(validateBattlePlaybackDataset({ ...dataset(), baseStates: [state] }).data?.baseStates).toEqual([state])
    for (const captureProgress of [-1, 101]) {
      expect(validateBattlePlaybackDataset({ ...dataset(), baseStates: [{ ...state, captureProgress }] }).data).toBeNull()
    }
  })

  it('missing an unrelated required field still fails validation', () => {
    const missing = { ...dataset() } as Record<string, unknown>
    delete missing.durationSec
    expect(validateBattlePlaybackDataset(missing).data).toBeNull()
  })
})
