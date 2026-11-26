<script setup lang="ts">
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

.scene-fs-btn.floating {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: var(--z-sticky);
}

@media (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  [data-scene-surface] .scene-fs-btn {
    min-height: var(--hit-min-comfortable);
    min-width: var(--hit-min-comfortable);
  }
}
</style>
