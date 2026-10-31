<script setup>
import { computed } from 'vue'
import { CircleAlert } from 'lucide-vue-next'
import AppButton from './AppButton.vue'

/**
 * 首次打开回放时的加载与恢复面板。正常路径不留痕迹：成功后内容直接出现，这里不显示。
 * 只有当前选择没有可提交的批次结果才进入失败态，部分失败由工作台的警示条负责。
 */
const props = defineProps({
  /** ReplayAnalysis：{ phase, done, total, failure } */
  analysis: { type: Object, required: true },
  /** 当前列表里的文件数：决定失败时是「从列表移除」还是「清空列表」。 */
  fileCount: { type: Number, default: 1 },
})

defineEmits(['cancel', 'retry', 'open-other', 'clear'])

const phase = computed(() => props.analysis?.phase || 'idle')
const total = computed(() => props.analysis?.total || 0)
const percent = computed(() => (total.value > 0 ? Math.min(100, Math.round(((props.analysis?.done || 0) / total.value) * 100)) : 0))
const failureKey = computed(() => {
  switch (props.analysis?.failure) {
    case 'ENGINE_UNAVAILABLE': return 'replay.analysis.engine_unavailable'
    case 'NO_VALID_REPLAYS': return 'replay.analysis.no_valid_replays'
    default: return 'replay.analysis.failed_unknown'
  }
})
</script>

<template>
  <div v-if="phase === 'parsing' || phase === 'failed'" class="replay-processing-panel" role="status" data-testid="replay-processing-panel">
    <template v-if="phase === 'parsing'">
      <div class="rpp-title">{{ $t('replay.analysis.loading') }}</div>
      <div v-if="total > 1" class="rpp-progress-line" data-testid="analysis-progress">
        {{ $t('replay.analysis.progress', { done: analysis.done, total }) }}
      </div>
      <div class="rpp-bar task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent"><div class="rpp-bar-fill task-bar-fill" :style="{ width: percent + '%' }"></div></div>
      <div class="rpp-actions">
        <AppButton size="sm" data-testid="processing-cancel" @click="$emit('cancel')">{{ $t('replay.analysis.cancel') }}</AppButton>
      </div>
    </template>
    <template v-else>
      <div class="rpp-title rpp-err"><CircleAlert :size="16" aria-hidden="true" />{{ $t('replay.analysis.failed_open') }}</div>
      <div class="rpp-sub" data-testid="analysis-failure">{{ $t(failureKey) }}</div>
      <div class="rpp-actions">
        <AppButton variant="primary" size="sm" data-testid="processing-retry" @click="$emit('retry')">{{ $t('replay.analysis.retry') }}</AppButton>
        <AppButton size="sm" data-testid="processing-open-other" @click="$emit('open-other')">{{ $t('replay.analysis.open_other') }}</AppButton>
        <AppButton variant="ghost" size="sm" data-testid="processing-clear" @click="$emit('clear')">{{ $t(fileCount > 1 ? 'replay.analysis.clear_list' : 'replay.analysis.remove_from_list') }}</AppButton>
      </div>
    </template>
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

.rpp-title { display: inline-flex; align-items: center; gap: var(--space-2); font-weight: 600; }
.rpp-err { color: var(--color-danger); }
.rpp-sub { color: var(--color-text-secondary); overflow-wrap: anywhere; }
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

.rpp-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
