import { describe, expect, it } from 'vitest'
import { validateBattlePlaybackDataset } from './contract-runtime.js'

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
})
