import { computed, inject, nextTick, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { usePlaybackWorkspaceToggles } from '../composables/usePlaybackWorkspaceToggles'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackCamera } from '../composables/usePlaybackCamera.js'
import type { PlaybackMapBridge, PlaybackMapViewLike } from '../composables/usePlaybackCamera.js'
import { usePlaybackMapGestures } from '../composables/usePlaybackMapGestures.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { usePlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import { usePlaybackAnnotationEditor } from '../composables/usePlaybackAnnotationEditor.js'
import { usePlaybackVehicleSelection } from '../composables/usePlaybackVehicleSelection.js'
import type { BattlePlaybackDataset } from '../types/playback-v2.js'

type ReplayDataDeps = Parameters<typeof usePlaybackReplayData>[1]
type ReloadTelemetry = ReturnType<ReplayDataDeps['reloadTelemetry']>
type PoseFacet = ReturnType<ReplayDataDeps['poseFacet']>

type SelectionSelectAt = ReturnType<typeof usePlaybackVehicleSelection>['selectAt']

/** B 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
export interface BpBParts {
  mapView: Ref<PlaybackMapViewLike>
  pause: () => void
  pbOverview: Ref<{ mapCode: string | null }>
  playback: ComputedRef<BattlePlaybackDataset | null>
  selectAt: SelectionSelectAt
  uiPrefs: { showRoster?: boolean }
}

export interface BpBProps {
  active: boolean
  autoFullscreen: { token?: number; key?: string } | null
  clockOffset: number | null
  overview: unknown
  playbackV2: BattlePlaybackDataset | null
  poseFacet: PoseFacet
  reloadTelemetry: ReloadTelemetry
}

export function bpB(S: BpBParts, props: BpBProps): void {

const uiHidden = ref(false)
function setUiHidden(hidden: boolean): void {
  uiHidden.value = hidden
  if (hidden) { displayOpen.value = false; closeAnnotation() }
}
// §mobile-panels：二级面唯一入口 = Transport 的 gear（PlaybackDisplaySurface 两段）。
/**
 * 名册呈现开关：**唯一 owner** 是共享呈现偏好 `uiPrefs.showRoster`（与 3D 同一个 key）。
 * 所有 2D 名册呈现——宽档 / 横屏的两侧车道、竖屏的纵向流名册——都必须读它，
 * 不允许出现「名册关了但别处还列着全部玩家」这种割裂语义。
 * 关掉**只关呈现**：名册数据（teamVehicles）、选中车辆、详情、时间轴、地图视图与相机
 * 全部保留；恢复后立刻可用，不重建播放、不重解析。
 */
const showRosterPresentation = computed(() => !uiHidden.value && S.uiPrefs.showRoster !== false)
const mobileOverlay = ref<{ reveal?: () => void } | null>(null)
/** §details-float：详情浮窗的受保护下界 = 传输控件（竖屏/横屏同一处，防盖拇指操作区）。 */
const transportEl = ref<HTMLElement | null>(null)
const displayOpen = ref(false)
const displaySection = ref('display')
const displayAnchor = ref<HTMLElement | null>(null)
function toggleDisplay(anchor: HTMLElement | null): void { displayAnchor.value = anchor; displaySection.value = 'display'; displayOpen.value = !displayOpen.value }
/** 整个战场 workspace（`.pb-main`：Team 1 | Stage | Team 2 + 浮窗）——详情浮窗的定位祖先与
    拖动宿主。浮窗是它的直接子元素，`left/top`、夹紧与拖动在同一个坐标系里算；
    它不是 `.pb-map-stage`（那只是中间一栏，按它算会把浮窗关在 Stage 里）。 */
const battlefieldWorkspaceEl = ref<HTMLElement | null>(null)
// ---- 地图视图缩放/平移：单一 camera layer 保证地图/网格/炮线/标记严格对齐 ----
// 相机状态（view / MapRenderRect / fit）的唯一 owner = usePlaybackCamera（#820 Agent C）；
// 手势状态机（pointer/pan/pinch/wheel）的唯一 owner = usePlaybackMapGestures。
const mapComponent = ref<PlaybackMapBridge | null>(null)
const mapStageEl = ref<HTMLElement | null>(null)

// Fullscreen API 与方向锁生命周期归 usePlaybackFullscreen。
const pbRoot = ref<HTMLElement | null>(null)
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
const transportToggleEl = ref<HTMLElement | null>(null)
const transportContentEl = ref<HTMLElement | null>(null)
function freezeTransportHeight(el: HTMLElement): void { el.style.height = `${el.getBoundingClientRect().height}px` }
function startTransportEnter(el: HTMLElement): void {
  // A cancelled leave has already frozen the current visible height.
  if (!el.style.height) el.style.height = '0px'
}
function openTransportHeight(el: HTMLElement): void {
  void el.offsetHeight
  el.style.height = `${el.scrollHeight}px`
}
function closeTransportHeight(el: HTMLElement): void {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearTransportHeight(el: HTMLElement): void { el.style.height = '' }
function toggleTransport() {
  if (!controlsCollapsed.value && transportContentEl.value?.contains(document.activeElement)) {
    transportToggleEl.value?.focus({ preventScroll: true })
  }
  toggleControlsCollapsed()
}
let playbackLifecycleActive = true
const lifecycleVisible = ref(true)
let wideLayoutQuery: MediaQueryList | null = null
function onWideLayoutChange(event: MediaQueryListEvent | null): void {
  wideLayout.value = !!(event && event.matches)
}
// 全屏变化后等 Vue 更新布局再 force fit；事件与方向锁仍由共享 composable 所有。
const { isFullscreen, pseudoFullscreen, fullscreenSupported, toggleFullscreen, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => pbRoot.value, pseudoFallback: true, // 原生全屏不可用 / 被拒时降级为 CSS 伪全屏
  isPhone: isMobileDevice,
  isActive: () => playbackLifecycleActive && props.active && lifecycleVisible.value,
  onChange: () => nextTick(() => fitViewIfReady(true)),
  auto: () => ({ token: props.autoFullscreen?.token ?? 0, key: props.autoFullscreen?.key, ready: true, active: props.active && lifecycleVisible.value }),
})

const floatingFullscreenRow = computed(() => isMobileDevice.value && fullscreenSupported.value && !phoneLandscape.value && !uiHidden.value) // 竖屏手机浮动全屏按钮自占一行（.pb-fs-reserve）
const camera = usePlaybackCamera(S.mapView, {
  mapComponent,
  mapStageEl,
  isFullscreen: () => isFullscreen.value,
  wideLayout: () => wideLayout.value,
  isMobileDevice: () => isMobileDevice.value,
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
} = camera

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
  camera,
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
    selectAtPointer: (clientX, clientY) => S.selectAt(null, clientX, clientY),
    onPlainClick: () => mobileOverlay.value?.reveal?.(),
  },
)

let stageResizeObserver: ResizeObserver | null = null
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
function writeSquareAvailHeight(): void {
  const root = pbRoot.value
  if (!root) return
  const hud = root.querySelector('.pb-hud')
  const transport = transportEl.value
  // 根高度在纵向流里本身就由正方形撑开（自指），所以再用视口高度封顶：横屏手机 / 全屏下一屏放下。
  const rootRect = root.getBoundingClientRect()
  const style = getComputedStyle(root)
  const viewportH = window.visualViewport?.height || window.innerHeight
  const pageStyle = getComputedStyle(document.documentElement)
  const headerH = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  // Use viewport capacity, never content-derived root height (feeds back into Stage); scroll moves presentation, not capacity.
  const top = isFullscreen.value ? 0 : headerH
  const reserve = isFullscreen.value ? 0 : (parseFloat(style.getPropertyValue('--pb-viewer-reserve')) || 0)
  const workspaceH = Math.max(1, viewportH - top - reserve)
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
} = usePlaybackReplayData(S.mapView, {
  playback: S.playback,
  playbackV2: () => props.playbackV2,
  reloadTelemetry: () => props.reloadTelemetry,
  poseFacet: () => props.poseFacet,
  clockOffset: () => props.clockOffset,
  mapCode: () => S.pbOverview.value.mapCode,
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
  S.mapView,
  {
    textInputRef: () => mapComponent.value?.textInputRef || null,
    onOpen: () => { S.pause(); displayOpen.value = false },
    resetGestures: resetGestureState,
    reliefUnproject,
    projectedSemanticNorm,
    reliefHasModel: () => !!reliefModelForPlayback(),
    overview: () => props.overview,
  },
)


  Object.assign(S, {
    uiHidden,
    setUiHidden,
    showRosterPresentation,
    mobileOverlay,
    transportEl,
    displayOpen,
    displaySection,
    displayAnchor,
    toggleDisplay,
    battlefieldWorkspaceEl,
    mapComponent,
    mapStageEl,
    pbRoot,
    wideLayout,
    formFactor,
    isMobileDevice,
    isPhonePortrait,
    phoneLandscape,
    compactAnnotation,
    controlsCollapsed,
    controlsContentId,
    toggleControlsCollapsed,
    rosterLanesOpen,
    toggleRosterLanes,
    transportToggleEl,
    transportContentEl,
    freezeTransportHeight,
    startTransportEnter,
    openTransportHeight,
    closeTransportHeight,
    clearTransportHeight,
    toggleTransport,
    lifecycleVisible,
    onWideLayoutChange,
    isFullscreen,
    pseudoFullscreen,
    fullscreenSupported,
    toggleFullscreen,
    exitOwnedFullscreen,
    floatingFullscreenRow,
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
    mapEngaged,
    wheelHintVisible,
    mapTouchPan,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onViewportClick,
    resetGestureState,
    writeSquareAvailHeight,
    shellChrome,
    vehicleReloadAt,
    vehicleConsumablesAt,
    routesByAccount,
    vehiclesByAccount,
    poseSource,
    poseAtTime,
    reliefModelForPlayback,
    projectedSemanticNorm,
    reliefUnproject,
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
    getDrawingPointerId,
    getDrawingStartScreen,
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
    renameSelected
  })
  Object.defineProperty(S, 'playbackLifecycleActive', { get: () => playbackLifecycleActive, set: (v) => { playbackLifecycleActive = v }, configurable: true })
  Object.defineProperty(S, 'wideLayoutQuery', { get: () => wideLayoutQuery, set: (v) => { wideLayoutQuery = v }, configurable: true })
  Object.defineProperty(S, 'stageResizeObserver', { get: () => stageResizeObserver, set: (v) => { stageResizeObserver = v }, configurable: true })
}
