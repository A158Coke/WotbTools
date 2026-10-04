<script setup>
// 2D adapter for the shared primary Playback composition.
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import PlaybackTransport from './PlaybackTransport.vue'

defineOptions({ name: 'PlaybackControls' })

// Phone form only controls intrinsic button density; speed disclosure is shared in all forms.
const { isPhone } = usePlaybackPhoneForm()

const props = defineProps({
  playing: Boolean,
  displayOpen: Boolean,
  speed: { type: Number, default: 1 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  formatClock: { type: Function, required: true },
})

const emit = defineEmits([
  'toggle-play', 'step', 'set-speed', 'toggle-fullscreen',
  'toggle-panels', 'drag-start', 'drag-end', 'seek',
])
</script>

<template>
  <PlaybackTransport
    :fullscreen-supported="props.fullscreenSupported"
    :is-fullscreen="props.isFullscreen"
    :display-open="props.displayOpen"
    display-enabled
    @toggle-fullscreen="emit('toggle-fullscreen')"
    @toggle-display="emit('toggle-panels', $event)"
    :playing="props.playing"
    :speed="props.speed"
    :current-time="props.currentTime"
    :duration="props.duration"
    :compact="isPhone"
    :format-clock="props.formatClock"
    @toggle-play="emit('toggle-play')"
    @step="emit('step', $event)"
    @set-speed="emit('set-speed', $event)"
    @scrub-start="emit('drag-start')"
    @scrub-end="emit('drag-end')"
    @seek="emit('seek', $event)"
  >
  </PlaybackTransport>
</template>
