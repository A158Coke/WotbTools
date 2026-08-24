<script setup>
import { computed } from 'vue'

/**
 * 七维 Rating 雷达图（plan §10）：原生 SVG，无 canvas blur，responsive。
 * - 每个轴使用归一化百分比 score / dimensionMax * 100（plan §10.2），所有轴 0–100% 可比较。
 * - 轴序与后端 LeagueColumns.DIM_KEYS 一致：伤害/助攻/击杀/换血/阻挡/存活互换/射击。
 * - 未来 Compare 扩展：props 只暴露 primary（+ optional comparison），当前不实现双 polygon（plan §35）。
 */
const props = defineProps({
  /** 七维分数数组（原始分数，顺序与 axes 对齐）。 */
  scores: { type: Array, default: () => [] },
  /** 七维满分数组（与 scores 对齐；缺省按后端 MAX 常量）。 */
  maxes: {
    type: Array,
    default: () => [400, 100, 100, 150, 50, 100, 100],
  },
  /** 轴显示标签（默认由父组件传 i18n 后的标签）。 */
  labels: { type: Array, default: () => [] },
  /** 尺寸（px，正方形；responsive：组件自身用 CSS width 100%）。 */
  size: { type: Number, default: 300 },
})

const CENTER = 150
const RADIUS = 120

const axisCount = computed(() => 7)

/** 每个轴的归一化百分比 [0, 1]，缺失/非有限 → 0。 */
const normalized = computed(() => {
  return props.scores.map((s, i) => {
    const max = Number(props.maxes[i]) || 0
    const v = Number(s)
    if (max <= 0 || !Number.isFinite(v) || v <= 0) return 0
    return Math.max(0, Math.min(1, v / max))
  })
})

/** 轴角度：从 12 点方向顺时针。 */
function angle(i) {
  return (Math.PI * 2 * i) / axisCount.value - Math.PI / 2
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

/** 数据多边形（归一化百分比半径）。 */
const polygonPoints = computed(() => {
  return normalized.value.map((ratio, i) => point(i, ratio).join(',')).join(' ')
})

/** 轴端点标签位置（radius 1.16）。 */
const labelPositions = computed(() => {
  return Array.from({ length: axisCount.value }, (_, i) => {
    const [x, y] = point(i, 1.16)
    return { x, y, label: props.labels[i] || '' }
  })
})
</script>

<template>
  <div class="player-radar" role="img" :aria-label="'Rating radar: ' + (labels || []).join(', ')">
    <svg :viewBox="'0 0 ' + size + ' ' + size" class="radar-svg">
      <!-- 网格：100% 外圈 + 50% 内圈 + 轴线 -->
      <polygon :points="gridPoints" class="radar-grid-outer" />
      <polygon :points="gridHalfPoints" class="radar-grid-inner" />
      <line v-for="i in 7" :key="'axis-' + i"
            :x1="CENTER" :y1="CENTER"
            :x2="point(i - 1, 1)[0]" :y2="point(i - 1, 1)[1]"
            class="radar-axis" />
      <!-- 数据多边形 -->
      <polygon :points="polygonPoints" class="radar-data" />
      <!-- 数据顶点 -->
      <circle v-for="i in 7" :key="'dot-' + i"
              :cx="point(i - 1, normalized[i - 1] || 0)[0]"
              :cy="point(i - 1, normalized[i - 1] || 0)[1]"
              r="3" class="radar-dot" />
      <!-- 轴标签 -->
      <text v-for="(p, i) in labelPositions" :key="'label-' + i"
            :x="p.x" :y="p.y" text-anchor="middle" dominant-baseline="middle"
            class="radar-label">{{ p.label }}</text>
    </svg>
    <!-- 维度 detail：原始分 / Max · 百分比（plan §10.3） -->
    <ul v-if="scores.length" class="radar-details">
      <li v-for="(label, i) in labels" :key="i">
        <span class="rd-name">{{ label }}</span>
        <span class="rd-value">{{ Math.round(Number(scores[i]) || 0) }} / {{ maxes[i] }} ·
          {{ Math.round(1000 * (normalized[i] || 0)) / 10 }}%</span>
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
