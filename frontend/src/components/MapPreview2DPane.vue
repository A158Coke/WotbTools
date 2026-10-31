<script setup>
/**
 * 地图预览 2D 面板：底图双源（打包 mapImages 注册表 / 资产包 ground.webp 回退）
 * + 拖拽/捏合/滚轮缩放 + 标注绘制（pen/eraser，与 2D 回放同一坐标体系与撤销栈），
 * 无车辆、无回放。
 *
 * 手势与坐标管线复用回放的纯函数（zoomViewAt / clampViewPan / screenToSemantic /
 * utils/annotation 全套）；渲染复用 BattleMap.vue（纯展示，车辆/浮层以空数组 +
 * 桩函数传入）。标注只取 pen/eraser（与 3D 预览同一工具集），会话内保存 + 文件导入导出。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, PencilRuler, Upload } from 'lucide-vue-next'
import BattleMap from './BattleMap.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import { WORLD_BOUNDS_300 } from '../data/mapImages.js'
import { mapStaticUrl } from '../scene/replaySource.js'
import { createMapView } from '../utils/mapView.js'
import {
  ANNOT_COLORS, ANNOT_ERASER_RADIUS_DEFAULT, ANNOT_ERASER_RADIUS_MAX, ANNOT_ERASER_RADIUS_MIN,
  ANNOT_FONT_SIZE, ANNOT_WIDTH_DEFAULT, ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN,
  applyEraser, canRedo, canUndo, commit, polylinePoints, redo, screenToSemantic, semanticWidthFromSlider, undo,
} from '../utils/annotation.js'
import { clampViewPan, zoomViewAt } from '../utils/battlePlayback.js'
import { usePaneFillHeight } from '../composables/usePaneFillHeight.js'

const props = defineProps({
  /** 资产面 key（= 标注导入/导出归属校验） */
  mapKey: { type: String, required: true },
  /**
   * 底图描述符（页面对照双源解析后下发）：
   * { kind:'bundled', image } —— 打包注册表条目（src/width/height/coordinateBounds）；
   * { kind:'ground', mapKey } —— 资产包 ground.webp（异步加载，±300 契约框：
   * 3D 内核 meta 恒等回退与打包图同框，坐标体系一致）。
   */
  basemap: { type: Object, required: true },
})

const { t } = useI18n()

// ---------- 底图与坐标映射 ----------
const basemapImage = ref(null)   // { src, width, height, coordinateBounds }
const basemapError = ref(false)
const image = computed(() => basemapImage.value)
const overview = computed(() => ({ mapCode: props.mapKey, spawnPoints: [] }))
const mapView = computed(() => createMapView(image.value, overview.value))

/** ground.webp 异步就位（naturalWidth/Height 就绪后才建映射；失败 fail-visible）。 */
async function resolveBasemap(bm) {
  basemapImage.value = null
  basemapError.value = false
  if (!bm) return
  if (bm.kind === 'bundled') {
    basemapImage.value = bm.image
    return
  }
  const url = (() => {
    // mapStaticUrl 内部 assetProvider.url 在 Android 离线门控下可抛（NETWORK_ERROR）：
    // 与下方 fetch 同一 try 语义，抛错归一为 basemapError（fail-visible）。
    try {
      return mapStaticUrl('map', null, bm.mapKey || props.mapKey)
    } catch {
      return null
    }
  })()
  if (!url) {
    basemapError.value = true
    return
  }
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('basemap load failed'))
      el.src = url
    })
    basemapImage.value = {
      src: url,
      width: img.naturalWidth || 1024,
      height: img.naturalHeight || 1024,
      coordinateBounds: WORLD_BOUNDS_300,
    }
  } catch {
    basemapError.value = true
  }
}
// 底图解析的 watch 注册在标注状态声明之后（见文件后部）——immediate 首评需要完整状态

const semPerSvgX = computed(() => {
  const b = mapView.value.renderBounds
  return b && mapView.value.W > 0 ? (b.xMax - b.xMin) / mapView.value.W : 1
})
const semPerSvgY = computed(() => {
  const b = mapView.value.renderBounds
  return b && mapView.value.H > 0 ? (b.yMax - b.yMin) / mapView.value.H : 1
})
const annotWidthSlider = ref(ANNOT_WIDTH_DEFAULT)
const annotWidth = computed(() => semanticWidthFromSlider(annotWidthSlider.value, {
  semanticSpan: mapView.value.renderBounds ? mapView.value.renderBounds.xMax - mapView.value.renderBounds.xMin : 0,
  logicalSpan: mapView.value.W,
}))
// 橡皮半径独立于画笔宽度（与回放同一语义）：allowedTools 让 toolbar 走 3D 形态
// （宽度滑条隐藏），橡皮尺寸必须显式供给，否则没有任何尺寸控制可用。
const annotationEraserRadius = ref(ANNOT_ERASER_RADIUS_DEFAULT)

// ---------- 视图（contain fit / pan / pinch / wheel zoom）----------
const rootEl = ref(null)
const stageEl = ref(null)
const squareEl = ref(null)
const mapComponent = ref(null)
/** BattleMap expose 的**真实地图 DOM**（组件实例没有 getBoundingClientRect）；
 *  桌面/平板下 .pb-map 根宽为 66.7%，所有 screen-space 几何必须以它为原点/尺寸。 */
const mapEl = computed(() => mapComponent.value?.mapEl || null)
const importFile = ref(null)
const { height: stageHeight } = usePaneFillHeight(rootEl)
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const ZOOM_STEP = 1.2
const PAN_THRESHOLD_PX = 5
const PINCH_THRESHOLD_PX = 5
const FIT_MARGIN = 0.98
/** 居中方形舞台边长（min(舞台宽, 舞台高)，JS 实测——纯 CSS aspect-ratio 与
 *  max-width 冲突时会被拉成矩形，实测写入内联尺寸才稳定）。 */
const squareSide = ref(0)
function measureSquare() {
  const w = stageEl.value?.clientWidth || 0
  const h = stageEl.value?.clientHeight || 0
  squareSide.value = w > 0 && h > 0 ? Math.floor(Math.min(w, h)) : 0
}

function mapWidth() {
  return mapEl.value ? mapEl.value.clientWidth : 0
}
function mapHeight() {
  return mapEl.value ? mapEl.value.clientHeight : 0
}
/** 可视视口 = 居中方形舞台（squareEl）：pan 夹与 contain fit 以它为界，
 *  与回放的正方形 stage 同构——地图不会溢出舞台、也不会留不可用的 letterbox。 */
function stageWidth() {
  return squareEl.value ? squareEl.value.clientWidth : (stageEl.value ? stageEl.value.clientWidth : 0)
}
function stageHeightPx() {
  return squareEl.value ? squareEl.value.clientHeight : (stageEl.value ? stageEl.value.clientHeight : 0)
}
/** 当前渲染矩形（相对地图容器原点；与回放的 MapRenderRect SSoT 同构）。 */
function renderRect() {
  const width = mapWidth()
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
  // pan 夹以 stage 为界、rect 用真实地图 DOM 尺寸（66.7% 根宽时两者不同）
  const clamped = clampViewPan(next, stageWidth(), stageHeightPx(), renderRect().width, renderRect().height)
  view.scale = clamped.scale
  view.tx = clamped.tx
  view.ty = clamped.ty
}
/** 默认视图 = 完整地图 contain 居中（stage 尺寸就绪后 fit 一次）。 */
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
/** 舞台/地图 DOM 尺寸观察（挂载/底图切换/窗口缩放 → 方形实测 + fit 重算）。 */
let mapSizeObserver = null
watch(mapEl, (el, prev) => {
  if (prev && mapSizeObserver) mapSizeObserver.unobserve(prev)
  if (el && mapSizeObserver) mapSizeObserver.observe(el)
  fitObserved = false   // 新 DOM = 新几何，重新 fit 一次
}, { flush: 'post' })
watch(stageHeight, measureSquare, { flush: 'post' })
onMounted(() => {
  measureSquare()
  if (typeof ResizeObserver === 'function') {
    let lastValidSide = 0
    mapSizeObserver = new ResizeObserver(() => {
      const prevValid = lastValidSide
      measureSquare()
      // 零尺寸（v-show 隐藏 / 卸载中）：不动 view——否则 2D⇄3D 切换回来会
      // 把用户的缩放/平移重置回 contain fit。
      if (!squareSide.value) return
      const firstValid = prevValid === 0
      const sideChanged = !firstValid && squareSide.value !== prevValid
      lastValidSide = squareSide.value
      if (!firstValid && !sideChanged) return
      // clamp/fit 必须等 Vue 把新方形尺寸写入 DOM（squareEl/mapEl 的 clientWidth
      // 是同步读值）——post-flush 后按已生效边界执行，否则用旧尺寸夹出越界空白。
      nextTick(() => {
        if (!squareSide.value) return
        if (firstValid || !fitObserved) {
          if (!fitObserved) fitObserved = true
          fitView()
          return
        }
        // 已有用户视图：保留 scale/tx/ty，仅按新边界重新 clamp
        applyView(view)
      })
    })
    if (mapEl.value) mapSizeObserver.observe(mapEl.value)
    if (stageEl.value) mapSizeObserver.observe(stageEl.value)
  }
})
onBeforeUnmount(() => {
  mapSizeObserver?.disconnect()
  mapSizeObserver = null
})
/** 笔迹抽稀阈值（屏幕 CSS px，与坐标体系无关；与回放 2D 同值，源内常量不外导）。 */
const ANNOT_THIN_PX = 2
watch([image, stageHeight], () => {
  if (!image.value) return
  // 尺寸就绪后的首次 fit；用户手势之后的 resize 保持已生效视图（与回放同一所有权语义）
  if (!fitObserved && stageWidth() > 0) {
    fitObserved = true
    fitView()
  }
}, { flush: 'post' })

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

// ---------- 标注（pen/eraser，语义坐标 + undo 栈）----------
const annotationOpen = ref(false)
const annotationTool = ref(null)
const annotationColor = ref(ANNOT_COLORS[0])
const annotationsVisible = ref(true)
const annotationHistory = ref([[]])
const annotationIndex = ref(0)
const annotations = computed(() => annotationHistory.value[annotationIndex.value] || [])
const draft = ref(null)

function replaceAnnotations(next) {
  const state = commit(annotationHistory.value, annotationIndex.value, next)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function undoAnnotation() {
  const state = undo(annotationHistory.value, annotationIndex.value)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function redoAnnotation() {
  const state = redo(annotationHistory.value, annotationIndex.value)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function clearAnnotations() {
  if (annotations.value.length) replaceAnnotations([])
}
function setAnnotationTool(tool) {
  annotationTool.value = tool
  if (!annotationsVisible.value) annotationsVisible.value = true
}
function openAnnotation() {
  if (annotationOpen.value) return
  annotationOpen.value = true
  annotationTool.value = 'pen'
  annotationsVisible.value = true
}
function closeAnnotation() {
  annotationOpen.value = false
  annotationTool.value = null
  cancelDrawing()
}
function resetAnnotationState() {
  annotationHistory.value = [[]]
  annotationIndex.value = 0
  annotationOpen.value = false
  annotationTool.value = null
  annotationsVisible.value = true
  draft.value = null
  pointers.clear()
  drawingPointerId = null
}

/** 指针 client 坐标 → 语义坐标（无地形 relief 预览，直接 screenToSemantic）。 */
function semanticPoint(e) {
  const sp = screenPoint(e.clientX, e.clientY)
  return screenToSemantic(view, mapView.value, sp.x, sp.y, renderRect().width, renderRect().height)
}

// ---------- 手势（单指平移 / 双指捏合 / 绘制），管线与回放 2D 同构 ----------
const pointers = new Map()
let panStart = null
let pinchStart = null
let drawingPointerId = null
let drawPoints = []
let drawScreen = []

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}
function startDrawing(e) {
  const p = semanticPoint(e)
  if (!p || !annotationsVisible.value) return
  drawingPointerId = e.pointerId
  if (annotationTool.value === 'eraser' || annotationTool.value === 'pen') {
    drawPoints = [p]
    drawScreen = [{ x: e.clientX, y: e.clientY }]
    draft.value = { type: annotationTool.value, color: annotationColor.value, width: annotWidth.value, points: [p] }
  }
}
function moveDrawing(e) {
  const p = semanticPoint(e)
  if (!p) return
  const last = drawScreen[drawScreen.length - 1]
  if (last == null || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= ANNOT_THIN_PX) {
    drawScreen.push({ x: e.clientX, y: e.clientY })
    drawPoints.push(p)
    draft.value = { ...draft.value, points: [...drawPoints] }
  }
}
function endDrawing() {
  const tool = annotationTool.value
  if (!tool) return
  if (tool === 'pen') {
    if (drawPoints.length >= 2) replaceAnnotations([...annotations.value, { type: 'pen', color: annotationColor.value, width: annotWidth.value, points: drawPoints }])
  } else if (tool === 'eraser') {
    if (drawPoints.length) {
      const next = applyEraser(annotations.value, drawPoints, annotationEraserRadius.value)
      if (next !== annotations.value) replaceAnnotations(next)
    }
  }
  cancelDrawing()
}
function cancelDrawing() {
  draft.value = null
  drawPoints = []
  drawScreen = []
  drawingPointerId = null
}
function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  if (e.pointerType === 'mouse' && e.button === 0) e.preventDefault()
  e.currentTarget?.focus?.({ preventScroll: true })
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try {
    if (typeof e.target.setPointerCapture === 'function') e.target.setPointerCapture(e.pointerId)
  } catch {
    // 测试环境可能不支持指针捕获
  }
  if (annotationOpen.value && annotationTool.value && pointers.size === 1) {
    startDrawing(e)
    return
  }
  if (drawingPointerId != null && pointers.size === 2) cancelDrawing()
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
  if (drawingPointerId === e.pointerId && annotationTool.value) {
    moveDrawing(e)
    return
  }
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
  if (!pointers.delete(e.pointerId)) return
  try {
    if (typeof e.target.releasePointerCapture === 'function') e.target.releasePointerCapture(e.pointerId)
  } catch {
    // 忽略（无捕获或已释放）
  }
  if (drawingPointerId === e.pointerId) {
    if (e.type === 'pointercancel') cancelDrawing()
    else endDrawing()
  }
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 0) {
    panStart = null
  } else if (pointers.size === 1 && pinchStart == null && panStart == null) {
    const [p] = [...pointers.values()]
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty }
  }
}

/** BattleMap 渲染输入：pen 草稿并入渲染列表；无车辆/浮层（桩函数永不被调用）。 */
// ---------- 底图切换 = 换图：标注清空（语义随图）+ 重解析底图 + 重新 fit ----------
// 注册点在标注状态声明之后——immediate 首评需要完整状态（resolveBasemap 会触发
// resetAnnotationState，其引用的 refs 此时必须已初始化）。
watch(() => props.basemap, (bm) => {
  fitObserved = false
  resetAnnotationState()
  resolveBasemap(bm)
}, { immediate: true })

const renderedAnnotations = computed(() => {
  const toX = mapView.value.toX
  const toY = mapView.value.toY
  const invX = 1 / Math.max(1e-9, semPerSvgX.value)
  const list = [...annotations.value]
  if (draft.value) list.push(draft.value)
  return list.map((ann) => {
    const out = { ...ann, widthSvg: (ann.width || annotWidth.value) * invX }
    if (ann.type === 'pen') out.svgPoints = polylinePoints(ann.points, toX, toY)
    return out
  })
})
const mapTouchPan = computed(() => !annotationOpen.value && view.scale <= fitScale() + 1e-3)

// ---------- 标注导入 / 导出（会话内文件落盘；fail-closed 校验）----------
const IMPORT_KIND = 'map-preview-annotations-2d'
/** 本面板的标注几何只有 pen：点列 ≥2、坐标有限、宽度为正。 */
function isImportableAnnotation(a) {
  return !!a && a.type === 'pen'
    && typeof a.color === 'string'
    && Number.isFinite(a.width) && a.width > 0
    && Array.isArray(a.points) && a.points.length >= 2
    && a.points.every((p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
}
const importMessage = ref('')
let importMessageTimer = 0
function flashImportMessage(key, values) {
  importMessage.value = t(key, values)
  clearTimeout(importMessageTimer)
  importMessageTimer = setTimeout(() => { importMessage.value = '' }, 4000)
}
function exportAnnotations() {
  if (!annotations.value.length) {
    flashImportMessage('mapPreview.annotations.noAnnotations')
    return
  }
  const payload = {
    version: 1,
    kind: IMPORT_KIND,
    mapKey: props.mapKey,
    exportedAt: new Date().toISOString(),
    annotations: annotations.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `map-annotations-${props.mapKey}-2d.json`
  a.click()
  URL.revokeObjectURL(url)
}
async function importAnnotations(event) {
  const file = event.target.files?.[0] || null
  event.target.value = ''
  if (!file) return
  let payload = null
  try {
    payload = JSON.parse(await file.text())
  } catch {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  if (!payload || payload.version !== 1 || payload.kind !== IMPORT_KIND || !Array.isArray(payload.annotations)) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  if (payload.mapKey !== props.mapKey) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonMap') })
    return
  }
  // 几何逐条校验（fail-closed，整份拒绝）：渲染层 polylinePoints 直接读 points[].x/y，
  // 半校验的条目会让「导入成功」提示之后紧跟渲染 TypeError。
  if (!payload.annotations.every(isImportableAnnotation)) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  const items = payload.annotations
  replaceAnnotations(items)
  flashImportMessage('mapPreview.annotations.importedCount', { count: items.length })
}

// BattleMap 必填的呈现函数在空车辆/浮层下不会被调用（预览无实体）
const stubText = () => ''
const stubNull = () => null
const stubFloatClass = () => ''
</script>

<template>
  <!-- 观察层（rootEl）与固定高度层（.map2d-body）分离：usePaneFillHeight 的 RO 观察
       外层——高度写在外层自身会让 RO 失活（固定盒不再 resize，陈旧测量死锁）。 -->
  <div ref="rootEl" class="map2d" data-testid="map-2d-pane">
    <div class="map2d-body" :style="{ height: stageHeight }">
      <div
        ref="stageEl"
        class="map2d-stage"
        data-testid="map-2d-stage"
        tabindex="0"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
      <!-- 居中方形舞台（边长 JS 实测 = min(舞台宽, 舞台高)）：底图 1:1 契约框是
           正方形，contain fit 以舞台为界（与回放正方形 stage 同构）——宽屏不留
           裁切、窄屏不留横滚，标注语义坐标不变。 -->
      <div
        ref="squareEl"
        class="map2d-square"
        :style="squareSide ? { width: squareSide + 'px', height: squareSide + 'px' } : null"
      >
        <p v-if="basemapError" class="map2d-error" data-testid="map-2d-basemap-error">{{ $t('mapPreview.basemapFailed') }}</p>
        <BattleMap
          v-if="image"
          ref="mapComponent"
          class="map2d-battlemap"
          :image="image"
          :map-view="mapView"
          :pb-overview="overview"
          :view-scale="view.scale"
          :viewport-style="viewportStyle"
          :touch-pan="mapTouchPan"
          :terrain-relief="false"
          :annot-visible="annotationsVisible"
          :rendered-annotations="renderedAnnotations"
          :annot-font-size="ANNOT_FONT_SIZE"
          :active-tool="annotationTool"
          :marker-label="stubText"
          :hp-for="stubNull"
          :hp-prefs="{}"
          :translate="t"
          :ghost-for="stubNull"
          :flash-for="stubNull"
          :float-team-class="stubFloatClass"
        />
      </div>
    </div>
    <div class="map2d-controls">
      <div v-if="annotationOpen" class="map2d-annotations" data-testid="map-2d-annotations">
        <AnnotationToolbar
          :open="annotationOpen"
          :active-tool="annotationTool"
          :annot-colors="ANNOT_COLORS"
          :annot-color="annotationColor"
          :annot-visible="annotationsVisible"
          :annot-width-slider="annotWidthSlider"
          :annot-width-min="ANNOT_WIDTH_MIN"
          :annot-width-max="ANNOT_WIDTH_MAX"
          :allowed-tools="['pen', 'eraser']"
          :eraser-radius-slider="annotationEraserRadius"
          :eraser-radius-min="ANNOT_ERASER_RADIUS_MIN"
          :eraser-radius-max="ANNOT_ERASER_RADIUS_MAX"
          :history-index="annotationIndex"
          :history="annotationHistory"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @toggle-tool="setAnnotationTool"
          @set-annot-color="annotationColor = $event"
          @update:annot-width="annotWidthSlider = $event"
          @update:eraser-radius="annotationEraserRadius = $event"
          @undo="undoAnnotation"
          @redo="redoAnnotation"
          @clear-annotations="clearAnnotations"
          @toggle-annotations="annotationsVisible = !annotationsVisible"
          @close="closeAnnotation"
        />
      </div>
      <div v-else class="map2d-toolrow">
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-drawing-entry"
          :aria-label="t('recon.map.playback.annot.mode')"
          :title="t('recon.map.playback.annot.mode')"
          @click="openAnnotation"
        >
          <PencilRuler :size="16" aria-hidden="true" /> {{ t('recon.map.playback.annot.mode') }}
        </button>
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-import"
          :title="$t('mapPreview.annotations.import')"
          @click="importFile.click()"
        >
          <Upload :size="16" aria-hidden="true" /> {{ $t('mapPreview.annotations.import') }}
        </button>
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-export"
          :title="$t('mapPreview.annotations.export')"
          @click="exportAnnotations"
        >
          <Download :size="16" aria-hidden="true" /> {{ $t('mapPreview.annotations.export') }}
        </button>
        <input
          ref="importFile"
          type="file"
          accept="application/json,.json"
          class="map2d-file-input"
          aria-hidden="true"
          tabindex="-1"
          @change="importAnnotations"
        />
      </div>
      <p v-if="importMessage" class="map2d-import-note" role="status" data-testid="map-2d-import-note">{{ importMessage }}</p>
    </div>
    </div>
  </div>
</template>

<style scoped>
.map2d {
  position: relative;
  min-height: 0;
}

/* 固定高度层（usePaneFillHeight 写入）：舞台吃剩余、controls 固有高——
   地图与下方绘制菜单同屏。 */
.map2d-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* root 高度 = 视口剩余高度（usePaneFillHeight）：舞台吃剩余、controls 固有高
   ——地图与下方绘制菜单同屏。 */
.map2d-stage {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas);
  touch-action: none;
}

/* 舞台内居中方形（边长 = min(舞台宽, 舞台高)，JS 实测写入内联尺寸）：底图契约框
   是正方形，contain fit 与 pan 夹都以这个舞台为界（与回放正方形 stage 同构）——
   宽屏不留裁切、窄屏不留横滚，标注语义坐标不变。 */
.map2d-square {
  position: relative;
  overflow: hidden;
}

.map2d-stage:focus-visible {
  outline: var(--focus-outline);
  outline-offset: calc(-1 * var(--focus-outline-offset));
}

.map2d-error {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  margin: 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-danger);
  font: var(--type-caption);
}

.map2d-battlemap {
  height: 100%;
}

/* 地图预览是整页查看器：BattleMap 根的回放内嵌宽度（66.7%）在本布局不适用，
   全幅铺满 stage——screen-space 几何全部取真实 mapEl 尺寸，宽度改动不影响坐标换算。 */
.map2d-stage :deep(.pb-map) {
  width: 100%;
}

.map2d-controls {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}

.map2d-toolrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.map2d-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  cursor: pointer;
}

.map2d-btn:hover {
  border-color: var(--color-border-strong);
}

.map2d-btn:focus-visible {
  outline: var(--focus-outline);
  outline-offset: var(--focus-outline-offset);
}

.map2d-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.map2d-import-note {
  margin: 0;
  color: var(--color-text-secondary);
  font: var(--type-caption);
}

.map2d-annotations {
  min-width: 0;
}
</style>
