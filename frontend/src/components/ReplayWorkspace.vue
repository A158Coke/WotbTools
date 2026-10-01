<script setup>
import { computed, inject, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, LogIn, Sparkles } from 'lucide-vue-next'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { displayName } from '../utils/helpers.js'
import { useAuth } from '../composables/useAuth.js'
import { useError } from '../composables/useError.js'
import { useReplayWorkspace } from '../composables/useReplayWorkspace.js'
import { useCapabilityReplay } from '../composables/useCapabilityReplay.js'
import { useNativeReplayImport } from '../composables/useNativeReplayImport.js'
import ReplayPage from './ReplayPage.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'
import FileUploader from './FileUploader.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import ReplayTaskCard from './ReplayTaskCard.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayCapabilityTabs from './ReplayCapabilityTabs.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import EmptyState from './EmptyState.vue'
import PageHeader from './PageHeader.vue'
import ReplaySourcePanel from './ReplaySourcePanel.vue'

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / ai / playback（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const { t } = useI18n()
const { authInitState, authenticated, login, loginInFlight, retryAuth, isAdmin } = useAuth()
/** 项目统一错误 UI（AppShell 的 GlobalErrorDialog）——不新造 toast/error system。 */
const { show: showGlobalError } = useError()

/**
 * Workspace 持有唯一一份 replay selection / Processing Job。
 * data / ai / playback 三个能力共享这份状态——选择一次、只建一次 Job。
 * 直接子组件通过显式 props 消费，不再通过 string provide/inject 隐藏依赖。
 */
const workspace = useReplayWorkspace(props.initialCapability || 'data')

const {
  files, loading, error, resp, updateFiles,
  processingJob, processingError, uploadState,
  startProcessingJob, cancelProcessing, dismissProcessingJob,
} = workspace.replay

/**
 * Android 外部 replay 完整自动解析契约：
 * pending File 导入 → 替换当前 selection → 自动创建一次 Processing Job → READY 后 data tab 展示结果。
 * 仅在 Android external intent 触发（isAndroidApp()); 普通 Web/FileUploader 手动选文件不经过此回调，
 * 保持现有手动 UX。绝不自动启动 AI Review。
 *
 * `pending.pendingId` 作为 processing create 的 operationId 传给后端：同一 subject + 同一 operationId
 * 幂等返回同一个 job，覆盖「server 已接受但 Native ACK 前进程被杀 → 冷启动重新导入」的 exactly-once。
 * 返回值是 Native pending 的 ACK 唯一依据：只有 server 已接受该 processing request 才返回 true。
 */
async function importPendingFile(file, pending) {
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  const result = await startProcessingJob({ operationId: pending?.pendingId })
  return result?.accepted === true
}

const { consumePendingWhenReady } = useNativeReplayImport({
  isAuthenticated: () => authenticated.value,
  onPendingFile: importPendingFile,
  onReadError: (reason) => {
    error.value = reason === 'native-client-upgrade-required'
      ? t('workspace.native_client_upgrade_required')
      : t('workspace.native_replay_read_failed')
  },
})

/**
 * 模式：数据 · 2D 回放 · 3D 回放* · 射击分析* · AI 复盘（* 仅管理员）。
 * 3D / 射击目前仍是独立页面（各自读取本地文件），切换时导航过去；嵌入工作台留到 L6。
 */
const NAVIGATION_ONLY_CAPABILITIES = Object.freeze({ '3d': 'agent-replay', shots: 'agent-shots' })
const capabilityOptions = computed(() => [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
  ...(isAdmin.value
    ? [{ key: '3d', labelKey: 'workspace.tab_3d' }, { key: 'shots', labelKey: 'workspace.tab_shots' }]
    : []),
  { key: 'ai', labelKey: 'workspace.tab_ai' },
])

const activeCapability = workspace.activeWorkspaceTab

/** 当前选中单场显示名（header「当前回放：xxx #N」。Blocker #4）。 */
const currentBattleName = computed(() => {
  const f = workspace.currentTargetFile.value
  return f ? displayName(f) : ''
})

/** 模板直接消费的 workspace 权威 ref（顶层绑定，模板自动解包 ref）。 */
const currentBattleId = workspace.currentBattleId
const currentBattleIndex = workspace.currentBattleIndex
const parsedBattles = workspace.parsedBattles
function onBattleSelect(sourceId) {
  workspace.selectBattle(sourceId)
}

/**
 * 有效 battle 选项（selector 只列 parsed battles——failed / duplicate 的 source 不入列；
 * label 由 sourceId 'r<N>' -> files[N] 映射，与 source identity 严格对齐）。
 */
const battleOptions = computed(() => {
  const fileArr = workspace.replay.files.value
  return parsedBattles.value.map(b => {
    const m = /^r(\d+)$/.exec(b?.sourceId || '')
    const f = m ? fileArr[parseInt(m[1], 10)] : null
    return { sourceId: b?.sourceId ?? '', label: f ? displayName(f) : (b?.sourceId || '') }
  })
})

const playbackReplay = useCapabilityReplay(workspace.replay)

watch(
  [
    activeCapability,
    workspace.currentBattleId,
    workspace.currentProcessingJobId,
    workspace.currentTargetFile,
    workspace.replay.selectionRevision,
    workspace.replay.files,
  ],
  () => {
    if (activeCapability.value !== 'playback') return
    const file = workspace.currentTargetFile.value
    if (workspace.replay.files.value.length > 1 && !file) {
      playbackReplay.setLimitError()
      return
    }
    playbackReplay.reconcile({ file, selectionRevision: workspace.replay.selectionRevision.value })
  },
  { immediate: true },
)

const VIEW_BY_CAPABILITY = Object.freeze({ data: 'replay', ai: 'ai-review', playback: 'battle-playback' })

/** capability → 登录后要回到的 view。 */
function viewFor(cap) {
  return VIEW_BY_CAPABILITY[cap] || 'replay'
}

/**
 * 登录门禁：未登录时始终可以发起（或重新发起）login transaction。
 * 去重只发生在 useAuth.login() 内部（同一个进行中的 redirect），
 * 绝不存在「这个组件已尝试过登录 → 后续点击静默 no-op」的 component-lifetime 状态。
 *
 * 失败必须可观测：这里的 catch 只覆盖当前页面生命周期内 login() 的发起/导航
 * Promise rejection，不能严格等价于跳转后的 provider cancellation 或 WebView
 * process death；后两者分别由 auth/init 与 Android pending/auth-return 生命周期负责恢复。
 * 对当前页面能观测到的 immediate failure，现在改为：
 *   - 用户主动发起（点 capability tab / 点登录按钮）失败 → 走统一 GlobalErrorDialog；
 *   - 挂载时的自动登录失败不弹窗（auth gate 本身已是确定的、可重试的可见表面）。
 * 无论哪种情况都只释放 in-flight，不写任何 component-lifetime 状态：
 * 后续点击仍会重新发起登录。
 */
function requestLogin(view, { userInitiated = false } = {}) {
  const target = view || 'replay'
  return Promise.resolve()
    .then(() => login(target))
    .catch(() => {
      // 低敏诊断：只记 view 名，不记 token / redirect URL / replay 内容。
      console.warn(`[workspace-auth] login failed view=${target}`)
      if (userInitiated) showGlobalError(t('workspace.login_failed'))
      return false
    })
}

async function setCapability(key) {
  if (key === activeCapability.value) return
  if (NAVIGATION_ONLY_CAPABILITIES[key]) {
    if (navigate) navigate(NAVIGATION_ONLY_CAPABILITIES[key])
    return
  }
  if (key !== 'ai' && !authenticated.value) {
    requestLogin(viewFor(key), { userInitiated: true })
    return
  }
  workspace.setWorkspaceTab(key)
  if (navigate) navigate(viewFor(key))
}

async function onPreview() {
  await startProcessingJob()
}

function onFileRemoveRequest(f) {
  workspace.replay.askRemoveFile(f)
}

function confirmRemove() {
  workspace.replay.confirmRemove()
}

function clearSelection() {
  updateFiles([])
  playbackReplay.reset()
}

/** 上传条是唯一的清空入口（带确认）；清空时同时复位 2D 回放引用。 */
function onFilesUpdate(next) {
  if (!next.length) clearSelection()
  else updateFiles(next)
}

// 未登录时显示说明卡与登录按钮，不自动跳转登录页（design-language §10 / 审计 PG-03）。

function retryAuthCheck() {
  return retryAuth()
}

/**
 * 只有「auth init 完成 且 authenticated」时才允许消费 Android pending replay；
 * 未登录期间 Native pending 原样保留（跨 auth 保留）。
 */
watch([authInitState, authenticated], ([state, authed]) => {
  if (state !== 'authenticated' || !authed) return
  nextTick(() => consumePendingWhenReady())
}, { immediate: true })

watch(() => props.initialCapability, (val) => {
  if (val) workspace.setWorkspaceTab(val)
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <PageHeader :title="$t('workspace.title')" />
    <ReplayCapabilityTabs :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />

    <EmptyState
      v-if="activeCapability === 'ai'"
      data-testid="ws-ai"
      :icon="Sparkles"
      :title="$t('workspace.ai_title')"
      :description="$t('workspace.ai_description')"
    >
      <AppButton data-testid="ws-ai-go-data" @click="setCapability('data')">{{ $t('workspace.go_data') }}</AppButton>
      <AppButton data-testid="ws-ai-go-playback" @click="setCapability('playback')">{{ $t('workspace.go_playback') }}</AppButton>
    </EmptyState>

    <p
      v-else-if="authInitState === 'idle' || authInitState === 'initializing'"
      class="workspace-status"
      data-testid="ws-auth-loading"
      aria-live="polite"
    >{{ $t('workspace.auth_checking') }}</p>

    <EmptyState
      v-else-if="authInitState === 'failed'"
      data-testid="ws-auth-failed"
      role="alert"
      :icon="CircleAlert"
      :title="$t('workspace.auth_init_failed')"
      :description="$t('workspace.auth_init_failed_hint')"
    >
      <AppButton data-testid="ws-auth-retry" @click="retryAuthCheck">{{ $t('workspace.auth_retry') }}</AppButton>
      <AppButton
        data-testid="ws-login-recovery"
        :disabled="loginInFlight"
        @click="requestLogin(viewFor(activeCapability), { userInitiated: true })"
      >{{ $t('app.login') }}</AppButton>
    </EmptyState>

    <!-- 未登录：说明卡 + 登录；replay 业务动作（上传 / 解析 / capability 面板）一律不可执行 -->
    <EmptyState
      v-else-if="authInitState === 'unauthenticated'"
      data-testid="ws-auth-required"
      :icon="LogIn"
      :title="$t('workspace.auth_required_title')"
      :description="$t('workspace.auth_required_hint')"
    >
      <AppButton
        variant="primary"
        data-testid="ws-login"
        :disabled="loginInFlight"
        @click="requestLogin(viewFor(activeCapability), { userInitiated: true })"
      >{{ $t('app.login') }}</AppButton>
    </EmptyState>

    <template v-else>
      <div class="workspace-source">
        <ReplaySourcePanel
          :files="files"
          :current-battle-index="currentBattleIndex"
          :current-battle-name="currentBattleName"
          :current-battle-id="currentBattleId"
          :battle-options="battleOptions"
          @select-battle="onBattleSelect"
        />

        <FileUploader
          :files="files"
          :loading="loading"
          :confirm-remove="!!resp"
          :compact="!!resp"
          :allow-folder="activeCapability === 'data'"
          @update:files="onFilesUpdate"
          @preview="onPreview"
          @remove-request="onFileRemoveRequest"
        />
        <ReplayProcessingPanel
          v-if="uploadState || processingJob"
          :upload-state="uploadState"
          :job="processingJob"
          :error="processingError"
          @cancel="cancelProcessing"
          @dismiss="dismissProcessingJob"
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
          <BattlePlaybackPanel
            :file="playbackReplay.targetFile.value"
            :processing-job-id="playbackReplay.datasetRef.value?.processingJobId ?? null"
            :source-id="playbackReplay.datasetRef.value?.sourceId ?? null"
            :active="activeCapability === 'playback'"
            :dataset-error="playbackReplay.datasetError.value || ''"
            @dataset-recover="playbackReplay.recover"
          />
        </div>
      </div>

      <ReplayTaskCard v-if="workspace.replay.exportJob.value" :job="workspace.replay.exportJob.value" :error="workspace.replay.exportError.value"
        kind="export" @cancel="workspace.replay.cancelExportJob" @download="workspace.replay.downloadExportResult" @dismiss="workspace.replay.dismissExportJob" />
      <RemoveConfirmModal :pending="workspace.replay.pendingRemove.value" @confirm="confirmRemove" @cancel="workspace.replay.cancelRemove" />
    </template>
  </div>
</template>

<style scoped>
.replay-workspace { padding-right: var(--pd-drawer-offset, 0px); }
.workspace-source { display: grid; gap: var(--space-3); margin-bottom: var(--space-4); }
.workspace-status { margin: 0; padding: var(--space-12) var(--space-4); color: var(--color-text-secondary); font: var(--type-body); text-align: center; }
.capability-pane { margin-top: var(--space-1); }
</style>
