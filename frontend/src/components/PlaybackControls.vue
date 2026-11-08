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
  annotationEnabled: Boolean,
  speed: { type: Number, default: 1 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  /** 全屏入口由宿主右上角浮动按钮呈现：不在传输条里重复渲染（见 PlaybackTransport）。 */
  floatingFullscreen: Boolean,
  formatClock: { type: Function, required: true },
  /** 透传给 PlaybackTransport：控制条当前是否可见（决定是否托管菜单入口）。 */
  navEligible: { type: Boolean, default: true },
})

const emit = defineEmits([
  'toggle-play', 'step', 'set-speed', 'toggle-fullscreen',
  'toggle-panels', 'drag-start', 'drag-end', 'seek', 'toggle-annotation',
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
    @toggle-play="emit('toggle-play')"
    @step="emit('step', $event)"
    @set-speed="emit('set-speed', $event)"
    @scrub-start="emit('drag-start')"
    @scrub-end="emit('drag-end')"
    @seek="emit('seek', $event)"
  >
  </PlaybackTransport>
</template>
