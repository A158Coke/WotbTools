/** Build the single current-shape Battle Playback V2 fixture used by component tests. */
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
    arenaBonusType: null,
  }
}

function defaultVehicles() {
  return [
    {
      accountId: 1001, playerName: 'You', tankId: 1, tankName: 'Maus', tankClass: '', tankTier: null, team: 1, friendly: true,
      loadout: null,
      positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 60,
        samples: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 60, x: 60, y: 60 }] }],
      orientationSegments: [{ knowledge: 'CURRENT', startSec: 0, endSec: 60,
        samples: [{ timeSec: 0, hullYawDeg: 0, turretRelativeYawDeg: 0 }, { timeSec: 60, hullYawDeg: 90, turretRelativeYawDeg: 30 }] }],
      healthTransitions: [{ timeSec: 0, currentHp: 1500, knowledge: 'CURRENT', displayCapacityHp: 1500, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' }],
      lifeTransitions: [],
      damageLosses: [],
      consumableTransitions: [],
      moduleCrewTransitions: [],
    },
    {
      accountId: 2001, playerName: 'EnemyA', tankId: 2, tankName: 'T49', tankClass: '', tankTier: null, team: 2, friendly: false,
      loadout: null,
      positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 10, endSec: 20,
        samples: [{ timeSec: 10, x: -50, y: -50 }, { timeSec: 20, x: -60, y: -60 }] }],
      orientationSegments: [{ knowledge: 'CURRENT', startSec: 10, endSec: 20,
        samples: [{ timeSec: 10, hullYawDeg: 10, turretRelativeYawDeg: 5 }, { timeSec: 20, hullYawDeg: 30, turretRelativeYawDeg: 20 }] }],
      healthTransitions: [
        { timeSec: 0, currentHp: 1200, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
        { timeSec: 12, currentHp: 800, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
      ],
      lifeTransitions: [{ timeSec: 25, lifeState: 'DESTROYED', destroyedKnownAtSec: 25 }],
      damageLosses: [{ fromSec: 10, toSec: 12, hpLoss: 400, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }],
      consumableTransitions: [],
      moduleCrewTransitions: [],
    },
    {
      accountId: 2002, playerName: 'NeverSeen', tankId: 3, tankName: 'NeverSeen', tankClass: '', tankTier: null, team: 2, friendly: false,
      loadout: null,
      positionSegments: [], orientationSegments: [], healthTransitions: [], lifeTransitions: [], damageLosses: [],
      consumableTransitions: [], moduleCrewTransitions: [],
    },
  ]
}

function defaultEvents() {
  return [
    { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, observedHpLoss: null },
    { type: 'DAMAGE', timeSec: 12, accountId: 1001, targetAccountId: 2001, observedHpLoss: 400 },
    { type: 'POSITION_STALE', timeSec: 20, accountId: 2001, targetAccountId: null, observedHpLoss: null },
  ]
}
