<script setup>
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, CircleHelp, Files, Play } from 'lucide-vue-next'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { mapLabel } from '../utils/helpers.js'
import { defineLazyModule, reloadForFreshBundle } from '../utils/lazyModule.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useAuth } from '../composables/useAuth.js'
import { useConfirm } from '../composables/useConfirm.js'
import { useReplayWorkspace } from '../composables/useReplayWorkspace.js'
import { useNativeReplayImport } from '../composables/useNativeReplayImport.js'
import { useMountedWhenActive } from '../composables/useMountedWhenActive.js'
import { usePointer } from '../composables/useBreakpoint.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import ReplayPage from './ReplayPage.vue'
import FileDrop from './FileDrop.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayCapabilityTabs from './ReplayCapabilityTabs.vue'
import ReplayCapabilityAuthGate from './ReplayCapabilityAuthGate.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import PageHeader from './PageHeader.vue'
import BattlePicker from './BattlePicker.vue'
import { battlePickerOptions, buildSeriesOverview } from '../utils/replaySeries.js'

/**
 * 审计 PF-02：能力面板的代码块都不进主包（2D 回放带约 2.5MB 地图语义数据；3D 带 Three.js；
 * 射击带装甲与弹表；AI 带 SSE 与投影）。
 *
 * 懒加载边界：部署换掉 chunk 文件名后，旧页面进入能力时必然 404——必须变成可恢复的失败态，
 * 不能让 Vue 渲染中断（那会把整个工作台打成空壳，见 utils/lazyModule.ts 的说明）。
 * generation 与 recovery 由该边界自己拥有，工作台不重复管理。
 */
const playbackModule = defineLazyModule(() => import('./BattlePlaybackPanel.vue'))
const threeModule = defineLazyModule(() => import('./Replay3DPane.vue'))
const shotsModule = defineLazyModule(() => import('./ReplayShotsPane.vue'))
const aiModule = defineLazyModule(() => import('./AiReviewWorkspacePane.vue'))
const BattlePlaybackPanel = playbackModule.component
const Replay3DPane = threeModule.component
const ReplayShotsPane = shotsModule.component
const AiReviewWorkspacePane = aiModule.component

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / playback / 3d / shots / ai（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const onboarding = inject(ONBOARDING_KEY, null)
const { confirm } = useConfirm()
const { t, locale } = useI18n()
const { authenticated } = useAuth()
const { availability, requireFeature } = useFeatureGate()
const onlineFeatures = { '3d': Feature.PLAYBACK_3D, ai: Feature.AI_REVIEW }
const threeAvailability = computed(() => availability(Feature.PLAYBACK_3D))
const aiAvailability = computed(() => availability(Feature.AI_REVIEW))
const threeBlocked = computed(() => !threeAvailability.value.available ? t(threeAvailability.value.messageKey) : '')
const aiBlocked = computed(() => !aiAvailability.value.available ? t(aiAvailability.value.messageKey) : '')

/**
 * Workspace 持有唯一一份 replay selection 与本地分析结果（服务器没有 parser：文件不出本机，
 * 匿名即可用，不等登录）。五个能力共享这份状态——选择一次、只分析一次、不重新选文件。
 * 直接子组件通过显式 props 消费，不再通过 string provide/inject 隐藏依赖。
 */
const workspace = useReplayWorkspace(props.initialCapability || 'data')

const {
  files, loading, error, resp, updateFiles, updateDemoFile, isDemoSelection, selectionRevision,
  analysis, analyze, cancelAnalysis, dismissAnalysis,
} = workspace.replay

const demoLoading = ref(false)
const demoError = ref('')
let demoController = null
let disposed = false

/** Reuse the existing session. A confirmation never authorizes a later changed selection. */
async function loadDemo(signal) {
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
    if (files.value.length && !isDemoSelection.value && !(await confirm({
      title: t('onboarding.demo_replace_title'), message: t('onboarding.demo_replace_message'),
      confirmLabel: t('onboarding.demo_replace_confirm'), cancelLabel: t('onboarding.demo_replace_cancel'),
    }))) throw new DOMException('Official replay cancelled', 'AbortError')
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
    if (e?.name !== 'AbortError') demoError.value = t('onboarding.demo_failed')
    throw e
  } finally {
    signal?.removeEventListener('abort', abort)
    if (demoController === controller) demoController = null
    demoLoading.value = false
  }
}

async function onDemoClick() {
  try {
    await loadDemo()
    onboarding?.sampleOpened()
  } catch { /* Visible error above; cancelled replacement keeps the current selection. */ }
}

watch(selectionRevision, () => {
  demoController?.abort()
  demoError.value = ''
}, { flush: 'sync' })

/**
 * Android 外部 replay 完整自动解析契约：
 * pending File 导入 → 替换当前 selection → 本机分析一次 → data tab 展示结果。
 * 仅在 Android external intent 触发（isAndroidApp()); 普通 Web/FileDrop 手动选文件不经过此回调，
 * 保持现有手动 UX。绝不自动启动 AI Review。
 *
 * 返回值是 Native pending 的 ACK 唯一依据：本机分析完成（无论有没有有效场次）才返回 true——
 * 重新导入同一份不会有不同结果；回放引擎装载失败（可重试）不 ACK，保留 pending。
 */
async function importPendingFile(file) {
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  const result = await analyze()
  return result?.completed === true
}

const { consumePendingWhenReady, importing: nativeImporting } = useNativeReplayImport({
  isReady: () => true,
  onPendingFile: importPendingFile,
  onReadError: (reason) => {
    error.value = reason === 'native-client-upgrade-required'
      ? t('workspace.native_client_upgrade_required')
      : t('workspace.native_replay_read_failed')
  },
})

/**
 * 五个能力始终公开显示。数据 / 2D 匿名可用；官方示例额外开放 3D / 射击，AI 仍要求登录，
 * 管理员角色不改变工作台能力。登录门禁位于实际解析与场景挂载之前。
 */
const capabilityOptions = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
  { key: '3d', labelKey: 'workspace.tab_3d' },
  { key: 'shots', labelKey: 'workspace.tab_shots' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
]

/**
 * 能力面板首次进入时才挂载（代码块按需加载、不进主包），之后切走只隐藏：
 * 停渲染但不销毁会话——切回不重新要求文件、不重新解析、保留 timeline / 相机。
 * 失去登录且没有可信示例时卸载受保护面板，selection / 数据结果继续保留。
 */
const activeCapability = workspace.activeWorkspaceTab
const canUseDemoCapabilities = computed(() => authenticated.value || isDemoSelection.value)
const playbackMounted = useMountedWhenActive(() => activeCapability.value === 'playback')
// 3D / 射击的登录或可信示例资格与连通性独立；示例不能绕过 ONLINE_REQUIRED 门禁。
const threeMounted = useMountedWhenActive(() =>
  canUseDemoCapabilities.value && activeCapability.value === '3d' && threeAvailability.value.available)
const shotsMounted = useMountedWhenActive(() => canUseDemoCapabilities.value && activeCapability.value === 'shots')
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
function paneLoadError(module) {
  return module.error.value ? 'workspace.pane_load_failed' : ''
}
const playbackLoadError = computed(() => paneLoadError(playbackModule))
const threeLoadError = computed(() => paneLoadError(threeModule))
const shotsLoadError = computed(() => paneLoadError(shotsModule))
const aiLoadError = computed(() => paneLoadError(aiModule))

/** 重试：由 lazyModule 创建新一代 async wrapper（不是重复跑一次 import）。 */
async function retryPane(module) {
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
function onBattleSelect(sourceId) {
  workspace.selectBattle(sourceId)
}

/** 单场能力的目标文件：单文件直接用；多文件先批次分析，再选有效场次对应的原始 File */
const targetFile = computed(() => workspace.currentTargetFile.value)

// Only presentation is collapsible; the uploader and selection keep their existing owner.
const fileControlsOpen = ref(false)
const sourcePicker = ref(null)
const sourceId = useId()
const canCollapseSource = computed(() => !!resp.value && files.value.length > 0 && activeCapability.value !== 'data')
const sourceCollapsed = computed(() => canCollapseSource.value && !fileControlsOpen.value && !loading.value && !error.value)
const showBattlePicker = computed(() => {
  const cap = activeCapability.value
  if (cap === 'data' || battleOptions.value.length < 2) return false
  if (cap === 'playback') return !playbackLoadError.value
  if (cap === '3d') return canUseDemoCapabilities.value && threeAvailability.value.available && !threeLoadError.value
  if (cap === 'shots') return canUseDemoCapabilities.value && !shotsLoadError.value
  return aiAvailability.value.available && !aiLoadError.value
})
const battlePickerTestId = computed(() => ({ playback: 'playback', '3d': 'replay3d', shots: 'shots', ai: 'ai' })[activeCapability.value] + '-battle-picker')

const VIEW_BY_CAPABILITY = Object.freeze({
  data: 'replay',
  playback: 'battle-playback',
  '3d': 'agent-replay',
  shots: 'agent-shots',
  ai: 'ai-review',
})

/** capability → 路由 view（Back / Forward 与深链仍由 Vue Router 唯一持有）。 */
function viewFor(cap) {
  return VIEW_BY_CAPABILITY[cap] || 'replay'
}

async function setCapability(key) {
  if (key === activeCapability.value) return
  workspace.setWorkspaceTab(key)
  if (onlineFeatures[key]) requireFeature(onlineFeatures[key])
  if (navigate) navigate(viewFor(key))
}

async function onPreview() {
  if (activeCapability.value === 'data' || files.value.length === 1) await analyze()
  else await ensureTargetBattle({ allowRetry: true })
}

/** Prepare a single-battle capability using finalized, original source identities. */
async function ensureTargetBattle({ allowRetry = false } = {}) {
  if (!files.value.length || targetFile.value) return
  const revision = selectionRevision.value
  if (!resp.value) {
    // Capability navigation must preserve cancellation/failure; only Preview authorizes retry.
    if (analysis.value.phase === 'parsing' || (!allowRetry && analysis.value.phase !== 'idle')) return
    const result = await analyze()
    if (!result?.completed) return
  }
  if (disposed || selectionRevision.value !== revision) return
  const firstBattle = resp.value?.battles?.[0]
  if (!targetFile.value && firstBattle) workspace.selectBattle(firstBattle.sourceId)
}

// FileDrop keeps manual preview; entering another capability reuses/prepares the selection.
watch(activeCapability, (cap) => {
  if (cap !== 'data') void ensureTargetBattle()
}, { immediate: true })

/** 回放类视图（2D/3D/射击/AI）：打开时把视窗放到屏幕中间。 */
const REPLAY_CAPABILITIES = new Set(['playback', '3d', 'shots', 'ai'])
/** 能力 → 视窗容器（`.capability-pane` 的稳定 testid；测量目标是 pane 本身，不含工具栏）。 */
const PANE_TEST_IDS = { playback: 'ws-playback', '3d': 'ws-3d', shots: 'ws-shots', ai: 'ws-ai' }
// 回放内容容器（视图切换居中与手机横屏沉浸态共用；声明须早于下方 immediate watcher）
const workspaceContentEl = ref(null)

/** 当前能力的视窗容器（懒加载面板挂载前它是空 div，高度为 0）。 */
function activePaneEl() {
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
function centerReplayPane() {
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
const PANE_READY_SELECTOR = '[data-pane-ready="true"]'
let centerToken = 0
let centerObserver = null
let centerMutationObserver = null
function cancelPendingCenter() {
  centerToken += 1
  centerObserver?.disconnect?.()
  centerObserver = null
}
/** 当前 pane 已就绪：真实内容（或终态外壳）已布局 —— 标记在位且有高度。 */
function paneIsReady(pane) {
  if (!pane || !pane.querySelector(PANE_READY_SELECTOR)) return false
  return pane.getBoundingClientRect().height > 0
}
function scheduleCenterWhenLaidOut() {
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

function onFileRemoveRequest(f) {
  workspace.replay.askRemoveFile(f)
}

function confirmRemove() {
  workspace.replay.confirmRemove()
}

function clearSelection() {
  updateFiles([])
}

/** 上传条是唯一的清空入口（带确认）；清空时同时复位所有单场能力的引用。 */
function onFilesUpdate(next) {
  if (!next.length) clearSelection()
  else updateFiles(next)
}

/** 挂载后消费 Android pending replay（本机分析，不依赖登录状态）。 */
onMounted(() => nextTick(() => consumePendingWhenReady()))

const onboardingWorkspace = {
  hasFiles: () => files.value.length > 0,
  busy: () => loading.value || demoLoading.value || nativeImporting?.value === true,
  selectionIdentity: () => selectionRevision.value,
  loadDemo,
  setCapability,
  chooseOwnReplay: async () => {
    if (isDemoSelection.value) clearSelection()
    fileControlsOpen.value = true
    await setCapability('data')
    await nextTick()
    sourcePicker.value?.chooseFiles()
  },
}

/**
 * 手机横屏回放沉浸态：正方形地图只受纵向预算约束，顶栏 + Tab 栏（104px）是最大的单项消耗。
 * 2D / 3D 回放已就绪且设备是触屏手机横屏时向外壳申请沉浸；任何条件失效、离开页面或被 KeepAlive
 * 停用都立即释放。外壳本身（显隐与 token 归零）由 AppShell 独占。
 */
const shellChrome = inject(SHELL_CHROME_KEY, null)
const shellOwner = Symbol('replay-workspace')
const { isPhone } = usePlaybackPhoneForm()
const { isPortrait } = usePlaybackPortraitViewport()
const { coarse } = usePointer()
const pageActive = ref(true)
const replayPaneShown = computed(() =>
  (activeCapability.value === 'playback' && playbackMounted.value) || (activeCapability.value === '3d' && threeMounted.value))
const wantsImmersive = computed(() =>
  pageActive.value && isPhone.value && !isPortrait.value && coarse.value && canCollapseSource.value && replayPaneShown.value)
watch(wantsImmersive, (on) => {
  shellChrome?.request(shellOwner, on)
  // 进入沉浸态时把回放区对齐到视口顶端（仅边沿触发一次，不监听滚动）
  if (on) nextTick(() => workspaceContentEl.value?.scrollIntoView?.({ block: 'start' }))
}, { immediate: true })
onActivated(() => { pageActive.value = true })
onDeactivated(() => { pageActive.value = false })

function registerOnboarding() { onboarding?.registerWorkspace(onboardingWorkspace) }
onMounted(registerOnboarding)
onActivated(registerOnboarding)
onUnmounted(() => {
  shellChrome?.request(shellOwner, false)
  disposed = true
  demoController?.abort()
  onboarding?.registerWorkspace(null)
})

watch(() => props.initialCapability, (val) => {
  if (val) {
    workspace.setWorkspaceTab(val)
    if (onlineFeatures[val]) requireFeature(onlineFeatures[val])
  }
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <PageHeader :title="$t('workspace.title')">
      <template #actions>
        <ReplayCapabilityTabs data-tour="workspace-capabilities" :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />
        <AppButton v-if="onboarding" variant="ghost" size="sm" data-tour="workspace-help" @click="onboarding.openDirectory()">
          <CircleHelp :size="16" aria-hidden="true" />{{ $t('onboarding.help') }}
        </AppButton>
      </template>
    </PageHeader>

    <div v-if="canCollapseSource || showBattlePicker" class="workspace-sessionbar">
      <BattlePicker
        v-if="showBattlePicker"
        class="single-battle-picker"
        :options="battleOptions"
        :model-value="currentBattleId"
        :aria-label="$t('workspace.battle_picker')"
        :data-testid="battlePickerTestId"
        @update:model-value="onBattleSelect"
      />
      <span v-else-if="targetFile" class="workspace-current-file" :title="targetFile.name">{{ targetFile.name }}</span>
      <AppButton
        v-if="canCollapseSource"
        variant="ghost" size="sm" class="workspace-files-toggle"
        data-testid="workspace-files-toggle"
        :aria-expanded="!sourceCollapsed" :aria-controls="sourceId" :disabled="loading || !!error"
        @click="fileControlsOpen = sourceCollapsed"
      >
        <Files :size="16" aria-hidden="true" />
        {{ sourceCollapsed ? $t('upload.view_list', { count: files.length }) : $t('upload.hide_list') }}
        <component :is="sourceCollapsed ? ChevronDown : ChevronUp" :size="16" aria-hidden="true" />
      </AppButton>
    </div>

    <div class="workspace-source">
      <div class="workspace-demo-actions">
        <AppButton size="sm" data-tour="workspace-demo" data-testid="workspace-demo" :disabled="demoLoading || loading" @click="onDemoClick">
          <Play :size="16" aria-hidden="true" />{{ $t(demoLoading ? 'onboarding.demo_loading' : 'onboarding.demo_action') }}
        </AppButton>
        <span v-if="isDemoSelection" class="workspace-demo-label" data-testid="workspace-demo-label">{{ $t('onboarding.demo_label') }}</span>
      </div>
      <Banner v-if="demoError" tone="danger" data-testid="workspace-demo-error"><p>{{ demoError }}</p></Banner>
      <div v-show="!sourceCollapsed" :id="sourceId" data-tour="workspace-file-controls" data-testid="workspace-file-controls">
        <FileDrop
          ref="sourcePicker"
          :files="files"
          :loading="loading"
          :confirm-remove="!!resp"
          :compact="!!resp"
          :allow-folder="['data', 'playback', '3d'].includes(activeCapability)"
          @update:files="onFilesUpdate"
          @preview="onPreview"
          @remove-request="onFileRemoveRequest"
        />
      </div>
      <ReplayProcessingPanel
        :analysis="analysis"
        :result="resp"
        @cancel="cancelAnalysis"
        @dismiss="dismissAnalysis"
      />
      <Banner v-if="error" tone="danger" data-testid="ws-error">
        <p>{{ error }}</p>
        <template v-if="error === t('workspace.native_replay_read_failed')" #actions>
          <AppButton size="sm" data-testid="ws-native-retry" @click="consumePendingWhenReady">{{ $t('workspace.native_replay_retry') }}</AppButton>
        </template>
      </Banner>
    </div>

    <div ref="workspaceContentEl" class="workspace-content">
      <ReplayPage
        v-show="activeCapability === 'data'"
        :active="activeCapability === 'data'"
        data-testid="ws-data"
        :embedded="true"
        :replay-context="workspace.replay"
        :workspace-context="workspace"
      />
      <div v-show="activeCapability === 'playback'" class="capability-pane" data-testid="ws-playback">
        <Banner v-if="playbackLoadError" tone="danger" data-testid="ws-playback-load-error">
          <p>{{ $t(playbackLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-playback-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-playback-load-retry" @click="retryPane(playbackModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <BattlePlaybackPanel
          v-if="playbackMounted && !playbackLoadError"
          :playback-session="workspace.playbackSession"
          :file="targetFile"
          :active="activeCapability === 'playback'"
        />
      </div>
      <div v-show="activeCapability === '3d'" class="capability-pane" data-testid="ws-3d">
        <!-- 顺序即优先级：连通性（capability SSOT）→ 登录门禁 → 加载错误 → 面板。
             非-online 时既不给登录入口、也不挂载 3D（远端资源所需的连接不存在）。
             首次检测未完成（pending）时保持中性空白：不下连通性结论，也不落到登录门禁。 -->
        <template v-if="!threeAvailability.available">
          <Banner v-if="!threeAvailability.pending" tone="info" data-testid="ws-3d-connectivity">
            <p>{{ $t(threeAvailability.messageKey) }}</p>
          </Banner>
        </template>
        <ReplayCapabilityAuthGate
          v-else-if="!canUseDemoCapabilities && activeCapability === '3d'"
          :title="$t('workspace.tab_3d')"
          :description="$t('workspace.login_required_3d')"
          login-destination="agent-replay"
        />
        <Banner v-else-if="canUseDemoCapabilities && threeLoadError" tone="danger" data-testid="ws-3d-load-error">
          <p>{{ $t(threeLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-3d-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-3d-load-retry" @click="retryPane(threeModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <Replay3DPane
          v-if="canUseDemoCapabilities && threeMounted && !threeLoadError"
          :playback-session="workspace.playbackSession"
          :file="targetFile"
          :active="activeCapability === '3d' && threeAvailability.available"
          :blocked-reason="threeBlocked"
        />
      </div>
      <div v-show="activeCapability === 'shots'" class="capability-pane" data-testid="ws-shots">
        <ReplayCapabilityAuthGate
          v-if="!canUseDemoCapabilities && activeCapability === 'shots'"
          :title="$t('workspace.tab_shots')"
          :description="$t('workspace.login_required_shots')"
          login-destination="agent-shots"
        />
        <Banner v-else-if="canUseDemoCapabilities && shotsLoadError" tone="danger" data-testid="ws-shots-load-error">
          <p>{{ $t(shotsLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-shots-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-shots-load-retry" @click="retryPane(shotsModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <ReplayShotsPane
          v-if="canUseDemoCapabilities && shotsMounted && !shotsLoadError"
          :file="targetFile"
          :active="activeCapability === 'shots'"
          :navigate="navigate"
        />
      </div>
      <div v-show="activeCapability === 'ai'" class="capability-pane" data-testid="ws-ai">
        <template v-if="!aiAvailability.available">
          <Banner v-if="!aiAvailability.pending" tone="info" data-testid="ws-ai-connectivity">
            <p>{{ $t(aiAvailability.messageKey) }}</p>
          </Banner>
        </template>
        <Banner v-else-if="aiLoadError" tone="danger" data-testid="ws-ai-load-error">
          <p>{{ $t(aiLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-ai-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-ai-load-retry" @click="retryPane(aiModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <AiReviewWorkspacePane
          v-if="aiMounted && !aiLoadError"
          :file="targetFile"
          :active="activeCapability === 'ai' && aiAvailability.available"
          :blocked-reason="aiBlocked"
        />
      </div>
    </div>

    <RemoveConfirmModal :pending="workspace.replay.pendingRemove.value" @confirm="confirmRemove" @cancel="workspace.replay.cancelRemove" />
  </div>
</template>

<style scoped>
.replay-workspace { padding-right: var(--pd-drawer-offset, 0px); }
.workspace-source { display: grid; gap: var(--space-3); margin-bottom: var(--space-4); }
.workspace-demo-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.workspace-demo-label { color: var(--color-text-secondary); font: var(--type-caption); }
.capability-pane { margin-top: var(--space-1); }
/* A single compact session row serves every single-battle capability. */
.workspace-sessionbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-3); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); }
.single-battle-picker { flex: 1; min-width: 0; }
.workspace-files-toggle { margin-inline-start: auto; }
.workspace-current-file { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); font: var(--type-caption); }
@media (width < 768px) {
  .single-battle-picker { flex-basis: 100%; }
}
</style>
