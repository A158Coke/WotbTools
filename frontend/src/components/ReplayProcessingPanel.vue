<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorLabel } from '../utils/display.js'
import { normalizeJobError } from '../utils/http.js'
import { CircleAlert, CircleCheck } from 'lucide-vue-next'
import AppButton from './AppButton.vue'

/**
 * Replay Processing 主操作区进度面板：真实分阶段
 * UPLOADING → REGISTERING → QUEUED → PROCESSING → FINALIZING → READY|FAILED|CANCELLED。
 * 替代旧的 fixed toast（与 Export 任务卡不再互斥）。
 */
const props = defineProps({
  /** 上传阶段本地状态（null = 无上传）。 */
  uploadState: { type: Object, default: null },
  /** Processing Job 轮询状态（null = 未创建）。 */
  job: { type: Object, default: null },
  error: { type: String, default: '' }
})

const emit = defineEmits(['cancel', 'dismiss'])

const { t, te } = useI18n()

const uiState = computed(() => {
  if (props.uploadState) return props.uploadState.phase
  const j = props.job
  if (!j) return null
  if (j.status === 'PROCESSING') return j.phase === 'FINALIZING_BATCH' ? 'FINALIZING' : 'PROCESSING'
  return j.status
})

const percent = computed(() => {
  if (props.uploadState) return props.uploadState.percent || 0
  const total = props.job?.total || 0
  const parsed = props.job?.parseCompleted ?? props.job?.processed ?? 0
  return total > 0 ? Math.min(100, Math.round((parsed / total) * 100)) : 0
})

const parseCount = computed(() => props.job?.parseCompleted ?? props.job?.processed ?? 0)
const parseSucceeded = computed(() => props.job?.parseSucceeded ?? 0)
const parseFailed = computed(() => props.job?.parseFailed ?? 0)

const canCancel = computed(() =>
  ['UPLOADING', 'REGISTERING', 'QUEUED', 'PROCESSING', 'FINALIZING'].includes(uiState.value))

const canDismiss = computed(() => ['READY', 'FAILED', 'CANCELLED'].includes(uiState.value))

const failedLabel = computed(() => apiErrorLabel(t, te, normalizeJobError(props.job)))

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}
</script>

<template>
  <div v-if="uiState" class="replay-processing-panel" role="status" data-testid="replay-processing-panel"
       :class="{ 'rpp-compact': uiState === 'READY' }">
    <!-- 上传：真实 bytes / percent -->
    <template v-if="uiState === 'UPLOADING'">
      <div class="rpp-title">{{ $t('replay.processing_job.uploading') }}</div>
      <div class="rpp-progress-line" data-testid="upload-progress">
        {{ $t('replay.processing_job.uploading_progress', {
          loaded: formatBytes(uploadState.loaded),
          total: formatBytes(uploadState.total)
        }) }} · {{ uploadState.percent || 0 }}%
      </div>
      <div class="rpp-bar task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="uploadState.percent || 0"><div class="rpp-bar-fill task-bar-fill" :style="{ width: (uploadState.percent || 0) + '%' }"></div></div>
    </template>

    <!-- 上传完成、202 未返回 -->
    <template v-else-if="uiState === 'REGISTERING'">
      <div class="rpp-title">{{ $t('replay.processing_job.registering') }}</div>
      <div class="rpp-bar task-bar rpp-indeterminate" role="progressbar"><div class="rpp-bar-fill task-bar-fill"></div></div>
    </template>

    <!-- 等待解析资源 -->
    <template v-else-if="uiState === 'QUEUED'">
      <div class="rpp-title">{{ $t('replay.processing_job.queued') }}</div>
      <div class="rpp-sub">{{ $t('replay.processing_job.queued_total', { total: job?.total || 0 }) }}</div>
    </template>

    <!-- 解析中：真实 parseCompleted/total（不假装包含 finalize） -->
    <template v-else-if="uiState === 'PROCESSING'">
      <div class="rpp-title">{{ $t('replay.processing_job.title') }}</div>
      <div class="rpp-progress-line">
        {{ $t('replay.processing_job.progress', { processed: parseCount, total: job?.total || 0 }) }} · {{ percent }}%
      </div>
      <div class="rpp-bar task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent"><div class="rpp-bar-fill task-bar-fill" :style="{ width: percent + '%' }"></div></div>
      <div v-if="job?.activeSources?.length" class="rpp-sub" data-testid="active-sources">
        {{ $t('replay.processing_job.active_sources', { count: job.activeSources.length }) }}
        <ul class="rpp-sources">
          <li v-for="s in job.activeSources" :key="s.sourceId">{{ s.displayName }}</li>
        </ul>
      </div>
      <div v-else-if="job?.currentFile" class="rpp-sub">
        {{ $t('replay.processing_job.current_file', { file: job.currentFile }) }}
      </div>
      <div class="rpp-counts">
        {{ $t('replay.processing_job.counts', { v: parseSucceeded, f: parseFailed }) }}
      </div>
    </template>

    <!-- 整理结果：indeterminate（去重 / League / Rating / 汇总） -->
    <template v-else-if="uiState === 'FINALIZING'">
      <div class="rpp-title">{{ $t('replay.processing_job.finalizing') }}</div>
      <div class="rpp-sub">{{ $t('replay.processing_job.finalizing_detail') }}</div>
      <div class="rpp-bar task-bar rpp-indeterminate" role="progressbar"><div class="rpp-bar-fill task-bar-fill"></div></div>
    </template>

    <!-- 终态 -->
    <template v-else-if="uiState === 'READY'">
      <div class="rpp-ready-inline rpp-ok" data-testid="processing-ready">
        <CircleCheck :size="16" aria-hidden="true" />{{ $t('replay.processing_job.ready') }}
        <span class="rpp-ready-detail">
          {{ $t('replay.processing_job.valid_summary', {
            v: job?.valid || 0, d: job?.duplicates || 0, f: job?.failures || 0
          }) }}
        </span>
      </div>
    </template>
    <template v-else-if="uiState === 'FAILED'">
      <div class="rpp-title rpp-err"><CircleAlert :size="16" aria-hidden="true" />{{ $t('replay.processing_job.failed') }}</div>
      <div class="rpp-sub">{{ failedLabel }}</div>
    </template>
    <template v-else-if="uiState === 'CANCELLED'">
      <div class="rpp-title">{{ $t('replay.processing_job.cancelled') }}</div>
    </template>

    <div class="rpp-actions">
      <AppButton v-if="canCancel" size="sm" data-testid="processing-cancel" @click="$emit('cancel')">
        {{ $t('replay.export_job.cancel') }}
      </AppButton>
      <AppButton v-if="canDismiss" variant="ghost" size="sm" data-testid="processing-dismiss" @click="$emit('dismiss')">
        {{ $t('replay.export_job.dismiss') }}
      </AppButton>
    </div>

    <div v-if="error" class="rpp-error" data-testid="processing-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.replay-processing-panel {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}

/* READY 后收起为一行状态（不长期占一张大卡） */
.rpp-compact { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); padding: var(--space-2) var(--space-3); }

.rpp-title { display: inline-flex; align-items: center; gap: var(--space-2); font-weight: 600; }
.rpp-ok { color: var(--color-success); }
.rpp-err { color: var(--color-danger); }
.rpp-sub { color: var(--color-text-secondary); overflow-wrap: anywhere; }
.rpp-ready-inline { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); font-weight: 600; }
.rpp-ready-detail { color: var(--color-text-secondary); font: var(--type-caption); }
.rpp-counts { color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }
.rpp-sources { margin: var(--space-1) 0 0; padding-inline-start: var(--space-5); font: var(--type-caption); }
.rpp-progress-line { font-variant-numeric: tabular-nums; }

.task-bar {
  height: var(--space-2);
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
}

.task-bar-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  transition: width var(--duration-slow) var(--ease-standard);
}

.rpp-indeterminate .task-bar-fill { width: 35%; animation: rpp-slide 1.2s var(--ease-standard) infinite; }

@keyframes rpp-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

@media (prefers-reduced-motion: reduce) {
  .rpp-indeterminate .task-bar-fill { width: 100%; animation: none; opacity: .5; }
}

.rpp-actions { display: flex; gap: var(--space-2); }
.rpp-compact .rpp-actions { margin-inline-start: auto; }
.rpp-error { color: var(--color-danger); font: var(--type-caption); }
</style>
