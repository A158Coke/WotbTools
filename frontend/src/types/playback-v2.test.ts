import { expect, it } from 'vitest'
import type { BattlePlaybackDataset, VehiclePlaybackTrack } from './playback-v2.js'
import { isBattlePlaybackDataset, parseBattlePlaybackDataset } from './playback-v2.js'

const track: VehiclePlaybackTrack = {
  accountId: 7,
  playerName: 'Player',
  tankId: 123,
  tankName: 'Tank',
  tankClass: 'medium',
  tankTier: null,
  team: 1,
  friendly: true,
  loadout: null,
  positionSegments: [{
    startSec: 0,
    endSec: 10,
    knowledge: 'OBSERVED',
    interpolationAllowed: true,
    samples: [{ timeSec: 0, x: 0, y: 0, knowledge: 'OBSERVED' }],
  }],
  orientationSegments: [],
  healthTransitions: [],
  lifeTransitions: [],
  consumableTransitions: [],
  moduleCrewTransitions: [],
}

const dataset: BattlePlaybackDataset = {
  durationSec: 60,
  mapCode: null,
  friendlyTeam: 1,
  recorderAccountId: 7,
  vehicles: [track],
  events: [],
  shots: [],
  pointsSamples: [],
  limitations: [],
  capability: 'FULL',
  arenaBonusType: null,
}

it('models nullable playback facts without inventing values', () => {
  expect(dataset.vehicles[0].tankTier).toBeNull()
  expect(dataset.mapCode).toBeNull()
})

it('normalizes additive cache omissions before the playback boundary', () => {
  const parsed = parseBattlePlaybackDataset({
    durationSec: 0,
    vehicles: [],
    events: [],
    shots: [],
    pointsSamples: [],
    limitations: ['TIMELINE_UNAVAILABLE'],
    capability: 'PARTIAL',
  })
  expect(parsed?.durationSec).toBe(0)
  expect(parsed?.capability).toBe('PARTIAL')
  expect(parsed?.mapCode).toBeNull()
  expect(isBattlePlaybackDataset(parsed)).toBe(true)
  expect(parseBattlePlaybackDataset({ vehicles: 'not-an-array' })).toBeNull()
})

it('rejects a missing authoritative envelope', () => {
  expect(parseBattlePlaybackDataset({})).toBeNull()
  expect(parseBattlePlaybackDataset({
    durationSec: 0,
    vehicles: [],
    events: [],
    shots: [],
    pointsSamples: [],
  })).toBeNull()
  expect(parseBattlePlaybackDataset({
    durationSec: 0,
    vehicles: [{}],
    events: [],
    shots: [],
    pointsSamples: [],
    capability: 'FULL',
  })).toBeNull()
  expect(parseBattlePlaybackDataset({
    durationSec: 0,
    vehicles: [],
    events: [],
    shots: [],
    pointsSamples: [],
    capability: 'FULL',
    friendlyTeam: 'bad',
  })).toBeNull()
})
