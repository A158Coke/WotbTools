<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapImages } from '../data/mapImages'

/**
 * 地图鸟瞰：底图（拉伸铺满 playableBounds）+ 6x6 网格 + 九宫格线/编号 + 出生点；
 * 热力视图（阵营 × 类型）与路线视图（阵营 × 阶段）双 Tab。
 * 数据来自后端 SSE done 的 mapOverview；本组件仅在 mapImages 有该地图素材时被渲染。
 */
const props = defineProps({
  overview: {
    type: Object,
    required: true
  }
})

const { t, locale } = useI18n()

const image = computed(() => mapImages[props.overview.mapCode] || null)

// 视图与筛选 Tab
const view = ref('heatmap')
const teamTab = ref('friendly') // heatmap: friendly|enemy; routes: friendly|enemy|all
const typeTab = ref('dwell')    // dwell|damage|deaths
const phaseTab = ref('all')     // all|opening|mid|late

// 视图切换时重置阵营默认值：热力=本方，路线=全部（展示双方 14 车）
watch(view, (next) => {
  teamTab.value = next === 'routes' ? 'all' : 'friendly'
})

const W = computed(() => image.value ? image.value.width : 800)
const H = computed(() => image.value ? image.value.height : 800)
const B = computed(() => props.overview.playableBounds)
// 标题：按当前 locale 取 displayNames（zh/en/ru），缺失回退 displayName
const title = computed(() => {
  const names = props.overview.displayNames
  const localized = names && locale && locale.value ? names[locale.value] : null
  return localized || props.overview.displayName
})

// 语义坐标（x=回放 x，y=回放 z）→ SVG 像素（y 反转：语义 y 向上，图片 y 向下）
function toX(x) {
  return ((x - B.value.xMin) / (B.value.xMax - B.value.xMin)) * W.value
}
function toY(y) {
  return ((B.value.yMax - y) / (B.value.yMax - B.value.yMin)) * H.value
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
const heatColor = computed(() => (teamTab.value === 'friendly' ? '#ff7a1a' : '#2f7dff'))

// ---- 路线 ----
const phaseRanges = computed(() => {
  const ranges = {}
  for (const phase of props.overview.phases || []) {
    ranges[phase.key] = [phase.startSec, phase.endSec]
  }
  return ranges
})

const friendlyTeam = computed(() => props.overview.friendlyTeam)

const visibleRoutes = computed(() => {
  const teamFilter = teamTab.value === 'all'
    ? null
    : (teamTab.value === 'friendly' ? friendlyTeam.value : (friendlyTeam.value === 1 ? 2 : 1))
  return (props.overview.routes || []).filter(route =>
    teamFilter === null || route.team === teamFilter)
})

/** 按阵营给路线分配稳定颜色（本方暖色系、敌方冷色系，各 7 色）。 */
const friendlyColors = ['#ff7a1a', '#ffb01a', '#e85d2a', '#ff8f4d', '#d96b0f', '#ffc266', '#b74e1e']
const enemyColors = ['#2f7dff', '#4aa3ff', '#1f5fd6', '#7ab8ff', '#144ba8', '#9ecbff', '#0e3a7d']
function routeColor(route) {
  const index = visibleRoutes.value.filter(r => r.team === route.team).indexOf(route)
  const palette = route.team === friendlyTeam.value ? friendlyColors : enemyColors
  return palette[index % palette.length]
}

/** 按阶段裁剪并断线（gap > 5s 拆段），返回多段点组。 */
function routeSegments(route) {
  const range = phaseTab.value === 'all' ? null : (phaseRanges.value[phaseTab.value] || null)
  const points = route.points || []
  const segments = []
  let current = []
  let prevTime = null
  for (const point of points) {
    if (range && (point.timeSec < range[0] || point.timeSec > range[1])) {
      if (current.length) {
        segments.push(current)
        current = []
      }
      prevTime = null
      continue
    }
    if (prevTime !== null && point.timeSec - prevTime > 5) {
      segments.push(current)
      current = []
    }
    current.push(point)
    prevTime = point.timeSec
  }
  if (current.length) {
    segments.push(current)
  }
  return segments
}

function polylinePoints(segment) {
  return segment.map(p => `${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`).join(' ')
}

/** 阵亡 X 位置（死亡时刻所在路线段内的最近点）。 */
function deathPoint(route) {
  if (route.deathSec == null) return null
  let best = null
  for (const point of route.points || []) {
    if (point.timeSec <= route.deathSec + 0.5) {
      best = point
    } else {
      break
    }
  }
  return best
}

/** 观测区间提示：首观测晚于 5s 的路线列出（敌方通常缺失开局）。 */
const lateObservedRoutes = computed(() => visibleRoutes.value
  .filter(route => route.firstObservedSec > 5)
  .sort((a, b) => a.firstObservedSec - b.firstObservedSec))

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '-'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return t('recon.map.duration', { m, s: String(s).padStart(2, '0') })
}

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
  <div v-if="image" class="map-overview" data-test="map-overview">
    <div class="map-head">
      <span class="map-title">{{ title }}</span>
      <div class="map-tabs" role="tablist">
        <button
          type="button"
          class="map-tab"
          :class="{ active: view === 'heatmap' }"
          @click="view = 'heatmap'"
        >{{ $t('recon.map.view_heatmap') }}</button>
        <button
          type="button"
          class="map-tab"
          :class="{ active: view === 'routes' }"
          @click="view = 'routes'"
        >{{ $t('recon.map.view_routes') }}</button>
      </div>
    </div>

    <div class="map-filters">
      <div class="filter-group">
        <button
          v-for="key in (view === 'heatmap' ? ['friendly', 'enemy'] : ['friendly', 'enemy', 'all'])"
          :key="key"
          type="button"
          class="filter-btn"
          :class="{ active: teamTab === key }"
          @click="teamTab = key"
        >{{ $t(`recon.map.team_${key}`) }}</button>
      </div>
      <div v-if="view === 'heatmap'" class="filter-group">
        <button
          v-for="key in ['dwell', 'damage', 'deaths']"
          :key="key"
          type="button"
          class="filter-btn"
          :class="{ active: typeTab === key }"
          @click="typeTab = key"
        >{{ $t(`recon.map.type_${key}`) }}</button>
      </div>
      <div v-else class="filter-group">
        <button
          v-for="key in ['all', 'opening', 'mid', 'late']"
          :key="key"
          type="button"
          class="filter-btn"
          :class="{ active: phaseTab === key }"
          @click="phaseTab = key"
        >{{ $t(`recon.map.phase_${key}`) }}</button>
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
          :fill="view === 'heatmap' ? heatColor : 'none'"
          :fill-opacity="view === 'heatmap' ? heatOpacity(heatLayer[index] || 0) : 0"
          class="grid-cell"
        />
      </g>

      <!-- 九宫格线 + 区域编号 -->
      <g class="grid-regions">
        <g v-for="[region, r] in gridRegions" :key="region">
          <rect
            :x="toX(r.xMin)"
            :y="toY(r.yMax)"
            :width="toX(r.xMax) - toX(r.xMin)"
            :height="toY(r.yMin) - toY(r.yMax)"
            class="region-line"
          />
          <text
            :x="toX(r.xMin) + 5"
            :y="toY(r.yMax) + 14"
            class="region-label"
          >{{ region + 1 }}</text>
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

      <!-- 路线 -->
      <g v-if="view === 'routes'" class="routes">
        <g v-for="route in visibleRoutes" :key="route.accountId">
          <polyline
            v-for="(segment, i) in routeSegments(route)"
            :key="i"
            :points="polylinePoints(segment)"
            fill="none"
            :stroke="routeColor(route)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>
              {{ route.playerName }} · {{ $t('recon.map.observed_from') }} {{ fmtTime(route.firstObservedSec) }}
              <template v-if="route.deathSec != null"> · {{ $t('recon.map.death') }} {{ fmtTime(route.deathSec) }}</template>
            </title>
          </polyline>
          <circle
            v-if="route.points.length"
            :cx="toX(route.points[0].x)"
            :cy="toY(route.points[0].y)"
            r="3"
            :fill="routeColor(route)"
          />
          <text
            v-if="deathPoint(route)"
            :x="toX(deathPoint(route).x)"
            :y="toY(deathPoint(route).y)"
            class="death-mark"
          >✕</text>
        </g>
      </g>
    </svg>

    <div class="map-legend">
      <template v-if="view === 'heatmap'">
        <span class="legend-chip" :style="{ background: heatColor }"></span>
        <span>{{ $t('recon.map.legend_heat') }}: 0 … {{ heatMax.toFixed(0) }}</span>
      </template>
      <template v-else>
        <span class="legend-chip" :style="{ background: friendlyColors[0] }"></span>
        <span>{{ $t('recon.map.team_friendly') }}</span>
        <span class="legend-chip" :style="{ background: enemyColors[0] }"></span>
        <span>{{ $t('recon.map.team_enemy') }}</span>
        <span class="legend-death">✕</span>
        <span>{{ $t('recon.map.death') }}</span>
      </template>
    </div>

    <div v-if="view === 'routes' && lateObservedRoutes.length" class="observed-note">
      {{ $t('recon.map.observed_note') }}
      <span v-for="route in lateObservedRoutes" :key="route.accountId" class="observed-item">
        {{ route.playerName }}: {{ $t('recon.map.observed_from') }} {{ fmtTime(route.firstObservedSec) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.map-overview {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card2);
  padding: 8px 12px;
  margin: 0 0 12px;
}
.map-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.map-title { font-weight: 700; color: var(--text-heading); }
.map-tabs, .filter-group { display: flex; gap: 4px; flex-wrap: wrap; }
.map-tab, .filter-btn {
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-label);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.map-tab.active, .filter-btn.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.map-filters { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.map-svg {
  width: 100%;
  height: auto;
  border-radius: 4px;
  background: #111;
}
.grid-cell { stroke: rgba(255,255,255,.16); stroke-width: .5; }
.region-line { fill: none; stroke: rgba(255,255,255,.55); stroke-width: 1.4; }
.region-label { fill: rgba(255,255,255,.8); font-size: 12px; font-weight: 700; }
.spawn-friendly { fill: #ffd166; stroke: #7a5200; stroke-width: 1; }
.spawn-enemy { fill: #4aa3ff; stroke: #0b3f85; stroke-width: 1; }
.death-mark { fill: #ff3b30; font-size: 14px; font-weight: 700; paint-order: stroke; stroke: #000; stroke-width: 1.5; }
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
.legend-death { color: #ff3b30; font-weight: 700; }
.observed-note {
  margin-top: 6px;
  font-size: .78rem;
  color: var(--text-label);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.observed-item { color: var(--text); }
</style>
