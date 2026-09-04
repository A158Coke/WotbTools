<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineOptions({ name: 'PlaybackMobileOverlay' })

const AUTO_HIDE_MS = 2500
const MOBILE_QUERY = '(pointer: coarse) and (max-width: 1199.98px)'
const root = ref(null)
const open = ref(false)
const transientFullscreen = ref(false)
let hideTimer = null
let mobileMql = null

function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function fullscreenActive() {
  return typeof document !== 'undefined' && !!document.fullscreenElement
}

function mobileQueryMatches() {
  if (mobileMql) return !!mobileMql.matches
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !!window.matchMedia(MOBILE_QUERY).matches
}

function isMobileFullscreen() {
  return fullscreenActive() && mobileQueryMatches()
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

function syncResponsiveMode() {
  clearHideTimer()
  const nextTransient = isMobileFullscreen()
  transientFullscreen.value = nextTransient
  // Crossing into or out of the mobile fullscreen form must never leave a stale viewport overlay
  // visible. The parent owns the form switch; a fresh tap/reveal re-opens controls when appropriate.
  open.value = false
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
  // BattlePlayback remains the single owner of fullscreenchange. This overlay only owns the
  // responsive breakpoint that decides whether its controls are transient. Keeping the MQL live
  // prevents orientation / viewport changes during fullscreen from leaving stale pointer behavior.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mobileMql = window.matchMedia(MOBILE_QUERY)
    if (typeof mobileMql.addEventListener === 'function') {
      mobileMql.addEventListener('change', syncResponsiveMode)
    }
  }
  transientFullscreen.value = isMobileFullscreen()
  document.addEventListener('click', onDocumentClick, true)
})

onBeforeUnmount(() => {
  clearHideTimer()
  document.removeEventListener('click', onDocumentClick, true)
  if (mobileMql && typeof mobileMql.removeEventListener === 'function') {
    mobileMql.removeEventListener('change', syncResponsiveMode)
  }
  mobileMql = null
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
    data-test="pb-mobile-overlay"
  >
    <div
      class="pb-mobile-overlay-content"
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

/* Fullscreen-mobile behavior is class-driven rather than inline so reduced-motion can override it. */
.pb-mobile-overlay-transient {
  position: absolute;
  inset: 0;
  z-index: 25;
  pointer-events: none;
  opacity: 0;
  transition: opacity .18s ease;
}
.pb-mobile-overlay-transient.pb-mobile-overlay-visible { opacity: 1; }
.pb-mobile-overlay-transient .pb-mobile-overlay-content {
  position: absolute;
  right: 8px;
  bottom: calc(8px + env(safe-area-inset-bottom));
  left: 8px;
  display: none;
  pointer-events: none;
}
.pb-mobile-overlay-transient.pb-mobile-overlay-visible .pb-mobile-overlay-content {
  display: grid;
  pointer-events: auto;
}

@media (width < 768px) {
  .pb-mobile-overlay { position: absolute; inset: 0; z-index: 25; display: block; pointer-events: none; opacity: 0; transition: opacity .18s ease; }
  .pb-mobile-overlay-visible { opacity: 1; }
  .pb-mobile-overlay-visible .pb-mobile-overlay-content { pointer-events: auto; }
  .pb-mobile-overlay-content { position: absolute; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom)); left: 8px; display: grid; gap: 5px; padding: 7px; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg-card2) 78%, transparent); backdrop-filter: blur(8px); pointer-events: none; }
}
@media (prefers-reduced-motion: reduce) { .pb-mobile-overlay { transition: none; } }
</style>
