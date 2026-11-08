<script setup>
import { gunMarksByAccount } from '../utils/gunMarks.js'
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { mapLabel } from '../utils/helpers.js'
import { PencilRuler, ScanEye } from 'lucide-vue-next'
import { ANNOT_COLORS, ANNOT_FONT_SIZE, ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN, canRedo, canUndo } from '../utils/annotation.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { useI18n } from 'vue-i18n'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { mapBases } from '../data/mapBases'
import { mapImages } from '../data/mapImages'
import { map2dSrc } from '../data/map2dOverlay'
import { teamCssVars } from '../data/mapTeamColors'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'
import { createMapView } from '../utils/mapView'
import BattleMap from './BattleMap.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import BattlePlaybackHud from './BattlePlaybackHud.vue'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import PlaybackControls from './PlaybackControls.vue'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import PlaybackDisplaySurface from './PlaybackDisplaySurface.vue'
import SegmentedControl from './SegmentedControl.vue'
import { isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'
import VehicleDetailsPanel from './VehicleDetailsPanel.vue'
import PlaybackRoster from './PlaybackRoster.vue'
import { rosterLanesFor } from '../scene/rosterState.js'
import { formatClock, teamPointsAt, transientsActive } from '../utils/battlePlayback.js'
import { friendlyHealthAt, healthDisplayAt } from '../utils/battlePlaybackV2.js'
import { usePlaybackTransients } from '../composables/usePlaybackTransients.js'
import { usePlaybackCamera } from '../composables/usePlaybackCamera.js'
import { usePlaybackAnnotationEditor } from '../composables/usePlaybackAnnotationEditor.js'
import { usePlaybackVehicleSelection } from '../composables/usePlaybackVehicleSelection.js'
import { usePlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import { usePlaybackClock } from '../composables/usePlaybackClock.js'
import { usePlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection.js'
import { usePlaybackMapGestures } from '../composables/usePlaybackMapGestures.js'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing.js'
import { baseView } from '../utils/baseStatus.js'
import {
  MARKER_CORE_PX,
  computeLabelLayout,
} from '../utils/labelLayout'
import { usePlaybackAnnotations } from '../composables/usePlaybackAnnotations.js'

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
  /**
   * 位姿通道（`LocalPlayback.poseFacet` = playback facet 的位姿列投影）：2D 俯视与 3D 场景
   * 同源同插值（`replay-local/pose/vehiclePose.ts`）。缺失 = 回退 canonical 原始观测。
   */
  poseFacet: { type: Object, default: null },
  /** battle-relative → 回放时钟域的偏移（canonical `clock.startRaw`）；与 poseFacet 同时给出。 */
  clockOffset: { type: Number, default: null },
  result: { type: Object, default: null },
  /** Raw Playback reload evidence stays outside the generic canonical/HTTP dataset. */
  reloadTelemetry: { type: Object, default: null },
  /**
   * 是否为当前可见的模式（审计 PB-05）。false 时暂停播放、不响应快捷键——
   * 工作台用 v-show 保留实例，隐藏的回放不能再抢空格 / 方向键。
   */
  active: { type: Boolean, default: true },
})

const { t, locale } = useI18n()
const gunMarks = computed(() => gunMarksByAccount(props.result))

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
/** 底图 URL：包内兜底，Android 上若 COS 有更新且校验通过则换成 blob URL（见 map2dOverlay.js）。 */
const imageSrc = computed(() => (image.value ? map2dSrc(pbOverview.value.mapCode, image.value.src) : null))
const mapView = computed(() => createMapView(image.value, pbOverview.value))

// 自适应配色（与热力覆盖层使用同一色板）
const palette = ref(darkMapPalette)
let paletteRequestToken = 0
watch(imageSrc, async (src) => {
  const token = ++paletteRequestToken
  if (!src) {
    palette.value = darkMapPalette
    return
  }
  try {
    const luminance = await luminanceOfImage({ src })
    if (token === paletteRequestToken) palette.value = paletteForLuminance(luminance)
  } catch {
    if (token === paletteRequestToken) palette.value = darkMapPalette
  }
}, { immediate: true })

// V2 canonical dataset 是唯一 playback 事实源（cleanup：移除 legacy overview.playback）。
const playback = computed(() => props.playbackV2 || null)
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => pbOverview.value.friendlyTeam)

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

// ---- 播放状态：playback clock 的唯一 owner = usePlaybackClock（#820 Agent C Step 3）；
// transient/animation 时间基准 = UI wall clock（performance.now）——播放时由 playback frame()
// 每帧刷新；暂停时由时钟 owner 的轻量 RAF 继续推进（仅当存在未决 transient）。
const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)
// Playback presentation preferences have one persistence owner. BattlePlayback only consumes refs.
const { labelPrefs, hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter } = usePlaybackPreferences()
const hpModeOptions = computed(() => ['bar', 'ring'].map(mode => ({
  value: mode, label: t(`recon.map.playback.hp_mode_${mode}`), testid: `pb-hp-mode-${mode}`,
})))

// ---- PR5（§1.3/§10/§16/§20）：deterministic state 与 transient feedback 分层。
// transient 全部 wall-clock（performance.now）驱动，播放帧推进时消费新跨过的事件，
// seek 清空（§20.1 不补播）、pause 自然完成（§20.2）、resume 不重复已消费事件（§20.3，
// eventCursor 严格左开：恰在 cursor 上的事件不重复触发）。
// transient 状态与消费/过期规则的唯一 owner = usePlaybackTransients（#820 Wave B5A）；
// 本组件只保留 playback clock（frame/pause RAF）与地图投影（markerScreen → visibleFloats/Bursts）。
// Blocker 1：consumption 源 = authoritativeEvents（原始 playback events），
// 不受 Event Panel 折叠状态影响。

function realNowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

const {
  eventCursor,
  floatItems,
  burstItems,
  resetTransients,
  consumeEvents,
  hasPendingTransients,
  pruneTransients,
  ghostFor,
  flashFor,
  visibleFeed,
} = usePlaybackTransients({
  nowMs,
  authoritativeEvents: () => authoritativeEvents.value,
  hpVehicles: () => hpVehicles.value,
  vehiclesByAccount: () => vehiclesByAccount.value,
  // 与 kill feed 模板消费条件（!uiHidden && uiPrefs.showKillfeed）同口径：隐藏时
  // visibleFeed 不被读取、排队条目永远没有 shownAt，不驱动暂停时钟（防 RAF 无限续约）。
  feedVisible: () => !uiHidden.value && !!uiPrefs.showKillfeed,
})

// ---- transient 渲染视图（wall-clock 过滤 + 屏幕定位；状态 owner = usePlaybackTransients）----
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
// visibleFeed 由 usePlaybackTransients 提供（activeFeed 权威队列投影）。
const uiHidden = ref(false)
function setUiHidden(hidden) {
  uiHidden.value = hidden
  if (hidden) { displayOpen.value = false; closeAnnotation() }
}
// §mobile-panels：二级面没有常驻左栏——唯一入口是 Transport 上的 gear，打开的是
// `PlaybackDisplaySurface`（Display / Events 两段）。
/**
 * 名册呈现开关：**唯一 owner** 是共享呈现偏好 `uiPrefs.showRoster`（与 3D 同一个 key）。
 * 所有 2D 名册呈现——宽档 / 横屏的两侧车道、竖屏的纵向流名册——都必须读它，
 * 不允许出现「名册关了但别处还列着全部玩家」这种割裂语义。
 * 关掉**只关呈现**：名册数据（teamVehicles）、选中车辆、详情、时间轴、地图视图与相机
 * 全部保留；恢复后立刻可用，不重建播放、不重解析。
 */
const showRosterPresentation = computed(() => !uiHidden.value && uiPrefs.showRoster !== false)
const mobileOverlay = ref(null)
/** §details-float：详情浮窗的受保护下界——传输控件。它在竖屏纵向流与横屏中心栈里都是
    同一处（`[data-test="pb-transport-slot"]`），这里始终指向当前真正在渲染的那一个，
    避免浮窗盖住拇指操作区。 */
const transportEl = ref(null)
const displayOpen = ref(false)
const displaySection = ref('display')
const displayAnchor = ref(null)
function toggleDisplay(anchor) { displayAnchor.value = anchor; displaySection.value = 'display'; displayOpen.value = !displayOpen.value }
/** 整个战场 workspace（`.pb-main`：Team 1 | Stage | Team 2 + 浮窗）——详情浮窗的定位祖先与
    拖动宿主。浮窗是它的直接子元素，`left/top`、夹紧与拖动在同一个坐标系里算；
    它不是 `.pb-map-stage`（那只是中间一栏，按它算会把浮窗关在 Stage 里）。 */
const battlefieldWorkspaceEl = ref(null)
// ---- 地图视图缩放/平移：单一 camera layer 保证地图/网格/炮线/标记严格对齐 ----
// 相机状态（view / MapRenderRect / fit）的唯一 owner = usePlaybackCamera（#820 Agent C）；
// 手势状态机（pointer/pan/pinch/wheel）的唯一 owner = usePlaybackMapGestures。
const mapComponent = ref(null)
const mapStageEl = ref(null)

// ---- Fullscreen：原生 Fullscreen API；document.fullscreenElement + fullscreenchange 为事实源
//（不维护手工 isFullscreen = !isFullscreen，ESC/浏览器 UI 退出后状态自动同步）。
// 生命周期与方向锁已抽到 composables/usePlaybackFullscreen.js（与 3D 共用同一套产品语义：
// 手机形态才锁横屏、锁在全屏成功之后、退出/卸载解锁、平板与桌面绝不请求方向锁）。----
const pbRoot = ref(null)
/* §three-forms：PC / tablet / mobile 三套互斥的布局形态，由 JS 判定后写成根类。
   互斥性由「只挂一个类」保证，而不是靠媒体查询之间的算术——旧写法里
   .pb-device-mobile(0,4,0) 会压掉宽度键控的规则(0,3,0)，一档的改动因此
   反复打穿另一档。三档与旧行为逐条等价：
     mobile = isMobileDevice（宽 <768，或触屏且高 <=500；见 shared/breakpoints PLAYBACK_MOBILE_QUERY）
     pc     = 非 mobile 且 >=1200
     tablet = 非 mobile 且 <1200（含 iPad / Android 平板；触屏只放大点击区域，不改形态） */
const wideLayout = ref(false)
const formFactor = computed(() => {
  if (isMobileDevice.value) return 'mobile'
  return wideLayout.value ? 'pc' : 'tablet'
})

// §mobile-contract：设备是否为「移动端」（primary pointer=coarse 且视口 <=1200px）。手机在
// fullscreen + landscape 时内宽可 >768，因此移动端判定不得只依赖 innerWidth<768；一旦判定为
// 移动端，无论全屏/横竖屏都保持 mobile playback mode（HUD+Stage 为主、bottom overlay controls、
// 紧凑控件密度）；几何本身仍由朝向决定，两种形态都没有常驻侧栏。
// §three-forms：与 wideLayoutQuery('(min-width: 1200px)') 必须严格互补。
// 手机形态由共享 contract 判定，横屏/全屏后与 3D 保持同一紧凑呈现。
const { isPhone: isMobileDevice } = usePlaybackPhoneForm()
/* §square-stage：正方形 Stage 的两种呈现由**视口朝向**决定，不由宽度决定（见
   composables/usePlaybackPortraitViewport.js）。竖屏是纵向流，横屏与宽档才是三段式。 */
const { isPortrait: isPhonePortrait } = usePlaybackPortraitViewport()
const phoneLandscape = computed(() => isMobileDevice.value && !isPhonePortrait.value)
const compactAnnotation = computed(() => annotationOpen.value && phoneLandscape.value)
let playbackLifecycleActive = true
let wideLayoutQuery = null
function onWideLayoutChange(event) {
  wideLayout.value = !!(event && event.matches)
}
/**
 * 全屏 / 方向锁生命周期与 3D 共用同一实现（composables/usePlaybackFullscreen）：
 * 事实源 `document.fullscreenElement`、手机形态才锁横屏、锁在全屏成功之后、退出与卸载解锁。
 * 这里只保留 2D 自己的**布局**反应：全屏进出后等 Vue 把控件搬进新的容器尺寸，
 * 用新 mode 的真实几何 force 一次 authoritative fit（geometry-signature 也会捕获 bottom inset 变化）。
 * 不用 setTimeout magic delay。
 */
const { isFullscreen, fullscreenSupported, toggleFullscreen, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => pbRoot.value,
  isPhone: isMobileDevice,
  isActive: () => playbackLifecycleActive,
  // fullscreenchange 只由 composable 监听；这里注入 2D 的布局反应（等 Vue 搬完 controls 再 force fit）。
  // fitViewIfReady 由下方相机提供（函数声明提升，调用时相机已创建）。
  onChange: () => nextTick(() => fitViewIfReady(true)),
})

const {
  mapEl,
  mapWidth,
  mapHeight,
  mapRenderRect,
  view,
  applyView,
  viewportStyle,
  markerTransform,
  overlayInverse,
  overlayInverseScale,
  screenPoint,
  fitScale,
  resetView,
  fitViewIfReady,
  disposeCamera,
} = usePlaybackCamera(mapView, {
  mapComponent,
  mapStageEl,
  isFullscreen: () => isFullscreen.value,
  wideLayout: () => wideLayout.value,
  isMobileDevice: () => isMobileDevice.value,
})

const {
  mapEngaged,
  wheelHintVisible,
  mapTouchPan,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onViewportClick,
  resetGestureState,
} = usePlaybackMapGestures(
  { view, applyView, screenPoint, fitScale },
  mapEl,
  {
    isFullscreen: () => isFullscreen.value,
    drawing: {
      activeTool: () => activeTool.value,
      // 编辑器在下方解构（声明顺序晚于本调用）——用惰性闭包避免 TDZ；事件期才求值。
      drawingPointerId: () => getDrawingPointerId(),
      drawingStartScreen: () => getDrawingStartScreen(),
      annotationOpen: () => annotationOpen.value,
      selectedAnnotationIndex: () => selectedAnnotationIndex.value,
      startDrawing: (e) => startDrawing(e),
      moveDrawing: (e) => moveDrawing(e),
      endDrawing: () => endDrawing(),
      cancelDrawing: () => cancelDrawing(),
      // 绘制会话的 pointerId 由编辑器 cancel/endDrawing 归零；此处无需再清。
      clearDrawingPointer: () => {},
    },
    selectAtPointer: (clientX, clientY) => selectAt(null, clientX, clientY),
    onPlainClick: () => mobileOverlay.value?.reveal?.(),
  },
)

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
  const rootRect = root.getBoundingClientRect()
  const style = getComputedStyle(root)
  const viewportH = window.visualViewport?.height || window.innerHeight
  const pageStyle = getComputedStyle(document.documentElement)
  const headerH = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  // Use viewport capacity, never a content-derived root height (which feeds back into Stage).
  // Scroll changes presentation position, not the workspace capacity.
  const top = isFullscreen.value ? 0 : headerH
  const workspaceH = Math.max(1, viewportH - top)
  root.style.setProperty('--pb-workspace-h', `${workspaceH}px`)
  const main = battlefieldWorkspaceEl.value
  const above = main ? Math.max(0, main.getBoundingClientRect().top - rootRect.top) : 0
  const content = transport?.closest?.('.pb-mobile-overlay-content')
  const controlsH = content?.getBoundingClientRect().height || transport?.getBoundingClientRect().height || 0
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 4
  const bottom = parseFloat(style.paddingBottom) || 0
  const hudH = hud?.getBoundingClientRect().height || 0
  const budget = Math.max(1, workspaceH - above - hudH - controlsH - gap * 2 - bottom)
  root.style.setProperty('--pb-square-avail-h', `${Math.floor(budget)}px`)
}

// 外壳沉浸态切换改的是 --header-h（不触发任何元素 resize），显式重算高度预算与默认 fit。
const shellChrome = inject(SHELL_CHROME_KEY, null)
watch(() => shellChrome?.immersive.value, () => nextTick(() => { writeSquareAvailHeight(); fitViewIfReady(true) }))

watch(() => mapStageEl.value, (el) => {
  if (stageResizeObserver) { stageResizeObserver.disconnect(); stageResizeObserver = null }
  if (!el || typeof ResizeObserver !== 'function') return
  stageResizeObserver = new ResizeObserver(writeSquareAvailHeight)
  stageResizeObserver.observe(el)
  if (pbRoot.value) stageResizeObserver.observe(pbRoot.value)
  if (transportEl.value) stageResizeObserver.observe(transportEl.value)
  const hud = pbRoot.value?.querySelector('.pb-hud')
  if (hud) stageResizeObserver.observe(hud)
  writeSquareAvailHeight()
}, { immediate: true })
watch(transportEl, (el, previous) => {
  if (previous && stageResizeObserver) stageResizeObserver.unobserve(previous)
  if (el && stageResizeObserver) stageResizeObserver.observe(el)
  nextTick(writeSquareAvailHeight)
})

/** 完整地图视图（contain/fit）与手势逻辑已迁移至 usePlaybackCamera / usePlaybackMapGestures
 *  （#820 Agent C Step 1）：MapRenderRect 仍是唯一屏幕坐标几何来源，wheel/pan/pinch 时序不变。 */

// ---- 回放数据源/位姿/弹药 resolver：唯一 owner = usePlaybackReplayData（#820 Agent C Step 3）；
// 位姿通道与 3D 场景同源同插值，reload 与名牌共享同一 resolver。
const {
  vehicleReloadAt,
  vehicleConsumablesAt,
  routesByAccount,
  vehiclesByAccount,
  poseSource,
  poseAtTime,
  reliefModelForPlayback,
  projectedSemanticNorm,
  reliefUnproject,
} = usePlaybackReplayData(mapView, {
  playback,
  playbackV2: () => props.playbackV2,
  reloadTelemetry: () => props.reloadTelemetry,
  poseFacet: () => props.poseFacet,
  clockOffset: () => props.clockOffset,
  mapCode: () => pbOverview.value.mapCode,
})

// ---- 地图标注：工具/绘制手势/文字会话/route 的唯一 owner = usePlaybackAnnotationEditor
// （#820 Agent C Step 2）；历史快照 / 草稿 / 选中项的事实源仍是 usePlaybackAnnotations。
const {
  annotationOpen,
  activeTool,
  routePoints,
  annotColor,
  annotVisible,
  annotWidthSlider,
  semPerSvgX,
  semPerSvgY,
  textSession,
  textInputStyle,
  renderedAnnotations,
  history,
  historyIndex,
  annotations,
  draft,
  selectedAnnotationIndex,
  selectedAnnotation,
  drawingPointerId: getDrawingPointerId,
  drawingStartScreen: getDrawingStartScreen,
  resetAnnotations,
  cancelDrawing,
  cancelRoute,
  toggleTool,
  toggleAnnotation,
  closeAnnotation,
  undoAnnot,
  redoAnnot,
  clearAll,
  setAnnotColor,
  toggleAnnotations,
  finishRoute,
  startDrawing,
  moveDrawing,
  endDrawing,
  commitSession,
  cancelSession,
  deleteSelected,
  renameSelected,
} = usePlaybackAnnotationEditor(
  { view, screenPoint, mapRenderRect, mapWidth, mapHeight },
  mapView,
  {
    textInputRef: () => mapComponent.value?.textInputRef || null,
    onOpen: () => { pause(); displayOpen.value = false },
    resetGestures: resetGestureState,
    reliefUnproject,
    projectedSemanticNorm,
    reliefHasModel: () => !!reliefModelForPlayback(),
    overview: () => props.overview,
  },
)

onMounted(() => {
  // window 级 pointermove/up/cancel 兜底监听由 usePlaybackMapGestures 挂载（#820 Agent C）
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
  window.addEventListener('resize', writeSquareAvailHeight)
})

/** 拖动进度条：按下即暂停，拖动中实时 seek，松开时若原先在播放则自动继续（与 3D 共用 usePlaybackTransport）。 */
function dragStart() {
  transport.scrubStart()
}

function dragEnd() {
  transport.scrubEnd()
}

// KeepAlive 停用（切到别的页面）时同样视为不可见
const lifecycleVisible = ref(true)
// 离开（能力切走 / 页面停用）时退出本回放拥有的全屏：组件被 v-show / KeepAlive 缓存不会卸载，
// 不主动退出的话 fullscreen root 仍是旧回放元素，新页面被挡在全屏层后面
onDeactivated(() => { lifecycleVisible.value = false; pause(); exitOwnedFullscreen() })
onActivated(() => { lifecycleVisible.value = true })
watch(() => props.active, (value) => { if (!value) { pause(); exitOwnedFullscreen() } })

/**
 * 播放传输行为与 3D 共用：空格 / ←→ 的键位、输入框不劫持、拖动暂停后自动继续。
 * 键盘监听仍由本组件在 onMounted / onBeforeUnmount 挂卸（与其它全局监听同一处管理），
 * 所以 keyboard: false，只借用 handleKeydown。
 */
const transport = usePlaybackTransport({
  isPlaying: () => playing.value,
  // 播放时钟在下方解构（声明顺序晚于本调用）——惰性闭包避免 TDZ；事件期才求值。
  play: () => play(),
  pause: () => pause(),
  step: (delta) => step(delta),
  isAtEnd: () => duration.value > 0 && currentTime.value >= duration.value,
  restart: () => seek(0),
  isActive: () => props.active && lifecycleVisible.value,
}, { keyboard: false })

function onKeydown(e) {
  if (!props.active || !lifecycleVisible.value || e.isComposing) return
  if (annotationOpen.value && !isInteractiveTarget(e.target)) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (routePoints.value.length || draft.value) cancelRoute()
      else if (selectedAnnotation.value) selectedAnnotationIndex.value = -1
      else closeAnnotation()
      return
    }
    if (e.key === 'Enter' && routePoints.value.length) { e.preventDefault(); finishRoute(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoAnnot() : undoAnnot(); return }
  }
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !isInteractiveTarget(e.target)) {
    e.preventDefault()
    setUiHidden(!uiHidden.value)
    return
  }
  transport.handleKeydown(e)
}

onBeforeUnmount(() => {
  playbackLifecycleActive = false
  paletteRequestToken += 1
  disposeClock()
  disposeCamera()
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
  window.removeEventListener('resize', writeSquareAvailHeight)
})

// BattleMap 的偏好 props 提升为 computed：内联对象字面量在父组件每次重渲染时都生成
// 新身份，会击穿 Vue 的 props 等值短路，迫使整个地图子树跟着重渲染。
const hpPrefsForMap = computed(() => ({ ...hpPrefs, showHp: !uiHidden.value && hpPrefs.showHp }))
const markerPrefsForMap = computed(() => ({
  classIcons: !uiHidden.value && markerPrefs.classIcons,
  showStatus: !uiHidden.value && markerPrefs.showStatus,
}))

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
const {
  currentTime,
  playing,
  speed,
  hpNoTransition,
  play,
  pause,
  seek,
  step,
  setSpeed,
  seekToEvent,
  disposeClock,
} = usePlaybackClock({
  duration: () => duration.value,
  loop: () => props.loop,
  nowMs,
  realNowMs,
  consumeEvents: (fromSec, toSec) => consumeEvents(fromSec, toSec),
  resetTransients: (sec) => resetTransients(sec),
  hasPendingTransients: (now) => hasPendingTransients(now),
  pruneTransients: (now) => pruneTransients(now),
  rewindTransientCursor: () => { eventCursor.value = 0 },
  feedVisible: () => !uiHidden.value && !!uiPrefs.showKillfeed,
  onPlayStart: () => { if (annotationOpen.value) closeAnnotation() },
  seekTo: () => props.seekTo,
})

// ---- 车辆呈现投影：preload/vehicleStates/着色/轨迹/炮线/marker 屏幕定位的唯一 owner
// = usePlaybackVehicleProjection（#820 Agent C Step 3，时间来自 playback clock）。
const {
  vehicleStates,
  visibleTracers,
  tracerColor,
  visibleTrails,
  canonicalMarkerScreen,
  markerScreen,
  hpFor,
  hpDisplayNumText,
} = usePlaybackVehicleProjection(
  mapView,
  { view, mapWidth, mapHeight, mapRenderRect, markerTransform, overlayInverse, overlayInverseScale },
  { poseAtTime, poseSource, vehicleReloadAt, vehicleConsumablesAt, routesByAccount, vehiclesByAccount, projectedSemanticNorm },
  {
    playbackV2: () => props.playbackV2,
    recorderAccountId: () => pbOverview.value.recorderAccountId,
    currentTime,
    speed,
    authoritativeEvents: () => authoritativeEvents.value,
    hpVehicles: () => hpVehicles.value,
    gunMarks: () => gunMarks.value,
    isMobileDevice,
    trailPrefs,
    palette,
    t,
  },
)

// The workspace's guide requests real actions; drawing and clock state stay here.
defineExpose({
  pause,
  displayOpened: () => displayOpen.value,
  // 教程要高亮的「一键防遮」在 Display 面里（#727 之后地图上不再放常驻控件），
  // 所以它必须能被 onboarding 的 display surface 打开 / 收回。
  openDisplay: () => {
    if (displayOpen.value) return false
    // 浮层形态要锚在 gear 上；gear 属于 PlaybackTransport，这里按 DOM 契约取它。
    toggleDisplay(pbRoot.value?.querySelector('[data-test="pb-secondary-entry"]') || null)
    return true
  },
  closeDisplay: () => { displayOpen.value = false },
  annotationsOpen: () => annotationOpen.value,
  openAnnotations: () => {
    if (annotationOpen.value) return false
    toggleAnnotation()
    return true
  },
  closeAnnotations: closeAnnotation,
})

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

// ---- 车辆选中 / 详情编排：selected / details 状态的唯一 owner = usePlaybackVehicleSelection
// （#820 Agent C Step 2）；hit-test 与浮窗落位经由同一相机变换与 workspace 坐标系。
const {
  selectedAccountId,
  detailsOpen,
  detailsSide,
  selectedState,
  detailsState,
  selectedTrack,
  selectedHealth,
  selectedPortraitUrl,
  selLastKnownSec,
  selCurStats,
  selDamageLog,
  openDetails,
  closeSidebar,
  onMarkerSelect,
  selectAt,
  selectFromRoster,
} = usePlaybackVehicleSelection(
  { view, mapEl, mapRenderRect, mapWidth },
  {
    vehicleStates,
    playback,
    currentTime,
    authoritativeEvents,
    hpVehicles,
    uiHidden,
    hpPrefs,
    markerPrefs,
    battlefieldWorkspaceEl,
    markerScreen,
    projectedSemanticNorm,
    mobileOverlay,
    t,
  },
)

// §队伍阵容：从 result 全量名单（playbackV2.vehicles）取，不依赖回放事件流/vehicleStates。
// 按权威 vehicle.team 保留物理身份；rosterTeams 按 Recorder 视角决定左右。
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

const rosterTeams = computed(() => rosterLanesFor(teamVehicles.value, friendlyTeam.value))

/**
 * Both physical team rosters use current destruction state from the same authoritative projection.
 */
const destroyedNow = computed(() => new Set(
  (props.playbackV2?.vehicles || []).filter(vehicle => healthDisplayAt(vehicle, currentTime.value)?.destroyed === true).map(vehicle => vehicle.accountId)))

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
 * 选中与详情可见性是**两个状态**（不是「选中了 ⟺ 详情开着」）：
 *   选车 → selectedAccountId = 车，detailsOpen = true
 *   详情 × → 只有 detailsOpen = false；选中、跟随、时间轴、倍速、名册与地图视图都不动
 *   再点同一台 / 另一台车 → 同一个详情窗重新打开（或换内容），永远只有一个窗
 */
/**
 * 名册每行显示的当前 HP（与地图标记同一个权威投影：healthDisplayAt）。
 *
 * 传的是**完整投影**而不只是 current/max：名册的 HP 呈现模型要区分 exact / relative /
 * unknown / destroyed（见 scene/rosterState.ts 的 hpPresentationFor）。`pct` 只在
 * `displayCapacityHp` 可信时才有值，`relativeFull` 是 backend 标注的「相对满状态」事实——
 * 两者都不可用时呈现层落到 unknown（`—`），绝不伪造 current/max。
 *
 * `pct` 直接取投影的原始比例，不预先取整：取整是呈现层的事（避免累积误差）。
 */
const rosterHealth = computed(() => {
  const out = {}
  for (const vehicle of props.playbackV2?.vehicles || []) {
    const display = healthDisplayAt(vehicle, currentTime.value)
    if (!display) continue
    out[vehicle.accountId] = {
      currentHp: display.currentHp,
      maxHp: display.displayCapacityHp,
      pct: display.pct,
      relativeFull: display.relativeFull === true,
      state: display.state,
    }
  }
  return out
})
/**
 * 名册每行的 reload（次级瞬时状态），按 accountId。
 *
 * 与地图名牌**同一个 resolver 调用**（`vehicleReloadAt` → 共享 `reloadStateAt`），
 * 所以「弹夹有几发、哪一发在装填、locked / empty 怎么显示」只有一份语义——
 * 名册不自己重算 reload。没有 telemetry 时值为 null，呈现层据此不显示 reload（不假设满弹）。
 */
const rosterReload = computed(() => {
  if (!props.reloadTelemetry) return null
  const out = {}
  for (const vehicle of props.playbackV2?.vehicles || []) {
    const shells = vehicleReloadAt(vehicle.accountId, currentTime.value)
    if (shells && shells.length > 0) out[vehicle.accountId] = shells
  }
  return out
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
    ...vehicleStates.value.map((st) => hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed
      ? healthRingDiameter(st, markerPrefs.classIcons) : st.markerSize?.renderBox?.width || 0),
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
      // Badge width (space-3) + inline gap (space-1), in fixed screen pixels.
      tankNameExtraWidth: st.gunMarks > 0 ? 16 : 0,
      playerName: st.playerName,
      // PR #107 Blocker 4：HP footprint 是否存在 = DOM 是否实际渲染 HUD（showHp 开且
      // health selector 有结果），不是 current 是否为 null——relativeFull（current=null）
      // 与 UNKNOWN 都会渲染 HUD（数字 — + bar），碰撞系统必须为它们建模真实盒。
      coreSize: hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed ? healthRingDiameter(st, markerPrefs.classIcons) : undefined,
      hpRing: hpPrefs.showHp && hpPrefs.mode === 'ring' && !st.destroyed,
      hpRendered: !uiHidden.value && hpPrefs.showHp && hpPrefs.mode === 'bar' && !st.destroyed && hp != null,
      // 实际渲染的数字文本（VehicleMarker .pb-hp-num 同款：current 有值→数字，否则 —）；
      // labelLayout 用它做「覆盖所有状态的保守盒宽」估算（与第一辆车实测宽取 max）
      hpDisplayText: hp ? hpDisplayNumText(hp) : '',
      hpBoxW,
      hpBoxH,
      // Hidden badges have no collision footprint in the compact presentation.
      selected: markerPrefs.showStatus && selectedAccountId.value === st.vehicle.accountId,
      destroyed: markerPrefs.showStatus && st.destroyed === true,
      recorder: markerPrefs.showStatus && st.recorder === true,
    }
  }).filter(Boolean)
  return computeLabelLayout(items, {
    showTank: !uiHidden.value && labelPrefs.showTankName,
    showPlayer: !uiHidden.value && labelPrefs.showPlayerName,
    viewportW: W,
    viewportH: W * (mapView.value.H / mapView.value.W),
    coreSize,
  })
})

/** VehicleMarker label prop（每 marker 一个：显示开关 + 碰撞位移 +
 *  §25 blockHidden/hpHidden：不可分离碰撞时的优先级隐藏兼容输出，恒 false）。 */
function markerLabel(accountId) {
  const l = labelLayout.value.get(accountId)
  return {
    showPlayer: !uiHidden.value && labelPrefs.showPlayerName,
    showTank: !uiHidden.value && labelPrefs.showTankName,
    showReload: !uiHidden.value && hpPrefs.mode !== 'ring' && labelPrefs.showReload,
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

watch([uiHidden, () => uiPrefs.showTopbar, () => uiPrefs.showBaseStatus, () => hudBaseStates.value.length], async () => {
  await nextTick()
  const hud = pbRoot.value?.querySelector('.pb-hud')
  if (hud && stageResizeObserver) stageResizeObserver.observe(hud)
  writeSquareAvailHeight()
})

const mapStyle = computed(() => ({
  '--pb-map-aspect': `${mapView.value.W} / ${mapView.value.H}`,
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
  <div v-if="image && playback" ref="pbRoot" class="battle-playback playback-workspace" :class="{ 'pb-device-mobile': isMobileDevice, 'pb-phone-landscape': phoneLandscape, 'pb-controls-bottom': true, 'pb-roster-lanes': rosterLanes, ['pb-form-' + formFactor]: true }" :style="mapStyle" data-scene-surface data-test="battle-playback">
    <!-- 移动端全屏入口统一右上角浮动（与 Map Preview 3D / Replay 3D 同一组件同一位置）；
         传输条里的内联按钮在手机形态由 floatingFullscreen 隐藏，桌面保持原位。 -->
    <SceneFullscreenButton
      v-if="isMobileDevice && fullscreenSupported"
      floating
      :is-fullscreen="isFullscreen"
      data-test="pb-fullscreen"
      data-testid="playback-fullscreen"
      data-tour="playback-floating-fullscreen"
      @toggle="toggleFullscreen"
    />


    <div ref="battlefieldWorkspaceEl" class="pb-main" :class="{ 'pb-roster-lanes': rosterLanes }" data-test="pb-main">
    <BattlePlaybackHud
      v-if="!uiHidden && (uiPrefs.showTopbar || (uiPrefs.showBaseStatus && hudBaseStates.length))"
      :show-summary="uiPrefs.showTopbar"
      :map-title="mapLabel(pbOverview.mapCode, locale) || pbOverview.mapCode || ''"
      :battle-time="formatClock(currentTime)"
      :friendly-hp="friendlyHp"
      :enemy-hp="enemyHp"
      :friendly-points="friendlyPoints"
      :enemy-points="enemyPoints"
      :base-states="uiPrefs.showBaseStatus ? hudBaseStates : []"
      :friendly-team="friendlyTeam"
      :hp-no-transition="hpNoTransition"
      :compact="phoneLandscape"
    />
      <!-- §square-stage 三段式：己方 | 正方形 Stage | 敌方。
           两侧车道只在「名册开着 且 非手机竖屏」时存在；关掉名册两侧整体消失，
           Stage 依然居中且保持正方形（绝不被拉宽填满）。 -->
      <div v-if="rosterLanes" class="pb-team-lane pb-team-lane-left" data-test="pb-team-lane-left" :aria-label="$t('recon.map.team_friendly')">
        <PlaybackRoster :gun-marks="gunMarks" :teams="rosterTeams.left" :friendly-team="friendlyTeam" :destroyed="destroyedNow" :health="rosterHealth" :reload="rosterReload" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" @select="selectFromRoster" />
      </div>
      <div class="pb-map-stage" ref="mapStageEl">
        <BattleMap
          data-tour="playback-map"
          ref="mapComponent"
          :image="image"
          :image-src="imageSrc"
          :map-view="mapView"
          :pb-overview="pbOverview"
          :friendly-team="friendlyTeam"
          :bases="basesAt"
          :visible-tracers="visibleTracers"
          :visible-trails="visibleTrails"
          :tracer-color="tracerColor"
          :view-scale="view.scale"
          :viewport-style="viewportStyle"
          :annot-visible="annotVisible"
          :rendered-annotations="renderedAnnotations"
          :annot-font-size="ANNOT_FONT_SIZE"
          :active-tool="activeTool"
          :vehicle-states="vehicleStates"
          :selected-account-id="selectedAccountId"
          :marker-label="markerLabel"
          :hp-for="hpFor"
          :hp-prefs="hpPrefsForMap"
          :marker-prefs="markerPrefsForMap"
          :translate="t"
          :ghost-for="ghostFor"
          :flash-for="flashFor"
          :hp-no-transition="hpNoTransition"
          :text-session="textSession"
          :text-input-style="textInputStyle"
          :visible-floats="markerPrefs.showStatus ? visibleFloats : []"
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


      </div>

      <!-- §details-float：详情是**整个战场 workspace（.pb-main）顶层**的可拖动浮窗，不属于
           Stage、也不属于任何一条名册车道——它可以被拖到 Team 1 / Stage / Team 2 任意一栏之上。
           宿主就是它的定位祖先 `.pb-main`（同一个坐标系）；位置/边界/初始落位由
           usePlaybackDetailsPlacement 独占（含「不得盖住传输控件」的保护边界）。 -->
      <VehicleDetailsPanel
        :gun-marks="gunMarks.get(selectedAccountId) ?? null"
        v-if="!uiHidden && detailsFloating && detailsState"
        presentation="floating"
        :phone-form="false"
        :selected-state="detailsState"
        :selected-portrait-url="selectedPortraitUrl"
        :health="selectedHealth"
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

      <div v-if="rosterLanes" class="pb-team-lane pb-team-lane-right" data-test="pb-team-lane-right" :aria-label="$t('recon.map.team_enemy')">
        <PlaybackRoster :gun-marks="gunMarks" :teams="rosterTeams.right" :friendly-team="friendlyTeam" :destroyed="destroyedNow" :health="rosterHealth" :reload="rosterReload" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" @select="selectFromRoster" />
      </div>

      <PlaybackMobileOverlay v-if="!uiHidden" ref="mobileOverlay" :paused="!playing">
        <div ref="transportEl" class="pb-transport-slot" data-test="pb-transport-slot">
        <div v-if="!phoneLandscape" class="pb-replay-mode-bar">
          <button type="button" class="pb-annotation-entry" :class="{ active: annotationOpen }" data-test="pb-annotation-entry" data-tour="playback-annotation-entry" :aria-pressed="annotationOpen" @click="toggleAnnotation">
            <PencilRuler :size="18" aria-hidden="true" /> {{ $t('recon.map.playback.annot.mode') }}
          </button>
          <span>{{ $t(annotationOpen ? 'recon.map.playback.annot.mode_hint' : 'recon.map.playback.annot.watch_hint') }}</span>
        </div>
        <div v-show="!compactAnnotation" data-test="pb-transport-controls">
        <PlaybackControls
          :playing="playing"
          :speed="speed"
          :current-time="currentTime"
          :duration="duration"
          :fullscreen-supported="fullscreenSupported"
          :is-fullscreen="isFullscreen"
          :floating-fullscreen="isMobileDevice"
          :display-open="displayOpen"
          :annotation-enabled="phoneLandscape && !annotationOpen"
          :nav-eligible="active && lifecycleVisible && !compactAnnotation"
          @toggle-annotation="toggleAnnotation"
          :format-clock="formatClock"
          @toggle-play="transport.togglePlay()"
          @step="step"
          @set-speed="setSpeed"
          @toggle-fullscreen="toggleFullscreen"
          @toggle-panels="toggleDisplay"
          @drag-start="dragStart"
          @drag-end="dragEnd"
          @seek="seek"
        />
        </div>
        <!-- One annotation toolbar in the transport flow in every form. -->
        <div v-if="annotationOpen" class="pb-annotation-surface">
          <AnnotationToolbar
            :open="annotationOpen"
            :compact="compactAnnotation"
            :active-tool="activeTool"
            :selected-annotation="selectedAnnotation"
            :route-point-count="routePoints.length"
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
            @set-annot-color="setAnnotColor"
            @rename-selected="renameSelected"
            @delete-selected="deleteSelected"
            @finish-route="finishRoute"
            @cancel-route="cancelRoute"
            @update:annot-width="annotWidthSlider = $event"
            @undo="undoAnnot"
            @redo="redoAnnot"
            @clear-annotations="clearAll"
            @toggle-annotations="toggleAnnotations"
          />
        </div>
        </div>
      </PlaybackMobileOverlay>

      <PlaybackDisplaySurface :open="displayOpen && !uiHidden" :portrait="inlineStack" :anchor="displayAnchor" :host="battlefieldWorkspaceEl" @close="displayOpen = false">
        <template v-if="displaySection === 'events'">
          <button type="button" class="pb-tool-row pb-display-close" data-test="pb-events-back" @click="displaySection = 'display'">{{ $t('recon.map.playback.back') }}</button>
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
        <template v-else>
        <button type="button" class="pb-tool-row pb-display-close" data-testid="display-close" @click="displayOpen = false">{{ $t('app.close') }}</button>
        <p class="pb-display-heading">{{ $t('agentReplay.display_battlefield') }}</p>
        <div class="pb-panel-options" data-test="pb-panel-content-display">
          <label><input data-test="pb-show-hud" type="checkbox" :checked="uiPrefs.showTopbar" @change="uiPrefs.showTopbar = $event.target.checked"> {{ $t('agentReplay.display_topbar') }}</label>
          <label><input data-test="pb-show-base" type="checkbox" :checked="uiPrefs.showBaseStatus" @change="uiPrefs.showBaseStatus = $event.target.checked"> {{ $t('agentReplay.display_base') }}</label>
          <label><input data-test="pb-show-killfeed" type="checkbox" :checked="uiPrefs.showKillfeed" @change="uiPrefs.showKillfeed = $event.target.checked"> {{ $t('agentReplay.display_killfeed') }}</label>
          <label><input data-test="pb-show-roster" type="checkbox" :checked="uiPrefs.showRoster" @change="uiPrefs.showRoster = $event.target.checked"> {{ $t('agentReplay.display_roster') }}</label>
        </div>
        <p class="pb-display-heading">{{ $t('agentReplay.display_labels') }}</p>
        <div class="pb-panel-options">
          <label><input data-test="pb-class-icons" type="checkbox" :checked="markerPrefs.classIcons" @change="markerPrefs.classIcons = $event.target.checked"> {{ $t('recon.map.playback.class_icons') }}</label>
          <label><input data-test="pb-show-status" type="checkbox" :checked="markerPrefs.showStatus" @change="markerPrefs.showStatus = $event.target.checked"> {{ $t('recon.map.playback.show_status') }}</label>
          <label><input data-test="pb-show-player" type="checkbox" :checked="labelPrefs.showPlayerName" @change="labelPrefs.showPlayerName = $event.target.checked"> {{ $t('recon.map.playback.show_player_name') }}</label>
          <label><input data-test="pb-show-tank" type="checkbox" :checked="labelPrefs.showTankName" @change="labelPrefs.showTankName = $event.target.checked"> {{ $t('recon.map.playback.show_tank_name') }}</label>
          <label><input data-test="pb-show-hp" type="checkbox" :checked="hpPrefs.showHp" @change="hpPrefs.showHp = $event.target.checked"> {{ $t('recon.map.playback.show_hp') }}</label>
          <label><input data-test="pb-show-trail" type="checkbox" :checked="trailPrefs.showTrail" @change="trailPrefs.showTrail = $event.target.checked"> {{ $t('recon.map.playback.show_trail_2s') }}</label>
          <label><input data-test="pb-show-reload" type="checkbox" :checked="hpPrefs.mode !== 'ring' && labelPrefs.showReload" :disabled="hpPrefs.mode === 'ring'" @change="labelPrefs.showReload = $event.target.checked"> {{ $t('agentReplay.display_reload') }}</label>
        </div>
        <p class="pb-display-heading">{{ $t('recon.map.playback.hp_mode') }}</p>
        <SegmentedControl v-model="hpPrefs.mode" :options="hpModeOptions" :aria-label="$t('recon.map.playback.hp_mode')" />
        <p v-if="hpPrefs.mode === 'ring'" class="pb-display-heading">{{ $t('recon.map.playback.hp_ring_hint') }}</p>
        <div class="pb-panel-tools" data-test="pb-panel-tools">
          <!-- §5 遮挡契约：呈现类开关收在这块已有的瞬态面里，地图上不再放常驻控件。
               实测 740×360 下 `.pb-map` 只有 96×96，任何 44×44 的常驻入口都会占掉 10.7%
               并压进中心保护区，所以这些开关没有"放在地图角上"的合规位置。 -->
          <button type="button" class="pb-tool-row" data-test="pb-declutter" data-tour="playback-declutter" :aria-pressed="declutterActive" :title="$t('recon.map.playback.declutter_hint')" @click="toggleDeclutter()">
            <ScanEye :size="16" aria-hidden="true" /> {{ $t('recon.map.playback.declutter') }}
          </button>
          <button type="button" class="pb-tool-row" data-test="pb-panel-reset" @click="resetView()">
            <span aria-hidden="true">⟲</span> {{ $t('recon.map.playback.reset_view') }}
          </button>
          <button type="button" class="pb-tool-row" data-test="pb-panel-events" @click="displaySection = 'events'">{{ $t('recon.map.playback.panel_events') }}</button>
          <button type="button" class="pb-tool-row" data-test="pb-hide-all-ui" @click="setUiHidden(true)">{{ $t('agentReplay.hide_all_ui') }}</button>
        </div>
        </template>
      </PlaybackDisplaySurface>

      <button v-if="uiHidden" type="button" class="pb-ui-restore" :class="{ 'pb-ui-restore-shifted': isMobileDevice && fullscreenSupported }" data-test="pb-show-all-ui" :title="$t('agentReplay.show_all_ui_hint')" @click="setUiHidden(false)">{{ $t('agentReplay.show_all_ui') }}</button>

      <!-- §square-stage 手机竖屏纵向流：传输控件之后是详情（inline）与 Team 1 / Team 2。
           竖屏利用的是**纵向**空间，所以这一段就是普通流内容，跟着页面滚，不设高度上限。
           详情与名册各自独立：名册关掉时详情照样可以开着，反之亦然。 -->
      <div v-if="!uiHidden && inlineStack && (detailsState || showRosterPresentation)" class="pb-inline-area" data-test="pb-inline-area">
        <!-- 竖屏的详情：同一个组件、同一份 props，只是换成流内呈现（没有拖动柄）。 -->
        <VehicleDetailsPanel
          :gun-marks="gunMarks.get(selectedAccountId) ?? null"
          v-if="detailsState"
          presentation="inline"
          :phone-form="isMobileDevice"
          :selected-state="detailsState"
          :selected-portrait-url="selectedPortraitUrl"
          :health="selectedHealth"
          :sel-last-known-sec="selLastKnownSec"
          :sel-cur-stats="selCurStats"
          :selected-track="selectedTrack"
          :current-time="currentTime"
          :sel-damage-log="selDamageLog"
          :format-clock="formatClock"
          @close="closeSidebar"
        />
        <PlaybackRoster
          :gun-marks="gunMarks"
          v-if="showRosterPresentation"
          :teams="teamVehicles" :friendly-team="friendlyTeam"
          :destroyed="destroyedNow"
          :health="rosterHealth"
          :selected-id="selectedAccountId"
          @select="selectFromRoster"
        />
      </div>

      <!-- 手机名册没有「打开名册」这种独立开关：竖屏在上面的纵向流里，横屏 / 全屏横屏在
           Team 1 | Stage | Team 2 两侧车道里；唯一的呈现偏好是 uiPrefs.showRoster。 -->

      <div v-if="!uiHidden && uiPrefs.showKillfeed && visibleFeed.length" class="pb-kill-feed" data-test="pb-kill-feed" aria-hidden="true">
        <div v-for="feed in visibleFeed" :key="'feed-' + feed.id" class="pb-feed-item" :class="feed.victimFriendly === true ? 'pb-feed-friendly' : (feed.victimFriendly === false ? 'pb-feed-enemy' : 'pb-feed-neutral')"><span class="pb-feed-skull" aria-hidden="true">☠</span><span class="pb-feed-victim">{{ feed.victimPlayerName ? feed.victimPlayerName + '（' + feed.victimName + '）' : feed.victimName }}</span><span class="pb-feed-destroyed">{{ $t('recon.map.playback.feed_destroyed') }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Display 面的内容外观；位置与边界归 PlaybackDisplaySurface。 */
.pb-display-heading { margin: var(--space-1) 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 700; }
.pb-tool-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--hit-min);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  font-weight: 600;
  text-align: start;
  cursor: pointer;
}
/* 关闭行是最小命中区的下限所在（§5 可见即可达）：`inline-size: auto` 会收缩到 42px，
   触控档要求 44×44，所以显式给下限。 */
.pb-display-close { inline-size: auto; min-inline-size: var(--hit-min); min-block-size: var(--hit-min); align-self: flex-end; color: var(--color-text-secondary); }
.pb-panel-tools { display: grid; gap: var(--space-1); }
.pb-ui-restore { position: absolute; inset-block-start: var(--space-2); inset-inline-end: var(--space-2); z-index: var(--pb-z-modal); min-block-size: var(--hit-min); padding: var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-text-primary); font: var(--type-caption); }

/* 手机形态右上角有浮动全屏按钮：restore 按钮下移一行，两者不互抢命中区 */
.pb-ui-restore.pb-ui-restore-shifted { inset-block-start: calc(var(--space-2) + var(--hit-min) + var(--space-2)); }

.pb-wheel-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: var(--pb-z-hud);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-scrim);
  color: var(--color-text-primary);
  font: var(--type-body);
  pointer-events: none;
  transform: translate(-50%, -50%);
}
/* 这里只保留**组件根元素**的规则：scoped 属性会落在子组件根节点上，所以 `.pb-map`（BattleMap
   根）与 `.pb-vehicle`（VehicleMarker 根）能匹配；`.pb-map` 剩下的一半外观归 BattleMap 自己，
   那里的定位（`.pb-viewport` absolute 等）与这里曾经的默认值互相矛盾，已随矛盾规则一并删除。 */
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; }
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

/* transient 反馈层（floating damage / destruction burst）的外观归 BattleMap：那几个节点是
   BattleMap 自己的后代（`.pb-map[data-v-this]` 匹配不到它们），这里的同名规则永远不会生效。 */

.pb-kill-feed {
  position: absolute;
  top: calc(max(8px, env(safe-area-inset-top)) + 50px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: var(--pb-z-hud);
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
  .pb-feed-item { animation: none; }
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
</style>
