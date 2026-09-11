<script setup>
defineOptions({ name: 'PlaybackTimeline' })

const props = defineProps({
  currentTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  /** duration<=0（timeline 不可用）时进度条也必须显式禁用，否则拖动是 silent no-op。 */
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['drag-start', 'seek'])
</script>

<template>
  <div class="pb-progress" data-test="pb-progress" @pointerdown.stop @click.stop>
    <input class="pb-range" type="range" min="0" :max="props.duration || 1" step="0.1" :value="props.currentTime" :disabled="props.disabled" :aria-label="$t('recon.map.playback.progress')" @pointerdown="emit('drag-start')" @mousedown="emit('drag-start')" @touchstart="emit('drag-start')" @input="emit('seek', Number($event.target.value))" />
  </div>
</template>

<style scoped>
.pb-progress { position: relative; width: 100%; margin: 2px 0; }
/* §overflow：UA 给 input[type=range] 带 2px margin，和 width:100% 相加就是页面级横向溢出
   （1024 视口上实测 scrollWidth 1026，越界元素正是这个 input）。上下间距已由 .pb-progress
   承担，这里必须归零，宽度契约才和容器完全一致。 */
.pb-range { display: block; width: 100%; margin: 0; }
.pb-range:disabled { opacity: .45; cursor: not-allowed; }
</style>
