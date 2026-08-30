<!--
  AI 复盘能力面板：SSE 分析流（call1/evidence/call2/autopsy）+ 流式进度 + 结果面板。
  不负责页面级登录门禁/自动跳转（由宿主入口把关）；仅在发起请求时经 authedFetch 兜底
  ensureToken + 401/403 处理。目标文件由父组件以 prop 传入（文件始终在 ReplayPage 内存中，
  由 capability page 传入（可来自解析页的内存 handoff）。
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { localizeAiError, isRecoverableDatasetCode } from '../utils/reconstruction-analysis.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import ReplayAnalysisAction from './ReplayAnalysisAction.vue'

const props = defineProps({
  /** 目标回放文件（null = 尚未选择，显示空态提示）。 */
  file: { type: Object, default: null },
  /** Dataset 引用：两者齐备时走 derived ai-facts，不再上传 replay。 */
  processingJobId: { type: String, default: null },
  sourceId: { type: String, default: null },
  /** Dataset 准备失败（父组件 ensureDatasetFor 未能建立引用）时的已本地化错误；空 = 无。 */
  datasetError: { type: String, default: '' }
})

const emit = defineEmits(['seek', 'dataset-recover'])

const { t, locale } = useI18n()
const { tokenParsed, token, ensureToken, login } = useAuth()

// AI Review 权限：已登录 + wotbtools-user 或 wotbtools-admin
const canUseAiReview = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (
    roles.includes('wotbtools-user') || roles.includes('wotbtools-admin')
  )
})

/**
 * Dataset 就绪守卫（defense-in-depth）：AI Analyze 只有在 authoritative
 * processingJobId + sourceId 都已绑定到面板后才能执行。file 已选但引用缺失 =
 * PREPARING_DATASET（状态机问题），不是用户错误。
 */
const datasetReady = computed(() => !!props.processingJobId && !!props.sourceId)
const datasetRecovering = ref(false)
/** Dataset 准备中/过期重试/失败的用户可读文案（数据集生命周期，非 AI 模型错误）。 */
const datasetMessage = computed(() => {
  if (datasetRecovering.value) return t('workspace.dataset_expired')
  if (props.datasetError) return props.datasetError
  return t('workspace.dataset_preparing')
})

const error = ref('')
const analyzing = ref(false)
const analysisResult = ref(null)
/** AI 复盘 capability（AnalyzeResponse.capability：AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE）。 */
const analysisCapability = computed(() => analysisResult.value?.capability || null)
const limitedTimelineNote = computed(() =>
  analysisCapability.value === 'AVAILABLE_WITH_LIMITED_TIMELINE'
    ? t('recon.capability_limited')
    : '')

// 流式状态：当前阶段（call1 赛前预测 / evidence 证据分析 / call2 生成中 / autopsy 团队剖析）
// 与主复盘已到达文本（token 滚动）。
const progressStage = ref('')
const partialAnalysis = ref('')

// AI 复盘请求生命周期：客户端安全超时 + 取消（AbortController + 后端 cancel 端点）。
// 超时链对齐：后端整体 deadline=1100s < nginx analyze 1120s；前端 1100s 在 nginx 之前给出干净 AI_TIMEOUT。
const AI_ANALYZE_TIMEOUT_MS = 1_100_000
/**
 * 当前 AI analysis run：每次 runAnalyze 创建独立 run context
 * {controller, correlationId, startedAt, timeoutTimer, cancelRequested, timedOut}。
 * Dataset identity 变化（file / processingJobId / sourceId）只取消旧 activeRun（它自己
 * 的 timer / correlationId / controller），再解除 active ownership 并重置共享 UI 状态；
 * stale run 通过 activeRun === run 判定作废，绝不修改新 generation 的状态。
 */
let activeRun = null

function resetResults() {
  analysisResult.value = null
  progressStage.value = ''
  partialAnalysis.value = ''
}

// 目标 file 或 Dataset identity 变化：只取消 oldRun（自己的 timer/correlationId/controller），
// 再解除 active ownership；新 B run 不得被 oldRun 的异步 unwind 影响。
watch(() => [props.file, props.processingJobId, props.sourceId], () => {
  datasetRecovering.value = false
  const oldRun = activeRun
  if (oldRun) {
    cancelRun(oldRun)
  }
  activeRun = null
  analyzing.value = false
  resetResults()
  error.value = ''
})

// 统一的受保护请求：确保带上有效的 Keycloak Bearer Token（/api/replay/* 需要角色），
// 并统一处理 token 刷新失败 / 401 / 403。
async function authedFetch(url, body, { signal } = {}) {
  const valid = await ensureToken(30)
  if (!valid) {
    login('replay')
    throw new Error(t('recon.auth_required'))
  }
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  if (typeof body === 'string') headers['Content-Type'] = 'application/json'
  const r = await fetch(url, { method: 'POST', headers, body, signal })
  if (r.status === 401) {
    login('replay')
    throw new Error(t('recon.auth_required'))
  }
  if (r.status === 403) {
    throw new Error(t('recon.forbidden'))
  }
  return r
}

/** 尽力而为地通知后端取消 in-flight 请求（按钮取消 / 面板卸载 / 前端超时）。 */
function fireCancel(correlationId) {
  if (!correlationId) return
  const accessToken = token()
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  fetch(`/api/replay/analyze/cancel?correlationId=${encodeURIComponent(correlationId)}`, {
    method: 'POST',
    headers,
    keepalive: true
  }).catch(() => {})
}

/** 只取消指定 run（closure-capture：只操作 run 自己的 timer / correlationId / controller）。 */
function cancelRun(run) {
  if (!run) return
  run.cancelRequested = true
  if (run.timeoutTimer) {
    clearTimeout(run.timeoutTimer)
    run.timeoutTimer = null
  }
  fireCancel(run.correlationId)
  run.controller.abort()
}

function cancelAnalyze() {
  cancelRun(activeRun)
}

function newCorrelationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 数据集可恢复错误（job/dataset 引用过期或缺失）：交给父组件重建引用，不当作最终用户错误。 */
function handleDatasetRecover(code) {
  datasetRecovering.value = true
  error.value = ''
  emit('dataset-recover', code)
}

async function runAnalyze() {
  if (analyzing.value) return
  // Dataset 尚未就绪属于状态机问题（PREPARING_DATASET），不是用户错误：不发请求、不显示裸错误码。
  if (!datasetReady.value) return
  const run = {
    controller: new AbortController(),
    correlationId: newCorrelationId(),
    startedAt: Date.now(),
    timeoutTimer: null,
    cancelRequested: false,
    timedOut: false
  }
  activeRun = run
  analyzing.value = true
  error.value = ''
  analysisResult.value = null
  progressStage.value = 'call1'
  partialAnalysis.value = ''
  // timeout closure-capture run：fire 时只读 run.correlationId / run.controller。
  run.timeoutTimer = setTimeout(() => {
    run.timedOut = true
    fireCancel(run.correlationId)
    run.controller.abort()
  }, AI_ANALYZE_TIMEOUT_MS)
  try {
    const r = await authedFetch('/api/replay/analyze', analyzeBody(run.correlationId),
      { signal: run.controller.signal })
    if (activeRun !== run) return // stale response：不读流、不写任何状态
    if (!r.ok) {
      const rawBody = await r.text().catch(() => '')
      const trimmed = rawBody.trim()
      let errorData = { code: trimmed, maxFiles: 1 }
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const json = JSON.parse(trimmed)
          errorData = { code: json.code || '', maxFiles: json.maxFiles || 1 }
        } catch {
        }
      }
      // 数据集引用过期/缺失（JOB_NOT_FOUND 等）：触发父组件重建，而非把错误码展示给用户。
      if (isRecoverableDatasetCode(errorData.code)) {
        handleDatasetRecover(errorData.code)
        return
      }
      throw new Error(localizeAiError(errorData, r.status, t))
    }
    // SSE 流式解析：阶段事件 + call2_token 主复盘增量 + done 收尾。
    const receivedDone = await readAnalyzeStream(r, run)
    if (!receivedDone && !run.cancelRequested) {
      // 流异常中断（未收到 done 且未取消）：视为无效响应。
      throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
    }
  } catch (e) {
    // file / Dataset identity 已切换：本次分析作废，不写任何状态。
    if (activeRun !== run) return
    // 数据集引用过期（后端稳定码 / SSE error 事件）：交回父组件重建，不显示裸错误码。
    if (e && e.recoverableDatasource) {
      handleDatasetRecover(e.message)
      return
    }
    if (e && e.name === 'AbortError') {
      error.value = run.timedOut ? t('recon.errors.AI_TIMEOUT') : t('recon.cancelled')
    } else if (run.cancelRequested) {
      // 用户主动取消：保持「已取消」语义，忽略后端 error 事件。
      error.value = t('recon.cancelled')
    } else {
      error.value = e.message || String(e)
    }
  } finally {
    // 只清理自己的 timer；非当前 run 的 finally 不得触碰共享 UI 状态。
    clearTimeout(run.timeoutTimer)
    run.timeoutTimer = null
    if (activeRun === run) {
      activeRun = null
      analyzing.value = false
    }
  }
}

/**
 * Dataset 路径：必须携带 processingJobId+sourceId，绝不回退 multipart
 * 重新上传/重新 full process。
 */
function analyzeBody(correlationId) {
  if (!props.processingJobId || !props.sourceId) {
    // 防御：runAnalyze 已用 datasetReady 守卫；此路径正常情况下不可达。绝不裸抛内部错误码，
    // 以本地化消息兜底（状态机问题，非最终用户错误）。
    throw new Error(t('recon.errors.DATASET_REFERENCE_REQUIRED'))
  }
  return JSON.stringify({
    processingJobId: props.processingJobId,
    sourceId: props.sourceId,
    lang: locale.value,
    correlationId
  })
}

/**
 * 读取 SSE 响应体并分发事件（run context 显式传入）：
 * call1_start/call1_done/evidence_done → 阶段状态；
 * call2_token → 主复盘文本累积（token 滚动）；
 * autopsy_start/autopsy_done → 团队剖析阶段；
 * done → 设置最终结果并返回 true；
 * error → 抛出本地化错误。
 * @returns {Promise<boolean>} 是否收到 done 事件
 */
async function readAnalyzeStream(r, run) {
  const reader = r.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = ''
  let currentData = ''
  let receivedDone = false
  const deadlineMs = run.startedAt + AI_ANALYZE_TIMEOUT_MS

  const dispatch = () => {
    if (!currentEvent) return
    let data = {}
    if (currentData) {
      try {
        data = JSON.parse(currentData)
      } catch {
        data = {}
      }
    }
    handleStreamEvent(currentEvent, data)
    currentEvent = ''
    currentData = ''
  }

  const handleStreamEvent = (event, data) => {
    if (activeRun !== run) {
      // Dataset identity 已在途变化：本流属于旧 generation，任何阶段/结果都不得写回。
      return
    }
    switch (event) {
      case 'call1_start':
        progressStage.value = 'call1'
        break
      case 'call1_done':
        progressStage.value = 'evidence'
        break
      case 'evidence_done':
        progressStage.value = 'call2'
        break
      case 'call2_token':
        // fallback 路径（NON_ZH/NO_RECONSTRUCTION/RECORDER_UNRESOLVED/
        // FEATURES_UNAVAILABLE/PRE_BATTLE_UNAVAILABLE 等）会直接进入旧
        // PlayerReplay 流，不发送 evidence_done/call2 阶段事件；token 到达即
        // 说明已在生成主复盘，阶段强制进入 call2，避免停留在「赛前预测/证据分析」。
        if (progressStage.value !== 'call2') {
          progressStage.value = 'call2'
        }
        if (typeof data.delta === 'string') {
          partialAnalysis.value += data.delta
        }
        break
      case 'autopsy_start':
        progressStage.value = 'autopsy'
        break
      case 'autopsy_done':
        progressStage.value = 'call2'
        break
      case 'done':
        if (typeof data.analysis === 'string' && data.analysis.trim()) {
          analysisResult.value = {
            analysis: data.analysis,
            preBattleSection: data.preBattleSection,
            capability: data.capability
          }
          progressStage.value = 'done'
          receivedDone = true
        }
        break
      case 'error':
        // 流中途失败：以稳定错误码本地化后终止流。
        // 数据集引用过期（JOB_NOT_FOUND 等）不是 AI 错误：作为可恢复信号向上传播。
        if (isRecoverableDatasetCode(data.code)) {
          const recoverable = new Error(data.code || 'JOB_NOT_FOUND')
          recoverable.recoverableDatasource = true
          throw recoverable
        }
        const localized = new Error(localizeAiError({ code: data.code || '' }, 502, t))
        localized.isLocalized = true
        throw localized
      default:
        break
    }
  }

  try {
    for (;;) {
      // 墙钟超时兜底：后台标签定时器被节流时，活跃流仍按 1100s 语义中止。
      if (Date.now() >= deadlineMs) {
        run.timedOut = true
        fireCancel(run.correlationId)
        run.controller.abort()
        const err = new Error('AI_ANALYZE_TIMEOUT')
        err.name = 'AbortError'
        throw err
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        if (line === '') {
          dispatch()
        } else if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          currentData = line.slice(5).trim()
        }
      }
      if (receivedDone) break
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      // 用户取消/超时：保持取消语义，不当作流异常。
      throw e
    }
    if (e && e.isLocalized) {
      // error 事件已生成本地化消息：原样传播。
      throw e
    }
    if (e && e.recoverableDatasource) {
      // 数据集引用过期：交给 runAnalyze 的 recover 分支。
      throw e
    }
    throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
  } finally {
    reader.releaseLock?.()
  }
  return receivedDone
}

function onPageLeave() {
  const run = activeRun
  if (run) {
    fireCancel(run.correlationId)
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', onPageLeave)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onPageLeave)
})
</script>

<template>
  <div class="ai-review-panel">
    <p v-if="!file && !datasetReady" class="ws-note">{{ $t('workspace.ai_empty') }}</p>
    <template v-else>
      <div v-if="canUseAiReview" class="ai-action-row">
        <ReplayAnalysisAction :analyzing="analyzing" :disabled="!datasetReady" @analyze="runAnalyze" @cancel="cancelAnalyze" />
      </div>

      <!-- dataset 未就绪（PREPARING_DATASET / JOB_NOT_FOUND / FAILURE）：AI Analyze 禁用，显示准备/失败状态 -->
      <div v-if="!datasetReady" class="ai-dataset-status" data-test="ai-dataset-status">
        <span v-if="!datasetError" class="stream-spinner" aria-hidden="true"></span>
        <span :class="{ 'ai-dataset-error': !!datasetError }">{{ datasetMessage }}</span>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="analyzing" class="panel streaming-panel">
        <div class="stream-status">
          <span class="stream-spinner" aria-hidden="true"></span>
          <span class="stream-stage">
            {{ $t(`recon.stages.${progressStage || 'call1'}`) }}
          </span>
        </div>
        <div v-if="partialAnalysis" class="stream-text">{{ partialAnalysis }}</div>
      </div>

      <AnalysisResultPanel v-if="analysisResult" :result="analysisResult" @seek="(sec) => emit('seek', sec)" />
      <p v-if="limitedTimelineNote" class="ai-capability-note" data-test="ai-capability-limited">
        {{ limitedTimelineNote }}
      </p>
    </template>
  </div>
</template>

<style scoped>
/* AI Review Workspace 唯一 width owner：AI Action / Error / Streaming / Analysis Result
   全部共享同一 left/right edge 与 max-width；子组件不再各自决定页面宽度。 */
.ai-review-panel {
  width: min(1100px, 100%);
  margin-inline: auto;
}
.ai-capability-note {
  margin: 10px 0;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--warn-text) 40%, var(--border));
  border-radius: 7px;
  background: color-mix(in srgb, var(--warn-text) 10%, var(--bg-card));
  color: var(--warn-text);
  font-size: .84rem;
}
.ai-action-row {
  display: flex;
  align-items: center;
  margin: 16px 0;
}
.ws-note { margin: 18px 4px; color: var(--text-muted); font-size: .85rem; }

/* Dataset 准备中/过期重试状态：loading 文案（非红色错误） */
.ai-dataset-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
  font-size: .9rem;
  color: var(--text-label);
}
/* FAILURE：与 PREPARING 明确区分——无 spinner、错误色文本 */
.ai-dataset-status .ai-dataset-error {
  color: var(--error);
}

/* 流式生成面板：阶段状态 + 主复盘 token 滚动预览 */
.streaming-panel { margin-top: 16px; }
.stream-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .88rem;
  color: var(--text-label);
  margin-bottom: 8px;
}
.stream-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: stream-spin 0.9s linear infinite;
  flex-shrink: 0;
}
@keyframes stream-spin {
  to { transform: rotate(360deg); }
}
.stream-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  max-height: 320px;
  overflow-y: auto;
  word-break: break-word;
}
</style>
