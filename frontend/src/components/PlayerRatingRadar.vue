<script setup>
import { computed } from 'vue'

/**
 * 选手画像雷达图（review PR#134 BLOCKER 6.14）：动态指标轴（默认七维 League Rating，
 * 用户可自定义指标与顺序）。只负责 geometry / labels / polygon / detail 渲染，
 * 不负责任何业务公式——normalization 由 Radar Metric Registry（utils/radarMetrics.js）
 * 在父组件适配层完成，本组件只消费 {key,label,rawValue,normalized,displayValue,available}。
 *
 * - 轴序 = props.metrics 顺序（用户自定义，BLOCKER 6.3/6.9）。
 * - available:false 的轴：detail 显示 '--'，不绘制该顶点（不冒充 0/0%）；polygon 只连接
 *   实际 available 的顶点（BLOCKER 6.12 partial availability）。
 * - 禁止 current-batch-max normalization（BLOCKER 6.7）：normalized 由 registry 稳定给出。
 */
const props = defineProps({
  /** 轴数据（顺序即绘制顺序）。 */
  metrics: { type: Array, default: () => [] },
  /** 尺寸（px，正方形；responsive：组件自身用 CSS width 100%）。 */
  size: { type: Number, default: 300 },
})

const CENTER = 150
const RADIUS = 120

const axisCount = computed(() => props.metrics.length)

/** 每个轴归一化比例（unavailable → null；不参与 polygon，不当作 0）。 */
const normalized = computed(() =>
  props.metrics.map(m => (m.available ? Math.max(0, Math.min(1, m.normalized)) : null)))

const availableCount = computed(() => props.metrics.filter(m => m.available).length)

/** 轴角度：从 12 点方向顺时针。 */
function angle(i) {
  return (Math.PI * 2 * i) / Math.max(axisCount.value, 1) - Math.PI / 2
}

function point(i, ratio) {
  const r = RADIUS * ratio
  return [CENTER + r * Math.cos(angle(i)), CENTER + r * Math.sin(angle(i))]
}

/** 外圈网格（100% 圆环顶点）。 */
const gridPoints = computed(() => {
  return Array.from({ length: axisCount.value }, (_, i) => point(i, 1).join(',')).join(' ')
})

/** 50% 网格环。 */
const gridHalfPoints = computed(() => {
  return Array.from({ length: axisCount.value }, (_, i) => point(i, 0.5).join(',')).join(' ')
})

/** 数据多边形：只连接实际 available 的顶点（BLOCKER 6.12）。 */
const polygonPoints = computed(() => {
  return props.metrics
    .map((m, i) => ({ i, ratio: normalized.value[i] }))
    .filter(p => p.ratio != null)
    .map(p => point(p.i, p.ratio).join(','))
    .join(' ')
})

/** 轴端点标签位置（radius 1.16）。 */
const labelPositions = computed(() => {
  return Array.from({ length: axisCount.value }, (_, i) => {
    const [x, y] = point(i, 1.16)
    return { x, y, label: props.metrics[i]?.label || '' }
  })
})
</script>

<template>
  <div class="player-radar" role="img" :aria-label="'Radar: ' + (metrics || []).map(m => m.label).join(', ')">
    <svg :viewBox="'0 0 ' + size + ' ' + size" class="radar-svg">
      <!-- 网格：100% 外圈 + 50% 内圈 + 轴线 -->
      <polygon :points="gridPoints" class="radar-grid-outer" />
      <polygon :points="gridHalfPoints" class="radar-grid-inner" />
      <line v-for="i in axisCount" :key="'axis-' + i"
            :x1="CENTER" :y1="CENTER"
            :x2="point(i - 1, 1)[0]" :y2="point(i - 1, 1)[1]"
            class="radar-axis" />
      <!-- 数据多边形（只连接 available 顶点） -->
      <polygon :points="polygonPoints" class="radar-data" />
      <!-- 数据顶点（unavailable 不画点） -->
      <template v-for="i in axisCount" :key="'dot-' + i">
        <circle v-if="normalized[i - 1] != null"
                :cx="point(i - 1, normalized[i - 1])[0]"
                :cy="point(i - 1, normalized[i - 1])[1]"
                r="3" class="radar-dot" />
      </template>
      <!-- 轴标签 -->
      <text v-for="(p, i) in labelPositions" :key="'label-' + i"
            :x="p.x" :y="p.y" text-anchor="middle" dominant-baseline="middle"
            class="radar-label">{{ p.label }}</text>
    </svg>
    <!-- 轴 detail：displayValue（缺失 → '--'，不冒充 0/0%） -->
    <ul v-if="metrics.length" class="radar-details">
      <li v-for="(m, i) in metrics" :key="i">
        <span class="rd-name">{{ m.label }}</span>
        <span class="rd-value">{{ m.displayValue || '--' }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.player-radar { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.radar-svg { width: 100%; max-width: 320px; aspect-ratio: 1 / 1; }
.radar-grid-outer { fill: none; stroke: var(--border-light); stroke-width: 1; }
.radar-grid-inner { fill: none; stroke: var(--border-light); stroke-width: 1; stroke-dasharray: 3 3; }
.radar-axis { stroke: var(--border-light); stroke-width: 1; }
.radar-data { fill: color-mix(in srgb, var(--accent) 28%, transparent); stroke: var(--accent); stroke-width: 2; }
.radar-dot { fill: var(--accent); }
.radar-label { fill: var(--text-sub); font-size: 11px; font-weight: 600; }
.radar-details { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 4px 14px; }
.radar-details li { display: flex; justify-content: space-between; gap: 8px; font-size: .76rem; color: var(--text-sub); }
.rd-value { font-variant-numeric: tabular-nums; color: var(--text-heading); font-weight: 600; white-space: nowrap; }
</style>
