<script setup>
// 2D / 3D 回放共用的播放传输控件：播放/暂停 · ±N 秒 · 速度档位 · 时间 · 进度条。
// 只管"时间轴"本身；各形态特有的按钮（2D 的面板 / 标注 / 重置 / 全屏，3D 的相机 / GLB / 标签）
// 通过 actions 插槽放进同一行，样式经 :slotted 统一。
// 类名沿用 2D 的 pb-*：playback-*.css 的手机 / 全屏 / rail 布局按这些类名排版，不能改。
import { computed, ref, watch } from 'vue'
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
  /**
   * 紧凑档（窄视口）：速度档位改为**渐进披露**——只常驻显示当前值，点开才列出全部档位。
   * 这是共享传输控件的一条形态，不是移动端专属的第二套播放器：状态（speed）与事件
   * （set-speed）与宽档完全一致，只有呈现不同。
   */
  compact: Boolean,
  formatClock: { type: Function, default: formatPlaybackClock },
})

const emit = defineEmits(['toggle-play', 'step', 'set-speed', 'seek', 'scrub-start', 'scrub-end'])

/** 紧凑档的速度菜单开合；选中或点空白即收起（与 MenuButton 同口径的渐进披露） */
const speedOpen = ref(false)
const speedRoot = ref(null)
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
  <div class="pb-controls" :class="{ 'pb-controls-rail-mode': props.railMode, 'phone-form': props.compact }" data-test="pb-controls" @pointerdown.stop @click.stop>
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
    <div v-if="!props.compact" class="pb-speed" role="group" :aria-label="$t('recon.map.playback.speed')">
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
    <!-- 紧凑档：只常驻当前速度，点开列出全部档位（渐进披露，不永久占一行） -->
    <div v-else ref="speedRoot" class="pb-speed-picker">
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
  gap: 2px;
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
}
.pb-speed-item { min-inline-size: calc(var(--hit-min) + var(--space-4)); }

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
/* 速度档位一行排开：列数跟随档位个数（grid-auto-flow: column），不再硬编码——档位从 4 增到 5 时
   固定 4 列会把 8× 挤到第二行。触屏点击区域不压缩（下方 coarse 规则保证 44px）：放不下的问题由
   rail 自己解决——BattlePlayback 在触屏上把 rail 宽度下限抬到「档位数 × 44px + 间距 + padding」。 */
.pb-controls-rail-mode .pb-speed { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 3px; }
.pb-controls-rail-mode .pb-speed .pb-btn { padding: 0; }
.pb-controls-rail-mode .pb-time { margin-inline: 0; text-align: center; }
/* column 方向的 flex-basis:100% 等于撑满整列高度，必须还原成内容高度 */
.pb-controls-rail-mode .pb-unavailable { flex-basis: auto; }

/* compact follows the shared Playback phone form, including fullscreen landscape. */
.pb-controls.phone-form { justify-content: center; }
.phone-form .pb-btn,
.phone-form :slotted(.pb-btn) { min-width: var(--control-h-md); min-height: var(--control-h-md); padding: 0 var(--space-1); }
.phone-form .pb-control-label { display: none; }

/**
 * 手机紧凑档的两级布局（视觉验收确定的产品契约）：
 *
 *     00:16 / 02:23                     ← 时间读数独占一行（紧跟时间轴）
 *     -5   ▶   +5   1×   ⛶   ⚙        ← 一级动作行：必须**同一行**
 *
 * 实测宽度账（390px 视口、--space-1=4px）：可用约 372px，容器内边距 16px + gap 4px×5=20px
 * ⇒ 按钮共 336px。触屏下每个按钮 --hit-min=44px，六个动作正好 264px —— 本来放得下。
 * 但时间读数（`00:16 / 02:23`）约 110px：留在同一行就把最后一个按钮（⚙）挤到第二行，
 * 正是验收看到的「齿轮自己掉下去」。
 *
 * 所以时间读数在手机档独占一行：`flex-basis: 100%` 触发换行，`order: -1` 排到动作行之前。
 * **不缩小触屏命中区**（coarse 规则仍保证 44px），只是把非动作元素挪出动作行。
 * 与 3D 的 `.phone-form .controls` 规则同口径——两端同一套行为。
 */
.phone-form .pb-time {
  flex-basis: 100%;
  margin-inline: 0;
  text-align: center;
  order: -1;
}

/* 触屏：任何形态下控件都满足 44px 点击区域（--hit-min 在 pointer: coarse 下为 44px） */
@media (pointer: coarse) {
  .pb-btn,
  :slotted(.pb-btn) { min-width: var(--hit-min); min-height: var(--hit-min); }
}
</style>
