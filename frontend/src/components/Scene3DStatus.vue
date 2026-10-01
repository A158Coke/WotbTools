<script setup>
/**
 * 3D 视图的状态层（审计 3D-23；design-language §7 Progress / EmptyState、§10 状态与反馈）：
 * - unsupported：WebGL 预检失败，替代整个场景，说明原因与下一步；
 * - loading：叠在场景上的进度条（progress 为 null 时显示不确定态）；
 * - error：叠在场景上的失败说明 + 重试。
 * AgentArmorView / AgentReplay3D 共用，文案统一走 i18n（scene3d.*）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MonitorX, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import EmptyState from './EmptyState.vue'
import AppButton from './AppButton.vue'
import { WEBGL_STATUS } from '../scene/webglSupport.js'
import { progressPercent } from '../scene/loadProgress.js'

const props = defineProps({
  /** unsupported | loading | error */
  mode: { type: String, required: true, validator: v => ['unsupported', 'loading', 'error'].includes(v) },
  /** 0–1；null = 不确定进度 */
  progress: { type: Number, default: null },
  /** loading：当前阶段文案；error：失败细节 */
  message: { type: String, default: '' },
  /** unsupported：webglSupport.detectWebGL().status */
  webglStatus: { type: String, default: WEBGL_STATUS.UNAVAILABLE },
  /** error：是否提供重试 */
  retryable: { type: Boolean, default: true },
  /** error：是否提供"关闭"（回到上一状态，如换一个文件） */
  dismissible: { type: Boolean, default: false },
})
const emit = defineEmits(['retry', 'dismiss'])
const { t } = useI18n()

const percent = computed(() => progressPercent(props.progress))
const unsupportedDescription = computed(() => t(
  props.webglStatus === WEBGL_STATUS.WEBGL1_ONLY ? 'scene3d.webgl1_only' : 'scene3d.webgl_unavailable',
))
</script>

<template>
  <EmptyState
    v-if="mode === 'unsupported'"
    class="scene-status-block"
    data-testid="scene3d-unsupported"
    :icon="MonitorX"
    :title="t('scene3d.unsupported_title')"
    :description="unsupportedDescription"
  />

  <div v-else-if="mode === 'error'" class="scene-status-overlay is-blocking" data-testid="scene3d-error">
    <EmptyState
      class="scene-status-card"
      role="alert"
      :icon="TriangleAlert"
      :title="t('scene3d.error_title')"
      :description="message || t('scene3d.error_generic')"
    >
      <AppButton v-if="retryable" variant="primary" data-testid="scene3d-retry" @click="emit('retry')">
        <RotateCcw :size="16" aria-hidden="true" />
        {{ t('scene3d.retry') }}
      </AppButton>
      <AppButton v-if="dismissible" data-testid="scene3d-dismiss" @click="emit('dismiss')">{{ t('scene3d.dismiss') }}</AppButton>
    </EmptyState>
  </div>

  <div v-else class="scene-status-overlay" data-testid="scene3d-loading">
    <div class="scene-status-progress" role="status" aria-live="polite">
      <span class="scene-status-label">{{ message || t('scene3d.loading') }}</span>
      <div
        class="progress-track"
        :class="{ 'is-indeterminate': percent == null }"
        role="progressbar"
        :aria-label="message || t('scene3d.loading')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="percent ?? undefined"
      >
        <span class="progress-fill" :style="percent == null ? null : { inlineSize: `${percent}%` }"></span>
      </div>
      <span v-if="percent != null" class="scene-status-percent" data-testid="scene3d-percent">{{ percent }}%</span>
    </div>
  </div>
</template>

<style scoped>
.scene-status-block { margin: var(--space-8) var(--gutter); }

.scene-status-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-sticky);
  display: grid;
  place-items: center;
  padding: var(--space-4);
  pointer-events: none;
}

.scene-status-overlay.is-blocking {
  background: var(--color-scrim);
  pointer-events: auto;
}

.scene-status-card { inline-size: min(100%, 480px); box-shadow: var(--elevation-3); }

.scene-status-progress {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  inline-size: min(100%, 360px);
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-2);
  pointer-events: auto;
}

.scene-status-label { grid-column: 1 / -1; color: var(--color-text-primary); font: var(--type-body); }
.scene-status-percent { color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; }

.progress-track {
  position: relative;
  overflow: hidden;
  block-size: var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
}

.progress-track.is-indeterminate { grid-column: 1 / -1; }

.progress-fill {
  display: block;
  block-size: 100%;
  inline-size: 0;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  transition: inline-size var(--duration-base) var(--ease-standard);
}

.is-indeterminate .progress-fill {
  position: absolute;
  inset-block: 0;
  inline-size: 40%;
  animation: scene-status-indeterminate 1.2s var(--ease-standard) infinite;
}

@keyframes scene-status-indeterminate {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}

@media (prefers-reduced-motion: reduce) {
  .is-indeterminate .progress-fill { inset-inline-start: 30%; animation: none; }
}
</style>
