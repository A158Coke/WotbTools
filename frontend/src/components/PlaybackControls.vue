<script setup>
import { computed } from 'vue'
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

/**
 * duration<=0 表示这条 timeline 不可用（后端没有可播放的时间线）。
 * 此时 play / ±5s / 进度条都是 silent no-op —— 必须显式 disabled 并给出原因，
 * 绝不保留「看起来可用但什么都不发生」的控件。
 * 速度档位 / 重置视图 / 全屏 / 面板不依赖时间线，保持可用。
 */
const timelineUsable = computed(() => Number(props.duration) > 0)

const emit = defineEmits([
  'toggle-play', 'step', 'set-speed', 'reset-view', 'toggle-fullscreen',
  'toggle-panels', 'toggle-annotation', 'drag-start', 'seek',
])
</script>

<template>
  <div class="pb-controls" :class="{ 'pb-controls-rail-mode': props.railVisible }" data-test="pb-controls" @pointerdown.stop @click.stop>
    <button type="button" class="pb-btn pb-play-btn" data-test="pb-play" :disabled="!timelineUsable" :aria-disabled="!timelineUsable" :title="timelineUsable ? undefined : $t('recon.map.playback.timeline_unavailable')" :aria-label="$t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play')" @click="emit('toggle-play')">
      <span class="pb-icon pb-play-icon" :class="{ playing: props.playing }" aria-hidden="true"></span>
      <span class="pb-control-label">{{ $t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}</span>
    </button>
    <button type="button" class="pb-btn" data-test="pb-back5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.back_seconds', { seconds: 5 })" @click="emit('step', -5)">-5</button>
    <button type="button" class="pb-btn" data-test="pb-fwd5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.forward_seconds', { seconds: 5 })" @click="emit('step', 5)">+5</button>
    <div class="pb-speed" role="group" :aria-label="$t('recon.map.playback.speed')">
      <button v-for="option in [0.5, 1, 2, 4]" :key="option" type="button" class="pb-btn" :class="{ active: props.speed === option }" :data-test="'pb-speed-' + option" :aria-label="$t('recon.map.playback.speed_option', { speed: option })" @click="emit('set-speed', option)">{{ option }}×</button>
    </div>
    <span class="pb-time" data-test="pb-time">{{ props.formatClock(props.currentTime) }} / {{ props.formatClock(props.duration) }}</span>
    <span v-if="!timelineUsable" class="pb-unavailable" data-test="pb-play-unavailable" role="status">{{ $t('recon.map.playback.timeline_unavailable') }}</span>
    <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-panels" :aria-label="$t('recon.map.playback.panels')" @click="emit('toggle-panels')">☰</button>
    <button type="button" class="pb-btn pb-secondary-btn" data-test="pb-annotation" :aria-label="$t('recon.map.playback.annotation')" @click="emit('toggle-annotation')">✎</button>
    <button type="button" class="pb-btn pb-reset" data-test="pb-reset" :aria-label="$t('recon.map.playback.reset_view')" @click="emit('reset-view')">{{ $t('recon.map.playback.reset_view') }}</button>
    <button v-if="props.fullscreenSupported" type="button" class="pb-btn pb-fullscreen-btn" data-test="pb-fullscreen" :aria-label="$t(props.isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')" @click="emit('toggle-fullscreen')">
      <span class="pb-icon pb-fullscreen-icon" aria-hidden="true"></span><span class="pb-control-label">{{ props.isFullscreen ? $t('recon.map.playback.exit_fullscreen') : $t('recon.map.playback.enter_fullscreen') }}</span>
    </button>
  </div>
  <PlaybackTimeline :current-time="props.currentTime" :duration="props.duration" :disabled="!timelineUsable" @drag-start="emit('drag-start')" @seek="emit('seek', $event)" />
</template>

<style scoped>
.pb-controls { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.pb-speed { display: inline-flex; gap: 2px; }
.pb-btn { min-height: 30px; border: 1px solid var(--border-ghost); border-radius: 4px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font: inherit; font-size: .78rem; padding: 2px 8px; }
.pb-btn.active { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.pb-btn:disabled { opacity: .45; cursor: not-allowed; }
.pb-unavailable { flex-basis: 100%; color: var(--text-muted); font-size: .75rem; line-height: 1.4; }
.pb-icon { display: inline-block; width: 1.1em; height: 1.1em; vertical-align: -.15em; }
.pb-play-icon::before { content: '▶'; }
.pb-play-icon.playing::before { content: 'Ⅱ'; }
.pb-fullscreen-icon::before { content: '⛶'; }
.pb-time { margin-inline: auto; color: var(--text-label); font-size: .8rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
/* §right-rail：控制条在 Left Rail 内时，面板/标注/重置/全屏与 rail 的图标导航重复，隐藏掉。 */
.pb-controls-rail-mode .pb-secondary-btn,
.pb-controls-rail-mode .pb-reset,
.pb-controls-rail-mode .pb-fullscreen-btn { display: none; }
/* rail 是竖向窄列：按钮铺满宽度，速度档位排成一行四格。 */
.pb-controls-rail-mode { flex-direction: column; align-items: stretch; gap: 6px; }
.pb-controls-rail-mode .pb-btn { width: 100%; }
.pb-controls-rail-mode .pb-speed { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; }
.pb-controls-rail-mode .pb-speed .pb-btn { padding: 2px 0; text-align: center; }
.pb-controls-rail-mode .pb-time { margin-inline: 0; text-align: center; }
/* rail 是纵向列：flex-basis:100% 在 column 方向等于「撑满整列高度」，必须还原成内容高度。 */
.pb-controls-rail-mode .pb-unavailable { flex-basis: auto; }
@media (width < 768px) {
  .pb-controls { justify-content: center; gap: 4px; }
  .pb-btn { min-width: 36px; min-height: 36px; padding: 2px 6px; }
  .pb-control-label { display: none; }
  .pb-time { flex-basis: 100%; margin-inline: 0; text-align: center; order: 20; }
  .pb-secondary-btn, .pb-fullscreen-btn { min-width: 36px; }
}
</style>
