<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  RADAR, axisPoint, axisRay, polygonPoints, radarGridPolygons, radarScaleTicks,
  radarScoreBadgeWidth, radarScoreLabelPosition,
} from '../utils/radarGeometry.js'
import { formatRadarVisualScore, radarAxisVisualScore } from '../utils/radarScale.js'

/**
 * 选手画像雷达图：只消费展示轴对象（{key,label,rawValue,visualValue,normalized,displayValue,available}）。
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

const RADAR_ZOOM_MIN = 50
const RADAR_ZOOM_MAX = 150
const RADAR_ZOOM_STEP = 10
const detailMode = ref('score')
const radarZoom = ref(100)
const radarSize = computed(() => `${RADAR.VIEW * radarZoom.value / 100}px`)

function adjustRadarZoom(delta) {
  radarZoom.value = Math.min(RADAR_ZOOM_MAX, Math.max(RADAR_ZOOM_MIN, radarZoom.value + delta))
}

/** player 归一化数组（available 时全可用）。 */
const playerNormals = computed(() =>
  props.metrics.map(m => (m.available ? Math.max(0, Math.min(1, m.normalized)) : null)))

const referenceNormals = computed(() =>
  (props.reference || []).map(m => (m.available ? Math.max(0, Math.min(1, m.normalized)) : null)))

const playerPoints = computed(() => polygonPoints(playerNormals.value, props.metrics.length))
const referencePoints = computed(() => polygonPoints(referenceNormals.value, props.metrics.length))

const gridPolys = computed(() =>
  radarGridPolygons(props.metrics.length).map(grid => ({
    ...grid,
    isStrong: grid.value === RADAR.STRONG_VALUE,
  })))

const axisRays = computed(() =>
  Array.from({ length: props.metrics.length }, (_, i) => axisRay(i, props.metrics.length)))

const labelPositions = computed(() =>
  Array.from({ length: props.metrics.length }, (_, i) => {
    const [x, y] = axisPoint(i, props.metrics.length, RADAR.LABEL_RADIUS, RADAR)
    return { x, y, label: props.metrics[i]?.label || '', tip: props.metrics[i]?.tip || '' }
  }))

const scaleTicks = computed(() =>
  radarScaleTicks(props.metrics.length))

const scoreLabels = computed(() => props.metrics.map((metric, index) => {
  const score = radarAxisVisualScore(metric)
  if (score == null || playerNormals.value[index] == null) return null
  const value = formatRadarVisualScore(metric)
  return {
    ...radarScoreLabelPosition(index, props.metrics.length, playerNormals.value[index]),
    value,
    width: radarScoreBadgeWidth(value),
    label: metric.label,
  }
}))

/** detail 行：dimension / player / reference。 */
const detailRows = computed(() =>
  props.metrics.map((m, i) => ({
    label: m.label,
    tip: m.tip || '',
    player: detailMode.value === 'score' ? formatRadarVisualScore(m) : (m.displayValue || '--'),
    reference: detailMode.value === 'score'
      ? formatRadarVisualScore(props.reference?.[i])
      : (props.reference?.[i]?.available ? props.reference[i].displayValue : '--'),
  })))

</script>

<template>
  <div class="player-radar">
    <div v-if="!playerComplete" class="radar-unavailable" data-testid="radar-unavailable">
      {{ t('league.drawer.radar_dim_unavailable') }}
    </div>
    <template v-else>
      <div class="radar-zoom" role="group" :aria-label="t('radarScale.zoom')">
        <span class="radar-zoom-label">{{ t('radarScale.zoom') }}</span>
        <button type="button" :aria-label="t('radarScale.zoomOut')"
                :disabled="radarZoom <= RADAR_ZOOM_MIN" @click="adjustRadarZoom(-RADAR_ZOOM_STEP)">−</button>
        <input v-model.number="radarZoom" data-testid="radar-zoom"
               type="range" :min="RADAR_ZOOM_MIN" :max="RADAR_ZOOM_MAX" :step="RADAR_ZOOM_STEP"
               :aria-label="t('radarScale.zoom')" />
        <output aria-live="polite">{{ radarZoom }}%</output>
        <button type="button" :aria-label="t('radarScale.zoomIn')"
                :disabled="radarZoom >= RADAR_ZOOM_MAX" @click="adjustRadarZoom(RADAR_ZOOM_STEP)">+</button>
      </div>

      <div class="radar-viewport">
        <div class="radar-canvas">
          <svg :viewBox="'0 0 ' + RADAR.VIEW + ' ' + RADAR.VIEW" class="radar-svg"
               :style="{ width: radarSize }"
               role="img" :aria-label="'Radar: ' + (metrics || []).map(m => m.label).join(', ')">
        <desc>{{ t('radarScale.ariaDescription', { label: referenceLabel }) }}</desc>
        <!-- 可见网格：25/50/100；75 由规则 reference 环表达，150 边界不可见。 -->
        <polygon v-for="g in gridPolys" :key="'grid-' + g.value"
                 :points="g.points" class="radar-grid" :class="{ 'radar-grid-strong': g.isStrong }" />
        <!-- 轴线 -->
        <line v-for="(r, i) in axisRays" :key="'axis-' + i"
              :x1="RADAR.CENTER" :y1="RADAR.CENTER" :x2="r.x" :y2="r.y" class="radar-axis" />
        <!-- 单侧刻度（12 点方向） -->
        <text v-for="t in scaleTicks" :key="'tick-' + t.value"
              :x="t.p.x" :y="t.p.y" text-anchor="middle" dominant-baseline="middle"
              class="radar-scale">{{ t.value }}</text>
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
        <!-- 玩家相对分数：始终显示，明细模式切换不改变顶点标注。 -->
        <template v-for="(score, i) in scoreLabels" :key="'score-' + i">
          <g v-if="score" class="radar-score-badge" :aria-label="score.label + ': ' + score.value">
            <rect :x="score.x - score.width / 2" :y="score.y - RADAR.SCORE_BADGE_HEIGHT / 2"
                  :width="score.width" :height="RADAR.SCORE_BADGE_HEIGHT" :rx="RADAR.SCORE_BADGE_RADIUS"
                  class="radar-score-bg" />
            <text :x="score.x" :y="score.y" text-anchor="middle" dominant-baseline="middle"
                  class="radar-score">{{ score.value }}</text>
          </g>
        </template>
        <!-- 轴标签（只显示维度名；RC 带 native title 提示全称） -->
        <text v-for="(p, i) in labelPositions" :key="'label-' + i"
              :x="p.x" :y="p.y" text-anchor="middle" dominant-baseline="middle"
              class="radar-label"><title v-if="p.tip">{{ p.tip }}</title>{{ p.label }}</text>
          </svg>
        </div>
      </div>

      <!-- 图例：player（实线） vs reference（虚线） -->
      <div class="radar-legend">
        <span class="lg-item"><span class="lg-swatch lg-swatch-player"></span>{{ playerLabel || '' }}</span>
        <span v-if="referenceComplete && props.reference && props.reference.length"
              class="lg-item"><span class="lg-swatch lg-swatch-ref"></span>{{ t('radarScale.average', { label: referenceLabel }) }}</span>
        <span class="lg-item"><span class="lg-swatch lg-swatch-strong"></span>{{ t('radarScale.strong') }}</span>
      </div>
      <p class="radar-scale-note">{{ t('radarScale.overflow') }}</p>
      <p v-if="referenceMissing" class="radar-ref-missing" data-testid="radar-ref-missing">
        {{ props.referenceUnavailableLabel || t('league.drawer.ref_unavailable') }}
      </p>

      <div class="radar-detail-switch" role="group" :aria-label="t('radarScale.detailMode')">
        <button type="button" :aria-pressed="detailMode === 'score'" @click="detailMode = 'score'">
          {{ t('radarScale.scoreMode') }}
        </button>
        <button type="button" :aria-pressed="detailMode === 'raw'" @click="detailMode = 'raw'">
          {{ t('radarScale.rawMode') }}
        </button>
      </div>

      <!-- detail：score 模式显示 0..150 视觉分；raw 模式显示原始玩家值与真实 reference。 -->
      <table class="radar-detail">
        <thead>
          <tr>
            <th class="rdc-dim">{{ t('radar_lbl.dimension') }}</th>
            <th class="rdc-player">{{ detailMode === 'score' ? t('radarScale.playerScore') : t('radar_lbl.player') }}</th>
            <th v-if="props.reference && props.reference.length" class="rdc-ref">
              {{ detailMode === 'score' ? t('radarScale.averageScore') : referenceLabel }}
            </th>
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
.radar-zoom { display: flex; align-self: stretch; align-items: center; justify-content: flex-end; gap: 7px; min-height: 38px; }
.radar-zoom-label { color: var(--text-muted); font-size: .7rem; font-weight: 700; }
.radar-zoom button { width: 34px; height: 34px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); color: var(--text-heading); cursor: pointer; font: inherit; font-size: 1rem; font-weight: 800; }
.radar-zoom button:hover:not(:disabled), .radar-zoom button:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
.radar-zoom button:disabled { cursor: not-allowed; opacity: .38; }
.radar-zoom input { width: min(120px, 30vw); accent-color: var(--accent); cursor: pointer; }
.radar-zoom output { min-width: 38px; color: var(--text-label); font-size: .72rem; font-weight: 800; font-variant-numeric: tabular-nums; text-align: right; }
.radar-viewport { width: 100%; overflow-x: auto; overflow-y: hidden; padding: 2px 0 4px; }
.radar-canvas { display: flex; justify-content: center; width: max-content; min-width: 100%; }
.radar-svg { flex: 0 0 auto; max-width: none; aspect-ratio: 1 / 1; }
.radar-grid { fill: none; stroke: var(--border-light); stroke-width: 1; }
.radar-grid-strong { stroke: var(--border-light-strong); stroke-width: 1.2; }
.radar-axis { stroke: var(--border-light); stroke-width: 1; }
.radar-scale { fill: var(--text-muted); font-size: 9px; font-weight: 600; }
.radar-data { fill: color-mix(in srgb, var(--accent) 22%, transparent); stroke: var(--accent); stroke-width: 2; }
.radar-ref { fill: none; stroke: var(--text-muted); stroke-width: 1.3; stroke-dasharray: 4 3; }
.radar-dot { fill: var(--accent); }
.radar-score-bg { fill: var(--bg-card2); stroke: var(--accent); stroke-width: .8; }
.radar-score { fill: var(--accent); font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }
.radar-label { fill: var(--text-sub); font-size: 12px; font-weight: 700; }
.radar-unavailable { margin: 10px 0; padding: 14px; text-align: center; color: var(--text-muted); font-size: .8rem; border: 1px dashed var(--border); border-radius: 8px; width: 100%; }
.radar-legend { display: flex; align-items: center; justify-content: center; gap: 8px 14px; flex-wrap: wrap; font-size: .72rem; color: var(--text-sub); }
.lg-item { display: inline-flex; align-items: center; gap: 6px; }
.lg-swatch { width: 16px; height: 3px; border-radius: 2px; }
.lg-swatch-player { background: var(--accent); }
.lg-swatch-ref { background: var(--text-muted); border-top: 1px dashed currentColor; height: 0; }
.lg-swatch-strong { background: var(--border-light-strong); height: 1px; }
.radar-scale-note { margin: -2px 0 0; color: var(--text-muted); font-size: .68rem; text-align: center; }
.radar-ref-missing { margin: 2px 0 0; font-size: .72rem; color: var(--warn-text); text-align: center; }
.radar-detail-switch { display: inline-flex; align-self: flex-start; padding: 2px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-card); }
.radar-detail-switch button { min-height: 28px; padding: 4px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; font: inherit; font-size: .72rem; font-weight: 700; }
.radar-detail-switch button[aria-pressed="true"] { background: var(--bg-card-hover); color: var(--text-heading); box-shadow: inset 0 0 0 1px var(--border-light-strong); }
.radar-detail-switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.radar-detail { width: 100%; border-collapse: collapse; font-size: .76rem; margin-top: 2px; }
.radar-detail th, .radar-detail td { padding: 4px 8px; text-align: left; }
.radar-detail thead th { color: var(--text-sub); font-weight: 800; border-bottom: 1px solid var(--border-light); }
.radar-detail td.rdc-player, .radar-detail td.rdc-ref { text-align: right; font-variant-numeric: tabular-nums; }
.radar-detail td.rdc-player { color: var(--text-heading); font-weight: 700; }
.radar-detail td.rdc-ref { color: var(--text-sub); font-weight: 600; }
.radar-detail td.rdc-dim { color: var(--text-label); font-weight: 600; }
.radar-detail tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--border-light) 14%, transparent); }
</style>
