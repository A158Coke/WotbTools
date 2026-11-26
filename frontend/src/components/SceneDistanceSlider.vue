<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface SceneDistanceApi {
  cameraDistanceState?: () => { available: boolean; mode?: string; v?: number }
  setCameraDistance?: (v: number) => void
}

const props = defineProps<{
  getSceneApi: () => SceneDistanceApi | null | undefined
  visible: boolean
}>()

const { t } = useI18n()
const sceneApi = (): SceneDistanceApi | null | undefined => props.getSceneApi?.()

const v = ref(0.5)
const dragging = ref(false)
const activePointerId = ref<number | null>(null)
const trackEl = ref<HTMLElement | null>(null)
let pollTimer: number | undefined

function readFromScene() {
  if (!props.visible) return
  const state = sceneApi()?.cameraDistanceState?.()
  if (!state?.available || typeof state.v !== 'number') return
  if (!dragging.value) v.value = Math.min(1, Math.max(0, state.v))
}

onMounted(() => {
  readFromScene()
  pollTimer = window.setInterval(readFromScene, 200)
})
onBeforeUnmount(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
  pollTimer = undefined
})
watch(() => props.visible, () => {
  if (props.visible) readFromScene()
})

function pointToV(clientY: number): number | null {
  const rect = trackEl.value?.getBoundingClientRect()
  if (!rect || rect.height <= 0) return null
  return Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height))
}
function applyV(next: number) {
  v.value = next
  sceneApi()?.setCameraDistance?.(next)
}
function endDrag() {
  dragging.value = false
  activePointerId.value = null
}
function onPointerDown(e: PointerEvent) {
  if (dragging.value && activePointerId.value !== e.pointerId) return
  if (e.button != null && e.button !== 0) return
  dragging.value = true
  activePointerId.value = e.pointerId
  const target = e.currentTarget as HTMLElement | null
  try { target?.setPointerCapture(e.pointerId) } catch { /* 测试环境可能不支持 */ }
  const next = pointToV(e.clientY)
  if (next != null) applyV(next)
  e.preventDefault()
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value || activePointerId.value !== e.pointerId) return
  const next = pointToV(e.clientY)
  if (next != null) applyV(next)
}
function onPointerUp(e: PointerEvent) {
  if (!dragging.value || activePointerId.value !== e.pointerId) return
  const target = e.currentTarget as HTMLElement | null
  try { target?.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
  endDrag()
}
function onLostPointerCapture(e: PointerEvent) {
  if (dragging.value && activePointerId.value === e.pointerId) endDrag()
}
function onKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 0.1 : 0.02
  if (e.key === 'ArrowUp') { applyV(Math.min(1, v.value + step)); e.preventDefault() }
  else if (e.key === 'ArrowDown') { applyV(Math.max(0, v.value - step)); e.preventDefault() }
  else if (e.key === 'PageUp') { applyV(Math.min(1, v.value + 0.2)); e.preventDefault() }
  else if (e.key === 'PageDown') { applyV(Math.max(0, v.value - 0.2)); e.preventDefault() }
  else if (e.key === 'Home') { applyV(1); e.preventDefault() }
  else if (e.key === 'End') { applyV(0); e.preventDefault() }
}

const thumbBottomPct = computed(() => `${v.value * 100}%`)
const percentNow = computed(() => Math.round(v.value * 100))
</script>

<template>
  <div
    v-if="visible"
    class="scene-dist"
    data-testid="scene-distance-slider"
    role="slider"
    tabindex="0"
    aria-orientation="vertical"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="percentNow"
    :aria-valuetext="t('agentReplay.distance_value', { percent: percentNow })"
    :aria-label="t('agentReplay.distance')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @lostpointercapture="onLostPointerCapture"
    @keydown="onKeydown"
  >
    <span class="scene-dist-label" aria-hidden="true">{{ t('agentReplay.distance_near') }}</span>
    <div ref="trackEl" class="scene-dist-track">
      <div class="scene-dist-thumb" :style="{ bottom: thumbBottomPct }"></div>
    </div>
    <span class="scene-dist-label" aria-hidden="true">{{ t('agentReplay.distance_far') }}</span>
  </div>
</template>

<style scoped>
.scene-dist {
  position: absolute;
  min-inline-size: var(--hit-min);
  box-sizing: border-box;
  top: var(--scene-fs-bottom, calc(var(--space-2) + var(--control-h-sm) + var(--space-2)));
  right: var(--space-2);
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1);
  border: var(--border-width) solid var(--color-border);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-1);
  touch-action: none;
}

@media (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  .scene-dist { top: var(--scene-fs-bottom, calc(var(--space-2) + var(--hit-min-comfortable) + var(--space-2))); }
}

.scene-dist-label {
  font: var(--type-caption);
  color: var(--color-text-secondary);
  writing-mode: vertical-rl;
  text-orientation: upright;
}

.scene-dist-track {
  position: relative;
  width: var(--space-2);
  height: min(max(96px, 22dvh), 200px);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-3);
}

.scene-dist-thumb {
  position: absolute;
  left: 50%;
  transform: translate(-50%, 50%);
  width: calc(var(--space-4) + var(--space-1));
  height: calc(var(--space-4) + var(--space-1));
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-accent);
  pointer-events: none;
}

.scene-dist:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}
</style>
