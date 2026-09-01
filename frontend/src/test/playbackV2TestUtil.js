/** Build a current-shape Battle Playback V2 dataset for component tests. */
export function makeBattlePlaybackDataset({ vehicles = defaultVehicles(), events = defaultEvents() } = {}) {
  return {
    durationSec: 60,
    mapCode: 'holland',
    friendlyTeam: 1,
    recorderAccountId: 1001,
    vehicles,
    events,
    pointsSamples: [],
    limitations: [],
    capability: 'FULL',
    arenaBonusType: 1,
  }
}

function defaultVehicles() {
  return [
    track(1001, 'You', 1, true, 0, 60, 0, 90, 0, 30),
    track(2001, 'EnemyGap', 2, false, -50, 14, 10, 30, 5, 20),
    track(2002, 'EnemyDead', 2, false, 100, 30, null, null, null, null, 30),
  ]
}

function defaultEvents() {
  return [
    { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, observedHpLoss: null },
    { type: 'POSITION_STALE', timeSec: 14, accountId: 2001, targetAccountId: null, observedHpLoss: null },
    { type: 'DESTROYED', timeSec: 30, accountId: 2002, targetAccountId: null, observedHpLoss: null },
  ]
}

function track(accountId, playerName, team, friendly, x, endSec, hullStart, hullEnd, turretStart, turretEnd, destroyedAtSec = null) {
  const samples = [{ timeSec: x === 0 ? 0 : 10, x, y: x }]
  if (endSec > samples[0].timeSec) samples.push({ timeSec: endSec, x: x - 50, y: x - 50 })
  const orientationSamples = hullStart === null || hullStart === undefined ? [] : [
    { timeSec: samples[0].timeSec, hullYawDeg: hullStart, turretRelativeYawDeg: turretStart },
    { timeSec: endSec, hullYawDeg: hullEnd, turretRelativeYawDeg: turretEnd },
  ]
  return {
    accountId, playerName, tankId: accountId, tankName: playerName, tankClass: '', tankTier: null, team,
    friendly, loadout: null,
    positionSegments: [{ startSec: samples[0].timeSec, endSec, knowledge: 'OBSERVED', interpolationAllowed: true, samples }],
    orientationSegments: orientationSamples.length === 0 ? [] : [{ startSec: orientationSamples[0].timeSec, endSec, knowledge: 'CURRENT', samples: orientationSamples }],
    healthTransitions: [],
    lifeTransitions: destroyedAtSec === null || destroyedAtSec === undefined ? [] : [{ timeSec: destroyedAtSec, lifeState: 'DESTROYED', destroyedKnownAtSec: destroyedAtSec }],
    damageLosses: [], consumableTransitions: [], moduleCrewTransitions: [],
  }
}
