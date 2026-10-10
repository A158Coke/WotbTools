import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'

// 与 src/main.js 完全相同的样式加载顺序：三档 form + fullscreen contract 的相对顺序
// 本身就是被验证的契约之一，fixture 不得另起一套顺序。
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
import '../../src/styles/classic-profile.css'

import { messages } from '../../src/locales/messages.js'
import BattlePlayback from '../../src/components/BattlePlayback.vue'
import { makeBattlePlaybackDataset } from '../../src/test/playbackV2TestUtil.js'

/**
 * 浏览器级入口：以固定 dataset 直接挂载**生产**
 * `BattlePlayback`，用于验证播放控件在真实浏览器/真实设备形态下可交互。
 * `?duration=<sec>` 指定时间线长度；`duration=0` 用来复现「duration<=0 时播放按钮
 * 看起来可用但 silent no-op」这一类不可用态。
 */
const params = new URLSearchParams(window.location.search)
const dataset = makeBattlePlaybackDataset()
if (params.has('duration')) dataset.durationSec = Number(params.get('duration'))

/**
 * `?players=7`：每队 N 台车（正常 7v7 名册几何），全程可见、各自在地图不同位置。
 * `?recorder=2`：录像者属于 Team 2——friendly 标志随之翻转，物理队伍（team）不变，
 * 用来证明名册左右只看物理队伍、HUD 仍按录像者视角。
 */
const players = Number(params.get('players') || 0)
if (players > 0) {
  const vehicle = (team, index) => {
    const accountId = team * 1000 + index + 1
    const spread = (index - (players - 1) / 2) * 60
    const x = team === 1 ? -180 : 180
    const maxHp = 1950 - index * 50
    const currentHp = index === 0 ? 0 : maxHp - index * 120
    return {
      // Stress min-content sizing with long CJK and unbroken Latin labels on both sides.
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
const recorderTeam = Number(params.get('recorder') || 1)
dataset.friendlyTeam = recorderTeam
if (players > 0 && recorderTeam === 2) dataset.recorderAccountId = 2002
dataset.vehicles = dataset.vehicles.map((vehicle) => ({ ...vehicle, friendly: vehicle.team === recorderTeam }))

const i18n = createI18n({
  locale: 'zh',
  fallbackLocale: 'en',
  messages,
})

const Root = {
  name: 'PlaybackControlsFixture',
  render: () => h(BattlePlayback, { playbackV2: dataset }),
}

createApp(Root).use(i18n).mount('#app')
