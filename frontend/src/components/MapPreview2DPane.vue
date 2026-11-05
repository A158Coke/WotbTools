<script setup>
/**
 * 地图预览 2D 面板：底图双源（打包 mapImages 注册表 / 资产包 ground.webp 回退）
 * + 拖拽/捏合/滚轮缩放 + 标注绘制（pen/eraser，与 2D 回放同一坐标体系与撤销栈），
 * 无车辆、无回放。
 *
 * 手势与坐标管线复用回放的纯函数（zoomViewAt / clampViewPan / screenToSemantic /
 * utils/annotation 全套）；渲染复用 BattleMap.vue（纯展示，车辆/浮层以空数组 +
 * 桩函数传入）。标注与 Playback 2D 同一 schema/renderer/toolbar；本面板只负责
 * static-map 上下文的 orchestration、会话内保存 + 完整 JSON 导入导出 + 当前视角 PNG。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Image as ImageIcon, PencilRuler, Upload } from 'lucide-vue-next'
import BattleMap from './BattleMap.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import { mapBases } from '../data/mapBases.js'
import { playableBounds } from '../data/playableBounds.js'
import { WORLD_BOUNDS_300 } from '../data/mapImages.js'
import { mapGridProfile } from '../data/mapSemantics.js'
import { resolveMap2dBasemap } from '../scene/replaySource.js'
import { createMapView } from '../utils/mapView.js'
import {
  ANNOT_COLORS, ANNOT_ERASER_RADIUS_DEFAULT, ANNOT_ERASER_RADIUS_MAX, ANNOT_ERASER_RADIUS_MIN,
  ANNOT_FONT_SIZE, ANNOT_TANK_CLASSES, ANNOT_WIDTH_DEFAULT, ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN,
  annotationDraftFromTool, applyEraser, canRedo, canUndo, commit, hitTestAnnotation, isDegenerateAnnotation,
  isValidAnnotation, projectAnnotationToSvg, redo, screenToSemantic, semanticWidthFromSlider, svgToScreen,
  translateAnnotation, undo,
} from '../utils/annotation.js'
import { clampViewPan, zoomViewAt } from '../utils/battlePlayback.js'
import { computeExportDimensions, downloadBlob, sanitizeFilename } from '../utils/exportReplayPng.js'
import { usePaneFillHeight } from '../composables/usePaneFillHeight.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'

// 地图语义档案读取已收敛到 data/mapSemantics.js（与 3D 预览/回放同一入口；
// 出生点取 `sceneEvidence.battlePoints`，边界表由 `playableBoundsMeters` 生成，缺档 fail-closed）。

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
  /**
   * 基地点位组键（页面 ?bases= 解析后下发）：'supremacy' | 'assault' | null。
   * null / 组无几何 → 不渲染（fail-closed，绝不从内容猜坐标）。
   */
  basesKind: { type: String, default: null },
  /** 页面 v-show 生命周期闸门：失活时退出全屏，避免全屏落在隐藏面板上 */
  active: { type: Boolean, default: true },
})

const { t } = useI18n()

// ---------- 底图与坐标映射 ----------
const basemapImage = ref(null)   // { src, width, height, coordinateBounds }
const basemapError = ref(false)
const image = computed(() => basemapImage.value)
/** 2D 预览只读消费 canonical 地图事实，不新增第二份数据：spawn 来自语义
 *  `sceneEvidence.battlePoints`（预览无战局上下文 → 不传 friendlyTeam；spawnColorMode
 *  'scene-team' 让 BattleMap 按场景分组 team 画固定身份色，非 friendly/enemy 相对语义），
 *  边界来自 generated `playableBounds`（与 3D 边界 fallback 同一份）；缺档不猜。 */
const overview = computed(() => {
  const key = String(props.mapKey).toLowerCase()
  const bounds = playableBounds[key]
  return {
    mapCode: props.mapKey,
    spawnPoints: mapGridProfile(key)?.spawnPoints ?? [],
    ...(bounds ? { playableBounds: bounds } : {}),
  }
})
const mapView = computed(() => createMapView(image.value, overview.value))

// ---------- 基地点位（BattleMap :bases，与 2D 回放同一渲染与口径）----------
// 静态预览没有占领状态：固定 neutral、progress null（不渲染水位）。
// 半径是世界坐标米：supremacy 条目缺省 15m、assault 缺省 20m（与回放同一
// presentation fallback，BattleMap.baseRadius 负责米→SVG 像素换算）。
// assault 组多 candidate 无证据 fail-closed（与 3D/回放同式）：几何不唯一就不画。
const baseMarkers = computed(() => {
  const kind = props.basesKind
  if (kind !== 'supremacy' && kind !== 'assault') return []
  const pts = mapBases[props.mapKey]?.[kind] || []
  if (kind === 'assault' && pts.length !== 1) return []
  return pts.map((b) => ({
    baseId: kind === 'supremacy' ? b.baseId : 'BASE',
    x: b.x,
    y: b.y,
    radius: b.radius || (kind === 'supremacy' ? 15 : 20),
    status: 'neutral',
    progress: null,
    capturedBy: 'unknown',
  }))
})

/**
 * 底图解析：bundled 同步就位；map2d（全部 43 张的 canonical 1254² 校准战术底图，
 * ~900KB）异步经 map2d/index.json 的几何 + 完整性契约解析，失败 fail-visible。
 * 请求代际见 publishedUrl 注释：快速切图 A→B 时旧请求只清理自己的资源。
 */
async function resolveBasemap(bm) {
  const gen = ++basemapGen
  releasePublishedUrl()
  basemapImage.value = null
  basemapError.value = false
  if (!bm) return
  if (bm.kind === 'bundled') {
    basemapImage.value = bm.image
    return
  }
  const key = bm.mapKey || props.mapKey
  // map2d/index.json 契约（schema/generated、worldBounds/orientation、图片字节 sha256）：
  // 任一不成立 fail-visible，绝不"能加载就当 ±300"。世界框取自索引声明
  // （geometryMatches 已保证与注册表逐值相等）。
  const resolved = await (async () => {
    try {
      return await resolveMap2dBasemap(key, WORLD_BOUNDS_300)
    } catch (e) {
      return { error: 'offline', detail: String(e && e.message || e) }
    }
  })()
  if (gen !== basemapGen) return   // 过期（换图/卸载已介入）：未创建任何资源，直接退出
  if (resolved.error) {
    if (import.meta.env.DEV) {
      console.warn(`[map-preview] map2d 底图拒绝（${key}）:`, resolved.error, resolved.detail || '')
    }
    basemapError.value = true
    return
  }
  // 校验通过的字节转 blob URL 供 <img> 使用（避免二次拉取；释放见代际模型注释）
  const blobUrl = URL.createObjectURL(new Blob([resolved.bytes], { type: 'image/webp' }))
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('basemap decode failed'))
      el.src = blobUrl
    })
    // 代际核验必须先于任何状态写入：过期请求只释放自己的 URL 后退出——
    // 否则旧请求的尺寸失败/错误状态会误置到新代已发布的底图上。
    if (gen !== basemapGen) {
      URL.revokeObjectURL(blobUrl)   // 过期：只清理自己创建的 URL，新代的 owner 不归我管
      return
    }
    // 解码尺寸必须与 manifest 声明一致：index↔图片发布漂移（重导出/裁切）在此 fail-visible，
    // 不静默改用解码尺寸渲染（那会让 ±300 映射整体错位且无任何提示）。
    if (img.naturalWidth !== resolved.width || img.naturalHeight !== resolved.height) {
      if (import.meta.env.DEV) {
        console.warn(`[map-preview] map2d 底图尺寸漂移（${key}）:`, img.naturalWidth, 'x', img.naturalHeight, '!= manifest', resolved.width, 'x', resolved.height)
      }
      URL.revokeObjectURL(blobUrl)
      basemapError.value = true
      return
    }
    releasePublishedUrl()
    publishedUrl.value = blobUrl
    basemapImage.value = {
      src: blobUrl,
      width: resolved.width,
      height: resolved.height,
      coordinateBounds: resolved.worldBounds || WORLD_BOUNDS_300,
    }
  } catch {
    URL.revokeObjectURL(blobUrl)     // 解码失败：自己清理自己的 URL
    if (gen === basemapGen) basemapError.value = true
  }
}

/** 卸载：在途请求全部过期，已发布 URL 释放（900KB/张不常驻）。 */
onBeforeUnmount(() => {
  basemapGen++
  releasePublishedUrl()
})
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
const controlsEl = ref(null)
const mapComponent = ref(null)
/** BattleMap expose 的**真实地图 DOM**（组件实例没有 getBoundingClientRect）；
 *  桌面/平板下 .pb-map 根宽为 66.7%，所有 screen-space 几何必须以它为原点/尺寸。 */
const mapEl = computed(() => mapComponent.value?.mapEl || null)
const importFile = ref(null)
const { height: stageHeight } = usePaneFillHeight(rootEl)
const { isPhone } = usePlaybackPhoneForm()
const { isFullscreen, fullscreenSupported, toggleFullscreen } = usePlaybackFullscreen({
  target: () => rootEl.value,
  isPhone,
  isActive: () => props.active,
})
watch(() => props.active, (active) => {
  if (!active && isFullscreen.value) toggleFullscreen()
})
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const ZOOM_STEP = 1.2
const PAN_THRESHOLD_PX = 5
const PINCH_THRESHOLD_PX = 5
const FIT_MARGIN = 0.98
/** 居中方形舞台边长（min(舞台宽, 舞台高)，JS 实测——纯 CSS aspect-ratio 与
 *  max-width 冲突时会被拉成矩形，实测写入内联尺寸才稳定）。
 *  手机形态：舞台高度改为内容驱动（stage 内联高度 = 方形边长），边长 =
 *  min(舞台宽, 填充高度 − 工具区实高)——地图吃满可用宽度且工具栏紧随地图，
 *  不再因「舞台吃剩余高度」在地图与工具栏之间留大块空白；装不下时交给页面滚动。 */
const squareSide = ref(0)
function measureSquare() {
  const w = stageEl.value?.clientWidth || 0
  const h = stageEl.value?.clientHeight || 0
  if (isPhone.value) {
    const fill = Number.parseFloat(stageHeight.value) || 0
    const budget = fill - (controlsEl.value?.offsetHeight || 0)
    // 预算可为负（标注工具在窄屏换行后高于剩余空间）：方形不塌 0，按下限渲染、
    // 超出部分交给页面滚动（Plan：小高度设备允许合理滚动而不是遮挡内容）。
    const MIN_SQUARE = 180
    squareSide.value = w > 0 ? Math.floor(Math.min(w, Math.max(budget, MIN_SQUARE))) : 0
    return
  }
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
  // 新底图 DOM：初始 fit 待完成——**只在真实 map DOM 有有效尺寸时**由 RO 登记
  // fitObserved=true（慢速 ground 载入竞态：边长已测、图未载入时不抢登记）。
  fitObserved = false
}, { flush: 'post' })
watch(stageHeight, measureSquare, { flush: 'post' })
// 手机形态切换（旋转/跨断点）重测；标注工具开合的 watch 在 annotationOpen 声明之后注册
onMounted(() => {
  measureSquare()
  if (typeof ResizeObserver === 'function') {
    let lastValidSide = 0
    mapSizeObserver = new ResizeObserver(() => {
      const prevSide = lastValidSide
      measureSquare()
      // 零尺寸（v-show 隐藏 / 卸载中）：不动 view、保留 prevSide——
      // 2D⇄3D 切换回来时才能正确比较尺寸变化。
      if (!squareSide.value) return
      const firstValid = prevSide === 0
      const sideChanged = !firstValid && squareSide.value !== prevSide
      lastValidSide = squareSide.value
      // 同尺寸且 fit 已完成：无需处理（慢速 ground 载入完成后的新 mapEl 同尺寸
      // 通知走下面 !fitObserved 分支补 fit）。
      if (!firstValid && !sideChanged && fitObserved) return
      // clamp/fit 等 Vue 把新方形尺寸写入 DOM 后执行（post-flush）——同步读
      // clientWidth 会拿到旧值，夹出越界空白。
      nextTick(() => {
        if (!squareSide.value) return
        if (!fitObserved) {
          // 当前底图的初始 fit：仅在真实 map DOM 有效尺寸时执行并登记完成；
          // 底图未载入保持 pending，等后续通知补做。
          if (mapEl.value && mapEl.value.clientWidth > 0) {
            fitObserved = true
            fitView()
          }
          return
        }
        if (sideChanged) applyView(view)   // 保留用户 scale/tx/ty，按新边界 clamp
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

/**
 * blob URL 生命周期（请求代际模型）：换图/卸载递增 `basemapGen` 使所有在途请求过期；
 * 每个请求只清理**自己创建**的资源——过期请求 revoke 自己的 URL 后退出，绝不触碰
 * 新代已发布的 URL；`publishedUrl` 是唯一已发布 owner（revoke 它 = 换图/卸载释放）。
 * 快速切图 A→B 的正确性：旧请求在每个 await 后核验代际，发布前再核验一次。
 */
let basemapGen = 0
const publishedUrl = ref(null)
function releasePublishedUrl() {
  if (publishedUrl.value) {
    URL.revokeObjectURL(publishedUrl.value)
    publishedUrl.value = null
  }
}

// ---------- 标注（Playback 2D 全量工具，语义坐标 + undo 栈）----------
const annotationOpen = ref(false)
const annotationTool = ref(null)
const annotationColor = ref(ANNOT_COLORS[0])
const annotationsVisible = ref(true)
const annotationHistory = ref([[]])
const annotationIndex = ref(0)
const annotations = computed(() => annotationHistory.value[annotationIndex.value] || [])
const selectedAnnotationIndex = ref(-1)
const selectedAnnotation = computed(() => annotations.value[selectedAnnotationIndex.value] || null)
const routePoints = ref([])
const textSession = ref(null)
const draft = ref(null)
let moveOriginal = null
let drawStart = null
let drawPoints = []
let drawScreen = []
let drawingPointerId = null
let drawingStartScreen = null
const exportingImage = ref(false)
const exportError = ref('')

function replaceAnnotations(next) {
  const state = commit(annotationHistory.value, annotationIndex.value, next)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function commitDraft(annotation) {
  replaceAnnotations([...annotations.value, annotation])
}
function updateSelected(patch) {
  if (!selectedAnnotation.value) return
  const index = selectedAnnotationIndex.value
  replaceAnnotations(annotations.value.map((annotation, i) => i === index ? { ...annotation, ...patch } : annotation))
}
function undoAnnotation() {
  cancelRoute()
  selectedAnnotationIndex.value = -1
  const state = undo(annotationHistory.value, annotationIndex.value)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function redoAnnotation() {
  cancelRoute()
  selectedAnnotationIndex.value = -1
  const state = redo(annotationHistory.value, annotationIndex.value)
  annotationHistory.value = state.history
  annotationIndex.value = state.index
}
function clearAnnotations() {
  cancelRoute()
  selectedAnnotationIndex.value = -1
  if (annotations.value.length) replaceAnnotations([])
}
function deleteSelected() {
  if (!selectedAnnotation.value) return
  replaceAnnotations(annotations.value.filter((_, index) => index !== selectedAnnotationIndex.value))
  selectedAnnotationIndex.value = -1
}
function renameSelected(label) {
  const value = String(label).trim().slice(0, 60)
  if (!selectedAnnotation.value) return
  if (selectedAnnotation.value.type === 'text') {
    // 空 text 不是可持久化 schema；保持原值，避免导出的 JSON 无法重新导入。
    if (!value) return
    updateSelected({ text: value })
  } else updateSelected({ label: value })
}
function setAnnotationTool(tool) {
  if (textSession.value) commitTextSession(textSession.value)
  cancelRoute()
  selectedAnnotationIndex.value = -1
  annotationsVisible.value = true
  annotationTool.value = tool
}
function setAnnotationColor(color) {
  annotationColor.value = color
  if (selectedAnnotation.value) updateSelected({ color })
  if (routePoints.value.length) draft.value = routeDraft()
}
function toggleAnnotations() {
  cancelRoute()
  selectedAnnotationIndex.value = -1
  annotationsVisible.value = !annotationsVisible.value
}
function openAnnotation() {
  if (annotationOpen.value) return
  annotationOpen.value = true
  annotationTool.value = 'select'
  annotationsVisible.value = true
}
function closeAnnotation() {
  if (textSession.value) commitTextSession(textSession.value)
  cancelRoute()
  annotationOpen.value = false
  annotationTool.value = null
  selectedAnnotationIndex.value = -1
}
function resetAnnotationState() {
  annotationHistory.value = [[]]
  annotationIndex.value = 0
  annotationOpen.value = false
  annotationTool.value = null
  annotationsVisible.value = true
  selectedAnnotationIndex.value = -1
  routePoints.value = []
  if (textSession.value) cancelTextSession(textSession.value)
  textSession.value = null
  draft.value = null
  exportError.value = ''
  exportingImage.value = false
  pointers.clear()
  drawingPointerId = null
  drawStart = null
  drawPoints = []
  drawScreen = []
  moveOriginal = null
  drawingStartScreen = null
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

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}

function cancelRoute() {
  routePoints.value = []
  cancelDrawing()
}

function routeDraft() {
  return { type: 'route', color: annotationColor.value, width: annotWidth.value, points: [...routePoints.value] }
}

function finishRoute() {
  if (routePoints.value.length < 2) return
  const annotation = routeDraft()
  routePoints.value = []
  cancelDrawing()
  commitDraft(annotation)
}

function selectionTolerance() {
  const rect = renderRect()
  const width = rect.width || mapView.value.W
  return 12 * semPerSvgX.value * mapView.value.W / width / Math.max(1, view.scale)
}

function startDrawing(e) {
  const point = semanticPoint(e)
  if (!point || !annotationsVisible.value) return
  drawingPointerId = e.pointerId
  drawingStartScreen = { x: e.clientX, y: e.clientY }
  const tool = annotationTool.value
  if (tool === 'select') {
    selectedAnnotationIndex.value = hitTestAnnotation(annotations.value, point, selectionTolerance())
    moveOriginal = selectedAnnotation.value
    drawStart = point
    return
  }
  if (tool === 'route' || ANNOT_TANK_CLASSES.some(item => item.key === tool)) {
    drawStart = point
    if (tool === 'route') draft.value = routeDraft()
    return
  }
  if (tool === 'text') {
    if (textSession.value) commitTextSession(textSession.value)
    textSession.value = reactive({ point, text: '' })
    nextTick(() => mapComponent.value?.textInputRef?.focus())
    return
  }
  if (tool === 'pen' || tool === 'eraser') {
    drawPoints = [point]
    drawScreen = [{ x: e.clientX, y: e.clientY }]
    draft.value = { type: tool, color: annotationColor.value, width: annotWidth.value, points: [point] }
    return
  }
  drawStart = point
  draft.value = annotationDraftFromTool(tool, point, point, { color: annotationColor.value, width: annotWidth.value })
}

function moveDrawing(e) {
  const point = semanticPoint(e)
  if (!point) return
  const tool = annotationTool.value
  if (tool === 'select' && moveOriginal && drawStart) {
    if (Math.hypot(point.x - drawStart.x, point.y - drawStart.y) > 1e-9) {
      draft.value = translateAnnotation(moveOriginal, point.x - drawStart.x, point.y - drawStart.y)
    }
    return
  }
  if (tool === 'route' || ANNOT_TANK_CLASSES.some(item => item.key === tool)) return
  if (tool === 'pen' || tool === 'eraser') {
    const last = drawScreen[drawScreen.length - 1]
    if (last == null || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= ANNOT_THIN_PX) {
      drawScreen.push({ x: e.clientX, y: e.clientY })
      drawPoints.push(point)
      draft.value = { ...draft.value, points: [...drawPoints] }
    }
    return
  }
  if (drawStart) draft.value = annotationDraftFromTool(tool, drawStart, point, { color: annotationColor.value, width: annotWidth.value })
}

function endDrawing() {
  const tool = annotationTool.value
  if (!tool) return
  if (tool === 'select') {
    if (draft.value && moveOriginal && selectedAnnotationIndex.value >= 0) {
      const index = selectedAnnotationIndex.value
      replaceAnnotations(annotations.value.map((annotation, i) => i === index ? draft.value : annotation))
    }
  } else if (tool === 'route') {
    if (drawStart) {
      const last = routePoints.value.at(-1)
      if (!last || Math.hypot(last.x - drawStart.x, last.y - drawStart.y) > 1e-9) routePoints.value.push(drawStart)
    }
    cancelDrawing()
    return
  } else if (ANNOT_TANK_CLASSES.some(item => item.key === tool) && drawStart) {
    commitDraft({ type: 'unit', tankClass: tool, color: annotationColor.value, x: drawStart.x, y: drawStart.y, radius: 16 * semPerSvgX.value, label: '' })
  } else if (tool === 'pen') {
    if (drawPoints.length >= 2) commitDraft({ type: 'pen', color: annotationColor.value, width: annotWidth.value, points: drawPoints })
  } else if (tool === 'eraser') {
    if (drawPoints.length) {
      const next = applyEraser(annotations.value, drawPoints, annotationEraserRadius.value)
      if (next !== annotations.value) replaceAnnotations(next)
    }
  } else if (draft.value && !isDegenerateAnnotation(draft.value)) {
    commitDraft(draft.value)
  }
  cancelDrawing()
}

function cancelDrawing() {
  draft.value = routePoints.value.length ? routeDraft() : null
  drawStart = null
  drawPoints = []
  drawScreen = []
  moveOriginal = null
  drawingPointerId = null
  drawingStartScreen = null
}

function onPointerDown(e) {
  if (e.button != null && e.button !== 0) return
  // 文本输入框是 BattleMap 内的真实交互控件：不能让 stage 抢焦点/开始绘图。
  if (e.target instanceof Element && (e.target.closest('input, textarea') || e.target.isContentEditable)) return
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

function onStageKeydown(e) {
  if (!annotationOpen.value || e.isComposing) return
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === 'Enter' && annotationTool.value === 'route') {
    e.preventDefault()
    finishRoute()
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotation.value) {
    e.preventDefault()
    deleteSelected()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    if (routePoints.value.length) cancelRoute()
    else closeAnnotation()
  }
}

function updateTextSession(value) {
  if (textSession.value) textSession.value.text = String(value)
}

function commitTextSession(session) {
  if (!session || session.cancelled || session.committed) return
  if (textSession.value === session) textSession.value = null
  session.committed = true
  const text = session.text.trim()
  if (!text) return
  commitDraft({ type: 'text', color: annotationColor.value, x: session.point.x, y: session.point.y, text })
}

function cancelTextSession(session) {
  if (textSession.value === session) textSession.value = null
  if (session) session.cancelled = true
}

const textInputStyle = computed(() => {
  const session = textSession.value
  if (!session) return null
  const point = svgToScreen(mapView.value, view, mapView.value.toX(session.point.x), mapView.value.toY(session.point.y), mapWidth(), mapHeight())
  if (!point) return null
  return { left: `${point.x}px`, top: `${point.y}px` }
})

/** 渲染输入：全类型 semantic → SVG；draft 覆盖被拖动的原 annotation。 */
const renderedAnnotations = computed(() => {
  const toX = mapView.value.toX
  const toY = mapView.value.toY
  const invX = 1 / Math.max(1e-9, semPerSvgX.value)
  const invY = 1 / Math.max(1e-9, semPerSvgY.value)
  const list = [...annotations.value]
  if (draft.value) {
    if (moveOriginal && selectedAnnotationIndex.value >= 0) list[selectedAnnotationIndex.value] = draft.value
    else list.push(draft.value)
  }
  return list.map((annotation, index) => ({
    ...projectAnnotationToSvg(annotation, { toX, toY, invX, invY, widthFallback: annotWidth.value }),
    selected: annotationOpen.value && index === selectedAnnotationIndex.value,
  }))
})
const mapTouchPan = computed(() => !annotationOpen.value && view.scale <= fitScale() + 1e-3)

// ---------- 底图切换 = 换图：标注清空（语义随图）+ 重解析底图 + 重新 fit ----------
// 标注工具开合改变工具区实高（手机形态地图预算随之变化），nextTick 后重测方形边长
watch(annotationOpen, () => nextTick(measureSquare), { flush: 'post' })
watch(() => props.basemap, (bm) => {
  fitObserved = false
  resetAnnotationState()
  resolveBasemap(bm)
}, { immediate: true })

// ---------- 标注导入 / 导出（完整 schema；旧 pen-only / -2d / -3d 兼容）----------
const IMPORT_KIND = 'map-preview-annotations'
const IMPORT_KINDS = new Set([
  IMPORT_KIND,
  'map-preview-annotations-2d',
  'map-preview-annotations-3d',
])
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
  if (!payload || payload.version !== 1 || !IMPORT_KINDS.has(payload.kind) || !Array.isArray(payload.annotations)) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  if (payload.mapKey !== props.mapKey) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonMap') })
    return
  }
  if (!payload.annotations.every(isValidAnnotation)) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: t('mapPreview.annotations.importReasonFormat') })
    return
  }
  replaceAnnotations(payload.annotations)
  selectedAnnotationIndex.value = -1
  flashImportMessage('mapPreview.annotations.importedCount', { count: payload.annotations.length })
}

// ---------- 当前视角 PNG 导出（html2canvas 捕获 BattleMap 的 .pb-map）----------
function mapPngFilename() {
  const now = new Date()
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('')
  const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('')
  return `wotb-map-${sanitizeFilename(props.mapKey)}-${date}-${time}.png`
}

async function exportImage() {
  if (exportingImage.value) return
  const target = mapComponent.value?.mapEl
  if (!target || !image.value) {
    exportError.value = t('mapPreview.annotations.exportFailed')
    return
  }
  if (textSession.value) commitTextSession(textSession.value)
  exportingImage.value = true
  exportError.value = ''
  let container = null
  try {
    await nextTick()
    const rect = target.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('map viewport has no size')
    const clone = target.cloneNode(true)
    clone.querySelectorAll('.pb-annot-item.is-selected').forEach((element) => element.classList.remove('is-selected'))
    clone.querySelectorAll('.pb-text-input').forEach((element) => element.remove())
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.left = '-10000px'
    container.style.top = '0'
    container.style.pointerEvents = 'none'
    container.setAttribute('aria-hidden', 'true')
    container.appendChild(clone)
    document.body.appendChild(container)
    const dims = computeExportDimensions({ width: rect.width, height: rect.height })
    const stageBackground = stageEl.value ? getComputedStyle(stageEl.value).backgroundColor : ''
    const canvasBackground = stageBackground && stageBackground !== 'rgba(0, 0, 0, 0)'
      ? stageBackground
      : (getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim() || '#000')
    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(clone, {
      scale: dims.scale,
      useCORS: true,
      backgroundColor: canvasBackground,
      width: dims.width,
      height: dims.height,
    })
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('canvas.toBlob returned null')
    await downloadBlob(blob, mapPngFilename())
  } catch (error) {
    console.error('[Map Preview PNG Export] failed', error)
    exportError.value = t('mapPreview.annotations.exportFailed')
  } finally {
    if (container?.parentNode) container.parentNode.removeChild(container)
    exportingImage.value = false
  }
}

// BattleMap 必填的呈现函数在空车辆/浮层下不会被调用（预览无实体）
const stubText = () => ''
const stubNull = () => null
const stubFloatClass = () => ''
</script>

<template>
  <!-- 观察层（rootEl）与固定高度层（.map2d-body）分离：usePaneFillHeight 的 RO 观察
       外层——高度写在外层自身会让 RO 失活（固定盒不再 resize，陈旧测量死锁）。 -->
  <div ref="rootEl" class="map2d" :class="{ 'map2d-phone': isPhone }" data-testid="map-2d-pane">
    <SceneFullscreenButton
      v-if="fullscreenSupported"
      floating
      :is-fullscreen="isFullscreen"
      data-testid="map-2d-fullscreen"
      @toggle="toggleFullscreen()"
    />
    <div class="map2d-body" :style="isPhone ? null : { height: stageHeight }">
      <div
        ref="stageEl"
        class="map2d-stage"
        data-testid="map-2d-stage"
        :style="isPhone && squareSide ? { height: squareSide + 'px' } : null"
        tabindex="0"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @keydown="onStageKeydown"
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
          spawn-color-mode="scene-team"
          :show-playable-boundary="true"
          :bases="baseMarkers"
          :view-scale="view.scale"
          :viewport-style="viewportStyle"
          :touch-pan="mapTouchPan"
          :terrain-relief="false"
          :annot-visible="annotationsVisible"
          :rendered-annotations="renderedAnnotations"
          :annot-font-size="ANNOT_FONT_SIZE"
          :active-tool="annotationTool"
          :text-session="textSession"
          :text-input-style="textInputStyle"
          :marker-label="stubText"
          :hp-for="stubNull"
          :hp-prefs="{}"
          :translate="t"
          :ghost-for="stubNull"
          :flash-for="stubNull"
          :float-team-class="stubFloatClass"
          @update-text="updateTextSession"
          @commit-text="commitTextSession"
          @cancel-text="cancelTextSession"
        />
      </div>
    </div>
    <div ref="controlsEl" class="map2d-controls">
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
          :selected-annotation="selectedAnnotation"
          :route-point-count="routePoints.length"
          :eraser-radius-slider="annotationEraserRadius"
          :eraser-radius-min="ANNOT_ERASER_RADIUS_MIN"
          :eraser-radius-max="ANNOT_ERASER_RADIUS_MAX"
          :history-index="annotationIndex"
          :history="annotationHistory"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @toggle-tool="setAnnotationTool"
          @set-annot-color="setAnnotationColor"
          @update:annot-width="annotWidthSlider = $event"
          @update:eraser-radius="annotationEraserRadius = $event"
          @undo="undoAnnotation"
          @redo="redoAnnotation"
          @clear-annotations="clearAnnotations"
          @toggle-annotations="toggleAnnotations"
          @rename-selected="renameSelected"
          @delete-selected="deleteSelected"
          @finish-route="finishRoute"
          @cancel-route="cancelRoute"
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
      <div class="map2d-image-row">
        <button
          type="button"
          class="map2d-btn"
          data-testid="map-2d-export-image"
          :disabled="exportingImage || !image"
          @click="exportImage"
        >
          <ImageIcon :size="16" aria-hidden="true" />
          {{ exportingImage ? $t('mapPreview.annotations.exporting') : $t('mapPreview.annotations.exportImage') }}
        </button>
        <p v-if="exportError" class="map2d-export-error" role="alert" data-testid="map-2d-export-error">{{ exportError }}</p>
      </div>
      <p v-if="importMessage" class="map2d-import-note" role="status" data-testid="map-2d-import-note">{{ importMessage }}</p>
      <!-- 页面级操作帮助（Map Preview 无正式教程入口，本提示即最小帮助入口） -->
      <p class="map2d-hint" data-testid="map-2d-controls-hint">{{ t('mapPreview.controlsHint2d') }}</p>
    </div>
    </div>
  </div>
</template>

<style scoped>
.map2d {
  position: relative;
  min-height: 0;
}

.map2d:fullscreen {
  padding: 0;
  background: var(--color-canvas);
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

/* 手机形态：body 高度内容驱动（stage 内联高度 = 方形边长），工具栏紧随地图；
   舞台不再 flex 吃剩余。min-height 保证底图错误态可见。 */
.map2d-phone .map2d-stage {
  flex: 0 0 auto;
  min-height: 120px;
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

.map2d-toolrow,
.map2d-image-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.map2d-export-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--type-caption);
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

.map2d-hint {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--type-caption);
}

.map2d-annotations {
  min-width: 0;
}
</style>