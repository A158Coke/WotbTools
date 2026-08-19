<script setup>
/**
 * 隐藏 QA 页：PR4 §48–§51 固定 14 车移动碰撞场景（仅 wotbtools-admin，深链 ?view=playback-qa）。
 * 直接复用生产 BattlePlayback（含 PR4 标签碰撞/hitbox/状态视觉），不做第二套渲染。
 * 场景固定（非随机）：双密集簇制造 PlayerName/TankName 碰撞压力 + 阵亡/失察/录像者/选中状态混合，
 * 时间线 90s 循环（loop），Play/Pause/Reset + 0.5×/1×/2×/4×。
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import BattlePlayback from './BattlePlayback.vue'

const { t } = useI18n()
const { initPromise, tokenParsed, authenticated, login } = useAuth()

const LOGIN_VIEW = 'playback-qa'

const isAdmin = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && roles.includes('wotbtools-admin')
})

const authPhase = ref(authenticated.value ? 'ready' : 'init')
const ready = ref(false)
const denied = ref(false)
const overview = ref(null)

onMounted(async () => {
  let loggedIn = false
  try {
    loggedIn = Boolean(await initPromise)
  } catch {
    loggedIn = false
  }
  if (!loggedIn) {
    authPhase.value = 'login'
    login(LOGIN_VIEW)
    return
  }
  authPhase.value = 'ready'
  if (!isAdmin.value) {
    denied.value = true
    return
  }
  // 车型名动态加载（tankopedia 权威）；scenario 本身固定。
  const tp = (await import('../../../common/tankopedia-tier10.json')).default
  const byId = new Map(tp.vehicles.map((v) => [v.id, v]))
  overview.value = buildScenario(byId)
  ready.value = true
})

// —— 固定 14 车场景（§48：碰撞压力 + 状态混合；§49：循环移动）——
const DURATION = 90
const TANK_IDS = [6929, 385, 3649, 3681, 3937, 4145, 4417, 4481, 5425, 5505, 5681, 6145, 6209, 6225]
// 轨迹（圆心/半径/相位/角速度）：两个密集簇 + 分散
const PATHS = [
  // 密集簇 A：中心 (0,0)，半径 12–20 → 持续标签碰撞
  { cx: 0, cy: 0, r: 12, a0: 0, w: 1 }, { cx: 0, cy: 0, r: 16, a0: 1.6, w: 0.8 },
  { cx: 0, cy: 0, r: 20, a0: 3.1, w: 0.7 }, { cx: 0, cy: 0, r: 14, a0: 4.5, w: 0.9 },
  // 密集簇 B：中心 (-90, 80)，半径 10–22
  { cx: -90, cy: 80, r: 10, a0: 0.5, w: 1.1 }, { cx: -90, cy: 80, r: 16, a0: 2.2, w: 0.9 },
  { cx: -90, cy: 80, r: 22, a0: 3.8, w: 0.7 },
  // 分散轨道（覆盖全图四象限）
  { cx: 120, cy: -120, r: 60, a0: 0, w: 0.5 },
  { cx: -160, cy: -60, r: 50, a0: 1, w: 0.45 },
  { cx: 160, cy: 100, r: 55, a0: 2, w: 0.55 },
  { cx: -40, cy: -180, r: 45, a0: 3, w: 0.5 },
  { cx: 60, cy: 180, r: 50, a0: 4, w: 0.4 },
  { cx: -200, cy: 170, r: 40, a0: 5, w: 0.6 },
  { cx: 210, cy: -190, r: 45, a0: 0.8, w: 0.5 },
]
const PLAYER_NAMES = [
  'ReplayOperator', 'SuperLongPlayerNameForTruncationCheck', 'SniperWolf', 'TankHunter_88', 'NightOwl',
  'OneShotWunder', 'TurretTwister', 'EnemyAlpha', 'EnemyBeta_LongNicknameForStress', 'EnemyGamma',
  'EnemyDelta', 'EnemyEpsilon', 'EnemyZeta_AlsoQuiteLongName', 'EnemyEta',
]

function circlePoint(p, t) {
  const a = p.a0 + (2 * Math.PI * t / DURATION) * p.w
  return { x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a) }
}

function buildScenario(byId) {
  const vehicles = []
  const routes = []
  for (let i = 0; i < 14; i++) {
    const accountId = i < 7 ? 1001 + i : 2001 + (i - 7)
    const team = i < 7 ? 1 : 2
    const tankId = TANK_IDS[i]
    const tankName = byId.get(tankId)?.name || String(tankId)
    const path = PATHS[i]
    const points = []
    for (let t = 0; t <= DURATION; t += 3) {
      const p = circlePoint(path, t)
      points.push({ x: p.x, y: p.y, timeSec: t })
    }
    // 状态：1005/2005 阵亡（t=30/60 冻结）；1004 失察 gap（25–40 last-known）
    const deathSec = accountId === 1005 ? 30 : (accountId === 2005 ? 60 : null)
    const positionIntervals = accountId === 1004
      ? [{ startSec: 0, endSec: 25 }, { startSec: 40, endSec: 90 }]
      : [{ startSec: 0, endSec: DURATION }]
    const directionSamples = [
      { timeSec: 0, hullYawDeg: (i * 37) % 360, turretRelativeYawDeg: (i * 23) % 360 },
      { timeSec: DURATION, hullYawDeg: (i * 37) % 360, turretRelativeYawDeg: (i * 23) % 360 },
    ]
    vehicles.push({
      accountId, playerName: PLAYER_NAMES[i], tankId, tankName, team,
      positionIntervals, deathSec, directionSamples,
      maxHp: 2000, hpSamples: [{ timeSec: 0, hp: 2000 }, { timeSec: 30, hp: deathSec ? 0 : 1200 }],
    })
    routes.push({
      accountId, playerName: PLAYER_NAMES[i], tankId, team,
      points, firstObservedSec: 0, lastObservedSec: DURATION, deathSec,
    })
  }
  return {
    mapCode: 'holland',
    displayName: 'Holland QA',
    displayNames: { zh: '荷兰（QA 场景）', en: 'Holland (QA)', ru: 'Холланд (QA)' },
    playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
    friendlyTeam: 1,
    arenaBonusType: 1,
    recorderAccountId: 1001,
    gridCells: [],
    spawnPoints: [],
    routes,
    playback: { durationSec: DURATION, vehicles, events: [] },
  }
}
</script>

<template>
  <div class="pb-qa-page">
    <h2>{{ t('adminPreview.qaPlaybackTitle') }}</h2>
    <p class="pb-qa-hint">{{ t('adminPreview.qaPlaybackHint') }}</p>
    <BattlePlayback v-if="ready && overview" :overview="overview" :loop="true" />
    <p v-if="authPhase === 'login'" class="pb-qa-note">{{ t('adminPreview.loading') }}</p>
    <p v-if="denied" class="pb-qa-note">{{ t('adminPreview.denied') }}</p>
  </div>
</template>

<style scoped>
.pb-qa-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
.pb-qa-hint {
  color: var(--text-muted, #999);
  font-size: .85rem;
}
.pb-qa-note {
  color: var(--text-muted, #999);
}
</style>
