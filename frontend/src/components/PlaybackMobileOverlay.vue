<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineOptions({ name: 'PlaybackMobileOverlay' })

const AUTO_HIDE_MS = 2500
const root = ref(null)
const open = ref(false)
const transientFullscreen = ref(false)
let hideTimer = null

function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function isMobileFullscreen() {
  if (typeof document === 'undefined' || !document.fullscreenElement) return false
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse) and (max-width: 1199.98px)').matches
}

function scheduleHide() {
  clearHideTimer()
  if (!transientFullscreen.value) return
  hideTimer = setTimeout(() => {
    open.value = false
    hideTimer = null
  }, AUTO_HIDE_MS)
}

function reveal() {
  transientFullscreen.value = isMobileFullscreen()
  open.value = true
  scheduleHide()
}

function hide() {
  clearHideTimer()
  open.value = false
  transientFullscreen.value = false
}

function onDocumentClick(event) {
  if (!isMobileFullscreen()) return
  const fullscreenRoot = document.fullscreenElement
  const overlayRoot = root.value
  if (!fullscreenRoot || !overlayRoot || !fullscreenRoot.contains(event.target)) return

  // A normal single tap anywhere in fullscreen reveals the controls. The viewport-sized wrapper
  // remains pointer-transparent, so pan/pinch continue directly to the map. Pinch does not
  // synthesize a click, therefore it cannot keep the controller alive.
  reveal()
}

onMounted(() => {
  // Fullscreen state is owned by BattlePlayback. This overlay deliberately does not register its
  // own fullscreenchange listener; explicit reveal() and document clicks sample the current native
  // fullscreen fact instead. That preserves the single-listener lifecycle contract of the parent.
  document.addEventListener('click', onDocumentClick, true)
})

onBeforeUnmount(() => {
  clearHideTimer()
  document.removeEventListener('click', onDocumentClick, true)
})

defineExpose({ reveal, hide, open, transientFullscreen })
</script>

<template>
  <div
    ref="root"
    class="pb-mobile-overlay"
    :class="{
      'pb-mobile-overlay-visible': open,
      'pb-mobile-overlay-transient': transientFullscreen,
    }"
    :style="transientFullscreen ? {
      position: 'absolute',
      inset: '0',
      zIndex: 25,
      pointerEvents: 'none',
      opacity: open ? '1' : '0',
      transition: 'opacity .18s ease',
    } : null"
    data-test="pb-mobile-overlay"
  >
    <div
      class="pb-mobile-overlay-content"
      :style="transientFullscreen ? {
        position: 'absolute',
        right: '8px',
        bottom: 'calc(8px + env(safe-area-inset-bottom))',
        left: '8px',
        display: open ? 'grid' : 'none',
        pointerEvents: open ? 'auto' : 'none',
      } : null"
      @pointerdown.stop="reveal"
      @click.stop="reveal"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.pb-mobile-overlay { display: block; }
.pb-mobile-overlay-content { display: block; }
@media (width < 768px) {
  .pb-mobile-overlay { position: absolute; inset: 0; z-index: 25; display: block; pointer-events: none; opacity: 0; transition: opacity .18s ease; }
  .pb-mobile-overlay-visible { opacity: 1; }
  .pb-mobile-overlay-visible .pb-mobile-overlay-content { pointer-events: auto; }
  .pb-mobile-overlay-content { position: absolute; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); left: 8px; display: grid; gap: 5px; padding: 7px; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg-card2) 78%, transparent); backdrop-filter: blur(8px); pointer-events: none; }
}
@media (prefers-reduced-motion: reduce) { .pb-mobile-overlay { transition: none; } }
</style>
