<script setup>
import { onBeforeUnmount, ref } from 'vue'

defineOptions({ name: 'PlaybackMobileOverlay' })

const open = ref(false)
let hideTimer = null

function clearHideTimer() {
  if (hideTimer != null) clearTimeout(hideTimer)
  hideTimer = null
}

function reveal() {
  open.value = true
  clearHideTimer()
  hideTimer = setTimeout(() => {
    open.value = false
    hideTimer = null
  }, 3000)
}

function hide() {
  clearHideTimer()
  open.value = false
}

defineExpose({ reveal, hide, open })
onBeforeUnmount(clearHideTimer)
</script>

<template>
  <div class="pb-mobile-overlay" :class="{ 'pb-mobile-overlay-visible': open }" data-test="pb-mobile-overlay" @pointerdown.stop="reveal" @click.stop="reveal">
    <div class="pb-mobile-overlay-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.pb-mobile-overlay { display: block; }
.pb-mobile-overlay-content { display: block; }
@media (width < 768px) {
  .pb-mobile-overlay { position: absolute; inset: 0; z-index: 25; display: block; pointer-events: none; opacity: 0; transition: opacity .18s ease; }
  .pb-mobile-overlay-visible { pointer-events: auto; opacity: 1; }
  .pb-mobile-overlay-content { position: absolute; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); left: 8px; display: grid; gap: 5px; padding: 7px; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg-card2) 78%, transparent); backdrop-filter: blur(8px); }
}
@media (prefers-reduced-motion: reduce) { .pb-mobile-overlay { transition: none; } }
</style>
