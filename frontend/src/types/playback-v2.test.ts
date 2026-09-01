import { expect, it } from 'vitest'
import type { BattlePlaybackDataset, VehiclePlaybackTrack } from './playback-v2.js'
import { isBattlePlaybackDataset, parseBattlePlaybackDataset } from './playback-v2.js'
import { validateBattlePlaybackDataset } from '../api/contract-runtime.js'

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

it('accepts a complete authoritative payload only after raw validation', () => {
  expect(validateBattlePlaybackDataset(dataset).data).toEqual(dataset)
  expect(parseBattlePlaybackDataset(dataset)).toEqual(dataset)
  expect(isBattlePlaybackDataset(dataset)).toBe(true)
})

it.each(['mapCode', 'friendlyTeam', 'recorderAccountId', 'limitations', 'arenaBonusType'])
  ('rejects missing required wire field %s', field => {
    const invalid: Record<string, unknown> = { ...dataset }
    delete invalid[field]
    expect(validateBattlePlaybackDataset(invalid).data).toBeNull()
    expect(parseBattlePlaybackDataset(invalid)).toBeNull()
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
