<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'

const props = defineProps({
  open: Boolean,
  portrait: Boolean,
  anchor: Object,
  host: Object,
  // 默认值保持 2D / Display 原有契约；3D 回放设置面用同一套定位/焦点实现，只换标识。
  panelTestid: { type: String, default: 'display-panel' },
  ariaLabelKey: { type: String, default: 'recon.map.playback.panel_display' },
  closeTestid: { type: String, default: 'display-close' },
  tourId: { type: String, default: 'playback-display-options' },
})
const emit = defineEmits(['close'])
const panel = ref(null)
const placement = ref({})
let observer

function clipBounds(element) {
  let top = -Infinity
  let bottom = Infinity
  for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY !== 'hidden' && overflowY !== 'clip') continue
    const rect = node.getBoundingClientRect()
    top = Math.max(top, rect.top)
    bottom = Math.min(bottom, rect.bottom)
  }
  return { top, bottom }
}

function measure() {
  if (!props.open || props.portrait || !props.host || !props.anchor || !panel.value) return
  const host = props.host.getBoundingClientRect()
  const anchor = props.anchor.getBoundingClientRect()
  const style = getComputedStyle(props.host)
  const edge = parseFloat(style.getPropertyValue('--space-2')) || 8
  const gap = parseFloat(style.getPropertyValue('--space-1')) || 4
  const originLeft = host.left + props.host.clientLeft
  const originTop = host.top + props.host.clientTop
  const hostWidth = props.host.clientWidth || host.width
  const paddingLeft = parseFloat(style.paddingLeft) || 0
  const paddingTop = parseFloat(style.paddingTop) || 0
  const paddingRight = parseFloat(style.paddingRight) || 0
  const clip = clipBounds(props.host)
  const viewportTop = Math.max(host.top, clip.top, 0)
  const viewportBottom = Math.min(host.bottom, clip.bottom, window.innerHeight)
  const anchorTop = Math.min(Math.max(anchor.top, viewportTop), Math.max(viewportTop, viewportBottom))
  const anchorBottom = Math.min(Math.max(anchor.bottom, anchorTop), Math.max(viewportTop, viewportBottom))
  const compactLandscape = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse) and (orientation: landscape) and (height <= 520px)').matches
  const transport = compactLandscape ? props.anchor.closest?.('.pb-transport-slot') : null
  const aboveAnchorTop = transport
    ? Math.max(viewportTop, transport.getBoundingClientRect().top)
    : anchorTop
  const above = Math.max(0, aboveAnchorTop - viewportTop - edge - gap)
  const below = Math.max(0, viewportBottom - anchorBottom - edge - gap)
  const minimumPane = 96
  const abovePane = Math.max(above, Math.min(minimumPane, viewportBottom - viewportTop))
  const belowPane = Math.max(below, Math.min(minimumPane, viewportBottom - viewportTop))
  const abovePreferred = panel.value.scrollHeight <= abovePane || abovePane >= belowPane
  const available = abovePreferred ? abovePane : belowPane
  const width = Math.min(panel.value.offsetWidth, hostWidth - paddingLeft - paddingRight - edge * 2)
  const borderY = Math.max(0, panel.value.offsetHeight - panel.value.clientHeight)
  const outerAvailable = available + borderY
  const height = Math.min(panel.value.scrollHeight + borderY, outerAvailable, Math.max(0, viewportBottom - viewportTop))
  const topMin = Math.max(0, paddingTop + edge)
  const topMax = Math.max(topMin, viewportBottom - host.top - height)
  const aboveTop = aboveAnchorTop - originTop - gap - height
  const rawTop = abovePreferred ? aboveTop : anchorBottom - originTop + gap
  placement.value = {
    left: `${Math.max(paddingLeft + edge, Math.min(anchor.right - originLeft - width, hostWidth - paddingRight - width - edge))}px`,
    top: `${Math.min(Math.max(rawTop, topMin), topMax)}px`,
    maxHeight: `${outerAvailable}px`,
  }
}
function dismiss(event) {
  if (!props.open) return
  if (event.type === 'keydown') { if (event.key === 'Escape') emit('close'); return }
  if (!panel.value?.contains(event.target) && !props.anchor?.contains(event.target)) emit('close')
}

function focusIfPossible(element) {
  if (!element || typeof element.focus !== 'function' || element === document.activeElement) return false
  if (element.getClientRects && element.getClientRects().length === 0) return false
  element.focus({ preventScroll: true })
  return document.activeElement === element
}
let focusMovedIn = false
function syncFocus(open) {
  if (open) {
    focusMovedIn = focusIfPossible(panel.value?.querySelector(`[data-testid="${props.closeTestid}"]`))
      || focusIfPossible(panel.value)
    return
  }
  if (focusMovedIn) focusIfPossible(props.anchor)
  focusMovedIn = false
}
watch(() => [props.open, props.portrait, props.host, props.anchor], async () => {
  await nextTick()
  observer?.disconnect()
  if (props.open && observer) {
    for (const el of [props.host, props.anchor, panel.value]) if (el) observer.observe(el)
  }
  measure()
}, { flush: 'post' })
watch(() => props.open, (open) => syncFocus(open), { flush: 'post' })
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(measure)
  nextTick(() => {
    if (props.open && observer) for (const el of [props.host, props.anchor, panel.value]) if (el) observer.observe(el)
    if (props.open) syncFocus(true)
    measure()
  })
})
onBeforeUnmount(() => {
  observer?.disconnect()
})
useEventListener(() => window, 'resize', measure)
useEventListener(() => window, 'scroll', measure, { capture: true })
useEventListener(() => document, 'pointerdown', dismiss, { capture: true })
useEventListener(() => document, 'keydown', dismiss)
</script>

<template>
  <section v-if="open" ref="panel" class="pb-display-surface" :class="{ 'pb-display-portrait': portrait }" :style="portrait ? undefined : placement" role="dialog" tabindex="-1" :aria-label="$t(props.ariaLabelKey)" :data-testid="props.panelTestid" :data-tour="props.tourId" @pointerdown.stop @click.stop>
    <slot />
  </section>
</template>

<style scoped>
.pb-display-surface {
  position: absolute;
  z-index: var(--pb-z-modal);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  inline-size: min(100% - var(--space-4), clamp(18rem, 32cqw, 28rem));
  max-block-size: calc(100% - var(--space-4));
  padding: var(--space-3);
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
}
.pb-display-portrait { position: static; inline-size: 100%; max-block-size: 60dvh; }
.pb-display-surface:focus { outline: none; }
@media (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  .pb-display-surface { padding: var(--space-2); }
}
</style>
