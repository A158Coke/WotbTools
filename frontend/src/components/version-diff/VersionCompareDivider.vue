<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import './version-diff.css'

const props = defineProps<{ from: string; to: string; label: string }>()
const value = defineModel<number>({ required: true })
const rail = ref<HTMLDivElement | null>(null)
const { t } = useI18n()
let drag: { pointerId: number; startX: number; startValue: number } | null = null

function setValue(next: number) {
  value.value = Math.round(Math.min(100, Math.max(0, next)))
}

function startDrag(event: PointerEvent) {
  if (drag || event.button !== 0) return
  drag = { pointerId: event.pointerId, startX: event.clientX, startValue: value.value }
  ;(event.currentTarget as HTMLButtonElement).setPointerCapture?.(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId || !rail.value) return
  const width = rail.value.getBoundingClientRect().width
  if (width > 0) setValue(drag.startValue + (event.clientX - drag.startX) * 100 / width)
}

function endDrag(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId) return
  drag = null
  const button = event.currentTarget as HTMLButtonElement
  if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId)
}

function onKey(event: KeyboardEvent) {
  const steps: Record<string, number> = {
    ArrowLeft: value.value - 2, ArrowDown: value.value - 2,
    ArrowRight: value.value + 2, ArrowUp: value.value + 2,
    Home: 0, End: 100,
  }
  if (!Object.hasOwn(steps, event.key)) return
  event.preventDefault()
  setValue(steps[event.key])
}
</script>

<template>
  <div ref="rail" class="vd-compare-controls" :style="{ '--vd-compare-position': value + '%' }">
    <button type="button" class="vd-map-tag vd-version-stop" @click="setValue(100)">{{ props.from }}</button>
    <button type="button" class="vd-map-tag vd-version-stop is-new" @click="setValue(0)">{{ props.to }}</button>
    <span class="vd-compare-divider" aria-hidden="true"><span class="vd-compare-grip">⇔</span></span>
    <button
      type="button"
      class="vd-compare-handle"
      role="slider"
      :aria-label="label"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="value"
      :aria-valuetext="t('versionDiff.armor.compareShare', { n: value, version: from })"
      @pointerdown="startDrag"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @lostpointercapture="endDrag"
      @keydown="onKey"
    ></button>
  </div>
</template>

<style scoped>
.vd-compare-controls { position: absolute; inset: 0; z-index: calc(var(--z-base) + 2); pointer-events: none; }

.vd-compare-divider {
  position: absolute;
  left: var(--vd-compare-position);
  inset-block: 0;
  inline-size: 2px;
  margin-inline-start: -1px;
  background: var(--color-border-strong);
  pointer-events: none;
}

.vd-compare-handle {
  position: absolute;
  left: clamp(22px, var(--vd-compare-position), calc(100% - 22px));
  pointer-events: auto;
  inset-block-start: 50%;
  translate: -50% -50%;
  inline-size: 44px;
  block-size: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ew-resize;
  touch-action: none;
}

.vd-compare-grip {
  position: absolute;
  left: 50%;
  inset-block-start: 50%;
  translate: -50% -50%;
  inline-size: 16px;
  block-size: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
}

.vd-version-stop {
  pointer-events: auto;
  border: 1px solid var(--color-border-subtle);
  cursor: pointer;
  touch-action: manipulation;
}

.vd-version-stop:focus-visible,
.vd-compare-handle:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}
</style>
