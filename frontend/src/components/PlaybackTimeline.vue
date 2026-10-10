<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  /** 时间轴起点（绝对秒；3D 场景从 t_start 开始） */
  startTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  /** timeline 不可用时进度条也必须显式禁用，否则拖动是 silent no-op。 */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['drag-start', 'drag-end', 'seek'])

/**
 * 拖动期间显示用户手里的值，不跟随外部每帧写回的 currentTime：
 * 否则场景 tick 会把滑块拽回去，和用户的拖动打架（3D 原先为此改用非受控输入）。
 */
const dragValue = ref(null)
const shownValue = computed(() => dragValue.value ?? props.currentTime)
const max = computed(() => (props.duration > props.startTime ? props.duration : props.startTime + 1))

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
  <div class="pb-progress" data-test="pb-progress" data-tour="playback-timeline" @pointerdown.stop @click.stop>
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
  </div>
</template>

<style scoped>
.pb-progress { position: relative; width: 100%; margin: var(--space-1) 0; }

/* §overflow：UA 给 input[type=range] 带 2px margin，和 width:100% 相加就是页面级横向溢出
   （1024 视口上实测 scrollWidth 1026，越界元素正是这个 input）。上下间距已由 .pb-progress
   承担，这里必须归零，宽度契约才和容器完全一致。 */
.pb-range { display: block; width: 100%; min-block-size: var(--hit-min); margin: 0; accent-color: var(--color-accent); }
.pb-range:disabled { opacity: .45; cursor: not-allowed; }
</style>
