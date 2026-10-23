import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { validateApiError, validateBattlePlaybackDataset } from './contract-runtime.js'
import { API_ERROR_CODES } from './generated/api-error-codes.js'
import contractSchema from './generated/playback-v2.schema.js'
import { tournamentDefaultRulesValidator, tournamentRuleSourceValidator } from './generated/contract-validators.js'
import { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'

describe('tournament default rule wire compatibility', () => {
  it('accepts seeded and deleted-source snapshots, including real zero points and no fifth-place rule', () => {
    const snapshot = {
      version: 1, active: true, sourceEventId: null, sourceLabel: '2026 FIRE_CUP',
      updatedAt: '2026-10-16T00:00:00Z',
      rounds: Array.from({ length: 5 }, (_, round) => ({
        roundNumber: round + 1,
        days: [1, 2].map(dayNumber => ({ dayNumber, points: [1, 2, 3, 4].map(rank => ({ rank, points: 0 })) })),
      })),
    }
    expect(tournamentDefaultRulesValidator(snapshot)).toBe(true)
    expect(tournamentDefaultRulesValidator({ ...snapshot, sourceEventId: 7 })).toBe(true)
    expect(tournamentDefaultRulesValidator({ ...snapshot, sourceEventId: 0 })).toBe(false)
    expect(tournamentDefaultRulesValidator({ ...snapshot, version: -1 })).toBe(false)
    expect(tournamentDefaultRulesValidator({ ...snapshot, updatedAt: 'invalid' })).toBe(false)
  })

  it('retains the inactive singleton version and accepts frozen rules without default provenance', () => {
    expect(tournamentDefaultRulesValidator({
      version: 3, active: false, sourceEventId: null, sourceLabel: '', updatedAt: null, rounds: [],
    })).toBe(true)
    const source = { eventVersion: 2, source: 'INHERIT', defaultVersion: 3, isDefaultSource: false, defaultOutdated: false }
    expect(tournamentRuleSourceValidator(source)).toBe(true)
    expect(tournamentRuleSourceValidator({ ...source, source: 'FROZEN', defaultVersion: null })).toBe(true)
    expect(tournamentRuleSourceValidator({ ...source, source: 'inherit' })).toBe(false)
    expect(tournamentRuleSourceValidator({ ...source, defaultVersion: -1 })).toBe(false)
  })

  it.each([
    ['TournamentRuleRequest', { expectedEventVersion: 0, expectedRulesVersion: 0, days: [] }],
    ['TournamentExpectedGroupsRequest', { expectedEventVersion: 0, expectedDayVersion: 0, expectedGroupCount: 1 }],
  ])('keeps legacy %s payloads valid while bounding an explicit default version', (name, legacy) => {
    const ajv = new Ajv2020({ strict: false })
    addFormats(ajv)
    const validate = ajv.compile({
      $schema: contractSchema.$schema, $defs: contractSchema.$defs, $ref: `#/$defs/${name}`,
    })
    expect(validate(legacy)).toBe(true)
    for (const expectedDefaultVersion of [null, 0, 3]) {
      expect(validate({ ...legacy, expectedDefaultVersion })).toBe(true)
    }
    for (const expectedDefaultVersion of [-1, 1.5, '3']) {
      expect(validate({ ...legacy, expectedDefaultVersion })).toBe(false)
    }
  })
})

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

describe('observability event wire contract', () => {
  const eventId = '00000000-0000-4000-8000-000000000001'
  const occurredAt = '2026-10-20T00:00:00Z'
  const androidClick = {
    event_id: eventId, event: 'android_download_click', platform: 'web',
    feature: 'android_download', occurred_at: occurredAt,
  }
  const ajv = new Ajv2020({ strict: false })
  addFormats(ajv)
  const validate = ajv.compile({
    $schema: contractSchema.$schema, $defs: contractSchema.$defs, $ref: '#/$defs/ObservabilityEvent',
  })

  it('accepts the exact Android download click tuple', () => {
    expect(validate(androidClick)).toBe(true)
  })

  it.each([
    ['android platform', { ...androidClick, platform: 'android' }],
    ['generic feature', { ...androidClick, feature: 'home' }],
    ['operation_id', { ...androidClick, operation_id: eventId }],
    ['outcome', { ...androidClick, outcome: 'start' }],
    ['error_code', { ...androidClick, error_code: 'PARSE_FAILED' }],
    ['error_id', { ...androidClick, error_id: eventId }],
  ])('rejects %s for android_download_click', (_label, invalid) => {
    expect(validate(invalid)).toBe(false)
  })

  it('keeps generic and replay-parse telemetry valid', () => {
    expect(validate({ ...androidClick, event: 'feature_open', feature: 'home' })).toBe(true)
    expect(validate({
      ...androidClick, event: 'replay_parse', feature: 'replay_parse',
      operation_id: eventId, outcome: 'start',
    })).toBe(true)
  })
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
