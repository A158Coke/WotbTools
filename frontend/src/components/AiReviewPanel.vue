<!--
  AI 复盘能力面板：SSE 分析流（call1/evidence/call2）+ 流式进度 + 结果面板。
  不负责页面级登录门禁/自动跳转（由宿主入口把关）。HTTP endpoint / auth / canonical
  error handling 由 api/replay-capabilities.ts 统一拥有；本组件只编排 run lifecycle 与 SSE 展示状态。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { cancelAiReview, openAiReviewStream, type ReplayAuthSession } from '../api/replay-capabilities.js'
import { isRecoverableDatasetCode } from '../utils/reconstruction-analysis.js'
import { apiErrorLabel } from '../utils/display.js'
import { ApiError, normalizeApiError } from '../utils/http.js'
import type { AiReviewCapability, AiReviewResult, AiReviewRunState } from '../types/ai-review.js'
import type { AiReviewEvent } from '../types/ai-review.js'
import { createAiReviewSseParser } from '../utils/aiReviewSse.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import ReplayAnalysisAction from './ReplayAnalysisAction.vue'

type AuthTokenParsed = { realm_access?: { roles?: unknown } } | null
type AiRuntimeError = Error & { recoverableDatasource?: boolean; isLocalized?: boolean }
type AiPanelAuth = ReplayAuthSession & { tokenParsed: { value: AuthTokenParsed } }

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

const { t, te, locale } = useI18n()
const auth = useAuth() as AiPanelAuth
const { tokenParsed } = auth

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
const errorId = ref('')
const copiedErrorId = ref(false)
const analyzing = ref(false)
const analysisResult = ref<AiReviewResult | null>(null)
/** AI 复盘 capability（AnalyzeResponse.capability：AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE）。 */
const analysisCapability = computed<AiReviewCapability | null>(() => analysisResult.value?.capability || null)
const limitedTimelineNote = computed(() =>
  analysisCapability.value === 'AVAILABLE_WITH_LIMITED_TIMELINE'
    ? t('recon.capability_limited')
    : '')

// 流式状态：当前阶段（call1 赛前预测 / evidence 证据分析 / call2 生成中）
// 与主复盘已到达文本（token 滚动）。
const progressStage = ref('')
const partialAnalysis = ref('')

// AI 复盘请求生命周期：客户端安全超时 + 取消（AbortController + 后端 cancel 端点）。
// 超时链对齐：后端整体 deadline=1100s < nginx analyze 1120s；前端 1100s 在 nginx 之前给出干净 AI_TIMEOUT。
const AI_ANALYZE_TIMEOUT_MS = 1_100_000
/**
 * 当前 AI analysis run：每次 runAnalyze 创建独立 run context。
 * Dataset identity 变化只取消旧 activeRun；stale run 绝不修改新 generation 的状态。
 */
let activeRun: AiReviewRunState | null = null

function resetResults() {
  analysisResult.value = null
  progressStage.value = ''
  partialAnalysis.value = ''
}

watch(() => [props.file, props.processingJobId, props.sourceId], () => {
  datasetRecovering.value = false
  const oldRun = activeRun
  if (oldRun) cancelRun(oldRun)
  activeRun = null
  analyzing.value = false
  resetResults()
  error.value = ''
  errorId.value = ''
  copiedErrorId.value = false
})

async function copyErrorId() {
  if (!errorId.value || typeof navigator === 'undefined' || !navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(errorId.value)
    copiedErrorId.value = true
  } catch {
    copiedErrorId.value = false
  }
}

/** 尽力而为地通知后端取消 in-flight 请求（按钮取消 / 面板卸载 / 前端超时）。 */
function fireCancel(correlationId: string) {
  if (!correlationId) return
  cancelAiReview(auth, correlationId).catch(() => {})
}

/** 只取消指定 run（closure-capture：只操作 run 自己的 timer / correlationId / controller）。 */
function cancelRun(run: AiReviewRunState | null) {
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

function analyzeRequest(correlationId: string) {
  if (!props.processingJobId || !props.sourceId) {
    throw new Error(t('recon.errors.DATASET_REFERENCE_REQUIRED'))
  }
  return {
    processingJobId: props.processingJobId,
    sourceId: props.sourceId,
    lang: locale.value,
    correlationId,
  }
}

async function runAnalyze() {
  if (analyzing.value) return
  if (!datasetReady.value) return
  const run: AiReviewRunState = {
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
  errorId.value = ''
  copiedErrorId.value = false
  analysisResult.value = null
  progressStage.value = 'call1'
  partialAnalysis.value = ''
  run.timeoutTimer = setTimeout(() => {
    run.timedOut = true
    fireCancel(run.correlationId)
    run.controller.abort()
  }, AI_ANALYZE_TIMEOUT_MS)
  try {
    const r = await openAiReviewStream(auth, analyzeRequest(run.correlationId), run.controller.signal)
    if (activeRun !== run) return
    const receivedDone = await readAnalyzeStream(r, run)
    if (!receivedDone && !run.cancelRequested) {
      throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
    }
  } catch (e) {
    if (activeRun !== run) return
    const runtimeError = e as AiRuntimeError
    if (runtimeError.recoverableDatasource) {
      handleDatasetRecover(runtimeError.message)
      return
    }
    if (e instanceof ApiError && isRecoverableDatasetCode(e.code)) {
      handleDatasetRecover(e.code)
      return
    }
    const normalized = normalizeApiError(e)
    errorId.value = normalized.id || normalized.traceId || ''
    if (normalized.code === 'REQUEST_ABORTED') {
      error.value = run.timedOut ? t('recon.errors.AI_TIMEOUT') : t('recon.cancelled')
    } else if (run.cancelRequested) {
      error.value = t('recon.cancelled')
    } else {
      error.value = e instanceof ApiError || e instanceof TypeError
        ? apiErrorLabel(t, te, normalized)
        : (runtimeError.message || String(runtimeError))
    }
  } finally {
    if (run.timeoutTimer) clearTimeout(run.timeoutTimer)
    run.timeoutTimer = null
    if (activeRun === run) {
      activeRun = null
      analyzing.value = false
    }
  }
}

/**
 * 读取 SSE 响应体并分发事件（run context 显式传入）。
 * @returns {Promise<boolean>} 是否收到 done 事件
 */
async function readAnalyzeStream(r, run) {
  const reader = r.body.getReader()
  const parser = createAiReviewSseParser()
  let receivedDone = false
  const deadlineMs = run.startedAt + AI_ANALYZE_TIMEOUT_MS

  const handleStreamEvent = (event: AiReviewEvent) => {
    if (activeRun !== run) return
    switch (event.type) {
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
        if (progressStage.value !== 'call2') progressStage.value = 'call2'
        partialAnalysis.value += event.delta
        break
      case 'done':
        analysisResult.value = event.result
        progressStage.value = 'done'
        receivedDone = true
        break
      case 'error':
        if (isRecoverableDatasetCode(event.code)) {
          const recoverable = new Error(event.code || 'JOB_NOT_FOUND') as AiRuntimeError
          recoverable.recoverableDatasource = true
          throw recoverable
        }
        throw new ApiError({
          errorCode: event.code || 'AI_REVIEW_GROUNDING_FAILED',
          errorMsg: event.errorMsg,
          id: event.id,
          status: 502,
          retryable: false,
        })
    }
  }

  const consumeEvents = (events: AiReviewEvent[]) => {
    for (const event of events) {
      handleStreamEvent(event)
      if (receivedDone) break
    }
  }

  try {
    for (;;) {
      if (Date.now() >= deadlineMs) {
        run.timedOut = true
        fireCancel(run.correlationId)
        run.controller.abort()
        const err = new Error('AI_ANALYZE_TIMEOUT')
        err.name = 'AbortError'
        throw err
      }
      const { done, value } = await reader.read()
      if (done) {
        consumeEvents(parser.finish())
        break
      }
      consumeEvents(parser.push(value))
      if (receivedDone) break
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    if (e instanceof ApiError) throw e
    const runtimeError = e as AiRuntimeError
    if (runtimeError.isLocalized || runtimeError.recoverableDatasource) throw e
    throw new Error(t('recon.errors.AI_RESPONSE_INVALID'))
  } finally {
    reader.releaseLock?.()
  }
  return receivedDone
}

function onPageLeave() {
  const run = activeRun
  if (run) fireCancel(run.correlationId)
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

      <div v-if="!datasetReady" class="ai-dataset-status" data-test="ai-dataset-status">
        <span v-if="!datasetError" class="stream-spinner" aria-hidden="true"></span>
        <span :class="{ 'ai-dataset-error': !!datasetError }">{{ datasetMessage }}</span>
      </div>

      <div v-if="error" class="ai-error" data-test="ai-error">
        <p class="error">{{ error }}</p>
        <div v-if="errorId" class="ai-error-id">
          <span>{{ $t('errors.diagnostic_id', { id: errorId }) }}</span>
          <button type="button" class="btn-sm" @click="copyErrorId">
            {{ copiedErrorId ? $t('errors.diagnostic_id_copied') : $t('errors.copy_diagnostic_id') }}
          </button>
        </div>
      </div>

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
.ai-dataset-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0;
  font-size: .9rem;
  color: var(--text-label);
}
.ai-dataset-status .ai-dataset-error { color: var(--error); }
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
@keyframes stream-spin { to { transform: rotate(360deg); } }
.stream-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  max-height: 320px;
  overflow-y: auto;
  word-break: break-word;
}
.ai-error-id {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: .82rem;
}
</style>
