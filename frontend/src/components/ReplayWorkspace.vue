<script setup>
import { computed, inject, nextTick, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName } from '../utils/helpers.js'
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

defineOptions({ name: 'ReplayWorkspace' })

const props = defineProps({
  /** 初始能力：data / ai / playback（由路由 view 派生）。 */
  initialCapability: { type: String, default: 'data' },
})

const { t } = useI18n()
const isAuthenticated = inject('isAuthenticated', () => false)
const login = inject('login', null)
const authInit = inject('authInit', Promise.resolve())
const navigate = inject('navigate', null)

/**
 * Workspace 持有唯一一份 replay selection / Processing Job，并向下 provide。
 * data / ai / playback 三个能力共享这份状态——选择一次、只建一次 Job。
 */
const workspace = useReplayWorkspace(props.initialCapability || 'data')
provide('replay', workspace.replay)
provide('replayWorkspace', workspace)

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
  // 强制默认 data/replay capability，绝不误入 AI。
  workspace.setWorkspaceTab('data')
  updateFiles([file])
  // 自动解析一次：startProcessingJob 内部 single-flight + 现有 Processing error/retry，不无限自动重试。
  await startProcessingJob(replayColsInit || undefined)
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

/**
 * Capability 状态拆分（读后端 dataset 契约）。三种能力各自独立：
 * - base：基础解析（processingJob READY -> ready；failed -> failed）
 * - ai / playback：由面板消费 source 的可用性；AI 失败不污染 Playback，反之亦然。
 */
const capabilityStates = ref({ base: 'idle', ai: 'idle', playback: 'idle' })
watch(() => processingJob.value, (job) => {
  if (!job) {
    capabilityStates.value = { base: 'idle', ai: 'idle', playback: 'idle' }
    return
  }
  if (job.status === 'READY') capabilityStates.value.base = 'ready'
  else if (job.status === 'FAILED' || job.status === 'CANCELLED') capabilityStates.value.base = 'failed'
  else capabilityStates.value.base = 'idle'
})

const activeCapability = workspace.activeWorkspaceTab
const batchOpen = ref(false)
let loginAttempted = false

/** 当前选中单场显示名（header「当前回放：xxx #N」。Blocker #4）。 */
const currentBattleName = computed(() => {
  const f = workspace.currentTargetFile.value
  return f ? displayName(f) : ''
})

/** 模板直接消费的 workspace 权威 ref（顶层绑定，模板自动解包 ref）。 */
const currentBattleId = workspace.currentBattleId
const currentBattleIndex = workspace.currentBattleIndex
function selectBattle(sourceId) {
  workspace.selectBattle(sourceId)
  batchOpen.value = false
}

// AI 与 Playback 各自持有独立 Dataset 状态，互不污染（计划 §12 错误域拆分）。
const aiReplay = useCapabilityReplay(workspace.replay)
const playbackReplay = useCapabilityReplay(workspace.replay)

/** 切到 ai / playback 且目标文件确定时准备 Dataset（绝不重传 / 重 parse）。 */
watch([activeCapability, workspace.currentTargetFile], ([cap, file]) => {
  if (cap !== 'ai' && cap !== 'playback') return
  if (files.value.length > 1 && !file) {
    const helper = cap === 'ai' ? aiReplay : playbackReplay
    helper.setLimitError()
    return
  }
  const helper = cap === 'ai' ? aiReplay : playbackReplay
  if (file) helper.prepareForFile(file)
})

/**
 * Replay Workspace 全部要求登录：三个 capability（data / ai / playback）都走 auth gate。
 * 未登录进入任意 replay URL → 自动 Keycloak/OIDC，登录成功后按 redirectUri 回原 capability。
 */
const VIEW_BY_CAPABILITY = Object.freeze({ data: 'replay', ai: 'ai-review', playback: 'battle-playback' })

async function setCapability(key) {
  if (key === activeCapability.value) return
  const ok = await awaitAuthGate(key)
  if (!ok) return
  workspace.setWorkspaceTab(key)
  if (navigate) navigate(VIEW_BY_CAPABILITY[key] || 'replay', null)
}

/**
 * 登录门禁（auth race safe）：先等 Keycloak init 完成，再据「已确认的 authenticated」判断。
 * 只有在确认未登录时才 login 一次；已有 SSO/session 的用户进入 Workspace 不触发无谓 kc.login()。
 */
async function awaitAuthGate(cap) {
  try { await authInit } catch { /* init 失败视作未登录 */ }
  if (isAuthenticated()) return true
  if (!loginAttempted) {
    loginAttempted = true
    if (login) login(VIEW_BY_CAPABILITY[cap] || 'replay')
  }
  return false
}

// 数据 tab 的列初始化具名（ReplayPage 通过事件注册；只注册一次）。
let replayColsInit = null
function registerReplayColsInit(fn) {
  replayColsInit = fn
}

async function onPreview() {
  await startProcessingJob(replayColsInit || undefined)
}

function onFileRemoveRequest(f) {
  workspace.replay.askRemoveFile(f)
}

function confirmRemove() {
  workspace.replay.confirmRemove(replayColsInit || undefined)
}

function clearSelection() {
  updateFiles([])
  aiReplay.reset()
  playbackReplay.reset()
}

onMounted(() => {
  // 任意 replay capability：未登录自动跳 Keycloak，登录后回原 capability。
  // awaitAuthGate 内部先等 Keycloak init 完成再判断 authenticated（auth race safe）。
  awaitAuthGate(activeCapability.value).then((ok) => {
    // Android 外部 replay：仅确认已登录后才尝试导入（跨 auth 保留 pending）。
    if (ok) nextTick(() => consumePendingWhenReady())
  }).catch(() => {})
})

// 外部导航（URL 直访 / battle action）同步能力 tab。
watch(() => props.initialCapability, (val) => {
  if (val) workspace.setWorkspaceTab(val)
}, { immediate: true })

// selection 变化（上传/替换/清空/删 battle）→ 两个 capability 的 Dataset 引用失效，防止旧 source 被复用。
watch(() => workspace.replay.selectionRevision.value, () => {
  aiReplay.reset()
  playbackReplay.reset()
})
</script>

<template>
  <div class="layout-data-workspace replay-workspace">
    <header class="workspace-header">
      <div class="ws-title">
        <span class="upload-kicker">WOTBTOOLS · REPLAY WORKSPACE</span>
        <h1>{{ $t('workspace.title') }}</h1>
      </div>
      <div class="ws-replay-info" v-if="files.length">
        <span class="ws-batch-count">{{ $t('workspace.batch_count', { count: files.length }) }}</span>
        <button v-if="currentBattleIndex >= 0" class="ghost sm ws-selector" data-testid="ws-batch-selector" @click="batchOpen = !batchOpen">
          {{ $t('workspace.current_battle', { name: currentBattleName, idx: currentBattleIndex + 1 }) }} ▾
        </button>
        <div v-if="batchOpen && currentBattleIndex >= 0" class="ws-batch-sheet" data-testid="ws-batch-sheet">
          <button
            v-for="(f, i) in files"
            :key="i"
            type="button"
            class="ws-batch-item"
            :class="{ active: currentBattleId === 'r' + i }"
            @click="selectBattle('r' + i)"
          >
            {{ f.name }}
          </button>
        </div>
      </div>
      <div class="ws-actions">
        <span v-if="files.length" class="ws-capability-flags">
          <span class="cap-flag" :class="capabilityStates.base" data-testid="cap-base">{{ $t('workspace.cap_data') }}</span>
          <span class="cap-flag" :class="capabilityStates.ai" data-testid="cap-ai">{{ $t('workspace.cap_ai') }}</span>
          <span class="cap-flag" :class="capabilityStates.playback" data-testid="cap-playback">{{ $t('workspace.cap_playback') }}</span>
        </span>
        <button v-if="files.length" class="ghost sm" @click="clearSelection">{{ $t('workspace.clear') }}</button>
      </div>
    </header>

    <nav class="workspace-tabs" role="tablist" aria-label="Replay capabilities">
      <button
        v-for="c in capabilityOptions"
        :key="c.key"
        role="tab"
        type="button"
        :class="{ active: activeCapability === c.key }"
        :aria-selected="activeCapability === c.key"
        data-testid="ws-tab"
        :data-cap="c.key"
        @click="setCapability(c.key)"
      >
        {{ $t(c.labelKey) }}
      </button>
    </nav>

    <!-- 单一上传器 + Processing 面板（Workspace 级，任何能力共享同一 selection / job）。 -->
    <FileUploader
      :files="files"
      :loading="loading"
      :confirm-remove="!!resp"
      :compact="!!resp"
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

    <!-- v-show 保持各能力面板常驻，切换到其它 tab 不丢各自 UI 状态（计划 §10.3）。 -->
    <div class="workspace-content">
      <ReplayPage
        v-show="activeCapability === 'data'"
        data-testid="ws-data"
        :embedded="true"
        @register-cols-init="registerReplayColsInit"
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
.workspace-header {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ws-title h1 { margin: 2px 0 0; font-size: 1.5rem; }
.ws-replay-info { display: inline-flex; align-items: center; gap: 8px; min-width: 0; position: relative; }
.ws-selector { min-height: 30px; }
.ws-batch-sheet {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: var(--hard-shadow);
  min-width: 240px;
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ws-batch-item { text-align: left; padding: 8px 10px; border-radius: 6px; border: none; background: transparent; color: var(--text-label); font-size: .82rem; cursor: pointer; font-family: inherit; }
.ws-batch-item:hover { background: var(--bg-list-hover); }
.ws-batch-item.active { background: var(--bg-blue); color: var(--accent-dark); font-weight: 700; }
.ws-actions { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
.ws-capability-flags { display: inline-flex; gap: 6px; }
.cap-flag { padding: 3px 8px; border-radius: 6px; font-size: .72rem; font-weight: 700; border: 1px solid var(--border); color: var(--text-sub); }
.cap-flag.ready { color: var(--status-ok-fg); border-color: color-mix(in srgb, var(--status-ok-fg) 40%, var(--border)); }
.cap-flag.failed { color: var(--error); border-color: color-mix(in srgb, var(--error) 40%, var(--border)); }
.workspace-tabs {
  display: flex;
  gap: 4px;
  margin: 10px 0 14px;
  background: rgba(13,18,22,.92);
  border: 1px solid rgba(58,69,76,.5);
  border-radius: 9px;
  padding: 3px;
  overflow-x: auto;
  scrollbar-width: none;
}
.workspace-tabs::-webkit-scrollbar { display: none; }
.workspace-tabs button {
  flex: 0 0 auto;
  padding: 8px 16px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #b5b2aa;
  cursor: pointer;
  font-size: .88rem;
  font-family: inherit;
  font-weight: 600;
  white-space: nowrap;
}
.workspace-tabs button.active { background: rgba(217,143,24,.16); color: #f0aa30; font-weight: 700; }
.workspace-tabs button:hover:not(.active) { color: #e0ddd4; }
.capability-pane { margin-top: 4px; }
@media (max-width: 768px) {
  .workspace-header { gap: 8px; }
  .ws-actions { margin-left: 0; width: 100%; justify-content: space-between; }
  /* 手机端 batch selector 以 bottom-sheet 呈现：贴底、全宽、从上滑入（计划 §16.2）。 */
  .ws-replay-info { width: 100%; }
  .ws-selector { width: 100%; justify-content: space-between; }
  .ws-batch-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    max-height: 55vh;
    border-radius: 14px 14px 0 0;
    padding: 12px;
    box-shadow: 0 -10px 30px rgba(0,0,0,.35);
  }
}
</style>
