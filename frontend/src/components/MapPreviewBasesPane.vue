<script setup>
/**
 * 地图预览「点位」面板：遭遇（assault）/ 争霸（supremacy）基地几何的纯静态展示。
 *
 * 几何来自 `data/mapBases.js`（客户端 `.sc2` 场景提取，世界坐标 ±300 语义系，与
 * `mapImages.coordinateBounds` / 回放坐标同一坐标系），渲染复用 `BattleMap.vue`
 * 展示层与 `createMapView` 坐标映射；缩放/平移与 2D 标注模式同一手势管线。
 *
 * 点位样式与 2D 回放的基地标记同语义：争霸 = 字母圆环（A/B/C/D），攻防/遭遇 =
 * 守方色圆盘（`team` 为守方，未声明半径默认 15m）。仅 bundled 29 张有几何——
 * 未收录图 fail-closed（不显示面板，无几何数据不做统计猜测）。
 *
 * 手势：与 2D 标注模式同一管线（单指平移/双指捏合/滚轮缩放）；无绘制。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Map as MapIcon } from 'lucide-vue-next'
import BattleMap from './BattleMap.vue'
import EmptyState from './EmptyState.vue'
import { Map as MapIcon } from 'lucide-vue-next'
import { mapBases } from '../data/mapBases.js'
import { createMapView } from '../utils/mapView.js'
import { clampViewPan, zoomViewAt } from '../utils/battlePlayback.js'
import { map2dCanonicalUrl } from '../scene/replaySource.js'
import { usePaneFillHeight } from '../composables/usePaneFillHeight.js'

const props = defineProps({
  /** 资产面 key（= mapBases 注册码） */
  mapKey: { type: String, required: true },
  /** mapBases[key]（{ supremacy: [...], assault: [...] } | null） */
  bases: { type: Object, default: null },
})

const { t } = useI18n()

// ---------- 底图（map2d 1254² 校准图，全部 43 张都有）----------
const rootEl = ref(null)
const stageEl = ref(null)
const squareEl = ref(null)
const mapComponent = ref(null)
const { height: stageHeight } = usePaneFillHeight(rootEl)
const image = ref(null)
const basemapError = ref(false)
const overview = computed(() => ({ mapCode: props.mapKey, spawnPoints: [] }))
const mapView = computed(() => createMapView(image.value, overview.value))

/** map2d 索引只在此面板挂载时拉一次（43/43 全有；模块内 HTTP 缓存去重）。 */
let indexPromise = null
async function resolveBasemap(key) {
  image.value = null
  basemapError.value = false
  try {
    const idx = indexPromise ||= (await import('../scene/replaySource.js')).loadMap2dIndex()
    const index = await idx
    const entry = index && index.maps && index.maps[key]
    if (!entry) {
      basemapError.value = true
      return
    }
    const url = (() => {
      try {
        const { assetProvider } = await import('../scene/assetProvider.js')
        return assetProvider.url(entry.path)
      } catch {
        return null
      }
    })()
    if (!url) {
      basemapError.value = true
      return
    }
    const el = await new Promise((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('basemap load failed'))
      im.src = url
    })
    const wb = entry.worldBounds || {}
    if (!Number.isFinite(wb.xMin) || !Number.isFinite(wb.yMin)) {
      basemapError.value = true
      return
    }
    image.value = {
      src: url,
      width: el.naturalWidth || 1254,
      height: el.naturalHeight || 1254,
      coordinateBounds: { xMin: wb.xMin, xMax: wb.xMax, yMin: wb.yMin, yMax: wb.yMax },
    }
  } catch {
    basemapError.value = true
  }
}

watch(() => props.mapKey, resolveBasemap, { immediate: true })

// ---------- 视图（contain fit / pan / pinch / wheel zoom）----------
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const ZOOM_STEP = 1.2
const PAN_THRESHOLD_PX = 5
const PINCH_THRESHOLD_PX = 5
const FIT_MARGIN = 0.98

function stageWidth() {
  return stageEl.value ? stageEl.value.clientWidth : (rootEl.value?.clientWidth || 0)
}
function stageHeightPx() {
  return stageEl.value ? stageEl.value.clientHeight : (rootEl.value?.clientHeight || 0)
}
/** 渲染矩形（相对舞台原点；宽 = 舞台宽，高按底图比例）。 */
function renderRect() {
  const width = stageWidth()
  const ratio = mapView.value.H / mapView.value.W
  return { width, height: width * ratio }
}
function fitScale() {
  const stageW = stageWidth()
  const stageH = stageHeightPx()
  const rect = renderRect()
  if (stageW > 0 && stageH > 0 && rect.width > 0 && rect.height > 0) {
    return Math.min(stageW / rect.width, stageH / rect.height) * FIT_MARGIN
  }
  return 1
}
function applyView(next) {
  const clamped = clampViewPan(next, stageWidth(), stageHeightPx(), renderRect().width, renderRect().height)
  view.scale = clamped.scale
  view.tx = clamped.tx
  view.ty = clamped.ty
}
function fitView() {
  const stageW = stageWidth()
  const stageH = stageHeightPx()
  const rect = renderRect()
  if (stageW > 0 && stageH > 0 && rect.width > 0 && rect.height > 0) {
    const scale = fitScale()
    applyView({ scale, tx: (stageW - rect.width * scale) / 2, ty: (stageH - rect.height * scale) / 2 })
    return
  }
  applyView({ scale: 1, tx: 0, ty: 0 })
}
let fitObserved = false
watch([image, stageHeight], () => {
  if (!image.value) return
  if (!fitObserved && stageWidth() > 0) {
    fitObserved = true
    fitView()
  }
}, { flush: 'post' })
watch(() => props.mapKey, () => {
  fitObserved = false
})

const viewportStyle = computed(() => [
  `transform: translate(${view.tx}px, ${view.ty}px)`,
  `width: ${view.scale * 100}%`,
])
function screenPoint(clientX, clientY) {
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  return { x: clientX - rect.left, y: clientY - rect.top }
}
function onWheel(e) {
  e.preventDefault()
  const p = screenPoint(e.clientX, e.clientY)
  applyView(zoomViewAt(view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, fitScale()))
}

// ---------- 手势（单指平移 / 双指捏合）----------
const pointers = new Map()
let panStart = null
let pinchStart = null
function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}
function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try {
    if (typeof e.target.setPointerCapture === 'function') e.target.setPointerCapture(e.pointerId)
  } catch {
    /* 测试环境可能不支持指针捕获 */
  }
  if (pointers.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
  } else if (pointers.size === 2) {
    const info = pinchInfo()
    pinchStart = {
      mid: info.mid,
      dist: info.dist,
      anchorScreen: screenPoint(info.mid.x, info.mid.y),
      scale: view.scale,
      tx: view.tx,
      ty: view.ty,
    }
    panStart = null
  }
}
function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2 && pinchStart) {
    const { mid, dist } = pinchInfo()
    if (pinchStart.dist > 0 && dist > 0) {
      const next = zoomViewAt(
        { scale: pinchStart.scale, tx: pinchStart.tx, ty: pinchStart.ty },
        pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist,
        fitScale(),
      )
      next.tx += mid.x - pinchStart.mid.x
      next.ty += mid.y - pinchStart.mid.y
      applyView(next)
    }
    return
  }
  if (pointers.size === 1 && panStart) {
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
    applyView({ scale: view.scale, tx: panStart.tx + dx, ty: panStart.ty + dy })
  }
}
function onPointerUp(e) {
  pointers.delete(e.pointerId)
  try {
    if (typeof e.target.releasePointerCapture === 'function') e.target.releasePointerCapture(e.pointerId)
  } catch {
    /* 忽略 */
  }
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 0) panStart = null
  else if (pointers.size === 1 && pinchStart == null && panStart == null) {
    const [p] = [...pointers.values()]
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty }
  }
}

// ---------- 基地点位渲染 ----------
/** mapBases 条目：{ supremacy: [{baseId, x, y, radius}], assault: [{x, y, radius?, team}] } */
const basesData = computed(() => (props.bases && typeof props.bases === 'object') ? props.bases : null)
const hasBases = computed(() => !!basesData.value && (basesData.value.supremacy?.length || basesData.value.assault?.length))
const toX = computed(() => mapView.value.toX)
const toY = computed(() => mapView.value.toY)

const supremacyBases = computed(() => (basesData.value?.supremacy || []).map((b) => ({
  ...b, px: toX.value(b.x), py: toY.value(b.y),
})))
/** assault 与 encounter 同构（每种模式一个守方基地组）；mapBases 以 assault 键承载。 */
const assaultBases = computed(() => (basesData.value?.assault || []).map((b) => ({
  ...b, px: toX.value(b.x), py: toY.value(b.y),
})))
const assaultRadius = 15
</script>

<template>
  <div ref="rootEl" class="map-bases" data-testid="map-bases-pane">
    <div
      ref="stageEl"
      class="map-bases-stage"
      data-testid="map-bases-stage"
      tabindex="0"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <BattleMap
        v-if="image"
        ref="mapEl"
        class="map-bases-battlemap"
        :image="image"
        :map-view="mapView"
        :pb-overview="overview"
        :view-scale="view.scale"
        :viewport-style="viewportStyle"
        touch-pan
        :marker-label="() => ''"
        :hp-for="() => null"
        :hp-prefs="{}"
        :translate="t"
        :ghost-for="() => null"
        :flash-for="() => null"
        :float-team-class="() => ''"
      >
        <template #annotations>
          <g v-if="assaultBases.length">
            <circle
              v-for="(b, i) in assaultBases"
              :key="`a-${i}`"
              :cx="b.px" :cy="b.py"
              :r="assaultRadius"
              class="base-disc"
            />
            <circle
              v-for="(b, i) in assaultBases"
              :key="`a-ring-${i}`"
              :cx="b.px" :cy="b.py"
              :r="assaultRadius"
              class="base-ring"
            />
          </g>
          <g v-if="supremacyBases.length">
            <template v-for="(b, i) in supremacyBases" :key="`s-${i}`">
              <circle :cx="b.px" :cy="b.py" :r="b.radius" class="base-disc" />
              <circle :cx="b.px" :cy="b.py" :r="b.radius" class="base-ring" />
              <text :x="b.px" :y="b.py" dy="0.35em" class="base-label">{{ b.baseId }}</text>
            </template>
          </g>
        </template>
      </BattleMap>
      <EmptyState
        v-else-if="!basemapError"
        :title="t('mapPreview.title')"
        :description="t('mapPreview.loading')"
      />
      <EmptyState
        v-else
        role="alert"
        :icon="MapIcon"
        :title="t('mapPreview.title')"
        :description="t('mapPreview.basemapFailed')"
      />
    </div>
  </div>
</template>

<style scoped>
.map-bases {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.map-bases-stage {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas);
  touch-action: none;
}

.map-bases-battlemap {
  height: 100%;
}

.base-disc {
  fill: var(--color-team-neutral);
  fill-opacity: 0.25;
  stroke: none;
}

.base-ring {
  fill: none;
  stroke: var(--color-team-neutral);
  stroke-width: 2;
}

.base-label {
  fill: var(--color-on-team-neutral);
  font: var(--type-h3);
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}
</style>
