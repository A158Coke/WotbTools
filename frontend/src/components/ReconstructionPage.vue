<!--
  独立 AI 复盘 / 战局回放视图（?view=reconstruction，深链 + 登录回跳入口）。
  单页 Workspace 改造后，主入口在 ReplayPage（原地切换），本页保留为独立深链：
  自己的单文件选择器 + 战局回放面板（BattlePlaybackPanel）+ AI 复盘面板（AiReviewPanel）。
  跨视图文件交接（replayTransfer）已随原地切换改造移除——文件不再离开 ReplayPage。
-->
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import * as api from '../utils/api.js'
import AiReviewPanel from './AiReviewPanel.vue'
import BattlePlaybackPanel from './BattlePlaybackPanel.vue'
import ReplayInputPanel from './ReplayInputPanel.vue'
import { displayName, fileKey } from '../utils/helpers.js'
import { apiErrorLabel } from '../utils/display.js'
import {
  MAX_REPLAY_FILES,
  MAX_REPLAY_TOTAL_BYTES,
  formatReplaySize,
  validateReplaySelection
} from '../utils/replayUpload.js'

// KeepAlive include 匹配组件名：App.vue 仅缓存本页，切走视图时保持面板状态存活。
defineOptions({ name: 'ReconstructionPage' })

const { t, te } = useI18n()
const { initPromise, login, authenticated } = useAuth()

/** 登录后回跳到本页而不是个人中心。 */
const LOGIN_VIEW = 'reconstruction'

// 入口随时可见，但进入本页后检查登录状态：未登录则自动跳转登录页。
// 鉴权若已就绪（authenticated 为真）直接 ready，避免多余的加载闪屏；
// 否则先 'init' 不渲染内容，等 initPromise 落定再决定 ready / login。
const authPhase = ref(authenticated.value ? 'ready' : 'init')

onMounted(async () => {
  let loggedIn = false
  try {
    loggedIn = Boolean(await initPromise)
  } catch {
    loggedIn = false
  }
  if (loggedIn) {
    authPhase.value = 'ready'
    return
  }
  authPhase.value = 'login'
  login(LOGIN_VIEW)
})

const files = ref([])
const error = ref('')
/** Dataset 引用（plan §50）：独立深链同样走 Processing Pipeline，不重新上传/full process。 */
const processingJobId = ref(null)
const sourceId = ref(null)
/** Dataset 生命周期错误（准备失败 / source 处理失败 / recovery 失败）的已本地化消息；空 = 无。 */
const datasetError = ref('')
/** exactly-once recovery（BLOCKER @164）：每个 selection / dataset generation 最多自动恢复一次。 */
let datasetRecoveryAttempted = false
let datasetRecoveryInFlight = false
/**
 * selection generation（BLOCKER 2）：任何文件选择变化（select / replace / remove / clear）
 * 自增。createProcessingJob 是异步的——返回后必须校验 generation + file identity 仍属于
 * 当前 selection，否则 best-effort cancel 返回的 jobId 并丢弃（绝不绑定 stale job）。
 * pollSourceReady 同样绑定 revision + jobId，迟到 poll 响应不得写当前状态。
 */
let datasetRevision = 0
let datasetPollTimer = null
let datasetPollJobId = null
// AI 报告时间跳转：传给 BattlePlaybackPanel（seekTo 自动加载/展开地图），并滚动定位到地图面板。
const mapSeek = ref(null)
const playbackPanelEl = ref(null)

function addFile(e) {
  const picked = Array.from(e.target.files || [])
  const result = validateReplaySelection(picked)
  if (!result.valid) {
    error.value = replaySelectionErrorMessage(t, result)
    return
  }
  if (picked.length === 0) return
  files.value = [picked[0]]
  error.value = ''
  selectionChanged()
  ensureDataset()
}

/** 与 FileUploader 同一共享 contract：preflight 拒绝时展示全部 offending 文件 + 限制提示。 */
function replaySelectionErrorMessage(tt, result) {
  const lines = []
  for (const off of result.offending) {
    lines.push(off.reason === 'INVALID_TYPE'
      ? tt('upload.reject_invalid_type', { name: displayName(off.file) })
      : tt('upload.reject_too_large_file', { name: displayName(off.file), size: formatReplaySize(off.file.size) }))
  }
  if (result.offending.some(o => o.reason === 'FILE_TOO_LARGE')) {
    lines.push(tt('upload.reject_size_hint'))
  }
  if (result.tooMany) {
    lines.push(tt('upload.reject_count', { max: MAX_REPLAY_FILES, current: result.count }))
  }
  if (result.totalTooLarge) {
    lines.push(tt('upload.reject_total', {
      size: formatReplaySize(result.totalBytes),
      max: formatReplaySize(MAX_REPLAY_TOTAL_BYTES)
    }))
  }
  return lines.join(' ')
}

function removeFile(index) {
  files.value = files.value.filter((_, i) => i !== index)
  error.value = ''
  selectionChanged()
}

function clearFile() {
  files.value = []
  error.value = ''
  selectionChanged()
}

/** 文件选择变化：新 generation + 立即失效旧 owned Dataset（含 best-effort cancel）。 */
function selectionChanged() {
  datasetRevision++
  // recovery budget 是 per-selection / per-dataset-generation：换重放/新选择后重置。
  datasetRecoveryAttempted = false
  datasetRecoveryInFlight = false
  invalidateDataset()
}

/**
 * 本地 Dataset 失效 + 后端 owned job 取消（BLOCKER 2.1）：
 * - 停止本页 poll（timer + token 置空）；
 * - 对 ReconstructionPage 自己 create 的、仍非终态的 Processing Job best-effort cancel
 *   （后端对 READY/FAILED/CANCELLED 返回 no-op，可接受）；绝不取消 ReplayPage 共享 batch job。
 * - 清理 processingJobId / sourceId 引用。
 */
function invalidateDataset() {
  if (datasetPollTimer) {
    clearTimeout(datasetPollTimer)
    datasetPollTimer = null
  }
  datasetPollJobId = null
  const owned = processingJobId.value
  if (owned) {
    api.cancelProcessingJob(owned).catch(() => {})
  }
  processingJobId.value = null
  sourceId.value = null
}

/** 选择回放后自动创建 Processing Job（priority=r0）并等待 source READY（plan §40/§50）。 */
async function ensureDataset() {
  invalidateDataset()
  const file = files.value[0]
  if (!file) return
  const revision = datasetRevision
  const targetKey = fileKey(file)
  try {
    const fd = new FormData()
    fd.append('files', file)
    fd.append('prioritySourceIndex', '0')
    const created = await api.createProcessingJob(fd)
    const current = files.value[0]
    if (datasetRevision !== revision || !current || fileKey(current) !== targetKey) {
      // stale create response：请求发起时的 selection 已被替换/清空——
      // 立即 best-effort cancel 返回的 jobId，不绑定、不启动 poll。
      api.cancelProcessingJob(created.jobId).catch(() => {})
      return
    }
    processingJobId.value = created.jobId
    datasetPollJobId = created.jobId
    pollSourceReady(created.jobId, revision)
  } catch (e) {
    const current = files.value[0]
    if (datasetRevision !== revision || !current || fileKey(current) !== targetKey) {
      return // stale error：不得污染当前 selection
    }
    // Dataset 准备失败属于数据集生命周期，不是用户输入错误：本地化，绝不裸抛内部错误码。
    datasetError.value = apiErrorLabel(t, te, e)
  }
}

/** Dataset 可恢复错误（JOB_NOT_FOUND）：失效 stale 引用并重建 p2；exactly-once（最多自动恢复一次）。 */
async function onDatasetRecover() {
  const file = files.value[0]
  if (!file) return
  if (datasetRecoveryInFlight) return // 同一 recovery in-flight：合并/忽略重复事件
  if (datasetRecoveryAttempted) {
    // 第二次 JOB_NOT_FOUND：不再 create 新 Processing Job，结束为本地化 FAILURE。
    datasetError.value = t('workspace.dataset_prepare_failed')
    invalidateDataset()
    return
  }
  datasetRecoveryAttempted = true
  datasetRecoveryInFlight = true
  datasetError.value = ''
  try {
    await ensureDataset()
  } finally {
    datasetRecoveryInFlight = false
  }
}

function pollSourceReady(jobId, revision) {
  const stop = () => {
    datasetPollTimer = null
    datasetPollJobId = null
  }
  const poll = async () => {
    if (datasetRevision !== revision || datasetPollJobId !== jobId) return
    try {
      const data = await api.getProcessingJob(jobId)
      if (datasetRevision !== revision || datasetPollJobId !== jobId) return
      const s = (data.sources || []).find(x => x.sourceId === 'r0')
      if (s && s.status === 'READY') {
        sourceId.value = 'r0'
        stop()
        return
      }
      if (s && s.status === 'FAILED') {
        // 本地化 source 处理失败，绝不裸展示内部稳定码；停止 poll（否则永久「准备中」）。
        datasetError.value = t('recon.errors.SOURCE_PROCESSING_FAILED')
        stop()
        return
      }
      if (['READY', 'FAILED', 'CANCELLED'].includes(data.status)) {
        // job 已终态但本 source 未 READY：停止 poll 并本地化为失败，不得永久停留在「准备中」。
        datasetError.value = t('recon.errors.SOURCE_NOT_READY')
        stop()
        return
      }
      datasetPollTimer = setTimeout(poll, 750)
    } catch {
      // network / GET 失败：停止 poll 并本地化，不得留下「准备中」或无错误码。
      if (datasetRevision === revision && datasetPollJobId === jobId) {
        datasetError.value = t('workspace.dataset_prepare_failed')
        stop()
      }
    }
  }
  poll() // 首次立即检查（测试/直连场景无需等待 750ms）
}

onBeforeUnmount(() => {
  // teardown（BLOCKER 2.1）：revision++ 使任何在途 create 返回都被视为 stale（立即
  // cancel、不绑定到已卸载页面）；同时 best-effort cancel 已拥有的非终态 job 并清 refs。
  selectionChanged()
})

/** AI 报告时间链接 → 回滚到地图区块（MapOverview 已自动切到战局回放视图）。 */
async function onAiSeek(sec) {
  mapSeek.value = null
  await nextTick()
  mapSeek.value = sec
  await nextTick()
  if (playbackPanelEl.value) {
    playbackPanelEl.value.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<template>
  <main class="recon-page layout-data-workspace">
    <!-- 未登录：提示并已自动跳转登录页，按钮用于跳转失败时手动重试 -->
    <div v-if="authPhase === 'login'" class="recon-auth">
      <p>{{ $t('recon.pleaseLogin') }}</p>
      <button class="btn-primary" @click="login(LOGIN_VIEW)">{{ $t('app.login') }}</button>
    </div>

    <div v-else-if="authPhase === 'init'" class="recon-auth">
      <p>{{ $t('recon.auth_loading') }}</p>
    </div>

    <template v-else>
      <ReplayInputPanel
        :files="files"
        @add-file="addFile"
        @remove-file="removeFile"
        @clear="clearFile"
      />

      <p v-if="error" class="error" style="margin:12px 0">{{ error }}</p>

      <!-- 独立地图区块：热力/路线/战局回放，不依赖 AI 复盘 -->
      <div ref="playbackPanelEl">
        <BattlePlaybackPanel
          :file="files[0] || null"
          :processing-job-id="processingJobId"
          :source-id="sourceId"
          :dataset-error="datasetError"
          :seek-to="mapSeek"
          login-view="reconstruction"
          @dataset-recover="onDatasetRecover"
        />
      </div>

      <AiReviewPanel
        :file="files[0] || null"
        :processing-job-id="processingJobId"
        :source-id="sourceId"
        :dataset-error="datasetError"
        login-view="reconstruction"
        @seek="onAiSeek"
        @dataset-recover="onDatasetRecover"
      />
    </template>
  </main>
</template>

<style scoped>
.recon-page :deep(.sub-hint) { color: var(--text-sub); font-size: .88rem; margin: 6px 0 16px; }
.recon-page :deep(.fb-chips) { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 12px; }
.recon-page :deep(.chip) { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 5px; background: var(--bg-chip); color: var(--text-label); }
.error { font-size: .88rem; }
.recon-auth { text-align: center; padding: 40px; color: var(--text-secondary); }
</style>
