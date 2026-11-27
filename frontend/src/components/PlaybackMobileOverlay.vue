<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'

defineOptions({ name: 'PlaybackMobileOverlay' })

const props = defineProps({
  paused: { type: Boolean, default: false },
  fullscreen: { type: Boolean, default: false },
})

const AUTO_HIDE_MS = 2500
const MOBILE_QUERY = PLAYBACK_MOBILE_QUERY
let pressing = false
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

function mobileQueryMatches() {
  if (mobileMql) return !!mobileMql.matches
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !!window.matchMedia(MOBILE_QUERY).matches
}

function isMobileFullscreen() {
  return props.fullscreen && mobileQueryMatches()
}

function scheduleHide() {
  clearHideTimer()
  if (!transientFullscreen.value || pressing || props.paused) return
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
  open.value = false
}

function syncFullscreenExit() {
  if (props.fullscreen || !transientFullscreen.value) return
  clearHideTimer()
  transientFullscreen.value = false
}

function onContentPointerDown() {
  pressing = true
  reveal()
}

function onWindowPointerUp() {
  if (!pressing) return
  pressing = false
  if (open.value) scheduleHide()
}

watch(() => props.paused, (paused) => {
  if (paused) clearHideTimer()
  else if (open.value) scheduleHide()
})

watch(() => props.fullscreen, (fullscreen) => {
  if (!fullscreen) syncFullscreenExit()
})

function onDocumentClick(event) {
  if (!isMobileFullscreen()) return
  const fullscreenRoot = document.fullscreenElement
  const overlayRoot = root.value
  if (!fullscreenRoot || !overlayRoot || !fullscreenRoot.contains(event.target)) return

  reveal()
}

onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mobileMql = window.matchMedia(MOBILE_QUERY)
    if (typeof mobileMql.addEventListener === 'function') {
      mobileMql.addEventListener('change', syncResponsiveMode)
    }
  }
  transientFullscreen.value = isMobileFullscreen()
  document.addEventListener('click', onDocumentClick, true)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
})

onBeforeUnmount(() => {
  clearHideTimer()
  document.removeEventListener('click', onDocumentClick, true)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
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
      @pointerdown.stop="onContentPointerDown"
      @click.stop="reveal"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.pb-mobile-overlay { display: block; }
.pb-mobile-overlay-content { display: block; }

.pb-mobile-overlay-transient {
  position: absolute;
  inset: 0;
  z-index: var(--pb-z-controls);
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
  .pb-mobile-overlay { position: absolute; inset: 0; z-index: var(--pb-z-controls); display: block; pointer-events: none; opacity: 0; transition: opacity .18s ease; }
  .pb-mobile-overlay-visible { opacity: 1; }
  .pb-mobile-overlay-visible .pb-mobile-overlay-content { pointer-events: auto; }
  .pb-mobile-overlay-content { position: absolute; right: 4px; bottom: calc(4px + env(safe-area-inset-bottom)); left: 4px; display: grid; gap: 4px; padding: 4px; border: 1px solid color-mix(in srgb, var(--text) 18%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--bg-card2) 78%, transparent); backdrop-filter: blur(8px); pointer-events: none; }
}
@media (prefers-reduced-motion: reduce) { .pb-mobile-overlay { transition: none; } }
</style>
