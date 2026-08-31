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
    ],
    playback: {
      durationSec: 60,
      vehicles: [
        {
          accountId: 1001, playerName: 'You', tankId: 1, tankName: 'Maus', team: 1,
          positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
            { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 }
          ]
        },
        {
          accountId: 2001, playerName: 'EnemyA', tankId: 2, tankName: 'T49', team: 2,
          positionIntervals: [{ startSec: 10, endSec: 20 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 10, turretRelativeYawDeg: 5 },
            { timeSec: 14, hullYawDeg: 30, turretRelativeYawDeg: 20 }
          ],
          hpLosses: [{ fromSec: 0, toSec: 12, hpLoss: 400, attackerAccountId: 1001, attackerReliable: true }]
        },
        { accountId: 2002, playerName: 'NeverSeen', tankId: 3, team: 2, positionIntervals: [], deathSec: null, directionSamples: [] }
      ],
      events: [
        { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, rawProtocolValue: null, observedHpLoss: null },
        { type: 'DAMAGE', timeSec: 12, accountId: 1001, targetAccountId: 2001, rawProtocolValue: 400, observedHpLoss: 400 },
        { type: 'POSITION_STALE', timeSec: 20, accountId: 2001, targetAccountId: null, rawProtocolValue: null, observedHpLoss: null }
      ]
    }
  }
}

// legacy overview.playback → V2 BattlePlaybackDataset 转换（让 legacy 数据语义仍能驱动 V2-only 组件）。
function legacyPlaybackToV2Dataset(overview) {
  const playback = overview && overview.playback
  if (!playback) return makePlaybackV2()
  // 坐标来自 overview.routes[].points（accountId 对账），positionIntervals 提供 OBSERVED 段包络
  const pointsByAccount = new Map((overview.routes || []).map(r => [r.accountId, r.points || []]))
  const vehicles = (playback.vehicles || []).map(v => {
    const hpSamples = v.hpSamples || []
    const maxCap = hpSamples.reduce((m, s) => (s.hp > m ? s.hp : m), 0)
    const healthTransitions = hpSamples.map(s => ({
      timeSec: s.timeSec, currentHp: s.hp,
      knowledge: coveredAt(v.positionIntervals, s.timeSec) ? 'CURRENT' : 'LAST_KNOWN',
      displayCapacityHp: maxCap > 0 ? maxCap : null, source: 'EXACT_BATTLE_EVENT',
    }))
    const lifeTransitions = []
    if (v.deathSec != null) {
      lifeTransitions.push({ timeSec: v.deathSec, lifeState: 'DESTROYED', destroyedKnownAtSec: v.deathSec })
    }
    const pts = pointsByAccount.get(v.accountId) || []
    const posSegs = (v.positionIntervals || []).map(iv => {
      const inRange = pts.filter(p => p.timeSec >= iv.startSec - 1e-6 && p.timeSec <= iv.endSec + 1e-6)
      const samples = inRange.length > 0
        ? inRange.map(p => ({ timeSec: p.timeSec, x: p.x, y: p.y, knowledge: 'OBSERVED' }))
        : [{ timeSec: iv.startSec, x: 0, y: 0, knowledge: 'OBSERVED' }]
      return { knowledge: 'OBSERVED', startSec: iv.startSec, endSec: iv.endSec, samples }
    })
    const orientSegs = (v.directionSamples || []).length > 0 ? [{
      knowledge: 'CURRENT', startSec: (v.directionSamples[0] || {}).timeSec ?? 0,
      endSec: (v.directionSamples[v.directionSamples.length - 1] || {}).timeSec ?? 0,
      samples: v.directionSamples.map(s => ({ timeSec: s.timeSec, hullYawDeg: s.hullYawDeg, turretRelativeYawDeg: s.turretRelativeYawDeg })),
    }] : []
    return {
      accountId: v.accountId, playerName: v.playerName, tankId: v.tankId,
      tankName: v.tankName, tankClass: '', team: v.team, friendly: v.team === 1,
      loadout: null, positionSegments: posSegs, orientationSegments: orientSegs,
      healthTransitions, lifeTransitions, hpLosses: v.hpLosses || [],
      consumableTransitions: [], moduleCrewTransitions: [],
    }
  })
  const events = (playback.events || []).map(e => ({
    type: e.type, timeSec: e.timeSec, accountId: e.accountId ?? null,
    targetAccountId: e.targetAccountId ?? null, observedHpLoss: e.observedHpLoss ?? null,
  })).sort((a, b) => a.timeSec - b.timeSec)
  return { durationSec: playback.durationSec, vehicles, events,
    shots: [], pointsSamples: playback.pointsSamples || [], limitations: [] }
}

function coveredAt(intervals, t) {
  return (intervals || []).some(iv => t >= iv.startSec - 1e-6 && t <= iv.endSec + 1e-6)
}

export function mountPlayback(overview = makeOverview(), seekTo = null, dataset = undefined) {
  const finalDataset = dataset === undefined ? legacyPlaybackToV2Dataset(overview) : dataset
  return mount(BattlePlayback, {
    props: { overview, seekTo, playbackV2: finalDataset },
    global: { mocks: { $t: i18n.t } }
  })
}

export function makePlaybackV2() {
  return {
    durationSec: 60,
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
        consumableTransitions: [],
        moduleCrewTransitions: [],
      },
      { accountId: 2002, playerName: 'NeverSeen', tankId: 3, team: 2, friendly: false,
        loadout: null, positionSegments: [], orientationSegments: [], healthTransitions: [], lifeTransitions: [],
        consumableTransitions: [], moduleCrewTransitions: [] },
    ],
    shots: [],
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
