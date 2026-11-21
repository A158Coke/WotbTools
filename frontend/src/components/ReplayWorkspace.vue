<script setup>
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleHelp, Play } from 'lucide-vue-next'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { useForcedLandscape } from '../composables/useForcedLandscape.js'
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
import RotatePrompt from './RotatePrompt.vue'
import { showToast } from '../composables/useToast.js'
import { notify } from '../composables/useNotifications.js'
import ReplayCollectionManager from './ReplayCollectionManager.vue'
import ReplayCapabilityAuthGate from './ReplayCapabilityAuthGate.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import ShowcaseHero from './ShowcaseHero.vue'
import BattlePicker from './BattlePicker.vue'
import { useReplayPaneCentering } from './replay-workspace/useReplayPaneCentering'
import { useWorkspaceDemoLoad } from './replay-workspace/useWorkspaceDemoLoad.js'
import { useWorkspaceShellChrome } from './replay-workspace/useWorkspaceShellChrome.js'
import { capabilityOptions, viewFor } from './replay-workspace/replayWorkspaceMeta.js'
import { useWorkspaceBattlePicker } from './replay-workspace/useWorkspaceBattlePicker'
import { useWorkspaceFileSelection } from './replay-workspace/useWorkspaceFileSelection.js'
import { battlePickerOptions, buildSeriesOverview, replayCollectionRows } from '../utils/replaySeries.js'

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
const eventsModule = defineLazyModule(() => import('./ReplayEventStreamPane.vue'))
const ReplayEventStreamPane = eventsModule.component
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
  files, loading, error, resp, updateFiles, changeFiles, updateDemoFile, isDemoSelection, selectionRevision,
  analysis, analyze, cancelAnalysis,
} = workspace.replay


/**
 * Android 外部 replay 完整自动解析契约：
 * pending File 导入 → 替换当前 selection → 本机分析一次 → data tab 展示结果。
 * 仅在 Android external intent 触发（isAndroidApp()）。绝不自动启动 AI Review。
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
const eventsMounted = useMountedWhenActive(() => canUseDemoCapabilities.value && activeCapability.value === 'events')
const aiMounted = useMountedWhenActive(() =>
  authenticated.value && activeCapability.value === 'ai' && aiAvailability.value.available)


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

const { paneLoadError, playbackLoadError, threeLoadError, shotsLoadError, aiLoadError, eventsLoadError,
  showBattlePicker, battlePickerTestId, playbackSeek, pending3dSeek, viewIn2d, view3dAt } = useWorkspaceBattlePicker({
  activeCapability, battleOptions, canUseDemoCapabilities, threeAvailability, aiAvailability,
  playbackModule, threeModule, shotsModule, aiModule, eventsModule,
  targetFile, setCapability,
})
/**
 * 工作台四态由 session 派生，不另存状态：
 * Empty（没有文件）/ Loading（首批加载中）/ Ready（有结果）/ Failure（没有可提交的批次结果）。
 * Loading 与 Failure 时隐藏内容区但不卸载面板；批次里部分失败仍是 Ready。
 */
const initialLoading = computed(() => analysis.value.phase === 'parsing' && !resp.value)
const openFailed = computed(() => analysis.value.phase === 'failed' && !resp.value)
const workspaceReady = computed(() => !!resp.value && files.value.length > 0)

const { demoLoading, demoError, loadDemo, onDemoClick, dispose: disposeDemoLoad } = useWorkspaceDemoLoad({
  workspace, setCapability, analyze, confirm, t, sampleOpened: () => onboarding?.sampleOpened(),
})
const { workspaceContentEl } = useReplayPaneCentering({ activeCapability, initialLoading })
const { pageActive, forcedLandscape, autoFullscreenToken } = useWorkspaceShellChrome({
  activeCapability, playbackMounted, threeMounted, workspaceReady, workspaceContentEl,
})
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

const sourcePicker = ref(null)
const collectionManager = ref(null)
/** 回放列表标「当前」：只在有当前场次语境时。赛后数据汇总看的是整批，没有当前场次。 */
const collectionRows = computed(() => replayCollectionRows(files.value, battleOptions.value, resp.value, {
  currentSourceId: activeCapability.value === 'data' && workspace.dataViewMode.value !== 'SINGLE' ? null : currentBattleId.value,
  parsing: analysis.value.phase === 'parsing',
}))
const collectionProgress = computed(() => (analysis.value.phase === 'parsing' && resp.value
  ? { done: analysis.value.done, total: analysis.value.total } : null))

/** 批次部分失败：其余回放照常可用，提醒在每个能力都可见。确认只对当前这份结果有效。 */
const failedReplayCount = computed(() => resp.value?.failures?.length || 0)
const acknowledgedResult = shallowRef(null)
const partialFailureVisible = computed(() => failedReplayCount.value > 0 && acknowledgedResult.value !== resp.value)


async function setCapability(key) {
  if (key === activeCapability.value) return
  workspace.setWorkspaceTab(key)
  if (onlineFeatures[key]) requireFeature(onlineFeatures[key])
  if (navigate) navigate(viewFor(key))
}



function confirmRemove() {
  workspace.replay.confirmRemove()
}
const { clearSelection, onFilesUpdate, onCancelLoading, onRemoveFile, openOtherReplay, onWorkspaceDrop } = useWorkspaceFileSelection({
  workspace, analyze, cancelAnalysis, sourcePicker,
})

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


function registerOnboarding() { onboarding?.registerWorkspace(onboardingWorkspace) }
onMounted(registerOnboarding)
onActivated(registerOnboarding)
onDeactivated(() => {
  // 确认框 portal 到 body，KeepAlive 停用不会带走它。
  workspace.replay.cancelRemove()
})
onUnmounted(() => {
  disposeDemoLoad()
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
  <div class="layout-data-workspace replay-workspace" @dragover.prevent @drop.prevent="onWorkspaceDrop">
    <div class="workspace-head">
      <ShowcaseHero v-if="!wantsImmersive && !forcedLandscape.blocked.value" compact section="replay" :kicker="$t('nav.replay')" :title="$t('workspace.title')" />
      <div class="workspace-toolbar">
        <ReplayCapabilityTabs class="workspace-capabilities" data-tour="workspace-capabilities" :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />
        <AppButton v-if="onboarding" variant="ghost" size="sm" data-tour="workspace-help" @click="onboarding.openDirectory()">
          <CircleHelp :size="16" aria-hidden="true" />{{ $t('onboarding.help') }}
        </AppButton>
        <ReplayCollectionManager
          v-if="files.length"
          ref="collectionManager"
          data-tour="workspace-file-controls"
          :rows="collectionRows"
          :progress="collectionProgress"
          :disabled="initialLoading"
          :folder-available="sourcePicker?.folderAvailable ?? false"
          :demo-disabled="demoLoading || loading"
          @add-files="sourcePicker?.chooseFiles()"
          @add-folder="sourcePicker?.chooseFolder()"
          @open-demo="onDemoClick"
          @remove="onRemoveFile"
          @clear="clearSelection"
        />
      </div>
    </div>

    <div v-if="demoEntryVisible || demoError" class="workspace-source">
      <div v-if="demoEntryVisible" class="workspace-demo-actions">
        <AppButton size="sm" data-tour="workspace-demo" data-testid="workspace-demo" :disabled="demoLoading || loading" @click="onDemoClick">
          <Play :size="16" aria-hidden="true" />{{ $t(demoLoading ? 'onboarding.demo_loading' : 'onboarding.demo_action') }}
        </AppButton>
      </div>
      <Banner v-if="demoError" tone="danger" data-testid="workspace-demo-error"><p>{{ demoError }}</p></Banner>
    </div>

    <div class="workspace-file-controls" :data-tour="files.length ? undefined : 'workspace-file-controls'" data-testid="workspace-file-controls">
      <FileDrop ref="sourcePicker" :files="files" :loading="loading" @update:files="onFilesUpdate" />
    </div>

    <div v-if="initialLoading || openFailed || partialFailureVisible || error" class="workspace-source">
      <ReplayProcessingPanel
        v-if="initialLoading || openFailed"
        :analysis="analysis"
        :file-count="files.length"
        @cancel="onCancelLoading"
        @retry="analyze"
        @open-other="openOtherReplay"
        @clear="clearSelection"
      />
      <Banner v-if="partialFailureVisible" tone="warning" data-testid="workspace-partial-failure">
        <p>{{ $t('workspace.partial_failure', { count: failedReplayCount }) }}</p>
        <template #actions>
          <AppButton size="sm" data-testid="partial-failure-view" @click="collectionManager?.open()">{{ $t('workspace.partial_failure_view') }}</AppButton>
          <AppButton variant="ghost" size="sm" data-testid="partial-failure-ack" @click="acknowledgedResult = resp">{{ $t('workspace.partial_failure_ack') }}</AppButton>
        </template>
      </Banner>
      <Banner v-if="error" tone="danger" data-testid="ws-error">
        <p>{{ error }}</p>
        <template v-if="error === t('workspace.native_replay_read_failed')" #actions>
          <AppButton size="sm" data-testid="ws-native-retry" @click="consumePendingWhenReady">{{ $t('workspace.native_replay_retry') }}</AppButton>
        </template>
      </Banner>
    </div>

    <RotatePrompt
      v-if="forcedLandscape.blocked.value"
      class="workspace-rotate-prompt"
      :device="forcedLandscape.device.value"
      :action-label="$t('workspace.rotate_view_data')"
      @action="setCapability('data')"
    />

    <div v-if="showBattlePicker || isDemoSelection" class="workspace-sessionbar">
      <BattlePicker
        v-if="showBattlePicker"
        class="single-battle-picker"
        :options="battleOptions"
        :model-value="currentBattleId"
        :aria-label="$t('workspace.battle_picker')"
        :data-testid="battlePickerTestId"
        @update:model-value="onBattleSelect"
      />
      <span v-if="isDemoSelection" class="workspace-demo-label" data-testid="workspace-demo-label">{{ $t('onboarding.demo_label') }}</span>
    </div>

    <div v-show="contentVisible" ref="workspaceContentEl" class="workspace-content">
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
          :seek-to="playbackSeek"
          :auto-fullscreen-token="autoFullscreenToken"
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
          :active="pageActive && activeCapability === '3d' && threeAvailability.available"
          :blocked-reason="threeBlocked"
          :auto-fullscreen-token="autoFullscreenToken"
          :pending-seek="pending3dSeek"
        />
      </div>
      <div v-show="activeCapability === 'events'" class="capability-pane" data-testid="ws-events">
        <ReplayCapabilityAuthGate
          v-if="!canUseDemoCapabilities && activeCapability === 'events'"
          :title="$t('workspace.tab_events')"
          :description="$t('workspace.login_required_events')"
          login-destination="agent-events"
        />
        <Banner v-else-if="eventsLoadError" tone="danger" data-testid="ws-events-load-error">
          <p>{{ $t(eventsLoadError) }}</p>
          <template #actions>
            <AppButton size="sm" data-testid="ws-events-load-reload" @click="reloadForFreshBundle">{{ $t('workspace.pane_reload') }}</AppButton>
            <AppButton size="sm" variant="ghost" data-testid="ws-events-load-retry" @click="retryPane(eventsModule)">{{ $t('workspace.pane_retry') }}</AppButton>
          </template>
        </Banner>
        <ReplayEventStreamPane
          v-if="canUseDemoCapabilities && eventsMounted && !eventsLoadError"
          :file="targetFile"
          :active="activeCapability === 'events'"
          :page-active="pageActive"
          :playback-session="workspace.playbackSession"
          :navigate="navigate"
          @view-3d="view3dAt"
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
          :auto-fullscreen-token="autoFullscreenToken"
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
          @view-2d="viewIn2d"
        />
      </div>
    </div>

    <RemoveConfirmModal :pending="workspace.replay.pendingRemove.value" @confirm="confirmRemove" @cancel="workspace.replay.cancelRemove" />
  </div>
</template>

<style scoped src="./replay-workspace.css"></style>
