<script setup>
defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
})

const emit = defineEmits(['drag-start', 'seek'])
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
  </div>
</template>

<style scoped>
.pb-progress { position: relative; margin: 2px 0; }
.pb-range { width: 100%; display: block; }
</style>
