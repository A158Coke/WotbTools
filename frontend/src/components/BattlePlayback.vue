<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapImages } from '../data/mapImages'
import { teamCssVars } from '../data/mapTeamColors'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'
import { createMapView } from '../utils/mapView'
import VehicleMarker from './VehicleMarker.vue'
import V2VehicleInspector from './V2VehicleInspector.vue'
import enemyHull from '../assets/tank-icons/tank-marker-enemy-hull.png'
import enemyTurret from '../assets/tank-icons/tank-marker-enemy-turret.png'
import friendlyHull from '../assets/tank-icons/tank-marker-friendly-hull.png'
import friendlyTurret from '../assets/tank-icons/tank-marker-friendly-turret.png'
import {
  BURST_MS,
  FLOAT_DMG_MS,
  FLASH_MS,
  GHOST_MS,
  KILL_FEED_MS,
  aggregateEventsBySecond,
  clampViewPan,
  cumulativeStatsAt,
  damageLogAt,
  eventsCrossed,
  formatClock,
  ghostAround,
  hpDisplay,
  interpolateDirection,
  lastKnownPosition,
  positionAt,
  positionCoveredAt,
  pushFeed,
  recorderRelated,
  screenRotation,
  teamHp,
  teamPointsAt,
  teamRelated,
  tracerLines,
  transientsActive,
  turretWorldYawDeg,
  victimFeedbackAllowed,
  zoomViewAt
} from '../utils/battlePlayback'
import {
  positionCoveredAtV2,
  positionAtV2,
  orientationAtV2,
  healthAt,
  lifeAt,
  v2VehicleView,
} from '../utils/battlePlaybackV2'
import {
  MARKER_CORE_PX,
  PLAYER_FADE_MS,
  PLAYER_HIDE_MS,
  PLAYER_SHOW_MS,
  computeLabelLayout,
  resolvePlayerVisibility,
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
 * 战局回放（Battle Playback）：地图鸟瞰第三视图。
 * 复用 mapImages 素材、coordinateBounds 坐标映射、自适应色板与响应式布局；
 * RAF 推进播放时间，仅在同一可信连续点（gap ≤ 5s）之间插值。
 */
const props = defineProps({
  overview: { type: Object, required: true },
  seekTo: { type: Number, default: null },
  /** QA 场景循环播放（PR4 §49：时间线到末尾自动回到 0 继续） */
  loop: { type: Boolean, default: false },
  /** V2 canonical battle-playback-dataset（可选；迁移期守卫：present 时用 V2 检查器）。 */
  playbackV2: { type: Object, default: null }
})

const { t } = useI18n()

const image = computed(() => mapImages[props.overview.mapCode] || null)
const mapView = computed(() => createMapView(image.value, props.overview))

// 自适应配色（与热力/路线视图同一色板）
const palette = ref(darkMapPalette)
watch(image, async (img) => {
  palette.value = paletteForLuminance(await luminanceOfImage(img))
}, { immediate: true })

// V2 canonical dataset 是唯一 playback 事实源（cleanup：移除 legacy overview.playback）。
const playback = computed(() => props.playbackV2 || null)
/** V2 canonical tracks 按账号索引（迁移期守卫：present 时 marker/HUD 用 V2 事实源）。 */
const v2TrackByAccount = computed(() => {
  const tracks = props.playbackV2?.vehicles || []
  const m = new Map()
  for (const tr of tracks) m.set(tr.accountId, tr)
  return m
})
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => props.overview.friendlyTeam)

// ---- PR2：Tier X dedicated model preload----
// runtime.js 含全部车型资产引用（import.meta.glob），必须动态 import 保持主 bundle 分离
// （scripts/check-bundle-separation.mjs 门禁：主入口不得含 'vehicle-models/assets'）。
// preload 完成前不渲染车辆（asset decision 先于渲染，禁止 generic 闪现后替换）。
const preload = ref({ phase: 'idle', resolved: new Map(), failed: new Set(), byTank: new Map() })
// 竞态令牌：快速切换战局时，过期 preload 完成不得覆盖新战局结果
let preloadToken = 0
watch(
  () => [props.overview, props.playbackV2],
  async () => {
    const token = ++preloadToken
    preload.value = { phase: 'loading', resolved: new Map(), failed: new Set(), byTank: new Map() }
    const vehicles = props.playbackV2?.vehicles || []
    if (vehicles.length === 0) {
      preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), byTank: new Map() }
      return
    }
    try {
      const { preloadBattleModels } = await import('../vehicle-models/runtime.js')
      const result = await preloadBattleModels(vehicles.map((v) => v.tankId))
      if (token !== preloadToken) return // 过期结果丢弃
      preload.value = { phase: 'ready', ...result }
    } catch (e) {
      // 模块加载异常 → 整场 generic fallback（静默，不弹 warning）
      console.error('[vehicle-models] preload 模块加载失败 → 整场 generic fallback', e)
      if (token !== preloadToken) return
      preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), byTank: new Map() }
    }
  },
  { immediate: true },
)

// 双方总血量（实时剩余，随播放时间/进度条变化；争霸赛附终局点数）
// 本方：开局相对满血展示判定（存活 + 当前时间之前无权威 hpLoss + 无 destroyed 证据）→
// FULL_RELATIVE 100% 阵营色实心条（即使部分车辆已有 current sample、但全队 entry/max 尚未
// 全部证明，开局也不显示斜纹；不伪造具体数字）；敌方：无可信采样恒 UNKNOWN 灰段
// （不把 tankopedia base 当已知血量）
// V2 为主：playbackV2 present 时，teamHp 聚合 canonical healthTransitions + displayCapacityHp；
// legacy 仅当无 V2 时才进入 HP 状态机推理。
const hpVehicles = computed(() => {
  if (props.playbackV2?.vehicles?.length) {
    return props.playbackV2.vehicles.map(t => ({ team: t.team, healthTransitions: t.healthTransitions || [] }))
  }
  return playback.value?.vehicles || []
})
const friendlyHp = computed(() => teamHp(hpVehicles.value, friendlyTeam.value, currentTime.value, true))
const enemyHp = computed(() => teamHp(hpVehicles.value, friendlyTeam.value === 1 ? 2 : 1, currentTime.value, false))
// 争霸赛实时点数：来自回放广播 pointsSamples（随 currentTime 变化）；非争霸赛/无广播 → null 不显示
const friendlyPoints = computed(() =>
  teamPointsAt(playback.value?.pointsSamples, friendlyTeam.value, currentTime.value))
const enemyPoints = computed(() =>
  teamPointsAt(playback.value?.pointsSamples, friendlyTeam.value === 1 ? 2 : 1, currentTime.value))
const showPoints = computed(() => friendlyPoints.value != null || enemyPoints.value != null)
/**
 * HP bar 填充宽度（PR #107 Blocker 2 aggregate state）：
 * - FULL_RELATIVE（本方开局相对满血：全部存活车辆无权威掉血/阵亡证据，即使有 current sample
 *   也 100% 实心条）→ known 段固定 100% 阵营色实心条（相对状态，无具体数字、无斜纹）；
 * - EXACT（全队 entryHp 均已证明且证据一致）→ known = knownRemaining/totalMax、
 *   unknown = unknownMax/totalMax（灰段参考）；
 * - PARTIAL/MIXED（部分证明/混合 provenance/证据矛盾：有真实已知剩余但无「全队已证明且一致的分母」）→
 *   known 段 100% + indeterminate 斜纹（无法算真实比例，绝不显示 known/partialTotalMax 分数）；
 * - UNKNOWN → 0%（灰段也不渲染——无任何数据）。
 * 禁止出现「totalMax=0、knownRemaining>0 却仍 0%」的空条。
 */
function hpBarFill(hp, kind) {
  if (hp.state === 'FULL_RELATIVE') return kind === 'known' ? '100%' : '0%'
  const total = hp.totalMax || 0
  if (total <= 0) {
    if (kind === 'known') return hp.state === 'PARTIAL' ? '100%' : '0%'
    return '0%'
  }
  const val = kind === 'known' ? hp.knownRemaining : hp.unknownMax
  return `${Math.max(0, Math.min(100, (val / total) * 100)).toFixed(1)}%`
}

/**
 * HP 数值区显示文本（绝不显示虚假的 knownRemaining / totalMax 分数）：
 * - FULL_RELATIVE → 「100%」（开局相对满血状态，非具体 HP 数字）；
 * - UNKNOWN → —（无任何数据）；
 * - EXACT（全队 entryHp 均已证明且证据一致）→ 「knownRemaining / totalMax」（真实已证明总数）；
 * - PARTIAL/MIXED（部分证明/混合 provenance/证据矛盾）→ 只显示真实已知剩余数字（不伪造分母——
 *   totalMax 已被 teamHp 归零，绝不显示 knownRemaining / partialTotalMax）。
 */
function hpValueText(hp) {
  if (hp.state === 'FULL_RELATIVE') return '100%'
  if (hp.state === 'UNKNOWN') return '—'
  if (hp.state === 'EXACT') return `${hp.knownRemaining} / ${hp.totalMax}`
  return String(hp.knownRemaining)
}

// ---- 播放状态 ----
const currentTime = ref(0)
const playing = ref(false)
const speed = ref(1)
// PR4 §33：hysteresis 时间基准 = UI wall clock（performance.now）。
// 播放时由 frame() 每帧刷新；暂停时由 ensureHysteresisClock 的轻量 RAF 继续推进
//（仅当存在未决 transition），不依赖 replay 播放状态；replay currentTime 不是 collision 时钟。
const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)

// ---- PR4 §26：玩家/坦克名显示偏好（默认 showPlayerName=false / showTankName=true，localStorage 持久化）----
const LABEL_PREFS_KEY = 'wotb.pb.label-prefs'
function loadLabelPrefs() {
  try {
    const raw = localStorage.getItem(LABEL_PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        showPlayerName: p.showPlayerName === true,
        showTankName: p.showTankName !== false,
      }
    }
  } catch {
    // 损坏/不可用 → 默认值
  }
  return { showPlayerName: false, showTankName: true }
}
const labelPrefs = reactive(loadLabelPrefs())
watch(labelPrefs, (p) => {
  try {
    localStorage.setItem(LABEL_PREFS_KEY, JSON.stringify(p))
  } catch {
    // 隐私模式/配额满：静默（本次会话内仍生效）
  }
}, { deep: true })

// ---- PR5（docs/features/battle-playback.md HP HUD 开关）：单车 HP HUD 显示开关（默认开启，localStorage 持久化）。
// 关闭后隐藏地图 HP 数字/bar/ghost；floating damage / destroyed ✕ / sidebar HP / combat state /
// kill feed / timeline 正确性均不受影响；重新开启立即按当前 timestamp 显示正确 HP（纯派生，不重头累计）。
const HP_PREFS_KEY = 'wotb.pb.hp-prefs'
function loadHpPrefs() {
  try {
    const raw = localStorage.getItem(HP_PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return { showHp: p.showHp !== false }
    }
  } catch {
    // 损坏/不可用 → 默认开启
  }
  return { showHp: true }
}
const hpPrefs = reactive(loadHpPrefs())
watch(hpPrefs, (p) => {
  try {
    localStorage.setItem(HP_PREFS_KEY, JSON.stringify(p))
  } catch {
    // 隐私模式/配额满：静默（本次会话内仍生效）
  }
}, { deep: true })

// ---- PR5（§1.3/§10/§16/§20）：deterministic state 与 transient feedback 分层。
// transient 全部 wall-clock（performance.now）驱动，播放帧推进时消费新跨过的事件，
// seek 清空（§20.1 不补播）、pause 自然完成（§20.2）、resume 不重复已消费事件（§20.3，
// eventCursor 严格左开：恰在 cursor 上的事件不重复触发）。
// Blocker 1：consumption 源 = authoritativeEvents（原始 playback events），
// 不受事件列表 UI 过滤（typeFilter/showAll/recorder/team scope）影响。
let transientSeq = 0
const eventCursor = ref(0)
const floatItems = ref([]) // [{ id, victimAccountId, damage, bornRealMs, durationMs }]
const burstItems = ref([]) // [{ id, victimAccountId, bornRealMs, durationMs }]
const feedItems = ref([]) // [{ id, victimAccountId, victimName, victimTeam, bornRealMs, durationMs }]
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
  ghostByAccount.clear()
  flashByAccount.clear()
}

/** 播放时钟跨过 (fromSec, toSec] 的新事件 → 生成 transient feedback（§10/§12/§16）。 */
function consumeEvents(fromSec, toSec) {
  // Blocker 1：combat feedback 消费 authoritative playback events（不依赖事件列表 UI 过滤——
  // 「战斗事实有没有发生」不取决于 DAMAGE/KILL checkbox 是否显示）。
  // 左界 = max(fromSec, eventCursor)（严格左开 cursor：seek/回绕把 cursor 重置到新时间点后，
  // prev 滞后不会把旧时间点事件重复消费——Blocker 2 loop 下一轮不重复上一轮末尾事件）。
  const crossed = eventsCrossed(authoritativeEvents.value, Math.max(fromSec, eventCursor.value), toSec)
  if (crossed.length === 0) {
    eventCursor.value = Math.max(eventCursor.value, toSec)
    return
  }
  const now = realNowMs()
  const states = vehicleStates.value
  const stateByAccount = new Map(states.map(s => [s.vehicle.accountId, s]))
  for (const ev of crossed) {
    if (ev.type === 'DAMAGE') {
      const victim = vehiclesByAccount.value.get(ev.targetAccountId)
      // §7.2/§10.1：只有事件时刻位置流覆盖（当前可见/可展示）才跳伤害——
      // 失察期间受击不跳伤害、不更新 HP、不显示 attacker、不画炮线（HP 冻结为最后可信值）
      if (!victim || !victimFeedbackAllowed(victim, ev.timeSec)) continue
      if (!stateByAccount.has(ev.targetAccountId)) continue // 无 marker 锚点不显示
      // §11/§12：浮伤害只显示可证明的权威掉血（observedHpLoss，Type-7 推导）；
      // raw Type-8 协议值语义未证明，不得作为精确伤害飘字
      if (ev.observedHpLoss == null) continue
      // ref 数组必须整体替换才能触发 reactivity（in-place push 不触发）
      floatItems.value = [...floatItems.value, {
        id: ++transientSeq,
        victimAccountId: ev.targetAccountId,
        hpLoss: ev.observedHpLoss,
        bornRealMs: now,
        durationMs: FLOAT_DMG_MS,
      }]
      // §10.3/§11：HP 数字立即切换（确定性），bar 快速缩短（CSS transition），
      // hit flash + lost-HP ghost（同阵营色浅版，§11 连续受击重置消退计时）
      const friendly = victim.team === friendlyTeam.value
      const g = ghostAround(victim, ev.timeSec, { friendly })
      if (g) ghostByAccount.set(ev.targetAccountId, { prevPct: g.prevPct, nextPct: g.nextPct, untilRealMs: now + GHOST_MS })
      flashByAccount.set(ev.targetAccountId, now + FLASH_MS)
    } else if (ev.type === 'DESTROYED') {
      // §12：击毁 burst（轻量 2D，克制；仅受击方位置流覆盖时锚定）
      const victim = vehiclesByAccount.value.get(ev.accountId)
      if (!victim || !victimFeedbackAllowed(victim, ev.timeSec)) continue
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
        victimName: victim.tankName || String(victim.tankId),
        victimTeam: victim.team,
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
  if (transientsActive(feedItems.value, now).length) return true
  for (const g of ghostByAccount.values()) if (g.untilRealMs > now) return true
  for (const u of flashByAccount.values()) if (u > now) return true
  return false
}

/** 过期 transient 清理（由 nowMs/currentTime 变化驱动，Map 不无限增长）。 */
function pruneTransients(now) {
  for (const [id, g] of ghostByAccount) if (g.untilRealMs <= now) ghostByAccount.delete(id)
  for (const [id, u] of flashByAccount) if (u <= now) flashByAccount.delete(id)
}

// ---- 单车 HP HUD 数据（§4/§5/§6/§7）----
function hpFor(vehicle) {
  const v2 = v2TrackByAccount.value?.get(vehicle.accountId)
  if (v2) {
    return hpDisplay(
      { ...vehicle, healthTransitions: v2.healthTransitions || [], lifeTransitions: v2.lifeTransitions || [] },
      currentTime.value,
      { friendly: vehicle.team === friendlyTeam.value },
    )
  }
  return hpDisplay(vehicle, currentTime.value, { friendly: vehicle.team === friendlyTeam.value })
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
      out.push({ ...item, x: p.x, y: p.y - 34 - idx * 16, team: st.vehicle.team })
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
    return { ...item, x: p.x, y: p.y, team: st.vehicle.team }
  }).filter(Boolean)
})
const visibleFeed = computed(() => transientsActive(feedItems.value, nowMs.value))
const showAll = ref(false)
const typeFilter = ref(new Set(['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']))
const selectedAccountId = ref(null)
const eventPopupSec = ref(null)
let rafId = null
let lastFrameTs = null

// PR4 §33 hysteresis 状态（声明提前：seekTo watch immediate 可能在 setup 早期触发 pause →
// ensureHysteresisClock/hasPendingHysteresis 必须能访问；ref/Map/let 需先初始化，避免 TDZ）
const playerVisState = ref(new Map())
const playerHidden = ref(new Set())
// fade-in 生命周期：accountId → fade 结束时刻（performance.now 基准）。
// 非响应式 Map，由 nowMs 变化驱动重渲染；恢复帧开始计时 PLAYER_FADE_MS，
// 期间不被下一次 collision resolve 取消（CSS animation 0.12s 与之一致）。
const fadeUntil = new Map()
let hystRafId = null

// ---- 地图视图缩放/平移：单一 transform 层保证地图/网格/炮线/标记严格对齐 ----
const mapEl = ref(null)
// ---- 地图容器真实渲染尺寸（reactive）：fullscreen enter/exit / 窗口缩放等任何尺寸变化
// 由 ResizeObserver 更新 → 依赖容器尺寸的 screen-space 布局（markerScreen/labelLayout/
// hitbox/textInput）在新尺寸下重新计算；无 RO 环境（测试/旧浏览器）回退 clientWidth 读取。
const mapSize = ref({ w: 0, h: 0 })
let mapResizeObserver = null
function mapWidth() {
  return mapSize.value.w || (mapEl.value ? mapEl.value.clientWidth : 0)
}
function mapHeight() {
  return mapSize.value.h || (mapEl.value ? mapEl.value.clientHeight : 0)
}

// ---- Fullscreen：原生 Fullscreen API；document.fullscreenElement + fullscreenchange 为事实源
//（不维护手工 isFullscreen = !isFullscreen，ESC/浏览器 UI 退出后状态自动同步）----
const pbRoot = ref(null)
const isFullscreen = ref(false)
const fullscreenSupported = computed(() =>
  typeof document !== 'undefined'
  && pbRoot.value != null
  && typeof pbRoot.value.requestFullscreen === 'function'
)
function onFullscreenChange() {
  isFullscreen.value = !!(typeof document !== 'undefined' && document.fullscreenElement)
}
function toggleFullscreen() {
  if (typeof document === 'undefined' || !pbRoot.value) return
  if (document.fullscreenElement) {
    if (typeof document.exitFullscreen === 'function') {
      const p = document.exitFullscreen()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  } else if (typeof pbRoot.value.requestFullscreen === 'function') {
    const p = pbRoot.value.requestFullscreen()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
}

// 地图容器尺寸观察：fullscreen enter/exit / 窗口缩放 → ResizeObserver 更新 mapSize
//（reactive）→ markerScreen/labelLayout/selectAt/textInput 以新尺寸重算；不依赖 magic delay。
watch(() => mapEl.value, (el) => {
  if (!el || mapResizeObserver) return
  if (typeof ResizeObserver === 'function') {
    mapResizeObserver = new ResizeObserver((entries) => {
      const e = entries && entries[0]
      if (e && e.contentRect) {
        mapSize.value = { w: e.contentRect.width, h: e.contentRect.height }
      }
    })
    mapResizeObserver.observe(el)
  }
})

const view = reactive({ scale: 1, tx: 0, ty: 0 })
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

function applyView(next) {
  const clamped = clampViewPan(
    next,
    mapWidth(),
    mapHeight()
  )
  view.scale = clamped.scale
  view.tx = clamped.tx
  view.ty = clamped.ty
}

const viewportStyle = computed(() => `transform: translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`)

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

function onWheel(e) {
  const p = screenPoint(e.clientX, e.clientY)
  applyView(zoomViewAt(view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
}

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}

function onPointerDown(e) {
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
        pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist
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
  }
}

function resetView() {
  applyView({ scale: 1, tx: 0, ty: 0 })
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
const textInputRef = ref(null)
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
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFullscreenChange)
  }
})

function frame(ts) {
  if (!playing.value) {
    rafId = null
    return
  }
  const delta = lastFrameTs == null ? 0 : (ts - lastFrameTs)
  lastFrameTs = ts
  const prev = currentTime.value
  const next = Math.min(duration.value, prev + (delta / 1000) * speed.value)
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
    // 播放到末尾自然停止 → 若有未决 transition，轻量 clock 接管
    ensureHysteresisClock(realNowMs())
    return
  }
  rafId = requestAnimationFrame(frame)
}

/** 幂等启动：任意时刻最多一个 RAF 循环（重复调用/重复事件不会创建第二个循环）。 */
function play() {
  if (playing.value || duration.value <= 0) return
  playing.value = true
  lastFrameTs = null
  // 播放开始：hysteresis 时钟由 playback frame() 驱动——作废可能残留的轻量 hystRAF
  //（stub 环境只保留最近回调，若不清理，pause() 的 ensureHysteresisClock 会误判"已有 RAF"
  //  而无法注册接管时钟；真实浏览器中残留回调至多无害地刷新一次 nowMs）
  hystRafId = null
  rafId = requestAnimationFrame(frame)
}

/** 幂等暂停：取消未完成的 RAF，绝不残留回调推进时间。 */
function pause() {
  playing.value = false
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  // Blocker 1：播放中可能有未决 hide/show/fade transition——暂停后立即让轻量
  // hysteresis clock（UI wall clock）接管；无 pending 时不启动 RAF（不永久轮询）。
  ensureHysteresisClock(typeof performance !== 'undefined' ? performance.now() : Date.now())
}

watch(() => props.seekTo, (sec) => {
  if (Number.isFinite(sec)) {
    pause() // 点击 AI 时间 → seek + 自动暂停（含取消 RAF）
    currentTime.value = Math.min(duration.value, Math.max(0, sec))
    eventPopupSec.value = Math.round(sec)
    resetTransients(currentTime.value)
    suppressHpTransition()
  }
}, { immediate: true })

function seek(sec) {
  currentTime.value = Math.min(duration.value, Math.max(0, sec))
  eventPopupSec.value = Math.round(sec)
  nowMs.value = realNowMs()
  resetTransients(currentTime.value)
  suppressHpTransition()
}

/** seek 后单帧禁用 HP bar transition（§20.1：只恢复状态，不补 150–300ms 缩短动画）。
 * 用 setTimeout 而非 requestAnimationFrame 清旗标：不占用共享 RAF 槽位（播放/hysteresis
 * 时钟仍由 rafCb 驱动，测试中 seek 后 rafCb 必须仍指向时钟回调）。 */
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

/** 拖动进度条：按下即暂停，拖动中实时 seek，松开后保持暂停（不恢复拖动前状态）。 */
function dragStart() {
  pause()
}

/** 事件标记点击：跳转并保持暂停。 */
function jumpTo(sec) {
  pause()
  seek(sec)
}

function step(delta) {
  currentTime.value = Math.min(duration.value, Math.max(0, currentTime.value + delta))
  resetTransients(currentTime.value)
  suppressHpTransition()
}

function toggleSpeed() {
  // PR4 §49：QA 场景需要 0.5×——倍速循环 0.5 → 1 → 2 → 4 → 0.5
  speed.value = speed.value === 0.5 ? 1 : (speed.value === 1 ? 2 : (speed.value === 2 ? 4 : 0.5))
}

function toggleType(type) {
  const next = new Set(typeFilter.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  typeFilter.value = next
}

onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId)
  if (hystRafId != null) cancelAnimationFrame(hystRafId)
  if (mapResizeObserver) {
    mapResizeObserver.disconnect()
    mapResizeObserver = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    // 组件在 fullscreen 中被卸载 → 主动退出（浏览器通常会自动退出，这里兜底）
    if (pbRoot.value && pbRoot.value === document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      document.exitFullscreen()
    }
  }
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
  for (const route of props.overview.routes || []) map.set(route.accountId, route)
  return map
})

const vehiclesByAccount = computed(() => {
  const map = new Map()
  for (const vehicle of (playback.value ? playback.value.vehicles : [])) {
    // V2 canonical vehicle view（带 hpLosses/deathSec 供累计统计/伤害日志/teamRelated）
    map.set(vehicle.accountId, v2VehicleView(vehicle))
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
  const list = vehicle.team === friendlyTeam.value ? friendlyColors.value : enemyColors.value
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
 * 非 Tier X / preload 失败 / 模块加载失败 → null（generic marker 单车 fallback，
 *不做整场 fallback）。
 */
function vehicleModel(vehicle) {
  const p = preload.value
  if (p.phase !== 'ready') return null
  const modelKey = p.byTank.get(String(vehicle.tankId))
  if (!modelKey || p.failed.has(modelKey)) return null
  return p.resolved.get(modelKey) || null
}

/** PR4 §36 hull hitbox 比例（相对 marker 盒，随 marker 缩放；视觉车体 + 小 padding）。 */
const HULL_HITBOX = Object.freeze({
  dedicated: Object.freeze({ w: 0.9, h: 0.9 }),
  generic: Object.freeze({ w: 0.58, h: 0.9 }),
})

function vehicleState(vehicle) {
  const v2Track = v2TrackByAccount.value?.get(vehicle.accountId) || null
  if (v2Track) {
    return vehicleStateV2(vehicle, v2Track)
  }
  const route = routesByAccount.value.get(vehicle.accountId)
  const points = route ? route.points : []
  // 局部时间变量命名 time——避免遮蔽 setup 的 i18n t()（ariaLabel 需要）
  const time = currentTime.value
  const destroyed = vehicle.deathSec != null && time >= vehicle.deathSec
  const displayT = destroyed ? Math.min(time, vehicle.deathSec) : time
  const live = positionAt(points, displayT)
  const last = live ? live : lastKnownPosition(points, displayT)
  if (!last) return null // 从未有可信位置：不显示
  const covered = positionCoveredAt(vehicle.positionIntervals, time)
  const recorder = vehicle.accountId === props.overview.recorderAccountId
  const direction = interpolateDirection(vehicle.directionSamples, displayT)
  const friendly = vehicle.team === friendlyTeam.value
  // 阵亡：恒渲染 hull+turret 双层（方向冻结在最后可信样本；无样本以素材默认 0° 渲染，不代表真实朝向）；
  // 未阵亡：无可靠方向样本时不渲染车体（不伪造朝向），行为保持不变。
  const hullDeg = direction ? screenRotation(direction.hullYawDeg) : null
  const turretDeg = direction
    ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
    : null
  return {
    vehicle,
    pos: last,
    covered,
    destroyed,
    destroyedKnownAtSec: life && life.lifeState === 'DESTROYED' ? life.destroyedKnownAtSec : null,
    recorder,
    friendly,
    direction,
    // dedicated model（null = generic；turretless 无 turret 层，§14）
    model: vehicleModel(vehicle),
    hullImage: friendly ? friendlyHull : enemyHull,
    turretImage: friendly ? friendlyTurret : enemyTurret,
    hullScreenDeg: destroyed ? (hullDeg == null ? 0 : hullDeg) : hullDeg,
    turretScreenDeg: destroyed ? (turretDeg == null ? 0 : turretDeg) : turretDeg,
    // VehicleMarker 渲染用（位置/反缩放/无障碍标签在 view model 一次性算好）
    markerStyle: { left: markerLeft(last.x), top: markerTop(last.y), transform: markerTransform.value },
    overlayInverseScale: overlayInverseScale.value,
    overlayInverse: overlayInverse.value, // 数值反缩放（VehicleMarker 用它反缩放 layout offset）
    // PR4 §26：标签数据（playerName 可为空串；tankName 权威显示名回退 tankId）
    playerName: vehicle.playerName || '',
    tankName: vehicle.tankName || String(vehicle.tankId),
    // PR4 §36：hull hitbox 占 marker 盒比例（随 marker 一起缩放；dedicated 车体≈88% 视觉、
    // generic 车体 55%×88%；+小 padding 容错）。用于点击命中判定。
    hitbox: vehicleModel(vehicle) ? HULL_HITBOX.dedicated : HULL_HITBOX.generic,
    ariaLabel: `${vehicle.playerName}: ${t(destroyed ? 'recon.map.playback.state_destroyed' : (covered ? 'recon.map.playback.state_position_reported' : 'recon.map.playback.state_position_stale'))}`,
    // lastKnown = 位置流未覆盖（covered=false）才淡化（最后已知位置）。
    // 注意：covered 只是「服务器位置流当前覆盖」，不等于录像者客户端点亮/失察（无 authoritative
    // spotting signal，不得声称已恢复点亮）；route 采样点稀疏（长局采样间隔 max(2, duration/200)
    // 可 >5s）导致 live=null 不代表位置中断，不得借 !live 误判淡化。destroyed 是独立视觉状态，
    // 阵亡车信息栏同样显示最后可信时间，但视觉 class 不再套用 pb-last-known
    lastKnown: !covered
  }
}

/** V2 车辆状态：只消费 canonical V2 track（positionSegments/orientationSegments/healthTransitions/
 * lifeTransitions），前端不再做 HP/AoI/death 推理。 */
function vehicleStateV2(vehicle, track) {
  const time = currentTime.value
  const life = lifeAt(track, time)
  const destroyed = life != null && life.lifeState === 'DESTROYED'
  const last = positionAtV2(track.positionSegments, time)
  if (!last) return null
  const covered = positionCoveredAtV2(track.positionSegments, time)
  const recorder = vehicle.accountId === props.overview.recorderAccountId
  const direction = orientationAtV2(track.orientationSegments, time)
  const friendly = vehicle.team === friendlyTeam.value
  const hullDeg = direction ? screenRotation(direction.hullYawDeg) : null
  const turretDeg = direction
    ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
    : null
  return {
    vehicle,
    pos: last,
    covered,
    destroyed,
    recorder,
    friendly,
    direction,
    model: vehicleModel(vehicle),
    hullImage: friendly ? friendlyHull : enemyHull,
    turretImage: friendly ? friendlyTurret : enemyTurret,
    hullScreenDeg: destroyed ? (hullDeg == null ? 0 : hullDeg) : hullDeg,
    turretScreenDeg: destroyed ? (turretDeg == null ? 0 : turretDeg) : turretDeg,
    markerStyle: { left: markerLeft(last.x), top: markerTop(last.y), transform: markerTransform.value },
    overlayInverseScale: overlayInverseScale.value,
    overlayInverse: overlayInverse.value,
    playerName: vehicle.playerName || '',
    tankName: vehicle.tankName || String(vehicle.tankId),
    hitbox: vehicleModel(vehicle) ? HULL_HITBOX.dedicated : HULL_HITBOX.generic,
    ariaLabel: `${vehicle.playerName}: ${t(destroyed ? 'recon.map.playback.state_destroyed' : (covered ? 'recon.map.playback.state_position_reported' : 'recon.map.playback.state_position_stale'))}`,
    lastKnown: !covered,
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

const vehicleStates = computed(() => {
  // preload 未完成（asset decision 未定）时不渲染车辆——禁止 generic 闪现后替换
  if (preload.value.phase !== 'ready') return []
  // V2 为主：playbackV2 present 时以 V2 track 为事实源；legacy vehicle 仅提供
  // identity/model/portrait（tankId/tankName/team），不参与 HP/AoI/death 推理。
  if (props.playbackV2?.vehicles?.length) {
    const legacyById = new Map((playback.value?.vehicles || []).map(v => [v.accountId, v]))
    return props.playbackV2.vehicles
      .map(track => {
        const legacy = legacyById.get(track.accountId) || v2LegacyVehicle(track)
        return vehicleStateV2(legacy, track)
      })
      .filter(Boolean)
  }
  const vehicles = playback.value ? playback.value.vehicles : []
  return vehicles.map(vehicleState).filter(Boolean)
})

/** 无 legacy 对应时，用 V2 track 构造最小 identity vehicle（供 model/portrait/team）。 */
function v2LegacyVehicle(track) {
  return {
    accountId: track.accountId,
    playerName: track.playerName || '',
    tankId: track.tankId,
    tankName: track.tankName || '',
    team: track.team,
    tankType: track.tankClass || '',
  }
}

const filteredEvents = computed(() => {
  const events = (playback.value ? playback.value.events : [])
    .filter(event => typeFilter.value.has(event.type))
  if (showAll.value) return events
  const recorderId = props.overview.recorderAccountId
  if (props.overview.arenaBonusType === 1 && recorderId != null) {
    return events.filter(event => recorderRelated(event, recorderId))
  }
  if (props.overview.arenaBonusType !== 1) {
    return events.filter(event => teamRelated(event, friendlyTeam.value, vehiclesByAccount.value))
  }
  return events
})

/**
 * authoritative playback events：全部回放事件（无 typeFilter / showAll / recorder / team scope 过滤）。
 * deterministic state（当前累计伤害/击杀）与 combat feedback（floating damage / hit flash / ghost /
 * destruction burst / kill feed / damage log）必须消费本源——「战斗事实有没有发生」不取决于事件列表
 * UI 是否显示（review Blocker 1）。presentation 过滤（filteredEvents）只用于 timeline markers /
 * popup / prev-next 事件跳转 / 受 filter 控制的 visual overlay（炮线）。
 */
const authoritativeEvents = computed(() => (playback.value ? playback.value.events : []))

const eventMarkers = computed(() => aggregateEventsBySecond(filteredEvents.value))

// 炮线：仅来自过滤后事件流中的已知射击（DAMAGE/KILL），两端可信位置，随播放时间与倍速确定性呈现
const visibleTracers = computed(() => tracerLines(filteredEvents.value, routesByAccount.value, currentTime.value, speed.value))

function tracerColor(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? vehicleColor(vehicle) : palette.value.routeOutline
}

function nearestEvent(direction) {
  const events = filteredEvents.value
  if (!events.length) return
  const t = currentTime.value
  let best = null
  for (const event of events) {
    if (direction === 'prev' && event.timeSec < t - 0.1) {
      if (best === null || event.timeSec > best.timeSec) best = event
    } else if (direction === 'next' && event.timeSec > t + 0.1) {
      if (best === null || event.timeSec < best.timeSec) best = event
    }
  }
  if (best) {
    pause() // 上一/下一事件跳转后保持暂停
    currentTime.value = best.timeSec
    eventPopupSec.value = Math.round(best.timeSec)
    resetTransients(currentTime.value)
    suppressHpTransition()
  }
}

const popupEvents = computed(() => {
  if (eventPopupSec.value == null) return []
  return filteredEvents.value.filter(event => Math.round(event.timeSec) === eventPopupSec.value)
})

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
    case 'POSITION_REPORTED':
    case 'POSITION_STALE':
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
function markerScreen(st) {
  const W = mapWidth()
  if (!W || mapView.value.W <= 0) return null
  const H = W * (mapView.value.H / mapView.value.W)
  return {
    x: (mapView.value.toX(st.pos.x) / mapView.value.W) * W * view.scale + view.tx,
    y: (mapView.value.toY(st.pos.y) / mapView.value.H) * H * view.scale + view.ty,
  }
}

function selectAt(accountId, clientX, clientY) {
  const states = vehicleStates.value
  const hasPoint = Number.isFinite(clientX) && mapEl.value && mapWidth() > 0
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  const px = hasPoint ? clientX - rect.left : NaN
  const py = hasPoint ? clientY - rect.top : NaN
  // §36 hitbox 尺寸（content px）：读取实际 marker 盒宽（CSS 36px desktop / 28px mobile，
  // media query 生效于 viewport 变换前 → offsetWidth 即 content px）；测试环境无布局 → 回退 36
  const markerBox = Number(mapEl.value?.querySelector('.pb-vehicle')?.offsetWidth) || 36
  // 命中判定：内容坐标（撤销 viewport 变换）落在 hull hitbox 内
  const hitTest = (s) => {
    const cx = (px - view.tx) / view.scale
    const cy = (py - view.ty) / view.scale
    const W = mapWidth()
    const H = W * (mapView.value.H / mapView.value.W)
    const x = (mapView.value.toX(s.pos.x) / mapView.value.W) * W
    const y = (mapView.value.toY(s.pos.y) / mapView.value.H) * H
    const hw = (markerBox * s.hitbox.w) / 2
    const hh = (markerBox * s.hitbox.h) / 2
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
      if (sel) return
    }
  }
  // PR5 §8.1：点击 marker 恒选中/直接切换（不 toggle-off）；点击空白不关闭；必须 × 显式关闭
  selectedAccountId.value = best.vehicle.accountId
}

const selectedState = computed(() => {
  if (selectedAccountId.value == null) return null
  return vehicleStates.value.find(st => st.vehicle.accountId === selectedAccountId.value) || null
})

// V2 守卫：当 playbackV2 dataset 存在时，定位选中车辆的 V2 track（按 accountId）。
const selectedV2Track = computed(() => {
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

function closeSidebar() {
  selectedAccountId.value = null
}

// ---- PR5 §8：detail sidebar（当前 playback 时间点的车辆战斗状态面板，非整场最终战绩面板）----
const VEHICLE_CLASS_KEYS = {
  'Heavy tank': 'recon.map.playback.vehicle_class_heavy',
  'Medium tank': 'recon.map.playback.vehicle_class_medium',
  'Light tank': 'recon.map.playback.vehicle_class_light',
  'Tank destroyer': 'recon.map.playback.vehicle_class_td',
  'SPG': 'recon.map.playback.vehicle_class_spg',
}
function vehicleTypeLabel(vehicle) {
  // §8：后端已做统一 fallback（replay tankType → tankopedia class → 空串），
  // 前端只做英文 class → 三语映射；全部 metadata 缺失才显示 —
  const key = VEHICLE_CLASS_KEYS[vehicle.tankType]
  return key ? t(key) : (vehicle.tankType || '—')
}

const selHp = computed(() => {
  const st = selectedState.value
  if (!st) return null
  const v2 = v2TrackByAccount.value?.get(st.vehicle.accountId)
  const veh = v2
    ? { ...st.vehicle, healthTransitions: v2.healthTransitions || [], lifeTransitions: v2.lifeTransitions || [] }
    : st.vehicle
  return hpDisplay(veh, currentTime.value, { friendly: st.vehicle.team === friendlyTeam.value })
})
// §6/§41 + PR #107 Blocker 1：Details Panel 当前 HP 按 provenance 显示：
// - DESTROYED → 0（权威阵亡）；
// - RULE_DERIVED_FULL_AT_SPAWN → 「100%」——这是「开局相对满血状态」的 UI 投影，
//   不是具体 HP 数值、也不是从 tankopedia base 推导的百分比（只做 display projection，
//   绝不写入 currentHp 数值字段）；
// - OPENING_RELATIVE_FULL（己方开局有 current sample、max 未证明）→ 真实 current 数字
//   （bar 仍 100% 实心、无斜纹；数字是真实采样，不伪造）；
// - OBSERVED_EXACT / CURRENT_HP_EXACT_MAX_UNKNOWN / INCONSISTENT 且 current 有值 → 真实 current 数字；
// - UNKNOWN → —。
// tankopedia base HP 是车辆静态 metadata，不是本局最大/实际进场 HP，不得包装成「最大 HP」展示。
const selHpText = computed(() => {
  const d = selHp.value
  if (!d) return '—'
  if (d.destroyed) return '0'
  if (d.current != null) return String(d.current)
  return '—'
})
const selHpLabel = computed(() => {
  const st = selectedState.value
  if (!st) return ''
  if (st.destroyed) return 'recon.map.playback.current_hp'
  const d = selHp.value
  if (d && d.state === 'LAST_KNOWN') return 'recon.map.playback.last_known_hp'
  return 'recon.map.playback.current_hp'
})
const selStateLabel = computed(() => {
  const st = selectedState.value
  if (!st) return ''
  if (st.destroyed) return 'recon.map.playback.state_destroyed'
  if (st.lastKnown) return 'recon.map.playback.state_last_known'
  return 'recon.map.playback.state_detected'
})
const selLastKnownSec = computed(() => {
  const st = selectedState.value
  return st && st.lastKnown && Number.isFinite(st.pos.timeSec) ? st.pos.timeSec : null
})
// §16/§17：当前统计 = 权威 HP loss 重建（dealt 仅计可 attribution 的掉血——
// incomplete observation 不冒充完整统计，文案用「已记录伤害」；received 含全部掉血）
const selCurStats = computed(() => {
  const st = selectedState.value
  if (!st) return { dealt: 0, received: 0, kills: 0 }
  return cumulativeStatsAt(
    authoritativeEvents.value,
    st.vehicle.accountId,
    currentTime.value,
    Array.from(vehiclesByAccount.value.values())
  )
})
/** §12/§13/§19 最近伤害记录：全部车辆的权威 HP loss（Type-7 推导），attacker 不可证明时
 *  显示「来源未知」；raw Type-8 协议值不参与。Blocker 2：只消费 toSec <= currentTime 的记录
 *  （forward/backward seek 与任意 timestamp 重建天然正确，未来事件绝不泄漏）；取最近 8 条。 */
const selDamageLog = computed(() => {
  const st = selectedState.value
  if (!st) return []
  const rows = damageLogAt(
    Array.from(vehiclesByAccount.value.values()),
    st.vehicle.accountId,
    currentTime.value,
    8
  )
  return rows.map((d) => {
    if (d.dir === 'in') {
      if (d.attackerReliable && d.attackerAccountId != null) {
        const attacker = vehiclesByAccount.value.get(d.attackerAccountId)
        // §13：事件时刻位置流未覆盖的攻击者不得泄露身份
        const covered = attacker && victimFeedbackAllowed(attacker, d.timeSec)
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
function floatTeamClass(team) {
  return team === friendlyTeam.value ? 'pb-float-friendly' : 'pb-float-enemy'
}

// ---- PR4 §32–§35：标签碰撞布局（纯函数；screen px）+ PlayerName hysteresis ----
// §21–§28 + PR #107 Blocker 1：碰撞基于真实 screen-space visual footprint。
// 坐标空间（统一约定）：
//   - marker core 本体在 viewport 内随地图缩放：屏幕尺寸 = CSS size（offsetWidth，36/28）
//     × view.scale；coreSize 必须传这个**真实屏幕尺寸**，不得传 transform 前值。
//   - inverse-scaled 叠加层（selected 三角 / destroyed ✕ / recorder 菱形 / 名称 / HP HUD）
//     用 scale(1/view.scale) 保持屏幕恒定，labelLayout 用屏幕恒定常量描述其盒。
//   - viewport resize / fullscreen / mobile media query / zoom / 显示开关变化都会经
//     view.scale / mapWidth / prefs 触发本 computed 重算。
const labelLayout = computed(() => {
  const W = mapWidth()
  if (!W || mapView.value.W <= 0) return new Map()
  // marker CSS layout size（transform 前；media query desktop 36 / mobile 28）
  const markerCssSize = Number(mapEl.value?.querySelector('.pb-vehicle')?.offsetWidth) || MARKER_CORE_PX
  // 真实屏幕尺寸：随 viewport scale 缩放（Blocker 1：4× zoom → 144px 视觉、144px 碰撞）
  const coreSize = markerCssSize * view.scale
  // HP HUD 真实渲染尺寸（.pb-hp-hud 屏幕恒定；测试环境无布局 → 回退 null 走 CSS 常量）。
  // PR #107 Blocker 4：querySelector 第一辆车的 HUD 只作测量基准——不同车辆的显示文本不同
  //（数字 vs —）可能影响宽度，labelLayout 侧再按每车 hpDisplayText 估算并取 max（保守覆盖全部状态）。
  const hpHudEl = mapEl.value?.querySelector('.pb-hp-hud')
  const hpBoxW = hpHudEl ? Number(hpHudEl.offsetWidth) : null
  const hpBoxH = hpHudEl ? Number(hpHudEl.offsetHeight) : null
  const items = vehicleStates.value.map((st) => {
    const p = markerScreen(st)
    if (!p) return null
    const hp = hpDisplay(st.vehicle, currentTime.value, { friendly: st.friendly })
    return {
      accountId: st.vehicle.accountId,
      x: p.x,
      y: p.y,
      tankName: st.tankName,
      playerName: st.playerName,
      // PR #107 Blocker 4：HP footprint 是否存在 = DOM 是否实际渲染 HUD（showHp 开且
      // hpDisplay 有结果），不是 current 是否为 null——RULE_DERIVED_FULL_AT_SPAWN（current=null）
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

// （playerVisState / playerHidden / fadeUntil / hystRafId 声明见播放状态区——
//   seekTo immediate watch 早期触发 pause 时需已初始化，避免 TDZ）

/** 是否存在未决的 hysteresis transition（hide/show 截止未到，或 fade-in 未结束）。 */
function hasPendingHysteresis(now) {
  for (const s of playerVisState.value.values()) {
    if (s.conflict && !s.hidden && now - s.since < PLAYER_HIDE_MS) return true
    if (!s.conflict && s.hidden && now - s.since < PLAYER_SHOW_MS) return true
  }
  for (const until of fadeUntil.values()) if (until > now) return true
  // PR5：暂停时 transient feedback（floating damage/burst/kill feed/ghost/flash）
  // 也需轻量时钟自然完成（§20.2）
  if (hasPendingTransients(now)) return true
  return false
}

/** 轻量时钟：仅当存在未决 transition 且未在播放时维持 RAF；播放时由 frame() 驱动，
 *  无 pending 即停（不做永久轮询）。注意：只更新 nowMs 触发 watch，**不在 watcher 内
 *  回写 nowMs**（nowMs 是 watch source，回写会自触发无限循环）。
 * @param now 当前 resolve 使用的新鲜 wall clock（用于 pending 判定）
 */
function ensureHysteresisClock(now) {
  if (hystRafId != null || playing.value) return
  if (hasPendingHysteresis(now)) {
    hystRafId = requestAnimationFrame(() => {
      hystRafId = null
      nowMs.value = typeof performance !== 'undefined' ? performance.now() : Date.now()
      // nowMs 变化 → watch → resolve → ensureHysteresisClock(新鲜 now) 决定续/停
    })
  }
}

watch([labelLayout, nowMs], () => {
  // 每次 resolve 取**新鲜** wall clock：即使 nowMs 因暂停而陈旧，冲突出现/解除时刻
  // 也以真实时刻计，阈值不会因暂停冻结（B3）。
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const conflicts = new Set()
  for (const [id, r] of labelLayout.value) {
    if (r.playerConflict) conflicts.add(id)
  }
  const res = resolvePlayerVisibility(conflicts, playerVisState.value, now, PLAYER_HIDE_MS, PLAYER_SHOW_MS)
  playerVisState.value = res.state
  playerHidden.value = res.hidden
  // fade-in：恢复帧开始计时，完整 PLAYER_FADE_MS 生命周期
  for (const id of res.fading) fadeUntil.set(id, now + PLAYER_FADE_MS)
  for (const [id, until] of fadeUntil) if (until <= now) fadeUntil.delete(id)
  ensureHysteresisClock(now)
}, { immediate: true })

// transient 过期清理（nowMs/currentTime 变化驱动；reactive Map 不无限增长）
watch([nowMs, currentTime], () => pruneTransients(nowMs.value))

/** VehicleMarker label prop（每 marker 一个：显示开关 + 碰撞位移 + player 显隐/fade +
 *  §25 blockHidden/hpHidden：不可分离碰撞时的优先级隐藏）。 */
function markerLabel(accountId) {
  const l = labelLayout.value.get(accountId)
  return {
    showPlayer: labelPrefs.showPlayerName,
    showTank: labelPrefs.showTankName,
    tankDy: l ? l.tankDy : 0,
    blockHidden: l ? l.blockHidden : false,
    hpHidden: l ? l.hpHidden : false,
    playerHidden: playerHidden.value.has(accountId),
    playerFading: (fadeUntil.get(accountId) || 0) > nowMs.value,
  }
}

const gridRegions = computed(() => {
  const regions = new Map()
  for (const cell of props.overview.gridCells || []) {
    const key = cell.nineGridRegion
    if (!regions.has(key)) {
      regions.set(key, { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity })
    }
    const r = regions.get(key)
    r.xMin = Math.min(r.xMin, cell.bounds.xMin)
    r.yMin = Math.min(r.yMin, cell.bounds.yMin)
    r.xMax = Math.max(r.xMax, cell.bounds.xMax)
    r.yMax = Math.max(r.yMax, cell.bounds.yMax)
  }
  return [...regions.entries()].sort((a, b) => a[0] - b[0])
})

const mapStyle = computed(() => ({
  '--map-grid-stroke': palette.value.gridStroke,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
  '--map-route-outline': palette.value.routeOutline,
  '--map-death-mark': palette.value.deathMark,
  // PR3 §19/§20：marker team tokens（friendly 按地图显式 tone，enemy 固定 red）
  ...teamCssVars(props.overview.mapCode)
}))
</script>

<template>
  <div v-if="image && playback" ref="pbRoot" class="battle-playback" :style="mapStyle" data-test="battle-playback">
    <!-- 播放控制 -->
    <div class="pb-controls">
      <button type="button" class="pb-btn" data-test="pb-play" @click="togglePlay">
        {{ $t(playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}
      </button>
      <button type="button" class="pb-btn" data-test="pb-back5" @click="step(-5)">-5s</button>
      <button type="button" class="pb-btn" data-test="pb-fwd5" @click="step(5)">+5s</button>
      <button type="button" class="pb-btn" data-test="pb-prev" @click="nearestEvent('prev')">◀</button>
      <button type="button" class="pb-btn" data-test="pb-next" @click="nearestEvent('next')">▶</button>
      <button type="button" class="pb-btn" data-test="pb-speed" @click="toggleSpeed">{{ speed }}×</button>
      <button type="button" class="pb-btn" data-test="pb-reset" @click="resetView">{{ $t('recon.map.playback.reset_view') }}</button>
      <span class="pb-time">{{ formatClock(currentTime) }} / {{ formatClock(duration) }}</span>
      <span v-if="overview.recorderAccountId != null" class="pb-filter">
        <label class="pb-check">
          <input type="checkbox" v-model="showAll" data-test="pb-all-events" />
          {{ $t('recon.map.playback.all_events') }}
        </label>
      </span>
      <!-- PR4 §26：玩家/坦克名显示开关（默认 玩家名关 / 坦克名开，localStorage 持久化） -->
      <span class="pb-filter">
        <label class="pb-check">
          <input type="checkbox" v-model="labelPrefs.showPlayerName" data-test="pb-show-player" />
          {{ $t('recon.map.playback.show_player_name') }}
        </label>
        <label class="pb-check">
          <input type="checkbox" v-model="labelPrefs.showTankName" data-test="pb-show-tank" />
          {{ $t('recon.map.playback.show_tank_name') }}
        </label>
        <!-- PR5 §4.3：单车 HP HUD 开关（默认开启，localStorage 持久化；关闭隐藏地图 HP 数字/bar/ghost） -->
        <label class="pb-check">
          <input type="checkbox" v-model="hpPrefs.showHp" data-test="pb-show-hp" />
          {{ $t('recon.map.playback.show_hp') }}
        </label>
      </span>
      <!-- 全屏（原生 Fullscreen API；不支持时按钮隐藏，不抛错） -->
      <button
        v-if="fullscreenSupported"
        type="button"
        class="pb-btn"
        data-test="pb-fullscreen"
        @click="toggleFullscreen"
      >{{ isFullscreen ? $t('recon.map.playback.exit_fullscreen') : $t('recon.map.playback.enter_fullscreen') }}</button>
    </div>

    <!-- 事件类型过滤 -->
    <div class="pb-filters">
      <button
        v-for="type in ['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']"
        :key="type"
        type="button"
        class="pb-chip"
        :class="{ active: typeFilter.has(type) }"
        @click="toggleType(type)"
      >{{ $t(`recon.map.playback.event_${type}`) }}</button>
    </div>

    <!-- 地图标注工具栏：显式切工具才绘制，未选工具时保持原浏览交互 -->
    <div class="pb-annot-toolbar" data-test="pb-annot-toolbar">
      <button
        v-for="tool in ['pen', 'eraser', 'arrow', 'line', 'rect', 'circle', 'text']"
        :key="tool"
        type="button"
        class="pb-annot-btn"
        :class="{ active: activeTool === tool }"
        :data-test="`pb-annot-${tool}`"
        @click="toggleTool(tool)"
      >{{ $t(`recon.map.playback.annot.${tool}`) }}</button>
      <span class="pb-annot-sep" aria-hidden="true"></span>
      <button
        v-for="c in ANNOT_COLORS"
        :key="c"
        type="button"
        class="pb-annot-color"
        :class="{ active: annotColor === c }"
        :style="{ background: c }"
        :aria-label="$t('recon.map.playback.annot.color')"
        @click="annotColor = c"
      ></button>
      <span class="pb-annot-sep" aria-hidden="true"></span>
      <label class="pb-annot-width">
        {{ $t('recon.map.playback.annot.width') }}
        <input type="range" :min="ANNOT_WIDTH_MIN" :max="ANNOT_WIDTH_MAX" step="1" v-model.number="annotWidthSlider" />
        <span class="pb-annot-width-val">{{ annotWidthSlider }}</span>
      </label>
      <span class="pb-annot-sep" aria-hidden="true"></span>
      <button
        type="button"
        class="pb-annot-btn"
        :disabled="!canUndo(historyIndex)"
        data-test="pb-annot-undo"
        @click="undoAnnot"
      >{{ $t('recon.map.playback.annot.undo') }}</button>
      <button
        type="button"
        class="pb-annot-btn"
        :disabled="!canRedo(history, historyIndex)"
        data-test="pb-annot-redo"
        @click="redoAnnot"
      >{{ $t('recon.map.playback.annot.redo') }}</button>
      <button
        type="button"
        class="pb-annot-btn"
        data-test="pb-annot-clear"
        @click="clearAll"
      >{{ $t('recon.map.playback.annot.clear') }}</button>
      <button
        type="button"
        class="pb-annot-btn"
        data-test="pb-annot-toggle"
        @click="annotVisible = !annotVisible"
      >{{ $t(annotVisible ? 'recon.map.playback.annot.hide' : 'recon.map.playback.annot.show') }}</button>
    </div>

    <!-- 进度条 + 事件标记 -->
    <div class="pb-progress" data-test="pb-progress">
      <input
        class="pb-range"
        type="range"
        min="0"
        :max="duration || 1"
        step="0.1"
        :value="currentTime"
        @pointerdown="dragStart"
        @mousedown="dragStart"
        @touchstart="dragStart"
        @input="seek(Number($event.target.value))"
        :aria-label="$t('recon.map.playback.progress')"
      />
      <span
        v-for="marker in eventMarkers"
        :key="marker.sec"
        class="pb-marker"
        :style="{ left: `${duration > 0 ? (marker.sec / duration) * 100 : 0}%` }"
        :title="`${formatClock(marker.sec)} ×${marker.count}`"
        @click="jumpTo(marker.sec)"
      ></span>
    </div>

    <!-- 地图 + detail sidebar 主区（宽屏并排，窄屏上下堆叠；§8.2） -->
    <div class="pb-main" data-test="pb-main">
    <!-- 地图 + 当前车辆状态（标记为 HTML overlay，固定像素尺寸，双层 hull/turret 独立旋转） -->
    <div class="pb-map" data-test="pb-map" ref="mapEl" @wheel.prevent="onWheel">
    <div
      class="pb-viewport"
      data-test="pb-viewport"
      :style="viewportStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.capture="onViewportClick"
    >
    <svg class="pb-svg" :viewBox="`0 0 ${mapView.W} ${mapView.H}`" role="img">
      <image :href="image.src" :width="mapView.W" :height="mapView.H" preserveAspectRatio="none" />
      <g class="pb-grid">
        <rect
          v-for="(cell, index) in overview.gridCells"
          :key="cell.id"
          :x="mapView.toX(cell.bounds.xMin)"
          :y="mapView.toY(cell.bounds.yMax)"
          :width="mapView.toX(cell.bounds.xMax) - mapView.toX(cell.bounds.xMin)"
          :height="mapView.toY(cell.bounds.yMin) - mapView.toY(cell.bounds.yMax)"
          class="pb-cell"
        />
      </g>
      <g class="pb-regions">
        <g v-for="[region, r] in gridRegions" :key="region">
          <rect
            :x="mapView.toX(r.xMin)"
            :y="mapView.toY(r.yMax)"
            :width="mapView.toX(r.xMax) - mapView.toX(r.xMin)"
            :height="mapView.toY(r.yMin) - mapView.toY(r.yMax)"
            class="pb-region-line"
          />
        </g>
      </g>
      <g class="pb-spawns">
        <circle
          v-for="(spawn, i) in overview.spawnPoints"
          :key="`${spawn.name}-${i}`"
          :cx="mapView.toX(spawn.x)"
          :cy="mapView.toY(spawn.y)"
          r="4"
          :class="spawn.team === friendlyTeam ? 'pb-spawn-friendly' : 'pb-spawn-enemy'"
        />
      </g>
      <g class="pb-tracers" aria-hidden="true">
        <template v-for="(l, i) in visibleTracers" :key="`tracer-${l.timeSec}-${i}`">
          <!-- 外层光晕：阵营色宽线半透明（激光辉光） -->
          <line
            class="pb-tracer"
            :x1="mapView.toX(l.x1)"
            :y1="mapView.toY(l.y1)"
            :x2="mapView.toX(l.x2)"
            :y2="mapView.toY(l.y2)"
            :stroke="tracerColor(l.attackerAccountId)"
            :stroke-width="6 / view.scale"
            :opacity="l.opacity * 0.35"
          />
          <!-- 内芯：亮白细线（激光束主体） -->
          <line
            class="pb-tracer-core"
            :x1="mapView.toX(l.x1)"
            :y1="mapView.toY(l.y1)"
            :x2="mapView.toX(l.x2)"
            :y2="mapView.toY(l.y2)"
            stroke="#fff"
            :stroke-width="1.75 / view.scale"
            :opacity="l.opacity"
          />
          <!-- 命中闪光：短促冲击闪光——扩散 + 峰值→淡出（flashOpacity 峰值曲线）；
               flashProgress=1 后不再渲染（不残留孤立端点/waypoint 感） -->
          <circle
            v-if="l.flashProgress < 1"
            class="pb-tracer-flash"
            :cx="mapView.toX(l.x2)"
            :cy="mapView.toY(l.y2)"
            :r="(3 + 9 * l.flashProgress) / view.scale"
            :fill="tracerColor(l.attackerAccountId)"
            :opacity="l.flashOpacity"
          />
        </template>
      </g>
      <!-- 地图标注层：语义坐标锚定，随地图缩放/平移；静态叠加不随播放时间变化 -->
      <g v-if="annotVisible" class="pb-annotations" data-test="pb-annotations">
        <template v-for="(ann, i) in renderedAnnotations" :key="i">
          <polyline
            v-if="ann.type === 'pen'"
            :points="ann.svgPoints"
            fill="none"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <line
            v-else-if="ann.type === 'line'"
            :x1="ann.x1"
            :y1="ann.y1"
            :x2="ann.x2"
            :y2="ann.y2"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            stroke-linecap="round"
          />
          <g v-else-if="ann.type === 'arrow'">
            <line
              :x1="ann.x1"
              :y1="ann.y1"
              :x2="ann.x2"
              :y2="ann.y2"
              :stroke="ann.color"
              :stroke-width="ann.widthSvg"
              stroke-linecap="round"
            />
            <polygon :points="ann.head" :fill="ann.color" />
          </g>
          <rect
            v-else-if="ann.type === 'rect'"
            :x="ann.x"
            :y="ann.y"
            :width="ann.w"
            :height="ann.h"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            fill="none"
          />
          <circle
            v-else-if="ann.type === 'circle'"
            :cx="ann.cx"
            :cy="ann.cy"
            :r="ann.r"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            fill="none"
          />
          <text
            v-else-if="ann.type === 'text'"
            :x="ann.x"
            :y="ann.y"
            :fill="ann.color"
            :font-size="ANNOT_FONT_SIZE"
            text-anchor="middle"
            dominant-baseline="middle"
            class="pb-annot-text"
          >{{ ann.text }}</text>
        </template>
      </g>
    </svg>
    <div class="pb-markers" :class="{ 'pb-drawing': !!activeTool }" data-test="pb-markers" aria-hidden="false">
      <VehicleMarker
        v-for="st in vehicleStates"
        :key="st.vehicle.accountId"
        :marker="st"
        :selected="selectedAccountId === st.vehicle.accountId"
        :label="markerLabel(st.vehicle.accountId)"
        :hp="hpFor(st.vehicle)"
        :hp-visible="hpPrefs.showHp"
        :t="t"
        :hp-ghost="ghostFor(st.vehicle.accountId)"
        :hp-flash="flashFor(st.vehicle.accountId)"
        :hp-no-transition="hpNoTransition"
        @select="onMarkerSelect(st.vehicle, $event)"
      />
    </div>
    </div>

    <input
      v-if="textSession"
      ref="textInputRef"
      v-model="textSession.text"
      class="pb-text-input"
      :style="textInputStyle"
      :placeholder="$t('recon.map.playback.annot.text_placeholder')"
      data-test="pb-text-input"
      @keydown.enter.prevent="commitSession(textSession)"
      @keydown.esc.prevent="cancelSession(textSession)"
      @blur="commitSession(textSession)"
    />

    <!-- PR5 §10/§12/§16：transient feedback 层（floating damage / destruction burst / kill feed）。
         wall-clock 生命周期（任意倍速可读时长一致）；seek 清空、pause 自然完成 -->
    <div class="pb-feedback-layer" data-test="pb-feedback-layer" aria-hidden="true">
      <span
        v-for="f in visibleFloats"
        :key="'dmg-' + f.id"
        class="pb-float-dmg"
        data-test="pb-float-dmg"
        :class="floatTeamClass(f.team)"
        :style="{ left: f.x + 'px', top: f.y + 'px' }"
      >-{{ f.hpLoss }}</span>
      <span
        v-for="b in visibleBursts"
        :key="'burst-' + b.id"
        class="pb-burst"
        data-test="pb-burst"
        :class="floatTeamClass(b.team)"
        :style="{ left: b.x + 'px', top: b.y + 'px' }"
      ></span>
    </div>
    <div v-if="visibleFeed.length" class="pb-kill-feed" data-test="pb-kill-feed" aria-hidden="true">
      <div
        v-for="f in visibleFeed"
        :key="'feed-' + f.id"
        class="pb-feed-item"
        :class="f.victimTeam === friendlyTeam ? 'pb-feed-friendly' : 'pb-feed-enemy'"
      >
        <span class="pb-feed-skull" aria-hidden="true">☠</span>
        <span class="pb-feed-victim">{{ f.victimName }}</span>
        <span class="pb-feed-destroyed">{{ $t('recon.map.playback.feed_destroyed') }}</span>
      </div>
    </div>
    </div>

    <!-- PR5 §8：detail sidebar（宽屏右侧固定，窄屏置于地图下方；点击 marker 打开/切换，
         点击空白不关闭，必须 × 显式关闭；destroyed 车可选；seek 保持同一 selected vehicle） -->
    <aside v-if="selectedState" class="pb-sidebar" data-test="pb-info" :aria-label="$t('recon.map.playback.detail')">
      <div class="pb-sb-head">
        <div class="pb-sb-title">
          <strong data-test="pb-sb-tank">{{ selectedState.vehicle.tankName || selectedState.vehicle.tankId }}</strong>
          <span class="pb-sb-player" data-test="pb-sb-player">{{ selectedState.vehicle.playerName }}</span>
        </div>
        <button type="button" class="pb-close pb-sb-close" data-test="pb-sb-close" :aria-label="$t('recon.map.playback.close')" @click="closeSidebar">&times;</button>
      </div>
      <div v-if="selectedPortraitUrl" class="pb-sb-portrait" data-test="pb-sb-portrait">
        <img
          :src="selectedPortraitUrl"
          :alt="selectedState.vehicle.tankName || String(selectedState.vehicle.tankId)"
        />
      </div>
      <dl class="pb-sb-grid">
        <dt>{{ $t('recon.map.playback.team') }}</dt>
        <dd>{{ $t(selectedState.vehicle.team === friendlyTeam ? 'recon.map.playback.team_friendly' : 'recon.map.playback.team_enemy') }}</dd>
        <dt>{{ $t('recon.map.playback.vehicle_type') }}</dt>
        <dd>{{ vehicleTypeLabel(selectedState.vehicle) }}</dd>
        <dt>{{ $t('recon.map.playback.state') }}</dt>
        <dd>{{ $t(selStateLabel) }}</dd>
        <template v-if="selLastKnownSec != null">
          <dt>{{ $t('recon.map.playback.last_spotted') }}</dt>
          <dd>{{ formatClock(selLastKnownSec) }}</dd>
        </template>
        <dt>{{ $t(selHpLabel) }}</dt>
        <dd data-test="pb-sb-hp">{{ selHpText }}</dd>
        <template v-if="selectedState.destroyed && selectedState.destroyedKnownAtSec != null">
          <dt>{{ $t('recon.map.playback.destroyed_at') }}</dt>
          <dd>{{ formatClock(selectedState.destroyedKnownAtSec) }}</dd>
        </template>
        <dt>{{ $t('recon.map.playback.playback_time') }}</dt>
        <dd>{{ formatClock(currentTime) }}</dd>
        <dt>{{ $t('recon.map.playback.damage_recorded') }}</dt>
        <dd data-test="pb-sb-dealt">{{ selCurStats.dealt }}</dd>
        <dt>{{ $t('recon.map.playback.damage_received') }}</dt>
        <dd>{{ selCurStats.received }}</dd>
        <dt>{{ $t('recon.map.playback.kills') }}</dt>
        <dd>{{ selCurStats.kills }}</dd>
      </dl>
      <!-- V2 守卫：canonical dataset present 时，选中车辆的 V2 事实面板（AC-4/5/6/7）。 -->
      <V2VehicleInspector
        v-if="selectedV2Track"
        data-test="pb-sb-v2-inspector"
        :track="selectedV2Track"
        :time-sec="currentTime"
      />
      <template v-if="selDamageLog.length">
        <div class="pb-sb-section">{{ $t('recon.map.playback.damage_log') }}</div>
        <ul class="pb-sb-log">
          <li v-for="(d, i) in selDamageLog" :key="i">
            <span class="pb-sb-log-time">{{ formatClock(d.timeSec) }}</span>
            <span v-if="d.dir === 'in'" class="pb-sb-log-in">−{{ d.hpLoss }} <em>{{ d.label }}</em></span>
            <span v-else class="pb-sb-log-out">+{{ d.hpLoss }} → {{ d.label }}</span>
          </li>
        </ul>
      </template>
    </aside>
    </div>

    <!-- 双方总血量条 + 争霸赛实时点数（PR #107 Blocker 2 aggregate state）：
         FULL_RELATIVE=100% 阵营色实心（相对满血）；EXACT=真实分数（known/totalMax）；
         PARTIAL=100% 斜纹 indeterminate（有真实已知剩余、无已证明分母）；UNKNOWN=空/— -->
    <div class="pb-hp-bars" data-test="pb-hp-bars">
      <div class="pb-hp-row">
        <span class="pb-hp-label">{{ $t('recon.map.playback.team_friendly') }}</span>
        <div class="pb-hp-track">
          <div
            class="pb-hp-fill pb-hp-friendly"
            :class="{ 'pb-hp-partial': friendlyHp.state === 'PARTIAL' }"
            :style="{ width: hpBarFill(friendlyHp, 'known') }"
            data-test="pb-hp-fill-friendly"
          ></div>
          <div class="pb-hp-fill pb-hp-unknown" :style="{ width: hpBarFill(friendlyHp, 'unknown') }"></div>
        </div>
        <span class="pb-hp-value" data-test="pb-hp-value-friendly">{{ hpValueText(friendlyHp) }}</span>
        <span v-if="friendlyHp.spawnFullCount > 0" class="pb-hp-unknown-text" data-test="pb-hp-spawn-full-friendly">{{ $t('recon.map.playback.hp_full_spawn') }} ({{ friendlyHp.spawnFullCount }})</span>
        <span v-if="friendlyHp.unknownMax > 0" class="pb-hp-unknown-text" data-test="pb-hp-unknown-friendly">{{ $t('recon.map.playback.hp_unknown') }} {{ friendlyHp.unknownMax }}</span>
        <span v-if="showPoints && friendlyPoints != null" class="pb-hp-points" data-test="pb-points-friendly">{{ $t('recon.map.playback.points') }}: {{ friendlyPoints }}</span>
      </div>
      <div class="pb-hp-row">
        <span class="pb-hp-label">{{ $t('recon.map.playback.team_enemy') }}</span>
        <div class="pb-hp-track">
          <div
            class="pb-hp-fill pb-hp-enemy"
            :class="{ 'pb-hp-partial': enemyHp.state === 'PARTIAL' }"
            :style="{ width: hpBarFill(enemyHp, 'known') }"
            data-test="pb-hp-fill-enemy"
          ></div>
          <div class="pb-hp-fill pb-hp-unknown" :style="{ width: hpBarFill(enemyHp, 'unknown') }"></div>
        </div>
        <span class="pb-hp-value" data-test="pb-hp-value-enemy">{{ hpValueText(enemyHp) }}</span>
        <span v-if="enemyHp.unknownMax > 0" class="pb-hp-unknown-text" data-test="pb-hp-unknown-enemy">{{ $t('recon.map.playback.hp_unknown') }} {{ enemyHp.unknownMax }}</span>
        <span v-if="showPoints && enemyPoints != null" class="pb-hp-points" data-test="pb-points-enemy">{{ $t('recon.map.playback.points') }}: {{ enemyPoints }}</span>
      </div>
    </div>

    <!-- 事件弹层（点击进度条标记展示该秒事件） -->
    <div v-if="popupEvents.length" class="pb-popup" data-test="pb-popup">
      <div class="pb-popup-head">
        {{ formatClock(eventPopupSec) }}
        <button type="button" class="pb-close" @click="eventPopupSec = null">&times;</button>
      </div>
      <ul>
        <li v-for="(event, i) in popupEvents" :key="i">
          <span class="pb-event-type">{{ $t(`recon.map.playback.event_${event.type}`) }}</span>
          {{ eventLabel(event) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.battle-playback {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
/* 全屏（原生 Fullscreen API，:fullscreen 作用于 .battle-playback 自身）：
   填满视口、内部滚动兜底；地图保持自身宽高比（不拉伸/不 letterbox），
   用垂直预算限制地图最大宽度以适配剩余空间，toolbar/时间轴不被挤出。 */
.battle-playback:fullscreen {
  width: 100%;
  height: 100%;
  margin-top: 0;
  background: var(--bg, #0b0f0d);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.battle-playback:fullscreen .pb-map {
  width: 100%;
  max-width: calc(100vh - 190px); /* 全屏垂直预算：控制区/时间轴/血量条等固定 UI 约 190px */
  margin: auto; /* 垂直居中利用剩余空间；超高时滚动兜底 */
}
.battle-playback:fullscreen .pb-main { align-items: center; }
.battle-playback:fullscreen .pb-main .pb-map { flex: 0 1 auto; }
.pb-controls, .pb-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pb-btn, .pb-chip {
  border: 1px solid #39444a;
  background: rgba(15, 21, 25, .92);
  color: #c9c5bb;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.pb-chip.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.pb-time { font-size: .8rem; color: var(--text-label); font-variant-numeric: tabular-nums; }
.pb-filter { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; }
.pb-check { display: inline-flex; align-items: center; gap: 4px; }
.pb-progress { position: relative; margin: 2px 0; }
.pb-range { width: 100%; display: block; }
.pb-marker {
  position: absolute;
  top: 2px;
  width: 3px;
  height: 10px;
  background: var(--accent, #2f7dff);
  cursor: pointer;
  transform: translateX(-50%);
}
.pb-main { display: flex; align-items: flex-start; gap: 8px; }
/* 地图自适应剩余宽度（§8.2 宽屏：右侧固定 sidebar，地图占剩余） */
.pb-main .pb-map { width: auto; margin: 0; flex: 1 1 auto; min-width: 0; }
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; }
.pb-viewport {
  position: relative;
  width: 100%;
  transform-origin: 0 0;
  touch-action: none;
}
.pb-svg {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
  background: #111;
}
@media (max-width: 768px) {
  .pb-map { width: 100%; }
  /* §8.2 窄屏：sidebar 置于地图/播放器下方，不强行压缩成窄右侧栏 */
  .pb-main { flex-direction: column; }
  .pb-main .pb-map { width: 100%; }
  .pb-sidebar { width: 100%; max-height: none; }
}
.pb-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* PR3 增补：车辆视觉尺寸上调（人工 QA：全局地图视角下车型辨识度不足）——
   desktop 28 → 36px / mobile 22 → 28px（约 +28%）；zoom 契约不变（viewport 整体 scale，
   车辆随地图缩放；name/✕/selected/recorder 继续 inverse-scale 保持屏幕尺寸）。 */
.pb-vehicle {
  position: absolute;
  width: 36px;
  height: 36px;
  transform: translate(-50%, -50%);
  border: none;
  background: none;
  padding: 0;
  /* PR4 §36：按钮本身不拦截点击，只有 .pb-hitbox（hull 范围）可点 */
  pointer-events: none;
}
@media (max-width: 768px) {
  .pb-vehicle { width: 28px; height: 28px; }
}
/* marker 内部样式（hull/turret/death/name/状态视觉）全部随 VehicleMarker 组件迁移：
   PR3 —— last-known/destroyed 弱化由 VehicleMarker .pb-graphics 容器承担（root 不再
   opacity，否则 ✕/label 也会被淡掉）；Selected 红色倒三角、Recorder 空心菱形、
   team outline/glow（friendly green|blue / enemy red，CSS vars 由根元素提供）。 */
.pb-cell { stroke: var(--map-grid-stroke, rgba(255,255,255,.16)); stroke-width: .5; fill: none; }
/* 激光炮线：外层光晕/内芯线宽逐元素绑定（6/view.scale、1.75/view.scale），不随缩放变粗 */
.pb-tracer, .pb-tracer-core { stroke-linecap: round; }
.pb-region-line { fill: none; stroke: var(--map-region-stroke, rgba(255,255,255,.28)); stroke-width: 1; }
.pb-spawn-friendly { fill: var(--map-spawn-friendly, #8ef7b0); }
.pb-spawn-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }

/* 双方总血量条：阵营色填充（本方/敌方），随播放实时下降；争霸赛附点数 */
.pb-hp-bars { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.pb-hp-row { display: flex; align-items: center; gap: 8px; font-size: .78rem; color: var(--text-label); }
.pb-hp-label { width: 3.5em; flex-shrink: 0; }
.pb-hp-track { flex: 1; display: flex; height: 10px; border-radius: 5px; background: var(--bg-chip, rgba(128,128,128,.25)); overflow: hidden; }
.pb-hp-fill { height: 100%; transition: width .15s linear; }
.pb-hp-friendly { background: var(--map-spawn-friendly, #8ef7b0); }
.pb-hp-enemy { background: var(--map-spawn-enemy, #ff8d8d); }
.pb-hp-unknown { background: rgba(128,128,128,.45); }
/* PARTIAL（有真实已知剩余、无已证明分母）：阵营色底 + indeterminate 斜纹——
   不是开局 fallback 条纹（开局用 FULL_RELATIVE 纯实心阵营色），只是「已知部分不完整」的表达 */
.pb-hp-friendly.pb-hp-partial,
.pb-hp-enemy.pb-hp-partial {
  background-image: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.35) 0 3px, transparent 3px 6px);
}
.pb-hp-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.pb-hp-unknown-text { color: var(--text-muted, #999); white-space: nowrap; }
.pb-hp-points { white-space: nowrap; }

/* PR5 §8 detail sidebar：当前 playback 时间点的车辆战斗状态面板（非整场最终战绩面板）。
   宽屏右侧固定；窄屏（≤768px）整行置于地图下方；× 显式关闭。 */
.pb-sidebar {
  width: 260px;
  flex-shrink: 0;
  align-self: stretch;
  font-size: .8rem;
  color: #c9c5bb;
  background: rgba(13, 18, 22, .94);
  border: 1px solid #303a40;
  border-radius: 4px;
  padding: 6px 8px;
  overflow-y: auto;
  max-height: 72vh;
}
.pb-sb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
.pb-sb-title { display: flex; flex-direction: column; min-width: 0; }
.pb-sb-title strong { color: #f2ede3; font-size: .85rem; line-height: 1.3; }
.pb-sb-player { color: var(--text-muted); font-size: .75rem; word-break: break-all; }
.pb-sb-close { font-size: 1.05rem; line-height: 1; padding: 0 3px; }
.pb-sb-portrait {
  display: grid;
  place-items: center;
  min-height: 92px;
  margin: 2px 0 6px;
  border-radius: 4px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--bg-chip, rgba(128, 128, 128, .2)) 68%, transparent), transparent);
  overflow: hidden;
}
.pb-sb-portrait img {
  display: block;
  width: min(100%, 190px);
  height: 96px;
  object-fit: contain;
  filter: drop-shadow(0 5px 7px rgba(0, 0, 0, .28));
}
.pb-sb-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0; }
.pb-sb-grid dt { color: var(--text-muted); white-space: nowrap; }
.pb-sb-grid dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.pb-sb-section {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-weight: 700;
  color: var(--text-heading);
}
.pb-sb-log { margin: 4px 0 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 1px; max-height: 120px; overflow-y: auto; }
.pb-sb-log li { display: flex; gap: 6px; font-variant-numeric: tabular-nums; align-items: baseline; }
.pb-sb-log-time { color: var(--text-muted); flex-shrink: 0; }
.pb-sb-log-in { color: var(--pb-enemy-text, #f87171); }
.pb-sb-log-out { color: var(--pb-team-text, #4ade80); }
.pb-sb-log em { font-style: normal; opacity: .75; }

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
  top: 6px;
  right: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 10;
  pointer-events: none;
  max-width: 62%;
}
.pb-feed-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: .75rem;
  background: rgba(0, 0, 0, .6);
  border: 1px solid rgba(255, 255, 255, .14);
  border-radius: 3px;
  padding: 2px 6px;
  animation: pb-feed-in .25s ease-out;
}
.pb-feed-skull { color: #fff; }
.pb-feed-friendly .pb-feed-victim { color: var(--pb-team-text, #4ade80); }
.pb-feed-enemy .pb-feed-victim { color: var(--pb-enemy-text, #f87171); }
.pb-feed-destroyed { color: var(--text-muted, #999); }
@keyframes pb-feed-in {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-float-dmg, .pb-burst, .pb-feed-item { animation: none; }
}
.pb-popup {
  background: rgba(13, 18, 22, .97);
  border: 1px solid #303a40;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: .8rem;
  color: #d8d5cd;
}
.pb-popup-head { display: flex; justify-content: space-between; font-weight: 700; }
.pb-popup ul { margin: 4px 0 0; padding-left: 16px; }
.pb-event-type { color: var(--accent); margin-right: 4px; }
.pb-close { border: none; background: none; cursor: pointer; color: var(--text-muted); }

/* 地图标注：工具栏 + 标注层 + 文字输入 */
.pb-annot-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.pb-annot-btn {
  border: 1px solid #39444a;
  background: rgba(15, 21, 25, .92);
  color: #c9c5bb;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.pb-annot-btn.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.pb-annot-btn:disabled { opacity: .45; cursor: default; }
.pb-annot-color {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.pb-annot-color.active { border-color: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.7); }
.pb-annot-width {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .78rem;
  color: var(--text-label);
}
.pb-annot-width input { width: 80px; }
.pb-annot-width-val { font-variant-numeric: tabular-nums; min-width: 2ch; }
.pb-annot-sep { width: 1px; height: 16px; background: var(--border); }
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
