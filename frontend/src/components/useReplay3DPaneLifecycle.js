import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { initPlayback } from '../scene/playbackScene.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { Feature } from '../app/featureCapabilities.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'

export function useReplay3DPaneLifecycle(props, core, details, startedFile, shared) {
  const state = { ...core, ...details }
  const {   t, locale, onboarding, guideOpenedDisplay, availability, requireFeature, online, labelPrefs,   hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden, displayOpen,   displayAnchor, toggleDisplay, controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen, slideContentClose,   slideContentShut, clearSlideHeight, dockControls, toggleControls, isPhone, isPortrait, portraitFlow, compactBar,   phoneLandscape, selectedEid, detailsOpen, detailsSide, followFromRoster, followUnlessRecorder, handleSceneSelect, selectVehicle,   detailsSideFor, closeDetails, cameraTools, chooseCamera, setUiHidden, toggleUiHidden, onUiToggleKeydown, showTopbar,   showRoster, showKillfeed, showBaseStatus, showFps, fpsText, fpsJanky, store, stage,   labelOverlay, recorderReticle, sceneApiRef, annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,   commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState, annotationToolbarProps, annotationToolbarHandlers, playbackFacet,   facetShots, facetKills, timelineHighlightEid, shotTicks, killTicks, jumpShot, jumpBase, rideRoster,   rideAllyTeam, rideVehicle, transport, renderActive, fly, webgl, pushLabelPrefs, consumedSeekId,   lastFile, lastFileName, loadingMessage, paneReady, qualityBadge, mapTitle, recorderUnavailableReason, CAMERAS,   QUALITY_ORDER, hudFriendlyHp, hudEnemyHp, hudHealth, teamColors, rosterLanes, selectedRow,   detailPlayback, gunMarks, battleTimeLabel, detailTime, selectedTrack, selectedLife, selLastKnownSec, selCurStats,   selDamageLog, selectedPortraitUrl, portraitGeneration, selectedDetailState, selectedHealth, bannerColor } = state

let parseController = null
function abortParse() {
  parseController?.abort()
  parseController = null
}

async function loadFile(file) {
  // 连通性门禁在最前（离线时不启动新的 3D 解析）；随后是 main 的解析生命周期归属：
  // 每次新解析都要先撤下上一次（abort）并换新的 AbortController。
  if (!file || !sceneApiRef.value || !requireFeature(Feature.PLAYBACK_3D)) return
  abortParse()
  parseController = new AbortController()
  lastFile.value = file
  lastFileName.value = file.name || 'replay'
  await sceneApiRef.value.loadData({ kind: 'local', file, signal: parseController.signal, session: props.playbackSession })
}

/** 重试：同一份文件重新解析（失败不清空 selection，用户不必再选一次）；错误态由场景层重写 */
function retryLoad() {
  if (lastFile.value) {
    if (props.playbackSession?.getState(lastFile.value).sceneState === 'error') props.playbackSession.invalidate(lastFile.value)
    return loadFile(lastFile.value)
  }
}

function bannerText() {
  const banner = store.banner
  if (!banner) return ''
  return banner.outcome ? t('agentReplay.banner_' + banner.outcome) : banner.text
}
function killfeedVerb(kf) {
  // 结构化渲染（三语）：击杀 = killer × victim；环境/非击杀只标阵亡（cause 细节上游为中文后缀）
  return t(kf.kill ? 'agentReplay.destroyed' : 'agentReplay.destroyed_by_environment')
}

/**
 * 场景生命周期不变量（唯一权威，别把三件事混在一起）：
 *
 *   sceneApi 存在  ⟺  有一个**活的** stage DOM ∧ file 存在 ∧ 未被阻断 ∧ WebGL 可用
 *
 * 三种变化的产品语义完全不同，必须分开处理：
 * - `active=false`（能力切走）→ **只停帧**：保留会话，切回不重新解析、保留 timeline / 相机；
 * - `file=null` / `blockedReason` 非空 → **销毁场景**：模板此时已经移除了 `.pb-root`，
 *   旧 stage 是游离节点，再往上渲染就是往看不见的 DOM 上画（而且渲染循环还在跑）；
 * - 组件卸载 → 销毁一次。
 *
 * 销毁后必须等 Vue 用 `flush: 'post'` 重建出新的 stage 再 `initPlayback`，
 * 否则会把旧节点（或 null）交给场景内核。
 */
function destroyScene() {
  abortParse()   // 场景销毁 = 解析任务一并撤下（在途解析不得再占 Worker 队列）
  resetAnnotationState()   // 场景消失 = annotation 派生层与 history 一并清空（V1 不持久化）
  selectedEid.value = null
  detailsOpen.value = false
  fly.stopLoop()   // 场景销毁：飞行循环停 + 按键清空（重建后按住键需重新按下）
  if (!sceneApiRef.value) return
  sceneApiRef.value.destroy?.()
  sceneApiRef.value = null
}

/** 当前是否应存在场景（模板 v-else 分支的条件，必须与它逐字一致） */
function shouldHaveScene() {
  return online.value.available && !!webgl.supported && !props.blockedReason && !!props.file
}

/** 需要则建场景（返回是否新建）；已存在则复用，不重建、不重解析 */
function ensureScene() {
  // 两侧约束都要保留：
  //   · `!props.active` —— 未激活的能力不得建场景（不需要激活就初始化会在切走时白跑渲染）；
  //   · `labelOverlay.value` —— 3D 名牌改屏幕空间 DOM 锚点后，场景需要覆盖层句柄。
  if (sceneApiRef.value || !renderActive.value || !shouldHaveScene()) return false
  sceneApiRef.value = initPlayback(stage.value, store, labelOverlay.value, {
    onVehicleSelect: handleSceneSelect,
    onAnnotationCommit: commitAnnotationFromScene,
    onAnnotationErase: eraseFromScene,
    recorderReticle: recorderReticle.value,
  })
  sceneApiRef.value?.setPaused?.(!renderActive.value)
  sceneApiRef.value?.setFlySpeed?.(fly.flySpeedIndex())   // 新场景补推当前飞行速率档（重建不丢档）
  sceneApiRef.value?.setMobileTouch?.(isPhone.value)      // 移动端触屏相机契约（单指分流 / 双指不控制）
  pushLabelPrefs();   // 新场景默认吃共享偏好（含"隐藏全部 UI"的当前状态）
  pushAnnotationProjection()
  pushAnnotationInteraction()
  pushAnnotationVisibility()
  return true
}

/** 解析目标回放：同一次会话内同一文件不重复解析 */
let loadedFile = null

/**
 * 待开播：文件到位后先让用户选画质，按「开始」才解析 + 拉资产。
 * 画质必须在渲染器创建前定型（内核 `startPlayback()` 惰性建渲染器、首帧按当前档位），
 * 所以这一步不能省成"加载中也能切档"。`startedFile` = 用户已按过开始的那一场。
 */
const qualityOptions = computed(() =>
  QUALITY_ORDER.map((k) => ({ value: k, label: t('agentReplay.q_' + k) })),
)

function startReplay() {
  if (!props.file) return
  startedFile.value = props.file
  reconcileScene()
}

function reconcileScene() {
  if (!shouldHaveScene()) {
    destroyScene()
    loadedFile = null
    startedFile.value = null
    return
  }
  const created = ensureScene()
  const file = props.file
  // 尚未按开始（含换到另一场）：先把上一场撤下，否则旧场景继续呈现、还会压住待开播面板；
  // 同时撤下旧场的在途解析（reset 归零会话，解析任务也一并让出 Worker 队列）
  if (file !== startedFile.value) {
    if (loadedFile) {
      sceneApiRef.value?.reset?.()
      abortParse()
      loadedFile = null
      selectedEid.value = null
      detailsOpen.value = false
      displayOpen.value = false
    }
    return
  }
  if (created || file !== loadedFile) {
    loadedFile = file
    loadFile(file)
  }
}

// Measure viewport capacity independently of the content-sized Stage row.
const { rootEl, hudEl, controlsEl } = shared
let laneBoundsObserver = null
/** 工作台高度低于它时，两行控制条（实测约 137px）放不进场景底部 20% 边带（design-language §5）。 */
const SHORT_WORKSPACE_MAX_H = 700
const KILLFEED_MAX_LINES = 3
const KILLFEED_ROW_BORDER_PX = 2
const killfeedMaxLines = ref(KILLFEED_MAX_LINES)
const visibleKillfeed = computed(() => store.killfeed.slice(-killfeedMaxLines.value))
const shortWorkspace = shared.shortWorkspace
function measurePresentationBounds() {
  const root = rootEl.value
  if (!root) return
  const pageStyle = getComputedStyle(document.documentElement)
  const header = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  const viewportH = window.visualViewport?.height || window.innerHeight
  const top = document.fullscreenElement === root ? 0 : header
  const workspaceH = Math.max(1, viewportH - top)
  root.style.setProperty('--pb-workspace-h', `${workspaceH}px`)
  shortWorkspace.value = workspaceH <= SHORT_WORKSPACE_MAX_H
  const style = getComputedStyle(root)
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 0
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
  const hudH = hudEl.value?.getBoundingClientRect().height || 0
  const controlsH = controlsEl.value?.getBoundingClientRect().height || 0
  const budget = Math.max(1, workspaceH - padding - border - hudH - controlsH - gap * 2)
  root.style.setProperty('--pb-square-avail-h', `${Math.floor(budget)}px`)
  // 宽形态的击杀流不得压入场景中心 60% 盒（design-language §5）：按 HUD 下方剩余边带决定
  // 渲染几条，放不下时只留最新的。紧凑形态走贴边例外，竖屏的 HUD 不在场景上。
  const hudBottom = (hudEl.value?.getBoundingClientRect().bottom ?? 0) - root.getBoundingClientRect().top
  const killfeedLineH = (parseFloat(style.getPropertyValue('--line-height-caption')) || 16) + KILLFEED_ROW_BORDER_PX + gap
  const lineBudget = Math.floor((root.clientHeight * 0.2 - hudBottom - gap) / killfeedLineH)
  killfeedMaxLines.value = compactBar.value || portraitFlow.value || !root.clientHeight ? KILLFEED_MAX_LINES : Math.min(KILLFEED_MAX_LINES, Math.max(1, lineBudget))
  root.style.setProperty('--pb-stage-h', `${Math.floor(budget) + gap * 2}px`)
}
function observeLaneBounds() {
  if (typeof ResizeObserver !== 'function') return
  laneBoundsObserver?.disconnect()
  laneBoundsObserver = new ResizeObserver(measurePresentationBounds)
  for (const el of [rootEl.value, hudEl.value, controlsEl.value]) if (el) laneBoundsObserver.observe(el)
}
watch([controlsEl, hudEl], (elements) => {
  for (const el of elements) if (el && laneBoundsObserver) laneBoundsObserver.observe(el)
  measurePresentationBounds()
}, { flush: 'post' })

/**
 * 全屏（与 2D 同一套产品语义，见 composables/usePlaybackFullscreen）：
 * 目标是 3D 回放根 `.pb-root`——不是整个 WotbTools 外壳。纯呈现 / 生命周期切换：
 * 场景、解析、时间、倍速、相机、跟随目标、标签与名册偏好**都不重置**
 * （本组件不做任何 `reset()` / `loadData()`，全屏只改变容器尺寸，渲染器由既有
 * ResizeObserver 路径适配）。手机形态在全屏成功后锁横屏，退出/卸载解锁。
 */
const { isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => rootEl.value,
  isPhone,
  isActive: () => props.active, // capability 切走（active=false）时不该再锁着方向
  auto: () => ({ token: props.autoFullscreenToken, key: props.file, active: props.active, ready: !!props.file && !props.blockedReason && props.file === startedFile.value && !store.err && !!store.hasData }), // 成功就绪（非 paneReady：终态错误时它也为 true）
})

/** ?debug：几何门禁 / 人工排查的状态注入点（与场景内核的 ?debug 钩子同一口径，只暴露
 *  store 引用与车道 DOM，不改变任何行为）。browser 几何门禁据此注入 roster / killfeed，
 *  在真实 Chrome 里断言车道的非交叉几何。 */
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  window.__pbPane = {
    store,
    get selectedEid() { return selectedEid.value },
    get detailsOpen() { return detailsOpen.value },
    get labelOverlay() { return labelOverlay.value },
    /** 场景实例身份：全屏 / 旋转前后必须是同一个（门禁据此断言「没有重建场景」）。 */
    get sceneApi() { return sceneApiRef.value },
  }
}


onMounted(() => {
  reconcileScene()
  observeLaneBounds()
  window.addEventListener('keydown', onUiToggleKeydown)
})
onBeforeUnmount(() => {
  portraitGeneration.value++
  destroyScene()
  laneBoundsObserver?.disconnect()
  laneBoundsObserver = null
  window.removeEventListener('keydown', onUiToggleKeydown)
  if (window.__pbPane?.store === store) delete window.__pbPane
})

/**
 * file / blockedReason / active 都由工作台派生：
 * 只有 `active` 是「暂停 / 恢复」，其余两个都会改变「场景该不该存在」。
 */
watch(
  [() => props.file, () => props.blockedReason, renderActive, () => online.value.available],
  ([, , active], previous = []) => {
    // 先按新的 file/blocked 收敛场景，再处理能力切换
    reconcileScene()
    const activeChanged = previous.length >= 3 && previous[2] !== active
    if (activeChanged) {
      sceneApiRef.value?.setPaused?.(!active)
      if (!active) fly.stopLoop()
    }
  },
  { flush: 'post' },
)

watch(() => props.active, (active) => {
  // 能力切走 / 页面停用（active 已含 pageActive）：退出本回放拥有的全屏，否则新页面被挡在旧 fullscreen root 后面
  if (!active) { closeAnnotation(); unlockOrientation(); exitOwnedFullscreen() }
})

// 面板打开期间尺寸变化（旋转 / 全屏 / 工作台重排）重算可用高度；闭合时不测量
// （此时 .controls 可能整块不存在），打开那一下由 watch(displayOpen) 负责。
function onViewportResize() { measurePresentationBounds() }
// 外壳沉浸态切换只改 --header-h，不触发 resize：显式重算预算。
const shellChrome = inject(SHELL_CHROME_KEY, null)
watch(() => shellChrome?.immersive.value, () => nextTick(measurePresentationBounds))
onMounted(() => window.addEventListener('resize', onViewportResize))
onBeforeUnmount(() => window.removeEventListener('resize', onViewportResize))
return {
  state, t, locale, onboarding, guideOpenedDisplay, availability, requireFeature, online,
  labelPrefs, hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden,
  displayOpen, displayAnchor, toggleDisplay, controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen,
  slideContentClose, slideContentShut, clearSlideHeight, dockControls, toggleControls, isPhone, isPortrait, portraitFlow,
  compactBar, phoneLandscape, selectedEid, detailsOpen, detailsSide, followFromRoster, followUnlessRecorder, handleSceneSelect,
  selectVehicle, detailsSideFor, closeDetails, cameraTools, chooseCamera, setUiHidden, toggleUiHidden, onUiToggleKeydown,
  showTopbar, showRoster, showKillfeed, showBaseStatus, showFps, fpsText, fpsJanky, store,
  stage, labelOverlay, recorderReticle, sceneApiRef, annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction,
  pushAnnotationVisibility, commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState, annotationToolbarProps, annotationToolbarHandlers,
  playbackFacet, facetShots, facetKills, timelineHighlightEid, shotTicks, killTicks, jumpShot, jumpBase,
  rideRoster, rideAllyTeam, rideVehicle, transport, renderActive, fly, webgl, pushLabelPrefs,
  consumedSeekId, lastFile, lastFileName, loadingMessage, paneReady, qualityBadge, mapTitle, recorderUnavailableReason,
  CAMERAS, QUALITY_ORDER, hudFriendlyHp, hudEnemyHp, hudHealth, teamColors, rosterLanes, selectedRow,
  detailPlayback, gunMarks, battleTimeLabel, detailTime, selectedTrack, selectedLife, selLastKnownSec, selCurStats,
  selDamageLog, selectedPortraitUrl, portraitGeneration, selectedDetailState, selectedHealth, bannerColor, parseController, abortParse,
  loadFile, retryLoad, bannerText, killfeedVerb, destroyScene, shouldHaveScene, ensureScene, loadedFile,
  startedFile, qualityOptions, startReplay, reconcileScene, rootEl, hudEl, controlsEl, laneBoundsObserver,
  SHORT_WORKSPACE_MAX_H, KILLFEED_MAX_LINES, KILLFEED_ROW_BORDER_PX, killfeedMaxLines, visibleKillfeed, shortWorkspace, measurePresentationBounds, observeLaneBounds,
  isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation, exitOwnedFullscreen, onViewportResize, shellChrome
}
}
