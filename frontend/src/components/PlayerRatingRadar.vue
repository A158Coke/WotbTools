<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RADAR, axisPoint, axisRay, polygonPoints, gridPolygonPoints, scaleTickPosition,
} from '../utils/radarGeometry.js'

/**
 * 选手画像雷达图：只消费归一化轴对象（{key,label,rawValue,normalized,displayValue,available}）。
 * 支持 player + reference 双多边形：
 * - player：实线 + 半透明填充 + 顶点圆点（§16）；
 * - reference：细虚线 + 无填充 + 无点（§16）；缺失 → 不画、detail 显示 '--'、提示（§25）。
 * 缺失契约（§24/§67）：player 缺任一所选维 → 整图 unavailable（不伪造闭合多边形）。
 * 几何/刻度/网格共用 utils/radarGeometry.js（与导出同构，§48）。
 */
const { t } = useI18n()

const props = defineProps({
  /** player 轴对象（顺序即绘制顺序）。 */
  metrics: { type: Array, default: () => [] },
  /** 可选 reference 轴对象（与 metrics 同维度同顺序）。 */
  reference: { type: Array, default: null },
  /** reference 系列名（Battle Average / Global Average），用于列头与图例。 */
  referenceLabel: { type: String, default: '' },
  /** player 系列名（昵称），用于图例。 */
  playerLabel: { type: String, default: '' },
  /** Optional caller-specific incomplete-reference text; V5 keeps its existing default. */
  referenceUnavailableLabel: { type: String, default: '' },
})

const playerComplete = computed(() =>
  props.metrics.length > 0 && props.metrics.every(m => m.available))

const referenceComplete = computed(() =>
  !props.reference || props.reference.length === 0 || props.reference.every(m => m.available))

const referenceMissing = computed(() =>
  !!props.reference && props.reference.length > 0 && !referenceComplete.value)

/** player 归一化数组（available 时全可用）。 */
const playerNormals = computed(() =>
  props.metrics.map(m => (m.available ? Math.max(0, Math.min(1, m.normalized)) : null)))

const referenceNormals = computed(() =>
  (props.reference || []).map(m => (m.available ? Math.max(0, Math.min(1, m.normalized)) : null)))

const playerPoints = computed(() => polygonPoints(playerNormals.value, props.metrics.length))
const referencePoints = computed(() => polygonPoints(referenceNormals.value, props.metrics.length))

const gridPolys = computed(() =>
  (RADAR.GRID_LEVELS || []).map(ratio => ({
    ratio,
    points: gridPolygonPoints(props.metrics.length, ratio),
  })))

const axisRays = computed(() =>
  Array.from({ length: props.metrics.length }, (_, i) => axisRay(i, props.metrics.length)))

const labelPositions = computed(() =>
  Array.from({ length: props.metrics.length }, (_, i) => {
    const [x, y] = axisPoint(i, props.metrics.length, RADAR.LABEL_RADIUS, RADAR)
    return { x, y, label: props.metrics[i]?.label || '', tip: props.metrics[i]?.tip || '' }
  }))

const scaleTicks = computed(() =>
  (RADAR.GRID_LEVELS || []).map(ratio => ({ ratio, p: scaleTickPosition(props.metrics.length, ratio) })))

/** detail 行：dimension / player / reference。 */
const detailRows = computed(() =>
  props.metrics.map((m, i) => ({
    label: m.label,
    tip: m.tip || '',
    player: m.displayValue || '--',
    reference: props.reference?.[i] && props.reference[i].available
      ? props.reference[i].displayValue
      : '--',
  })))

function fmtTick(ratio) {
  return String(Math.round(ratio * 100))
}
</script>

<template>
  <div class="player-radar">
    <div v-if="!playerComplete" class="radar-unavailable" data-testid="radar-unavailable">
      {{ t('league.drawer.radar_dim_unavailable') }}
    </div>
    <template v-else>
      <svg :viewBox="'0 0 ' + RADAR.VIEW + ' ' + RADAR.VIEW" class="radar-svg"
           role="img" :aria-label="'Radar: ' + (metrics || []).map(m => m.label).join(', ')">
        <!-- 4 层网格（25/50/75/100） -->
        <polygon v-for="g in gridPolys" :key="'grid-' + g.ratio"
                 :points="g.points" class="radar-grid" :class="{ 'radar-grid-outer': g.ratio === 1 }" />
        <!-- 轴线 -->
        <line v-for="(r, i) in axisRays" :key="'axis-' + i"
              :x1="RADAR.CENTER" :y1="RADAR.CENTER" :x2="r.x" :y2="r.y" class="radar-axis" />
        <!-- 单侧刻度（12 点方向） -->
        <text v-for="t in scaleTicks" :key="'tick-' + t.ratio"
              :x="t.p.x" :y="t.p.y" text-anchor="middle" dominant-baseline="middle"
              class="radar-scale">{{ fmtTick(t.ratio) }}</text>
        <!-- reference 虚线多边形（无填充、无点） -->
        <polygon v-if="referenceComplete && props.reference && props.reference.length"
                 :points="referencePoints" class="radar-ref" />
        <!-- player 实线多边形 + 填充 -->
        <polygon :points="playerPoints" class="radar-data" />
        <!-- player 顶点圆点（template 包裹：v-for 项才有 i 供 v-if 用） -->
        <template v-for="(m, i) in metrics" :key="'dot-' + i">
          <circle v-if="playerNormals[i] != null"
                  :cx="axisPoint(i, metrics.length, playerNormals[i])[0]"
                  :cy="axisPoint(i, metrics.length, playerNormals[i])[1]"
                  r="3" class="radar-dot" />
        </template>
        <!-- 轴标签（只显示维度名；RC 带 native title 提示全称） -->
        <text v-for="(p, i) in labelPositions" :key="'label-' + i"
              :x="p.x" :y="p.y" text-anchor="middle" dominant-baseline="middle"
              class="radar-label"><title v-if="p.tip">{{ p.tip }}</title>{{ p.label }}</text>
      </svg>

      <!-- 图例：player（实线） vs reference（虚线） -->
      <div class="radar-legend">
        <span class="lg-item"><span class="lg-swatch lg-swatch-player"></span>{{ playerLabel || '' }}</span>
        <span v-if="referenceComplete && props.reference && props.reference.length"
              class="lg-item"><span class="lg-swatch lg-swatch-ref"></span>{{ referenceLabel }}</span>
      </div>
      <p v-if="referenceMissing" class="radar-ref-missing" data-testid="radar-ref-missing">
        {{ props.referenceUnavailableLabel || t('league.drawer.ref_unavailable') }}
      </p>

      <!-- detail：Dimension | Player | Reference（score/max，无百分比、无差值） -->
      <table class="radar-detail">
        <thead>
          <tr>
            <th class="rdc-dim">{{ t('radar_lbl.dimension') }}</th>
            <th class="rdc-player">{{ t('radar_lbl.player') }}</th>
            <th v-if="props.reference && props.reference.length" class="rdc-ref">{{ referenceLabel }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in detailRows" :key="i">
            <td class="rdc-dim"><span v-if="row.tip" :title="row.tip">{{ row.label }}</span><template v-else>{{ row.label }}</template></td>
            <td class="rdc-player">{{ row.player }}</td>
            <td v-if="props.reference && props.reference.length" class="rdc-ref">{{ row.reference }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.player-radar { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
.radar-svg { width: 100%; max-width: 340px; aspect-ratio: 1 / 1; }
.radar-grid { fill: none; stroke: var(--border-light); stroke-width: 1; }
.radar-grid-outer { stroke: var(--border-light-strong); stroke-width: 1.2; }
.radar-axis { stroke: var(--border-light); stroke-width: 1; }
.radar-scale { fill: var(--text-muted); font-size: 9px; font-weight: 600; }
.radar-data { fill: color-mix(in srgb, var(--accent) 28%, transparent); stroke: var(--accent); stroke-width: 2; }
.radar-ref { fill: none; stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 4 3; }
.radar-dot { fill: var(--accent); }
.radar-label { fill: var(--text-sub); font-size: 12px; font-weight: 700; }
.radar-unavailable { margin: 10px 0; padding: 14px; text-align: center; color: var(--text-muted); font-size: .8rem; border: 1px dashed var(--border); border-radius: 8px; width: 100%; }
.radar-legend { display: flex; align-items: center; gap: 14px; font-size: .72rem; color: var(--text-sub); }
.lg-item { display: inline-flex; align-items: center; gap: 6px; }
.lg-swatch { width: 16px; height: 3px; border-radius: 2px; }
.lg-swatch-player { background: var(--accent); }
.lg-swatch-ref { background: var(--text-muted); border-top: 1px dashed currentColor; height: 0; }
.radar-ref-missing { margin: 2px 0 0; font-size: .72rem; color: var(--warn-text); text-align: center; }
.radar-detail { width: 100%; border-collapse: collapse; font-size: .76rem; margin-top: 2px; }
.radar-detail th, .radar-detail td { padding: 4px 8px; text-align: left; }
.radar-detail thead th { color: var(--text-sub); font-weight: 800; border-bottom: 1px solid var(--border-light); }
.radar-detail td.rdc-player, .radar-detail td.rdc-ref { text-align: right; font-variant-numeric: tabular-nums; }
.radar-detail td.rdc-player { color: var(--text-heading); font-weight: 700; }
.radar-detail td.rdc-ref { color: var(--text-sub); font-weight: 600; }
.radar-detail td.rdc-dim { color: var(--text-label); font-weight: 600; }
.radar-detail tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--border-light) 14%, transparent); }
</style>
