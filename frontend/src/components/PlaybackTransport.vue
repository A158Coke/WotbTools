<script setup>
// 2D / 3D 回放共用的播放传输控件：播放/暂停 · ±N 秒 · 速度档位 · 时间 · 进度条。
// 只管"时间轴"本身；各形态特有的按钮（2D 的面板 / 标注 / 重置 / 全屏，3D 的相机 / GLB / 标签）
// 通过 actions 插槽放进同一行，样式经 :slotted 统一。
// 类名沿用 2D 的 pb-*：playback-*.css 的手机 / 全屏 / rail 布局按这些类名排版，不能改。
import { computed } from 'vue'
import { Pause, Play } from 'lucide-vue-next'
import PlaybackTimeline from './PlaybackTimeline.vue'
import { formatPlaybackClock } from '../utils/playbackClock'
import { PLAYBACK_SPEEDS } from '../composables/usePlaybackTransport.js'

defineOptions({ name: 'PlaybackTransport' })

const props = defineProps({
  playing: Boolean,
  speed: { type: Number, default: 1 },
  speeds: { type: Array, default: () => PLAYBACK_SPEEDS },
  currentTime: { type: Number, default: 0 },
  /** 时间轴起点（3D 场景的 t_start 不一定是 0）；duration 是终点（绝对时间） */
  startTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  /** 前进 / 后退的秒数；0 = 不显示这两个按钮 */
  stepSeconds: { type: Number, default: 5 },
  /** 竖向 rail 布局：按钮铺满宽度，速度档位一行排开 */
  railMode: Boolean,
  formatClock: { type: Function, default: formatPlaybackClock },
})

const emit = defineEmits(['toggle-play', 'step', 'set-speed', 'seek', 'scrub-start', 'scrub-end'])

/**
 * 时间轴不可用（duration 不大于起点）时，播放 / 跳秒 / 进度条都是 silent no-op——
 * 必须显式 disabled 并说明原因，不保留"看起来可用但什么都不发生"的控件。
 * 速度档位与 actions 插槽里的按钮不依赖时间轴，保持可用。
 */
const timelineUsable = computed(() => Number(props.duration) > Number(props.startTime))
/** 时钟统一显示「已播放 / 总时长」，从 00:00 起算（3D 的绝对时间轴起点 t_start 不一定是 0） */
const elapsed = computed(() => Number(props.currentTime) - Number(props.startTime))
const total = computed(() => Number(props.duration) - Number(props.startTime))
</script>

<template>
  <div class="pb-controls" :class="{ 'pb-controls-rail-mode': props.railMode }" data-test="pb-controls" @pointerdown.stop @click.stop>
    <button
      type="button"
      class="pb-btn pb-play-btn"
      data-test="pb-play"
      :disabled="!timelineUsable"
      :aria-disabled="!timelineUsable"
      :title="timelineUsable ? undefined : $t('recon.map.playback.timeline_unavailable')"
      :aria-label="$t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play')"
      @click="emit('toggle-play')"
    >
      <component :is="props.playing ? Pause : Play" class="pb-icon" :size="16" aria-hidden="true" />
      <span class="pb-control-label">{{ $t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}</span>
    </button>
    <template v-if="props.stepSeconds > 0">
      <button type="button" class="pb-btn" data-test="pb-back5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.back_seconds', { seconds: props.stepSeconds })" @click="emit('step', -props.stepSeconds)">−{{ props.stepSeconds }}</button>
      <button type="button" class="pb-btn" data-test="pb-fwd5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.forward_seconds', { seconds: props.stepSeconds })" @click="emit('step', props.stepSeconds)">+{{ props.stepSeconds }}</button>
    </template>
    <div class="pb-speed" role="group" :aria-label="$t('recon.map.playback.speed')">
      <button
        v-for="option in props.speeds"
        :key="option"
        type="button"
        class="pb-btn"
        :class="{ active: props.speed === option }"
        :aria-pressed="props.speed === option ? 'true' : 'false'"
        :data-test="'pb-speed-' + option"
        :aria-label="$t('recon.map.playback.speed_option', { speed: option })"
        @click="emit('set-speed', option)"
      >{{ option }}×</button>
    </div>
    <span class="pb-time" data-test="pb-time">{{ props.formatClock(elapsed) }} / {{ props.formatClock(total) }}</span>
    <span v-if="!timelineUsable" class="pb-unavailable" data-test="pb-play-unavailable" role="status">{{ $t('recon.map.playback.timeline_unavailable') }}</span>
    <slot name="actions" />
  </div>
  <PlaybackTimeline
    :current-time="props.currentTime"
    :start-time="props.startTime"
    :duration="props.duration"
    :disabled="!timelineUsable"
    @drag-start="emit('scrub-start')"
    @drag-end="emit('scrub-end')"
    @seek="emit('seek', $event)"
  />
</template>

<style scoped>
.pb-controls { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }
.pb-speed { display: inline-flex; gap: 2px; }

.pb-btn,
:slotted(.pb-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  cursor: pointer;
}

.pb-btn.active,
:slotted(.pb-btn.active) {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.pb-btn:disabled,
:slotted(.pb-btn:disabled) { opacity: .45; cursor: not-allowed; }

.pb-btn:focus-visible,
:slotted(.pb-btn:focus-visible) { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.pb-icon { flex: none; }
.pb-unavailable { flex-basis: 100%; color: var(--color-text-tertiary); font: var(--type-caption); }
.pb-time { margin-inline: auto; color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* rail 是竖向窄列：按钮铺满宽度，速度档位排成一行；插槽里与 rail 图标导航重复的按钮由使用方隐藏 */
.pb-controls-rail-mode { flex-direction: column; align-items: stretch; gap: var(--space-2); }
.pb-controls-rail-mode .pb-btn { width: 100%; }
.pb-controls-rail-mode .pb-speed { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; }
.pb-controls-rail-mode .pb-speed .pb-btn { padding: 0; }
.pb-controls-rail-mode .pb-time { margin-inline: 0; text-align: center; }
/* column 方向的 flex-basis:100% 等于撑满整列高度，必须还原成内容高度 */
.pb-controls-rail-mode .pb-unavailable { flex-basis: auto; }

@media (width < 768px) {
  .pb-controls { justify-content: center; }
  .pb-btn,
  :slotted(.pb-btn) { min-width: var(--control-h-md); min-height: var(--control-h-md); padding: 0 var(--space-1); }
  .pb-control-label { display: none; }
  .pb-time { flex-basis: 100%; margin-inline: 0; text-align: center; order: 20; }
}

/* 触屏：任何形态下控件都满足 44px 点击区域（--hit-min 在 pointer: coarse 下为 44px） */
@media (pointer: coarse) {
  .pb-btn,
  :slotted(.pb-btn) { min-width: var(--hit-min); min-height: var(--hit-min); }
}
</style>
