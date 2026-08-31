<script setup>
defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  eventMarkers: { type: Array, default: () => [] },
  formatClock: { type: Function, required: true },
})

const emit = defineEmits(['drag-start', 'seek', 'jump'])
</script>

<template>
  <div class="pb-progress" data-test="pb-progress">
    <input
      class="pb-range"
      type="range"
      min="0"
      :max="props.duration || 1"
      step="0.1"
      :value="props.currentTime"
      @pointerdown="emit('drag-start')"
      @mousedown="emit('drag-start')"
      @touchstart="emit('drag-start')"
      @input="emit('seek', Number($event.target.value))"
      :aria-label="$t('recon.map.playback.progress')"
    />
    <span
      v-for="marker in props.eventMarkers"
      :key="marker.sec"
      class="pb-marker"
      :style="{ left: `${props.duration > 0 ? (marker.sec / props.duration) * 100 : 0}%` }"
      :title="`${props.formatClock(marker.sec)} ×${marker.count}`"
      @click="emit('jump', marker.sec)"
    ></span>
  </div>
</template>

<style scoped>
.pb-progress { position: relative; margin: 2px 0; }
.pb-range { width: 100%; display: block; }
.pb-marker { position: absolute; top: 2px; width: 3px; height: 10px; background: var(--accent); cursor: pointer; transform: translateX(-50%); }
</style>
