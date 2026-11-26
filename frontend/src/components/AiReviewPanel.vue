<script setup lang="ts">
import { showToast } from '../composables/useToast.js'
import { notify } from '../composables/useNotifications.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
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
  file: { type: Object, default: null },
  projection: { type: Object as () => AiReviewProjection | null, default: null },
  projectionError: { type: String, default: '' },
  canViewIn2d: { type: Boolean, default: false },
})

const emit = defineEmits(['rebuild-projection', 'view-2d'])

const { t, te, locale } = useI18n()
const auth = useAuth() as AiPanelAuth
const { availability, requireFeature, connectivity } = useFeatureGate()
const { tokenParsed } = auth

const canUseAiReview = computed(() => {
  const roles = tokenParsed.value?.realm_access?.roles
  return Array.isArray(roles) && (
    roles.includes('wotbtools-user') || roles.includes('wotbtools-admin')
  )
})

const projectionReady = computed(() => !!props.projection)
const projectionMessage = computed(() =>
  props.projectionError || t('workspace.dataset_preparing'))

const failure = ref<AiFailure | null>(null)
const copiedErrorId = ref(false)
const analyzing = ref(false)
const analysisResult = ref<AiReviewResult | null>(null)
const analysisCapability = computed<AiReviewCapability | null>(() => analysisResult.value?.capability || null)
const limitedTimelineNote = computed(() =>
  analysisCapability.value === 'AVAILABLE_WITH_LIMITED_TIMELINE'
    ? t('recon.capability_limited')
    : '')

const progressStage = ref('')
const partialAnalysis = ref('')

const AI_ANALYZE_TIMEOUT_MS = 1_100_000
const NOT_RETRYABLE: ReadonlySet<AiFailureKind> = new Set<AiFailureKind>(['not_configured', 'cancelled'])
const canRetry = computed(() => !!failure.value && !NOT_RETRYABLE.has(failure.value.kind))

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

function fireCancel(correlationId: string) {
  if (!correlationId || !availability(Feature.AI_REVIEW).available) return
  cancelAiReview(auth, correlationId).catch(() => {})
}

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

watch(connectivity, () => {
  if (!availability(Feature.AI_REVIEW).available) cancelRun(activeRun)
})

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

function classify(e: unknown, run: AiReviewRunState): AiFailure {
  const normalized = normalizeApiError(e)
  const code = normalized.code || ''
  const id = normalized.id || normalized.traceId || ''
  const known = (kind: AiFailureKind, key: string): AiFailure =>
    ({ kind, code, id, message: t(key) })

  if (run.cancelRequested) return { kind: 'cancelled', code, id, message: t('recon.cancelled') }
  if (run.timedOut || code === 'AI_TIMEOUT') return known('timeout', 'recon.errors.AI_TIMEOUT')
  if (code === 'AI_REVIEW_BUSY') return known('busy', 'recon.errors.AI_REVIEW_BUSY')
  if (code === 'AI_NOT_CONFIGURED') return known('not_configured', 'recon.errors.AI_NOT_CONFIGURED')
  if (code === 'AI_EMPTY_RESPONSE') return known('malformed', 'recon.errors.AI_EMPTY_RESPONSE')
  if (code === 'AI_RESPONSE_INVALID') return known('malformed', 'recon.errors.AI_RESPONSE_INVALID')
  if (code === 'AI_REVIEW_SCHEMA_FAILED' || code === 'AI_REVIEW_GROUNDING_FAILED') {
    return known('malformed', `recon.errors.${code}`)
  }
  if (e instanceof ApiError) {
    const hasLocaleLabel = te(`recon.errors.${code}`) || te(`errors.${code.toLowerCase()}`)
      || te(`api_errors.${code}`)
    if (hasLocaleLabel) return { kind: 'upstream', code, id, message: apiErrorLabel(t, te, normalized) }
  }
  if (code === 'NETWORK_ERROR' || normalized.status === 502 || normalized.status === 504) {
    return known('upstream', 'recon.errors.AI_UPSTREAM_UNAVAILABLE')
  }
  console.warn('[ai-review] unclassified failure', e)
  return known('client', 'recon.errors.AI_CLIENT_ERROR')
}

async function runAnalyze() {
  if (!requireFeature(Feature.AI_REVIEW)) return
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
async function readAnalyzeStream(r: Response, run: AiReviewRunState) {
  const reader = r.body!.getReader()
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
        showToast({ id: 'ai-review', tone: 'success', titleKey: 'notifications.aiReview' })
        notify({ kind: 'ai-review', titleKey: 'notifications.aiReview', view: 'ai-review' })
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
    if (e && (e as Error).name === 'AbortError') throw e
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

defineExpose({ __classify: classify })
</script>

<template>
  <div class="ai-review-panel">
    <p v-if="!file && !projectionReady" class="ws-note">{{ $t('workspace.ai_empty') }}</p>
    <template v-else>
      <Banner v-if="!canUseAiReview" tone="warning" data-testid="ai-permission-required">
        <p>{{ $t('recon.permission_missing') }}</p>
      </Banner>
      <div v-else class="ai-action-row" data-tour="ai-review-start">
        <ReplayAnalysisAction :analyzing="analyzing" :disabled="!projectionReady" @analyze="runAnalyze" @cancel="cancelAnalyze" />
      </div>

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
      <div v-if="partialAnalysis && !analysisResult" class="ai-stream-text" data-testid="ai-partial">
        <p v-if="failure" class="ai-partial-note">{{ $t('recon.partial_incomplete') }}</p>
        {{ partialAnalysis }}
      </div>

      <AnalysisResultPanel v-if="analysisResult" data-tour="ai-review-report" :result="analysisResult" :can-view-in2d="canViewIn2d" @view-2d="sec => emit('view-2d', sec)" />
      <Banner v-if="limitedTimelineNote" tone="warning" data-test="ai-capability-limited">
        <p>{{ limitedTimelineNote }}</p>
      </Banner>
    </template>
  </div>
</template>

<style scoped src="./ai-review-panel.css"></style>
