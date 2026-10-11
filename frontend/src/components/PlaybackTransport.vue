<script setup>
// Shared primary composition: −5 / Play / +5 / current speed / Fullscreen / Display.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Maximize2, Minimize2, Pause, Play, SlidersHorizontal } from 'lucide-vue-next'
import PlaybackTimeline from './PlaybackTimeline.vue'
import { formatPlaybackClock } from '../utils/playbackClock'
import { PLAYBACK_SPEEDS } from '../composables/usePlaybackTransport.js'

defineOptions({ name: 'PlaybackTransport' })

const props = defineProps({
  playing: Boolean,
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  displayOpen: Boolean,
  displayEnabled: Boolean,
  speed: { type: Number, default: 1 },
  speeds: { type: Array, default: () => PLAYBACK_SPEEDS },
  currentTime: { type: Number, default: 0 },
  /** 时间轴起点（3D 场景的 t_start 不一定是 0）；duration 是终点（绝对时间） */
  startTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  /** 前进 / 后退的秒数；0 = 不显示这两个按钮 */
  stepSeconds: { type: Number, default: 5 },
  /** Phone-form styling, including fullscreen landscape. */
  compact: Boolean,
  formatClock: { type: Function, default: formatPlaybackClock },
})

const emit = defineEmits(['toggle-play', 'step', 'set-speed', 'seek', 'scrub-start', 'scrub-end', 'toggle-fullscreen', 'toggle-display'])

/** 紧凑档的速度菜单开合；选中或点空白即收起（与 MenuButton 同口径的渐进披露） */
const speedOpen = ref(false)
const speedRoot = ref(null)
const gearEl = ref(null)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))
function chooseSpeed(option) {
  speedOpen.value = false
  emit('set-speed', option)
}
function onDocPointerDown(event) {
  if (!speedOpen.value) return
  if (!speedRoot.value?.contains(event.target)) speedOpen.value = false
}
watch(speedOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.addEventListener('pointerdown', onDocPointerDown, true)
  else document.removeEventListener('pointerdown', onDocPointerDown, true)
})

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
  <PlaybackTimeline
    :current-time="props.currentTime"
    :start-time="props.startTime"
    :duration="props.duration"
    :disabled="!timelineUsable"
    @drag-start="emit('scrub-start')"
    @drag-end="emit('scrub-end')"
    @seek="emit('seek', $event)"
  />
  <div class="pb-controls" :class="{ 'phone-form': props.compact }" data-test="pb-controls" data-tour="playback-transport" @pointerdown.stop @click.stop>
    <button v-if="props.stepSeconds > 0" type="button" class="pb-btn" data-test="pb-back5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.back_seconds', { seconds: props.stepSeconds })" @click="emit('step', -props.stepSeconds)">−{{ props.stepSeconds }}</button>
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
    </button>
    <button v-if="props.stepSeconds > 0" type="button" class="pb-btn" data-test="pb-fwd5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.forward_seconds', { seconds: props.stepSeconds })" @click="emit('step', props.stepSeconds)">+{{ props.stepSeconds }}</button>
    <div ref="speedRoot" class="pb-speed-picker">
      <button
        type="button" class="pb-btn pb-speed-current" :aria-expanded="speedOpen"
        aria-haspopup="menu" data-test="pb-speed-current"
        :aria-label="$t('recon.map.playback.speed_option', { speed: props.speed })"
        @click="speedOpen = !speedOpen"
      >{{ props.speed }}×</button>
      <div v-if="speedOpen" class="pb-speed-menu" role="menu" :aria-label="$t('recon.map.playback.speed')" data-test="pb-speed-menu">
        <button
          v-for="option in props.speeds"
          :key="option"
          type="button" role="menuitemradio"
          class="pb-btn pb-speed-item"
          :class="{ active: props.speed === option }"
          :aria-checked="props.speed === option ? 'true' : 'false'"
          :data-test="'pb-speed-' + option"
          :aria-label="$t('recon.map.playback.speed_option', { speed: option })"
          @click="chooseSpeed(option)"
        >{{ option }}×</button>
      </div>
    </div>
    <button v-if="props.fullscreenSupported" type="button" class="pb-btn pb-fullscreen-btn" data-test="pb-fullscreen" data-testid="playback-fullscreen" :aria-pressed="props.isFullscreen" :aria-label="$t(props.isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')" @click="emit('toggle-fullscreen')">
      <component :is="props.isFullscreen ? Minimize2 : Maximize2" :size="16" aria-hidden="true" />
    </button>
    <button v-if="props.displayEnabled" ref="gearEl" type="button" class="pb-btn pb-secondary-entry" data-test="pb-secondary-entry" data-testid="display-toggle" data-tour="playback-display" :aria-expanded="props.displayOpen" aria-haspopup="dialog" :aria-label="$t('recon.map.playback.panel_display')" @click="emit('toggle-display', gearEl)">
      <SlidersHorizontal :size="16" aria-hidden="true" />
    </button>
    <span class="pb-time" data-test="pb-time">{{ props.formatClock(elapsed) }} / {{ props.formatClock(total) }}</span>
    <span v-if="!timelineUsable" class="pb-unavailable" data-test="pb-play-unavailable" role="status">{{ $t('recon.map.playback.timeline_unavailable') }}</span>
  </div>

</template>

<style scoped>
.pb-controls { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }

/* 紧凑档速度选择器：当前值常驻 + 向上展开的档位菜单（绝对定位，不参与控件条高度计算） */
.pb-speed-picker { position: relative; display: inline-flex; }
.pb-speed-menu {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-end: 0;
  /* 与控件条同一层（--pb-z-hud），不再自造数值——它只是控件的一个子菜单，不需要更高层 */
  z-index: var(--pb-z-hud);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
}
.pb-speed-item { min-inline-size: calc(var(--hit-min) + var(--space-4)); }

/* Primary 组合的固有尺寸：--control-h-md 在触屏下就是 44px（fine pointer 下 32px，
   布局按可用空间收紧），不用断点区分形态。 */
.pb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: var(--control-h-md);
  min-width: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  cursor: pointer;
}

.pb-btn.active {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.pb-play-btn { min-inline-size: calc(var(--control-h-md) + var(--space-3)); border-color: var(--color-accent); background: var(--color-accent); color: var(--color-on-accent); }
.pb-btn:hover:not(:disabled) { border-color: var(--color-border-strong); }
.pb-play-btn:hover:not(:disabled) { filter: brightness(1.08); }

.pb-btn:disabled { opacity: .45; cursor: not-allowed; }

.pb-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.pb-icon { flex: none; }
.pb-unavailable { flex-basis: 100%; color: var(--color-text-tertiary); font: var(--type-caption); }
.pb-time { margin-inline: auto; color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* compact 只改对齐与「时间独占一行」：六个 primary action 的触控尺寸由 --control-h-md
   在触屏下已经是 44px（--hit-min），不需要再按形态各写一套。 */
.pb-controls.phone-form { justify-content: center; }
.phone-form .pb-btn { padding: 0 var(--space-1); }
/* Time occupies its own row so all six primary actions remain together. */
.phone-form .pb-time {
  flex-basis: 100%;
  margin-inline: 0;
  text-align: center;
  order: -1;
}
</style>
