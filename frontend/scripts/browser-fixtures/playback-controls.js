import { createApp, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import '../../src/styles/tokens/scale.css'
import '../../src/styles/tokens/color.css'
import '../../src/styles/tokens.css'
import '../../src/styles/showcase.css'
import '../../src/styles/showcase-workspaces.css'
import '../../src/styles/showcase-pages.css'
import '../../src/styles/showcase-rankings.css'
import '../../src/styles/showcase-cohesion.css'
import '../../src/styles/showcase-regressions.css'
import '../../src/styles/app-shell.css'
import '../../src/styles/playback-overlap-ux.css'
import '../../src/styles/playback-shared.css'
import '../../src/styles/playback-mobile.css'
import '../../src/styles/playback-workspace.css'
import '../../src/styles/playback-workspace-3d.css'

import { messages } from '../../src/locales/messages.js'
import BattlePlayback from '../../src/components/BattlePlayback.vue'
import { makeBattlePlaybackDataset } from '../../src/test/playbackV2TestUtil.js'

const params = new URLSearchParams(window.location.search)
const dataset = makeBattlePlaybackDataset()
if (params.has('duration')) dataset.durationSec = Number(params.get('duration'))

const players = Number(params.get('players') || 0)
if (players > 0) {
  const vehicle = (team, index) => {
    const accountId = team * 1000 + index + 1
    const spread = (index - (players - 1) / 2) * 60
    const x = team === 1 ? -180 : 180
    const maxHp = 1950 - index * 50
    const currentHp = index === 0 ? 0 : maxHp - index * 120
    return {
      accountId, playerName: index === 0 ? `T${team}_连续中文昵称LongUnbrokenPlayerNameForRosterRegression` : `T${team}_Player_${index + 1}`, tankId: 10 + index,
      tankName: ['Panzerkampfwagen超级征服者长车型名称', 'SPHT', 'Chieftain Mk. 6', 'Maus', 'IS-7', 'T-62A', 'E 100'][index % 7],
      tankClass: '', tankTier: null, team, friendly: false, loadout: null,
      positionSegments: [{ knowledge: 'OBSERVED', interpolationAllowed: true, startSec: 0, endSec: 60,
        samples: [{ timeSec: 0, x, y: spread }, { timeSec: 60, x: x * 0.5, y: spread }] }],
      orientationSegments: [{ knowledge: 'CURRENT', startSec: 0, endSec: 60,
        samples: [{ timeSec: 0, hullYawDeg: 0, turretRelativeYawDeg: 0 }, { timeSec: 60, hullYawDeg: 0, turretRelativeYawDeg: 0 }] }],
      healthTransitions: [{ timeSec: 0, currentHp: maxHp, knowledge: 'CURRENT', displayCapacityHp: maxHp, relativeFull: true, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' },
        { timeSec: 1, currentHp, knowledge: 'CURRENT', displayCapacityHp: maxHp, relativeFull: false, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' }],
      lifeTransitions: index === 0 ? [{ timeSec: 1, lifeState: 'DESTROYED', destroyedKnownAtSec: 1 }] : [],
      damageLosses: [], consumableTransitions: [], moduleCrewTransitions: [],
    }
  }
  dataset.vehicles = [
    ...Array.from({ length: players }, (_, i) => vehicle(1, i)),
    ...Array.from({ length: players }, (_, i) => vehicle(2, i)),
  ]
  dataset.events = []
  dataset.recorderAccountId = 1002
}
const hudStress = params.get('hud')
if (hudStress) {
  const exactHp = (hp = 12600) => ({ timeSec: 0, currentHp: hp, knowledge: 'CURRENT', displayCapacityHp: 12600, relativeFull: true, source: 'EXACT_BATTLE_EVENT', confidence: 'HIGH' })
  dataset.vehicles = dataset.vehicles.map((vehicle) => {
    const unknown = hudStress === 'mixed' && vehicle.team === 2
    const partial = hudStress === 'mixed' && vehicle.team === 1 && vehicle.accountId % 2 === 0
    return {
      ...vehicle,
      healthTransitions: unknown || partial ? [] : [exactHp(12600 - (vehicle.accountId % 5) * 100)],
    }
  })
  dataset.pointsSamples = [
    { timeSec: 0, team: 1, points: 4 },
    { timeSec: 0, team: 2, points: 2 },
  ]
  dataset.baseStates = ['A', 'B', 'C', 'D'].map((baseId, index) => ({
    baseId,
    timeSec: 0,
    ownerTeam: index < 2 ? 1 : 2,
    capturingTeam: index % 2 ? 2 : 1,
    captureProgress: 25 + index * 15,
  }))
}
if (params.get('shell') === 'immersive') document.documentElement.dataset.shellChrome = 'immersive'
const recorderTeam = Number(params.get('recorder') || 1)
dataset.friendlyTeam = recorderTeam
if (players > 0 && recorderTeam === 2) dataset.recorderAccountId = 2002
dataset.vehicles = dataset.vehicles.map((vehicle) => ({ ...vehicle, friendly: vehicle.team === recorderTeam }))

const i18n = createI18n({
  locale: 'zh',
  fallbackLocale: 'en',
  messages,
})

const result = params.get('marks') === '1' ? {
  players: dataset.vehicles.map((vehicle, index) => ({ account_id: vehicle.accountId, gun_marks: index % 4 })),
} : null

const active = ref(true)
window.__pbFixture = { setActive: (value) => { active.value = !!value } }

const tickFacets = params.get('ticks') === '1' ? {
  facetShots: [{ t_fire: 10, is_author: true, shooter_eid: 1 }],
  facetKills: [{ t: 20 }],
} : {}
const showEventMarkers = params.get('markers') === '1'

const Root = {
  name: 'PlaybackControlsFixture',
  render: () => h(BattlePlayback, {
    playbackV2: dataset, result, active: active.value, ...tickFacets, showEventMarkers,
  }),
}

createApp(Root).use(i18n).mount('#app')
