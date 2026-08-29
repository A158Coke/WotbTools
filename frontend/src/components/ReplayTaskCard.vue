<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

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

const { t } = useI18n()
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

const failedKey = computed(() => props.job?.errorCode === 'NO_VALID_REPLAYS'
  ? (isProcessing.value ? 'replay.processing_job.no_valid_replays' : 'replay.export_job.failed_no_valid')
  : (isProcessing.value ? 'replay.processing_job.failed' : 'replay.export_job.failed_generic'))

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
      <button class="etc-btn" @click="$emit('cancel')">{{ $t('replay.export_job.cancel') }}</button>
    </template>

    <template v-else-if="job.status === 'PROCESSING'">
      <div class="etc-title">{{ isProcessing ? $t('replay.processing_job.title') : $t('replay.export_job.title') }}</div>
      <div class="etc-progress-line">
        {{ isProcessing
          ? $t('replay.processing_job.progress', { processed: job.processed, total: job.total })
          : $t('replay.export_job.progress', { processed: job.processed, total: job.total }) }}
      </div>
      <div class="etc-bar" data-testid="etc-bar">
        <div class="etc-bar-fill" :style="{ width: percent + '%' }" data-testid="etc-bar-fill"></div>
      </div>
      <div class="etc-sub">{{ isProcessing && job.currentFile
        ? $t('replay.processing_job.current_file', { file: job.currentFile })
        : phaseLabel }}</div>
      <div v-if="hasCounts" class="etc-counts">
        {{ isProcessing
          ? $t('replay.processing_job.counts', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
          : $t('replay.export_job.duplicates_failures', { d: job.duplicates || 0, f: job.failures || 0 }) }}
      </div>
      <button class="etc-btn" @click="$emit('cancel')">{{ $t('replay.export_job.cancel') }}</button>
    </template>

    <template v-else-if="job.status === 'READY'">
      <div class="etc-title etc-ok">✓ {{ isProcessing ? $t('replay.processing_job.ready') : $t('replay.export_job.ready') }}</div>
      <div class="etc-sub">{{
        isProcessing
          ? $t('replay.processing_job.counts', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
          : $t('replay.export_job.valid_summary', { v: validCount, d: job.duplicates || 0, f: job.failures || 0 })
      }}</div>
      <div class="etc-actions">
        <template v-if="isProcessing">
          <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
        </template>
        <template v-else>
          <button class="etc-btn primary" @click="$emit('download')">{{ $t('replay.export_job.download') }}</button>
          <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
        </template>
      </div>
    </template>

    <template v-else-if="job.status === 'FAILED'">
      <div class="etc-title etc-err">✕ {{ isProcessing ? $t('replay.processing_job.failed') : $t('replay.export_job.failed') }}</div>
      <div class="etc-sub">{{ $t(failedKey) }}</div>
      <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
    </template>

    <template v-else>
      <div class="etc-title">{{ isProcessing ? $t('replay.processing_job.cancelled') : $t('replay.export_job.cancelled') }}</div>
      <button class="etc-btn" @click="$emit('dismiss')">{{ $t('replay.export_job.dismiss') }}</button>
    </template>

    <div v-if="error" class="etc-error" data-testid="etc-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.replay-task-card {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 300px;
  z-index: 1000;
  background: rgba(15,21,25,.97);
  border: 1px solid #39444a;
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .18);
  font-size: 13px;
  line-height: 1.5;
  color: #e9e7e0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.etc-title { font-weight: 700; color: #f2ede3; }
.etc-ok { color: #7fd48a; }
.etc-err { color: #ff8f86; }
.etc-sub { color: #a3a6a0; word-break: break-word; }
.etc-counts { color: #f0a42b; font-size: 12px; }
.etc-error { color: #ff8f86; font-size: 12px; }
.etc-progress-line { font-variant-numeric: tabular-nums; }
.etc-bar {
  height: 8px;
  background: #2b3439;
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
  border: 1px solid #465159;
  background: transparent;
  color: #d7d3ca;
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
