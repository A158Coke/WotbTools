// @vitest-environment happy-dom

/**
 * Historical end-to-end regression matrix for the playback orchestrator.
 * Component ownership contracts live in BattleMap/PlaybackControls/
 * PlaybackTimeline/VehicleDetailsPanel focused tests; this suite remains
 * intentionally broad so the PR4 extraction does not discard proven replay
 * protocol, visibility, marker, and interaction regressions.
 */

import { vi } from 'vitest'
import { mount } from '@vue/test-utils'
import BattlePlayback from './BattlePlayback.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'zh' } })
}))

vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    }
  }
}))

vi.mock('../utils/mapPalette.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    luminanceOfImage: vi.fn().mockResolvedValue(0.8)
  }
})

vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({
    resolved: new Map(),
    failed: new Set(),
    byTank: new Map(),
  })),
}))

vi.mock('../vehicle-portraits/runtime.js', () => ({
  loadVehiclePortrait: vi.fn(async (tankId) => tankId === 2 ? '/portraits/2.webp' : null),
}))

export function makeOverview() {
  return {
    mapCode: 'holland',
    displayName: 'Molendijk',
    displayNames: { zh: '莫伦代克', en: 'Molendijk', ru: 'Молендейк' },
    playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
    friendlyTeam: 1,
    arenaBonusType: 1,
    recorderAccountId: 1001,
    gridCells: [],
    spawnPoints: [],
    routes: [
      {
        accountId: 1001, playerName: 'You', tankId: 1, team: 1,
        points: [{ x: 0, y: 0, timeSec: 10 }, { x: 50, y: 50, timeSec: 14 }],
        firstObservedSec: 10, lastObservedSec: 20, deathSec: null
      },
      {
        accountId: 2001, playerName: 'EnemyA', tankId: 2, team: 2,
        points: [{ x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 }],
        firstObservedSec: 10, lastObservedSec: 30, deathSec: null
      }
    ]
  }
}

export function mountPlayback(overview = makeOverview(), seekTo = null, dataset = undefined) {
  const finalDataset = dataset === undefined ? makePlaybackV2() : dataset
  return mount(BattlePlayback, {
    props: { overview, seekTo, playbackV2: finalDataset },
    global: { mocks: { $t: i18n.t } }
  })
}

export function makePlaybackV2() {
  return {
    durationSec: 60,
    mapCode: 'holland', friendlyTeam: 1, recorderAccountId: 1001, capability: 'FULL', arenaBonusType: null,
    events: [
      { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, observedHpLoss: null },
      { type: 'DAMAGE', timeSec: 12, accountId: 1001, targetAccountId: 2001, observedHpLoss: 400 },
      { type: 'POSITION_STALE', timeSec: 20, accountId: 2001, targetAccountId: null, observedHpLoss: null },
    ],
    vehicles: [
      {
        accountId: 1001, playerName: 'You', tankId: 1, tankName: 'Maus', tankClass: '', team: 1, friendly: true,
        loadout: null,
        positionSegments: [
          { knowledge: 'OBSERVED', startSec: 0, endSec: 60,
            samples: [{ timeSec: 0, x: 0, y: 0, knowledge: 'OBSERVED' }, { timeSec: 60, x: 60, y: 60, knowledge: 'OBSERVED' }] },
        ],
        orientationSegments: [
          { knowledge: 'CURRENT', startSec: 0, endSec: 60,
            samples: [{ timeSec: 0, hullYawDeg: 0, turretRelativeYawDeg: 0 }, { timeSec: 60, hullYawDeg: 90, turretRelativeYawDeg: 30 }] },
        ],
        healthTransitions: [{ timeSec: 0, currentHp: 1500, knowledge: 'CURRENT', displayCapacityHp: 1500, source: 'EXACT_BATTLE_EVENT' }],
        lifeTransitions: [],
        damageLosses: [],
        consumableTransitions: [],
        moduleCrewTransitions: [],
      },
      {
        accountId: 2001, playerName: 'EnemyA', tankId: 2, tankName: 'T49', tankClass: '', team: 2, friendly: false,
        loadout: null,
        positionSegments: [
          { knowledge: 'OBSERVED', startSec: 10, endSec: 20,
            samples: [{ timeSec: 10, x: -50, y: -50, knowledge: 'OBSERVED' }, { timeSec: 20, x: -60, y: -60, knowledge: 'OBSERVED' }] },
        ],
        orientationSegments: [
          { knowledge: 'CURRENT', startSec: 10, endSec: 20,
            samples: [{ timeSec: 10, hullYawDeg: 10, turretRelativeYawDeg: 5 }, { timeSec: 20, hullYawDeg: 30, turretRelativeYawDeg: 20 }] },
        ],
        healthTransitions: [
          { timeSec: 0, currentHp: 1200, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
          { timeSec: 12, currentHp: 800, knowledge: 'CURRENT', displayCapacityHp: 1200, source: 'EXACT_BATTLE_EVENT' },
        ],
        lifeTransitions: [{ timeSec: 25, lifeState: 'DESTROYED', destroyedKnownAtSec: 25 }],
        damageLosses: [{ fromSec: 0, toSec: 12, hpLoss: 400, attackerAccountId: 1001, attackerReliable: true, damageEventCount: 1 }],
        consumableTransitions: [],
        moduleCrewTransitions: [],
      },
      { accountId: 2002, playerName: 'NeverSeen', tankId: 3, team: 2, friendly: false,
        loadout: null, positionSegments: [], orientationSegments: [], healthTransitions: [], lifeTransitions: [], damageLosses: [],
        consumableTransitions: [], moduleCrewTransitions: [] },
    ],
    pointsSamples: [],
  }
}

let rafCb

export function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafCb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}
