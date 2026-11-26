<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { nearestTickTime, tickPercentToTime } from '../utils/playbackShortcuts.ts'

defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  startTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
  shotTicks: { type: Array, default: () => [] },
  killTicks: { type: Array, default: () => [] },
  showEventMarkers: { type: Boolean, default: false },
  hint: { type: String, default: '' },
})

const emit = defineEmits(['drag-start', 'drag-end', 'seek'])

const dragValue = ref(null)
const shownValue = computed(() => dragValue.value ?? props.currentTime)
const max = computed(() => (props.duration > props.startTime ? props.duration : props.startTime + 1))
const ticksVisible = computed(() => props.showEventMarkers && !props.disabled && props.duration > props.startTime
  && (props.shotTicks.length > 0 || props.killTicks.length > 0))

const TICK_SNAP_PX = 5
function onTickStripClick(event) {
  const rect = event.currentTarget?.getBoundingClientRect?.()
  const width = Number(rect?.width)
  if (!(width > 0)) return
  const clientX = Number(event.clientX)
  if (!Number.isFinite(clientX)) return
  const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / width) * 100))
  const tolerance = (TICK_SNAP_PX / width) * 100
  const snapped = nearestTickTime([...props.shotTicks, ...props.killTicks], pct, tolerance)
  const target = snapped ?? tickPercentToTime(pct, props.startTime, props.duration)
  if (target != null) emit('seek', target)
}

function onPointerDown() {
  dragValue.value = props.currentTime
  emit('drag-start')
  window.addEventListener('pointerup', endDrag, { once: true })
  window.addEventListener('pointercancel', endDrag, { once: true })
}

function onInput(event) {
  const value = Number(event.target.value)
  if (dragValue.value !== null) dragValue.value = value
  emit('seek', value)
}

function endDrag() {
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  if (dragValue.value === null) return
  dragValue.value = null
  emit('drag-end')
}

onBeforeUnmount(endDrag)
</script>

<template>
  <div class="pb-progress" data-test="pb-progress" data-tour="playback-timeline" :title="props.hint || undefined" @pointerdown.stop @click.stop>
    <input
      class="pb-range"
      type="range"
      :min="props.startTime"
      :max="max"
      step="0.1"
      :value="shownValue"
      :disabled="props.disabled"
      :aria-label="$t('recon.map.playback.progress')"
      @pointerdown="onPointerDown"
      @blur="endDrag"
      @input="onInput"
    />
    <div v-if="ticksVisible" class="pb-tick-layer" aria-hidden="true" data-test="pb-ticks">
      <div
        v-for="(tick, index) in props.shotTicks"
        :key="'s' + index"
        class="pb-tick-shot"
        :class="{ 'pb-tick-shot-highlight': tick.highlight }"
        :style="{ left: tick.pct + '%' }"
      ></div>
      <div
        v-for="(tick, index) in props.killTicks"
        :key="'k' + index"
        class="pb-tick-kill"
        :style="{ left: tick.pct + '%' }"
      ></div>
      <div class="pb-tick-hit" @click="onTickStripClick"></div>
    </div>
  </div>
</template>

<style scoped>
.pb-progress { position: relative; width: 100%; margin: var(--space-1) 0; }

.pb-range { display: block; width: 100%; min-block-size: var(--hit-min); margin: 0; accent-color: var(--color-accent); }
.pb-range:disabled { opacity: .45; cursor: not-allowed; }

.pb-tick-layer { position: absolute; inset: 0; z-index: var(--pb-z-hud); pointer-events: none; user-select: none; }
.pb-tick-shot {
  position: absolute;
  inset-block: 0;
  inline-size: 4px;
  transform: translateX(-50%);
}
.pb-tick-shot::before {
  content: '';
  position: absolute;
  inset-inline-start: 50%;
  inset-block: 0;
  inline-size: 2px;
  transform: translateX(-50%);
  background: var(--color-text-tertiary);
  opacity: .5;
}
.pb-tick-shot-highlight::before { inline-size: 3px; background: var(--color-accent); opacity: 1; }
.pb-tick-kill {
  position: absolute;
  inset-block-end: 0;
  inline-size: 8px;
  block-size: 8px;
  transform: translateX(-50%);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-danger);
}
.pb-tick-hit {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 12px;
  pointer-events: auto;
  cursor: pointer;
}
</style>
