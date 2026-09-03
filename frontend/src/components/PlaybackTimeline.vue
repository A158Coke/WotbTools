<script setup>
defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
})

const emit = defineEmits(['drag-start', 'seek'])
</script>

<template>
  <div class="pb-progress" data-test="pb-progress" @pointerdown.stop @click.stop>
    <input class="pb-range" type="range" min="0" :max="props.duration || 1" step="0.1" :value="props.currentTime" :aria-label="$t('recon.map.playback.progress')" @pointerdown="emit('drag-start')" @mousedown="emit('drag-start')" @touchstart="emit('drag-start')" @input="emit('seek', Number($event.target.value))" />
  </div>
</template>

<style scoped>
.pb-progress { position: relative; width: 100%; margin: 2px 0; }
.pb-range { display: block; width: 100%; }
</style>
