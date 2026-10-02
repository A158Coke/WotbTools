<script setup>
import { computed } from 'vue'
import { CircleAlert, CircleCheck } from 'lucide-vue-next'
import AppButton from './AppButton.vue'

/**
 * 回放分析进度面板（本机解析）：PARSING（逐文件 done/total）→ READY | FAILED | CANCELLED。
 * 服务器没有 parser：没有上传 / 排队 / 服务端处理阶段。READY 收成一行，并带结果计数。
 */
const props = defineProps({
  /** ReplayAnalysis：{ phase, done, total, failure } */
  analysis: { type: Object, required: true },
  /** READY 时的结果：用于有效 / 重复 / 失败计数 */
  result: { type: Object, default: null },
})

defineEmits(['cancel', 'dismiss'])

const phase = computed(() => props.analysis?.phase || 'idle')
const percent = computed(() => {
  const total = props.analysis?.total || 0
  return total > 0 ? Math.min(100, Math.round(((props.analysis?.done || 0) / total) * 100)) : 0
})
const failureKey = computed(() => {
  switch (props.analysis?.failure) {
    case 'ENGINE_UNAVAILABLE': return 'replay.analysis.engine_unavailable'
    case 'NO_VALID_REPLAYS': return 'replay.analysis.no_valid_replays'
    default: return 'replay.analysis.failed_unknown'
  }
})
const counts = computed(() => ({
  v: props.result?.battles?.length || 0,
  d: props.result?.duplicates?.length || 0,
  f: props.result?.failures?.length || 0,
}))
</script>

<template>
  <div v-if="phase !== 'idle'" class="replay-processing-panel" role="status" data-testid="replay-processing-panel"
       :class="{ 'rpp-compact': phase === 'ready' }">
    <template v-if="phase === 'parsing'">
      <div class="rpp-title">{{ $t('replay.analysis.parsing') }}</div>
      <div class="rpp-progress-line" data-testid="analysis-progress">
        {{ $t('replay.analysis.progress', { done: analysis.done, total: analysis.total }) }} · {{ percent }}%
      </div>
      <div class="rpp-bar task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent"><div class="rpp-bar-fill task-bar-fill" :style="{ width: percent + '%' }"></div></div>
    </template>
    <template v-else-if="phase === 'ready'">
      <div class="rpp-ready-inline rpp-ok" data-testid="processing-ready">
        <CircleCheck :size="16" aria-hidden="true" />{{ $t('replay.analysis.ready') }}
        <span class="rpp-ready-detail">{{ $t('replay.analysis.summary', counts) }}</span>
      </div>
    </template>
    <template v-else-if="phase === 'failed'">
      <div class="rpp-title rpp-err"><CircleAlert :size="16" aria-hidden="true" />{{ $t('replay.analysis.failed') }}</div>
      <div class="rpp-sub" data-testid="analysis-failure">{{ $t(failureKey) }}</div>
    </template>
    <template v-else-if="phase === 'cancelled'">
      <div class="rpp-title">{{ $t('replay.analysis.cancelled') }}</div>
    </template>

    <div class="rpp-actions">
      <AppButton v-if="phase === 'parsing'" size="sm" data-testid="processing-cancel" @click="$emit('cancel')">
        {{ $t('replay.analysis.cancel') }}
      </AppButton>
      <AppButton v-else variant="ghost" size="sm" data-testid="processing-dismiss" @click="$emit('dismiss')">
        {{ $t('replay.analysis.dismiss') }}
      </AppButton>
    </div>
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

.rpp-actions { display: flex; gap: var(--space-2); }
.rpp-compact .rpp-actions { margin-inline-start: auto; }
</style>
