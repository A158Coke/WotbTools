<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  job: { type: Object, default: null },
  error: { type: String, default: '' }
})
const emit = defineEmits(['cancel', 'download', 'dismiss'])

const { t } = useI18n()

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
    default: return t('replay.export_job.phase_processing')
  }
})

const validCount = computed(() => {
  const j = props.job
  if (!j) return 0
  return Math.max(0, (j.processed || 0) - (j.duplicates || 0) - (j.failures || 0))
})

const failedKey = computed(() => props.job?.errorCode === 'NO_VALID_REPLAYS'
  ? 'replay.export_job.failed_no_valid' : 'replay.export_job.failed_generic')
</script>

<template>
  <div v-if="job" class="export-task-card" role="status" data-testid="export-task-card">
    <template v-if="job.status === 'QUEUED'">
      <div class="etc-title">{{ $t('replay.export_job.queued') }}</div>
      <div class="etc-sub">{{ $t('replay.export_job.preparing', { total: job.total }) }}</div>
      <button class="etc-btn" @click="$emit('cancel')">{{ $t('replay.export_job.cancel') }}</button>
    </template>

    <template v-else-if="job.status === 'PROCESSING'">
      <div class="etc-title">{{ $t('replay.export_job.title') }}</div>
      <div class="etc-progress-line">
        {{ $t('replay.export_job.progress', { processed: job.processed, total: job.total }) }}
      </div>
      <div class="etc-bar" data-testid="etc-bar">
        <div class="etc-bar-fill" :style="{ width: percent + '%' }" data-testid="etc-bar-fill"></div>
      </div>
      <div class="etc-sub">{{ phaseLabel }}</div>
      <div v-if="(job.duplicates || 0) + (job.failures || 0) > 0" class="etc-counts">
        {{ $t('replay.export_job.duplicates_failures', { d: job.duplicates || 0, f: job.failures || 0 }) }}
      </div>
      <button class="etc-btn" @click="$emit('cancel')">{{ $t('replay.export_job.cancel') }}</button>
    </template>

    <template v-else-if="job.status === 'READY'">
      <div class="etc-title etc-ok">✓ {{ $t('replay.export_job.ready') }}</div>
      <div class="etc-sub">{{
        $t('replay.export_job.valid_summary', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
      }}</div>
      <div class="etc-actions">
        <button class="etc-btn primary" @click="$emit('download')">{{ $t('replay.export_job.download') }}</button>
        <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
      </div>
    </template>

    <template v-else-if="job.status === 'FAILED'">
      <div class="etc-title etc-err">✕ {{ $t('replay.export_job.failed') }}</div>
      <div class="etc-sub">{{ $t(failedKey) }}</div>
      <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
    </template>

    <template v-else>
      <div class="etc-title">{{ $t('replay.export_job.cancelled') }}</div>
      <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
    </template>

    <div v-if="error" class="etc-error" data-testid="etc-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.export-task-card {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 300px;
  z-index: 1000;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border, #dee2e6);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  font-size: 13px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.etc-title { font-weight: 700; }
.etc-ok { color: #28a745; }
.etc-err { color: #dc3545; }
.etc-sub { color: var(--text-sub, #666); }
.etc-counts { color: #c97a00; font-size: 12px; }
.etc-error { color: #dc3545; font-size: 12px; }
.etc-progress-line { font-variant-numeric: tabular-nums; }
.etc-bar {
  height: 8px;
  background: var(--border, #e9ecef);
  border-radius: 4px;
  overflow: hidden;
}
.etc-bar-fill {
  height: 100%;
  background: #4c8dff;
  border-radius: 4px;
  transition: width 0.3s ease;
}
.etc-actions { display: flex; gap: 8px; }
.etc-btn {
  align-self: flex-start;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border, #ced4da);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}
.etc-btn.primary {
  background: #4c8dff;
  border-color: #4c8dff;
  color: #fff;
  font-weight: 600;
}
</style>
