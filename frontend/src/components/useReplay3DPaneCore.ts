import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch, type Ref } from 'vue'
import type { useReplayWorkspace } from '../composables/useReplayWorkspace'
import type { initPlayback } from '../scene/playbackScene'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useI18n } from 'vue-i18n'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { uiProfile } from '../composables/useUiProfile.js'
import { rosterLanesFor } from '../scene/rosterState.js'
import { PLAYBACK_SPEEDS, PLAYBACK_STEP_SECONDS, isInteractiveTarget, usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import { buildKillTicks, buildShotTicks, findNextShotTime, findPrevShotTime, rosterRideTarget } from '../utils/playbackShortcuts.ts'
import { useSceneActivity } from '../composables/useSceneActivity'
import { useSceneAnnotations } from '../composables/useSceneAnnotations.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { formatPlaybackClock } from '../utils/playbackClock'
import { mapLabel } from '../utils/helpers.js'

export type ReplayPaneProps = {
  active: boolean; file: File | null; playbackSession: ReturnType<typeof useReplayWorkspace>['playbackSession'] | null
  blockedReason: string; autoFullscreenToken: number; pendingSeek: { id: number; sec: number } | null
}
export type ReplayPaneShared = { rootEl: Ref<HTMLElement | null>; hudEl: Ref<HTMLElement | null>; controlsEl: Ref<HTMLElement | null>; shortWorkspace: Ref<boolean> }
export function useReplay3DPaneCore(props: ReplayPaneProps, startedFile: Ref<File | null>, shared: ReplayPaneShared) {
const { shortWorkspace, rootEl, hudEl, controlsEl } = shared
const { t, locale } = useI18n()
const onboarding = inject(ONBOARDING_KEY, null)
// 紧凑控制条把镜头收进了 Display 面：教程指向镜头前先打开它，cleanup 只收回自己打开的那一次。
let guideOpenedDisplay = false
onMounted(() => onboarding?.registerSurface('3d', {
  ready: () => props.active && store.hasData,
  prepare: async () => {
    if (!compactBar.value || displayOpen.value) return
    displayAnchor.value = rootEl.value?.querySelector('[data-testid="display-toggle"]') || null
    displayOpen.value = true
    guideOpenedDisplay = true
    await nextTick()
  },
  cleanup: () => {
    if (guideOpenedDisplay) displayOpen.value = false
    guideOpenedDisplay = false
  },
  failed: () => !webgl.supported || !!store.err || (!online.value.pending && !online.value.available),
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
function toggleDisplay(anchor: HTMLElement | null) {
  if (!displayOpen.value) closeAnnotation()   // Display 与 drawing 互斥（同一行高度预算）
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
function slideContentFrom(el: HTMLElement) {
  controlsDocked.value = false
  el.style.height = '0px'
}
function slideContentOpen(el: HTMLElement) {
  el.style.height = `${el.scrollHeight}px`
}
function slideContentClose(el: HTMLElement) {
  el.style.height = `${el.offsetHeight}px`
}
function slideContentShut(el: HTMLElement) {
  void el.offsetHeight
  el.style.height = '0px'
}
function clearSlideHeight(el: HTMLElement) {
  el.style.height = ''
}
function dockControls(el: HTMLElement) {
  clearSlideHeight(el)
  controlsDocked.value = true
}
function toggleControls() {
  controlsCollapsed.value = !controlsCollapsed.value
  if (controlsCollapsed.value) {
    displayOpen.value = false
    closeAnnotation()
  }
}
watch(() => props.file, () => {
  controlsCollapsed.value = false
  controlsDocked.value = false
  resetAnnotationState()   // 换场次 = 换地图语义；旧标注不得跨图残留
  sceneApiRef.value?.setContactShadows?.(false)   // 接地阴影是逐场 opt-in：新文件的待开播默认 OFF
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
const compactBar = computed(() => !portraitFlow.value && (isPhone.value || shortWorkspace.value))
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
function followFromRoster(eid: number) {
  selectedEid.value = eid
  displayOpen.value = false
  followUnlessRecorder(eid)
}
/** 录像者视角由回放驱动：点车只选中，不改变相机。 */
function followUnlessRecorder(eid: number) {
  if (store.cam !== 'recorder') sceneApiRef.value?.setFollow(eid)
}
/** 场景里点中坦克 = 打开共享详情窗并跟随；点空处（eid=null）= 隐藏详情窗，跟随不变。 */
function handleSceneSelect(eid: number | null, event: MouseEvent | null = null) {
  if (eid == null) { closeDetails(); return }
  selectVehicle(eid, event)
  followUnlessRecorder(eid)
}
function selectVehicle(eid: number, event: MouseEvent | null = null) {
  selectedEid.value = eid
  detailsOpen.value = true
  displayOpen.value = false
  const side = detailsSideFor(event)
  if (side) detailsSide.value = side
}
function detailsSideFor(event: MouseEvent | null) {
  const target = event?.target as Element | null
  if (target?.closest?.('.side-left')) return 'right'
  if (target?.closest?.('.side-right')) return 'left'
  const root = rootEl.value
  if (!root || !Number.isFinite(event?.clientX)) return null
  // 场景里的车：浮窗落在点击位置的**相对**一侧，不挡住用户刚点的那台车。
  const rect = root.getBoundingClientRect()
  return event!.clientX > rect.left + rect.width / 2 ? 'left' : 'right'
}
/** 详情 ×：只关详情。选中（名册高亮）、跟随、相机、时间轴、倍速与名册都不动。 */
function closeDetails() {
  detailsOpen.value = false
}
const cameraTools = computed(() => ({ cam: store.cam, cameras: CAMERAS.value, glbOn: store.glbOn, glbAllowed: store.glbAllowed }))
function chooseCamera(mode: string) {
  sceneApiRef.value?.setCam(mode)
}
function setUiHidden(hidden: boolean) {
  uiHidden.value = hidden
  if (hidden) {
    displayOpen.value = false
    closeAnnotation()
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
function onUiToggleKeydown(event: KeyboardEvent) {
  if (event.key !== 'h' && event.key !== 'H') return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (!props.active || !store.hasData) return
  if (isInteractiveTarget(event.target as HTMLElement | null)) return
  event.preventDefault()
  toggleUiHidden()
}

/** 战场 UI 分块：隐藏全部 UI 时整块关掉（只保留恢复按钮） */
const showTopbar = computed(() => !uiHidden.value && uiPrefs.showTopbar)
const showRoster = computed(() => !uiHidden.value && uiPrefs.showRoster)
const showKillfeed = computed(() => !uiHidden.value && uiPrefs.showKillfeed)
const showBaseStatus = computed(() => !uiHidden.value && uiPrefs.showBaseStatus)
// 实时帧率角标（用户需求：拖动/飞行卡顿的量化依据）；隐藏全部 UI 时一并隐藏。
// 只统计真正渲染的帧；`平均/峰值` 让“平均还行但有顿挫”可见。
const showFps = computed(() => !uiHidden.value && store.hasData)
const fpsText = computed(() => (store.fps > 0
  ? `${store.fps.toFixed(1)} FPS · ${store.frameMs.toFixed(1)}/${store.framePeakMs.toFixed(1)} ms`
  : '— FPS'))
const fpsJanky = computed(() => store.fps > 0
  && (store.fps < 45 || (store.framePeakMs > 0 && store.framePeakMs > store.frameMs * 2.5)))

const store = createPlaybackStore()
const stage = ref<HTMLElement | null>(null)
const labelOverlay = ref<HTMLElement | null>(null)
const recorderReticle = ref<HTMLElement | null>(null)
const sceneApiRef = shallowRef<ReturnType<typeof initPlayback> | null>(null)
// 3D annotation（selected-surface drawing；无 surfaceY/surfaceN 时 terrain fallback）：会话唯一 owner =
// useSceneAnnotations（与地图预览 3D 共用）；scene 只消费 projection 与 interaction 配置。
// V1 不持久化，换文件 / 场景销毁即清空。recorder 镜头不开 drawing；Display 与 drawing 互斥。
const {
  annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState,
  toolbarProps: annotationToolbarProps, toolbarHandlers: annotationToolbarHandlers,
} = useSceneAnnotations({
  getSceneApi: () => sceneApiRef.value,
  interactionReady: () => store.hasData,
  canOpen: () => store.cam !== 'recorder',
  onOpen: () => { displayOpen.value = false },
})
/**
 * 事件刻度 / 跳炮击 / 数字键骑乘（借鉴 blitzinfo）的数据面：
 * AgentPlaybackFacet（shots[].t_fire、kills[].t、vehicles[].team）由工作台解析，
 * 经场景生命周期发布到 store.playbackSession（与 canonical 同一个工作台状态对象）。
 * 时间轴刻度的 t→百分比换算在 utils/playbackShortcuts.js 纯函数里，与滑块 min/max 同语义。
 */
const playbackFacet = computed(() => store.playbackSession?.scenePlayback ?? null)
const facetShots = computed(() => Array.isArray(playbackFacet.value?.shots) ? playbackFacet.value.shots : [])
const facetKills = computed(() => Array.isArray(playbackFacet.value?.kills) ? playbackFacet.value.kills : [])
/** 刻度高亮的「当前跟随者」：仅 follow 相机档下才存在（setFollow 被 free/top/recorder 清零，
 *  selectedEid 只代表选中）。未跟随时不传 eid，作者本人的炮击仍按 facet 的 is_author 高亮。 */
const timelineHighlightEid = computed(() => (store.cam === 'follow' && selectedEid.value != null) ? selectedEid.value : null)
const shotTicks = computed(() => buildShotTicks(facetShots.value, store.startTime, store.duration, timelineHighlightEid.value))
const killTicks = computed(() => buildKillTicks(facetKills.value, store.startTime, store.duration))

/** `,` 上一发 / `.` 下一发：以 shots[].t_fire 为序列（纯函数查最近邻），无更多炮击则保持不动。
 *  seekTime 不改播放态：暂停中跳完仍是暂停，播放中跳完继续播。 */
function jumpShot(direction: number) {
  const shots = facetShots.value
  // 连续跳转基准：上一次跳到的炮击时刻（暂停时 store.time 停在 t-0.05，若直接以它为
  // 基准会反复选中同一发）。普通 seek/播放使时间离开该位置后基准失效（见 watch）。
  const base = jumpBase ?? store.time
  const target = direction < 0
    ? findPrevShotTime(shots, base)
    : findNextShotTime(shots, base)
  if (target == null) return
  jumpBase = target
  // seekTo 用 firstIndexAfter(严格晚于 T) 定位弹道游标：跳到精确 t_fire 会把该发
  // 排除（炮线/炮声不出现）。回退一小步（0.05s，半个包钟量子）让游标停在目标发之前。
  const seekTo = Math.max(store.startTime, target - 0.05)
  sceneApiRef.value?.seekTime(seekTo)
}
// 跳转基准失效：时间离开「上次跳转落点（target-0.05）」超过一个步长容差
let jumpBase: number | null = null
watch(() => store.time, (t) => {
  if (jumpBase == null) return
  if (Math.abs(t - (jumpBase - 0.05)) > 0.11) jumpBase = null
})

/** 骑乘名册序：按物理队伍合并 team1+team2（buildRosterRows 顺序 = 名册呈现顺序）；
 *  unknown 阵营无侧别，rosterRideTarget 自动排除。 */
const rideRoster = computed(() => {
  const groups = store.roster
  return [...(groups.team1 || []), ...(groups.team2 || [])]
})
/** 己方权威阵营：unknown（null）时整体 fail-closed——骑乘键不猜「team 1 = 己方」。 */
const rideAllyTeam = computed(() => (store.friendlyTeam === 1 || store.friendlyTeam === 2) ? store.friendlyTeam : null)
/** 数字键骑乘（1–7 己方 / Shift+1–7 敌方）：与名册点击同一入口（选中 + follow 档跟随）。 */
function rideVehicle(digit: number, isShift: boolean) {
  const eid = rosterRideTarget(rideRoster.value, digit, isShift, rideAllyTeam.value)
  if (eid == null) return
  followFromRoster(eid)
}

const transport = usePlaybackTransport({
  isPlaying: () => store.playing,
  play: () => sceneApiRef.value?.setPlaying(true),
  pause: () => sceneApiRef.value?.setPlaying(false),
  step: (delta) => sceneApiRef.value?.seekBy(delta),
  isAtEnd: () => store.hasData && store.duration > store.startTime && store.time >= store.duration,
  restart: () => sceneApiRef.value?.seekTime(store.startTime),
  isReady: () => store.hasData,
  // 工作台切到别的能力时不再劫持空格 / 方向键（2D 回放面板同时激活会争抢）
  isActive: () => props.active,
  // `,` / `.` 跳炮击；1–7 / Shift+1–7 数字键骑乘
  jumpShot,
  rideVehicle,
  // 数字键冲突消解的 fly 激活判定：自由相机（FPS 飞行）激活时数字键归飞行速率
  // （useSceneFlyControls 的 1–6 档，现状不动），否则归骑乘。
  isFlyMode: () => store.cam === 'free',
})
// 键盘自由视角（WASD 平移 / Q 升 E 降 / 1–6 速率）：PC 键盘用户的分析飞行。
// 键位与播放传输并行不冲突；速率写场景（store.flySpeed），位移在场景 flyTick 推进。
const renderActive = useSceneActivity(() => props.active)
const fly = useSceneFlyControls({
  setFlySpeed: (n) => sceneApiRef.value?.setFlySpeed(n),
  isActive: () => renderActive.value,
  canFly: () => !!sceneApiRef.value && store.hasData && !props.blockedReason,
  getSceneApi: () => sceneApiRef.value,
})
// 审计 3D-23：渲染器创建前做 WebGL 预检；不支持时不初始化场景，整块换成说明
const webgl = detectWebGL()

/**
 * 把共享偏好推给场景内核（唯一方向：偏好 → 场景；场景只读，不回写）。
 * 建场景时要补推一次——内核在 initPlayback 之后才有 setLabelPrefs。
 */
function pushLabelPrefs() {
  sceneApiRef.value?.setLabelPrefs?.({
    enabled: !uiHidden.value,
    showPlayerName: labelPrefs.showPlayerName,
    showTankName: labelPrefs.showTankName,
    showHp: hpPrefs.showHp,
    showReload: labelPrefs.showReload,
    classIcons: markerPrefs.classIcons,
    showStatus: markerPrefs.showStatus,
    // 可视性诚实呈现（离场坦克显示最后已知位置；偏好持久化归 usePlaybackPreferences）
    lastKnown: lastKnownPrefs.showLastKnown,
  })
}
watch([labelPrefs, hpPrefs, markerPrefs, lastKnownPrefs, uiHidden], pushLabelPrefs, { deep: true })
// 旋转 / 跨断点改变手机形态时同步触屏相机契约（场景已建时立即生效）
watch(isPhone, (v) => sceneApiRef.value?.setMobileTouch?.(v))

/** 事件流 → seek 转交：一次性消费（按请求 id）。执行后记下已消费 id——切走再切回 3D、
 *  或 hasData 重新就绪都不会重放旧请求；换文件时工作台已把请求清空。 */
const consumedSeekId = ref<number | null>(null)
watch(() => [props.pendingSeek, props.active, store.hasData] as const, ([req]) => {
  const r = req
  if (!r || typeof r.sec !== 'number' || typeof r.id !== 'number') return
  if (r.id === consumedSeekId.value) return
  if (!props.active || !store.hasData || !sceneApiRef.value?.seekTime) return
  sceneApiRef.value.seekTime(r.sec)
  consumedSeekId.value = r.id
})
// 换文件：作废已消费标记（新场的请求 id 仍单调，标记本身可不重置；保留以便审计）

/** 最近一次加载的文件：失败后"重试"直接重新解析，不必再选一次 */
const lastFile = shallowRef<File | null>(null)
const lastFileName = ref('')
const loadingMessage = computed(() => t(store.assetStage ? 'agentReplay.loading_assets' : 'agentReplay.parsing'))
/** 视窗是否已过加载阶段：解析/资产加载中不置位（内容就绪、阻断、离线、WebGL 不支持、
 *  场景错误均为终态/就绪）。工作台自动居中只等这个信号。 */
const paneReady = computed(() => !props.file || !!props.blockedReason || !online.value.available
  || !webgl.supported || !!store.err || !!store.hasData
  // 待开播（视口 + 画质选择已渲染，等用户按开始）：这是最终界面，不是加载中
  || props.file !== startedFile.value)

// 画质徽标按 qualityKey 三语计算（store.qualityLabel 为上游兼容中文字段）
const qualityBadge = computed(() =>
  t('agentReplay.quality') + ' · ' + t('agentReplay.q_' + store.qualityKey),
)

/** 地图名三语：优先按资产面 key 查 map_names.json，查不到再用解析器给的名字，都没有就原样显示 */
const mapTitle = computed(() => {
  const key = store.mapKey
  const byKey = key ? mapLabel(key, locale.value) : null
  if (byKey && byKey !== key) return byKey
  return mapLabel(store.mapName, locale.value) || store.mapName
})

// 相机 / 画质档位文案都是用户可见文本，且本应用支持运行中切语言（MorePanel 的 setLocale 不刷新页面），
// 所以走 computed 每次重算——不得在 setup 里定死一次，也不用内核预设里的固定中文 label。
const recorderUnavailableReason = computed(() => {
  if (store.recorderViewAvailable) return ''
  if (store.recorderCameraStatus === 'loading') return t('agentReplay.cam_recorder_loading')
  if (store.recorderCameraStatus === 'ready' && !store.recorderModeUnknown) return t('agentReplay.cam_recorder_dead')
  return t('agentReplay.cam_recorder_unsupported')
})
const CAMERAS = computed(() => [
  { value: 'free', label: t('agentReplay.cam_free') },
  // 沙盘是持续模式（OrbitControls 绕**地图中心**旋转/缩放）；一次性的「俯视」按钮在 ReplayCameraTools
  { value: 'top', label: t('agentReplay.cam_sandbox') },
  {
    value: 'recorder',
    label: t('agentReplay.cam_recorder'),
    disabled: !store.recorderViewAvailable,
    title: recorderUnavailableReason.value,
  },
])
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)

// 顶栏双方总血量：数值用**完整整数**（§11 HUD 禁止 1k / 22.3k 缩写，与 2D HUD 同口径）；
// 色条宽度用原始百分比（不取整，血量缓慢下降时条仍平滑），title 上给取整百分比。
// computed 提升对象构造：模板内联函数调用在每次父渲染（~10Hz HUD 节流）都生成新 prop
// 身份，击穿子组件的 props 等值短路。
const hudFriendlyHp = computed(() => hudHealth(store.hpFriend, store.hpFriendMax))
const hudEnemyHp = computed(() => hudHealth(store.hpEnemy, store.hpEnemyMax))
function hudHealth(current: number, maximum: number) {
  return {
    state: 'EXACT',
    knownRemaining: Number.isFinite(Number(current)) ? Math.max(0, Number(current)) : 0,
    totalMax: Number.isFinite(Number(maximum)) ? Math.max(0, Number(maximum)) : 0,
    unknownMax: 0,
  }
}

/** Banner colors follow the current profile and Recorder perspective. */
const teamColors = computed(() => {
  // 主题偏好是唯一主题状态源：它变了就重读一次 token 值
  void uiProfile.value
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return { ally: 'currentColor', enemy: 'currentColor', unknown: 'currentColor' }
  }
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string) => styles.getPropertyValue(name).trim() || 'currentColor'
  return {
    ally: read('--color-team-ally'),
    enemy: read('--color-team-enemy'),
    unknown: read('--color-text-secondary'),
  }
})

/** Physical identities stay in the store; shared roster presentation derives Recorder colors. */
const rosterLanes = computed(() => rosterLanesFor(store.roster, store.friendlyTeam))

/** 选中行（详情面用它取实时投影；随名册每帧更新，所以是 computed 不是快照） */
const selectedRow = computed(() => {
  if (selectedEid.value == null) return null
  const g = store.roster
  return g.team1.find((p) => p.eid === selectedEid.value)
    || g.team2.find((p) => p.eid === selectedEid.value)
    || g.unknown.find((p) => p.eid === selectedEid.value)
    || null
})

// Scene and Details consume the same workspace-owned parse result.
return {
  t, locale, onboarding, guideOpenedDisplay, availability, requireFeature, online, labelPrefs,
  hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden, displayOpen,
  displayAnchor, toggleDisplay, controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen, slideContentClose,
  slideContentShut, clearSlideHeight, dockControls, toggleControls, isPhone, isPortrait, portraitFlow, compactBar,
  phoneLandscape, selectedEid, detailsOpen, detailsSide, followFromRoster, followUnlessRecorder, handleSceneSelect, selectVehicle,
  detailsSideFor, closeDetails, cameraTools, chooseCamera, setUiHidden, toggleUiHidden, onUiToggleKeydown, showTopbar,
  showRoster, showKillfeed, showBaseStatus, showFps, fpsText, fpsJanky, store, stage,
  labelOverlay, recorderReticle, sceneApiRef, annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState, annotationToolbarProps, annotationToolbarHandlers, playbackFacet,
  facetShots, facetKills, timelineHighlightEid, shotTicks, killTicks, jumpShot, jumpBase, rideRoster,
  rideAllyTeam, rideVehicle, transport, renderActive, fly, webgl, pushLabelPrefs, consumedSeekId,
  lastFile, lastFileName, loadingMessage, paneReady, qualityBadge, mapTitle, recorderUnavailableReason, CAMERAS,
  QUALITY_ORDER, PLAYBACK_SPEEDS, PLAYBACK_STEP_SECONDS, formatPlaybackClock, rootEl, hudEl, controlsEl, shortWorkspace, hudFriendlyHp, hudEnemyHp, hudHealth, teamColors, rosterLanes, selectedRow
}
}

import { QUALITY_PRESETS } from '../scene/playbackScene.js'
