<script setup>
import { computed } from 'vue'
import { consumableIconUrl } from '../utils/consumableIcons.js'

/**
 * 血量条旁的一个**正在生效**的定时消耗品徽标：图标 + 剩余时间环。
 *
 * - 只在 `consumableRuntimeAt` 给出激活窗口（ACTIVATED 且 duration>0）时渲染；
 *   冷却/未使用/瞬发都不会进来。
 * - 环 = 剩余时间 / 本次激活总时长。
 * - 不显示 raw wire/logical ID；无图时用同色几何点回退。
 */
const props = defineProps({
  logicalItemId: { type: String, default: null },
  remainingSec: { type: Number, required: true },
  durationSec: { type: Number, required: true },
})

const RING_R = 8
const RING_LEN = 2 * Math.PI * RING_R
const fraction = computed(() => {
  if (!(Number.isFinite(props.durationSec) && props.durationSec > 0)) return 0
  return Math.max(0, Math.min(1, props.remainingSec / props.durationSec))
})
const dashOffset = computed(() => RING_LEN * (1 - fraction.value))
const iconUrl = computed(() => consumableIconUrl(props.logicalItemId))
</script>

<template>
  <span class="pb-consumable-badge" data-test="pb-consumable-badge" aria-hidden="true">
    <svg class="pb-consumable-ring" viewBox="0 0 20 20">
      <circle class="pb-consumable-ring-track" cx="10" cy="10" r="8" />
      <circle class="pb-consumable-ring-fill" cx="10" cy="10" r="8"
        :stroke-dasharray="RING_LEN" :stroke-dashoffset="dashOffset" />
    </svg>
    <img v-if="iconUrl" class="pb-consumable-icon" :src="iconUrl" alt="" width="20" height="20" />
    <span v-else class="pb-consumable-fallback"></span>
  </span>
</template>

<style scoped>
.pb-consumable-badge {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--space-8);
  height: var(--space-8);
  color: inherit;
  pointer-events: none;
}
/* 环从 12 点方向开始顺时针消耗：SVG 整体旋转 -90°，dashoffset 走剩余比例。 */
.pb-consumable-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  overflow: visible;
}
.pb-consumable-ring-track {
  fill: none;
  stroke: var(--color-playback-label-track);
  stroke-width: 2;
}
.pb-consumable-ring-fill {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--duration-fast) linear;
}
.pb-consumable-icon {
  position: relative;
  width: var(--space-5);
  height: var(--space-5);
  object-fit: contain;
  border-radius: var(--radius-full);
}
.pb-consumable-fallback {
  position: relative;
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: .6;
}
@media (prefers-reduced-motion: reduce) {
  .pb-consumable-ring-fill { transition: none; }
}
</style>
