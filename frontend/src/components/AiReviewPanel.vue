<!--
  AI 复盘能力面板：SSE 分析流（call1/evidence/call2）+ 流式进度 + 结果面板。
  不负责页面级登录门禁/自动跳转（由宿主入口把关）。HTTP endpoint / auth / canonical
  error handling 由 api/ai-review.ts 统一拥有；本组件只编排 run lifecycle 与 SSE 展示状态。
  输入是 client canonical AI projection（battle + projection，replay-local/ai），不是完整回放。

  失败态（design-language §10：永远不能静默失败，必须说明发生了什么 + 下一步）：
  登录/权限、AI 服务不可达、服务繁忙、超时、Provider 失败、返回格式异常、已取消 —— 各自独立归类，
  可重试的给「重试」，取消之类的非错误只给中性提示，不渲染成 danger。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth.js'
import { buildAiReviewRequest, cancelAiReview, openAiReviewStream } from '../api/ai-review.js'
import type { ReplayAuthSession } from '../api/replay-capabilities.js'
import { toAiReviewLocale } from '../types/ai-review.js'
import { apiErrorLabel } from '../utils/display.js'
import { ApiError, normalizeApiError } from '../utils/http.js'
import type {
  AiFailure,
  AiFailureKind,
  AiReviewCapability,
  AiReviewEvent,
  AiReviewProjection,
  AiReviewResult,
  AiReviewRunState,
} from '../types/ai-review.js'
import { createAiReviewSseParser } from '../utils/aiReviewSse.js'
import AnalysisResultPanel from './AnalysisResultPanel.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import ReplayAnalysisAction from './ReplayAnalysisAction.vue'

type AuthTokenParsed = { realm_access?: { roles?: unknown } } | null
type AiRuntimeError = Error & { isLocalized?: boolean }
type AiPanelAuth = ReplayAuthSession & { tokenParsed: { value: AuthTokenParsed } }

const props = defineProps({
  /** 目标回放文件（null = 尚未选择，显示空态提示）。 */
  file: { type: Object, default: null },
  /** 客户端 AI 输入（battle + canonical projection）：由本地解析层产出；null = 尚未就绪。 */
  projection: { type: Object as () => AiReviewProjection | null, default: null },
  /** 投影准备失败时的已本地化错误；空 = 无。 */
  projectionError: { type: String, default: '' }
})

const emit = defineEmits(['rebuild-projection'])

const { t, te, locale } = useI18n()
const auth = useAuth() as AiPanelAuth
const { tokenParsed } = auth

// AI Review 权限：已登录 + wotbtools-user 或 wotbtools-admin。
// 登录成功不等于授权成功——realm role 缺失必须是**显式权限态**，不能静默隐藏入口。
const canUseAiReview = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (
    roles.includes('wotbtools-user') || roles.includes('wotbtools-admin')
  )
})

/**
 * 投影就绪守卫（defense-in-depth）：AI Analyze 只有在客户端投影
 * （battle + canonical projection）已绑定时才能执行。
 * file 已选但投影缺失 = 本地解析/投影未完成（状态机问题），不是用户错误。
 */
const projectionReady = computed(() => !!props.projection)
/** 投影准备中/失败的用户可读文案（本地解析生命周期，非 AI 模型错误）。 */
const projectionMessage = computed(() =>
  props.projectionError || t('workspace.dataset_preparing'))

const failure = ref<AiFailure | null>(null)
const copiedErrorId = ref(false)
const analyzing = ref(false)
const analysisResult = ref<AiReviewResult | null>(null)
/** AI 复盘 capability（AiReviewDonePayload.capability：AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE）。 */
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
/** 确定性 / 非错误失败不给重试按钮：点了也没用，或用户本来就主动取消过。 */
const NOT_RETRYABLE: ReadonlySet<AiFailureKind> = new Set<AiFailureKind>(['not_configured', 'cancelled'])
const canRetry = computed(() => !!failure.value && !NOT_RETRYABLE.has(failure.value.kind))

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

watch(() => [props.file, props.projection], () => {
  const oldRun = activeRun
  if (oldRun) cancelRun(oldRun)
  activeRun = null
  analyzing.value = false
  resetResults()
  failure.value = null
  copiedErrorId.value = false
})

async function copyErrorId() {
  const id = failure.value?.id
  if (!id || typeof navigator === 'undefined' || !navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(id)
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

function analyzeRequest(correlationId: string) {
  if (!props.projection) {
    throw new Error(t('recon.errors.DATASET_REFERENCE_REQUIRED'))
  }
  return buildAiReviewRequest({
    battle: props.projection.battle,
    projection: props.projection.projection,
    locale: toAiReviewLocale(locale.value),
    correlationId,
  })
}

/**
 * 失败归类：稳定错误码（服务端契约）→ 用户可读文案 + 是否给重试动作。
 *
 * 服务端未给 errorCode 的形态（网关 5xx HTML、断流、网络失败）按 status / 异常兜底，
 * 不允许落回无信息的「未知错误」。
 */
function classify(e: unknown, run: AiReviewRunState): AiFailure {
  const normalized = normalizeApiError(e)
  const code = normalized.code || ''
  const id = normalized.id || normalized.traceId || ''
  const known = (kind: AiFailureKind, key: string): AiFailure =>
    ({ kind, code, id, message: t(key) })

  if (run.cancelRequested) return { kind: 'cancelled', code, id, message: t('recon.cancelled') }
  if (run.timedOut || code === 'AI_TIMEOUT') return known('timeout', 'recon.errors.AI_TIMEOUT')
  // 确定性分类只在服务端给了明确语义时覆盖 canonical label；status 兜底交给 apiErrorLabel，
  // 避免把「后端说禁止」误写成「你的账号没有权限」这类我们其实不知道的结论。
  if (code === 'AI_REVIEW_BUSY') return known('busy', 'recon.errors.AI_REVIEW_BUSY')
  if (code === 'AI_NOT_CONFIGURED') return known('not_configured', 'recon.errors.AI_NOT_CONFIGURED')
  if (code === 'AI_EMPTY_RESPONSE') return known('malformed', 'recon.errors.AI_EMPTY_RESPONSE')
  if (code === 'AI_RESPONSE_INVALID') return known('malformed', 'recon.errors.AI_RESPONSE_INVALID')
  if (code === 'AI_REVIEW_SCHEMA_FAILED' || code === 'AI_REVIEW_GROUNDING_FAILED') {
    return known('malformed', `recon.errors.${code}`)
  }
  if (e instanceof ApiError) {
    // 服务端给了契约错误码且 i18n 有对应文案（含 `errors.<code 小写>` 约定）：沿用 canonical label
    // （保留 errorCode → 文案的稳定映射与诊断 ID）；只有文案缺失时才退到通用归类。
    const hasLocaleLabel = te(`recon.errors.${code}`) || te(`errors.${code.toLowerCase()}`)
      || te(`api_errors.${code}`)
    if (hasLocaleLabel) return { kind: 'upstream', code, id, message: apiErrorLabel(t, te, normalized) }
  }
  if (code === 'NETWORK_ERROR' || normalized.status === 502 || normalized.status === 504) {
    return known('upstream', 'recon.errors.AI_UPSTREAM_UNAVAILABLE')
  }
  // 兜底：原始运行时异常（`TypeError: Failed to fetch` 之类）只进 console 与诊断日志，
  // 绝不作为面向用户的文案——用户看不懂，也无法据此行动。
  console.warn('[ai-review] unclassified failure', e)
  return known('client', 'recon.errors.AI_CLIENT_ERROR')
}

async function runAnalyze() {
  if (analyzing.value) return
  if (!projectionReady.value) return
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
  failure.value = null
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
      // 断流（响应 200 但从未给 done）不是网络失败，是契约不满足：必须归到「返回格式异常」。
      throw new ApiError({
        errorCode: 'AI_RESPONSE_INVALID',
        status: 200,
        id: run.correlationId,
        retryable: true,
      })
    }
  } catch (e) {
    if (activeRun !== run) return
    failure.value = classify(e, run)
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
    if (runtimeError.isLocalized) throw e
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

/** 测试入口（Vue Test Utils 约定的 `__` 前缀）：兜底分类必须可被直接覆盖。 */
defineExpose({ __classify: classify })
</script>

<template>
  <div class="ai-review-panel">
    <p v-if="!file && !projectionReady" class="ws-note">{{ $t('workspace.ai_empty') }}</p>
    <template v-else>
      <!-- 已登录但缺 realm role：显式权限态，不静默隐藏入口（design-language §10「权限」）。 -->
      <Banner v-if="!canUseAiReview" tone="warning" data-testid="ai-permission-required">
        <p>{{ $t('recon.permission_missing') }}</p>
      </Banner>
      <div v-else class="ai-action-row">
        <ReplayAnalysisAction :analyzing="analyzing" :disabled="!projectionReady" @analyze="runAnalyze" @cancel="cancelAnalyze" />
      </div>

      <!-- 本地 AI 输入准备：准备中为 info，失败为 danger（本地解析生命周期，不是模型错误）。
           权限缺失时也渲染：否则「什么都没发生」无法归因。 -->
      <Banner
        v-if="!projectionReady"
        :tone="projectionError ? 'danger' : 'info'"
        data-test="ai-projection-status"
      >
        <p class="ai-projection-message">{{ projectionMessage }}</p>
        <template v-if="projectionError" #actions>
          <AppButton size="sm" variant="ghost" data-testid="ai-projection-retry" @click="emit('rebuild-projection')">
            {{ $t('workspace.pane_retry') }}
          </AppButton>
        </template>
      </Banner>

      <Banner
        v-if="failure"
        :tone="failure.kind === 'cancelled' ? 'info' : 'danger'"
        data-test="ai-error"
      >
        <p class="ai-failure-message">{{ failure.message }}</p>
        <p v-if="failure.kind === 'upstream' || failure.kind === 'busy'" class="ai-failure-hint">
          {{ $t('recon.failure_scope_note') }}
        </p>
        <div v-if="failure.id" class="ai-failure-id">
          <span>{{ $t('errors.diagnostic_id', { id: failure.id }) }}</span>
          <button type="button" class="ai-failure-copy" @click="copyErrorId">
            {{ copiedErrorId ? $t('errors.diagnostic_id_copied') : $t('errors.copy_diagnostic_id') }}
          </button>
        </div>
        <template v-if="canRetry" #actions>
          <AppButton size="sm" data-testid="ai-retry" @click="runAnalyze">{{ $t('workspace.pane_retry') }}</AppButton>
        </template>
      </Banner>

      <div v-if="analyzing" class="ai-streaming" data-testid="ai-streaming">
        <div class="ai-stream-status">
          <span class="stream-spinner" aria-hidden="true"></span>
          <span>{{ $t(`recon.stages.${progressStage || 'call1'}`) }}</span>
        </div>
      </div>
      <!-- 断流/失败时已到达的正文不丢弃：明确标注不完整，用户仍可读已生成部分。 -->
      <div v-if="partialAnalysis" class="ai-stream-text" data-testid="ai-partial">
        <p v-if="failure" class="ai-partial-note">{{ $t('recon.partial_incomplete') }}</p>
        {{ partialAnalysis }}
      </div>

      <AnalysisResultPanel v-if="analysisResult" :result="analysisResult" />
      <Banner v-if="limitedTimelineNote" tone="warning" data-test="ai-capability-limited">
        <p>{{ limitedTimelineNote }}</p>
      </Banner>
    </template>
  </div>
</template>

<style scoped>
.ai-review-panel {
  width: min(1100px, 100%);
  margin-inline: auto;
}
.ai-action-row {
  display: flex;
  align-items: center;
  margin-block: var(--space-4);
}
.ws-note {
  margin: var(--space-4) var(--space-1);
  color: var(--color-text-secondary);
  font: var(--type-body);
}
.ai-projection-message { font: var(--type-body); }
.ai-failure-message { font: var(--type-body); }
.ai-failure-hint { color: var(--color-text-secondary); font: var(--type-caption); }
.ai-failure-id {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
}
.ai-failure-copy {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  cursor: pointer;
}
.ai-streaming { margin-top: var(--space-4); }
.ai-stream-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
}
.stream-spinner {
  width: var(--space-3);
  height: var(--space-3);
  border: 2px solid var(--color-border-subtle);
  border-top-color: var(--color-accent);
  border-radius: var(--radius-full);
  animation: stream-spin 0.9s linear infinite;
  flex-shrink: 0;
}
@keyframes stream-spin { to { transform: rotate(360deg); } }
.ai-stream-text {
  margin-top: var(--space-3);
  max-height: 320px;
  overflow-y: auto;
  color: var(--color-text-primary);
  font: var(--type-body);
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-partial-note { color: var(--color-text-secondary); font: var(--type-caption); }
</style>
