// ReplayWorkspace 的编排拆分（2026-11-20 行数预算 500）：四个 composable 各持一段编排职责，
// 依赖全部显式入参（不藏 provide/inject）；组件只做模板接线与生命周期声明。
// - useReplayViewerState：能力/挂载/加载失败态/场次选择/2D-3D 进度同步 seek 通道
// - useReplayAutoCenter：切换到回放视窗时的一次性垂直居中（data-pane-ready 门）
// - useReplayIngest：官方示例装载 + Android pending 导入（ACK 语义 owner）
// - useReplayImmersive：手机横屏沉浸态申请 + 强制横屏 + 自动全屏序号
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { REPLACE_DECLINED } from '../shared/onboarding.js'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { mapLabel } from '../utils/helpers.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from './useFeatureGate.js'
import { useAuth } from './useAuth.js'
import { useMountedWhenActive } from './useMountedWhenActive.js'
import { useReplayViewerClockBridge } from './useReplayViewerClockBridge.js'
import { showToast } from './useToast.js'
import { notify } from './useNotifications.js'
import { battlePickerOptions, buildSeriesOverview, replayCollectionRows } from '../utils/replaySeries.js'
import type { Ref } from 'vue'
import type { LazyModule } from '../utils/lazyModule.js'
import type { ReplayCapability } from '../types/workspace.js'
import type { useReplayWorkspace } from './useReplayWorkspace.js'

type Workspace = ReturnType<typeof useReplayWorkspace>
type PaneModules = Record<'playback' | 'three' | 'shots' | 'ai' | 'events', LazyModule<unknown>>

/** 引导/示例入口（AppShell 注入；未接入时为空）。 */
interface OnboardingHooks {
  guideActive?: Ref<boolean>
  sampleOpened?: () => void
}

/** 确认框（useConfirm 的运行时契约；signal 取消 → AbortError）。 */
type ConfirmFn = (options: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  signal?: AbortSignal
}) => Promise<boolean>

/** 能力标签（四个入口；2D/3D/信息流合入「回放」）。 */
export const REPLAY_WORKSPACE_CAPABILITY_OPTIONS = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  // 2026-11-19：2D/3D/事件流合并为一个「回放」入口（面板内切换 2D/3D；事件流常驻下方）。
  // 内部能力键仍保留 playback / 3d / events，深链与鉴权路径零改动。
  { key: 'replay', labelKey: 'workspace.tab_replay' },
  { key: 'shots', labelKey: 'workspace.tab_shots' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
]

/**
 * 能力/挂载/加载失败态/场次选择 + 2D-3D 进度同步 seek 通道。
 * workspace = useReplayWorkspace() 返回值；modules = 五个 defineLazyModule 的稳定组件。
 */
export function useReplayViewerState(
  workspace: Workspace,
  modules: PaneModules,
  { navigate, onboarding }: { navigate?: (view: string) => void; onboarding?: OnboardingHooks | null },
) {
  const { t, locale } = useI18n()
  const { authenticated } = useAuth()
  const { availability, requireFeature } = useFeatureGate()
  const onlineFeatures = { '3d': Feature.PLAYBACK_3D, ai: Feature.AI_REVIEW }
  const threeAvailability = computed(() => availability(Feature.PLAYBACK_3D))
  const aiAvailability = computed(() => availability(Feature.AI_REVIEW))
  const { files, resp, analysis, isDemoSelection } = workspace.replay



/**
 * 能力面板首次进入时才挂载（代码块按需加载、不进主包），之后切走只隐藏：
 * 停渲染但不销毁会话——切回不重新要求文件、不重新解析、保留 timeline / 相机。
 * 失去登录且没有可信示例时卸载受保护面板，selection / 数据结果继续保留。
 */
const activeCapability = workspace.activeWorkspaceTab
const canUseDemoCapabilities = computed(() => authenticated.value || isDemoSelection.value)
/** 统一回放面板的三个内部能力（2D / 3D / 事件流深链）。 */
const VIEWER_CAPS = new Set(['playback', '3d', 'events'])
const viewerActive = computed(() => VIEWER_CAPS.has(activeCapability.value))
/** 面板当前显示哪个 pane：3D 深链/切换 → 3D；playback / events → 2D。 */
const viewerMode = computed(() => (activeCapability.value === '3d' ? '3d' : '2d'))
/** 标签栏的 active 值：三个内部能力都归入「回放」。 */
const activeTab = computed(() => (viewerActive.value ? 'replay' : activeCapability.value))
const viewerMounted = useMountedWhenActive(() => viewerActive.value)
// events 深链复用 2D 视图 + 信息流，因此 2D pane 也要在 events 能力下挂载。
const playbackMounted = useMountedWhenActive(() => activeCapability.value === 'playback' || activeCapability.value === 'events')
// 3D / 射击的登录或可信示例资格与连通性独立；示例不能绕过 ONLINE_REQUIRED 门禁。
const threeMounted = useMountedWhenActive(() =>
  canUseDemoCapabilities.value && activeCapability.value === '3d' && threeAvailability.value.available)
const shotsMounted = useMountedWhenActive(() => canUseDemoCapabilities.value && activeCapability.value === 'shots')
// 事件流现在常驻面板下方：首次进入任意回放能力（且具备资格）即挂载，解析与 3D 共用缓存。
const eventsMounted = useMountedWhenActive(() => canUseDemoCapabilities.value && viewerActive.value)
const aiMounted = useMountedWhenActive(() =>
  authenticated.value && activeCapability.value === 'ai' && aiAvailability.value.available)

/**
 * 能力模块加载失败态（design-language §10）：说清发生了什么 + 下一步怎么做。
 *
 * 失败态是**持久的**：切走再切回来仍然显示，只有用户明确选择才算处理过——
 * 自动清状态只会把「有提示的失败」变成「没有提示的空白」。generation 与 recovery 由
 * `lazyModule` 自己拥有（见其文件头），Workspace 不重复管理。
 *
 * 触发条件是「页面还跑着上一次部署的 bundle，而 chunk 已被新部署替换」——重新加载必然修好，
 * 所以主操作是重新加载；「重试」只覆盖网络瞬断（同一 URL 再试一次即可）。
 */
function paneLoadError(module: LazyModule<unknown>): string {
  return module.error.value ? 'workspace.pane_load_failed' : ''
}
const playbackLoadError = computed(() => paneLoadError(modules.playback))
const threeLoadError = computed(() => paneLoadError(modules.three))
const shotsLoadError = computed(() => paneLoadError(modules.shots))
const aiLoadError = computed(() => paneLoadError(modules.ai))
const eventsLoadError = computed(() => paneLoadError(modules.events))

/** 重试：由 lazyModule 创建新一代 async wrapper（不是重复跑一次 import）。 */
async function retryPane(module: LazyModule<unknown>): Promise<void> {
  await module.retry()
}

/** 模板直接消费的 workspace 权威 ref（顶层绑定，模板自动解包 ref）。 */
const currentBattleId = workspace.currentBattleId

/**
 * 单场能力（2D 回放 / 3D 回放 / 射击分析 / AI 复盘）共用的场次选择器：只列解析成功的场次
 * （failed / duplicate 不入列），选项文案与数据模式一致（第 N 场 · 地图 · 胜方 · 时间）。
 * 数据模式的选择器在 ReplayPage 工具栏里。
 */
const battleOptions = computed(() =>
  battlePickerOptions(buildSeriesOverview(resp.value), { t, locale: locale.value, mapLabel }))
function onBattleSelect(sourceId: string): void {
  workspace.selectBattle(sourceId)
}

/** 单场能力的目标文件：单文件直接用；多文件先批次分析，再选有效场次对应的原始 File */
const targetFile = computed(() => workspace.currentTargetFile.value)
/**
 * 工作台四态由 session 派生，不另存状态：
 * Empty（没有文件）/ Loading（首批加载中）/ Ready（有结果）/ Failure（没有可提交的批次结果）。
 * Loading 与 Failure 时隐藏内容区但不卸载面板；批次里部分失败仍是 Ready。
 */
const initialLoading = computed(() => analysis.value.phase === 'parsing' && !resp.value)
const openFailed = computed(() => analysis.value.phase === 'failed' && !resp.value)
const workspaceReady = computed(() => !!resp.value && files.value.length > 0)
// 解析完成（每份新结果一次）：toast + 本机通知
watch(resp, (next, previous) => {
  // 官方示例（新手教程）不提示：它不是用户自己的解析任务
  if (!next || next === previous || !files.value.length || isDemoSelection.value) return
  const count = files.value.length
  showToast({ id: 'replay-parsed', tone: 'success', titleKey: 'notifications.replayParsed' })
  notify({ id: 'replay-parsed', kind: 'replay-parsed', titleKey: 'notifications.replayParsed', bodyKey: 'notifications.replayParsedBody', params: { count }, view: 'replay' })
})
const contentVisible = computed(() => !files.value.length || !!resp.value)
const demoEntryVisible = computed(() => !files.value.length || onboarding?.guideActive?.value === true)

const sourcePicker = ref<HTMLElement | null>(null)
const collectionManager = ref<HTMLElement | null>(null)
/** 回放列表标「当前」：只在有当前场次语境时。赛后数据汇总看的是整批，没有当前场次。 */
const collectionRows = computed(() => replayCollectionRows(files.value, battleOptions.value, resp.value, {
  currentSourceId: activeCapability.value === 'data' && workspace.dataViewMode.value !== 'SINGLE' ? null : currentBattleId.value,
  parsing: analysis.value.phase === 'parsing',
}))
const collectionProgress = computed(() => (analysis.value.phase === 'parsing' && resp.value
  ? { done: analysis.value.done, total: analysis.value.total } : null))

/** 批次部分失败：其余回放照常可用，提醒在每个能力都可见。确认只对当前这份结果有效。 */
const failedReplayCount = computed(() => resp.value?.failures?.length || 0)
const acknowledgedResult = shallowRef<unknown>(null)
const partialFailureVisible = computed(() => failedReplayCount.value > 0 && acknowledgedResult.value !== resp.value)

const showBattlePicker = computed(() => {
  const cap = activeCapability.value
  if (cap === 'data' || !battleOptions.value.length) return false
  if (viewerActive.value) {
    if (viewerMode.value === '3d') return canUseDemoCapabilities.value && threeAvailability.value.available && !threeLoadError.value
    // events 深链 = 2D 视图 + 信息流；事件流是本地解析能力，只看登录/示例资格与模块状态。
    if (cap === 'events') return canUseDemoCapabilities.value && !eventsLoadError.value
    return !playbackLoadError.value
  }
  if (cap === 'shots') return canUseDemoCapabilities.value && !shotsLoadError.value
  return aiAvailability.value.available && !aiLoadError.value
})
const battlePickerTestId = computed(() => (viewerActive.value ? 'replay' : activeCapability.value) + '-battle-picker')

const VIEW_BY_CAPABILITY = Object.freeze({
  data: 'replay',
  playback: 'battle-playback',
  '3d': 'agent-replay',
  // 事件流是一等能力：必须有自己的 view 槽位，否则 navigate('replay') 会被 ViewHost
  // 映射回 data（切到事件流立刻被路由同步撤销）。
  events: 'agent-events',
  shots: 'agent-shots',
  ai: 'ai-review',
})

/** capability → 路由 view（Back / Forward 与深链仍由 Vue Router 唯一持有）。 */
function viewFor(cap: string): string {
  return (VIEW_BY_CAPABILITY as Record<string, string>)[cap] || 'replay'
}

/** 切换内部能力（workspace tab + feature 门禁）；navigate 决定是否同步 URL。 */
function switchCapability(key: string, pushHistory: boolean): void {
  workspace.setWorkspaceTab(key as ReplayCapability)
  const feature = onlineFeatures[key as keyof typeof onlineFeatures]
  if (feature) requireFeature(feature)
  if (pushHistory && navigate) navigate(viewFor(key))
}

// 2D/3D 时钟交接 + 事件流 seek 通道（owner = useReplayViewerClockBridge）。
const {
  playbackSeek, playbackSeekRequest, pending3dSeek,
  setViewerMode, applyCapabilityFromRoute, onEventSeek, resetViewerClockBridge,
} = useReplayViewerClockBridge({ viewerMode, activeCapability, switchCapability })

/** 2D 时间轴刻度：消费共享 session 的 scenePlayback facet（由信息流/3D 的 loadScene 装载；不主动触发）。 */
const sceneFacet = computed(() => {
  const file = targetFile.value
  if (!file || !workspace.playbackSession?.getState) return null
  return workspace.playbackSession.getState(file)?.scenePlayback ?? null
})
const viewerShotFacet = computed(() => (Array.isArray(sceneFacet.value?.shots) ? sceneFacet.value.shots : []))
const viewerKillFacet = computed(() => (Array.isArray(sceneFacet.value?.kills) ? sceneFacet.value.kills : []))
async function viewIn2d(sec: number): Promise<void> {
  await setCapability('playback')
  playbackSeek.value = null
  await nextTick()
  playbackSeek.value = sec
}

// 换回放：旧场的 seek 请求与时钟镜像随交接通道一起作废。
watch(targetFile, () => resetViewerClockBridge())

/** 标签栏「回放」入口：留在当前 2D/3D 模式（不在回放内时默认 2D）。 */
function onTabSelect(key: string): void {
  if (key === 'replay') {
    setCapability(viewerMode.value === '3d' ? '3d' : 'playback')
    return
  }
  setCapability(key)
}

async function setCapability(key: string): Promise<void> {
  if (key === activeCapability.value) return
  switchCapability(key, true)
}

/** 回放类视图（2D/3D/事件流/射击/AI）打开时把视窗放到屏幕中间：useReplayAutoCenter。 */
return {
  capabilityOptions: REPLAY_WORKSPACE_CAPABILITY_OPTIONS,
  activeCapability, canUseDemoCapabilities, viewerActive, viewerMode, activeTab,
  viewerMounted, playbackMounted, threeMounted, shotsMounted, eventsMounted, aiMounted,
  playbackLoadError, threeLoadError, shotsLoadError, aiLoadError, eventsLoadError, retryPane,
  currentBattleId, battleOptions, onBattleSelect, targetFile,
  initialLoading, openFailed, workspaceReady, contentVisible, demoEntryVisible,
  sourcePicker, collectionManager, collectionRows, collectionProgress,
  failedReplayCount, acknowledgedResult, partialFailureVisible,
  showBattlePicker, battlePickerTestId, viewFor,
  playbackSeek, playbackSeekRequest, viewerShotFacet, viewerKillFacet,
  viewIn2d, pending3dSeek, onTabSelect, setViewerMode, applyCapabilityFromRoute, onEventSeek, setCapability,
  threeAvailability, aiAvailability,
}
}


/**
 * 切换到回放视窗时**自动垂直居中**（用户 2026-10-31 要求）+ 就绪门（data-pane-ready）。
 * 依赖：activeCapability（当前能力）、initialLoading（首批在途不定位）。
 */
// events 深链的定位目标是**信息流本身**（统一面板里的 ws-events 段，文档承诺的信息流焦点）：
// 事件流先于 2D 就绪时立即定位，不等待 2D 地图；就绪信号沿用 ws-events 子树的 data-pane-ready。
const PANE_TEST_IDS: Partial<Record<ReplayCapability, string>> = { playback: 'ws-playback', '3d': 'ws-3d', events: 'ws-events', shots: 'ws-shots', ai: 'ws-ai' }

export function useReplayAutoCenter({ activeCapability, initialLoading }: { activeCapability: Ref<ReplayCapability>; initialLoading: Ref<boolean> }) {
  // 回放内容容器（视图切换居中与手机横屏沉浸态共用；声明须早于 immediate watcher）
  const workspaceContentEl = ref<HTMLElement | null>(null)
/** 当前能力的视窗容器（懒加载面板挂载前它是空 div，高度为 0）。 */
function activePaneEl(): Element | null {
  const id = PANE_TEST_IDS[activeCapability.value]
  if (!id) return null
  const root = workspaceContentEl.value?.parentElement ?? (typeof document !== 'undefined' ? document : null)
  return root?.querySelector?.(`[data-testid="${id}"]`) ?? null
}

/**
 * 打开 2D/3D 等回放视窗时**自动垂直居中**（用户 2026-10-31 要求：此前视窗偏上，
 * 每次都要手动往下滚一段）。规则：
 * - 视窗比视口矮 → `block: 'center'`（这正是"偏上、要往下滚"的场景）；
 * - 视窗比视口高 → `block: 'start'`（居中的话会裁掉顶部，继续往下滚才是浏览剩余内容的自然动作）。
 * 只在切换视图/首次进入时触发一次（边沿），不监听滚动、不覆盖用户后续滚动位置。
 * 手机横屏沉浸态另有 `scrollIntoView({block:'start'})`（见 wantsImmersive），两者目的不同。
 */
function centerReplayPane(): void {
  const pane = activePaneEl()
  if (!pane || typeof pane.scrollIntoView !== 'function') return
  const rect = pane.getBoundingClientRect()
  const viewportH = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 0
  // 高度不可测量（隐藏 / jsdom 无布局）时按居中处理：scrollIntoView 自身会安全退化为最近可滚位置
  const tallerThanViewport = viewportH > 0 && rect.height > viewportH
  pane.scrollIntoView({ block: tallerThanViewport ? 'start' : 'center' })
}

// 视图切换的正确时序（Codex review P2）：面板是**懒加载 chunk**（`defineLazyModule` 动态
// import），nextTick 等不到 chunk；而且「有高度」也不等于视窗就绪——2D 的标题栏 + LOADING
// 提示、3D 的解析/资产阶段、射击的解析中、AI 的投影构建中都已经有高度。若此时定位会锁在
// 加载提示上，真实视窗出现后不再定位。
// 因此就绪信号是各 pane 自己给出的 **`data-pane-ready`**（内容就绪或终态；加载中不置位），
// 由 ResizeObserver 在布局变化时重新检查；激活令牌在切换/卸载时撤销过期请求，每次进入只定位一次。
// 回放类视图集合（与组件里的能力标签同一口径；data 不触发居中）
const REPLAY_CAPABILITIES = new Set(['playback', '3d', 'events', 'shots', 'ai'])
const PANE_READY_SELECTOR = '[data-pane-ready="true"]'
let centerToken = 0
let centerObserver: ResizeObserver | null = null
let centerMutationObserver: MutationObserver | null = null
function cancelPendingCenter() {
  centerToken += 1
  centerObserver?.disconnect?.()
  centerObserver = null
}
/** 当前 pane 已就绪：真实内容（或终态外壳）已布局 —— 标记在位且有高度。 */
function paneIsReady(pane: Element | null): boolean {
  if (initialLoading.value) return false         // 首批在途：等内容区出现再定位
  if (!pane || !pane.querySelector(PANE_READY_SELECTOR)) return false
  return pane.getBoundingClientRect().height > 0
}
function scheduleCenterWhenLaidOut(): void {
  const token = centerToken
  const tryOnce = () => {
    if (token !== centerToken) return true          // 已切换/离开：撤销
    const pane = activePaneEl()
    if (!paneIsReady(pane)) return false
    centerReplayPane()
    // 成功即收尾：RO / MO 两个监听都撤销，保证每次进入只定位一次
    cancelPendingCenter()
    return true
  }
  if (tryOnce()) return
  const pane = activePaneEl()
  if (!pane || typeof ResizeObserver === 'undefined') return
  centerObserver = new ResizeObserver(() => {
    if (tryOnce()) { centerObserver?.disconnect?.(); centerObserver = null }
  })
  centerObserver.observe(pane)
  // 子元素替换（pane 高度不变、仅内容切换）时 ResizeObserver 不触发：MutationObserver 补一道
  if (typeof MutationObserver !== 'undefined') {
    centerMutationObserver?.disconnect?.()
    centerMutationObserver = new MutationObserver(() => {
      if (tryOnce()) { centerMutationObserver?.disconnect?.(); centerMutationObserver = null }
    })
    centerMutationObserver.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pane-ready'] })
  }
}

watch(activeCapability, (cap) => {
  cancelPendingCenter()
  centerMutationObserver?.disconnect?.()
  centerMutationObserver = null
  if (!REPLAY_CAPABILITIES.has(cap)) return
  nextTick(scheduleCenterWhenLaidOut)
}, { immediate: true })
onBeforeUnmount(() => {
  cancelPendingCenter()
  centerMutationObserver?.disconnect?.()
  centerMutationObserver = null
})

  return { workspaceContentEl }
}


/**
 * 官方示例装载 + Android pending 导入（ACK 语义 owner：本机分析完成才 ACK）。
 * deps.setCapability 来自 useReplayViewerState。
 */
export function useReplayIngest(
  workspace: Workspace,
  { t, confirm, onboarding, setCapability }: {
    t: (key: string) => string
    confirm: ConfirmFn
    onboarding?: OnboardingHooks | null
    setCapability: (capability: string) => Promise<void>
  },
) {
  const replay = workspace.replay
  const { files, loading, resp, updateDemoFile, updateFiles, selectionRevision, analysis, analyze, isDemoSelection } = replay
const demoLoading = ref(false)
const demoError = ref('')
let demoController: AbortController | null = null
let disposed = false

/** Reuse the existing session. A confirmation never authorizes a later changed selection. */
async function loadDemo(signal?: AbortSignal): Promise<void> {
  if (isDemoSelection.value && resp.value && analysis.value.phase === 'ready') {
    await setCapability('data')
    return
  }
  if (demoLoading.value || loading.value) throw new Error('Replay workspace is busy')
  const revision = selectionRevision.value
  const controller = new AbortController()
  demoController = controller
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  demoLoading.value = true
  demoError.value = ''
  try {
    controller.signal.throwIfAborted()
    if (files.value.length && !isDemoSelection.value) {
      const confirmed = await confirm({
        title: t('onboarding.demo_replace_title'), message: t('onboarding.demo_replace_message'),
        confirmLabel: t('onboarding.demo_replace_confirm'), cancelLabel: t('onboarding.demo_replace_cancel'),
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()
      if (!confirmed) throw new DOMException('Official replay replacement declined', REPLACE_DECLINED)
    }
    controller.signal.throwIfAborted()
    if (!isDemoSelection.value) {
      const file = await loadOfficialDemo(controller.signal)
      controller.signal.throwIfAborted()
      if (disposed || selectionRevision.value !== revision) throw new DOMException('Official replay superseded', 'AbortError')
      // The synchronous selection commit must not abort its own completed download.
      demoController = null
      updateDemoFile(file)
    }
    const demoRevision = selectionRevision.value
    await setCapability('data')
    controller.signal.throwIfAborted()
    const result = await analyze()
    controller.signal.throwIfAborted()
    if (disposed || selectionRevision.value !== demoRevision) throw new DOMException('Official replay superseded', 'AbortError')
    if (!result?.completed || !resp.value) throw new Error('Official replay analysis failed')
  } catch (e) {
    const declined = (e as { name?: string } | null)?.name
    if (declined !== 'AbortError' && declined !== REPLACE_DECLINED) demoError.value = t('onboarding.demo_failed')
    throw e
  } finally {
    signal?.removeEventListener('abort', abort)
    if (demoController === controller) demoController = null
    demoLoading.value = false
  }
}

async function onDemoClick(): Promise<void> {
  try {
    await loadDemo()
    onboarding?.sampleOpened?.()
  } catch { /* Visible error above; cancelled replacement keeps the current selection. */ }
}

watch(selectionRevision, () => {
  demoController?.abort()
  demoError.value = ''
}, { flush: 'sync' })

/**
 * Android 外部 replay 完整自动解析契约：
 * pending File 导入 → 替换当前 selection → 本机分析一次 → data tab 展示结果。
 * 仅在 Android external intent 触发（isAndroidApp()）。绝不自动启动 AI Review。
 *
 * 返回值是 Native pending 的 ACK 唯一依据：本机分析完成（无论有没有有效场次）才返回 true——
 * 重新导入同一份不会有不同结果；回放引擎装载失败（可重试）不 ACK，保留 pending。
 */
async function importPendingFile(file: File): Promise<boolean> {
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  const result = await analyze()
  return result?.completed === true
}
  function markDisposed(): void { disposed = true }
  function abortDemo(): void { demoController?.abort() }
  return { demoLoading, demoError, onDemoClick, importPendingFile, loadDemo, markDisposed, abortDemo }
}
