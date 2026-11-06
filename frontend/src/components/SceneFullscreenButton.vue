<script setup lang="ts">
// 场景全屏按钮的单一呈现组件：Maximize/Minimize 图标、aria-pressed、既有
// `recon.map.playback.enter_fullscreen/exit_fullscreen` 文案。四个场景宿主
// （Map Preview 2D/3D、Replay 2D/3D）共用；全屏状态事实源仍归
// usePlaybackFullscreen（本组件不持有任何状态）。
//
// floating：绝对定位到宿主根（= 全屏 target）右上角——移动端统一入口位置；
// 桌面沿用宿主既有位置（如 PlaybackTransport 内联按钮）时传 floating=false。
import { Maximize, Minimize } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

defineProps<{
  isFullscreen: boolean
  floating: boolean
}>()

defineEmits<{ toggle: [] }>()

const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    class="scene-fs-btn"
    :class="{ floating }"
    :aria-pressed="isFullscreen"
    :aria-label="t(isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')"
    :title="t(isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')"
    @click="$emit('toggle')"
  >
    <component :is="isFullscreen ? Minimize : Maximize" :size="16" aria-hidden="true" />
  </button>
</template>

<style scoped>
.scene-fs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-h-sm);
  min-width: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  cursor: pointer;
}

.scene-fs-btn:hover {
  border-color: var(--color-border-strong);
}

.scene-fs-btn:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

/* 右上角浮动位（移动端统一契约）：宿主根必须可定位（fullscreen target 自身）。 */
.scene-fs-btn.floating {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: var(--z-sticky);
}
</style>
