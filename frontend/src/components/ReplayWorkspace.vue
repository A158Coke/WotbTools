<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { displayName } from '../utils/helpers.js'
import { useAuth } from '../composables/useAuth.js'
import { useReplayWorkspace } from '../composables/useReplayWorkspace.js'
import { useCapabilityReplay } from '../composables/useCapabilityReplay.js'
import { useNativeReplayImport } from '../composables/useNativeReplayImport.js'
import ReplayPage from './ReplayPage.vue'
import AiReviewPanel from './AiReviewPanel.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'
import FileUploader from './FileUploader.vue'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'
import ReplayTaskCard from './ReplayTaskCard.vue'
import RemoveConfirmModal from './RemoveConfirmModal.vue'
import ReplayWorkspaceHeader from './ReplayWorkspaceHeader.vue'
import ReplayCapabilityTabs from './ReplayCapabilityTabs.vue'
import ReplaySourcePanel from './ReplaySourcePanel.vue'

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / ai / playback（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const { initPromise: authInit, authenticated, login, loginInFlight } = useAuth()

/** auth init 是否已结束（结束前不得渲染/执行任何 replay 业务动作）。 */
const authReady = ref(false)

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
})

const capabilityOptions = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
]

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

const aiReplay = useCapabilityReplay(workspace.replay)
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
    const cap = activeCapability.value
    if (cap !== 'ai' && cap !== 'playback') return
    const helper = cap === 'ai' ? aiReplay : playbackReplay
    const file = workspace.currentTargetFile.value
    if (workspace.replay.files.value.length > 1 && !file) {
      helper.setLimitError()
      return
    }
    helper.reconcile({ file, selectionRevision: workspace.replay.selectionRevision.value })
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
 */
function requestLogin(view) {
  // 登录失败（provider 取消 / 导航失败 / WebView 中断）不得阻塞 UI：必须能再次点击重试。
  Promise.resolve().then(() => login(view || 'replay')).catch(() => {})
}

async function setCapability(key) {
  if (key === activeCapability.value) return
  if (!authenticated.value) {
    requestLogin(viewFor(key))
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
  aiReplay.reset()
  playbackReplay.reset()
}

onMounted(() => {
  // auth init 失败视作未登录：仍要退出 loading，让用户看到可重试的登录入口。
  authInit.catch(() => {}).finally(() => {
    authReady.value = true
    // 诊断（低敏）：排查「外部 replay 打开后没有停在登录流程」一类生产反馈。
    console.debug(`[auth] replay gate initialized authenticated=${authenticated.value}`)
    // 未登录 → 进入正常登录流程；失败/取消后由 tabs 或登录按钮重新发起（不锁死）。
    if (!authenticated.value) requestLogin(viewFor(activeCapability.value))
  })
})

/**
 * 只有「auth init 完成 且 authenticated」时才允许消费 Android pending replay；
 * 未登录期间 Native pending 原样保留（跨 auth 保留）。
 */
watch([authReady, authenticated], ([ready, authed]) => {
  if (!ready || !authed) return
  nextTick(() => consumePendingWhenReady())
}, { immediate: true })

watch(() => props.initialCapability, (val) => {
  if (val) workspace.setWorkspaceTab(val)
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <ReplayWorkspaceHeader :has-files="!!files.length" @clear="clearSelection" />
    <ReplayCapabilityTabs :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />

    <section v-if="!authReady" class="workspace-auth-gate" data-testid="ws-auth-loading" aria-live="polite">
      <p class="workspace-auth-title">{{ $t('workspace.auth_checking') }}</p>
    </section>

    <!-- 未登录：只提供登录入口，replay 业务动作（上传 / 解析 / capability 面板）一律不可执行 -->
    <section v-else-if="!authenticated" class="workspace-auth-gate" data-testid="ws-auth-required">
      <p class="workspace-auth-title">{{ $t('workspace.auth_required') }}</p>
      <p class="workspace-auth-hint">{{ $t('workspace.auth_required_hint') }}</p>
      <button
        type="button"
        class="auth-gate-action"
        data-testid="ws-login"
        :disabled="loginInFlight"
        @click="requestLogin(viewFor(activeCapability))"
      >{{ $t('app.login') }}</button>
    </section>

    <template v-else>
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
        @update:files="updateFiles"
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
      <p v-if="error" class="error">{{ error }}</p>

      <div class="workspace-content">
        <ReplayPage
          v-show="activeCapability === 'data'"
          data-testid="ws-data"
          :embedded="true"
          :replay-context="workspace.replay"
          :workspace-context="workspace"
        />
        <div v-show="activeCapability === 'ai'" class="capability-pane" data-testid="ws-ai">
          <AiReviewPanel
            :file="aiReplay.targetFile.value"
            :processing-job-id="aiReplay.datasetRef.value?.processingJobId ?? null"
            :source-id="aiReplay.datasetRef.value?.sourceId ?? null"
            :dataset-error="aiReplay.datasetError.value || ''"
            @dataset-recover="aiReplay.recover"
          />
        </div>
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
.capability-pane { margin-top: 4px; }
.workspace-auth-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 16px;
  text-align: center;
}
.workspace-auth-title { font-weight: 600; }
.workspace-auth-hint { opacity: 0.8; }
.auth-gate-action { padding: 8px 20px; cursor: pointer; }
</style>
