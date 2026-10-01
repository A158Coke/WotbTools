<script setup>
// 2D 回放控制条：共用的 PlaybackTransport（播放 / 跳秒 / 速度 / 时间 / 进度条）+ 2D 特有按钮
// （面板 / 标注 / 重置视图 / 全屏）。3D 回放用同一个 PlaybackTransport 配自己的按钮。
import { Maximize2, Minimize2, PanelLeft, PencilLine } from 'lucide-vue-next'
import PlaybackTransport from './PlaybackTransport.vue'

defineOptions({ name: 'PlaybackControls' })

const props = defineProps({
  playing: Boolean,
  speed: { type: Number, default: 1 },
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  // §right-rail：左边 Left Rail 可见时，底部右侧的 面板/标注/重置/全屏 与其重叠 → 隐藏。
  railVisible: Boolean,
  formatClock: { type: Function, required: true },
})

const emit = defineEmits([
  'toggle-play', 'step', 'set-speed', 'reset-view', 'toggle-fullscreen',
  'toggle-panels', 'toggle-annotation', 'drag-start', 'drag-end', 'seek',
])
</script>

<template>
  <PlaybackTransport
    :playing="props.playing"
    :speed="props.speed"
    :current-time="props.currentTime"
    :duration="props.duration"
    :rail-mode="props.railVisible"
    :format-clock="props.formatClock"
    @toggle-play="emit('toggle-play')"
    @step="emit('step', $event)"
    @set-speed="emit('set-speed', $event)"
    @scrub-start="emit('drag-start')"
    @scrub-end="emit('drag-end')"
    @seek="emit('seek', $event)"
  >
    <template #actions>
      <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-panels" :aria-label="$t('recon.map.playback.panels')" :title="$t('recon.map.playback.panels')" @click="emit('toggle-panels')">
        <PanelLeft :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-annotation" :aria-label="$t('recon.map.playback.annotation')" :title="$t('recon.map.playback.annotation')" @click="emit('toggle-annotation')">
        <PencilLine :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="pb-btn pb-reset" data-test="pb-reset" :aria-label="$t('recon.map.playback.reset_view')" @click="emit('reset-view')">{{ $t('recon.map.playback.reset_view') }}</button>
      <button v-if="props.fullscreenSupported" type="button" class="pb-btn pb-fullscreen-btn" data-test="pb-fullscreen" :aria-label="$t(props.isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')" @click="emit('toggle-fullscreen')">
        <component :is="props.isFullscreen ? Minimize2 : Maximize2" :size="16" aria-hidden="true" />
        <span class="pb-control-label">{{ props.isFullscreen ? $t('recon.map.playback.exit_fullscreen') : $t('recon.map.playback.enter_fullscreen') }}</span>
      </button>
    </template>
  </PlaybackTransport>
</template>

<style scoped>
/* §right-rail：控制条在 Left Rail 内时，面板/标注/重置/全屏与 rail 的图标导航重复，隐藏掉。 */
.pb-controls-rail-mode .pb-secondary-btn,
.pb-controls-rail-mode .pb-reset,
.pb-controls-rail-mode .pb-fullscreen-btn { display: none; }

@media (width < 768px) {
  .pb-control-label { display: none; }
}
</style>
