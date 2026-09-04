<script setup>
import { computed, inject, nextTick, onMounted, watch } from 'vue'
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
const { initPromise: authInit, isAuthenticated, login } = useAuth()

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
 */
async function importPendingFile(file) {
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  await startProcessingJob()
}

const { consumePendingWhenReady } = useNativeReplayImport({
  isAuthenticated,
  onPendingFile: importPendingFile,
})

const capabilityOptions = [
  { key: 'data', labelKey: 'workspace.tab_data' },
  { key: 'ai', labelKey: 'workspace.tab_ai' },
  { key: 'playback', labelKey: 'workspace.tab_playback' },
]

const activeCapability = workspace.activeWorkspaceTab
let loginAttempted = false

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

async function setCapability(key) {
  if (key === activeCapability.value) return
  const ok = await awaitAuthGate(key)
  if (!ok) return
  workspace.setWorkspaceTab(key)
  if (navigate) navigate(VIEW_BY_CAPABILITY[key] || 'replay')
}

/**
 * 登录门禁（auth race safe）：直接消费 useAuth singleton，不再经 AppShell string service locator。
 * 先等 Keycloak init 完成，再据已确认的 authenticated 判断。
 */
async function awaitAuthGate(cap) {
  try { await authInit } catch { /* init 失败视作未登录 */ }
  if (isAuthenticated()) return true
  if (!loginAttempted) {
    loginAttempted = true
    login(VIEW_BY_CAPABILITY[cap] || 'replay')
  }
  return false
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
  awaitAuthGate(activeCapability.value).then((ok) => {
    if (ok) nextTick(() => consumePendingWhenReady())
  }).catch(() => {})
})

watch(() => props.initialCapability, (val) => {
  if (val) workspace.setWorkspaceTab(val)
}, { immediate: true })

</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <ReplayWorkspaceHeader :has-files="!!files.length" @clear="clearSelection" />
    <ReplayCapabilityTabs :options="capabilityOptions" :active-capability="activeCapability" @select="setCapability" />
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
  </div>
</template>

<style scoped>
.replay-workspace { padding-right: var(--pd-drawer-offset, 0px); }
.capability-pane { margin-top: 4px; }
</style>
