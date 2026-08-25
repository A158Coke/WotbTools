<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * Replay Processing 主操作区进度面板（plan §32/§57）：真实分阶段
 * UPLOADING → REGISTERING → QUEUED → PROCESSING → FINALIZING → READY|FAILED|CANCELLED。
 * 替代旧的 fixed toast（与 Export 任务卡不再互斥，plan §35）。
 */
const props = defineProps({
  /** 上传阶段本地状态（null = 无上传）。 */
  uploadState: { type: Object, default: null },
  /** Processing Job 轮询状态（null = 未创建）。 */
  job: { type: Object, default: null },
  error: { type: String, default: '' }
})

const emit = defineEmits(['cancel', 'dismiss'])

const { t } = useI18n()

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

const failedKey = computed(() => props.job?.errorCode === 'NO_VALID_REPLAYS'
  ? 'replay.processing_job.no_valid_replays'
  : 'replay.processing_job.failed')

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
  <div v-if="uiState" class="replay-processing-panel" role="status" data-testid="replay-processing-panel">
    <!-- 上传：真实 bytes / percent -->
    <template v-if="uiState === 'UPLOADING'">
      <div class="rpp-title">{{ $t('replay.processing_job.uploading') }}</div>
      <div class="rpp-progress-line" data-testid="upload-progress">
        {{ $t('replay.processing_job.uploading_progress', {
          loaded: formatBytes(uploadState.loaded),
          total: formatBytes(uploadState.total)
        }) }} · {{ uploadState.percent || 0 }}%
      </div>
      <div class="rpp-bar"><div class="rpp-bar-fill" :style="{ width: (uploadState.percent || 0) + '%' }"></div></div>
    </template>

    <!-- 上传完成、202 未返回 -->
    <template v-else-if="uiState === 'REGISTERING'">
      <div class="rpp-title">{{ $t('replay.processing_job.registering') }}</div>
      <div class="rpp-bar"><div class="rpp-bar-fill" style="width: 100%"></div></div>
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
      <div class="rpp-bar"><div class="rpp-bar-fill" :style="{ width: percent + '%' }"></div></div>
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
      <div class="rpp-bar rpp-indeterminate"><div class="rpp-bar-fill"></div></div>
    </template>

    <!-- 终态 -->
    <template v-else-if="uiState === 'READY'">
      <div class="rpp-title rpp-ok">✓ {{ $t('replay.processing_job.ready') }}</div>
      <div class="rpp-sub">
        {{ $t('replay.processing_job.valid_summary', {
          v: job?.valid || 0, d: job?.duplicates || 0, f: job?.failures || 0
        }) }}
      </div>
    </template>
    <template v-else-if="uiState === 'FAILED'">
      <div class="rpp-title rpp-err">✕ {{ $t('replay.processing_job.failed') }}</div>
      <div class="rpp-sub">{{ $t(failedKey) }}</div>
    </template>
    <template v-else-if="uiState === 'CANCELLED'">
      <div class="rpp-title">{{ $t('replay.processing_job.cancelled') }}</div>
    </template>

    <div class="rpp-actions">
      <button v-if="canCancel" class="rpp-btn" data-testid="processing-cancel" @click="$emit('cancel')">
        {{ $t('replay.export_job.cancel') }}
      </button>
      <button v-if="canDismiss" class="rpp-btn" data-testid="processing-dismiss" @click="$emit('dismiss')">
        {{ $t('replay.export_job.dismiss') }}
      </button>
    </div>

    <div v-if="error" class="rpp-error" data-testid="processing-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.replay-processing-panel {
  margin: 14px 0;
  padding: 14px 16px;
  border: 1px solid var(--border, #303a40);
  border-radius: 10px;
  background: rgba(13, 18, 22, .94);
  color: #d8d5cd;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rpp-title { font-weight: 700; color: #f2ede3; }
.rpp-ok { color: #7fd48a; }
.rpp-err { color: #ff8f86; }
.rpp-sub { color: #a3a6a0; font-size: .85rem; word-break: break-word; }
.rpp-counts { color: #f0a42b; font-size: .85rem; }
.rpp-sources { margin: 4px 0 0; padding-left: 18px; }
.rpp-sources li { font-size: .82rem; }
.rpp-progress-line { font-variant-numeric: tabular-nums; font-size: .9rem; }
.rpp-bar {
  height: 8px;
  background: #2b3439;
  border-radius: 4px;
  overflow: hidden;
}
.rpp-bar-fill {
  height: 100%;
  background: #4c8dff;
  border-radius: 4px;
  transition: width .3s ease;
}
.rpp-indeterminate .rpp-bar-fill {
  width: 35%;
  animation: rpp-slide 1.2s ease-in-out infinite;
}
@keyframes rpp-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.rpp-actions { display: flex; gap: 8px; }
.rpp-btn {
  align-self: flex-start;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid #465159;
  background: transparent;
  color: #d7d3ca;
  cursor: pointer;
  font-size: 13px;
}
.rpp-btn:hover { border-color: var(--accent, #4c8dff); }
.rpp-error { color: #ff8f86; font-size: 12px; }
</style>
