import { gunMarksByAccount } from '../utils/gunMarks.js'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackWorkspaceToggles } from '../composables/usePlaybackWorkspaceToggles'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackTransients } from '../composables/usePlaybackTransients.js'
import { usePlaybackCamera } from '../composables/usePlaybackCamera.js'
import { usePlaybackAnnotationEditor } from '../composables/usePlaybackAnnotationEditor.js'
import { usePlaybackVehicleSelection } from '../composables/usePlaybackVehicleSelection.js'
import { usePlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import { usePlaybackClock } from '../composables/usePlaybackClock.js'
import { usePlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection.js'
import { useBattlePlaybackRoster } from './useBattlePlaybackRoster.js'
import { useBattlePlaybackMapModel } from './useBattlePlaybackMapModel.js'
import { useBattlePlaybackLifecycle } from './useBattlePlaybackLifecycle.js'
import { useBattlePlaybackPresentation } from './useBattlePlaybackPresentation.js'
import { usePlaybackMapGestures } from '../composables/usePlaybackMapGestures.js'

export function useBattlePlaybackModel(props) {
const mapSemantics = Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', {
  eager: true, import: 'default',
}))

const { t, locale } = useI18n()
const gunMarks = computed(() => gunMarksByAccount(props.result))
const uiHidden = ref(false)

/**
 * 呈现元数据（Battle Playback PRIMARY 核心输入）：V2 canonical dataset 为权威源
 * （mapCode / friendlyTeam / recorderAccountId / arenaBonusType），MapOverview 仅提供可选 overlay
 * 事实（gridCells / spawnPoints / routes / playableBounds）。V2 metadata 缺失保持 null；不从 overview 推导。
 * 副要求：Battle Playback 不依赖 MapOverview artifact 存在才能渲染。
 */
const {
  pbOverview, image, imageSrc, mapView, palette, playback, duration, friendlyTeam,
  hpVehicles, friendlyHp, enemyHp, friendlyPoints, enemyTeam, enemyPoints, baseStatesAt,
  disposeMapPresentation,
} = useBattlePlaybackMapModel(props, () => currentTime.value)

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
// visibleFeed 由 usePlaybackTransients 提供（activeFeed 权威队列投影）。
// §mobile-panels：二级面没有常驻左栏——唯一入口是 Transport 上的 gear，打开的是
// `PlaybackDisplaySurface`（Display / Events 两段）。
/**
 * 名册呈现开关：**唯一 owner** 是共享呈现偏好 `uiPrefs.showRoster`（与 3D 同一个 key）。
 * 所有 2D 名册呈现——宽档 / 横屏的两侧车道、竖屏的纵向流名册——都必须读它，
 * 不允许出现「名册关了但别处还列着全部玩家」这种割裂语义。
 * 关掉**只关呈现**：名册数据（teamVehicles）、选中车辆、详情、时间轴、地图视图与相机
 * 全部保留；恢复后立刻可用，不重建播放、不重解析。
 */
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

// Fullscreen API 与方向锁生命周期归 usePlaybackFullscreen。
const pbRoot = ref(null)
// 三档互斥：手机由 usePlaybackPhoneForm 判定；非手机以 1200px 分 PC / tablet。
const wideLayout = ref(false)
const formFactor = computed(() => {
  if (isMobileDevice.value) return 'mobile'
  return wideLayout.value ? 'pc' : 'tablet'
})

// 手机判定沿用共享 contract，全屏横屏不能仅按宽度判定为桌面。
const { isPhone: isMobileDevice } = usePlaybackPhoneForm()
/* §square-stage：正方形 Stage 的两种呈现由**视口朝向**决定，不由宽度决定（见
   composables/usePlaybackPortraitViewport.js）。竖屏是纵向流，横屏与宽档才是三段式。 */
const { isPortrait: isPhonePortrait } = usePlaybackPortraitViewport()
const phoneLandscape = computed(() => isMobileDevice.value && !isPhonePortrait.value)
const compactAnnotation = computed(() => annotationOpen.value && phoneLandscape.value)

// 折叠/名册状态归 usePlaybackWorkspaceToggles；下方关闭函数通过惰性闭包调用。
const { controlsCollapsed, controlsContentId, toggleControlsCollapsed, rosterLanesOpen, toggleRosterLanes } =
  usePlaybackWorkspaceToggles({ phoneLandscape, onCollapse: () => { displayOpen.value = false; closeAnnotation() } })
// Presentation-only height bookkeeping: the existing disclosure ref remains the sole state owner.
const transportToggleEl = ref(null)
const transportContentEl = ref(null)
function freezeTransportHeight(el) { el.style.height = `${el.getBoundingClientRect().height}px` }
function startTransportEnter(el) {
  // A cancelled leave has already frozen the current visible height.
  if (!el.style.height) el.style.height = '0px'
}
function openTransportHeight(el) {
  void el.offsetHeight
  el.style.height = `${el.scrollHeight}px`
}
function closeTransportHeight(el) {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearTransportHeight(el) { el.style.height = '' }
function toggleTransport() {
  if (!controlsCollapsed.value && transportContentEl.value?.contains(document.activeElement)) {
    transportToggleEl.value?.focus({ preventScroll: true })
  }
  toggleControlsCollapsed()
}
const playbackLifecycle = { active: true }
const lifecycleVisible = ref(true)
// 全屏变化后等 Vue 更新布局再 force fit；事件与方向锁仍由共享 composable 所有。
const { isFullscreen, pseudoFullscreen, fullscreenSupported, toggleFullscreen, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => pbRoot.value, pseudoFallback: true, // 原生全屏不可用 / 被拒时降级为 CSS 伪全屏
  isPhone: isMobileDevice,
  isActive: () => playbackLifecycle.active && props.active && lifecycleVisible.value,
  onChange: () => nextTick(() => fitViewIfReady(true)),
  auto: () => ({ token: props.autoFullscreen?.token ?? 0, key: props.autoFullscreen?.key, ready: true, active: props.active && lifecycleVisible.value }),
})

const floatingFullscreenRow = computed(() => isMobileDevice.value && fullscreenSupported.value && !phoneLandscape.value && !uiHidden.value) // 竖屏手机浮动全屏按钮自占一行（.pb-fs-reserve）
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
// （#820 Agent C Step 2）；历史快照 / 草稿 / 选中项的事实源仍是 useAnnotationState。
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

// BattleMap 的偏好 props 提升为 computed：内联对象字面量在父组件每次重渲染时都生成
// 新身份，会击穿 Vue 的 props 等值短路，迫使整个地图子树跟着重渲染。
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
const exposed = {
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
}



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

const {
  setUiHidden, hpPrefsForMap, markerPrefsForMap, visibleFloats, visibleBursts,
  eventLabel, showRosterPresentation,
} = useBattlePlaybackPresentation({
  computed, uiHidden, t, nowMs, floatItems, burstItems, vehicleStates, markerScreen,
  hpPrefs, markerPrefs, vehiclesByAccount, closeAnnotation, displayOpen, uiPrefs,
})

const { transport, stageResizeObserver, writeSquareAvailHeight, dragStart, dragEnd } = useBattlePlaybackLifecycle({
  props, lifecycleVisible, wideLayout, playbackLifecycle,
  pbRoot, mapStageEl, transportEl, battlefieldWorkspaceEl, isFullscreen,
  fitViewIfReady, pause, exitOwnedFullscreen, disposeClock, disposeCamera, disposeMapPresentation,
  annotationOpen, routePoints, draft, cancelRoute, selectedAnnotation, selectedAnnotationIndex,
  closeAnnotation, finishRoute, deleteSelected, redoAnnot, undoAnnot, setUiHidden, uiHidden,
  duration, currentTime, playing, play, step, seek,
})

const {
  teamVehicles, rosterTeams, destroyedNow, rosterLanes, rosterEntryVisible, hudClockVisible,
  inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass, labelLayout,
  markerLabel, baseStatus, capturedBy, hudBaseStates, basesAt, mapStyle,
} = useBattlePlaybackRoster({
  computed, watch, nextTick, props, currentTime, playback, pbOverview, baseStatesAt, friendlyTeam,
  mapSemantics, showRosterPresentation, isPhonePortrait, rosterLanesOpen, uiHidden,
  uiPrefs, pbRoot, stageResizeObserver, writeSquareAvailHeight, vehicleReloadAt,
  vehicleStates, mapWidth, mapView, hpPrefs, markerPrefs, mapEl, markerScreen, hpFor,
  hpDisplayNumText, selectedAccountId, labelPrefs, palette,
})
return {
  t, locale, gunMarks, uiHidden, pbOverview, image, imageSrc, mapView,
  playback, duration, friendlyTeam, friendlyHp, enemyHp, friendlyPoints, enemyPoints, labelPrefs,
  hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter, hpModeOptions, ghostFor,
  flashFor, visibleFeed, mobileOverlay, transportEl, displayOpen, displaySection, displayAnchor, toggleDisplay,
  battlefieldWorkspaceEl, mapComponent, mapStageEl, pbRoot, formFactor, isMobileDevice, phoneLandscape, compactAnnotation,
  controlsCollapsed, controlsContentId, rosterLanesOpen, toggleRosterLanes, transportToggleEl, transportContentEl, freezeTransportHeight, startTransportEnter,
  openTransportHeight, closeTransportHeight, clearTransportHeight, toggleTransport, lifecycleVisible, isFullscreen, pseudoFullscreen, fullscreenSupported,
  toggleFullscreen, floatingFullscreenRow, view, viewportStyle, resetView, wheelHintVisible, mapTouchPan, onWheel,
  onPointerDown, onPointerMove, onPointerUp, onViewportClick, annotationOpen, activeTool, routePoints, annotColor,
  annotVisible, annotWidthSlider, textSession, textInputStyle, renderedAnnotations, history, historyIndex, annotations,
  selectedAnnotation, cancelRoute, toggleTool, toggleAnnotation, closeAnnotation, undoAnnot, redoAnnot, clearAll,
  setAnnotColor, toggleAnnotations, finishRoute, commitSession, cancelSession, deleteSelected, renameSelected, currentTime,
  playing, speed, hpNoTransition, play, seek, step, setSpeed, seekToEvent,
  vehicleStates, visibleTracers, tracerColor, visibleTrails, hpFor, userVisibleEvents, selectedAccountId, detailsSide,
  detailsState, selectedTrack, selectedHealth, selectedPortraitUrl, selLastKnownSec, selCurStats, selDamageLog, closeSidebar,
  onMarkerSelect, selectFromRoster, setUiHidden, hpPrefsForMap, markerPrefsForMap, visibleFloats, visibleBursts, eventLabel,
  showRosterPresentation, transport, dragStart, dragEnd, teamVehicles, rosterTeams, destroyedNow, rosterLanes,
  rosterEntryVisible, hudClockVisible, inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass, markerLabel,
  hudBaseStates, basesAt, mapStyle, exposed
}

}
