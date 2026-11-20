import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { cumulativeStatsAtV2, healthDisplayAt, lifeAt, positionAtV2, positionCoveredAtV2 } from '../utils/battlePlaybackV2.ts'
import { detailsDamageLogAtV2 } from '../utils/playbackDetails.js'
import { Feature } from '../app/featureCapabilities.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { initPlayback } from '../scene/playbackScene.js'
import type { SceneApiLike } from './replay3dPaneA.js'
import type { LocalPlayback } from '../replay-local/playback/parseLocalPlayback.js'
import type { useFeatureGate } from '../composables/useFeatureGate.js'
import { createPlaybackStore } from '../scene/playbackStore.js'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import type { useI18n } from 'vue-i18n'

type Store = ReturnType<typeof createPlaybackStore>
type FlyControls = ReturnType<typeof useSceneFlyControls>
type I18nT = ReturnType<typeof useI18n>['t']
type RosterRowLike = { eid: number; accountId: number | null; tankId: number | null; team: number | null; nick: string; tank: string; dead?: boolean; hp?: number; maxHp?: number }

type SceneLoadOptions = Parameters<NonNullable<SceneApiLike['loadData']>>[0]
type SceneSession = NonNullable<SceneLoadOptions['session']>

/** 工作台共享 session 的最小面（owner = useReplayWorkspace.playbackSession）。
 *  loadScene 是场景 loadData 复用工作台共享解析的入口；getState/invalidate 供重试用。 */
interface PlaybackSessionLike extends Pick<SceneSession, 'loadScene'> {
  getState(file: File): { sceneState: string }
  invalidate(file: File): void
}

/** C 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
export interface R3dCParts {
  store: Store
  t: I18nT
  selectedEid: Ref<number | null>
  detailsOpen: Ref<boolean>
  displayOpen: Ref<boolean>
  selectedRow: Ref<RosterRowLike | null>
  detailPlayback: Ref<LocalPlayback | null>
  detailTime: Ref<number>
  teamColors: Ref<{ ally: string; enemy: string; unknown: string }>
  parseController: AbortController | null
  lastFile: File | null
  lastFileName: Ref<string>
  loadedFile: File | null
  requireFeature: ReturnType<typeof useFeatureGate>['requireFeature']
  sceneApi: SceneApiLike | null
  renderActive: Ref<boolean>
  fly: FlyControls
  resetAnnotationState: () => void
  commitAnnotationFromScene: (...args: never[]) => void
  eraseFromScene: (...args: never[]) => void
  pushAnnotationProjection: () => void
  pushAnnotationInteraction: () => void
  pushAnnotationVisibility: () => void
  closeAnnotation: () => void
  recorderReticle: Ref<HTMLElement | null>
  labelOverlay: Ref<HTMLElement | null>
  stage: Ref<HTMLElement | null>
  isPhone: Ref<boolean>
  markerPrefs: { battleMarkers?: boolean }
  uiHidden: Ref<boolean>
  compactBar: Ref<boolean>
  portraitFlow: Ref<boolean>
  portraitGeneration: number
  laneBoundsObserver: ResizeObserver | null
  handleSceneSelect: (eid: number | null, event?: MouseEvent | null) => void
  onUiToggleKeydown: (event: KeyboardEvent) => void
  pushLabelPrefs: () => void
  online: Ref<{ available: boolean }>
  webgl: { supported: boolean }
  jumpBase?: number | null
  QUALITY_ORDER: string[]
}

export interface R3dCProps {
  active: boolean
  autoFullscreenToken: number
  blockedReason: string
  file: File | null
  playbackSession: PlaybackSessionLike | null
}

export function r3dC(S: R3dCParts, props: R3dCProps): void {
const selectedTrack = computed(() => S.detailPlayback.value?.dataset?.vehicles.find(track =>
  S.selectedRow.value?.accountId != null && track.accountId === S.selectedRow.value.accountId) || null)
const selectedLife = computed(() => selectedTrack.value ? lifeAt(selectedTrack.value, S.detailTime.value) : null)
const selLastKnownSec = computed(() => {
  const track = selectedTrack.value
  if (!track || positionCoveredAtV2(track.positionSegments, S.detailTime.value)) return null
  return positionAtV2(track.positionSegments, S.detailTime.value)?.timeSec ?? null
})
const selCurStats = computed(() => {
  const playback = S.detailPlayback.value
  const track = selectedTrack.value
  if (!track || !playback || !playback.dataset) return null
  return cumulativeStatsAtV2(playback.dataset.events, track, S.detailTime.value, playback.dataset.vehicles)
})
const selDamageLog = computed(() => detailsDamageLogAtV2(S.detailPlayback.value?.dataset,
  selectedTrack.value, S.detailTime.value, S.t('recon.map.playback.source_unknown')))
const selectedPortraitUrl = ref<string | null>(null)

watch(() => selectedTrack.value?.tankId ?? S.selectedRow.value?.tankId, async tankId => {
  const generation = ++S.portraitGeneration
  selectedPortraitUrl.value = null
  if (tankId == null) return
  try {
    const { loadVehiclePortrait } = await import('../vehicle-portraits/runtime.js')
    const url = await loadVehiclePortrait(tankId)
    if (generation === S.portraitGeneration) selectedPortraitUrl.value = url
  } catch { /* Missing assets keep the panel without a portrait. */ }
})

const selectedDetailState = computed(() => S.selectedRow.value ? {
  vehicle: selectedTrack.value || { tankName: S.selectedRow.value.tank, playerName: S.selectedRow.value.nick,
    tankId: S.selectedRow.value.tankId, accountId: S.selectedRow.value.accountId,
    team: S.selectedRow.value.team, friendly: ([1, 2] as Array<number | null>).includes(S.store.friendlyTeam) && ([1, 2] as Array<number | null>).includes(S.selectedRow.value.team) ? S.selectedRow.value.team === S.store.friendlyTeam : null },
  destroyed: selectedLife.value ? selectedLife.value.lifeState === 'DESTROYED' : S.selectedRow.value.dead,
  destroyedKnownAtSec: selectedLife.value?.destroyedKnownAtSec ?? null,
} : null)
const selectedHealth = computed(() => {
  if (selectedTrack.value) {
    const health = healthDisplayAt(selectedTrack.value, S.detailTime.value)
    return { currentHp: health?.currentHp ?? null, maxHp: health?.displayCapacityHp ?? null }
  }
  return S.selectedRow.value ? {
    currentHp: typeof S.selectedRow.value.hp === 'number' && Number.isFinite(S.selectedRow.value.hp) ? S.selectedRow.value.hp : null,
    maxHp: typeof S.selectedRow.value.maxHp === 'number' && Number.isFinite(S.selectedRow.value.maxHp) && S.selectedRow.value.maxHp > 0 ? S.selectedRow.value.maxHp : null,
  } : null
})

const bannerColor = computed(() => {
  const outcome = S.store.banner?.outcome
  if (outcome === 'win') return S.teamColors.value.ally
  if (outcome === 'lose') return S.teamColors.value.enemy
  return S.teamColors.value.unknown
})

/**
 * 把目标文件交给场景内核。
 *
 * **加载状态不属于组件层**：`playbackScene.loadData()` 自己持有代数 guard 与
 * `loading` / `err` / `assetStage` / `assetProgress` 的唯一写入权（见其 finally 的
 * `gen === sessionGen || gen + 1 === sessionGen` 判定）。组件层若也写 `store.loading`，
 * 就会出现「旧场景的迟到完成把新场景的 loading 清掉」——两边代数不同步，且组件层没有
 * 任何 guard。所以这里只发命令与记录最近文件（重试用）。
 */
/**
 * 解析任务的 session 所有权（P0：replay parser lifecycle is session-owned）：
 * 清空 / 换文件 / 销毁时**真正 abort 在途解析**，不只是丢弃结果——否则旧解析继续占着
 * Worker 队列，极端情况下（Worker 不回包）新文件永远排队、面板卡在「解析中」。
 * 工作台 session 路径由 owner 在 selection 变化 / 工作台销毁时取消共享解析；
 * 独立场景路径的 signal 经 source 透传给 replaySource；被 abort 的旧加载其错误
 * 由内核的代数 guard 吞掉（新加载已接管归属），不会写成用户可见错误。
 */

function abortParse(): void {
  S.parseController?.abort()
  S.parseController = null
}

async function loadFile(file: File): Promise<void> {
  // 连通性门禁在最前；随后是 main 的解析生命周期归属：每次新解析先撤下上一次（abort）并换新的 AbortController。
  if (!file || !S.sceneApi || !S.requireFeature(Feature.PLAYBACK_3D)) return
  abortParse()
  S.parseController = new AbortController()
  S.lastFile = file
  S.lastFileName.value = file.name || 'replay'
  await S.sceneApi.loadData({ kind: 'local', file, signal: S.parseController.signal, session: props.playbackSession ?? undefined })
}

/** 重试：同一份文件重新解析（失败不清空 selection，用户不必再选一次）；错误态由场景层重写 */
async function retryLoad(): Promise<void> {
  if (S.lastFile) {
    if (props.playbackSession?.getState(S.lastFile).sceneState === 'error') props.playbackSession.invalidate(S.lastFile)
    return loadFile(S.lastFile)
  }
}

function bannerText(): string {
  const banner = S.store.banner
  if (!banner) return ''
  return banner.outcome ? S.t('agentReplay.banner_' + banner.outcome) : (banner.text ?? '')
}
function killfeedVerb(kf: { kill?: boolean }): string {
  // 结构化渲染（三语）：击杀 = killer × victim；环境/非击杀只标阵亡（cause 细节上游为中文后缀）
  return S.t(kf.kill ? 'agentReplay.destroyed' : 'agentReplay.destroyed_by_environment')
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
function destroyScene(): void {
  abortParse()   // 场景销毁 = 解析任务一并撤下（在途解析不得再占 Worker 队列）
  S.resetAnnotationState()   // 场景消失 = annotation 派生层与 history 一并清空（V1 不持久化）
  S.selectedEid.value = null
  S.detailsOpen.value = false
  S.fly.stopLoop()   // 场景销毁：飞行循环停 + 按键清空（重建后按住键需重新按下）
  if (!S.sceneApi) return
  S.sceneApi.destroy?.()
  S.sceneApi = null
}

/** 当前是否应存在场景（模板 v-else 分支的条件，必须与它逐字一致） */
function shouldHaveScene(): boolean {
  return S.online.value.available && !!S.webgl.supported && !props.blockedReason && !!props.file
}

/** 需要则建场景（返回是否新建）；已存在则复用，不重建、不重解析 */
function ensureScene(): boolean {
  // 两侧约束都要保留：
  //   · `!props.active` —— 未激活的能力不得建场景（不需要激活就初始化会在切走时白跑渲染）；
  //   · `labelOverlay.value` —— 3D 名牌改屏幕空间 DOM 锚点后，场景需要覆盖层句柄。
  if (S.sceneApi || !S.renderActive.value || !shouldHaveScene()) return false
  const stageEl = S.stage.value
  if (!stageEl) return false
  S.sceneApi = initPlayback(stageEl, S.store, S.labelOverlay.value, {
    onVehicleSelect: S.handleSceneSelect,
    onAnnotationCommit: S.commitAnnotationFromScene,
    onAnnotationErase: S.eraseFromScene,
    recorderReticle: S.recorderReticle.value,
  })
  S.sceneApi?.setPaused?.(!S.renderActive.value)
  S.sceneApi?.setFlySpeed?.(S.fly.flySpeedIndex())   // 新场景补推当前飞行速率档（重建不丢档）
  S.sceneApi?.setMobileTouch?.(S.isPhone.value)      // 移动端触屏相机契约（单指分流 / 双指不控制）
  S.pushLabelPrefs();   // 新场景默认吃共享偏好（含"隐藏全部 UI"的当前状态）
  S.sceneApi?.setBattleMarkers?.(!!S.markerPrefs.battleMarkers && !S.uiHidden.value);   // 战场快捷标记随新场景补推（持久化偏好 × 隐藏全部 UI）
  S.pushAnnotationProjection()
  S.pushAnnotationInteraction()
  S.pushAnnotationVisibility()
  return true
}

/** 解析目标回放：同一次会话内同一文件不重复解析 */


/**
 * 待开播：文件到位后先让用户选画质，按「开始」才解析 + 拉资产。
 * 画质必须在渲染器创建前定型（内核 `startPlayback()` 惰性建渲染器、首帧按当前档位），
 * 所以这一步不能省成"加载中也能切档"。`startedFile` = 用户已按过开始的那一场。
 */
const startedFile = shallowRef<File | null>(null)
const qualityOptions = computed(() =>
  S.QUALITY_ORDER.map((k) => ({ value: k, label: S.t('agentReplay.q_' + k) })),
)

function startReplay(): void {
  if (!props.file) return
  startedFile.value = props.file
  reconcileScene()
}

function reconcileScene(): void {
  if (!shouldHaveScene()) {
    destroyScene()
    S.loadedFile = null
    startedFile.value = null
    return
  }
  const created = ensureScene()
  const file = props.file
  // 尚未按开始（含换到另一场）：先撤下上一场（旧场景会压住待开播面板）与在途解析
  if (file !== startedFile.value) {
    if (S.loadedFile) {
      S.sceneApi?.reset?.()
      abortParse()
      S.loadedFile = null
      S.selectedEid.value = null
      S.detailsOpen.value = false
      S.displayOpen.value = false
    }
    return
  }
  if (created || file !== S.loadedFile) {
    if (!file) return
    S.loadedFile = file
    loadFile(file)
  }
}

// Measure viewport capacity independently of the content-sized Stage row.
const rootEl = ref<HTMLElement | null>(null)
const hudEl = ref<HTMLElement | null>(null)
const controlsEl = ref<HTMLElement | null>(null)

/** 工作台高度低于它时，两行控制条（实测约 137px）放不进场景底部 20% 边带（design-language §5）。 */
const SHORT_WORKSPACE_MAX_H = 700
const KILLFEED_MAX_LINES = 3
const KILLFEED_ROW_BORDER_PX = 2
const killfeedMaxLines = ref(KILLFEED_MAX_LINES)
const visibleKillfeed = computed(() => S.store.killfeed.slice(-killfeedMaxLines.value))
const shortWorkspace = ref(false)
function measurePresentationBounds(): void {
  const root = rootEl.value
  if (!root) return
  const pageStyle = getComputedStyle(document.documentElement)
  const header = parseFloat(pageStyle.getPropertyValue('--header-h')) || 0
  const viewportH = window.visualViewport?.height || window.innerHeight
  const full = document.fullscreenElement === root
  const top = full ? 0 : header
  const workspaceH = Math.max(1, viewportH - top - (full ? 0 : (parseFloat(getComputedStyle(root).getPropertyValue('--pb-viewer-reserve')) || 0)))
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
  // 宽形态的击杀流不得压入场景中心 60% 盒（design-language §5）：按 HUD 下方剩余边带决定渲染几条；紧凑形态贴边例外，竖屏 HUD 不在场景上。
  const hudBottom = (hudEl.value?.getBoundingClientRect().bottom ?? 0) - root.getBoundingClientRect().top
  const killfeedLineH = (parseFloat(style.getPropertyValue('--line-height-caption')) || 16) + KILLFEED_ROW_BORDER_PX + gap
  const lineBudget = Math.floor(((root.clientHeight - controlsH - gap * 2) * 0.2 - hudBottom - gap) / killfeedLineH)
  killfeedMaxLines.value = S.compactBar.value || S.portraitFlow.value || !root.clientHeight ? KILLFEED_MAX_LINES : Math.min(KILLFEED_MAX_LINES, Math.max(1, lineBudget))
  root.style.setProperty('--pb-controls-dock-h', `${Math.ceil(controlsH)}px`)
}
function observeLaneBounds(): void {
  if (typeof ResizeObserver !== 'function') return
  S.laneBoundsObserver?.disconnect()
  S.laneBoundsObserver = new ResizeObserver(measurePresentationBounds)
  for (const el of [rootEl.value, hudEl.value, controlsEl.value]) if (el) S.laneBoundsObserver.observe(el)
}
watch([controlsEl, hudEl], (elements) => {
  for (const el of elements) if (el && S.laneBoundsObserver) S.laneBoundsObserver.observe(el)
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
  isPhone: S.isPhone,
  isActive: () => props.active, // capability 切走（active=false）时不该再锁着方向
  auto: () => ({ token: props.autoFullscreenToken, key: props.file, active: props.active, ready: !!props.file && !props.blockedReason && props.file === startedFile.value && !S.store.err && !!S.store.hasData }), // 成功就绪（非 paneReady：终态错误时它也为 true）
})

/** ?debug：几何门禁 / 人工排查的状态注入点（与场景内核的 ?debug 钩子同一口径，只暴露
 *  store 引用与车道 DOM，不改变任何行为）。browser 几何门禁据此注入 roster / killfeed，
 *  在真实 Chrome 里断言车道的非交叉几何。 */
type DebugWindow = Window & { __pbPane?: { store: Store; selectedEid: number | null; detailsOpen: boolean; labelOverlay: HTMLElement | null; sceneApi: SceneApiLike | null } }
const debugWindow = window as DebugWindow
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
  debugWindow.__pbPane = {
    store: S.store,
    get selectedEid() { return S.selectedEid.value },
    get detailsOpen() { return S.detailsOpen.value },
    get labelOverlay() { return S.labelOverlay.value },
    /** 场景实例身份：全屏 / 旋转前后必须是同一个（门禁据此断言「没有重建场景」）。 */
    get sceneApi() { return S.sceneApi },
  }
}


onMounted(() => {
  reconcileScene()
  observeLaneBounds()
  window.addEventListener('keydown', S.onUiToggleKeydown)
})
onBeforeUnmount(() => {
  S.portraitGeneration++
  destroyScene()
  S.laneBoundsObserver?.disconnect()
  S.laneBoundsObserver = null
  window.removeEventListener('keydown', S.onUiToggleKeydown)
  if (debugWindow.__pbPane?.store === S.store) delete debugWindow.__pbPane
})

/**
 * file / blockedReason / active 都由工作台派生：
 * 只有 `active` 是「暂停 / 恢复」，其余两个都会改变「场景该不该存在」。
 */
const sceneLiveness = computed(() => [props.file, props.blockedReason, S.renderActive.value, S.online.value.available] as const)
watch(sceneLiveness, (next, previous) => {
  // 先按新的 file/blocked 收敛场景，再处理能力切换
  reconcileScene()
  const active = next[2]
  const activeChanged = previous != null && previous.length >= 3 && previous[2] !== active
  if (activeChanged) {
    S.sceneApi?.setPaused?.(!active)
    if (!active) S.fly.stopLoop()
  }
}, { flush: 'post' })

watch(() => props.active, (active) => {
  // 能力切走 / 页面停用（active 已含 pageActive）：退出本回放拥有的全屏，否则新页面被挡在旧 fullscreen root 后面
  if (!active) { S.closeAnnotation(); unlockOrientation(); exitOwnedFullscreen() }
})

// 面板打开期间尺寸变化（旋转 / 全屏 / 工作台重排）重算可用高度；闭合时不测量
// （此时 .controls 可能整块不存在），打开那一下由 watch(displayOpen) 负责。
function onViewportResize(): void { measurePresentationBounds() }
// 外壳沉浸态切换只改 --header-h，不触发 resize：显式重算预算。
const shellChrome = inject(SHELL_CHROME_KEY, null)
watch(() => shellChrome?.immersive.value, () => nextTick(measurePresentationBounds))
onMounted(() => window.addEventListener('resize', onViewportResize))
onBeforeUnmount(() => window.removeEventListener('resize', onViewportResize))

  Object.assign(S, {
    selectedTrack,
    selectedLife,
    selLastKnownSec,
    selCurStats,
    selDamageLog,
    selectedPortraitUrl,
    selectedDetailState,
    selectedHealth,
    bannerColor,
    abortParse,
    loadFile,
    retryLoad,
    bannerText,
    killfeedVerb,
    destroyScene,
    shouldHaveScene,
    ensureScene,
    startedFile,
    qualityOptions,
    startReplay,
    reconcileScene,
    rootEl,
    hudEl,
    controlsEl,
    SHORT_WORKSPACE_MAX_H,
    KILLFEED_MAX_LINES,
    KILLFEED_ROW_BORDER_PX,
    killfeedMaxLines,
    visibleKillfeed,
    shortWorkspace,
    measurePresentationBounds,
    observeLaneBounds,
    isFullscreen,
    fullscreenSupported,
    toggleFullscreen,
    unlockOrientation,
    exitOwnedFullscreen,
    onViewportResize,
    shellChrome
  })
}
