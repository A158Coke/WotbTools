<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapImages } from '../data/mapImages'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'

/**
 * 地图鸟瞰：底图（按图片 coordinateBounds 渲染）+ 6x6 分析网格（playableBounds 系）+ 九宫格分区框 + 出生点；
 * 热力视图（阵营 × 类型）。战局回放由宿主 BattlePlaybackPanel 作为 PRIMARY 渲染，
 * 本组件只做 secondary 地图鸟瞰；overview.routes 保留在数据合同中供其他消费者使用。
 */
const props = defineProps({
  overview: {
    type: Object,
    required: true
  }
})

const { t, locale } = useI18n()

const image = computed(() => mapImages[props.overview.mapCode] || null)

// 自适应配色：按底图平均相对亮度选择暗图/亮图调色板（规则见 docs/features/battle-playback.md）。
const palette = ref(darkMapPalette)
watch(image, async (img) => {
  palette.value = paletteForLuminance(await luminanceOfImage(img))
}, { immediate: true })

// 热力筛选
const teamTab = ref('friendly')
const typeTab = ref('dwell')    // dwell|damage|deaths

const W = computed(() => image.value ? image.value.width : 800)
const H = computed(() => image.value ? image.value.height : 800)
// 渲染坐标边界：优先用图片自身的 coordinateBounds（语义 JSON 的 worldBounds，逐图校准）；
// 旧配置无 coordinateBounds 时回退 playableBounds（兼容策略）。
// playableBounds 仍承担分析职责：gridCells/热力/区域判断都用它，绘制时经 renderBounds 统一换算。
const renderBounds = computed(() =>
  image.value?.coordinateBounds ?? props.overview.playableBounds)
// 标题：按当前 locale 取 displayNames（zh/en/ru），缺失回退 displayName
const title = computed(() => {
  const names = props.overview.displayNames
  const localized = names && locale && locale.value ? names[locale.value] : null
  return localized || props.overview.displayName
})

// 语义坐标（x=回放 x，y=回放 z）→ SVG 像素（y 反转：语义 y 向上，图片 y 向下）
function toX(x) {
  return ((x - renderBounds.value.xMin) / (renderBounds.value.xMax - renderBounds.value.xMin)) * W.value
}
function toY(y) {
  return ((renderBounds.value.yMax - y) / (renderBounds.value.yMax - renderBounds.value.yMin)) * H.value
}

// ---- 热力 ----
const heatLayer = computed(() => {
  const team = props.overview.heatmaps[teamTab.value]
  return team ? (team[typeTab.value] || []) : []
})
const heatMax = computed(() => Math.max(1, ...heatLayer.value))
function heatOpacity(value) {
  const ratio = value / heatMax.value
  return 0.08 + 0.82 * Math.min(1, ratio)
}
const heatColor = computed(() => (teamTab.value === 'friendly' ? palette.value.heatFriendly : palette.value.heatEnemy))

const friendlyTeam = computed(() => props.overview.friendlyTeam)

// 自适应配色 CSS 变量（网格/九宫格/出生点对比色）。
const mapStyle = computed(() => ({
  '--map-grid-stroke': palette.value.gridStroke,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
}))

const gridRegions = computed(() => {
  const regions = new Map()
  for (const cell of props.overview.gridCells || []) {
    const key = cell.nineGridRegion
    if (!regions.has(key)) {
      regions.set(key, { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity })
    }
    const r = regions.get(key)
    r.xMin = Math.min(r.xMin, cell.bounds.xMin)
    r.yMin = Math.min(r.yMin, cell.bounds.yMin)
    r.xMax = Math.max(r.xMax, cell.bounds.xMax)
    r.yMax = Math.max(r.yMax, cell.bounds.yMax)
  }
  return [...regions.entries()].sort((a, b) => a[0] - b[0])
})
</script>

<template>
  <div v-if="image" class="map-overview" data-test="map-overview" :style="mapStyle">
    <div class="map-head">
      <span class="map-title">{{ title }}</span>
    </div>

    <div class="map-filters">
      <div class="filter-group">
        <button
          v-for="key in ['friendly', 'enemy']"
          :key="key"
          type="button"
          class="filter-btn"
          :class="{ active: teamTab === key }"
          @click="teamTab = key"
        >{{ $t(`recon.map.team_${key}`) }}</button>
      </div>
      <div class="filter-group">
        <button
          v-for="key in ['dwell', 'damage', 'deaths']"
          :key="key"
          type="button"
          class="filter-btn"
          :class="{ active: typeTab === key }"
          @click="typeTab = key"
        >{{ $t(`recon.map.type_${key}`) }}</button>
      </div>
    </div>

    <svg
      class="map-svg"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="`${overview.displayName} ${$t('recon.map.aria')}`"
    >
      <image :href="image.src" :width="W" :height="H" preserveAspectRatio="none" />

      <!-- 6x6 网格 -->
      <g class="grid-cells">
        <rect
          v-for="(cell, index) in overview.gridCells"
          :key="cell.id"
          :x="toX(cell.bounds.xMin)"
          :y="toY(cell.bounds.yMax)"
          :width="toX(cell.bounds.xMax) - toX(cell.bounds.xMin)"
          :height="toY(cell.bounds.yMin) - toY(cell.bounds.yMax)"
          :fill="heatColor"
          :fill-opacity="heatOpacity(heatLayer[index] || 0)"
          class="grid-cell"
        />
      </g>

      <!-- 九宫格分区框 -->
      <g class="grid-regions">
        <g v-for="[region, r] in gridRegions" :key="region">
          <rect
            :x="toX(r.xMin)"
            :y="toY(r.yMax)"
            :width="toX(r.xMax) - toX(r.xMin)"
            :height="toY(r.yMin) - toY(r.yMax)"
            class="region-line"
          />
        </g>
      </g>

      <!-- 出生点 -->
      <g class="spawns">
        <circle
          v-for="(spawn, i) in overview.spawnPoints"
          :key="`${spawn.name}-${i}`"
          :cx="toX(spawn.x)"
          :cy="toY(spawn.y)"
          r="4"
          :class="spawn.team === friendlyTeam ? 'spawn-friendly' : 'spawn-enemy'"
        >
          <title>{{ spawn.name }} ({{ $t('recon.map.spawn') }})</title>
        </circle>
      </g>

    </svg>

    <div class="map-legend">
      <span class="legend-chip" :style="{ background: heatColor }"></span>
      <span>{{ $t('recon.map.legend_heat') }}: 0 … {{ heatMax.toFixed(0) }}</span>
    </div>
  </div>
</template>

<style scoped>
.map-overview {
  border: 1px solid #303a40;
  border-radius: 6px;
  background: rgba(13, 18, 22, .94);
  padding: 8px 12px;
  margin: 0 0 12px;
  color: #c9c5bb;
}
.map-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.map-title { font-weight: 700; color: #f2ede3; }
.filter-group { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-btn {
  border: 1px solid #39444a;
  background: rgba(15, 21, 25, .92);
  color: #c9c5bb;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.filter-btn.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.map-filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.map-svg {
  display: block;
  margin: 0 auto;
  width: 66.7%;
  height: auto;
  border-radius: 4px;
  background: #111;
}
@media (width < 768px) {
  .map-svg { width: 100%; }
}
.grid-cell { stroke: var(--map-grid-stroke, rgba(255,255,255,.16)); stroke-width: .5; }
.region-line { fill: none; stroke: var(--map-region-stroke, rgba(255,255,255,.55)); stroke-width: 1.4; }
.spawn-friendly { fill: var(--map-spawn-friendly, #ffd166); stroke: #7a5200; stroke-width: 1; }
.spawn-enemy { fill: var(--map-spawn-enemy, #4aa3ff); stroke: #0b3f85; stroke-width: 1; }
.map-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: .78rem;
  color: var(--text-label);
  flex-wrap: wrap;
}
.legend-chip { display: inline-block; width: 14px; height: 10px; border-radius: 2px; }
</style>
