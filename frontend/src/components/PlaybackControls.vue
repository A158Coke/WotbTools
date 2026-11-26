<script setup>
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import PlaybackTransport from './PlaybackTransport.vue'

defineOptions({ name: 'PlaybackControls' })

const { isPhone } = usePlaybackPhoneForm()

const props = defineProps({
  playing: Boolean,
  displayOpen: Boolean,
  annotationEnabled: Boolean,
  speed: { type: Number, default: 1 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  floatingFullscreen: Boolean,
  formatClock: { type: Function, required: true },
  navEligible: { type: Boolean, default: true },
  rosterEntryVisible: { type: Boolean, default: false },
  rosterOpen: { type: Boolean, default: false },
  shotTicks: { type: Array, default: () => [] },
  killTicks: { type: Array, default: () => [] },
  showEventMarkers: { type: Boolean, default: false },
})

const emit = defineEmits([
  'toggle-play', 'step', 'set-speed', 'toggle-fullscreen',
  'toggle-panels', 'drag-start', 'drag-end', 'seek', 'toggle-annotation', 'toggle-roster',
])
</script>

<template>
  <PlaybackTransport
    :fullscreen-supported="props.fullscreenSupported"
    :is-fullscreen="props.isFullscreen"
    :floating-fullscreen="props.floatingFullscreen"
    :display-open="props.displayOpen"
    display-enabled
    :annotation-enabled="props.annotationEnabled"
    @toggle-annotation="emit('toggle-annotation')"
    @toggle-fullscreen="emit('toggle-fullscreen')"
    @toggle-display="emit('toggle-panels', $event)"
    :playing="props.playing"
    :speed="props.speed"
    :current-time="props.currentTime"
    :duration="props.duration"
    :compact="isPhone"
    :format-clock="props.formatClock"
    :nav-eligible="props.navEligible"
    :roster-entry-visible="props.rosterEntryVisible"
    :roster-open="props.rosterOpen"
    :shot-ticks="props.shotTicks"
    :kill-ticks="props.killTicks"
    :show-event-markers="props.showEventMarkers"
    @toggle-roster="emit('toggle-roster')"
    @toggle-play="emit('toggle-play')"
    @step="emit('step', $event)"
    @set-speed="emit('set-speed', $event)"
    @scrub-start="emit('drag-start')"
    @scrub-end="emit('drag-end')"
    @seek="emit('seek', $event)"
  >
  </PlaybackTransport>
</template>
