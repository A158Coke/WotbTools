<script setup>
import { computed } from 'vue'
import { consumableIconUrl } from '../utils/consumableIcons.js'

/**
 * 血量条旁的一个定时消耗品状态徽标：图标 + 剩余时间环。
 *
 * - 环 = 剩余时间 / 当前状态总时长（ACTIVE 是持续时间，COOLDOWN 是冷却时长）。
 * - 只由 `consumableRuntimeAt` 的 ACTIVE/COOLDOWN 且 durationSec>0 条目驱动；
 *   瞬发消耗品不会进来。
 * - 不显示 raw wire/logical ID；无图时用同色几何点回退。
 */
const props = defineProps({
  logicalItemId: { type: String, default: null },
  state: { type: String, default: 'ACTIVE' },
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
const badgeClass = computed(() => (props.state === 'COOLDOWN' ? 'is-cooldown' : 'is-active'))
</script>

<template>
  <span class="pb-consumable-badge" :class="badgeClass" data-test="pb-consumable-badge"
    :data-state="state" aria-hidden="true">
    <svg class="pb-consumable-ring" viewBox="0 0 20 20">
      <circle class="pb-consumable-ring-track" cx="10" cy="10" r="8" />
      <circle class="pb-consumable-ring-fill" cx="10" cy="10" r="8"
        :stroke-dasharray="RING_LEN" :stroke-dashoffset="dashOffset" />
    </svg>
    <img v-if="iconUrl" class="pb-consumable-icon" :src="iconUrl" alt="" width="12" height="12" />
    <span v-else class="pb-consumable-fallback"></span>
  </span>
</template>

<style scoped>
.pb-consumable-badge {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: var(--space-4);
  height: var(--space-4);
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
  stroke-width: calc(var(--space-1) / 2);
}
.pb-consumable-ring-fill {
  fill: none;
  stroke: currentColor;
  stroke-width: calc(var(--space-1) / 2);
  stroke-linecap: round;
  transition: stroke-dashoffset var(--duration-fast) linear;
}
.pb-consumable-icon {
  position: relative;
  width: var(--space-3);
  height: var(--space-3);
  object-fit: contain;
  border-radius: var(--radius-full);
}
.pb-consumable-fallback {
  position: relative;
  width: var(--space-1);
  height: var(--space-1);
  border-radius: var(--radius-full);
  background: currentColor;
  opacity: .6;
}
/* 冷却期保留图标与环（用户能看出"刚用过/还要等"）：环改中性白 + 降一档强度，
   与激活期的队伍色环区分。 */
.pb-consumable-badge.is-cooldown {
  color: var(--color-playback-label-text);
  opacity: .55;
}
@media (prefers-reduced-motion: reduce) {
  .pb-consumable-ring-fill { transition: none; }
}
</style>
