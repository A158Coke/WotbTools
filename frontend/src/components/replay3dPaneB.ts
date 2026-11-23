import { createPlaybackStore } from '../scene/playbackStore.js'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SceneApiLike } from './replay3dPaneA.js'

type I18nT = ReturnType<typeof useI18n>['t']
type Availability = { pending: boolean; available: boolean }

/** B 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
export interface R3dBParts {
  t: I18nT
  locale: Ref<string>
  selectedEid: Ref<number | null>
  jumpBase: number | null
  sceneApi: SceneApiLike | null
  displayOpen: Ref<boolean>
  followFromRoster: (eid: number) => void
  hpPrefs: { showHp: boolean }
  labelPrefs: { showPlayerName: boolean; showTankName: boolean; showReload: boolean }
  lastKnownPrefs: { showLastKnown: boolean }
  markerPrefs: { classIcons: boolean; showStatus: boolean; battleMarkers?: boolean }
  online: Ref<Availability>
  startedFile: Ref<unknown>
  uiHidden: Ref<boolean>
  isPhone: Ref<boolean>
}

export interface R3dBProps {
  active: boolean
  blockedReason: string
  file: unknown
  pendingSeek: { id: number; sec: number; speed?: number; playing?: boolean } | null
}
import { computed, ref, watch } from 'vue'
import { publishViewerClock } from '../scene/playback/viewerClockSync.js'
import { useSceneAnnotations } from '../composables/useSceneAnnotations.js'
import { buildKillTicks, buildShotTicks, findNextShotTime, findPrevShotTime, rosterRideTarget } from '../utils/playbackShortcuts.ts'
import { usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import { useSceneActivity } from '../composables/useSceneActivity'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { mapLabel } from '../utils/helpers.js'
import { QUALITY_PRESETS } from '../scene/playbackScene.js'
import { PLAYBACK_ROLES } from '../data/mapTeamColors.js'
import { rosterLanesFor } from '../scene/rosterState.js'
import { gunMarksByAccount } from '../utils/gunMarks.js'
import { formatPlaybackClock } from '../utils/playbackClock'

export function r3dB(S: R3dBParts, props: R3dBProps): void {
const store = createPlaybackStore()
watch([() => store.time, () => store.playing, () => store.hasData, () => store.startTime, () => store.speed], ([t, p, ready, startRaw, s]) => publishViewerClock('3d', t - startRaw, p, ready, startRaw, s), { immediate: true }) // 统一面板跨视图时钟
const stage = ref<HTMLElement | null>(null)
const labelOverlay = ref<HTMLElement | null>(null)
const recorderReticle = ref<HTMLElement | null>(null)

// 3D annotation（selected-surface drawing；无 surfaceY/surfaceN 时 terrain fallback）：会话唯一 owner =
// useSceneAnnotations（与地图预览 3D 共用）；scene 只消费 projection 与 interaction 配置。
// V1 不持久化，换文件 / 场景销毁即清空。recorder 镜头不开 drawing；Display 与 drawing 互斥。
const {
  annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState,
  toolbarProps: annotationToolbarProps, toolbarHandlers: annotationToolbarHandlers,
} = useSceneAnnotations({
  getSceneApi: () => S.sceneApi,
  interactionReady: () => store.hasData,
  canOpen: () => store.cam !== 'recorder',
  onOpen: () => { S.displayOpen.value = false },
})
/**
 * 事件刻度 / 跳炮击 / 数字键骑乘（借鉴 blitzinfo）的数据面：
 * AgentPlaybackFacet（shots[].t_fire、kills[].t、vehicles[].team）由工作台解析，
 * 经场景生命周期发布到 store.playbackSession（与 canonical 同一个工作台状态对象）。
 * 时间轴刻度的 t→百分比换算在 utils/playbackShortcuts.js 纯函数里，与滑块 min/max 同语义。
 */
const playbackFacet = computed(() => store.playbackSession?.scenePlayback ?? null)
// 左下滚动流（快捷指令 / 聊天 / 地图标记）呈现已出仓 PlaybackChatFeed.vue
// （行文案事实源 eventRowTitle + useTankNames 表同源；行数预算回归 1500）。
const markerKindLabels = computed(() => ({
  ping: S.t('battleMarkers.kind_ping'), help: S.t('battleMarkers.kind_help'),
  attack: S.t('battleMarkers.kind_attack'), retreat: S.t('battleMarkers.kind_retreat'),
  sector: S.t('battleMarkers.kind_sector'),
  target_attack: (target: string, who: string) => S.t('battleMarkers.target_attack', { target, who }), target_retreat: (target: string, who: string) => S.t('battleMarkers.target_retreat', { target, who }),
}))
const facetShots = computed(() => Array.isArray(playbackFacet.value?.shots) ? playbackFacet.value.shots : [])
const facetKills = computed(() => Array.isArray(playbackFacet.value?.kills) ? playbackFacet.value.kills : [])
/** 刻度高亮的「当前跟随者」：仅 follow 相机档下才存在（setFollow 被 free/top/recorder 清零，
 *  selectedEid 只代表选中）。未跟随时不传 eid，作者本人的炮击仍按 facet 的 is_author 高亮。 */
const timelineHighlightEid = computed(() => (store.cam === 'follow' && S.selectedEid.value != null) ? S.selectedEid.value : null)
const shotTicks = computed(() => buildShotTicks(facetShots.value, store.startTime, store.duration, timelineHighlightEid.value))
const killTicks = computed(() => buildKillTicks(facetKills.value, store.startTime, store.duration))

/** `,` 上一发 / `.` 下一发：以 shots[].t_fire 为序列（纯函数查最近邻），无更多炮击则保持不动。
 *  seekTime 不改播放态：暂停中跳完仍是暂停，播放中跳完继续播。 */
function jumpShot(direction: -1 | 1): void {
  const shots = facetShots.value
  // 连续跳转基准：上一次跳到的炮击时刻（暂停时 store.time 停在 t-0.05，直接用它作基准会反复选中同一发）。
  const base = S.jumpBase ?? store.time
  const target = direction < 0
    ? findPrevShotTime(shots, base)
    : findNextShotTime(shots, base)
  if (target == null) return
  S.jumpBase = target
  // seekTo 用 firstIndexAfter(严格晚于 T) 定位弹道游标：回退 0.05s（半个包钟量子）让游标停在目标发之前。
  const seekTo = Math.max(store.startTime, target - 0.05)
  S.sceneApi?.seekTime(seekTo)
}
// 跳转基准失效：时间离开「上次跳转落点（target-0.05）」超过一个步长容差

watch(() => store.time, (t) => {
  if (S.jumpBase == null) return
  if (Math.abs(t - (S.jumpBase - 0.05)) > 0.11) S.jumpBase = null
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
function rideVehicle(digit: number, isShift: boolean): void {
  const eid = rosterRideTarget(rideRoster.value, digit, isShift, rideAllyTeam.value)
  if (eid == null) return
  S.followFromRoster(eid)
}

const transport = usePlaybackTransport({
  isPlaying: () => store.playing,
  play: () => S.sceneApi?.setPlaying(true),
  pause: () => S.sceneApi?.setPlaying(false),
  step: (delta) => S.sceneApi?.seekBy(delta),
  isAtEnd: () => store.hasData && store.duration > store.startTime && store.time >= store.duration,
  restart: () => S.sceneApi?.seekTime(store.startTime),
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
  setFlySpeed: (n) => S.sceneApi?.setFlySpeed(n),
  isActive: () => renderActive.value,
  canFly: () => !!S.sceneApi && store.hasData && !props.blockedReason,
  getSceneApi: () => S.sceneApi,
})
// 审计 3D-23：渲染器创建前做 WebGL 预检；不支持时不初始化场景，整块换成说明
const webgl = detectWebGL()

/**
 * 把共享偏好推给场景内核（唯一方向：偏好 → 场景；场景只读，不回写）。
 * 建场景时要补推一次——内核在 initPlayback 之后才有 setLabelPrefs。
 */
function pushLabelPrefs() {
  S.sceneApi?.setLabelPrefs?.({
    enabled: !S.uiHidden.value,
    showPlayerName: S.labelPrefs.showPlayerName,
    showTankName: S.labelPrefs.showTankName,
    showHp: S.hpPrefs.showHp,
    showReload: S.labelPrefs.showReload,
    classIcons: S.markerPrefs.classIcons,
    showStatus: S.markerPrefs.showStatus,
    // 可视性诚实呈现（离场坦克显示最后已知位置；偏好持久化归 usePlaybackPreferences）
    lastKnown: S.lastKnownPrefs.showLastKnown,
  })
}
watch([S.labelPrefs, S.hpPrefs, S.markerPrefs, S.lastKnownPrefs, S.uiHidden], pushLabelPrefs, { deep: true })
// 战场快捷标记开关独立下发（持久化 owner = usePlaybackPreferences.markerPrefs.battleMarkers；
// 场景侧 owner = playbackScene.setBattleMarkers / markerRuntime.setEnabled）。
// 「隐藏全部 UI」同样隐藏标记本体与来源卡（与名牌/顶栏同语义）——窗口状态模型下
// 关闭清活动体、恢复按当前 T 确定性重算，无补播副作用。
watch([() => S.markerPrefs.battleMarkers, S.uiHidden], ([on, hidden]) => S.sceneApi?.setBattleMarkers?.(!!on && !hidden))
// 旋转 / 跨断点改变手机形态时同步触屏相机契约（场景已建时立即生效）
watch(S.isPhone, (v) => S.sceneApi?.setMobileTouch?.(v))

/** 事件流 / 2D 面板 → seek 转交：一次性消费（按请求 id）；换文件时工作台已把请求清空。 */
const consumedSeekId = ref<number | null>(null)
watch((): [R3dBProps['pendingSeek'], boolean, boolean] => [props.pendingSeek, props.active, store.hasData], ([req]) => {
  const r = req
  if (!r || typeof r.sec !== 'number' || typeof r.id !== 'number') return
  if (r.id === consumedSeekId.value) return
  if (!props.active || !store.hasData || !S.sceneApi?.seekTime) return
  S.sceneApi.seekTime(r.sec)
  if (typeof r.speed === 'number' && Number.isFinite(r.speed)) S.sceneApi.setSpeed(r.speed)
  if (typeof r.playing === 'boolean') S.sceneApi.setPlaying(r.playing)
  consumedSeekId.value = r.id
})
// 换文件：作废已消费标记（新场的请求 id 仍单调，标记本身可不重置；保留以便审计）

/** 最近一次加载的文件：失败后"重试"直接重新解析，不必再选一次 */

const lastFileName = ref('')
const loadingMessage = computed(() => S.t(store.assetStage ? 'agentReplay.loading_assets' : 'agentReplay.parsing'))
/** 视窗是否已过加载阶段：解析/资产加载中不置位（内容就绪、阻断、离线、WebGL 不支持、
 *  场景错误均为终态/就绪）。工作台自动居中只等这个信号。 */
const paneReady = computed(() => !props.file || !!props.blockedReason || !S.online.value.available
  || !webgl.supported || !!store.err || !!store.hasData
  // 待开播（视口 + 画质选择已渲染，等用户按开始）：这是最终界面，不是加载中
  || props.file !== S.startedFile.value)

// 画质徽标按 qualityKey 三语计算（store.qualityLabel 为上游兼容中文字段）
const qualityBadge = computed(() =>
  S.t('agentReplay.quality') + ' · ' + S.t('agentReplay.q_' + store.qualityKey),
)

/** 地图名三语：优先按资产面 key 查 map_names.json，查不到再用解析器给的名字，都没有就原样显示 */
const mapTitle = computed(() => {
  const key = store.mapKey
  const byKey = key ? mapLabel(key, S.locale.value) : null
  if (byKey && byKey !== key) return byKey
  return mapLabel(store.mapName, S.locale.value) || store.mapName
})

// 相机 / 画质档位文案都是用户可见文本，且本应用支持运行中切语言（MorePanel 的 setLocale 不刷新页面），
// 所以走 computed 每次重算——不得在 setup 里定死一次，也不用内核预设里的固定中文 label。
const recorderUnavailableReason = computed(() => {
  if (store.recorderViewAvailable) return ''
  if (store.recorderCameraStatus === 'loading') return S.t('agentReplay.cam_recorder_loading')
  if (store.recorderCameraStatus === 'ready' && !store.recorderModeUnknown) return S.t('agentReplay.cam_recorder_dead')
  return S.t('agentReplay.cam_recorder_unsupported')
})
const CAMERAS = computed(() => [
  { value: 'free', label: S.t('agentReplay.cam_free') },
  // 沙盘是持续模式（OrbitControls 绕**地图中心**旋转/缩放）；一次性的「俯视」按钮在 ReplayCameraTools
  { value: 'top', label: S.t('agentReplay.cam_sandbox') },
  {
    value: 'recorder',
    label: S.t('agentReplay.cam_recorder'),
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
function hudHealth(current: unknown, maximum: unknown): { state: string; knownRemaining: number; totalMax: number; unknownMax: number } {
  return {
    state: 'EXACT',
    knownRemaining: Number.isFinite(Number(current)) ? Math.max(0, Number(current)) : 0,
    totalMax: Number.isFinite(Number(maximum)) ? Math.max(0, Number(maximum)) : 0,
    unknownMax: 0,
  }
}

/** Banner colors follow the shared Playback role palette (no document-root token read). */
const teamColors = computed(() => ({
  ally: PLAYBACK_ROLES.friendly.text,
  enemy: PLAYBACK_ROLES.enemy.text,
  unknown: PLAYBACK_ROLES.neutral.base,
}))

/** Physical identities stay in the store; shared roster presentation derives Recorder colors. */
const rosterLanes = computed(() => rosterLanesFor(store.roster, store.friendlyTeam))

/** 选中行（详情面用它取实时投影；随名册每帧更新，所以是 computed 不是快照） */
const selectedRow = computed(() => {
  if (S.selectedEid.value == null) return null
  const g = store.roster
  return g.team1.find((p) => p.eid === S.selectedEid.value)
    || g.team2.find((p) => p.eid === S.selectedEid.value)
    || g.unknown.find((p) => p.eid === S.selectedEid.value)
    || null
})

// Scene and Details consume the same workspace-owned parse result.
const detailPlayback = computed(() => store.hasData ? store.playbackSession?.canonical : null)
const gunMarks = computed(() => gunMarksByAccount(detailPlayback.value?.result))
// Canonical identity may finish after the scene facet. Refresh class symbols
// even when the replay clock is paused at the same frame.
watch(detailPlayback, pushLabelPrefs)
/**
 * 战斗时钟（与 2D 同一口径：0 = 开战）的唯一权威是场景引擎：它持有 [START, END]（发布为 store.startTime /
 * store.duration），seek、自动停止与进度都夹在里面。canonical 就绪 / 失败 / 换会话时把它的 clock 交给引擎
 * （setBattleClock），引擎重定范围并把 T 夹回去；canonical 之前引擎用自己按同一 resolver 推出的时钟。
 * 播放条、顶栏计时与 Details 只读引擎发布的原点：同一时刻在 2D / 3D 显示同一个时间。
 */
const battleTimeLabel = computed(() => formatPlaybackClock(store.time - store.startTime))
// Details 查的是 canonical track：canonical 在时必须按它自己的 clock.startRaw 换算（canonical 数据就按这个原点索引）；
// 引擎接管 canonical clock 后与 store.startTime 是同一个值，canonical 之前才用引擎发布的原点。
const detailTime = computed(() => Math.max(0, store.time - (detailPlayback.value?.clock?.startRaw ?? store.startTime)))
// Refresh life facts too when canonical finishes at an unchanged clock/time.
watch(detailPlayback, (canonical) => S.sceneApi?.setBattleClock?.(canonical?.clock ?? null))

  Object.assign(S, {
    store,
    stage,
    labelOverlay,
    recorderReticle,
    annotationOpen,
    annotationTool,
    pushAnnotationProjection,
    pushAnnotationInteraction,
    pushAnnotationVisibility,
    commitAnnotationFromScene,
    eraseFromScene,
    openAnnotation,
    closeAnnotation,
    resetAnnotationState,
    annotationToolbarProps,
    annotationToolbarHandlers,
    playbackFacet,
    markerKindLabels,
    facetShots,
    facetKills,
    timelineHighlightEid,
    shotTicks,
    killTicks,
    jumpShot,
    rideRoster,
    rideAllyTeam,
    rideVehicle,
    transport,
    renderActive,
    fly,
    webgl,
    pushLabelPrefs,
    consumedSeekId,
    lastFileName,
    loadingMessage,
    paneReady,
    qualityBadge,
    mapTitle,
    recorderUnavailableReason,
    CAMERAS,
    QUALITY_ORDER,
    hudFriendlyHp,
    hudEnemyHp,
    hudHealth,
    teamColors,
    rosterLanes,
    selectedRow,
    detailPlayback,
    gunMarks,
    battleTimeLabel,
    detailTime
  })
}
