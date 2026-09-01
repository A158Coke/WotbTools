import { describe, expect, it } from 'vitest'
import { validateApiError, validateBattlePlaybackDataset } from './contract-runtime.js'
import { API_ERROR_CODES } from './generated/api-error-codes.js'

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
        equipmentIds: [null, 1, null],
        confidence,
      },
      positionSegments: [],
      orientationSegments: [],
      healthTransitions: [],
      lifeTransitions: [],
      consumableTransitions: [],
      moduleCrewTransitions: [],
    }],
    events: [],
    shots: [],
    pointsSamples: [],
    limitations: [],
    capability: 'FULL',
    arenaBonusType: null,
  }
}

describe('HTTP contract runtime validator', () => {
  it('accepts the production-shaped Playback V2 envelope', () => {
    const result = validateBattlePlaybackDataset(dataset())
    expect(result.data?.vehicles[0].loadout?.confidence).toBe('HIGH')
    expect(result.diagnostics).toEqual([])
  })

  it('rejects a domain confidence value at the HTTP boundary', () => {
    const result = validateBattlePlaybackDataset(dataset('EXACT'))
    expect(result.data).toBeNull()
    expect(result.diagnostics[0]).toMatchObject({
      endpoint: '/api/replay/battle-playback-v2',
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
})
