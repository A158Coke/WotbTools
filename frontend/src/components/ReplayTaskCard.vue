<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorLabel } from '../utils/display.js'
import { normalizeJobError } from '../utils/http.js'
import { CircleAlert, CircleCheck } from 'lucide-vue-next'
import AppButton from './AppButton.vue'

/**
 * 统一 Replay Task Card（Processing 与 Export 共用同一视觉体系）。
 * kind=processing → 正在解析回放（真实 processed/total + currentFile + valid/dup/fail）；
 * kind=export → 正在生成 Excel / ZIP。状态：QUEUED / PROCESSING / READY / FAILED / CANCELLED。
 */
const props = defineProps({
  job: { type: Object, default: null },
  error: { type: String, default: '' },
  kind: { type: String, default: 'export' } // 'processing' | 'export'
})
const emit = defineEmits(['cancel', 'download', 'dismiss'])

const { t, te } = useI18n()
const isProcessing = computed(() => props.kind === 'processing')

const percent = computed(() => {
  const total = props.job?.total || 0
  const processed = props.job?.processed || 0
  return total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
})

const phaseLabel = computed(() => {
  switch (props.job?.phase) {
    case 'PROCESSING_REPLAYS': return t('replay.export_job.phase_processing')
    case 'BUILDING_EXCEL': return t('replay.export_job.phase_excel')
    case 'BUILDING_ARCHIVE': return t('replay.export_job.phase_archive')
    default: return isProcessing.value ? t('replay.processing_job.title') : t('replay.export_job.phase_processing')
  }
})

const validCount = computed(() => {
  const j = props.job
  if (!j) return 0
  if (typeof j.valid === 'number') return j.valid
  return Math.max(0, (j.processed || 0) - (j.duplicates || 0) - (j.failures || 0))
})

const failedLabel = computed(() => apiErrorLabel(t, te, normalizeJobError(props.job)))

const hasCounts = computed(() => (props.job?.duplicates || 0) + (props.job?.failures || 0) > 0
  || (isProcessing.value && validCount.value > 0))
</script>

<template>
  <div v-if="job" class="replay-task-card" role="status" data-testid="replay-task-card">
    <template v-if="job.status === 'QUEUED'">
      <div class="etc-title">{{ isProcessing ? $t('replay.processing_job.queued') : $t('replay.export_job.queued') }}</div>
      <div class="etc-sub">{{ isProcessing
        ? $t('replay.processing_job.preparing', { total: job.total })
        : $t('replay.export_job.preparing', { total: job.total }) }}</div>
      <AppButton size="sm" class="etc-btn" @click="$emit('cancel')">{{ $t('replay.export_job.cancel') }}</AppButton>
    </template>

    <template v-else-if="job.status === 'PROCESSING'">
      <div class="etc-title">{{ isProcessing ? $t('replay.processing_job.title') : $t('replay.export_job.title') }}</div>
      <div class="etc-progress-line">
        {{ isProcessing
          ? $t('replay.processing_job.progress', { processed: job.processed, total: job.total })
          : $t('replay.export_job.progress', { processed: job.processed, total: job.total }) }}
      </div>
      <div class="etc-bar task-bar" data-testid="etc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent">
        <div class="etc-bar-fill task-bar-fill" :style="{ width: percent + '%' }" data-testid="etc-bar-fill"></div>
      </div>
      <div class="etc-sub">{{ isProcessing && job.currentFile
        ? $t('replay.processing_job.current_file', { file: job.currentFile })
        : phaseLabel }}</div>
      <div v-if="hasCounts" class="etc-counts">
        {{ isProcessing
          ? $t('replay.processing_job.counts', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
          : $t('replay.export_job.duplicates_failures', { d: job.duplicates || 0, f: job.failures || 0 }) }}
      </div>
      <AppButton size="sm" class="etc-btn" @click="$emit('cancel')">{{ $t('replay.export_job.cancel') }}</AppButton>
    </template>

    <template v-else-if="job.status === 'READY'">
      <div class="etc-title etc-ok"><CircleCheck :size="16" aria-hidden="true" />{{ isProcessing ? $t('replay.processing_job.ready') : $t('replay.export_job.ready') }}</div>
      <div class="etc-sub">{{
        isProcessing
          ? $t('replay.processing_job.counts', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
          : $t('replay.export_job.valid_summary', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
      }}</div>
      <div class="etc-actions">
        <template v-if="isProcessing">
          <AppButton size="sm" class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</AppButton>
        </template>
        <template v-else>
          <AppButton variant="primary" size="sm" @click="$emit('download')">{{ $t('replay.export_job.download') }}</AppButton>
          <AppButton size="sm" class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</AppButton>
        </template>
      </div>
    </template>

    <template v-else-if="job.status === 'FAILED'">
      <div class="etc-title etc-err"><CircleAlert :size="16" aria-hidden="true" />{{ isProcessing ? $t('replay.processing_job.failed') : $t('replay.export_job.failed') }}</div>
      <div class="etc-sub">{{ failedLabel }}</div>
      <AppButton size="sm" class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</AppButton>
    </template>

    <template v-else>
      <div class="etc-title">{{ isProcessing ? $t('replay.processing_job.cancelled') : $t('replay.export_job.cancelled') }}</div>
      <AppButton size="sm" class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</AppButton>
    </template>

    <div v-if="error" class="etc-error" data-testid="etc-error">{{ error }}</div>
  </div>
</template>

<style scoped>
/* 导出 / 后台任务的浮动卡：桌面右下角；手机贴在底部 Tab 栏上方、左右留出 gutter。 */
.replay-task-card {
  position: fixed;
  right: var(--gutter);
  bottom: var(--space-4);
  z-index: var(--z-toast);
  display: grid;
  gap: var(--space-2);
  width: 320px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-3);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.etc-title { display: inline-flex; align-items: center; gap: var(--space-2); font-weight: 600; }
.etc-ok { color: var(--color-success); }
.etc-err { color: var(--color-danger); }
.etc-sub { color: var(--color-text-secondary); overflow-wrap: anywhere; }
.etc-counts,
.etc-error { font: var(--type-caption); }
.etc-counts { color: var(--color-text-secondary); }
.etc-error { color: var(--color-danger); }
.etc-progress-line { font-variant-numeric: tabular-nums; }

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

.etc-actions { display: flex; gap: var(--space-2); }
.etc-btn { justify-self: start; }

@media (width < 768px) {
  .replay-task-card {
    right: var(--gutter);
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--space-3));
    left: var(--gutter);
    width: auto;
  }
}
</style>
