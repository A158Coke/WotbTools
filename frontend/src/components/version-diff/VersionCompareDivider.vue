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
