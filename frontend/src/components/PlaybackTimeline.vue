<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { nearestTickTime, tickPercentToTime } from '../utils/playbackShortcuts.ts'

defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  /** 时间轴起点（绝对秒；3D 场景从 t_start 开始） */
  startTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  /** timeline 不可用时进度条也必须显式禁用，否则拖动是 silent no-op。 */
  disabled: { type: Boolean, default: false },
  /**
   * 炮击刻度（utils/playbackShortcuts.js 的 buildShotTicks 产物：{ t, pct, highlight }）。
   * pct 已按本组件同款 min/max 语义换算；空数组 = 无刻度层（2D 未接线时保持原样）。
   */
  shotTicks: { type: Array, default: () => [] },
  /** 击毁刻度（buildKillTicks 产物：{ t, pct }），异色点。 */
  killTicks: { type: Array, default: () => [] },
  /** 是否渲染事件刻度层；回放面板统一开关控制，默认关闭（原生时间轴 seek 不受影响）。 */
  showEventMarkers: { type: Boolean, default: false },
  /** 快捷键说明（tooltip）：宿主按需传入，缺省无提示。 */
  hint: { type: String, default: '' },
})

const emit = defineEmits(['drag-start', 'drag-end', 'seek'])

/**
 * 拖动期间显示用户手里的值，不跟随外部每帧写回的 currentTime：
 * 否则场景 tick 会把滑块拽回去，和用户的拖动打架（3D 原先为此改用非受控输入）。
 */
const dragValue = ref(null)
const shownValue = computed(() => dragValue.value ?? props.currentTime)
const max = computed(() => (props.duration > props.startTime ? props.duration : props.startTime + 1))
/** 刻度层只在开启事件信息且时间轴可用时呈现：退化时间轴（duration<=start）上刻度会全挤在 0%，纯属误导。 */
const ticksVisible = computed(() => props.showEventMarkers && !props.disabled && props.duration > props.startTime
  && (props.shotTicks.length > 0 || props.killTicks.length > 0))

/**
 * 刻度点击 = seek 到该事件时刻（与拖动 seek 同一事件；seek 语义不改播放状态）。
 *
 * 命中面是**单一底部命中条**而不是逐刻度命中区：密集炮击场每发 4–8px 的命中区会
 * 叠满整条轨道、把滑块拖动完全挡死（实测口径：5 分钟 7v7 约 400 发 ≈ 全覆盖）。
 * 命中条只占拇指带以下的底部窄条，吸附半径按固定像素换算——刻度多密拖动都不受影响。
 */
const TICK_SNAP_PX = 5
function onTickStripClick(event) {
  const rect = event.currentTarget?.getBoundingClientRect?.()
  const width = Number(rect?.width)
  if (!(width > 0)) return
  const clientX = Number(event.clientX)
  if (!Number.isFinite(clientX)) return
  const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / width) * 100))
  const tolerance = (TICK_SNAP_PX / width) * 100
  const snapped = nearestTickTime([...props.shotTicks, ...props.killTicks], pct, tolerance)
  const target = snapped ?? tickPercentToTime(pct, props.startTime, props.duration)
  if (target != null) emit('seek', target)
}

function onPointerDown() {
  dragValue.value = props.currentTime
  emit('drag-start')
  // 松手可能发生在滑块之外（鼠标拖出去再放开），所以在 window 上等这一次 pointerup / pointercancel
  window.addEventListener('pointerup', endDrag, { once: true })
  window.addEventListener('pointercancel', endDrag, { once: true })
}

function onInput(event) {
  const value = Number(event.target.value)
  if (dragValue.value !== null) dragValue.value = value
  emit('seek', value)
}

function endDrag() {
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  if (dragValue.value === null) return
  dragValue.value = null
  emit('drag-end')
}

onBeforeUnmount(endDrag)
</script>

<template>
  <div class="pb-progress" data-test="pb-progress" data-tour="playback-timeline" :title="props.hint || undefined" @pointerdown.stop @click.stop>
    <input
      class="pb-range"
      type="range"
      :min="props.startTime"
      :max="max"
      step="0.1"
      :value="shownValue"
      :disabled="props.disabled"
      :aria-label="$t('recon.map.playback.progress')"
      @pointerdown="onPointerDown"
      @blur="endDrag"
      @input="onInput"
    />
    <!-- 事件刻度层（blitzinfo 式）：炮击细竖线（作者/跟随者加粗高亮）+ 击毁异色点。
         刻度本体纯视觉（不拦指针）；点击吸附归底部单一命中条——刻度再密也不挡拖动。
         键盘路径由 ,/. 跳炮击承担，刻度本身不进 tab 序（aria-hidden）。 -->
    <div v-if="ticksVisible" class="pb-tick-layer" aria-hidden="true" data-test="pb-ticks">
      <div
        v-for="(tick, index) in props.shotTicks"
        :key="'s' + index"
        class="pb-tick-shot"
        :class="{ 'pb-tick-shot-highlight': tick.highlight }"
        :style="{ left: tick.pct + '%' }"
      ></div>
      <div
        v-for="(tick, index) in props.killTicks"
        :key="'k' + index"
        class="pb-tick-kill"
        :style="{ left: tick.pct + '%' }"
      ></div>
      <div class="pb-tick-hit" @click="onTickStripClick"></div>
    </div>
  </div>
</template>

<style scoped>
.pb-progress { position: relative; width: 100%; margin: var(--space-1) 0; }

/* §overflow：UA 给 input[type=range] 带 2px margin，和 width:100% 相加就是页面级横向溢出
   （1024 视口上实测 scrollWidth 1026，越界元素正是这个 input）。上下间距已由 .pb-progress
   承担，这里必须归零，宽度契约才和容器完全一致。 */
.pb-range { display: block; width: 100%; min-block-size: var(--hit-min); margin: 0; accent-color: var(--color-accent); }
.pb-range:disabled { opacity: .45; cursor: not-allowed; }

/* 事件刻度层：绝对定位覆盖滑块；整层与刻度本体都不拦指针（刻度再密也不挡滑块拖动），
   点击吸附归底部的单一命中条 .pb-tick-hit。刻度位置来自 utils/playbackShortcuts.js
   的同一 min/max 语义换算（pct 0..100）。 */
.pb-tick-layer { position: absolute; inset: 0; z-index: var(--pb-z-hud); pointer-events: none; user-select: none; }
/* 炮击刻度：细竖线居中，宽 4px 命中余量纯属视觉（本体不可点）。 */
.pb-tick-shot {
  position: absolute;
  inset-block: 0;
  inline-size: 4px;
  transform: translateX(-50%);
}
.pb-tick-shot::before {
  content: '';
  position: absolute;
  inset-inline-start: 50%;
  inset-block: 0;
  inline-size: 2px;
  transform: translateX(-50%);
  background: var(--color-text-tertiary);
  opacity: .5;
}
/* 作者本人 / 当前跟随者的炮击：加粗高亮（accent）。 */
.pb-tick-shot-highlight::before { inline-size: 3px; background: var(--color-accent); opacity: 1; }
/* 击毁刻度：底部异色小圆点（压在同刻炮击线之上）。
   corner-shape: round 与 border-radius 同条声明——squircle 渐进增强守护（corner-shape.test.js）。 */
.pb-tick-kill {
  position: absolute;
  inset-block-end: 0;
  inline-size: 8px;
  block-size: 8px;
  transform: translateX(-50%);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-danger);
}
/* 单一命中条：底部窄条（拇指带以下），整条宽度捕获点击 → 就近吸附刻度 / 按比例 seek。
   5px 吸附半径是固定几何常量（不随刻度密度变化）。 */
.pb-tick-hit {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 12px;
  pointer-events: auto;
  cursor: pointer;
}
</style>
