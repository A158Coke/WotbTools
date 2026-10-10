<script setup>
import { computed, inject, nextTick, onActivated, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, CircleHelp, Files, Play } from 'lucide-vue-next'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
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
const threeBlocked = computed(() => !threeAvailability.value.available ? t(threeAvailability.value.messageKey) : blockedReason.value)
const aiBlocked = computed(() => !aiAvailability.value.available ? t(aiAvailability.value.messageKey) : blockedReason.value)

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

/** 单场能力的目标文件：单文件直接用；多文件须先选场次（本机解析单场） */
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
const blockedReason = computed(() =>
  files.value.length > 1 && !targetFile.value ? t('workspace.single_replay_required') : '')

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
  await analyze()
}

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
function registerOnboarding() { onboarding?.registerWorkspace(onboardingWorkspace) }
onMounted(registerOnboarding)
onActivated(registerOnboarding)
onUnmounted(() => {
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

    <div class="workspace-content">
      <ReplayPage
        v-show="activeCapability === 'data'"
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
          :blocked-reason="blockedReason"
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
          :blocked-reason="blockedReason"
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
