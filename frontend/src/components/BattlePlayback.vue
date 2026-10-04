<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { useI18n } from 'vue-i18n'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { mapBases } from '../data/mapBases'
import { mapImages } from '../data/mapImages'
import { teamCssVars } from '../data/mapTeamColors'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'
import { createMapView } from '../utils/mapView'
import { activeTerrainRelief, projectTerrainPoint, sampleTerrainAttitude, unprojectTerrainPoint } from '../utils/terrainReliefProjection.js'
import BattleMap from './BattleMap.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import BattlePlaybackHud from './BattlePlaybackHud.vue'
import PlaybackControls from './PlaybackControls.vue'
import { PLAYBACK_SPEEDS, isPlaybackSpeed, usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import { usePointer } from '../composables/useBreakpoint.js'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'
import VehicleDetailsPanel from './VehicleDetailsPanel.vue'
import PlaybackRoster from './PlaybackRoster.vue'
import enemyHull from '../assets/tank-icons/tank-marker-enemy-hull.png'
import enemyTurret from '../assets/tank-icons/tank-marker-enemy-turret.png'
import friendlyHull from '../assets/tank-icons/tank-marker-friendly-hull.png'
import friendlyTurret from '../assets/tank-icons/tank-marker-friendly-turret.png'
import {
  BURST_MS,
  FLOAT_DMG_MS,
  activeFeed,
  FLASH_MS,
  GHOST_MS,
  KILL_FEED_MS,
  clampViewPan,
  eventsCrossed,
  formatClock,
  pushFeed,
  recentPositionTrails,
  teamPointsAt,
  tracerLines,
  transientsActive,
  zoomViewAt
} from '../utils/battlePlayback'
import {
  cumulativeStatsAtV2,
  damageLogAtV2,
  friendlyHealthAt,
  ghostAroundV2,
  healthDisplayAt,
  victimFeedbackAllowedV2,
} from '../utils/battlePlaybackV2'
import { projectVehicleState } from '../utils/playbackVehicleState'
import { createReloadStateResolver, groupByVehicle, resolveMagazineSize } from '../scene/reloadBar.js'
import { assetProvider } from '../scene/assetProvider.js'
import { computeVehicleMarkerSize } from '../utils/vehicleMarkerSizing'
import { advancePlaybackTime, clampPlaybackTime } from '../utils/playbackClock'
import { playbackSafeInsetOwnership } from '../utils/playbackSafeInsets.js'
import { baseView } from '../utils/baseStatus.js'
import {
  MARKER_CORE_PX,
  computeLabelLayout,
  computeTankCollisionLayout,
} from '../utils/labelLayout'
import {
  ANNOT_COLORS,
  ANNOT_FONT_SIZE,
  ANNOT_WIDTH_DEFAULT,
  ANNOT_WIDTH_MAX,
  ANNOT_WIDTH_MIN,
  applyEraser,
  arrowHeadPoints,
  canRedo,
  canUndo,
  circleFromCorners,
  commit,
  polylinePoints,
  rectFromCorners,
  redo,
  screenToSemantic,
  svgToScreen,
  undo
} from '../utils/annotation'

/**
 * 战局回放（Battle Playback）：地图鸟瞰中的主播放视图。
 * 复用 mapImages 素材、coordinateBounds 坐标映射、自适应色板与响应式布局；
 * RAF 只推进 battle-relative 时间，坐标查询遵循 canonical positionSegments。
 */
const mapSemantics = Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', {
  eager: true, import: 'default',
}))

const props = defineProps({
  /**
   * MapOverview（heatmap/secondary 鸟瞰）overlay 数据。仅提供可选 overlay 事实
   * （gridCells/spawnPoints/routes/playableBounds）；必选战局回放元数据以 {@code playbackV2} 为权威。
   * 可空：Battle Playback PRIMARY 以 V2 dataset 为核心输入，不再被 map-overview artifact 锁死。
   */
  overview: { type: Object, default: null },
  seekTo: { type: Number, default: null },
  /** QA 场景循环播放（PR4 §49：时间线到末尾自动回到 0 继续） */
  loop: { type: Boolean, default: false },
  /** V2 canonical battle-playback-dataset；未加载时为空。 */
  playbackV2: { type: Object, default: null },
  /** Raw Playback reload evidence stays outside the generic canonical/HTTP dataset. */
  reloadTelemetry: { type: Object, default: null },
  /**
   * 是否为当前可见的模式（审计 PB-05）。false 时暂停播放、不响应快捷键——
   * 工作台用 v-show 保留实例，隐藏的回放不能再抢空格 / 方向键。
   */
  active: { type: Boolean, default: true },
})

const { t } = useI18n()

/**
 * 呈现元数据（Battle Playback PRIMARY 核心输入）：V2 canonical dataset 为权威源
 * （mapCode / friendlyTeam / recorderAccountId / arenaBonusType），MapOverview 仅提供可选 overlay
 * 事实（gridCells / spawnPoints / routes / playableBounds）。V2 metadata 缺失保持 null；不从 overview 推导。
 * 副要求：Battle Playback 不依赖 MapOverview artifact 存在才能渲染。
 */
const pbOverview = computed(() => {
  const v2 = props.playbackV2
  const ov = props.overview || {}
  if (!v2) return ov
  return {
    ...ov,
    mapCode: v2.mapCode ?? null,
    friendlyTeam: v2.friendlyTeam ?? null,
    recorderAccountId: v2.recorderAccountId ?? null,
    arenaBonusType: v2.arenaBonusType ?? null,
  }
})

const image = computed(() => mapImages[pbOverview.value.mapCode] || null)
const mapView = computed(() => createMapView(image.value, pbOverview.value))

// 自适应配色（与热力覆盖层使用同一色板）
const palette = ref(darkMapPalette)
let paletteRequestToken = 0
watch(image, async (img) => {
  const token = ++paletteRequestToken
  if (!img) {
    palette.value = darkMapPalette
    return
  }
  try {
    const luminance = await luminanceOfImage(img)
    if (token === paletteRequestToken) palette.value = paletteForLuminance(luminance)
  } catch {
    if (token === paletteRequestToken) palette.value = darkMapPalette
  }
}, { immediate: true })

// V2 canonical dataset 是唯一 playback 事实源（cleanup：移除 legacy overview.playback）。
const playback = computed(() => props.playbackV2 || null)
const reloadStateAt = computed(() => createReloadStateResolver(props.reloadTelemetry))
const reloadVehiclesByAccount = computed(() => {
  const byAccount = new Map()
  for (const vehicle of props.reloadTelemetry?.vehicles || []) {
    // Ambiguous entity identity is unknown; do not combine two independent gun timelines.
    if (byAccount.has(vehicle.account_id)) byAccount.set(vehicle.account_id, null)
    else byAccount.set(vehicle.account_id, vehicle)
  }
  return byAccount
})
const reloadMagazineSizes = ref(new Map())
let reloadAssetToken = 0
watch(() => props.reloadTelemetry, async (telemetry) => {
  const token = ++reloadAssetToken
  reloadMagazineSizes.value = new Map()
  if (!telemetry || !assetProvider.configured()) return
  const events = groupByVehicle(telemetry.reloads)
  const tankIds = new Set(telemetry.vehicles.filter((v) => v.team === telemetry.friendlyTeam && v.tank_id > 0).map((v) => v.tank_id))
  const configs = new Map(await Promise.all([...tankIds].map(async (tankId) => {
    try { return [tankId, await assetProvider.json(`/tank/${tankId}.json`)] }
    catch { return [tankId, null] }
  })))
  if (token !== reloadAssetToken) return
  reloadMagazineSizes.value = new Map(telemetry.vehicles.map((v) => [v.eid,
    resolveMagazineSize(configs.get(v.tank_id), events.get(v.eid) || []),
  ]))
}, { immediate: true })

function vehicleReloadAt(accountId, time) {
  const telemetry = props.reloadTelemetry
  const vehicle = reloadVehiclesByAccount.value.get(accountId)
  if (!telemetry || !vehicle) return null
  return reloadStateAt.value(vehicle.eid, time + telemetry.timeOrigin, reloadMagazineSizes.value.get(vehicle.eid))
}
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => pbOverview.value.friendlyTeam)

// ---- PR2：Tier X dedicated model preload----
// runtime.js 含全部车型资产引用（import.meta.glob），必须动态 import 保持主 bundle 分离
// （scripts/check-bundle-separation.mjs 门禁：主入口不得含 'vehicle-models/assets'）。
// preload 完成前不渲染车辆（asset decision 先于渲染，禁止 generic 闪现后替换）。
const preload = ref({ phase: 'idle', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() })
// 竞态令牌：快速切换战局时，过期 preload 完成不得覆盖新战局结果
let preloadToken = 0
watch(
  () => [props.overview, props.playbackV2],
  async () => {
    const token = ++preloadToken
    preload.value = { phase: 'loading', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() }
    const vehicles = props.playbackV2?.vehicles || []
    if (vehicles.length === 0) {
      preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), failureReasons: new Map(), byTank: new Map() }
      return
    }
    try {
      const { preloadBattleModels } = await import('../vehicle-models/runtime.js')
      const result = await preloadBattleModels(vehicles.map((v) => v.tankId))
      if (token !== preloadToken) return // 过期结果丢弃
      preload.value = { phase: 'ready', ...result }
    } catch {
      // 模块加载异常 → 保持单场 generic fallback，但保留稳定诊断原因。
      console.error('[vehicle-models] fallback reason=MODULE_IMPORT_FAILURE')
      if (token !== preloadToken) return
      const failureReasons = new Map((vehicles || []).map((v) => [String(v.tankId), 'MODULE_IMPORT_FAILURE']))
      preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), failureReasons, byTank: new Map() }
    }
  },
  { immediate: true },
)

// 双方总血量（实时剩余，随播放时间/进度条变化；争霸赛附终局点数）。
// relativeFull 是后端投影的 presentation-safe fact；前端只按 t 查询 transition、做聚合与绘制，
// 不扫描 HP/life history 重新判断开局状态，也不把 tankopedia base 当已知血量。
const hpVehicles = computed(() => playback.value?.vehicles || [])
const friendlyHp = computed(() => friendlyHealthAt(hpVehicles.value, true, currentTime.value))
const enemyHp = computed(() => friendlyHealthAt(hpVehicles.value, false, currentTime.value))
// 争霸赛实时点数：来自回放广播 pointsSamples（随 currentTime 变化）；非争霸赛/无广播 → null 不显示
const friendlyPoints = computed(() =>
  teamPointsAt(playback.value?.pointsSamples, friendlyTeam.value, currentTime.value))
const enemyTeam = computed(() => {
  const teams = [...new Set(hpVehicles.value
    .filter(vehicle => vehicle.friendly === false && Number.isFinite(vehicle.team))
    .map(vehicle => vehicle.team))]
  return teams.length === 1 ? teams[0] : null
})
const enemyPoints = computed(() =>
  enemyTeam.value == null
    ? null
    : teamPointsAt(playback.value?.pointsSamples, enemyTeam.value, currentTime.value))
const baseStatesAt = computed(() => {
  const latest = new Map()
  for (const state of playback.value?.baseStates || []) {
    if (!state || !Number.isFinite(state.timeSec) || state.timeSec > currentTime.value + 1e-6) continue
    if (!['A', 'B', 'C', 'D', 'BASE'].includes(state.baseId)) continue
    // 取时间上最新的一条，而不是数组里最后出现的一条：wire 契约没有保证 baseStates
    // 按 timeSec 排序，靠数组顺序会显示已经过期的状态（例如车早已离开、占领已清空，
    // 却仍然画着占领进度）。
    const kept = latest.get(state.baseId)
    if (!kept || state.timeSec >= kept.timeSec) latest.set(state.baseId, state)
  }
  return [...latest.values()].sort((a, b) => a.baseId.localeCompare(b.baseId))
})

// ---- 播放状态 ----
const currentTime = ref(0)
const playing = ref(false)
const speed = ref(1)
// transient/animation 时间基准 = UI wall clock（performance.now）。
// 播放时由 frame() 每帧刷新；暂停时由 ensurePauseClock 的轻量 RAF 继续推进
//（仅当存在未决 transient），不依赖 replay 播放状态。
const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)

// Playback presentation preferences have one persistence owner. BattlePlayback only consumes refs.
const { labelPrefs, hpPrefs, trailPrefs, uiPrefs, paneWidths, railCollapsed } = usePlaybackPreferences()

// 左右两栏宽度可拖拽调整；持久化由 usePlaybackPreferences 负责。
const RAIL_W_RANGE = { min: 160, max: 420 }
/**
 * 触屏时 rail 的宽度下限：速度档位一行排开、每个都满足 44px 点击区域（--hit-min）。
 * = 档位数 × 44 + (档位数 − 1) × 3px 间距 + rail 左右 padding 8px × 2；5 档时为 248px。
 * 只在「播放控件真的在 rail 里」时生效（controlsInRail：非 mobile 形态的 fullscreen/宽屏，即视口 >1200 的
 * 触屏大平板）。mobile fullscreen 也有一条 navigation rail，但控件不在里面，宽度继续交给 CSS（148px）。
 */
const TOUCH_HIT_MIN_PX = 44
const COARSE_RAIL_MIN_W = PLAYBACK_SPEEDS.length * TOUCH_HIT_MIN_PX + (PLAYBACK_SPEEDS.length - 1) * 3 + 16
const DEFAULT_RAIL_W = 220 // 与 playback-shared.css 的 --pb-rail-w 默认值一致
const { coarse: coarsePointer } = usePointer()
// controlsInRail 定义在下方；computed 惰性求值，setup 结束后才读取
const coarseControlsRail = computed(() => coarsePointer.value && controlsInRail.value)
const railWidthRange = computed(() => ({
  min: coarseControlsRail.value ? Math.max(RAIL_W_RANGE.min, COARSE_RAIL_MIN_W) : RAIL_W_RANGE.min,
  max: RAIL_W_RANGE.max,
}))
/**
 * 实际 rail 宽度：只有可调的控件 rail 才写 inline --pb-rail-w。mobile fullscreen 的 navigation rail
 * 不可拖、宽度由 CSS 决定（148px），持久化的拖拽宽度（可能来自桌面）不得盖掉它。
 * 用户拖过就用拖的值（不低于下限）；没拖过时仅触屏控件 rail 抬到下限，否则交给 CSS。
 */
const railWidthPx = computed(() => {
  if (!controlsInRail.value) return null
  if (paneWidths.rail != null) return Math.max(paneWidths.rail, railWidthRange.value.min)
  return coarseControlsRail.value ? Math.max(DEFAULT_RAIL_W, railWidthRange.value.min) : null
})
const DETAILS_W_RANGE = { min: 240, max: 560 }
const clampWidth = (value, range) => Math.min(range.max, Math.max(range.min, value))

/** 拖拽改宽：edge 决定按指针换算成哪一侧的宽度。 */
function startPaneResize(event, pane) {
  if (event.button != null && event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const target = event.currentTarget
  if (target && typeof target.setPointerCapture === 'function') {
    target.setPointerCapture(event.pointerId)
  }
  const rootRect = pbRoot.value ? pbRoot.value.getBoundingClientRect() : null
  if (!rootRect) return
  const move = (moveEvent) => {
    const next = pane === 'rail'
      ? moveEvent.clientX - rootRect.left
      : rootRect.right - moveEvent.clientX
    paneWidths[pane] = clampWidth(Math.round(next),
      pane === 'rail' ? railWidthRange.value : DETAILS_W_RANGE)
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}


// 最近 2 秒位置轨迹只消费 canonical observed positionSegments；显示偏好由 usePlaybackPreferences 持久化。
const visibleTrails = computed(() => trailPrefs.showTrail
  ? recentPositionTrails(hpVehicles.value, currentTime.value, 2)
  : [])

// ---- PR5（§1.3/§10/§16/§20）：deterministic state 与 transient feedback 分层。
// transient 全部 wall-clock（performance.now）驱动，播放帧推进时消费新跨过的事件，
// seek 清空（§20.1 不补播）、pause 自然完成（§20.2）、resume 不重复已消费事件（§20.3，
// eventCursor 严格左开：恰在 cursor 上的事件不重复触发）。
// Blocker 1：consumption 源 = authoritativeEvents（原始 playback events），
// 不受 Event Panel 折叠状态影响。
let transientSeq = 0
const eventCursor = ref(0)
const floatItems = ref([]) // [{ id, victimAccountId, damage, bornRealMs, durationMs }]
const burstItems = ref([]) // [{ id, victimAccountId, bornRealMs, durationMs }]
const feedItems = ref([]) // [{ id, victimAccountId, victimPlayerName, victimName, victimFriendly, durationMs }]
// Event Banner 真实队列：id -> 展示起点 realMs（非响应式，避免 computed 副作用循环）。
const feedShownAt = new Map()
const ghostByAccount = reactive(new Map()) // accountId -> { prevPct, nextPct, untilRealMs }
const flashByAccount = reactive(new Map()) // accountId -> untilRealMs
// seek/状态恢复帧：禁用 HP bar 过渡动画（§20.1 seek 只恢复状态不补动画）
const hpNoTransition = ref(false)

function realNowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/** seek/恢复：清空全部 transient 并重置事件 cursor（§20.1 不补播历史动画）。 */
function resetTransients(sec) {
  eventCursor.value = sec
  floatItems.value = []
  burstItems.value = []
  feedItems.value = []
  feedShownAt.clear()
  ghostByAccount.clear()
  flashByAccount.clear()
}

/** 播放时钟跨过 (fromSec, toSec] 的新事件 → 生成 transient feedback（§10/§12/§16）。 */
function consumeEvents(fromSec, toSec) {
  // Blocker 1：combat feedback 消费 authoritative playback events（不依赖事件列表 UI 过滤——
  // 「战斗事实有没有发生」不取决于 DAMAGE/KILL checkbox 是否显示）。
  // 左界 = max(fromSec, eventCursor)（严格左开 cursor：seek/回绕把 cursor 重置到新时间点后，
  // prev 滞后不会把旧时间点事件重复消费——Blocker 2 loop 下一轮不重复上一轮末尾事件）。
  const damageLeft = Math.max(fromSec, eventCursor.value)
  const crossed = eventsCrossed(authoritativeEvents.value, damageLeft, toSec)
  const damageCrossed = hpVehicles.value.some(track =>
    (track.damageLosses || []).some(loss => loss && loss.toSec > damageLeft + 1e-6 && loss.toSec <= toSec + 1e-6))
  if (crossed.length === 0 && !damageCrossed) {
    eventCursor.value = Math.max(eventCursor.value, toSec)
    return
  }
  const now = realNowMs()
  const states = vehicleStates.value
  const stateByAccount = new Map(states.map(s => [s.vehicle.accountId, s]))
  // DamageLoss is the sole numeric damage authority. Notification events below
  // remain responsible for lifecycle feedback only.
  for (const track of hpVehicles.value) {
    for (const loss of track.damageLosses || []) {
      if (!loss || loss.toSec <= Math.max(fromSec, eventCursor.value) + 1e-6 || loss.toSec > toSec + 1e-6) continue
      const victim = vehiclesByAccount.value.get(track.accountId)
      if (!victim || loss.transientAllowed !== true) continue
      if (!stateByAccount.has(track.accountId)) continue
      floatItems.value = [...floatItems.value, {
        id: ++transientSeq,
        victimAccountId: track.accountId,
        hpLoss: loss.hpLoss,
        bornRealMs: now,
        durationMs: FLOAT_DMG_MS,
      }]
      const g = ghostAroundV2(loss)
      if (g) ghostByAccount.set(track.accountId, { prevPct: g.prevPct, nextPct: g.nextPct, untilRealMs: now + GHOST_MS })
      flashByAccount.set(track.accountId, now + FLASH_MS)
    }
  }
  for (const ev of crossed) {
    if (ev.type === 'DAMAGE') {
      continue
    } else if (ev.type === 'DESTROYED') {
      // §12：击毁 burst（轻量 2D，克制；仅受击方位置流覆盖时锚定）
      const victim = vehiclesByAccount.value.get(ev.accountId)
      if (!victim || !victimFeedbackAllowedV2(victim, ev.timeSec)) continue
      if (!stateByAccount.has(ev.accountId)) continue
      burstItems.value = [...burstItems.value, {
        id: ++transientSeq,
        victimAccountId: ev.accountId,
        bornRealMs: now,
        durationMs: BURST_MS,
      }]
    } else if (ev.type === 'KILL') {
      // §16 kill feed：只显示受害者被击毁（§15.2——回放只能证明后端事后解析
      // attackerAccountId，无法证明客户端当时可见击杀者身份，禁止伪造 "未知 ☠ IS-7"）。
      const victim = vehiclesByAccount.value.get(ev.targetAccountId)
      if (!victim) continue
      feedItems.value = pushFeed(feedItems.value, {
        id: ++transientSeq,
        victimAccountId: ev.targetAccountId,
        // §15：banner 使用 canonical vehicle identity（playerName + tankName），
        // 显示「玩家名（车辆名）被击毁」；不猜车型、不解析 label 字符串。
        victimPlayerName: victim.playerName || '',
        victimName: victim.tankName || String(victim.tankId),
        victimFriendly: victim.friendly,
        bornRealMs: now,
        durationMs: KILL_FEED_MS,
      })
    }
  }
  eventCursor.value = Math.max(eventCursor.value, toSec)
}

/** 暂停时 transient 是否仍有未决（驱动轻量时钟自然完成，§20.2）。 */
function hasPendingTransients(now) {
  if (transientsActive(floatItems.value, now).length) return true
  if (transientsActive(burstItems.value, now).length) return true
  // Event Banner queue：以 shownAt 计时（activeFeed）。存在「排队等待」或「正在展示且未过期」的
  // 条目都算 pending —— pause 下也要完整展示 4s 并自然消失（不能按 bornRealMs 判断 feed）。
  if (feedItems.value.some(it => {
    const s = feedShownAt.get(it.id)
    return s == null || !Number.isFinite(it.durationMs) || now - s < it.durationMs
  })) return true
  for (const g of ghostByAccount.values()) if (g.untilRealMs > now) return true
  for (const u of flashByAccount.values()) if (u > now) return true
  return false
}

/** 过期 transient 清理（由 nowMs/currentTime 变化驱动，Map 不无限增长）。 */
function pruneTransients(now) {
  for (const [id, g] of ghostByAccount) if (g.untilRealMs <= now) ghostByAccount.delete(id)
  for (const [id, u] of flashByAccount) if (u <= now) flashByAccount.delete(id)
  // Event Banner 队列：移除已完整展示并过期的条目及其 shownAt 记录；
  // 排队中（shownAt 空）的条目保留（待空位展示，不直接挤出）。
  feedItems.value = feedItems.value.filter(it => {
    const s = feedShownAt.get(it.id)
    return s == null || !Number.isFinite(it.durationMs) || now - s < it.durationMs
  })
  for (const id of [...feedShownAt.keys()]) {
    if (!feedItems.value.some(it => it.id === id)) feedShownAt.delete(id)
  }
}

// ---- 单车 HP HUD 数据（§4/§5/§6/§7）----
function hpFor(vehicle) {
  const display = healthDisplayAt(vehicle, currentTime.value)
  if (!display) return null
  return {
    current: display.currentHp,
    maxHp: display.displayCapacityHp,
    pct: display.pct,
    knowledge: display.knowledge,
    destroyed: display.destroyed,
    state: display.state,
  }
}
/** marker HP HUD 数字区实际渲染文本（VehicleMarker .pb-hp-num 同款：current 有值→数字，否则 —）。
 *  labelLayout 碰撞用：数字文本可能影响 HUD 盒宽（不同状态不同文本），必须按实际文本估算。 */
function hpDisplayNumText(hp) {
  return hp.current != null ? String(hp.current) : '—'
}
function ghostFor(accountId) {
  const g = ghostByAccount.get(accountId)
  if (!g || g.untilRealMs <= nowMs.value) return null
  return { prevPct: g.prevPct, nextPct: g.nextPct }
}
function flashFor(accountId) {
  return (flashByAccount.get(accountId) || 0) > nowMs.value
}

// ---- transient 渲染视图（wall-clock 过滤 + 屏幕定位）----
const visibleFloats = computed(() => {
  const now = nowMs.value
  const active = transientsActive(floatItems.value, now)
  if (active.length === 0) return []
  const byVictim = new Map()
  for (const item of active) {
    const list = byVictim.get(item.victimAccountId) || []
    list.push(item)
    byVictim.set(item.victimAccountId, list)
  }
  const out = []
  for (const [victimId, list] of byVictim) {
    const st = vehicleStates.value.find(s => s.vehicle.accountId === victimId)
    if (!st) continue
    const p = markerScreen(st)
    if (!p) continue
    // §10.1：连续快速受击纵向 stack/stagger，每条独立生命周期
    list.forEach((item, idx) => {
      out.push({ ...item, x: p.x, y: p.y - 34 - idx * 16, friendly: st.vehicle.friendly })
    })
  }
  return out
})
const visibleBursts = computed(() => {
  const now = nowMs.value
  const active = transientsActive(burstItems.value, now)
  if (active.length === 0) return []
  return active.map(item => {
    const st = vehicleStates.value.find(s => s.vehicle.accountId === item.victimAccountId)
    if (!st) return null
    const p = markerScreen(st)
    if (!p) return null
    return { ...item, x: p.x, y: p.y, friendly: st.vehicle.friendly }
  }).filter(Boolean)
})
const visibleFeed = computed(() => activeFeed(feedItems.value, nowMs.value, feedShownAt))
const selectedAccountId = ref(null)
const activePanel = ref(null)
// §mobile-panels：移动端/中型宽度没有永久 Left Rail，用 ☰ 打开一个 drawer/sheet 以进入
// Team / Display / Events / Annotation（避免 dead action）。
/**
 * 名册呈现开关：**唯一 owner** 是共享呈现偏好 `uiPrefs.showRoster`（与 3D 同一个 key）。
 * 所有 2D 名册呈现——宽档常驻名册、Team 导航项、抽屉里的 Team/阵容分页——都必须读它，
 * 不允许出现「常驻名册关了但 Team 分页还列着全部玩家」这种割裂语义。
 * 关掉**只关呈现**：名册数据（teamVehicles）、选中车辆、详情、时间轴、地图视图与相机
 * 全部保留；恢复后立刻可用，不重建播放、不重解析。
 */
const showRosterPresentation = computed(() => uiPrefs.showRoster !== false)
/**
 * 名册被隐藏时清理指向不可见内容的**导航状态**（不留空的/不可用的 Team 分页）。
 * 只动 `activePanel`，不碰选中车辆（那是播放状态，与呈现偏好无关）。
 */
watch(showRosterPresentation, (visible) => {
  if (!visible && activePanel.value === 'team') activePanel.value = null
})
const mobileDrawerOpen = ref(false)
const railDrawerOpen = computed(() => mobileDrawerOpen.value
  && (isMobileDevice.value || !(isFullscreen.value || wideLayout.value)))
const annotationOpen = ref(false)
const mobileOverlay = ref(null)
/** §details-float：详情浮窗的受保护下界——传输控件。它在不同形态下分别住在左栏或
    地图下方的 overlay 里，这里始终指向「当前真正在渲染的那一处」，避免浮窗盖住拇指操作区。 */
const transportEl = ref(null)
/** 整个战场 workspace（`.pb-main`：Team 1 | Stage | Team 2 + 浮窗）——详情浮窗的定位祖先与
    拖动宿主。浮窗是它的直接子元素，`left/top`、夹紧与拖动在同一个坐标系里算；
    它不是 `.pb-map-stage`（那只是中间一栏，按它算会把浮窗关在 Stage 里）。 */
const battlefieldWorkspaceEl = ref(null)
const panelGroups = computed(() => [
  { name: 'battle', label: t('recon.map.playback.panel_battle') },
  { name: 'vehicle', label: t('recon.map.playback.panel_vehicle') },
  { name: 'display', label: t('recon.map.playback.panel_display') },
  { name: 'events', label: t('recon.map.playback.panel_events') },
])
let rafId = null
let lastFrameTs = null

// 暂停期 transient 时钟的 RAF id（仅当存在未决 transient 时运行，不永久轮询）。
let pauseRafId = null

// ---- 地图视图缩放/平移：单一 camera layer 保证地图/网格/炮线/标记严格对齐 ----
const mapComponent = ref(null)
const mapEl = computed(() => mapComponent.value?.mapEl || null)
const mapStageEl = ref(null)
// ---- 地图容器真实渲染尺寸（reactive）：fullscreen enter/exit / 窗口缩放等任何尺寸变化
// 由 ResizeObserver 更新 → 依赖容器尺寸的 screen-space 布局（markerScreen/labelLayout/
// hitbox/textInput）在新尺寸下重新计算；无 RO 环境（测试/旧浏览器）回退 clientWidth 读取。
const mapSize = ref({ w: 0, h: 0 })
// §side-slots：Map Workspace（stage）的真实尺寸。地图是方的，横屏全屏下它受高度限制，
// 于是两侧必然各留 (stageW - stageH) / 2 的黑边。够宽时 HUD 与 controls 就搬进这两条
// 黑边，地图吃满高度；不够宽（含竖屏）则保持上下形态。
const stageSize = ref({ w: 0, h: 0 })
let mapResizeObserver = null
function mapWidth() {
  return mapSize.value.w || (mapEl.value ? mapEl.value.clientWidth : 0)
}
function mapHeight() {
  return mapSize.value.h || (mapEl.value ? mapEl.value.clientHeight : 0)
}

// §1：MapRenderRect SSoT —— 当前地图实际绘制的矩形（相对 .pb-map origin）。
// 所有 presentation geometry（marker/碰撞/hitbox/label/float/screenToSemantic）都经由它换算，
// 保证 SVG map 与 HTML overlay 共享同一坐标系（fullscreen/contain 下 marker 不再跑进 gutter）。
// 用读取即时值而非缓存 computed：依赖（mapSize/mapView）由调用方 computed/watch 追踪，实时重算。
function mapRenderRect() {
  const width = mapWidth()
  const ratio = mapView.value.H / mapView.value.W
  return { left: 0, top: 0, width, height: width * ratio }
}

// ---- Fullscreen：原生 Fullscreen API；document.fullscreenElement + fullscreenchange 为事实源
//（不维护手工 isFullscreen = !isFullscreen，ESC/浏览器 UI 退出后状态自动同步）。
// 生命周期与方向锁已抽到 composables/usePlaybackFullscreen.js（与 3D 共用同一套产品语义：
// 手机形态才锁横屏、锁在全屏成功之后、退出/卸载解锁、平板与桌面绝不请求方向锁）。----
const pbRoot = ref(null)
// §3：大桌面（>=1200px）即使不进入 fullscreen，也用持久 rail|map|details 三列布局。
const wideLayout = ref(false)
// rail 在 >=1200px 或 fullscreen（且非移动端）出现；控制条跟着 rail 走，否则回落到地图下方。
// 收起左栏时控件必须搬出去：非触屏设备的 controls 本来渲染在 rail 内，rail 一收起
// 正文整块 display:none，播放/进度条会跟着消失，只剩一个展开箭头。
/* §three-forms：PC / tablet / mobile 三套互斥的布局形态，由 JS 判定后写成根类。
   互斥性由「只挂一个类」保证，而不是靠媒体查询之间的算术——旧写法里
   .pb-device-mobile(0,4,0) 会压掉宽度键控的规则(0,3,0)，一档的改动因此
   反复打穿另一档。三档与旧行为逐条等价：
     mobile = isMobileDevice（宽 <768，或触屏且高 <=500；见 shared/breakpoints PLAYBACK_MOBILE_QUERY）
     pc     = 非 mobile 且 >=1200
     tablet = 非 mobile 且 <1200（含 iPad / Android 平板；触屏只放大点击区域，不改形态） */
const formFactor = computed(() => {
  if (isMobileDevice.value) return 'mobile'
  return wideLayout.value ? 'pc' : 'tablet'
})

const controlsInRail = computed(() => (isFullscreen.value || wideLayout.value)
  && !isMobileDevice.value
  && !railCollapsed.value)
// §mobile-contract：设备是否为「移动端」（primary pointer=coarse 且视口 <=1200px）。手机在
// fullscreen + landscape 时内宽可 >768，因此移动端判定不得只依赖 innerWidth<768；一旦判定为
// 移动端，无论全屏/横竖屏都保持 mobile playback mode（HUD+Map 为主、bottom overlay controls、
// details sheet、无永久 Left Rail / Right Details）。
// §three-forms：与 wideLayoutQuery('(min-width: 1200px)') 必须严格互补。
// 手机形态由共享 contract 判定，横屏/全屏后与 3D 保持同一紧凑呈现。
const { isPhone: isMobileDevice } = usePlaybackPhoneForm()
/* §square-stage：正方形 Stage 的两种呈现由**视口朝向**决定，不由宽度决定（见
   composables/usePlaybackPortraitViewport.js）。竖屏是纵向流，横屏与宽档才是三段式。 */
const { isPortrait: isPhonePortrait } = usePlaybackPortraitViewport()
let playbackLifecycleActive = true
let wideLayoutQuery = null
function onWideLayoutChange(event) {
  wideLayout.value = !!(event && event.matches)
}
/**
 * 全屏 / 方向锁生命周期与 3D 共用同一实现（composables/usePlaybackFullscreen）：
 * 事实源 `document.fullscreenElement`、手机形态才锁横屏、锁在全屏成功之后、退出与卸载解锁。
 * 这里只保留 2D 自己的**布局**反应：全屏进出后等 Vue 搬完 controls（Bottom Overlay ↔ Left Rail），
 * 用新 mode 的真实几何 force 一次 authoritative fit（geometry-signature 也会捕获 bottom inset 变化）。
 * 不用 setTimeout magic delay。
 */
const { isFullscreen, fullscreenSupported, toggleFullscreen } = usePlaybackFullscreen({
  target: () => pbRoot.value,
  isPhone: isMobileDevice,
  isActive: () => playbackLifecycleActive,
  // fullscreenchange 只由 composable 监听；这里注入 2D 的布局反应（等 Vue 搬完 controls 再 force fit）
  onChange: () => nextTick(() => fitViewIfReady(true)),
})

// 地图容器尺寸观察：fullscreen enter/exit / 窗口缩放 → ResizeObserver 更新 mapSize
//（reactive）→ markerScreen/labelLayout/selectAt/textInput 以新尺寸重算；不依赖 magic delay。
watch(() => mapEl.value, (el, prev) => {
  if (prev) prev.removeEventListener('pointerleave', onMapPointerLeave)
  if (el) el.addEventListener('pointerleave', onMapPointerLeave)
  if (!el || mapResizeObserver) return
  if (typeof ResizeObserver === 'function') {
    mapResizeObserver = new ResizeObserver((entries) => {
      for (const e of entries || []) {
        if (e && e.target === el) {
          mapSize.value = { w: e.contentRect.width, h: e.contentRect.height }
        }
      }
      // §fullscreen-exit：地图或 stage 尺寸就绪（布局稳定）后，以新 mode 的几何重新应用默认 fit
      //（contain 居中）。mode change 会 re-arm fitInitialized；非 mode 的 resize 保持已生效的 view。
      fitViewIfReady()
    })
    mapResizeObserver.observe(el)
    if (mapStageEl.value) mapResizeObserver.observe(mapStageEl.value)
    // §safe-viewport：观察影响 camera safe area 的真实元素 —— HUD（top inset）与 bottom overlay
    // controls（bottom inset）。controls 从 Bottom Overlay 搬到 Left Rail 后，bottom overlay 高度归零，
    // 这里触发 fitViewIfReady → geometry-signature 变化 → 重新 fit，不再残留旧 bottom inset。
    const hud = pbRoot.value ? pbRoot.value.querySelector('.pb-hud') : null
    if (hud && hud !== el) mapResizeObserver.observe(hud)
    // §safeInsets-DOM：观察真实 .pb-mobile-overlay-content（controls 实际高度），而非 inset:0 wrapper；
    // controls content reflow → RO 触发 fitViewIfReady → safe 几何更新。
    const overlayContent = mobileOverlay.value?.$el?.querySelector('.pb-mobile-overlay-content')
    if (overlayContent && overlayContent !== el) mapResizeObserver.observe(overlayContent)
  }
})

const view = reactive({ scale: 1, tx: 0, ty: 0 })
// Actual rendered SVG frame in the shared camera layer. mapSize is updated by
// the existing ResizeObserver; multiplying both axes by the camera width scale
// keeps leader-line conversion reactive across resize/fullscreen/zoom changes.
const renderedMapFrame = computed(() => {
  const scale = Number.isFinite(view.scale) && view.scale > 0 ? view.scale : 1
  return { width: mapWidth() * scale, height: mapHeight() * scale }
})
const PAN_THRESHOLD_PX = 5
const PINCH_THRESHOLD_PX = 5
const ZOOM_STEP = 1.2
const pointers = new Map()
let panStart = null
let pinchStart = null
let suppressClick = false
// 当前交互是否为真实手势（单指拖动超阈值 / 双指捏合距离或中点移动超阈值）：
// 手势结束后的首个 click 必须被吞掉，纯点击车辆仍正常选中
let gestureMoved = false

/* §side-slots：仅非 mobile 的横屏 fullscreen 才尝试把「不在 rail 内」的 controls 放进
   地图列左右黑边。Battle HUD 已永久归属顶部，不再参与 side-slot relocation；mobile
   fullscreen 由 PR #245 的 transient bottom controller 独占，不进入本优化。
   黑边按实际 map workspace 宽度而不是整个 stage 宽度计算，避免把 tablet Details 列
   错算成地图 gutter。168px 是竖排 controls 的可用下限。 */
const SIDE_SLOT_MIN_PX = 168
const sideSlotWidth = computed(() => {
  if (!isFullscreen.value || formFactor.value === 'mobile') return 0
  const mapW = mapSize.value.w || mapWidth()
  const stageH = stageSize.value.h
  if (!mapW || !stageH) return 0
  const gutter = Math.floor((mapW - stageH) / 2)
  return gutter >= SIDE_SLOT_MIN_PX ? gutter : 0
})
const sideSlots = computed(() => sideSlotWidth.value > 0)
// Map Workspace（stage）尺寸单独观察：sideSlotWidth 依赖它，不能搭在 mapEl 的
// observer 上——那条挂载要求 mapEl 就绪时 mapStageEl 也已就绪，不成立时 stageSize
// 会一直停在 0，侧栏形态永远不触发。
let stageResizeObserver = null
/**
 * §square-stage：正方形 Stage 的**纵向可用高度**实测值。
 *
 * 为什么必须实测：页面 chrome（顶栏 / 底部 Tab 栏 / 安全区 / HUD / 传输控件）随形态、
 * 全屏与机型变化，用固定常量扣减会算出比实际可用空间更高的正方形（实测 pc 桌面下
 * 常量算出 622px，而真实可用高度只有 578px），正方形于是压在传输控件上。
 *
 * 为什么不会形成循环依赖：量的是 `pbRoot` 的高度减去 HUD 与传输控件——这三者都由外层
 * 布局决定，与「由正方形宽度决定的 Stage 高度」无关。写回 `--pb-square-avail-h` 后
 * ResizeObserver 会再触发一次，但那时预算值已经稳定，不会来回震荡。
 */
function writeSquareAvailHeight() {
  const root = pbRoot.value
  if (!root) return
  const hud = root.querySelector('.pb-hud')
  const transport = transportEl.value
  // 根高度在纵向流里本身就由正方形撑开（自指），所以再用视口高度封顶：
  // 横屏手机 / 全屏下正方形 + HUD + 传输控件必须一屏放下，传输控件不被顶出首屏。
  const viewportH = Number(window.innerHeight) || Infinity
  // 正方形之上占用的高度：workspace（.pb-main）相对根的上缘偏移 + 它的上内边距
  // （非全屏时 HUD 在流里、偏移已含 HUD；手机全屏时 HUD 是浮层、由上内边距让位）。
  const main = battlefieldWorkspaceEl.value
  const above = main
    ? Math.max(0, main.getBoundingClientRect().top - root.getBoundingClientRect().top)
      + (parseFloat(getComputedStyle(main).paddingTop) || 0)
    : (hud ? hud.getBoundingClientRect().height : 0)
  // 传输控件按整块 overlay 计（含卡片内边距与安全区），与下面写入的 --pb-controls-h 同源。
  const overlay = transport?.closest?.('.pb-mobile-overlay')
  const controlsH = overlay ? overlay.getBoundingClientRect().height
    : (transport ? transport.getBoundingClientRect().height : 0)
  const budget = Math.min(root.getBoundingClientRect().height, viewportH)
    - above
    - controlsH
  if (budget > 0) root.style.setProperty('--pb-square-avail-h', `${Math.round(budget)}px`)
  // 传输控件整块（含 overlay 卡片的内边距）的实测高度：横屏手机里中心列在 Stage 下方为它让位。
  if (controlsH > 0) root.style.setProperty('--pb-controls-h', `${Math.ceil(controlsH)}px`)
  // 手机全屏：HUD 是顶部浮层，三段式 workspace 从它下缘开始。
  if (hud) root.style.setProperty('--pb-hud-h', `${Math.ceil(hud.getBoundingClientRect().height)}px`)
}

watch(() => mapStageEl.value, (el) => {
  if (stageResizeObserver) { stageResizeObserver.disconnect(); stageResizeObserver = null }
  if (!el || typeof ResizeObserver !== 'function') return
  stageResizeObserver = new ResizeObserver((entries) => {
    for (const e of entries || []) {
      if (e && e.target === el) stageSize.value = { w: e.contentRect.width, h: e.contentRect.height }
    }
    writeSquareAvailHeight()
  })
  stageResizeObserver.observe(el)
  if (pbRoot.value) stageResizeObserver.observe(pbRoot.value)
  if (transportEl.value) stageResizeObserver.observe(transportEl.value)
  writeSquareAvailHeight()
}, { immediate: true })
watch(transportEl, () => { nextTick(writeSquareAvailHeight) })

// 侧栏形态切换会改变地图可用高度 → 用新几何强制重新 fit。
watch(sideSlots, () => { nextTick(() => fitViewIfReady(true)) })

/** 安全区：fullscreen battle HUD 永远位于顶部，因此始终按真实 HUD 高度保留 top inset。
 * controls 的 bottom inset 按形态决定：mobile fullscreen 属于 PR #245 的底部 transient
 * controller（显示时按真实 content 高度避让）；PC/tablet 只有 controls 真正在 bottom overlay
 * 时才保留，rail/side-slot 形态不占 bottom。 */
function safeInsets() {
  let top = 0
  let bottom = 0
  const ownership = playbackSafeInsetOwnership({
    isFullscreen: isFullscreen.value,
    formFactor: formFactor.value,
    sideSlots: sideSlots.value,
    controlsInRail: controlsInRail.value,
  })
  if (ownership.reserveTop) {
    const hud = pbRoot.value ? pbRoot.value.querySelector('.pb-hud') : null
    top = hud ? hud.clientHeight : 0
  }
  // §safeInsets-DOM：wrapper 是 inset:0，不能把 wrapper.clientHeight 当 controls 高度。
  // transient controls 显示时按 wrapper bottom → content top 量取完整占用区（含 bottom/safe-area gap）；
  // hidden 时 contentHeight=0。内容重排由 ResizeObserver 触发重新 fit。
  if (ownership.reserveBottom) {
    const wrap = mobileOverlay.value?.$el
    const content = wrap ? wrap.querySelector('.pb-mobile-overlay-content') : null
    if (wrap && content && content.clientHeight > 0) {
      const wrapRect = wrap.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      // Reserve the complete occupied bottom zone, including the controller's
      // bottom offset / safe-area gap, rather than only the card height.
      bottom = Math.max(0, wrapRect.bottom - contentRect.top)
    }
  }
  return { top, bottom }
}

function applyView(next) {
  // stage = 可见 map-stage；map = rendered map rect。pan bounds / reset fit 都以二者为据。
  // 地图只在「下 HUD、上 controls」之间的 safe area 内完整显示/平移，不遮挡进 HUD/controls。
  const stageW = mapWidth()
  const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
  const safe = safeInsets()
  const safeH = Math.max(0, fullH - safe.top - safe.bottom)
  const rect = mapRenderRect()
  // §对称：地图在安全区内垂直居中，顶部/底部黑边完全对称（无向下偏移）。
  const clamped = clampViewPan(next, stageW, safeH, rect.width, rect.height)
  view.scale = clamped.scale
  view.tx = clamped.tx
  view.ty = clamped.ty + safe.top
}

// Raster camera fallback: enlarge the layout box before the browser paints the HD image,
// then translate that box for pan. Keeping view.scale as the SSOT preserves all anchor math
// while avoiding a compositor-only scale of an already-painted raster layer.
const viewportStyle = computed(() => [
  `transform: translate(${view.tx}px, ${view.ty}px)`,
  `width: ${view.scale * 100}%`,
])

// 车辆标记随地图缩放（用户确认「坦克随地图一起放大，相对地图比例不变」）：
// 标记中心锚定在地图坐标（left/top % 经 viewport 变换），本体不再反缩放；
// 坦克名/阵亡 ✕ 等 UI 叠加层单独反缩放（overlayInverseScale）保持屏幕恒定；
// hull/turret 的方向旋转在子元素 img 上，不受缩放影响。
const markerTransform = computed(() => `translate(-50%, -50%)`)
// overlay 反缩放数值（=1/view.scale）：元素尺寸（transform scale）与 layout offset（bottom/top calc）
// 都按它反缩放 → zoom 下 selected/recorder 与车辆的屏幕间距恒定，不随 1×/2×/4× 增长
const overlayInverse = computed(() => 1 / view.scale)
const overlayInverseScale = computed(() => `scale(${overlayInverse.value})`)

/** 指针 client 坐标 → 相对地图容器的**屏幕坐标**（zoomViewAt 契约，不参与任何变换）。 */
function screenPoint(clientX, clientY) {
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  return { x: clientX - rect.left, y: clientY - rect.top }
}

/**
 * 滚轮缩放只在用户明确与地图交互时生效（审计 PB-04，同 Google Maps 的 cooperative gestures）：
 * 全屏、按住 Ctrl / ⌘、或刚在地图上按下过指针（直到指针离开地图）。否则让页面正常滚动，并短暂提示。
 */
const mapEngaged = ref(false)
const wheelHintVisible = ref(false)
let wheelHintTimer = null
function showWheelHint() {
  wheelHintVisible.value = true
  if (wheelHintTimer != null) clearTimeout(wheelHintTimer)
  wheelHintTimer = setTimeout(() => { wheelHintVisible.value = false; wheelHintTimer = null }, 1500)
}
function onMapPointerLeave() { mapEngaged.value = false }

/** 审计 PB-01：地图未放大、非全屏、未在标注时，单指纵向滑动交给页面滚动。 */
const mapTouchPan = computed(() => !isFullscreen.value && !activeTool.value && view.scale <= fitScale() + 1e-3)

function onWheel(e) {
  if (!(isFullscreen.value || e.ctrlKey || e.metaKey || mapEngaged.value)) {
    showWheelHint()
    return
  }
  e.preventDefault()
  wheelHintVisible.value = false
  const p = screenPoint(e.clientX, e.clientY)
  // 缩放下限 = 完整地图 fit scale：放大后再缩小能回到原始完整视图，不会卡在 1x。
  applyView(zoomViewAt(view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, fitScale()))
}

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}

function onPointerDown(e) {
  mapEngaged.value = true
  suppressClick = false
  gestureMoved = false
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  // 指针捕获（受支持时）：指针移出地图仍持续收到 move/up；不支持的环境走 window 级兜底
  try {
    if (typeof e.target.setPointerCapture === 'function') {
      e.target.setPointerCapture(e.pointerId)
    }
  } catch {
    // 某些测试环境不支持指针捕获，忽略
  }
  // 标注绘制：单指 + 激活工具 → 走绘制，不进入平移
  if (activeTool.value && pointers.size === 1) {
    startDrawing(e)
    return
  }
  // 绘制中落下第二根手指：先提交当前笔画，再转入双指捏合
  if (drawingPointerId != null && pointers.size === 2) {
    endDrawing()
    drawingPointerId = null
  }
  if (pointers.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
  } else if (pointers.size === 2) {
    const info = pinchInfo()
    pinchStart = {
      mid: info.mid,
      dist: info.dist,
      // 锚点 = 双指中点相对地图容器的屏幕坐标（zoomViewAt 契约）
      anchorScreen: screenPoint(info.mid.x, info.mid.y),
      scale: view.scale,
      tx: view.tx,
      ty: view.ty,
      moved: false
    }
    panStart = null
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (drawingPointerId === e.pointerId && activeTool.value) {
    moveDrawing(e)
    return
  }
  if (pointers.size === 2 && pinchStart) {
    const { mid, dist } = pinchInfo()
    if (!pinchStart.moved
        && (Math.abs(dist - pinchStart.dist) > PINCH_THRESHOLD_PX
            || Math.hypot(mid.x - pinchStart.mid.x, mid.y - pinchStart.mid.y) > PINCH_THRESHOLD_PX)) {
      pinchStart.moved = true
      gestureMoved = true
    }
    if (pinchStart.dist > 0 && dist > 0) {
      const next = zoomViewAt(
        { scale: pinchStart.scale, tx: pinchStart.tx, ty: pinchStart.ty },
        pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist,
        fitScale()
      )
      // 两指中点整体移动 = 屏幕平移（translate 单位为屏幕像素，直接加 client 位移）
      next.tx += mid.x - pinchStart.mid.x
      next.ty += mid.y - pinchStart.mid.y
      applyView(next)
    }
    return
  }
  if (pointers.size === 1 && panStart) {
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    if (!panStart.moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
    panStart.moved = true
    gestureMoved = true
    applyView({ scale: view.scale, tx: panStart.tx + dx, ty: panStart.ty + dy })
  }
}

function onPointerUp(e) {
  if (!pointers.delete(e.pointerId)) return
  try {
    if (typeof e.target.releasePointerCapture === 'function') {
      e.target.releasePointerCapture(e.pointerId)
    }
  } catch {
    // 忽略（无捕获或已释放）
  }
  if (drawingPointerId === e.pointerId) {
    endDrawing()
    drawingPointerId = null
    if (pointers.size === 0) {
      panStart = null
      pinchStart = null
      gestureMoved = false
      suppressClick = false
    }
    return
  }
  if (gestureMoved) suppressClick = true
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 0) {
    panStart = null
    gestureMoved = false
  } else if (pointers.size === 1 && pinchStart == null && panStart == null) {
    // 捏合结束剩下一根手指：以该手指为新基线继续平移，状态不卡死
    const [p] = [...pointers.values()]
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false }
  }
}

/** 拖动/捏合结束后吞掉随之而来的 click 避免误选车；未拖动的点击正常到达车辆按钮。 */
function onViewportClick(e) {
  if (suppressClick) {
    suppressClick = false
    e.stopPropagation()
    e.preventDefault()
    return
  }
  mobileOverlay.value?.reveal?.()
}

/** 完整地图视图（contain/fit）的 scale：把整张 rendered map 放进安全区的最小缩放。
 *  缩放下限（minScale）应为它——zoomed 后回到的就是它，避免「放大后再缩不回原样」。 */
// fit 后四周留一圈窄黑边：不顶到边缘，同时尽量少浪费宽屏空间。
const FIT_MARGIN = 0.98

function fitScale() {
  const stageW = mapWidth()
  const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
  const safe = safeInsets()
  const safeH = Math.max(0, fullH - safe.top - safe.bottom)
  const rect = mapRenderRect()
  if (stageW > 0 && safeH > 0 && rect.width > 0 && rect.height > 0) {
    return Math.min(stageW / rect.width, safeH / rect.height) * FIT_MARGIN
  }
  return 1
}

function resetView() {
  // Reset View：恢复「完整地图视图」——fit 整张 rendered map 到安全区（下 HUD、上 controls）并居中。
  const stageW = mapWidth()
  const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
  const safe = safeInsets()
  const safeH = Math.max(0, fullH - safe.top - safe.bottom)
  const rect = mapRenderRect()
  if (stageW > 0 && safeH > 0 && rect.width > 0 && rect.height > 0) {
    const scale = fitScale()
    const tx = (stageW - rect.width * scale) / 2
    const ty = (safeH - rect.height * scale) / 2
    applyView({ scale, tx, ty })
    return
  }
  applyView({ scale: 1, tx: 0, ty: 0 })
}

// §3：默认视图 = 完整地图 contain（fit 居中、完整可见，无需手动调整）。
// 地图在「下 HUD、上 controls」安全区内，顶部不伸进血条；四周黑边取决于地图与安全区的比例。
// §geometry-signature：以 mode + stage/map/safe 尺寸为 signature，变化即重新 fit，
// 不靠布尔（fitInitialized）锁死旧几何——mode 或 safe area 改变（如 bottom inset 归零）会重新 fit。
let lastFitSignature = ''
function fitViewIfReady(force = false) {
  if (force) lastFitSignature = ''
  const stageW = mapWidth()
  const fullH = mapStageEl.value ? mapStageEl.value.clientHeight : mapHeight()
  const safe = safeInsets()
  const safeH = Math.max(0, fullH - safe.top - safe.bottom)
  const rect = mapRenderRect()
  if (stageW <= 0 || safeH <= 0 || rect.width <= 0 || rect.height <= 0) return
  const signature = [isFullscreen.value, wideLayout.value, isMobileDevice.value, stageW, safeH, rect.width, rect.height, safe.top, safe.bottom].join('|')
  if (!force && signature === lastFitSignature) return
  lastFitSignature = signature
  resetView()
}

// ---- 地图标注（临时纯前端：切视图/切文件即清空；几何一律存语义坐标） ----
const activeTool = ref(null) // null|pen|eraser|arrow|line|rect|circle|text
const annotColor = ref(ANNOT_COLORS[0])
const annotVisible = ref(true)
const annotWidthSlider = ref(ANNOT_WIDTH_DEFAULT) // 滑块值 = SVG 像素口径（1× 下所见即所得）
// 语义单位/每 SVG 像素（x/y 轴因 preserveAspectRatio:none 比例可能不同；线宽/字号/半径按 x 轴换算）
const semPerSvgX = computed(() => {
  const b = mapView.value.renderBounds
  return b && mapView.value.W > 0 ? (b.xMax - b.xMin) / mapView.value.W : 1
})
const semPerSvgY = computed(() => {
  const b = mapView.value.renderBounds
  return b && mapView.value.H > 0 ? (b.yMax - b.yMin) / mapView.value.H : 1
})
const annotWidth = computed(() => annotWidthSlider.value * semPerSvgX.value)
const history = ref([[]]) // 快照栈（不可变数组），history[0] = 初始空
const historyIndex = ref(0)
const annotations = computed(() => history.value[historyIndex.value] || [])
const draft = ref(null) // 进行中的标注（未提交）
const textSession = ref(null) // reactive({ point, text })，文字输入会话
const textInputRef = computed(() => mapComponent.value?.textInputRef || null)
const ANNOT_THIN_PX = 2 // 笔迹抽稀阈值（屏幕 CSS px，与坐标体系无关）
let drawStart = null // 绘制起点（语义坐标）
let drawPoints = [] // pen/eraser 已采点（语义坐标）
let drawScreen = [] // 与 drawPoints 一一对应的屏幕点（CSS px，用于抽稀）
let drawingPointerId = null

function resetAnnotations() {
  history.value = [[]]
  historyIndex.value = 0
  activeTool.value = null
  draft.value = null
  textSession.value = null
  drawStart = null
  drawPoints = []
  drawScreen = []
  drawingPointerId = null
  suppressClick = false
  gestureMoved = false
  panStart = null
  pinchStart = null
}
// 切换文件（overview 引用变化；MapOverview 未按文件 key 复用）→ 清空标注
watch(() => props.overview, resetAnnotations)

function toggleTool(tool) {
  activeTool.value = activeTool.value === tool ? null : tool
}
// 打开标注即进入可画状态：默认选中画笔。以前打开后 activeTool 仍是 null，
// 用户在地图上划一下什么也不会发生，得先自己再点一次画笔。
function toggleAnnotation() {
  annotationOpen.value = !annotationOpen.value
  activeTool.value = annotationOpen.value ? 'pen' : null
}
function closeAnnotation() {
  annotationOpen.value = false
  activeTool.value = null
}
/* 收起左栏时一并收掉二级面板：否则 .pb-rail-expanded 仍把 --pb-left-col 撑到
   panel 宽，收起就没有效果。收起/展开都改变列宽 → 用新几何强制重新 fit 一次。 */
function toggleRailCollapsed() {
  railCollapsed.value = !railCollapsed.value
  if (railCollapsed.value) {
    activePanel.value = null
    closeAnnotation()
  }
  nextTick(() => fitViewIfReady(true))
}

function undoAnnot() {
  const s = undo(history.value, historyIndex.value)
  history.value = s.history
  historyIndex.value = s.index
}

function redoAnnot() {
  const s = redo(history.value, historyIndex.value)
  history.value = s.history
  historyIndex.value = s.index
}

function clearAll() {
  const s = commit(history.value, historyIndex.value, [])
  history.value = s.history
  historyIndex.value = s.index
}

function commitDraft(ann) {
  const s = commit(history.value, historyIndex.value, [...annotations.value, ann])
  history.value = s.history
  historyIndex.value = s.index
}

function draftFromTool(tool, a, b) {
  switch (tool) {
    case 'arrow':
    case 'line':
      return { type: tool, color: annotColor.value, width: annotWidth.value, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    case 'rect':
      return { type: 'rect', color: annotColor.value, width: annotWidth.value, ...rectFromCorners(a, b) }
    case 'circle':
      return { type: 'circle', color: annotColor.value, width: annotWidth.value, ...circleFromCorners(a, b) }
    default:
      return null
  }
}

/** 指针 client 坐标 → 语义坐标（CSS px → 撤销 viewport 变换 → CSS↔SVG 比例 → fromX/fromY）。 */
function semanticPoint(e) {
  const sp = screenPoint(e.clientX, e.clientY)
  const model = reliefModelForPlayback()
  const rect = mapRenderRect()
  if (model && rect.width > 0 && rect.height > 0 && view.scale > 0) {
    const xNorm = ((sp.x - view.tx) / view.scale) / rect.width
    const yNorm = ((sp.y - view.ty) / view.scale) / rect.height
    const point = unprojectTerrainPoint(model, xNorm, yNorm)
    if (point) return { x: point.x, y: point.y }
  }
  return screenToSemantic(view, mapView.value, sp.x, sp.y, mapWidth(), mapHeight())
}

function startDrawing(e) {
  const p = semanticPoint(e)
  if (!p) return
  drawingPointerId = e.pointerId
  if (activeTool.value === 'text') {
    if (textSession.value) commitSession(textSession.value) // 先提交上一个未完成的文字
    textSession.value = reactive({ point: p, text: '' })
    nextTick(() => textInputRef.value && textInputRef.value.focus())
    return
  }
  if (activeTool.value === 'pen' || activeTool.value === 'eraser') {
    drawPoints = [p]
    drawScreen = [{ x: e.clientX, y: e.clientY }]
    draft.value = { type: activeTool.value, color: annotColor.value, width: annotWidth.value, points: [p] }
  } else {
    drawStart = p
    draft.value = draftFromTool(activeTool.value, p, p)
  }
}

function moveDrawing(e) {
  const p = semanticPoint(e)
  if (!p) return
  const tool = activeTool.value
  if (tool === 'pen' || tool === 'eraser') {
    // 屏幕空间抽稀：相邻采样点 ≥ ANNOT_THIN_PX CSS px（不依赖 scale/渲染比例，避免换算误差累积）
    const last = drawScreen[drawScreen.length - 1]
    if (last == null || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= ANNOT_THIN_PX) {
      drawScreen.push({ x: e.clientX, y: e.clientY })
      drawPoints.push(p)
      draft.value = { ...draft.value, points: [...drawPoints] }
    }
  } else if (drawStart) {
    draft.value = draftFromTool(tool, drawStart, p)
  }
}

function isDegenerate(ann) {
  if (ann.type === 'rect') return ann.w < 1e-9 && ann.h < 1e-9
  if (ann.type === 'circle') return ann.r < 1e-9
  if (ann.type === 'line' || ann.type === 'arrow') {
    return Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 1e-9
  }
  return false
}

function endDrawing() {
  const tool = activeTool.value
  if (!tool) return
  if (tool === 'pen') {
    if (drawPoints.length >= 2) {
      commitDraft({ type: 'pen', color: annotColor.value, width: annotWidth.value, points: drawPoints })
    }
  } else if (tool === 'eraser') {
    if (drawPoints.length) {
      const current = annotations.value
      const next = applyEraser(current, drawPoints, annotWidth.value)
      if (next !== current) {
        const s = commit(history.value, historyIndex.value, next)
        history.value = s.history
        historyIndex.value = s.index
      }
    }
  } else if (draft.value && !isDegenerate(draft.value)) {
    commitDraft(draft.value)
  }
  draft.value = null
  drawStart = null
  drawPoints = []
  drawScreen = []
}

/** 文字提交（幂等：Enter/blur/移除输入框都会触发，committed 防重复）。 */
function commitSession(session) {
  if (textSession.value === session) textSession.value = null
  if (!session || session.cancelled || session.committed) return
  session.committed = true
  const text = session.text.trim()
  if (!text) return
  commitDraft({ type: 'text', color: annotColor.value, x: session.point.x, y: session.point.y, text })
}

function cancelSession(session) {
  if (textSession.value === session) {
    textSession.value = null
    session.cancelled = true
  }
}

/** 文字输入框屏幕定位：语义 → SVG unit → CSS px（渲染尺寸比例）→ viewport 变换（与 screenToSvg 互逆）。 */
const textInputStyle = computed(() => {
  const session = textSession.value
  if (!session) return null
  const model = reliefModelForPlayback()
  if (model) {
    const rect = mapRenderRect()
    const point = projectedSemanticNorm(session.point.x, session.point.y)
    return {
      left: `${point.xNorm * rect.width * view.scale + view.tx}px`,
      top: `${point.yNorm * rect.height * view.scale + view.ty}px`,
    }
  }
  const s = svgToScreen(
    mapView.value,
    view,
    mapView.value.toX(session.point.x),
    mapView.value.toY(session.point.y),
    mapWidth(),
    mapHeight()
  )
  if (!s) return null
  return { left: `${s.x}px`, top: `${s.y}px` }
})

/** 渲染用标注列表：语义坐标 → SVG 像素（含进行中的 draft），尺寸按 x/y 轴比例换算。 */
const renderedAnnotations = computed(() => {
  const toX = mapView.value.toX
  const toY = mapView.value.toY
  const invX = 1 / Math.max(1e-9, semPerSvgX.value)
  const invY = 1 / Math.max(1e-9, semPerSvgY.value)
  const list = [...annotations.value]
  if (draft.value) list.push(draft.value)
  return list.map(ann => {
    const out = { ...ann, widthSvg: ann.width * invX }
    if (ann.type === 'pen') {
      out.svgPoints = polylinePoints(ann.points, toX, toY)
    } else if (ann.type === 'line' || ann.type === 'arrow') {
      out.x1 = toX(ann.x1)
      out.y1 = toY(ann.y1)
      out.x2 = toX(ann.x2)
      out.y2 = toY(ann.y2)
      if (ann.type === 'arrow') out.head = arrowHeadPoints(out.x1, out.y1, out.x2, out.y2)
    } else if (ann.type === 'rect') {
      out.x = toX(ann.x)
      out.y = toY(ann.y)
      out.w = ann.w * invX
      out.h = ann.h * invY
    } else if (ann.type === 'circle') {
      out.cx = toX(ann.cx)
      out.cy = toY(ann.cy)
      out.r = ann.r * invX
    } else if (ann.type === 'text') {
      out.x = toX(ann.x)
      out.y = toY(ann.y)
    }
    return out
  })
})

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  // fullscreenchange 由 usePlaybackFullscreen 独占监听（onChange 注入布局反应），这里不再重复注册
  // §3：大桌面三列布局 —— 以 matchMedia 为事实源，监听宽度跨 1200px 边界。
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    wideLayoutQuery = window.matchMedia('(min-width: 1200px)')
    wideLayout.value = !!wideLayoutQuery.matches
    if (typeof wideLayoutQuery.addEventListener === 'function') {
      wideLayoutQuery.addEventListener('change', onWideLayoutChange)
    }
  }
  window.addEventListener('keydown', onKeydown)
})

function frame(ts) {
  if (!playing.value) {
    rafId = null
    return
  }
  const delta = lastFrameTs == null ? 0 : (ts - lastFrameTs)
  lastFrameTs = ts
  const prev = currentTime.value
  const next = advancePlaybackTime(prev, duration.value, delta, speed.value)
  currentTime.value = next
  nowMs.value = realNowMs()
  // §1.3/§20.3/Blocker 2：先消费 (prev, next]（next 可 == duration——到达末尾前最后一段事件
  // 必须在停止/回绕前消费，exactly-once，不因到达 duration 丢失）；cursor 严格左开不重复。
  consumeEvents(prev, next)
  if (currentTime.value >= duration.value) {
    if (props.loop) {
      currentTime.value = 0
      // 循环回绕：只重置播放时间与严格左开 cursor。上一轮末尾刚消费的 transient 继续按
      // wall-clock 自然完成（「末尾消费一次」可见且不重复）；不重置 eventCursor 会把下一轮
      // (0, t] 的事件误判为已消费而静默跳过。
      eventCursor.value = 0
      rafId = requestAnimationFrame(frame)
      return
    }
    playing.value = false
    rafId = null
    // 播放到末尾自然停止 → 若有未决 transient，轻量 clock 接管
    ensurePauseClock(realNowMs())
    return
  }
  rafId = requestAnimationFrame(frame)
}

/** 幂等启动：任意时刻最多一个 RAF 循环（重复调用/重复事件不会创建第二个循环）。 */
function play() {
  if (playing.value || duration.value <= 0) return
  playing.value = true
  lastFrameTs = null
  // 播放开始：transient 时钟由 playback frame() 驱动——作废可能残留的轻量 pause RAF
  //（stub 环境只保留最近回调，若不清理，pause() 的 ensurePauseClock 会误判"已有 RAF"
  //  而无法注册接管时钟；真实浏览器中残留回调至多无害地刷新一次 nowMs）
  pauseRafId = null
  rafId = requestAnimationFrame(frame)
}

/** 幂等暂停：取消未完成的 RAF，绝不残留回调推进时间。 */
function pause() {
  playing.value = false
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  // 播放中可能有未决 transient——暂停后立即让轻量 pause clock（UI wall clock）接管；
  // 无 pending 时不启动 RAF（不永久轮询）。
  ensurePauseClock(typeof performance !== 'undefined' ? performance.now() : Date.now())
}

watch(() => props.seekTo, (sec) => {
  if (Number.isFinite(sec)) {
    pause() // 点击 AI 时间 → seek + 自动暂停（含取消 RAF）
    currentTime.value = clampPlaybackTime(sec, duration.value)
    resetTransients(currentTime.value)
    suppressHpTransition()
  }
}, { immediate: true })

function seek(sec) {
  currentTime.value = clampPlaybackTime(sec, duration.value)
  nowMs.value = realNowMs()
  resetTransients(currentTime.value)
  suppressHpTransition()
}

/** seek 后单帧禁用 HP bar transition（§20.1：只恢复状态，不补 150–300ms 缩短动画）。
 * 用 setTimeout 而非 requestAnimationFrame 清旗标：不占用共享 RAF 槽位（播放/
 * 暂停时钟仍由 rafCb 驱动，测试中 seek 后 rafCb 必须仍指向时钟回调）。 */
function suppressHpTransition() {
  hpNoTransition.value = true
  if (typeof setTimeout === 'function') {
    setTimeout(() => { hpNoTransition.value = false }, 0)
  } else {
    hpNoTransition.value = false
  }
}

function togglePlay() {
  if (playing.value) pause()
  else play()
}

/** 拖动进度条：按下即暂停，拖动中实时 seek，松开时若原先在播放则自动继续（与 3D 共用 usePlaybackTransport）。 */
function dragStart() {
  transport.scrubStart()
}

function dragEnd() {
  transport.scrubEnd()
}

/** Event Panel 行点击：跳转并保持暂停。 */
function seekToEvent(sec) {
  pause()
  seek(sec)
}

function step(delta) {
  currentTime.value = clampPlaybackTime(currentTime.value + delta, duration.value)
  resetTransients(currentTime.value)
  suppressHpTransition()
}

function setSpeed(next) {
  if (isPlaybackSpeed(next)) speed.value = next
}

// KeepAlive 停用（切到别的页面）时同样视为不可见
const lifecycleVisible = ref(true)
onDeactivated(() => { lifecycleVisible.value = false; pause() })
onActivated(() => { lifecycleVisible.value = true })
watch(() => props.active, (value) => { if (!value) pause() })

/**
 * 播放传输行为与 3D 共用：空格 / ←→ 的键位、输入框不劫持、拖动暂停后自动继续。
 * 键盘监听仍由本组件在 onMounted / onBeforeUnmount 挂卸（与其它全局监听同一处管理），
 * 所以 keyboard: false，只借用 handleKeydown。
 */
const transport = usePlaybackTransport({
  isPlaying: () => playing.value,
  play,
  pause,
  step,
  isActive: () => props.active && lifecycleVisible.value,
}, { keyboard: false })

function onKeydown(e) {
  transport.handleKeydown(e)
}

onBeforeUnmount(() => {
  playbackLifecycleActive = false
  paletteRequestToken += 1
  reloadAssetToken += 1
  if (rafId != null) cancelAnimationFrame(rafId)
  if (pauseRafId != null) cancelAnimationFrame(pauseRafId)
  if (mapResizeObserver) {
    mapResizeObserver.disconnect()
    mapResizeObserver = null
  }
  if (stageResizeObserver) {
    stageResizeObserver.disconnect()
    stageResizeObserver = null
  }
  if (typeof document !== 'undefined') {
    // fullscreenchange 的移除归 usePlaybackFullscreen（onScopeDispose 内完成；它同时负责解锁方向）
    // 组件在 fullscreen 中被卸载 → 主动退出（浏览器通常会自动退出，这里兜底）
    if (pbRoot.value && pbRoot.value === document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try {
        const exitResult = document.exitFullscreen()
        if (exitResult && typeof exitResult.catch === 'function') exitResult.catch(() => {})
      } catch {
        // fullscreen teardown is best-effort during component unmount
      }
    }
  }
  // §3：清理大桌面三列布局的 matchMedia 监听。
  if (wideLayoutQuery && typeof wideLayoutQuery.removeEventListener === 'function') {
    wideLayoutQuery.removeEventListener('change', onWideLayoutChange)
  }
  wideLayoutQuery = null
  window.removeEventListener('keydown', onKeydown)
  if (wheelHintTimer != null) clearTimeout(wheelHintTimer)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  pointers.clear()
  panStart = null
  pinchStart = null
  gestureMoved = false
  suppressClick = false
})

// ---- 数据 ----
const routesByAccount = computed(() => {
  const map = new Map()
  for (const track of playback.value?.vehicles || []) map.set(track.accountId, track)
  return map
})

const vehiclesByAccount = computed(() => {
  const map = new Map()
  for (const vehicle of (playback.value ? playback.value.vehicles : [])) {
    map.set(vehicle.accountId, vehicle)
  }
  return map
})

const friendlyColors = computed(() => palette.value.friendlyColors)
const enemyColors = computed(() => palette.value.enemyColors)

function vehicleColor(vehicle) {
  const teamVehicles = vehicleStates.value
    .map(st => st.vehicle)
    .filter(v => v.team === vehicle.team)
  const index = teamVehicles.indexOf(vehicle)
  const list = vehicle.friendly === true ? friendlyColors.value : enemyColors.value
  return list[Math.max(0, index) % list.length]
}

/**
 * 车辆显示状态：把「当前可信插值位置」与「最后可信位置」分开——
 * gap 内禁止穿线插值，但车辆停在淡化最后已知位置，不整辆消失；
 * 阵亡后冻结在阵亡时刻的最后可信位置（优先于位置中断）。
 * covered 只表示服务器位置流覆盖（type-10），不是点亮。
 * direction = {hullYawDeg, turretRelativeYawDeg} | null：无可靠方向样本时不旋转（不伪造朝向）。
 */
/**
 * PR2：该车辆的 dedicated model 决策（preload 结果）——
 * 非 Tier X / preload 失败 / 模块加载失败 → null（generic marker 单车 fallback）。
 */
function vehicleModel(vehicle) {
  const p = preload.value
  if (p.phase !== 'ready') return null
  const modelKey = p.byTank.get(String(vehicle.tankId))
  if (!modelKey || p.failed.has(modelKey)) return null
  return p.resolved.get(modelKey) || null
}

function reliefModelForPlayback() {
  const model = activeTerrainRelief.value
  return model && model.mapCode === String(pbOverview.value.mapCode || '') ? model : null
}

function projectedSemanticNorm(x, y) {
  const model = reliefModelForPlayback()
  if (model) {
    const point = projectTerrainPoint(model, Number(x), Number(y))
    if (point) return { xNorm: point.xNorm, yNorm: point.yNorm }
  }
  return {
    xNorm: mapView.value.toX(x) / mapView.value.W,
    yNorm: mapView.value.toY(y) / mapView.value.H,
  }
}

/** 标记水平位置（%）：地图用户坐标 → 容器百分比。 */
function markerLeft(x) {
  return `${((mapView.value.toX(x)) / mapView.value.W) * 100}%`
}

/** 标记垂直位置（%）。 */
function markerTop(y) {
  return `${((mapView.value.toY(y)) / mapView.value.H) * 100}%`
}

const baseVehicleStates = computed(() => {
  // preload 未完成（asset decision 未定）时不渲染车辆——禁止 generic 闪现后替换
  if (preload.value.phase !== 'ready') return []
  // V2-only：V2 track 为唯一事实源；无 V2 车辆 → 空（不再有 legacy overview.playback 兜底）。
  const tracks = props.playbackV2?.vehicles || []
  if (tracks.length === 0) return []
  return tracks
    .map(track => {
      const vehicle = track
      const model = vehicleModel(track)
      const mobile = isMobileDevice.value
      const markerSize = computeVehicleMarkerSize(vehicle, {
        model,
        mapView: mapView.value,
        mapWidthPx: mapWidth(),
        mapHeightPx: mapHeight(),
        mobile,
      })
      const state = projectVehicleState({
        vehicle,
        track,
        time: currentTime.value,
        recorderAccountId: pbOverview.value.recorderAccountId,
        model,
        markerSize,
        // Unknown perspective keeps neutral CSS state; enemy assets are only a
        // visual fallback because the asset pack has no neutral hull/turret.
        hullImage: track.friendly === true ? friendlyHull : enemyHull,
        turretImage: track.friendly === true ? friendlyTurret : enemyTurret,
        markerLeft: markerLeft,
        markerTop: markerTop,
        markerTransform: markerTransform.value,
        overlayInverseScale: overlayInverseScale.value,
        overlayInverse: overlayInverse.value,
        translate: t,
      })
      if (!state) return null
      const terrainModel = reliefModelForPlayback()
      const hullYawDeg = state.direction?.hullYawDeg
      const terrainAttitude = terrainModel && Number.isFinite(hullYawDeg)
        ? sampleTerrainAttitude(
          terrainModel,
          state.pos.x,
          state.pos.y,
          hullYawDeg,
          markerSize?.footprint,
        )
        : null
      return { ...state, terrainAttitude, reloadShells: vehicleReloadAt(track.accountId, currentTime.value) }
    })
    .filter(Boolean)
})

const collisionOffsets = ref(new Map())
watch(
  [baseVehicleStates, () => currentTime.value, () => view.scale, () => view.tx, () => view.ty, () => mapWidth(), () => mapHeight(), () => selectedAccountId.value],
  ([states]) => {
    const items = states.map((state) => {
      const point = canonicalMarkerScreen(state)
      if (!point) return null
      // 用渲染方框而不是车体矩形做碰撞：车体贴图按航向在方框内旋转，方框是它在屏幕上的
      // 外接盒。用各向异性的车体矩形会判错——横向行驶的车实际占满方框宽度，矩形却说它很窄，
      // 而且矩形不随航向旋转，两车接近垂直时判定完全失准。
      const width = state.markerSize.renderBox.width * view.scale
      const height = state.markerSize.renderBox.height * view.scale
      return {
        accountId: state.vehicle.accountId,
        x: point.x,
        y: point.y,
        width,
        height,
        selected: selectedAccountId.value === state.vehicle.accountId,
        recorder: state.recorder,
      }
    }).filter(Boolean)
    collisionOffsets.value = computeTankCollisionLayout(
      items,
      collisionOffsets.value,
      { viewportW: mapWidth(), viewportH: mapHeight() },
    )
  },
  { immediate: true },
)

const vehicleStates = computed(() => baseVehicleStates.value.map((state) => {
  const offset = collisionOffsets.value.get(state.vehicle.accountId) || { x: 0, y: 0 }
  const scale = view.scale || 1
  return {
    ...state,
    presentationOffset: offset,
    markerStyle: {
      ...state.markerStyle,
      width: `${state.markerSize.renderBox.width}px`,
      height: `${state.markerSize.renderBox.height}px`,
      // The camera content is layout-scaled rather than transform-scaled. Keep the marker's
      // existing scale so vehicle artwork and screen-space inverse overlays retain their contract.
      transform: `translate(-50%, -50%) scale(${scale})`,
      // Collision offsets are already final screen-pixel presentation offsets. The layout-scaled
      // camera does not scale absolute CSS px values, so preserve them unchanged here.
      left: `calc(${markerLeft(state.pos.x)} + ${offset.x}px)`,
      top: `calc(${markerTop(state.pos.y)} + ${offset.y}px)`,
    },
  }
}))

/**
 * authoritative playback events：全部回放事件。
 * deterministic state（当前累计伤害/击杀）与 combat feedback（floating damage / hit flash / ghost /
 * destruction burst / kill feed / damage log）必须消费本源——「战斗事实有没有发生」不取决于事件列表
 * UI 是否折叠。Event Panel 只消费 presentation-only 的 userVisibleEvents；炮线仍消费
 * 同一份完整真实事件。
 */
const authoritativeEvents = computed(() => (playback.value ? playback.value.events : []))
const userVisibleEvents = computed(() => authoritativeEvents.value.filter((event) => (
  event.type === 'DAMAGE' || event.type === 'KILL' || event.type === 'DESTROYED'
)))

// 炮线：仅来自真实事件流中的已知射击（DAMAGE/KILL），两端可信位置，随播放时间与倍速确定性呈现
const visibleTracers = computed(() => tracerLines(authoritativeEvents.value, routesByAccount.value, currentTime.value, speed.value))

function tracerColor(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? vehicleColor(vehicle) : palette.value.routeOutline
}

function playerName(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? (vehicle.playerName || `#${accountId}`) : (accountId == null ? t('recon.map.playback.unknown') : `#${accountId}`)
}

function eventLabel(event) {
  const type = t(`recon.map.playback.event_${event.type}`)
  switch (event.type) {
    case 'DAMAGE':
      // §11：raw Type-8 协议值语义未证明，不得作为精确伤害展示；只显示可证明的掉血
      return event.observedHpLoss != null
        ? `${playerName(event.accountId)} → ${playerName(event.targetAccountId)} −${event.observedHpLoss}`
        : `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
    case 'KILL':
      return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
    case 'DESTROYED':
      return playerName(event.accountId)
    default:
      return type
  }
}

// ---- PR4 §36/§37：hull hitbox 点击选中（重叠时取指针最近车辆；tie 保持 selected / render order）----
function onMarkerSelect(vehicle, event) {
  // §36：label 块（含 PlayerName tooltip 悬停区）不是 hitbox——点标签不选中车辆；
  // .pb-label-player 为触发原生 title 需要 pointer-events:auto，点击事件会冒泡到这里，须拦截。
  const t = event && event.target
  if (t && typeof t.closest === 'function' && t.closest('.pb-labels')) return
  selectAt(vehicle.accountId, event ? event.clientX : undefined, event ? event.clientY : undefined)
}

/** 标记中心 → 相对地图容器的屏幕 px（viewport 变换后）。 */
function canonicalMarkerScreen(st) {
  const rect = mapRenderRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const point = projectedSemanticNorm(st.pos.x, st.pos.y)
  return {
    x: point.xNorm * rect.width * view.scale + view.tx,
    y: point.yNorm * rect.height * view.scale + view.ty,
  }
}

function markerScreen(st) {
  const point = canonicalMarkerScreen(st)
  if (!point) return null
  const offset = st.presentationOffset || { x: 0, y: 0 }
  return { x: point.x + offset.x, y: point.y + offset.y }
}

function selectAt(accountId, clientX, clientY) {
  const states = vehicleStates.value
  const hasPoint = Number.isFinite(clientX) && mapEl.value && mapWidth() > 0
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  const px = hasPoint ? clientX - rect.left : NaN
  const py = hasPoint ? clientY - rect.top : NaN
  // Hit-test uses the final vehicle-aware hit target and the same presentation offset
  // used by the rendered marker. Selection still returns the canonical vehicle.
  const hitTest = (s) => {
    const cx = (px - view.tx) / view.scale
    const cy = (py - view.ty) / view.scale
    const rect = mapRenderRect()
    const offset = s.presentationOffset || { x: 0, y: 0 }
    const projected = projectedSemanticNorm(s.pos.x, s.pos.y)
    const x = projected.xNorm * rect.width + offset.x / view.scale
    const y = projected.yNorm * rect.height + offset.y / view.scale
    const hitTarget = s.hitTargetSize || s.markerSize?.hitTarget
    const hw = (hitTarget?.width || 20) / 2
    const hh = (hitTarget?.height || 20) / 2
    return Math.abs(cx - x) <= hw && Math.abs(cy - y) <= hh
  }
  let candidates
  if (hasPoint) {
    candidates = states.filter(hitTest)
    // 真实点击必然落在某 hitbox 内（label 点击已在 onMarkerSelect 拦截）；
    // 此处兜底只为合成事件/坐标与布局瞬时不一致（既有 toggle 行为）
    if (candidates.length === 0) {
      const target = states.find((s) => s.vehicle.accountId === accountId)
      candidates = target ? [target] : []
    }
  } else {
    const target = states.find((s) => s.vehicle.accountId === accountId)
    candidates = target ? [target] : []
  }
  if (candidates.length === 0) return
  let best = candidates[0]
  if (candidates.length > 1) {
    const dist = (s) => {
      const p = markerScreen(s)
      return p ? Math.hypot(p.x - px, p.y - py) : Infinity
    }
    candidates.sort((a, b) => (dist(a) - dist(b)) || (states.indexOf(a) - states.indexOf(b)))
    best = candidates[0]
    // tie（与前二近者距离几乎一致）且已有 selected 在候选内 → 保持当前 selected，不切换
    if (selectedAccountId.value != null && candidates.length > 1
        && Math.abs(dist(best) - dist(candidates[1])) < 1) {
      const sel = candidates.find((s) => s.vehicle.accountId === selectedAccountId.value)
      if (sel) { openDetails(selectedAccountId.value, sideAwayFromClientX(clientX)); return }
    }
  }
  // PR5 §8.1：点击 marker 恒选中/直接切换（不 toggle-off）；点击空白不关闭；必须 × 显式关闭
  // §details-float：浮窗落在**不遮住**这台车的一侧（按它在战场 workspace 里的屏幕位置）。
  openDetails(best.vehicle.accountId, sideAwayFromClientX(clientX))
  mobileOverlay.value?.reveal?.()
}

// §队伍阵容：从 result 全量名单（playbackV2.vehicles）取，不依赖回放事件流/vehicleStates。
// 按**物理队伍**（权威 `vehicle.team`）分组：左车道恒为 Team 1、右车道恒为 Team 2，
// 与录像者属于哪一队无关。friendly / enemy 是录像者视角，只服务 HUD 总血量 / 比分与详情里的
// 关系文案——物理位置 ≠ 录像者关系，两者互不推导。
const teamVehicles = computed(() => {
  const vehicles = props.playbackV2?.vehicles || []
  const team1 = []
  const team2 = []
  const unknown = []
  for (const v of vehicles) {
    if (v.team === 1) team1.push(v)
    else if (v.team === 2) team2.push(v)
    else unknown.push(v)
  }
  return { team1, team2, unknown }
})

/**
 * 审计 BZ-13 / PB-03：PC / 平板双栏的右侧栏在未选中车辆时不再空着，显示两队阵容（含当前存活状态），
 * 点玩家即打开该车详情。手机与窄平板（<860，堆叠形态）由 CSS 隐藏，避免把控制栏推出首屏。
 */
const destroyedNow = computed(() => new Set(
  baseVehicleStates.value.filter(st => st.destroyed === true).map(st => st.vehicle.accountId)))

/**
 * 正方形 Stage 的呈现决策（见 styles/playback-workspace.css 的权威契约）：
 *
 *   三段式（Team 1 | Stage | Team 2）＝ 名册开着 且 不是手机竖屏。
 *     宽档、平板、手机横屏都走这一条——横屏本来就有左右空白可用。
 *   手机竖屏 ＝ 纵向流：名册排在传输控件之下的 `.pb-inline-area`，跟着页面滚。
 *
 * 名册**只是呈现**：关掉不重置名册数据、选中车辆、跟随目标、时间轴与相机。
 */
const rosterLanes = computed(() => showRosterPresentation.value && !isPhonePortrait.value)
/** 竖屏的纵向流里，名册排在传输控件之后的 `.pb-inline-area`；详情则是流内内容块。
    竖屏以外，详情是 workspace 顶层的可拖动浮窗。 */
const inlineStack = computed(() => isPhonePortrait.value)
const detailsFloating = computed(() => !isPhonePortrait.value)
/**
 * Stage 右侧那一列（`.pb-side-panel-shell`）**只在真的有东西要放进去时**才渲染。
 *
 * 为什么不能让它作为空壳常驻：形态文件把它写成「地图列 + 详情列」的两轨 grid。没有内容
 * 也照样占住第二轨时，正方形只能拿到**第一轨**的列宽（并因此偏离 Stage 中心）——
 * 实测 1600×900 名册关闭：正方形 720px，左右间隙 147 / 487。布置见
 * `styles/playback-workspace.css` 的 `.pb-details-column`。
 *
 * 三段式（`rosterLanes`）下这一列同样没有内容：详情是 workspace 顶层的浮窗，名册在两侧车道。
 * 手机形态从来没有用过这一列（名册要么在车道、要么在 `.pb-inline-area`；竖屏的 inline 详情
 * 也在 `.pb-inline-area` 里，排在传输控件之后）。
 */
const rosterInShell = computed(() => formFactor.value !== 'mobile'
  && showRosterPresentation.value && !rosterLanes.value && !inlineStack.value)
/** 右侧详情列要渲染吗。**手机形态保留空壳**：它的 Stage 是块级流，空壳既不占轨也不影响
 *  正方形，而「空 shell 不阻挡 pointer」本身是被守卫测试断言过的行为。 */
const shellInUse = computed(() => formFactor.value === 'mobile' || rosterInShell.value)
/**
 * 选中与详情可见性是**两个状态**（不是「选中了 ⟺ 详情开着」）：
 *   选车 → selectedAccountId = 车，detailsOpen = true
 *   详情 × → 只有 detailsOpen = false；选中、跟随、时间轴、倍速、名册与地图视图都不动
 *   再点同一台 / 另一台车 → 同一个详情窗重新打开（或换内容），永远只有一个窗
 */
const detailsOpen = ref(false)
/** 浮窗初始落位偏好：由**这次选择的来源**决定（点左车道 → 落右侧，点右车道 → 落左侧，
 *  点地图上的车 → 与它在 workspace 里相对的一侧）。用户拖过之后不再生效。 */
const detailsSide = ref('right')

function openDetails(accountId, side = null) {
  selectedAccountId.value = accountId
  if (side) detailsSide.value = side
  detailsOpen.value = true
  // §右侧 only 车辆详情：不再开左侧 vehicle 二级，详情由 detailsOpen + selectedState 驱动。
  activePanel.value = null
}
/** 屏幕横坐标在战场 workspace 的哪一半 → 浮窗落到另一半。 */
function sideAwayFromClientX(clientX) {
  const host = battlefieldWorkspaceEl.value
  if (!host || !Number.isFinite(clientX)) return null
  const rect = host.getBoundingClientRect()
  return clientX > rect.left + rect.width / 2 ? 'left' : 'right'
}

/** 名册每行显示的当前 HP（与地图标记同一个权威投影：healthDisplayAt）。 */
const rosterHealth = computed(() => {
  const out = {}
  for (const state of baseVehicleStates.value) {
    const display = healthDisplayAt(state.vehicle, currentTime.value)
    if (!display) continue
    out[state.vehicle.accountId] = {
      currentHp: display.currentHp,
      maxHp: display.displayCapacityHp,
    }
  }
  return out
})
function selectFromRoster(accountId, event) {
  // §details-float：左边的 Team 1 名册 → 浮窗落右侧，右边的 Team 2 名册 → 浮窗落左侧，
  // 都不会盖住刚点的那一行（竖屏纵向流里详情是流内内容块，落位偏好不起作用）。
  const row = event?.target?.closest?.('[data-test="pb-roster-row"]')
  let side = null
  if (row?.closest?.('.pb-team-lane-left')) side = 'right'
  else if (row?.closest?.('.pb-team-lane-right')) side = 'left'
  else if (row) side = sideAwayFromClientX(row.getBoundingClientRect().left)
  openDetails(accountId, side)
}

const selectedState = computed(() => {
  if (selectedAccountId.value == null) return null
  return vehicleStates.value.find(st => st.vehicle.accountId === selectedAccountId.value) || null
})
/** 详情真正呈现的对象：选中了**且**详情开着。关掉详情不清选中。 */
const detailsState = computed(() => (detailsOpen.value ? selectedState.value : null))

// Selected vehicle details consume the canonical track directly by accountId.
const selectedTrack = computed(() => {
  if (!props.playbackV2 || !selectedState.value) return null
  const accountId = selectedState.value.vehicle.accountId
  const tracks = props.playbackV2.vehicles || []
  return tracks.find(t => t.accountId === accountId) || null
})

// Details Panel 车型图：仅在选中车辆后按 tankId 懒加载；图片随站点发布，production 不访问 BlitzKit。
// token 防止快速切换车辆时旧请求覆盖新选择；非 Tier X / 缺图 / chunk 失败均静默降级为无图。
const selectedPortraitUrl = ref(null)
let portraitLoadToken = 0
watch(
  () => selectedState.value?.vehicle?.tankId,
  async (tankId) => {
    const token = ++portraitLoadToken
    selectedPortraitUrl.value = null
    if (tankId == null) return
    try {
      const { loadVehiclePortrait } = await import('../vehicle-portraits/runtime.js')
      const url = await loadVehiclePortrait(tankId)
      if (token === portraitLoadToken) selectedPortraitUrl.value = url
    } catch {
      if (token === portraitLoadToken) selectedPortraitUrl.value = null
    }
  },
)

/** 详情 ×：只关详情。选中（名册高亮 / 地图标记选中态）、跟随、时间轴、倍速、名册与视图都保留。 */
function closeSidebar() {
  detailsOpen.value = false
}

function closePanel() {
  activePanel.value = null
}

const selLastKnownSec = computed(() => {
  const st = selectedState.value
  return st && st.lastKnown && Number.isFinite(st.pos.timeSec) ? st.pos.timeSec : null
})
// §16/§17：当前统计 = 权威 HP loss 重建（dealt 仅计可 attribution 的掉血——
// incomplete observation 不冒充完整统计，文案用「已记录伤害」；received 含全部掉血）
const selCurStats = computed(() => {
  const st = selectedState.value
  if (!st) return { dealt: 0, received: 0, kills: 0 }
  return cumulativeStatsAtV2(authoritativeEvents.value, st.vehicle, currentTime.value, hpVehicles.value)
})
/** §12/§13/§19 最近伤害记录：incoming 使用 canonical HP decrease，outgoing 使用 observedHpLoss；attacker 不可证明时
 *  显示「来源未知」；raw Type-8 协议值不参与。Blocker 2：只消费 toSec <= currentTime 的记录
 *  （forward/backward seek 与任意 timestamp 重建天然正确，未来事件绝不泄漏）；取最近 8 条。 */
const selDamageLog = computed(() => {
  const st = selectedState.value
  if (!st) return []
  const rows = damageLogAtV2(authoritativeEvents.value, st.vehicle, currentTime.value, 8, hpVehicles.value)
  return rows.map((d) => {
    if (d.dir === 'in') {
      if (d.attackerReliable && d.attackerAccountId != null) {
        const attacker = vehiclesByAccount.value.get(d.attackerAccountId)
        // §13：事件时刻位置流未覆盖的攻击者不得泄露身份
        const covered = attacker && victimFeedbackAllowedV2(attacker, d.timeSec)
        return { ...d, label: attacker && covered
          ? (attacker.playerName || '#' + attacker.accountId)
          : t('recon.map.playback.source_unknown') }
      }
      return { ...d, label: t('recon.map.playback.source_unknown') }
    }
    const victim = vehiclesByAccount.value.get(d.victimAccountId)
    return { ...d, label: victim ? (victim.tankName || '#' + victim.accountId) : '#' + d.victimAccountId }
  })
})
function floatTeamClass(friendly) {
  if (friendly === true) return 'pb-float-friendly'
  if (friendly === false) return 'pb-float-enemy'
  return 'pb-float-neutral'
}

// ---- PR4 §32–§35：标签碰撞布局（纯函数；screen px；碰撞永不隐藏标签/HP）----
// §21–§28 + PR #107 Blocker 1：碰撞基于真实 screen-space visual footprint。
// 坐标空间（统一约定）：
//   - marker core 本体在 viewport 内随地图缩放：每辆车的 vehicle-aware CSS footprint
//     × view.scale；coreSize 仅作为 label 几何的代表值，不参与 model collision。
//   - inverse-scaled 叠加层（selected 三角 / destroyed ✕ / recorder 菱形 / 名称 / HP HUD）
//     用 scale(1/view.scale) 保持屏幕恒定，labelLayout 用屏幕恒定常量描述其盒。
//   - viewport resize / fullscreen / mobile media query / zoom / 显示开关变化都会经
//     view.scale / mapWidth / prefs 触发本 computed 重算。
const labelLayout = computed(() => {
  const W = mapWidth()
  if (!W || mapView.value.W <= 0) return new Map()
  // Label geometry remains screen-space and only needs a representative core size;
  // the model collision solver above uses each vehicle's real display footprint.
  const coreSize = Math.max(
    ...vehicleStates.value.map((st) => st.markerSize?.renderBox?.width || 0),
    MARKER_CORE_PX,
  )
  // HP HUD 真实渲染尺寸（.pb-hp-hud 屏幕恒定；测试环境无布局 → 回退 null 走 CSS 常量）。
  // PR #107 Blocker 4：querySelector 第一辆车的 HUD 只作测量基准——不同车辆的显示文本不同
  //（数字 vs —）可能影响宽度，labelLayout 侧再按每车 hpDisplayText 估算并取 max（保守覆盖全部状态）。
  const hpHudEl = mapEl.value?.querySelector('.pb-hp-hud')
  const hpBoxW = hpHudEl ? Number(hpHudEl.offsetWidth) : null
  const hpBoxH = hpHudEl ? Number(hpHudEl.offsetHeight) : null
  const items = vehicleStates.value.map((st) => {
    const p = markerScreen(st)
    if (!p) return null
    const hp = hpFor(st.vehicle)
    return {
      accountId: st.vehicle.accountId,
      x: p.x,
      y: p.y,
      tankName: st.tankName,
      playerName: st.playerName,
      // PR #107 Blocker 4：HP footprint 是否存在 = DOM 是否实际渲染 HUD（showHp 开且
      // health selector 有结果），不是 current 是否为 null——relativeFull（current=null）
      // 与 UNKNOWN 都会渲染 HUD（数字 — + bar），碰撞系统必须为它们建模真实盒。
      hpRendered: hpPrefs.showHp && hp != null,
      // 实际渲染的数字文本（VehicleMarker .pb-hp-num 同款：current 有值→数字，否则 —）；
      // labelLayout 用它做「覆盖所有状态的保守盒宽」估算（与第一辆车实测宽取 max）
      hpDisplayText: hp ? hpDisplayNumText(hp) : '',
      hpBoxW,
      hpBoxH,
      selected: selectedAccountId.value === st.vehicle.accountId,
      destroyed: st.destroyed === true,
      recorder: st.recorder === true,
    }
  }).filter(Boolean)
  return computeLabelLayout(items, {
    showTank: labelPrefs.showTankName,
    showPlayer: labelPrefs.showPlayerName,
    viewportW: W,
    viewportH: W * (mapView.value.H / mapView.value.W),
    coreSize,
  })
})

/** 是否存在未决的 transient（暂停时需轻量时钟自然完成，§20.2）。 */
function hasPendingPauseClock(now) {
  return hasPendingTransients(now)
}

/** 轻量时钟：仅当存在未决 transient 且未在播放时维持 RAF；播放时由 frame() 驱动，
 *  无 pending 即停（不做永久轮询）。注意：只更新 nowMs，不在 watcher 内回写 nowMs
 *  （nowMs 是 watch source，回写会自触发无限循环）。
 * @param now 当前新鲜 wall clock（用于 pending 判定）
 */
function ensurePauseClock(now) {
  if (pauseRafId != null || playing.value) return
  if (hasPendingPauseClock(now)) {
    pauseRafId = requestAnimationFrame(() => {
      pauseRafId = null
      nowMs.value = typeof performance !== 'undefined' ? performance.now() : Date.now()
      // nowMs 变化 → transient watch → ensurePauseClock(新鲜 now) 决定续/停
    })
  }
}

// transient 过期清理（nowMs/currentTime 变化驱动；reactive Map 不无限增长）
watch([nowMs, currentTime], () => pruneTransients(nowMs.value))

/** VehicleMarker label prop（每 marker 一个：显示开关 + 碰撞位移 +
 *  §25 blockHidden/hpHidden：不可分离碰撞时的优先级隐藏兼容输出，恒 false）。 */
function markerLabel(accountId) {
  const l = labelLayout.value.get(accountId)
  return {
    showPlayer: labelPrefs.showPlayerName,
    showTank: labelPrefs.showTankName,
    showReload: labelPrefs.showReload,
    tankDy: l ? l.tankDy : 0,
    blockHidden: l ? l.blockHidden : false,
    hpHidden: l ? l.hpHidden : false,
  }
}

// 圆圈颜色只表示当前归属；正在占领由进度弧单独表达，不覆盖归属。
function baseStatus(state) {
  if (!state || state.ownerTeam == null) return 'neutral'
  if (friendlyTeam.value == null) return 'controlled'
  return state.ownerTeam === friendlyTeam.value ? 'friendly_controlled' : 'enemy_controlled'
}

function capturedBy(state) {
  if (!state || state.capturingTeam == null || friendlyTeam.value == null) return 'unknown'
  return state.capturingTeam === friendlyTeam.value ? 'friendly' : 'enemy'
}

// 顶部基地状态条（与 3D 共用 BaseStatusBar）：始终显示，地图缺该图几何时它也是唯一的基地信息来源。
const hudBaseStates = computed(() => baseStatesAt.value)

const ASSAULT_BASE_RADIUS_FALLBACK_M = 20

const basesAt = computed(() => {
  // Objective existence is independent of capture activity; geometry never infers mode.
  const states = new Map(baseStatesAt.value.map((state) => [state.baseId, state]))
  const assaultState = states.get('BASE')
  const assaultView = baseView(assaultState || { baseId: 'BASE' }, friendlyTeam.value)
  if (playback.value?.assaultObjectivePresent === true) {
    const mapCode = pbOverview.value?.mapCode
    const semantics = mapSemantics.find(map => map.verified && map.mapCodes?.includes(mapCode))
    const geometry = (semantics?.sceneEvidence?.battlePoints || [])
      .filter(point => point.type === 'controlpoint' && point.confidence === 'EXACT_SCENE_DATA')
      .map(point => ({ x: point.position[0], y: point.position[1], radius: null }))
    // Ambiguous geometry cannot select an objective; retain the canonical HUD fallback.
    if (geometry.length !== 1) return []
    return geometry.map((base) => ({
      ...base,
      baseId: 'BASE',
      // 部分 client scene 未声明 controlpoint radius。20m 仅是 presentation fallback，
      // 不进入 protocol/canonical truth，也不根据车辆距离推导半径。
      radius: base.radius ?? ASSAULT_BASE_RADIUS_FALLBACK_M,
      status: assaultView.owner === 'friendly'
        ? 'friendly_controlled'
        : (assaultView.owner === 'enemy' ? 'enemy_controlled' : 'neutral'),
      progress: assaultView.progress,
      capturedBy: assaultView.capturing ?? 'unknown',
    }))
  }

  if (!baseStatesAt.value.some(state => ['A', 'B', 'C', 'D'].includes(state.baseId))) return []
  const geometry = mapBases[pbOverview.value?.mapCode]?.supremacy || []
  return geometry
    .filter((base) => base.radius != null)
    .map((base) => {
      const state = states.get(base.baseId)
      return {
        ...base,
        status: baseStatus(state),
        // Supremacy 水位只有 capturingTeam 存在时才显示；离开基地后旧 progress 不得继续挂着。
        progress: state?.capturingTeam != null ? (state.captureProgress ?? null) : null,
        capturedBy: capturedBy(state),
      }
    })
})

const mapStyle = computed(() => ({
  // 只有用户真的拖过才覆盖；否则保持 CSS 里的响应式默认宽度。
  ...(railWidthPx.value != null ? { '--pb-rail-w': `${railWidthPx.value}px` } : {}),
  ...(paneWidths.details != null ? { '--pb-details-w': `${paneWidths.details}px` } : {}),
  // §side-slots：两侧黑边实宽（0 = 不启用侧栏形态）。
  ...(sideSlotWidth.value ? { '--pb-slot-w': `${sideSlotWidth.value}px` } : {}),
  '--pb-map-aspect': `${mapView.value.W} / ${mapView.value.H}`,
  // Numeric aspect ratio (W/H) for fullscreen contain sizing (aspect-ratio needs a unit string).
  '--pb-map-ratio': String(mapView.value.W / mapView.value.H),
  // Battle Playback 6x6 网格：用显式强对比线，保证每一列可见地隔开（热力图鸟瞰用弱 gridStroke）。
  '--map-grid-stroke': palette.value.gridStrokeStrong,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
  '--map-route-outline': palette.value.routeOutline,
  // PR3 §19/§20：marker team tokens（friendly 按地图显式 tone，enemy 固定 red）
  ...teamCssVars(pbOverview.value.mapCode)
}))
</script>

<template>
  <div v-if="image && playback" ref="pbRoot" class="battle-playback" :class="{ 'pb-device-mobile': isMobileDevice, 'pb-rail-expanded': !!(activePanel || annotationOpen), 'pb-drawer-open': railDrawerOpen, 'pb-rail-collapsed': railCollapsed, 'pb-side-slots': sideSlots, 'pb-controls-bottom': !controlsInRail, 'pb-roster-lanes': rosterLanes, 'pb-details-column': shellInUse, ['pb-form-' + formFactor]: true }" :style="mapStyle" data-test="battle-playback">
    <BattlePlaybackHud
      :friendly-hp="friendlyHp"
      :enemy-hp="enemyHp"
      :friendly-points="friendlyPoints"
      :enemy-points="enemyPoints"
      :base-states="hudBaseStates"
      :friendly-team="friendlyTeam"
      :hp-no-transition="hpNoTransition"
    />

    <!-- 地图是主视觉；控制条在桌面流式布局，移动端由首次触摸唤起。 -->
    <!-- §2：Fullscreen Workspace —— Left Rail（fullscreen 下作为左列；普通页面隐藏） -->
    <!-- §mobile-panels：无永久 rail（mobile/medium）时 ☰ 打开 drawer；backdrop 点击关闭。 -->
    <div v-if="railDrawerOpen" class="pb-drawer-backdrop" data-test="pb-drawer-backdrop" @click="mobileDrawerOpen = false" />
    <div class="pb-left-rail" :class="{ 'pb-rail-expanded': !!(activePanel || annotationOpen) }" data-test="pb-left-rail" aria-label="Playback workspace rail">
      <div
        class="pb-pane-resizer pb-pane-resizer-rail"
        data-test="pb-rail-resizer"
        role="separator"
        aria-orientation="vertical"
        :aria-label="$t('recon.map.playback.panel_team')"
        @pointerdown="startPaneResize($event, 'rail')"
      />
      <!-- 收起/展开左栏。收起后本按钮是窄条里唯一剩下的东西，也是唯一的重开入口——
           所以不能收成 0 宽，否则入口只能放到地图上。 -->
      <button
        type="button"
        class="pb-rail-collapse"
        data-test="pb-rail-collapse"
        :title="railCollapsed ? $t('recon.map.playback.rail_expand') : $t('recon.map.playback.rail_collapse')"
        :aria-label="railCollapsed ? $t('recon.map.playback.rail_expand') : $t('recon.map.playback.rail_collapse')"
        :aria-expanded="!railCollapsed"
        aria-controls="pb-left-rail-body"
        @click="toggleRailCollapsed"
      ><span class="pb-rail-glyph" aria-hidden="true">{{ railCollapsed ? '»' : '«' }}</span><span class="pb-rail-label">{{ $t('recon.map.playback.rail_collapse') }}</span></button>
      <div id="pb-left-rail-body" class="pb-rail-body" data-test="pb-rail-body">
      <!-- §二级菜单：左侧展开对应内容，带返回按钮（不占右侧 details panel） -->
      <template v-if="annotationOpen">
        <button type="button" class="pb-rail-back" data-test="pb-rail-back" :title="$t('recon.map.playback.back')" :aria-label="$t('recon.map.playback.back')" @click="closeAnnotation">← {{ $t('recon.map.playback.back') }}</button>
        <AnnotationToolbar
          :open="true"
          :active-tool="activeTool"
          :annot-colors="ANNOT_COLORS"
          :annot-color="annotColor"
          :annot-visible="annotVisible"
          :annot-width-slider="annotWidthSlider"
          :annot-width-min="ANNOT_WIDTH_MIN"
          :annot-width-max="ANNOT_WIDTH_MAX"
          :history-index="historyIndex"
          :history="history"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @close="closeAnnotation"
          @toggle-tool="toggleTool"
          @set-annot-color="annotColor = $event"
          @update:annot-width="annotWidthSlider = $event"
          @undo="undoAnnot"
          @redo="redoAnnot"
          @clear-annotations="clearAll"
          @toggle-annotations="annotVisible = !annotVisible"
        />
      </template>
      <!-- Team / 阵容分页：**唯一的手机名册入口**（二级面内），并且用真正的
           `PlaybackRoster` 而不是静态名单——静态列表只有名字，没有「点行 → 选中车辆 →
           打开共享 VehicleDetailsPanel」的交互契约，会直接退化 2D 的选中能力。
           它同时受共享呈现偏好约束：showRoster=false 时这个入口根本不存在。 -->
      <template v-else-if="activePanel === 'team' && showRosterPresentation">
        <button type="button" class="pb-rail-back" data-test="pb-rail-back" :title="$t('recon.map.playback.back')" :aria-label="$t('recon.map.playback.back')" @click="activePanel = null">← {{ $t('recon.map.playback.back') }}</button>
        <PlaybackRoster
          class="pb-team-panel-roster"
          data-test="pb-team-panel-roster"
          data-testid="team-panel-roster"
          :teams="teamVehicles"
          :destroyed="destroyedNow"
          :health="rosterHealth"
          :selected-id="selectedAccountId"
          @select="selectFromRoster"
        />
      </template>
      <template v-else-if="activePanel === 'display'">
        <button type="button" class="pb-rail-back" data-test="pb-rail-back" :title="$t('recon.map.playback.back')" :aria-label="$t('recon.map.playback.back')" @click="activePanel = null">← {{ $t('recon.map.playback.back') }}</button>
        <div class="pb-panel-options" data-test="pb-panel-content-display">
          <label><input data-test="pb-show-player" type="checkbox" :checked="labelPrefs.showPlayerName" @change="labelPrefs.showPlayerName = $event.target.checked"> {{ $t('recon.map.playback.show_player_name') }}</label>
          <label><input data-test="pb-show-tank" type="checkbox" :checked="labelPrefs.showTankName" @change="labelPrefs.showTankName = $event.target.checked"> {{ $t('recon.map.playback.show_tank_name') }}</label>
          <label><input data-test="pb-show-hp" type="checkbox" :checked="hpPrefs.showHp" @change="hpPrefs.showHp = $event.target.checked"> {{ $t('recon.map.playback.show_hp') }}</label>
          <label><input data-test="pb-show-trail" type="checkbox" :checked="trailPrefs.showTrail" @change="trailPrefs.showTrail = $event.target.checked"> {{ $t('recon.map.playback.show_trail_2s') }}</label>
          <!-- 名册可见性是**共享呈现偏好**（与 3D 同一个 uiPrefs.showRoster）。隐藏只关呈现：
               名册数据、选中车辆、跟随目标、时间轴与相机都不重置。 -->
          <label><input data-test="pb-show-roster" type="checkbox" :checked="uiPrefs.showRoster" @change="uiPrefs.showRoster = $event.target.checked"> {{ $t('agentReplay.display_roster') }}</label>
        </div>
        <!-- 渲染器专属工具（次级层级）：手机形态下主面只留传输 + 全屏 + 二级入口，
             这些工具移到这里，功能不丢（原来常驻在传输控件行的动作）。
             字形沿用本文件既有的 .pb-rail-glyph 写法（不引入新图标依赖）。宽档仍在主面原位。 -->
        <div v-if="isMobileDevice" class="pb-panel-tools" data-test="pb-panel-tools">
          <p class="pb-panel-tools-title">{{ $t('recon.map.playback.panel_display') }}</p>
          <button type="button" class="pb-tool-row" data-test="pb-panel-annotation" @click="toggleAnnotation()">
            <span class="pb-rail-glyph" aria-hidden="true">✎</span> {{ $t('recon.map.playback.annotation') }}
          </button>
          <button type="button" class="pb-tool-row" data-test="pb-panel-reset" @click="resetView()">
            <span class="pb-rail-glyph" aria-hidden="true">⟲</span> {{ $t('recon.map.playback.reset_view') }}
          </button>
        </div>
      </template>
      <template v-else-if="activePanel === 'events'">
        <button type="button" class="pb-rail-back" data-test="pb-rail-back" :title="$t('recon.map.playback.back')" :aria-label="$t('recon.map.playback.back')" @click="activePanel = null">← {{ $t('recon.map.playback.back') }}</button>
        <div class="pb-event-list" data-test="pb-event-panel">
          <button
            v-for="(event, index) in userVisibleEvents"
            :key="`${event.type}-${event.timeSec}-${index}`"
            type="button"
            class="pb-event-row"
            data-test="pb-event"
            @click="seekToEvent(event.timeSec)"
          >
            <span class="pb-event-time">{{ formatClock(event.timeSec) }}</span>
            <span class="pb-event-type">{{ $t(`recon.map.playback.event_${event.type}`) }}</span>
            <span>{{ eventLabel(event) }}</span>
          </button>
          <p v-if="userVisibleEvents.length === 0" class="pb-event-empty">{{ $t('recon.map.playback.no_events') }}</p>
        </div>
      </template>
      <!-- 一级菜单：播放控制 + 图标导航。rail 宽 --pb-rail-w，放得下速度档位那一排。 -->
      <template v-else>
        <PlaybackControls
          v-if="controlsInRail"
          :playing="playing"
          :speed="speed"
          :current-time="currentTime"
          :duration="duration"
          :fullscreen-supported="fullscreenSupported"
          :is-fullscreen="isFullscreen"
          :rail-visible="true"
          :format-clock="formatClock"
          @toggle-play="togglePlay"
          @step="step"
          @set-speed="setSpeed"
          @reset-view="resetView"
          @toggle-fullscreen="toggleFullscreen"
          @toggle-panels="mobileDrawerOpen = !mobileDrawerOpen"
          @toggle-annotation="toggleAnnotation()"
          @drag-start="dragStart"
          @drag-end="dragEnd"
          @seek="seek"
        />
      <!-- Team / 阵容导航项：名册是呈现偏好的产物，偏好关闭时这个入口不得存在
           （否则会点进一个空的分页，或者更糟——点到被隐藏的名册数据）。 -->
      <button
        v-if="showRosterPresentation"
        type="button"
        class="pb-rail-btn"
        :class="{ active: activePanel === 'team' }"
        data-test="pb-rail-team"
        :aria-expanded="activePanel === 'team'"
        :title="$t('recon.map.playback.panel_team')"
        :aria-label="$t('recon.map.playback.panel_team')"
        @click="activePanel = activePanel === 'team' ? null : 'team'"
      ><span class="pb-rail-glyph">⚖</span><span class="pb-rail-label">{{ $t('recon.map.playback.panel_team') }}</span></button>
      <button
        type="button"
        class="pb-rail-btn"
        :class="{ active: activePanel === 'display' }"
        data-test="pb-rail-display"
        :aria-expanded="activePanel === 'display'"
        :title="$t('recon.map.playback.panel_display')"
        :aria-label="$t('recon.map.playback.panel_display')"
        @click="activePanel = activePanel === 'display' ? null : 'display'"
      ><span class="pb-rail-glyph">⚙</span><span class="pb-rail-label">{{ $t('recon.map.playback.panel_display') }}</span></button>
      <button
        type="button"
        class="pb-rail-btn"
        :class="{ active: activePanel === 'events' }"
        data-test="pb-rail-events"
        :aria-expanded="activePanel === 'events'"
        :title="$t('recon.map.playback.panel_events')"
        :aria-label="$t('recon.map.playback.panel_events')"
        @click="activePanel = activePanel === 'events' ? null : 'events'"
      ><span class="pb-rail-glyph">☰</span><span class="pb-rail-label">{{ $t('recon.map.playback.panel_events') }}</span></button>
      <button
        type="button"
        class="pb-rail-btn"
        :class="{ active: annotationOpen }"
        data-test="pb-rail-annotation"
        :aria-expanded="annotationOpen"
        :title="$t('recon.map.playback.annotation')"
        :aria-label="$t('recon.map.playback.annotation')"
        @click="toggleAnnotation()"
      ><span class="pb-rail-glyph">✎</span><span class="pb-rail-label">{{ $t('recon.map.playback.annotation') }}</span></button>
      <button
        type="button"
        class="pb-rail-btn"
        :class="{ active: isFullscreen }"
        data-test="pb-rail-fullscreen"
        :title="$t(isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')"
        :aria-label="$t(isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')"
        @click="toggleFullscreen"
      ><span class="pb-rail-glyph">⛶</span><span class="pb-rail-label">{{ $t(isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen') }}</span></button>
      <button
        type="button"
        class="pb-rail-btn"
        data-test="pb-rail-reset"
        :title="$t('recon.map.playback.reset_view')"
        :aria-label="$t('recon.map.playback.reset_view')"
        @click="resetView"
      ><span class="pb-rail-glyph">↺</span><span class="pb-rail-label">{{ $t('recon.map.playback.reset_view') }}</span></button>
      </template>
      </div>
    </div>

    <div ref="battlefieldWorkspaceEl" class="pb-main" data-test="pb-main">
      <!-- §square-stage 三段式：Team 1 | 正方形 Stage | Team 2。
           两侧车道只在「名册开着 且 非手机竖屏」时存在；关掉名册两侧整体消失，
           Stage 依然居中且保持正方形（绝不被拉宽填满）。 -->
      <div v-if="rosterLanes" class="pb-team-lane pb-team-lane-left" data-test="pb-team-lane-left" :aria-label="$t('agentReplay.team1')">
        <PlaybackRoster :teams="{ team1: teamVehicles.team1, unknown: teamVehicles.unknown }" :destroyed="destroyedNow" :health="rosterHealth" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" @select="selectFromRoster" />
      </div>
      <div class="pb-map-stage" ref="mapStageEl">
        <BattleMap
          ref="mapComponent"
          :image="image"
          :map-view="mapView"
          :pb-overview="pbOverview"
          :friendly-team="friendlyTeam"
          :bases="basesAt"
          :visible-tracers="visibleTracers"
          :visible-trails="visibleTrails"
          :tracer-color="tracerColor"
          :view-scale="view.scale"
          :rendered-frame="renderedMapFrame"
          :viewport-style="viewportStyle"
          :annot-visible="annotVisible"
          :rendered-annotations="renderedAnnotations"
          :annot-font-size="ANNOT_FONT_SIZE"
          :active-tool="activeTool"
          :vehicle-states="vehicleStates"
          :selected-account-id="selectedAccountId"
          :marker-label="markerLabel"
          :hp-for="hpFor"
          :hp-prefs="hpPrefs"
          :translate="t"
          :ghost-for="ghostFor"
          :flash-for="flashFor"
          :hp-no-transition="hpNoTransition"
          :text-session="textSession"
          :text-input-style="textInputStyle"
          :visible-floats="visibleFloats"
          :visible-bursts="visibleBursts"
          :float-team-class="floatTeamClass"
          :touch-pan="mapTouchPan"
          @wheel="onWheel"
          @pointer-down="onPointerDown"
          @pointer-move="onPointerMove"
          @pointer-up="onPointerUp"
          @viewport-click="onViewportClick"
          @marker-select="onMarkerSelect"
          @update-text="textSession.text = $event"
          @commit-text="commitSession"
          @cancel-text="cancelSession"
        />
        <!-- 审计 PB-04：未与地图交互时滚轮交给页面，这里短暂提示如何缩放 -->
        <div v-if="wheelHintVisible" class="pb-wheel-hint" role="status" data-test="pb-wheel-hint">{{ t('workspace.map_wheel_hint') }}</div>

        <div v-if="shellInUse" class="pb-side-panel-shell" :class="{ 'pb-details-active': !!detailsState }" data-test="pb-side-panel-shell">
          <div
            class="pb-pane-resizer pb-pane-resizer-details"
            data-test="pb-details-resizer"
            role="separator"
            aria-orientation="vertical"
            @pointerdown="startPaneResize($event, 'details')"
          />
          <!-- 常驻名册（窄档 / 竖屏以外的回退位置）：可见性由**共享呈现偏好**
               uiPrefs.showRoster 独占，与 3D 同一个 key。三段式开着时名册由两侧车道承担，
               这里不再画第二份。关掉只是不呈现——名册数据、选中车辆、详情、时间轴与
               地图视图都由播放状态持有，恢复后立刻可用，不重建、不重解析。 -->
          <PlaybackRoster
            v-if="rosterInShell"
            :teams="teamVehicles"
            :destroyed="destroyedNow"
            :health="rosterHealth"
            :selected-id="selectedAccountId"
            @select="selectFromRoster"
          />
        </div>
      </div>

      <!-- §details-float：详情是**整个战场 workspace（.pb-main）顶层**的可拖动浮窗，不属于
           Stage、也不属于任何一条名册车道——它可以被拖到 Team 1 / Stage / Team 2 任意一栏之上。
           宿主就是它的定位祖先 `.pb-main`（同一个坐标系）；位置/边界/初始落位由
           usePlaybackDetailsPlacement 独占（含「不得盖住传输控件」的保护边界）。 -->
      <VehicleDetailsPanel
        v-if="detailsFloating && detailsState"
        presentation="floating"
        :phone-form="false"
        :selected-state="detailsState"
        :selected-portrait-url="selectedPortraitUrl"
        :sel-last-known-sec="selLastKnownSec"
        :sel-cur-stats="selCurStats"
        :selected-track="selectedTrack"
        :current-time="currentTime"
        :sel-damage-log="selDamageLog"
        :format-clock="formatClock"
        :drag-host="battlefieldWorkspaceEl"
        :drag-bounds="transportEl"
        :initial-side="detailsSide"
        :selection-key="selectedAccountId"
        @close="closeSidebar"
      />

      <div v-if="rosterLanes" class="pb-team-lane pb-team-lane-right" data-test="pb-team-lane-right" :aria-label="$t('agentReplay.team2')">
        <PlaybackRoster :teams="{ team2: teamVehicles.team2 }" :destroyed="destroyedNow" :health="rosterHealth" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" @select="selectFromRoster" />
      </div>

      <PlaybackMobileOverlay ref="mobileOverlay" :paused="!playing">
        <div ref="transportEl" class="pb-transport-slot" data-test="pb-transport-slot">
        <PlaybackControls
          v-if="!controlsInRail"
          :playing="playing"
          :speed="speed"
          :current-time="currentTime"
          :duration="duration"
          :fullscreen-supported="fullscreenSupported"
          :is-fullscreen="isFullscreen"
          :format-clock="formatClock"
          @toggle-play="togglePlay"
          @step="step"
          @set-speed="setSpeed"
          @reset-view="resetView"
          @toggle-fullscreen="toggleFullscreen"
          @toggle-panels="mobileDrawerOpen = !mobileDrawerOpen"
          @toggle-annotation="toggleAnnotation()"
          @drag-start="dragStart"
          @drag-end="dragEnd"
          @seek="seek"
        />
        <!-- 移动端（rail 隐藏）标注工具栏：和 controls 一样排在地图下方的流内容器里。
             以前它是 .pb-map-stage 里 bottom 锚定的 absolute 浮层，展开时向上长、挡住地图。 -->
        <div v-if="annotationOpen && !(isFullscreen || wideLayout)" class="pb-annotation-surface">
          <AnnotationToolbar
            :open="annotationOpen"
            :active-tool="activeTool"
            :annot-colors="ANNOT_COLORS"
            :annot-color="annotColor"
            :annot-visible="annotVisible"
            :annot-width-slider="annotWidthSlider"
            :annot-width-min="ANNOT_WIDTH_MIN"
            :annot-width-max="ANNOT_WIDTH_MAX"
            :history-index="historyIndex"
            :history="history"
            :can-undo="canUndo"
            :can-redo="canRedo"
            @close="closeAnnotation"
            @toggle-tool="toggleTool"
            @set-annot-color="annotColor = $event"
            @update:annot-width="annotWidthSlider = $event"
            @undo="undoAnnot"
            @redo="redoAnnot"
            @clear-annotations="clearAll"
            @toggle-annotations="annotVisible = !annotVisible"
          />
        </div>
        </div>
      </PlaybackMobileOverlay>

      <!-- §square-stage 手机竖屏纵向流：传输控件之后是详情（inline）与 Team 1 / Team 2。
           竖屏利用的是**纵向**空间，所以这一段就是普通流内容，跟着页面滚，不设高度上限。
           详情与名册各自独立：名册关掉时详情照样可以开着，反之亦然。 -->
      <div v-if="inlineStack && (detailsState || showRosterPresentation)" class="pb-inline-area" data-test="pb-inline-area">
        <!-- 竖屏的详情：同一个组件、同一份 props，只是换成流内呈现（没有拖动柄）。 -->
        <VehicleDetailsPanel
          v-if="detailsState"
          presentation="inline"
          :phone-form="isMobileDevice"
          :selected-state="detailsState"
          :selected-portrait-url="selectedPortraitUrl"
          :sel-last-known-sec="selLastKnownSec"
          :sel-cur-stats="selCurStats"
          :selected-track="selectedTrack"
          :current-time="currentTime"
          :sel-damage-log="selDamageLog"
          :format-clock="formatClock"
          @close="closeSidebar"
        />
        <PlaybackRoster
          v-if="showRosterPresentation"
          :teams="teamVehicles"
          :destroyed="destroyedNow"
          :health="rosterHealth"
          :selected-id="selectedAccountId"
          @select="selectFromRoster"
        />
      </div>

      <!-- 手机名册没有「打开名册」这种独立开关：竖屏在上面的纵向流里，横屏 / 全屏横屏在
           Team 1 | Stage | Team 2 两侧车道里；唯一的呈现偏好是 uiPrefs.showRoster。 -->

      <div v-if="visibleFeed.length" class="pb-kill-feed" data-test="pb-kill-feed" aria-hidden="true">
        <div v-for="feed in visibleFeed" :key="'feed-' + feed.id" class="pb-feed-item" :class="feed.victimFriendly === true ? 'pb-feed-friendly' : (feed.victimFriendly === false ? 'pb-feed-enemy' : 'pb-feed-neutral')"><span class="pb-feed-skull" aria-hidden="true">☠</span><span class="pb-feed-victim">{{ feed.victimPlayerName ? feed.victimPlayerName + '（' + feed.victimName + '）' : feed.victimName }}</span><span class="pb-feed-destroyed">{{ $t('recon.map.playback.feed_destroyed') }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pb-wheel-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 30;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-scrim);
  color: var(--color-text-primary);
  font: var(--type-body);
  pointer-events: none;
  transform: translate(-50%, -50%);
}
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; }
.pb-viewport {
  position: relative;
  width: 100%;
  transform-origin: 0 0;
  touch-action: none;
}
.pb-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* Vehicle-aware sizing supplies the production width/height inline. These are
   only safe defaults for isolated component rendering without a projected model. */
.pb-vehicle {
  position: absolute;
  width: 30px;
  height: 30px;
  transform: translate(-50%, -50%);
  border: none;
  background: none;
  padding: 0;
  /* The button itself does not intercept the map; only .pb-hitbox is clickable. */
  pointer-events: none;
}
@media (width < 768px) {
  .pb-vehicle { width: 25px; height: 25px; }
}
/* marker 内部样式（hull/turret/death/name/状态视觉）全部随 VehicleMarker 组件迁移：
   PR3 —— last-known/destroyed 弱化由 VehicleMarker .pb-graphics 容器承担（root 不再
   opacity，否则 ✕/label 也会被淡掉）；Selected 红色倒三角、Recorder 空心菱形、
   team outline/glow（friendly green|blue / enemy red，CSS vars 由根元素提供）。 */
.pb-cell { stroke: var(--map-grid-stroke, rgba(255,255,255,.55)); stroke-width: 1; fill: none; }
/* 激光炮线：外层光晕/内芯线宽逐元素绑定（6/view.scale、1.75/view.scale），不随缩放变粗 */
.pb-tracer, .pb-tracer-core { stroke-linecap: round; }
.pb-region-line { fill: none; stroke: var(--map-region-stroke, rgba(255,255,255,.28)); stroke-width: 1; }
.pb-spawn-friendly { fill: var(--map-spawn-friendly, #8ef7b0); }
.pb-spawn-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }

/* PR5 §10/§12/§16 transient feedback 层（floating damage / destruction burst / kill feed）：
   wall-clock 生命周期、任意倍速可读时长一致；seek 清空、pause 自然完成。 */
.pb-feedback-layer { position: absolute; inset: 0; pointer-events: none; z-index: 9; overflow: hidden; }
.pb-float-dmg {
  position: absolute;
  transform: translate(-50%, -50%);
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 3px rgba(0, 0, 0, .9), 0 1px 2px rgba(0, 0, 0, .8);
  animation: pb-float-rise 1s ease-out forwards;
  white-space: nowrap;
}
.pb-float-friendly { color: var(--pb-team-text, #4ade80); }
.pb-float-enemy { color: var(--pb-enemy-text, #f87171); }
@keyframes pb-float-rise {
  0% { opacity: 1; margin-top: 0; }
  70% { opacity: 1; }
  100% { opacity: 0; margin-top: -10px; }
}
.pb-burst {
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid currentColor;
  animation: pb-burst-ring .7s ease-out forwards;
  pointer-events: none;
}
.pb-burst.pb-float-friendly { color: var(--pb-team-text, #4ade80); }
.pb-burst.pb-float-enemy { color: var(--pb-enemy-text, #f87171); }
@keyframes pb-burst-ring {
  0% { opacity: .9; transform: translate(-50%, -50%) scale(.3); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); }
}
.pb-kill-feed {
  position: absolute;
  top: calc(max(8px, env(safe-area-inset-top)) + 50px);
  left: 0;
  right: var(--pb-details-w, 0);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 45;
  pointer-events: none;
}
.pb-feed-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
  background: color-mix(in srgb, var(--bg) 84%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 22%, transparent);
  border-radius: 10px;
  padding: 8px 16px;
  box-shadow: 0 4px 14px rgba(0,0,0,.4);
  animation: pb-feed-in .3s ease-out;
}
.pb-feed-skull { color: var(--text); font-size: 1.1em; }
.pb-feed-friendly .pb-feed-victim { color: var(--pb-team-text, #4ade80); }
.pb-feed-enemy .pb-feed-victim { color: var(--pb-enemy-text, #f87171); }
.pb-feed-neutral .pb-feed-victim { color: var(--text-muted, #999); }
.pb-feed-destroyed { color: var(--text-muted, #999); font-weight: 600; }
@keyframes pb-feed-in {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-float-dmg, .pb-burst, .pb-feed-item { animation: none; }
}
.pb-event-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-ghost);
  max-height: 220px;
  overflow-y: auto;
}
.pb-event-row {
  display: flex;
  gap: 8px;
  border: 0;
  border-bottom: 1px solid var(--border-ghost);
  background: transparent;
  color: var(--text);
  padding: 5px 8px;
  text-align: left;
  cursor: pointer;
  font-size: .78rem;
}
.pb-event-row:last-child { border-bottom: 0; }
.pb-event-row:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.pb-event-time { min-width: 3.2em; font-variant-numeric: tabular-nums; color: var(--text-label); }
.pb-event-type { color: var(--accent); margin-right: 4px; }
.pb-event-empty { margin: 8px; color: var(--text-muted); font-size: .78rem; }

/* 地图标注层 + 文字输入 */
.pb-annotations { pointer-events: none; }
/* 文字描边保证暗图上可读（paint-order 先描边后填充，不遮字） */
.pb-annot-text {
  paint-order: stroke;
  stroke: rgba(0, 0, 0, .65);
  stroke-width: 1;
}
/* 绘制模式下禁用车标按钮（pointer-events none），避免画到坦克上误触选中 */
.pb-drawing { pointer-events: none; }
.pb-text-input {
  position: absolute;
  width: 140px;
  font-size: 13px;
  padding: 2px 6px;
  border: 1px solid var(--accent, #2f7dff);
  border-radius: 3px;
  background: rgba(0, 0, 0, .8);
  color: #fff;
  z-index: 6;
}
</style>
