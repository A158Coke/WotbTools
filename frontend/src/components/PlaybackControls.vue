<script setup>
import PlaybackTimeline from './PlaybackTimeline.vue'

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
  'toggle-panels', 'toggle-annotation', 'drag-start', 'seek',
])
</script>

<template>
  <div class="pb-controls" :class="{ 'pb-controls-rail-mode': props.railVisible }" data-test="pb-controls" @pointerdown.stop @click.stop>
    <button type="button" class="pb-btn pb-play-btn" data-test="pb-play" :aria-label="$t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play')" @click="emit('toggle-play')">
      <span class="pb-icon pb-play-icon" :class="{ playing: props.playing }" aria-hidden="true"></span>
      <span class="pb-control-label">{{ $t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}</span>
    </button>
    <button type="button" class="pb-btn" data-test="pb-back5" :aria-label="$t('recon.map.playback.back_seconds', { seconds: 5 })" @click="emit('step', -5)">-5</button>
    <button type="button" class="pb-btn" data-test="pb-fwd5" :aria-label="$t('recon.map.playback.forward_seconds', { seconds: 5 })" @click="emit('step', 5)">+5</button>
    <div class="pb-speed" role="group" :aria-label="$t('recon.map.playback.speed')">
      <button v-for="option in [0.5, 1, 2, 4]" :key="option" type="button" class="pb-btn" :class="{ active: props.speed === option }" :data-test="'pb-speed-' + option" :aria-label="$t('recon.map.playback.speed_option', { speed: option })" @click="emit('set-speed', option)">{{ option }}×</button>
    </div>
    <span class="pb-time" data-test="pb-time">{{ props.formatClock(props.currentTime) }} / {{ props.formatClock(props.duration) }}</span>
    <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-panels" :aria-label="$t('recon.map.playback.panels')" @click="emit('toggle-panels')">☰</button>
    <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-annotation" :aria-label="$t('recon.map.playback.annotation')" @click="emit('toggle-annotation')">✎</button>
    <button type="button" class="pb-btn pb-reset" data-test="pb-reset" :aria-label="$t('recon.map.playback.reset_view')" @click="emit('reset-view')">{{ $t('recon.map.playback.reset_view') }}</button>
    <button v-if="props.fullscreenSupported" type="button" class="pb-btn pb-fullscreen-btn" data-test="pb-fullscreen" :aria-label="$t(props.isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')" @click="emit('toggle-fullscreen')">
      <span class="pb-icon pb-fullscreen-icon" aria-hidden="true"></span><span class="pb-control-label">{{ props.isFullscreen ? $t('recon.map.playback.exit_fullscreen') : $t('recon.map.playback.enter_fullscreen') }}</span>
    </button>
  </div>
  <PlaybackTimeline :current-time="props.currentTime" :duration="props.duration" @drag-start="emit('drag-start')" @seek="emit('seek', $event)" />
</template>

<style scoped>
.pb-controls { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pb-speed { display: inline-flex; gap: 2px; }
.pb-btn { min-height: 30px; border: 1px solid var(--border-ghost); border-radius: 4px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font: inherit; font-size: .78rem; padding: 2px 8px; }
.pb-btn.active { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.pb-icon { display: inline-block; width: 1.1em; height: 1.1em; vertical-align: -.15em; }
.pb-play-icon::before { content: '▶'; }
.pb-play-icon.playing::before { content: 'Ⅱ'; }
.pb-fullscreen-icon::before { content: '⛶'; }
.pb-time { margin-inline: auto; color: var(--text-label); font-size: .8rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* §right-rail：Left Rail 可见（fullscreen 或大桌面）时，底部右侧与 rail 重复的面板/标注/重置/全屏隐藏。 */
.pb-controls-rail-mode .pb-secondary-btn,
.pb-controls-rail-mode .pb-reset,
.pb-controls-rail-mode .pb-fullscreen-btn { display: none; }
@media (width < 768px) {
  .pb-controls { justify-content: center; gap: 4px; }
  .pb-btn { min-width: 36px; min-height: 36px; padding: 2px 6px; }
  .pb-control-label { display: none; }
  .pb-time { flex-basis: 100%; margin-inline: 0; text-align: center; order: 20; }
  .pb-secondary-btn, .pb-fullscreen-btn { min-width: 36px; }
}
</style>
