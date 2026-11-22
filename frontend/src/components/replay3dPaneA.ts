import { useI18n } from 'vue-i18n'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { Feature } from '../app/featureCapabilities.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { isInteractiveTarget } from '../composables/usePlaybackTransport.js'
import type { EventTargetLike } from '../composables/usePlaybackTransport.js'
import type { Ref } from 'vue'
import { createPlaybackStore } from '../scene/playbackStore.js'
import type { initPlayback } from '../scene/playbackScene.js'

type Store = ReturnType<typeof createPlaybackStore>

/** 3D 场景 API（唯一 owner = playbackScene.initPlayback；C 段同样消费这些入口）。 */
export type SceneApiLike = ReturnType<typeof initPlayback>

/** A 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
export interface R3dAParts {
  store: Store
  rootEl: Ref<HTMLElement | null>
  webgl: { supported: boolean }
  guideOpenedDisplay: boolean
  closeAnnotation: () => void
  resetAnnotationState: () => void
  shortWorkspace: Ref<boolean>
  CAMERAS: Ref<ReadonlyArray<{ id: string; label: string }> | string[]>
  sceneApi: SceneApiLike | null
}

export interface R3dAProps {
  active: boolean
  file: unknown
}

export function r3dA(S: R3dAParts, props: R3dAProps): void {
const { t, locale } = useI18n()
const onboarding = inject(ONBOARDING_KEY, null)
// 紧凑控制条把镜头收进了 Display 面：教程指向镜头前先打开它，cleanup 只收回自己打开的那一次。

onMounted(() => onboarding?.registerSurface('3d', {
  ready: () => props.active && S.store.hasData,
  prepare: async () => {
    if (!compactBar.value || displayOpen.value) return
    displayAnchor.value = S.rootEl.value?.querySelector('[data-testid="display-toggle"]') || null
    displayOpen.value = true
    S.guideOpenedDisplay = true
    await nextTick()
  },
  cleanup: () => {
    if (S.guideOpenedDisplay) displayOpen.value = false
    S.guideOpenedDisplay = false
  },
  failed: () => !S.webgl.supported || !!S.store.err || (!online.value.pending && !online.value.available),
}))
onBeforeUnmount(() => onboarding?.registerSurface('3d', null))
const { availability, requireFeature } = useFeatureGate()
const online = computed(() => availability(Feature.PLAYBACK_3D))

/**
 * 呈现偏好（标签行 / 战场 UI 分块）的**唯一 owner** 是 usePlaybackPreferences——
 * 与 2D Playback 共用同一份持久化偏好，3D 不再自建第二套 localStorage 状态。
 */
const { labelPrefs, hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter } = usePlaybackPreferences()

/**
 * 「隐藏全部 UI」：**不写入持久化偏好**（刷新后回到常规界面，不会把用户永久关在空白场景里），
 * 只覆盖本次会话的显示。隐藏时保留一个常驻的极简恢复按钮——不得做成不可逆状态。
 * `H` 键切换；输入控件聚焦时不响应（复用播放传输的同一判据）。
 */
const uiHidden = ref(false)
/**
 * 「显示 / 二级控件」面开合（局部视图状态，不持久化）。
 *
 * 一个 owner 承担两种形态（不新建第二套设置系统）：内容是同一份——相机模式、阵容 / 标签 /
 * 画质等查看与显示开关；只有**位置**随形态变，且位置归 `PlaybackDisplaySurface`：
 *   · 宽视口 / 横屏 = 锚定在 gear 上的浮面，优先开在 gear 上方，空间不足换边并夹在 workspace 内；
 *   · 竖屏 = 流内的一块面，排在传输控件之后（order 由本组件的 `.portrait-flow` 给）。
 * 两种形态读写同一份共享偏好（uiPrefs / labelPrefs / hpPrefs / store.cam）。
 */
const displayOpen = ref(false)
const displayAnchor = ref<HTMLElement | null>(null)
function toggleDisplay(anchor: HTMLElement | null): void {
  if (!displayOpen.value) S.closeAnnotation()   // Display 与 drawing 互斥（同一行高度预算）
  displayAnchor.value = anchor
  displayOpen.value = !displayOpen.value
}

const controlsCollapsed = ref(false)
const controlsContentId = useId()
/**
 * 收起动画：内容高度收到 0，控制条底部固定，所以整条向下滑出、按钮竖直落下。
 * 动画结束才收窄容器（docked）：滑动期间按钮的横向位置不能变，收起后又不能继续占场景。
 */
const controlsDocked = ref(false)
function slideContentFrom(el: HTMLElement): void {
  controlsDocked.value = false
  el.style.height = '0px'
}
function slideContentOpen(el: HTMLElement): void {
  el.style.height = `${el.scrollHeight}px`
}
function slideContentClose(el: HTMLElement): void {
  el.style.height = `${el.offsetHeight}px`
}
function slideContentShut(el: HTMLElement): void {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearSlideHeight(el: HTMLElement): void {
  el.style.height = ''
}
function dockControls(el: HTMLElement): void {
  clearSlideHeight(el)
  controlsDocked.value = true
}
function toggleControls() {
  controlsCollapsed.value = !controlsCollapsed.value
  if (controlsCollapsed.value) {
    displayOpen.value = false
    S.closeAnnotation()
  }
}
watch(() => props.file, () => {
  controlsCollapsed.value = false
  controlsDocked.value = false
  S.resetAnnotationState()   // 换场次 = 换地图语义；旧标注不得跨图残留
  S.sceneApi?.setContactShadows?.(false)   // 接地阴影是逐场 opt-in：新文件的待开播默认 OFF
})
/** 紧凑档：手机形态（见 usePlaybackPhoneForm —— 宽度 <768 **或** 触屏且视口高 ≤500，
 *  后者命中手机全屏横屏）。**不能用纯宽度断点**：手机竖屏 412×915 全屏后是 915×412，
 *  按宽度会突然判成平板、把收起来的 controls 又展开。与 2D 共用同一份 form-factor 契约。 */
const { isPhone } = usePlaybackPhoneForm()
/**
 * 竖屏判据与 2D **同一个**（usePlaybackPortraitViewport）：不能从 `isPhone` 推——手机横屏 /
 * 全屏横屏也是 `isPhone`，但它们走的是 `Team 1 | 铺满中心的 Stage | Team 2`。
 *
 *   竖屏 = 纵向流：HUD / 正方形 Stage / 传输控件 / 详情（inline）/ Team 1 / Team 2，页面可滚
 *   其它 = 三段式：两侧车道 + 中间铺满的 Stage，传输控件在 Stage 之下
 */
const { isPortrait } = usePlaybackPortraitViewport()
const portraitFlow = computed(() => isPortrait.value)
/** 控制条一行：手机横屏与矮工作台。竖屏控制条在流内；dense 名册与单行 HUD 只给手机横屏，矮桌面保持原行高。 */
const compactBar = computed(() => !portraitFlow.value && (isPhone.value || S.shortWorkspace.value))
const phoneLandscape = computed(() => isPhone.value && !portraitFlow.value)

// Selection belongs to the pane. Camera mode and follow target belong to the scene.
// 选中与详情可见性是**两个状态**：关详情不清选中。点车或点名单都会选中并跟随；相机档位负责离开跟随。
const selectedEid = ref<number | null>(null)
const detailsOpen = ref(false)
/** 浮窗落位偏好：点左车道 → 落右侧，点右车道 → 落左侧，点场景里的车 → 与它相对的一侧。 */
const detailsSide = ref('right')

/**
 * 名册行点击 = **跟随该玩家坦克**（2026-10-05 需求）：不再打开详情窗。
 * 选中高亮照旧（selectedEid），相机跟随由场景内核 setFollow 独占（它同时切 follow 档）。
 */
function followFromRoster(eid: number): void {
  selectedEid.value = eid
  displayOpen.value = false
  followUnlessRecorder(eid)
}
/** 录像者视角由回放驱动：点车只选中，不改变相机。 */
function followUnlessRecorder(eid: number): void {
  if (S.store.cam !== 'recorder') S.sceneApi?.setFollow?.(eid)
}
/** 场景里点中坦克 = 打开共享详情窗并跟随；点空处（eid=null）= 隐藏详情窗，跟随不变。 */
function handleSceneSelect(eid: number | null, event: MouseEvent | null = null): void {
  if (eid == null) { closeDetails(); return }
  selectVehicle(eid, event)
  followUnlessRecorder(eid)
}
function selectVehicle(eid: number, event: MouseEvent | null = null): void {
  selectedEid.value = eid
  detailsOpen.value = true
  displayOpen.value = false
  const side = detailsSideFor(event)
  if (side) detailsSide.value = side
}
function detailsSideFor(event: MouseEvent | null): 'left' | 'right' | null {
  const target = event?.target as (EventTarget & { closest?: (selector: string) => Element | null }) | null
  if (target?.closest?.('.side-left')) return 'right'
  if (target?.closest?.('.side-right')) return 'left'
  const root = S.rootEl.value
  const clientX = event?.clientX
  if (!root || typeof clientX !== 'number' || !Number.isFinite(clientX)) return null
  // 场景里的车：浮窗落在点击位置的**相对**一侧，不挡住用户刚点的那台车。
  const rect = root.getBoundingClientRect()
  return clientX > rect.left + rect.width / 2 ? 'left' : 'right'
}
/** 详情 ×：只关详情。选中（名册高亮）、跟随、相机、时间轴、倍速与名册都不动。 */
function closeDetails() {
  detailsOpen.value = false
}
const cameraTools = computed(() => ({ cam: S.store.cam, cameras: S.CAMERAS.value, glbOn: S.store.glbOn, glbAllowed: S.store.glbAllowed }))
function chooseCamera(mode: string): void {
  S.sceneApi?.setCam?.(mode)
}
function setUiHidden(hidden: boolean): void {
  uiHidden.value = hidden
  if (hidden) {
    displayOpen.value = false
    S.closeAnnotation()
  }
}
function toggleUiHidden() { setUiHidden(!uiHidden.value) }
/**
 * `H` 切换「隐藏全部 UI」。在输入 / 可操作控件上不响应（复用播放传输的同一判据：
 * 输入框里打字不该把界面藏起来）。
 *
 * 注：判据用 `event.target`（与 usePlaybackTransport 的空格 / 方向键一致）。浏览器里
 * 输入框聚焦时 keydown 的 target 就是该元素；happy-dom 的合成 KeyboardEvent 不设 target，
 * 因此这条守卫无法用「聚焦 input + dispatch」在单测里覆盖——测试改为直接调用本函数
 * 并传入真实 target 形状的事件（见 Replay3DPane.test.js）。
 */
function onUiToggleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'h' && event.key !== 'H') return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!props.active || !S.store.hasData) return
  if (isInteractiveTarget(event.target as EventTargetLike | null)) return
  event.preventDefault()
  toggleUiHidden()
}

/** 战场 UI 分块：隐藏全部 UI 时整块关掉（只保留恢复按钮） */
const showTopbar = computed(() => !uiHidden.value && uiPrefs.showTopbar)
const showRoster = computed(() => !uiHidden.value && uiPrefs.showRoster)
// 传输条名册入口（与 2D 同一口径）：竖屏名册在流内常驻，不需要入口。
const rosterEntryVisible = computed(() => !portraitFlow.value)
function toggleRoster() { uiPrefs.showRoster = !uiPrefs.showRoster }
const showKillfeed = computed(() => !uiHidden.value && uiPrefs.showKillfeed)
const showBaseStatus = computed(() => !uiHidden.value && uiPrefs.showBaseStatus)
// 实时帧率角标（用户需求：拖动/飞行卡顿的量化依据）；隐藏全部 UI 时一并隐藏。
// 只统计真正渲染的帧；`平均/峰值` 让“平均还行但有顿挫”可见。
const showFps = computed(() => !uiHidden.value && S.store.hasData)
const fpsText = computed(() => (S.store.fps > 0
  ? `${S.store.fps.toFixed(1)} FPS · ${S.store.frameMs.toFixed(1)}/${S.store.framePeakMs.toFixed(1)} ms`
  : '— FPS'))
const fpsJanky = computed(() => S.store.fps > 0
  && (S.store.fps < 45 || (S.store.framePeakMs > 0 && S.store.framePeakMs > S.store.frameMs * 2.5)))


  Object.assign(S, {
    t,
    locale,
    onboarding,
    availability,
    requireFeature,
    online,
    labelPrefs,
    hpPrefs,
    markerPrefs,
    uiPrefs,
    lastKnownPrefs,
    declutterActive,
    toggleDeclutter,
    uiHidden,
    displayOpen,
    displayAnchor,
    toggleDisplay,
    controlsCollapsed,
    controlsContentId,
    controlsDocked,
    slideContentFrom,
    slideContentOpen,
    slideContentClose,
    slideContentShut,
    clearSlideHeight,
    dockControls,
    toggleControls,
    isPhone,
    isPortrait,
    portraitFlow,
    compactBar,
    phoneLandscape,
    selectedEid,
    detailsOpen,
    detailsSide,
    followFromRoster,
    followUnlessRecorder,
    handleSceneSelect,
    selectVehicle,
    detailsSideFor,
    closeDetails,
    cameraTools,
    chooseCamera,
    setUiHidden,
    toggleUiHidden,
    onUiToggleKeydown,
    showTopbar,
    showRoster,
    rosterEntryVisible,
    toggleRoster,
    showKillfeed,
    showBaseStatus,
    showFps,
    fpsText,
    fpsJanky
  })
}
