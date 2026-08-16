<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mapImages } from '../data/mapImages'
import { teamCssVars } from '../data/mapTeamColors'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'
import { createMapView } from '../utils/mapView'
import VehicleMarker from './VehicleMarker.vue'
import enemyHull from '../assets/tank-icons/tank-marker-enemy-hull.png'
import enemyTurret from '../assets/tank-icons/tank-marker-enemy-turret.png'
import friendlyHull from '../assets/tank-icons/tank-marker-friendly-hull.png'
import friendlyTurret from '../assets/tank-icons/tank-marker-friendly-turret.png'
import {
  aggregateEventsBySecond,
  clampViewPan,
  formatClock,
  interpolateDirection,
  lastKnownPosition,
  positionAt,
  positionCoveredAt,
  recorderRelated,
  screenRotation,
  teamHp,
  teamPointsAt,
  teamRelated,
  tracerLines,
  turretWorldYawDeg,
  zoomViewAt
} from '../utils/battlePlayback'
import {
  PLAYER_HIDE_MS,
  PLAYER_SHOW_MS,
  computeLabelLayout,
  resolvePlayerVisibility,
} from '../utils/labelLayout'
import {
  ANNOT_COLORS,
  ANNOT_FONT_SIZE,
  ANNOT_WIDTH_DEFAULT,
  ANNOT_WIDTH_MAX,
  ANNOT_WIDTH_MIN,
  applyEraser,
  arrowHeadPoints,
  canRedo,
  canUndo,
  circleFromCorners,
  commit,
  polylinePoints,
  rectFromCorners,
  redo,
  screenToSemantic,
  svgToScreen,
  undo
} from '../utils/annotation'

/**
 * 战局回放（Battle Playback）：地图鸟瞰第三视图。
 * 复用 mapImages 素材、coordinateBounds 坐标映射、自适应色板与响应式布局；
 * RAF 推进播放时间，仅在同一可信连续点（gap ≤ 5s）之间插值。
 */
const props = defineProps({
  overview: { type: Object, required: true },
  seekTo: { type: Number, default: null },
  /** QA 场景循环播放（PR4 §49：时间线到末尾自动回到 0 继续） */
  loop: { type: Boolean, default: false }
})

const { t } = useI18n()

const image = computed(() => mapImages[props.overview.mapCode] || null)
const mapView = computed(() => createMapView(image.value, props.overview))

// 自适应配色（与热力/路线视图同一色板）
const palette = ref(darkMapPalette)
watch(image, async (img) => {
  palette.value = paletteForLuminance(await luminanceOfImage(img))
}, { immediate: true })

const playback = computed(() => props.overview.playback || null)
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => props.overview.friendlyTeam)

// ---- PR2：Tier X dedicated model preload（计划 §12/§13）----
// runtime.js 含全部车型资产引用（import.meta.glob），必须动态 import 保持主 bundle 分离
// （scripts/check-bundle-separation.mjs 门禁：主入口不得含 'vehicle-models/assets'）。
// preload 完成前不渲染车辆（asset decision 先于渲染，禁止 generic 闪现后替换）。
const preload = ref({ phase: 'idle', resolved: new Map(), failed: new Set(), byTank: new Map() })
// 竞态令牌：快速切换战局时，过期 preload 完成不得覆盖新战局结果
let preloadToken = 0
watch(
  () => props.overview,
  async (ov) => {
    const token = ++preloadToken
    preload.value = { phase: 'loading', resolved: new Map(), failed: new Set(), byTank: new Map() }
    const vehicles = ov?.playback?.vehicles || []
    if (vehicles.length === 0) {
      preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), byTank: new Map() }
      return
    }
    try {
      const { preloadBattleModels } = await import('../vehicle-models/runtime.js')
      const result = await preloadBattleModels(vehicles.map((v) => v.tankId))
      if (token !== preloadToken) return // 过期结果丢弃
      preload.value = { phase: 'ready', ...result }
    } catch (e) {
      // 模块加载异常 → 整场 generic fallback（计划 §11：静默，不弹 warning）
      console.error('[vehicle-models] preload 模块加载失败 → 整场 generic fallback', e)
      if (token !== preloadToken) return
      preload.value = { phase: 'ready', resolved: new Map(), failed: new Set(), byTank: new Map() }
    }
  },
  { immediate: true },
)

// 双方总血量（实时剩余，随播放时间/进度条变化；争霸赛附终局点数）
// 本方：存活车辆尚无血量变化采样时按 maxHp 回退（开局满血）；敌方：无可信采样恒 UNKNOWN 灰段（不把理论 maxHp 当已知血量）
const friendlyHp = computed(() => teamHp(playback.value?.vehicles, friendlyTeam.value, currentTime.value, true))
const enemyHp = computed(() => teamHp(playback.value?.vehicles, friendlyTeam.value === 1 ? 2 : 1, currentTime.value, false))
// 争霸赛实时点数：来自回放广播 pointsSamples（随 currentTime 变化）；非争霸赛/无广播 → null 不显示
const friendlyPoints = computed(() =>
  teamPointsAt(playback.value?.pointsSamples, friendlyTeam.value, currentTime.value))
const enemyPoints = computed(() =>
  teamPointsAt(playback.value?.pointsSamples, friendlyTeam.value === 1 ? 2 : 1, currentTime.value))
const showPoints = computed(() => friendlyPoints.value != null || enemyPoints.value != null)
/** HP bar 填充宽度：kind='known' 阵营色实段（已知剩余）、'unknown' 灰色弱化段（未观测容量）。 */
function hpBarFill(hp, kind) {
  const total = hp.totalMax || 0
  if (total <= 0) return '0%'
  const val = kind === 'known' ? hp.knownRemaining : hp.unknownMax
  return `${Math.max(0, Math.min(100, (val / total) * 100)).toFixed(1)}%`
}

// ---- 播放状态 ----
const currentTime = ref(0)
const playing = ref(false)
const speed = ref(1)
// PR4 §33：hysteresis 时间基准（performance.now，RAF/seek 推进；暂停时冻结）
const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)

// ---- PR4 §26：玩家/坦克名显示偏好（默认 showPlayerName=false / showTankName=true，localStorage 持久化）----
const LABEL_PREFS_KEY = 'wotb.pb.label-prefs'
function loadLabelPrefs() {
  try {
    const raw = localStorage.getItem(LABEL_PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        showPlayerName: p.showPlayerName === true,
        showTankName: p.showTankName !== false,
      }
    }
  } catch {
    // 损坏/不可用 → 默认值
  }
  return { showPlayerName: false, showTankName: true }
}
const labelPrefs = reactive(loadLabelPrefs())
watch(labelPrefs, (p) => {
  try {
    localStorage.setItem(LABEL_PREFS_KEY, JSON.stringify(p))
  } catch {
    // 隐私模式/配额满：静默（本次会话内仍生效）
  }
}, { deep: true })
const showAll = ref(false)
const typeFilter = ref(new Set(['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']))
const selectedAccountId = ref(null)
const eventPopupSec = ref(null)
let rafId = null
let lastFrameTs = null

// ---- 地图视图缩放/平移：单一 transform 层保证地图/网格/炮线/标记严格对齐 ----
const mapEl = ref(null)
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const PAN_THRESHOLD_PX = 5
const PINCH_THRESHOLD_PX = 5
const ZOOM_STEP = 1.2
const pointers = new Map()
let panStart = null
let pinchStart = null
let suppressClick = false
// 当前交互是否为真实手势（单指拖动超阈值 / 双指捏合距离或中点移动超阈值）：
// 手势结束后的首个 click 必须被吞掉，纯点击车辆仍正常选中
let gestureMoved = false

function applyView(next) {
  const clamped = clampViewPan(
    next,
    mapEl.value ? mapEl.value.clientWidth : 0,
    mapEl.value ? mapEl.value.clientHeight : 0
  )
  view.scale = clamped.scale
  view.tx = clamped.tx
  view.ty = clamped.ty
}

const viewportStyle = computed(() => `transform: translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`)

// 车辆标记随地图缩放（用户确认「坦克随地图一起放大，相对地图比例不变」）：
// 标记中心锚定在地图坐标（left/top % 经 viewport 变换），本体不再反缩放；
// 坦克名/阵亡 ✕ 等 UI 叠加层单独反缩放（overlayInverseScale）保持屏幕恒定；
// hull/turret 的方向旋转在子元素 img 上，不受缩放影响。
const markerTransform = computed(() => `translate(-50%, -50%)`)
// overlay 反缩放数值（=1/view.scale）：元素尺寸（transform scale）与 layout offset（bottom/top calc）
// 都按它反缩放 → zoom 下 selected/recorder 与车辆的屏幕间距恒定，不随 1×/2×/4× 增长
const overlayInverse = computed(() => 1 / view.scale)
const overlayInverseScale = computed(() => `scale(${overlayInverse.value})`)

/** 指针 client 坐标 → 相对地图容器的**屏幕坐标**（zoomViewAt 契约，不参与任何变换）。 */
function screenPoint(clientX, clientY) {
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  return { x: clientX - rect.left, y: clientY - rect.top }
}

function onWheel(e) {
  const p = screenPoint(e.clientX, e.clientY)
  applyView(zoomViewAt(view, p.x, p.y, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))
}

function pinchInfo() {
  const [a, b] = [...pointers.values()]
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return { mid, dist: Math.hypot(a.x - b.x, a.y - b.y) }
}

function onPointerDown(e) {
  suppressClick = false
  gestureMoved = false
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  // 指针捕获（受支持时）：指针移出地图仍持续收到 move/up；不支持的环境走 window 级兜底
  try {
    if (typeof e.target.setPointerCapture === 'function') {
      e.target.setPointerCapture(e.pointerId)
    }
  } catch {
    // 某些测试环境不支持指针捕获，忽略
  }
  // 标注绘制：单指 + 激活工具 → 走绘制，不进入平移
  if (activeTool.value && pointers.size === 1) {
    startDrawing(e)
    return
  }
  // 绘制中落下第二根手指：先提交当前笔画，再转入双指捏合
  if (drawingPointerId != null && pointers.size === 2) {
    endDrawing()
    drawingPointerId = null
  }
  if (pointers.size === 1) {
    panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
  } else if (pointers.size === 2) {
    const info = pinchInfo()
    pinchStart = {
      mid: info.mid,
      dist: info.dist,
      // 锚点 = 双指中点相对地图容器的屏幕坐标（zoomViewAt 契约）
      anchorScreen: screenPoint(info.mid.x, info.mid.y),
      scale: view.scale,
      tx: view.tx,
      ty: view.ty,
      moved: false
    }
    panStart = null
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (drawingPointerId === e.pointerId && activeTool.value) {
    moveDrawing(e)
    return
  }
  if (pointers.size === 2 && pinchStart) {
    const { mid, dist } = pinchInfo()
    if (!pinchStart.moved
        && (Math.abs(dist - pinchStart.dist) > PINCH_THRESHOLD_PX
            || Math.hypot(mid.x - pinchStart.mid.x, mid.y - pinchStart.mid.y) > PINCH_THRESHOLD_PX)) {
      pinchStart.moved = true
      gestureMoved = true
    }
    if (pinchStart.dist > 0 && dist > 0) {
      const next = zoomViewAt(
        { scale: pinchStart.scale, tx: pinchStart.tx, ty: pinchStart.ty },
        pinchStart.anchorScreen.x, pinchStart.anchorScreen.y, dist / pinchStart.dist
      )
      // 两指中点整体移动 = 屏幕平移（translate 单位为屏幕像素，直接加 client 位移）
      next.tx += mid.x - pinchStart.mid.x
      next.ty += mid.y - pinchStart.mid.y
      applyView(next)
    }
    return
  }
  if (pointers.size === 1 && panStart) {
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    if (!panStart.moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return
    panStart.moved = true
    gestureMoved = true
    applyView({ scale: view.scale, tx: panStart.tx + dx, ty: panStart.ty + dy })
  }
}

function onPointerUp(e) {
  if (!pointers.delete(e.pointerId)) return
  try {
    if (typeof e.target.releasePointerCapture === 'function') {
      e.target.releasePointerCapture(e.pointerId)
    }
  } catch {
    // 忽略（无捕获或已释放）
  }
  if (drawingPointerId === e.pointerId) {
    endDrawing()
    drawingPointerId = null
    if (pointers.size === 0) {
      panStart = null
      pinchStart = null
      gestureMoved = false
      suppressClick = false
    }
    return
  }
  if (gestureMoved) suppressClick = true
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 0) {
    panStart = null
    gestureMoved = false
  } else if (pointers.size === 1 && pinchStart == null && panStart == null) {
    // 捏合结束剩下一根手指：以该手指为新基线继续平移，状态不卡死
    const [p] = [...pointers.values()]
    panStart = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, moved: false }
  }
}

/** 拖动/捏合结束后吞掉随之而来的 click 避免误选车；未拖动的点击正常到达车辆按钮。 */
function onViewportClick(e) {
  if (suppressClick) {
    suppressClick = false
    e.stopPropagation()
    e.preventDefault()
  }
}

function resetView() {
  applyView({ scale: 1, tx: 0, ty: 0 })
}

// ---- 地图标注（临时纯前端：切视图/切文件即清空；几何一律存语义坐标） ----
const activeTool = ref(null) // null|pen|eraser|arrow|line|rect|circle|text
const annotColor = ref(ANNOT_COLORS[0])
const annotVisible = ref(true)
const annotWidthSlider = ref(ANNOT_WIDTH_DEFAULT) // 滑块值 = SVG 像素口径（1× 下所见即所得）
// 语义单位/每 SVG 像素（x/y 轴因 preserveAspectRatio:none 比例可能不同；线宽/字号/半径按 x 轴换算）
const semPerSvgX = computed(() => {
  const b = mapView.value.renderBounds
  return b && mapView.value.W > 0 ? (b.xMax - b.xMin) / mapView.value.W : 1
})
const semPerSvgY = computed(() => {
  const b = mapView.value.renderBounds
  return b && mapView.value.H > 0 ? (b.yMax - b.yMin) / mapView.value.H : 1
})
const annotWidth = computed(() => annotWidthSlider.value * semPerSvgX.value)
const history = ref([[]]) // 快照栈（不可变数组），history[0] = 初始空
const historyIndex = ref(0)
const annotations = computed(() => history.value[historyIndex.value] || [])
const draft = ref(null) // 进行中的标注（未提交）
const textSession = ref(null) // reactive({ point, text })，文字输入会话
const textInputRef = ref(null)
const ANNOT_THIN_PX = 2 // 笔迹抽稀阈值（屏幕 CSS px，与坐标体系无关）
let drawStart = null // 绘制起点（语义坐标）
let drawPoints = [] // pen/eraser 已采点（语义坐标）
let drawScreen = [] // 与 drawPoints 一一对应的屏幕点（CSS px，用于抽稀）
let drawingPointerId = null

function resetAnnotations() {
  history.value = [[]]
  historyIndex.value = 0
  activeTool.value = null
  draft.value = null
  textSession.value = null
  drawStart = null
  drawPoints = []
  drawScreen = []
  drawingPointerId = null
  suppressClick = false
  gestureMoved = false
  panStart = null
  pinchStart = null
}
// 切换文件（overview 引用变化；MapOverview 未按文件 key 复用）→ 清空标注
watch(() => props.overview, resetAnnotations)

function toggleTool(tool) {
  activeTool.value = activeTool.value === tool ? null : tool
}

function undoAnnot() {
  const s = undo(history.value, historyIndex.value)
  history.value = s.history
  historyIndex.value = s.index
}

function redoAnnot() {
  const s = redo(history.value, historyIndex.value)
  history.value = s.history
  historyIndex.value = s.index
}

function clearAll() {
  const s = commit(history.value, historyIndex.value, [])
  history.value = s.history
  historyIndex.value = s.index
}

function commitDraft(ann) {
  const s = commit(history.value, historyIndex.value, [...annotations.value, ann])
  history.value = s.history
  historyIndex.value = s.index
}

function draftFromTool(tool, a, b) {
  switch (tool) {
    case 'arrow':
    case 'line':
      return { type: tool, color: annotColor.value, width: annotWidth.value, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    case 'rect':
      return { type: 'rect', color: annotColor.value, width: annotWidth.value, ...rectFromCorners(a, b) }
    case 'circle':
      return { type: 'circle', color: annotColor.value, width: annotWidth.value, ...circleFromCorners(a, b) }
    default:
      return null
  }
}

/** 指针 client 坐标 → 语义坐标（CSS px → 撤销 viewport 变换 → CSS↔SVG 比例 → fromX/fromY）。 */
function semanticPoint(e) {
  const sp = screenPoint(e.clientX, e.clientY)
  const el = mapEl.value
  return screenToSemantic(view, mapView.value, sp.x, sp.y, el ? el.clientWidth : 0, el ? el.clientHeight : 0)
}

function startDrawing(e) {
  const p = semanticPoint(e)
  if (!p) return
  drawingPointerId = e.pointerId
  if (activeTool.value === 'text') {
    if (textSession.value) commitSession(textSession.value) // 先提交上一个未完成的文字
    textSession.value = reactive({ point: p, text: '' })
    nextTick(() => textInputRef.value && textInputRef.value.focus())
    return
  }
  if (activeTool.value === 'pen' || activeTool.value === 'eraser') {
    drawPoints = [p]
    drawScreen = [{ x: e.clientX, y: e.clientY }]
    draft.value = { type: activeTool.value, color: annotColor.value, width: annotWidth.value, points: [p] }
  } else {
    drawStart = p
    draft.value = draftFromTool(activeTool.value, p, p)
  }
}

function moveDrawing(e) {
  const p = semanticPoint(e)
  if (!p) return
  const tool = activeTool.value
  if (tool === 'pen' || tool === 'eraser') {
    // 屏幕空间抽稀：相邻采样点 ≥ ANNOT_THIN_PX CSS px（不依赖 scale/渲染比例，避免换算误差累积）
    const last = drawScreen[drawScreen.length - 1]
    if (last == null || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= ANNOT_THIN_PX) {
      drawScreen.push({ x: e.clientX, y: e.clientY })
      drawPoints.push(p)
      draft.value = { ...draft.value, points: [...drawPoints] }
    }
  } else if (drawStart) {
    draft.value = draftFromTool(tool, drawStart, p)
  }
}

function isDegenerate(ann) {
  if (ann.type === 'rect') return ann.w < 1e-9 && ann.h < 1e-9
  if (ann.type === 'circle') return ann.r < 1e-9
  if (ann.type === 'line' || ann.type === 'arrow') {
    return Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 1e-9
  }
  return false
}

function endDrawing() {
  const tool = activeTool.value
  if (!tool) return
  if (tool === 'pen') {
    if (drawPoints.length >= 2) {
      commitDraft({ type: 'pen', color: annotColor.value, width: annotWidth.value, points: drawPoints })
    }
  } else if (tool === 'eraser') {
    if (drawPoints.length) {
      const current = annotations.value
      const next = applyEraser(current, drawPoints, annotWidth.value)
      if (next !== current) {
        const s = commit(history.value, historyIndex.value, next)
        history.value = s.history
        historyIndex.value = s.index
      }
    }
  } else if (draft.value && !isDegenerate(draft.value)) {
    commitDraft(draft.value)
  }
  draft.value = null
  drawStart = null
  drawPoints = []
  drawScreen = []
}

/** 文字提交（幂等：Enter/blur/移除输入框都会触发，committed 防重复）。 */
function commitSession(session) {
  if (textSession.value === session) textSession.value = null
  if (!session || session.cancelled || session.committed) return
  session.committed = true
  const text = session.text.trim()
  if (!text) return
  commitDraft({ type: 'text', color: annotColor.value, x: session.point.x, y: session.point.y, text })
}

function cancelSession(session) {
  if (textSession.value === session) {
    textSession.value = null
    session.cancelled = true
  }
}

/** 文字输入框屏幕定位：语义 → SVG unit → CSS px（渲染尺寸比例）→ viewport 变换（与 screenToSvg 互逆）。 */
const textInputStyle = computed(() => {
  const session = textSession.value
  if (!session) return null
  const el = mapEl.value
  const s = svgToScreen(
    mapView.value,
    view,
    mapView.value.toX(session.point.x),
    mapView.value.toY(session.point.y),
    el ? el.clientWidth : 0,
    el ? el.clientHeight : 0
  )
  if (!s) return null
  return { left: `${s.x}px`, top: `${s.y}px` }
})

/** 渲染用标注列表：语义坐标 → SVG 像素（含进行中的 draft），尺寸按 x/y 轴比例换算。 */
const renderedAnnotations = computed(() => {
  const toX = mapView.value.toX
  const toY = mapView.value.toY
  const invX = 1 / Math.max(1e-9, semPerSvgX.value)
  const invY = 1 / Math.max(1e-9, semPerSvgY.value)
  const list = [...annotations.value]
  if (draft.value) list.push(draft.value)
  return list.map(ann => {
    const out = { ...ann, widthSvg: ann.width * invX }
    if (ann.type === 'pen') {
      out.svgPoints = polylinePoints(ann.points, toX, toY)
    } else if (ann.type === 'line' || ann.type === 'arrow') {
      out.x1 = toX(ann.x1)
      out.y1 = toY(ann.y1)
      out.x2 = toX(ann.x2)
      out.y2 = toY(ann.y2)
      if (ann.type === 'arrow') out.head = arrowHeadPoints(out.x1, out.y1, out.x2, out.y2)
    } else if (ann.type === 'rect') {
      out.x = toX(ann.x)
      out.y = toY(ann.y)
      out.w = ann.w * invX
      out.h = ann.h * invY
    } else if (ann.type === 'circle') {
      out.cx = toX(ann.cx)
      out.cy = toY(ann.cy)
      out.r = ann.r * invX
    } else if (ann.type === 'text') {
      out.x = toX(ann.x)
      out.y = toY(ann.y)
    }
    return out
  })
})

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
})

function frame(ts) {
  if (!playing.value) {
    rafId = null
    return
  }
  const delta = lastFrameTs == null ? 0 : (ts - lastFrameTs)
  lastFrameTs = ts
  currentTime.value = Math.min(duration.value, currentTime.value + (delta / 1000) * speed.value)
  nowMs.value = typeof performance !== 'undefined' ? performance.now() : 0
  if (currentTime.value >= duration.value) {
    if (props.loop) {
      currentTime.value = 0
      rafId = requestAnimationFrame(frame)
      return
    }
    playing.value = false
    rafId = null
    return
  }
  rafId = requestAnimationFrame(frame)
}

/** 幂等启动：任意时刻最多一个 RAF 循环（重复调用/重复事件不会创建第二个循环）。 */
function play() {
  if (playing.value || duration.value <= 0) return
  playing.value = true
  lastFrameTs = null
  rafId = requestAnimationFrame(frame)
}

/** 幂等暂停：取消未完成的 RAF，绝不残留回调推进时间。 */
function pause() {
  playing.value = false
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

watch(() => props.seekTo, (sec) => {
  if (Number.isFinite(sec)) {
    pause() // 点击 AI 时间 → seek + 自动暂停（含取消 RAF）
    currentTime.value = Math.min(duration.value, Math.max(0, sec))
    eventPopupSec.value = Math.round(sec)
  }
}, { immediate: true })

function seek(sec) {
  currentTime.value = Math.min(duration.value, Math.max(0, sec))
  eventPopupSec.value = Math.round(sec)
  nowMs.value = typeof performance !== 'undefined' ? performance.now() : 0
}

function togglePlay() {
  if (playing.value) pause()
  else play()
}

/** 拖动进度条：按下即暂停，拖动中实时 seek，松开后保持暂停（不恢复拖动前状态）。 */
function dragStart() {
  pause()
}

/** 事件标记点击：跳转并保持暂停。 */
function jumpTo(sec) {
  pause()
  seek(sec)
}

function step(delta) {
  currentTime.value = Math.min(duration.value, Math.max(0, currentTime.value + delta))
}

function toggleSpeed() {
  // PR4 §49：QA 场景需要 0.5×——倍速循环 0.5 → 1 → 2 → 4 → 0.5
  speed.value = speed.value === 0.5 ? 1 : (speed.value === 1 ? 2 : (speed.value === 2 ? 4 : 0.5))
}

function toggleType(type) {
  const next = new Set(typeFilter.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  typeFilter.value = next
}

onBeforeUnmount(() => {
  if (rafId != null) cancelAnimationFrame(rafId)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  pointers.clear()
  panStart = null
  pinchStart = null
  gestureMoved = false
  suppressClick = false
})

// ---- 数据 ----
const routesByAccount = computed(() => {
  const map = new Map()
  for (const route of props.overview.routes || []) map.set(route.accountId, route)
  return map
})

const vehiclesByAccount = computed(() => {
  const map = new Map()
  for (const vehicle of (playback.value ? playback.value.vehicles : [])) {
    map.set(vehicle.accountId, vehicle)
  }
  return map
})

const friendlyColors = computed(() => palette.value.friendlyColors)
const enemyColors = computed(() => palette.value.enemyColors)

function vehicleColor(vehicle) {
  const teamVehicles = vehicleStates.value
    .map(st => st.vehicle)
    .filter(v => v.team === vehicle.team)
  const index = teamVehicles.indexOf(vehicle)
  const list = vehicle.team === friendlyTeam.value ? friendlyColors.value : enemyColors.value
  return list[Math.max(0, index) % list.length]
}

/**
 * 车辆显示状态：把「当前可信插值位置」与「最后可信位置」分开——
 * gap 内禁止穿线插值，但车辆停在淡化最后已知位置，不整辆消失；
 * 阵亡后冻结在阵亡时刻的最后可信位置（优先于位置中断）。
 * covered 只表示服务器位置流覆盖（type-10），不是点亮。
 * direction = {hullYawDeg, turretRelativeYawDeg} | null：无可靠方向样本时不旋转（不伪造朝向）。
 */
/**
 * PR2：该车辆的 dedicated model 决策（preload 结果）——
 * 非 Tier X / preload 失败 / 模块加载失败 → null（generic marker 单车 fallback，
 * 计划 §11：不做整场 fallback）。
 */
function vehicleModel(vehicle) {
  const p = preload.value
  if (p.phase !== 'ready') return null
  const modelKey = p.byTank.get(String(vehicle.tankId))
  if (!modelKey || p.failed.has(modelKey)) return null
  return p.resolved.get(modelKey) || null
}

/** PR4 §36 hull hitbox 比例（相对 marker 盒，随 marker 缩放；视觉车体 + 小 padding）。 */
const HULL_HITBOX = Object.freeze({
  dedicated: Object.freeze({ w: 0.9, h: 0.9 }),
  generic: Object.freeze({ w: 0.58, h: 0.9 }),
})

function vehicleState(vehicle) {
  const route = routesByAccount.value.get(vehicle.accountId)
  const points = route ? route.points : []
  // 局部时间变量命名 time——避免遮蔽 setup 的 i18n t()（ariaLabel 需要）
  const time = currentTime.value
  const destroyed = vehicle.deathSec != null && time >= vehicle.deathSec
  const displayT = destroyed ? Math.min(time, vehicle.deathSec) : time
  const live = positionAt(points, displayT)
  const last = live ? live : lastKnownPosition(points, displayT)
  if (!last) return null // 从未有可信位置：不显示
  const covered = positionCoveredAt(vehicle.positionIntervals, time)
  const recorder = vehicle.accountId === props.overview.recorderAccountId
  const direction = interpolateDirection(vehicle.directionSamples, displayT)
  const friendly = vehicle.team === friendlyTeam.value
  // 阵亡：恒渲染 hull+turret 双层（方向冻结在最后可信样本；无样本以素材默认 0° 渲染，不代表真实朝向）；
  // 未阵亡：无可靠方向样本时不渲染车体（不伪造朝向），行为保持不变。
  const hullDeg = direction ? screenRotation(direction.hullYawDeg) : null
  const turretDeg = direction
    ? screenRotation(turretWorldYawDeg(direction.hullYawDeg, direction.turretRelativeYawDeg))
    : null
  return {
    vehicle,
    pos: last,
    covered,
    destroyed,
    recorder,
    friendly,
    direction,
    // dedicated model（null = generic；turretless 无 turret 层，§14）
    model: vehicleModel(vehicle),
    hullImage: friendly ? friendlyHull : enemyHull,
    turretImage: friendly ? friendlyTurret : enemyTurret,
    hullScreenDeg: destroyed ? (hullDeg == null ? 0 : hullDeg) : hullDeg,
    turretScreenDeg: destroyed ? (turretDeg == null ? 0 : turretDeg) : turretDeg,
    // VehicleMarker 渲染用（位置/反缩放/无障碍标签在 view model 一次性算好）
    markerStyle: { left: markerLeft(last.x), top: markerTop(last.y), transform: markerTransform.value },
    overlayInverseScale: overlayInverseScale.value,
    overlayInverse: overlayInverse.value, // 数值反缩放（VehicleMarker 用它反缩放 layout offset）
    // PR4 §26：标签数据（playerName 可为空串；tankName 权威显示名回退 tankId）
    playerName: vehicle.playerName || '',
    tankName: vehicle.tankName || String(vehicle.tankId),
    // PR4 §36：hull hitbox 占 marker 盒比例（随 marker 一起缩放；dedicated 车体≈88% 视觉、
    // generic 车体 55%×88%；+小 padding 容错）。用于点击命中判定。
    hitbox: vehicleModel(vehicle) ? HULL_HITBOX.dedicated : HULL_HITBOX.generic,
    ariaLabel: `${vehicle.playerName}: ${t(destroyed ? 'recon.map.playback.state_destroyed' : (covered ? 'recon.map.playback.state_position_reported' : 'recon.map.playback.state_position_stale'))}`,
    // lastKnown = 位置流未覆盖（covered=false）才淡化（最后已知位置）。
    // 注意：covered 只是「服务器位置流当前覆盖」，不等于录像者客户端点亮/失察（无 authoritative
    // spotting signal，不得声称已恢复点亮）；route 采样点稀疏（长局采样间隔 max(2, duration/200)
    // 可 >5s）导致 live=null 不代表位置中断，不得借 !live 误判淡化。destroyed 是独立视觉状态，
    // 阵亡车信息栏同样显示最后可信时间，但视觉 class 不再套用 pb-last-known
    lastKnown: !covered
  }
}

/** 标记水平位置（%）：地图用户坐标 → 容器百分比。 */
function markerLeft(x) {
  return `${((mapView.value.toX(x)) / mapView.value.W) * 100}%`
}

/** 标记垂直位置（%）。 */
function markerTop(y) {
  return `${((mapView.value.toY(y)) / mapView.value.H) * 100}%`
}

const vehicleStates = computed(() => {
  // preload 未完成（asset decision 未定）时不渲染车辆——禁止 generic 闪现后替换
  if (preload.value.phase !== 'ready') return []
  const vehicles = playback.value ? playback.value.vehicles : []
  return vehicles.map(vehicleState).filter(Boolean)
})

const filteredEvents = computed(() => {
  const events = (playback.value ? playback.value.events : [])
    .filter(event => typeFilter.value.has(event.type))
  if (showAll.value) return events
  const recorderId = props.overview.recorderAccountId
  if (props.overview.arenaBonusType === 1 && recorderId != null) {
    return events.filter(event => recorderRelated(event, recorderId))
  }
  if (props.overview.arenaBonusType !== 1) {
    return events.filter(event => teamRelated(event, friendlyTeam.value, vehiclesByAccount.value))
  }
  return events
})

const eventMarkers = computed(() => aggregateEventsBySecond(filteredEvents.value))

// 炮线：仅来自过滤后事件流中的已知射击（DAMAGE/KILL），两端可信位置，随播放时间与倍速确定性呈现
const visibleTracers = computed(() => tracerLines(filteredEvents.value, routesByAccount.value, currentTime.value, speed.value))

function tracerColor(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? vehicleColor(vehicle) : palette.value.routeOutline
}

function nearestEvent(direction) {
  const events = filteredEvents.value
  if (!events.length) return
  const t = currentTime.value
  let best = null
  for (const event of events) {
    if (direction === 'prev' && event.timeSec < t - 0.1) {
      if (best === null || event.timeSec > best.timeSec) best = event
    } else if (direction === 'next' && event.timeSec > t + 0.1) {
      if (best === null || event.timeSec < best.timeSec) best = event
    }
  }
  if (best) {
    pause() // 上一/下一事件跳转后保持暂停
    currentTime.value = best.timeSec
    eventPopupSec.value = Math.round(best.timeSec)
  }
}

const popupEvents = computed(() => {
  if (eventPopupSec.value == null) return []
  return filteredEvents.value.filter(event => Math.round(event.timeSec) === eventPopupSec.value)
})

function playerName(accountId) {
  const vehicle = vehiclesByAccount.value.get(accountId)
  return vehicle ? (vehicle.playerName || `#${accountId}`) : (accountId == null ? t('recon.map.playback.unknown') : `#${accountId}`)
}

function eventLabel(event) {
  const type = t(`recon.map.playback.event_${event.type}`)
  switch (event.type) {
    case 'DAMAGE':
      return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)} ${event.damage}`
    case 'KILL':
      return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
    case 'DESTROYED':
      return playerName(event.accountId)
    case 'POSITION_REPORTED':
    case 'POSITION_STALE':
      return playerName(event.accountId)
    default:
      return type
  }
}

// ---- PR4 §36/§37：hull hitbox 点击选中（重叠时取指针最近车辆；tie 保持 selected / render order）----
function onMarkerSelect(vehicle, event) {
  // §36：label 块（含 PlayerName tooltip 悬停区）不是 hitbox——点标签不选中车辆；
  // .pb-label-player 为触发原生 title 需要 pointer-events:auto，点击事件会冒泡到这里，须拦截。
  const t = event && event.target
  if (t && typeof t.closest === 'function' && t.closest('.pb-labels')) return
  selectAt(vehicle.accountId, event ? event.clientX : undefined, event ? event.clientY : undefined)
}

/** 标记中心 → 相对地图容器的屏幕 px（viewport 变换后）。 */
function markerScreen(st) {
  const el = mapEl.value
  const W = el ? el.clientWidth : 0
  if (!W || mapView.value.W <= 0) return null
  const H = W * (mapView.value.H / mapView.value.W)
  return {
    x: (mapView.value.toX(st.pos.x) / mapView.value.W) * W * view.scale + view.tx,
    y: (mapView.value.toY(st.pos.y) / mapView.value.H) * H * view.scale + view.ty,
  }
}

function selectAt(accountId, clientX, clientY) {
  const states = vehicleStates.value
  const hasPoint = Number.isFinite(clientX) && mapEl.value && mapEl.value.clientWidth > 0
  const rect = mapEl.value ? mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
  const px = hasPoint ? clientX - rect.left : NaN
  const py = hasPoint ? clientY - rect.top : NaN
  // §36 hitbox 尺寸（content px）：读取实际 marker 盒宽（CSS 36px desktop / 28px mobile，
  // media query 生效于 viewport 变换前 → offsetWidth 即 content px）；测试环境无布局 → 回退 36
  const markerBox = Number(mapEl.value?.querySelector('.pb-vehicle')?.offsetWidth) || 36
  // 命中判定：内容坐标（撤销 viewport 变换）落在 hull hitbox 内
  const hitTest = (s) => {
    const cx = (px - view.tx) / view.scale
    const cy = (py - view.ty) / view.scale
    const W = mapEl.value.clientWidth
    const H = W * (mapView.value.H / mapView.value.W)
    const x = (mapView.value.toX(s.pos.x) / mapView.value.W) * W
    const y = (mapView.value.toY(s.pos.y) / mapView.value.H) * H
    const hw = (markerBox * s.hitbox.w) / 2
    const hh = (markerBox * s.hitbox.h) / 2
    return Math.abs(cx - x) <= hw && Math.abs(cy - y) <= hh
  }
  let candidates
  if (hasPoint) {
    candidates = states.filter(hitTest)
    // 真实点击必然落在某 hitbox 内（label 点击已在 onMarkerSelect 拦截）；
    // 此处兜底只为合成事件/坐标与布局瞬时不一致（既有 toggle 行为）
    if (candidates.length === 0) {
      const target = states.find((s) => s.vehicle.accountId === accountId)
      candidates = target ? [target] : []
    }
  } else {
    const target = states.find((s) => s.vehicle.accountId === accountId)
    candidates = target ? [target] : []
  }
  if (candidates.length === 0) return
  let best = candidates[0]
  if (candidates.length > 1) {
    const dist = (s) => {
      const p = markerScreen(s)
      return p ? Math.hypot(p.x - px, p.y - py) : Infinity
    }
    candidates.sort((a, b) => (dist(a) - dist(b)) || (states.indexOf(a) - states.indexOf(b)))
    best = candidates[0]
    // tie（与前二近者距离几乎一致）且已有 selected 在候选内 → 保持当前 selected，不切换
    if (selectedAccountId.value != null && candidates.length > 1
        && Math.abs(dist(best) - dist(candidates[1])) < 1) {
      const sel = candidates.find((s) => s.vehicle.accountId === selectedAccountId.value)
      if (sel) return
    }
  }
  selectedAccountId.value = selectedAccountId.value === best.vehicle.accountId ? null : best.vehicle.accountId
}

const selectedState = computed(() => {
  if (selectedAccountId.value == null) return null
  return vehicleStates.value.find(st => st.vehicle.accountId === selectedAccountId.value) || null
})

// ---- PR4 §32–§35：标签碰撞布局（纯函数；screen px）+ PlayerName hysteresis ----
const labelLayout = computed(() => {
  const el = mapEl.value
  const W = el ? el.clientWidth : 0
  if (!W || mapView.value.W <= 0) return new Map()
  const items = vehicleStates.value.map((st) => {
    const p = markerScreen(st)
    if (!p) return null
    return {
      accountId: st.vehicle.accountId,
      x: p.x,
      y: p.y,
      tankName: st.tankName,
      playerName: st.playerName,
    }
  }).filter(Boolean)
  return computeLabelLayout(items, {
    showTank: labelPrefs.showTankName,
    showPlayer: labelPrefs.showPlayerName,
    viewportW: W,
    viewportH: W * (mapView.value.H / mapView.value.W),
  })
})

const playerVisState = ref(new Map())
const playerHidden = ref(new Set())
const playerFading = ref(new Set())
watch([labelLayout, nowMs], () => {
  const conflicts = new Set()
  for (const [id, r] of labelLayout.value) {
    if (r.playerConflict) conflicts.add(id)
  }
  const res = resolvePlayerVisibility(conflicts, playerVisState.value, nowMs.value, PLAYER_HIDE_MS, PLAYER_SHOW_MS)
  playerVisState.value = res.state
  playerHidden.value = res.hidden
  playerFading.value = res.fading
}, { immediate: true })

/** VehicleMarker label prop（每 marker 一个：显示开关 + 碰撞位移 + player 显隐/fade）。 */
function markerLabel(accountId) {
  const l = labelLayout.value.get(accountId)
  return {
    showPlayer: labelPrefs.showPlayerName,
    showTank: labelPrefs.showTankName,
    tankDy: l ? l.tankDy : 0,
    playerHidden: playerHidden.value.has(accountId),
    playerFading: playerFading.value.has(accountId),
  }
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

const mapStyle = computed(() => ({
  '--map-grid-stroke': palette.value.gridStroke,
  '--map-region-stroke': palette.value.regionStroke,
  '--map-spawn-friendly': palette.value.spawnFriendly,
  '--map-spawn-enemy': palette.value.spawnEnemy,
  '--map-route-outline': palette.value.routeOutline,
  '--map-death-mark': palette.value.deathMark,
  // PR3 §19/§20：marker team tokens（friendly 按地图显式 tone，enemy 固定 red）
  ...teamCssVars(props.overview.mapCode)
}))
</script>

<template>
  <div v-if="image && playback" class="battle-playback" :style="mapStyle" data-test="battle-playback">
    <!-- 播放控制 -->
    <div class="pb-controls">
      <button type="button" class="pb-btn" data-test="pb-play" @click="togglePlay">
        {{ $t(playing ? 'recon.map.playback.pause' : 'recon.map.playback.play') }}
      </button>
      <button type="button" class="pb-btn" data-test="pb-back5" @click="step(-5)">-5s</button>
      <button type="button" class="pb-btn" data-test="pb-fwd5" @click="step(5)">+5s</button>
      <button type="button" class="pb-btn" data-test="pb-prev" @click="nearestEvent('prev')">◀</button>
      <button type="button" class="pb-btn" data-test="pb-next" @click="nearestEvent('next')">▶</button>
      <button type="button" class="pb-btn" data-test="pb-speed" @click="toggleSpeed">{{ speed }}×</button>
      <button type="button" class="pb-btn" data-test="pb-reset" @click="resetView">{{ $t('recon.map.playback.reset_view') }}</button>
      <span class="pb-time">{{ formatClock(currentTime) }} / {{ formatClock(duration) }}</span>
      <span v-if="overview.recorderAccountId != null" class="pb-filter">
        <label class="pb-check">
          <input type="checkbox" v-model="showAll" data-test="pb-all-events" />
          {{ $t('recon.map.playback.all_events') }}
        </label>
      </span>
      <!-- PR4 §26：玩家/坦克名显示开关（默认 玩家名关 / 坦克名开，localStorage 持久化） -->
      <span class="pb-filter">
        <label class="pb-check">
          <input type="checkbox" v-model="labelPrefs.showPlayerName" data-test="pb-show-player" />
          {{ $t('recon.map.playback.show_player_name') }}
        </label>
        <label class="pb-check">
          <input type="checkbox" v-model="labelPrefs.showTankName" data-test="pb-show-tank" />
          {{ $t('recon.map.playback.show_tank_name') }}
        </label>
      </span>
    </div>

    <!-- 事件类型过滤 -->
    <div class="pb-filters">
      <button
        v-for="type in ['DAMAGE', 'DESTROYED', 'KILL', 'POSITION_REPORTED', 'POSITION_STALE']"
        :key="type"
        type="button"
        class="pb-chip"
        :class="{ active: typeFilter.has(type) }"
        @click="toggleType(type)"
      >{{ $t(`recon.map.playback.event_${type}`) }}</button>
    </div>

    <!-- 地图标注工具栏：显式切工具才绘制，未选工具时保持原浏览交互 -->
    <div class="pb-annot-toolbar" data-test="pb-annot-toolbar">
      <button
        v-for="tool in ['pen', 'eraser', 'arrow', 'line', 'rect', 'circle', 'text']"
        :key="tool"
        type="button"
        class="pb-annot-btn"
        :class="{ active: activeTool === tool }"
        :data-test="`pb-annot-${tool}`"
        @click="toggleTool(tool)"
      >{{ $t(`recon.map.playback.annot.${tool}`) }}</button>
      <span class="pb-annot-sep" aria-hidden="true"></span>
      <button
        v-for="c in ANNOT_COLORS"
        :key="c"
        type="button"
        class="pb-annot-color"
        :class="{ active: annotColor === c }"
        :style="{ background: c }"
        :aria-label="$t('recon.map.playback.annot.color')"
        @click="annotColor = c"
      ></button>
      <span class="pb-annot-sep" aria-hidden="true"></span>
      <label class="pb-annot-width">
        {{ $t('recon.map.playback.annot.width') }}
        <input type="range" :min="ANNOT_WIDTH_MIN" :max="ANNOT_WIDTH_MAX" step="1" v-model.number="annotWidthSlider" />
        <span class="pb-annot-width-val">{{ annotWidthSlider }}</span>
      </label>
      <span class="pb-annot-sep" aria-hidden="true"></span>
      <button
        type="button"
        class="pb-annot-btn"
        :disabled="!canUndo(historyIndex)"
        data-test="pb-annot-undo"
        @click="undoAnnot"
      >{{ $t('recon.map.playback.annot.undo') }}</button>
      <button
        type="button"
        class="pb-annot-btn"
        :disabled="!canRedo(history, historyIndex)"
        data-test="pb-annot-redo"
        @click="redoAnnot"
      >{{ $t('recon.map.playback.annot.redo') }}</button>
      <button
        type="button"
        class="pb-annot-btn"
        data-test="pb-annot-clear"
        @click="clearAll"
      >{{ $t('recon.map.playback.annot.clear') }}</button>
      <button
        type="button"
        class="pb-annot-btn"
        data-test="pb-annot-toggle"
        @click="annotVisible = !annotVisible"
      >{{ $t(annotVisible ? 'recon.map.playback.annot.hide' : 'recon.map.playback.annot.show') }}</button>
    </div>

    <!-- 进度条 + 事件标记 -->
    <div class="pb-progress" data-test="pb-progress">
      <input
        class="pb-range"
        type="range"
        min="0"
        :max="duration || 1"
        step="0.1"
        :value="currentTime"
        @pointerdown="dragStart"
        @mousedown="dragStart"
        @touchstart="dragStart"
        @input="seek(Number($event.target.value))"
        :aria-label="$t('recon.map.playback.progress')"
      />
      <span
        v-for="marker in eventMarkers"
        :key="marker.sec"
        class="pb-marker"
        :style="{ left: `${duration > 0 ? (marker.sec / duration) * 100 : 0}%` }"
        :title="`${formatClock(marker.sec)} ×${marker.count}`"
        @click="jumpTo(marker.sec)"
      ></span>
    </div>

    <!-- 地图 + 当前车辆状态（标记为 HTML overlay，固定像素尺寸，双层 hull/turret 独立旋转） -->
    <div class="pb-map" data-test="pb-map" ref="mapEl" @wheel.prevent="onWheel">
    <div
      class="pb-viewport"
      data-test="pb-viewport"
      :style="viewportStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @click.capture="onViewportClick"
    >
    <svg class="pb-svg" :viewBox="`0 0 ${mapView.W} ${mapView.H}`" role="img">
      <image :href="image.src" :width="mapView.W" :height="mapView.H" preserveAspectRatio="none" />
      <g class="pb-grid">
        <rect
          v-for="(cell, index) in overview.gridCells"
          :key="cell.id"
          :x="mapView.toX(cell.bounds.xMin)"
          :y="mapView.toY(cell.bounds.yMax)"
          :width="mapView.toX(cell.bounds.xMax) - mapView.toX(cell.bounds.xMin)"
          :height="mapView.toY(cell.bounds.yMin) - mapView.toY(cell.bounds.yMax)"
          class="pb-cell"
        />
      </g>
      <g class="pb-regions">
        <g v-for="[region, r] in gridRegions" :key="region">
          <rect
            :x="mapView.toX(r.xMin)"
            :y="mapView.toY(r.yMax)"
            :width="mapView.toX(r.xMax) - mapView.toX(r.xMin)"
            :height="mapView.toY(r.yMin) - mapView.toY(r.yMax)"
            class="pb-region-line"
          />
        </g>
      </g>
      <g class="pb-spawns">
        <circle
          v-for="(spawn, i) in overview.spawnPoints"
          :key="`${spawn.name}-${i}`"
          :cx="mapView.toX(spawn.x)"
          :cy="mapView.toY(spawn.y)"
          r="4"
          :class="spawn.team === friendlyTeam ? 'pb-spawn-friendly' : 'pb-spawn-enemy'"
        />
      </g>
      <g class="pb-tracers" aria-hidden="true">
        <template v-for="(l, i) in visibleTracers" :key="`tracer-${l.timeSec}-${i}`">
          <!-- 外层光晕：阵营色宽线半透明（激光辉光） -->
          <line
            class="pb-tracer"
            :x1="mapView.toX(l.x1)"
            :y1="mapView.toY(l.y1)"
            :x2="mapView.toX(l.x2)"
            :y2="mapView.toY(l.y2)"
            :stroke="tracerColor(l.attackerAccountId)"
            :stroke-width="6 / view.scale"
            :opacity="l.opacity * 0.35"
          />
          <!-- 内芯：亮白细线（激光束主体） -->
          <line
            class="pb-tracer-core"
            :x1="mapView.toX(l.x1)"
            :y1="mapView.toY(l.y1)"
            :x2="mapView.toX(l.x2)"
            :y2="mapView.toY(l.y2)"
            stroke="#fff"
            :stroke-width="1.75 / view.scale"
            :opacity="l.opacity"
          />
          <!-- 命中闪光：短促冲击闪光——扩散 + 峰值→淡出（flashOpacity 峰值曲线）；
               flashProgress=1 后不再渲染（不残留孤立端点/waypoint 感） -->
          <circle
            v-if="l.flashProgress < 1"
            class="pb-tracer-flash"
            :cx="mapView.toX(l.x2)"
            :cy="mapView.toY(l.y2)"
            :r="(3 + 9 * l.flashProgress) / view.scale"
            :fill="tracerColor(l.attackerAccountId)"
            :opacity="l.flashOpacity"
          />
        </template>
      </g>
      <!-- 地图标注层：语义坐标锚定，随地图缩放/平移；静态叠加不随播放时间变化 -->
      <g v-if="annotVisible" class="pb-annotations" data-test="pb-annotations">
        <template v-for="(ann, i) in renderedAnnotations" :key="i">
          <polyline
            v-if="ann.type === 'pen'"
            :points="ann.svgPoints"
            fill="none"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <line
            v-else-if="ann.type === 'line'"
            :x1="ann.x1"
            :y1="ann.y1"
            :x2="ann.x2"
            :y2="ann.y2"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            stroke-linecap="round"
          />
          <g v-else-if="ann.type === 'arrow'">
            <line
              :x1="ann.x1"
              :y1="ann.y1"
              :x2="ann.x2"
              :y2="ann.y2"
              :stroke="ann.color"
              :stroke-width="ann.widthSvg"
              stroke-linecap="round"
            />
            <polygon :points="ann.head" :fill="ann.color" />
          </g>
          <rect
            v-else-if="ann.type === 'rect'"
            :x="ann.x"
            :y="ann.y"
            :width="ann.w"
            :height="ann.h"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            fill="none"
          />
          <circle
            v-else-if="ann.type === 'circle'"
            :cx="ann.cx"
            :cy="ann.cy"
            :r="ann.r"
            :stroke="ann.color"
            :stroke-width="ann.widthSvg"
            fill="none"
          />
          <text
            v-else-if="ann.type === 'text'"
            :x="ann.x"
            :y="ann.y"
            :fill="ann.color"
            :font-size="ANNOT_FONT_SIZE"
            text-anchor="middle"
            dominant-baseline="middle"
            class="pb-annot-text"
          >{{ ann.text }}</text>
        </template>
      </g>
    </svg>
    <div class="pb-markers" :class="{ 'pb-drawing': !!activeTool }" data-test="pb-markers" aria-hidden="false">
      <VehicleMarker
        v-for="st in vehicleStates"
        :key="st.vehicle.accountId"
        :marker="st"
        :selected="selectedAccountId === st.vehicle.accountId"
        :label="markerLabel(st.vehicle.accountId)"
        @select="onMarkerSelect(st.vehicle, $event)"
      />
    </div>
    </div>

    <input
      v-if="textSession"
      ref="textInputRef"
      v-model="textSession.text"
      class="pb-text-input"
      :style="textInputStyle"
      :placeholder="$t('recon.map.playback.annot.text_placeholder')"
      data-test="pb-text-input"
      @keydown.enter.prevent="commitSession(textSession)"
      @keydown.esc.prevent="cancelSession(textSession)"
      @blur="commitSession(textSession)"
    />
    </div>

    <!-- 双方总血量条 + 争霸赛实时点数（阵营色实段=已知剩余，灰段=未观测容量，空=已损失） -->
    <div class="pb-hp-bars" data-test="pb-hp-bars">
      <div class="pb-hp-row">
        <span class="pb-hp-label">{{ $t('recon.map.playback.team_friendly') }}</span>
        <div class="pb-hp-track">
          <div class="pb-hp-fill pb-hp-friendly" :style="{ width: hpBarFill(friendlyHp, 'known') }"></div>
          <div class="pb-hp-fill pb-hp-unknown" :style="{ width: hpBarFill(friendlyHp, 'unknown') }"></div>
        </div>
        <span class="pb-hp-value">{{ friendlyHp.knownRemaining }} / {{ friendlyHp.totalMax }}</span>
        <span v-if="friendlyHp.unknownMax > 0" class="pb-hp-unknown-text" data-test="pb-hp-unknown-friendly">{{ $t('recon.map.playback.hp_unknown') }} {{ friendlyHp.unknownMax }}</span>
        <span v-if="showPoints && friendlyPoints != null" class="pb-hp-points" data-test="pb-points-friendly">{{ $t('recon.map.playback.points') }}: {{ friendlyPoints }}</span>
      </div>
      <div class="pb-hp-row">
        <span class="pb-hp-label">{{ $t('recon.map.playback.team_enemy') }}</span>
        <div class="pb-hp-track">
          <div class="pb-hp-fill pb-hp-enemy" :style="{ width: hpBarFill(enemyHp, 'known') }"></div>
          <div class="pb-hp-fill pb-hp-unknown" :style="{ width: hpBarFill(enemyHp, 'unknown') }"></div>
        </div>
        <span class="pb-hp-value">{{ enemyHp.knownRemaining }} / {{ enemyHp.totalMax }}</span>
        <span v-if="enemyHp.unknownMax > 0" class="pb-hp-unknown-text" data-test="pb-hp-unknown-enemy">{{ $t('recon.map.playback.hp_unknown') }} {{ enemyHp.unknownMax }}</span>
        <span v-if="showPoints && enemyPoints != null" class="pb-hp-points" data-test="pb-points-enemy">{{ $t('recon.map.playback.points') }}: {{ enemyPoints }}</span>
      </div>
    </div>

    <!-- 选中车辆信息 -->
    <div v-if="selectedState" class="pb-info" data-test="pb-info">
      <strong>{{ selectedState.vehicle.playerName }}</strong>
      <span>{{ $t('recon.map.playback.tank') }}: {{ selectedState.vehicle.tankName || selectedState.vehicle.tankId }}</span>
      <span>{{ $t('recon.map.playback.team') }}: {{ $t(`recon.map.playback.team_${selectedState.vehicle.team === friendlyTeam ? 'friendly' : 'enemy'}`) }}</span>
      <span>
        {{ $t('recon.map.playback.state') }}:
        {{ selectedState.destroyed
          ? $t('recon.map.playback.state_destroyed')
          : (selectedState.covered ? $t('recon.map.playback.state_position_reported') : $t('recon.map.playback.state_position_stale')) }}
      </span>
      <span v-if="selectedState.lastKnown">
        {{ $t('recon.map.playback.last_known') }} {{ formatClock(selectedState.pos.timeSec) }}
      </span>
    </div>

    <!-- 事件弹层（点击进度条标记展示该秒事件） -->
    <div v-if="popupEvents.length" class="pb-popup" data-test="pb-popup">
      <div class="pb-popup-head">
        {{ formatClock(eventPopupSec) }}
        <button type="button" class="pb-close" @click="eventPopupSec = null">&times;</button>
      </div>
      <ul>
        <li v-for="(event, i) in popupEvents" :key="i">
          <span class="pb-event-type">{{ $t(`recon.map.playback.event_${event.type}`) }}</span>
          {{ eventLabel(event) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.battle-playback {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.pb-controls, .pb-filters {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pb-btn, .pb-chip {
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-label);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.pb-chip.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.pb-time { font-size: .8rem; color: var(--text-label); font-variant-numeric: tabular-nums; }
.pb-filter { display: inline-flex; align-items: center; gap: 4px; font-size: .78rem; }
.pb-check { display: inline-flex; align-items: center; gap: 4px; }
.pb-progress { position: relative; margin: 2px 0; }
.pb-range { width: 100%; display: block; }
.pb-marker {
  position: absolute;
  top: 2px;
  width: 3px;
  height: 10px;
  background: var(--accent, #2f7dff);
  cursor: pointer;
  transform: translateX(-50%);
}
.pb-map { position: relative; margin: 0 auto; width: 66.7%; overflow: hidden; }
.pb-viewport {
  position: relative;
  width: 100%;
  transform-origin: 0 0;
  touch-action: none;
}
.pb-svg {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 4px;
  background: #111;
}
@media (max-width: 768px) {
  .pb-map { width: 100%; }
}
.pb-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* PR3 增补：车辆视觉尺寸上调（人工 QA：全局地图视角下车型辨识度不足）——
   desktop 28 → 36px / mobile 22 → 28px（约 +28%）；zoom 契约不变（viewport 整体 scale，
   车辆随地图缩放；name/✕/selected/recorder 继续 inverse-scale 保持屏幕尺寸）。 */
.pb-vehicle {
  position: absolute;
  width: 36px;
  height: 36px;
  transform: translate(-50%, -50%);
  border: none;
  background: none;
  padding: 0;
  /* PR4 §36：按钮本身不拦截点击，只有 .pb-hitbox（hull 范围）可点 */
  pointer-events: none;
}
@media (max-width: 768px) {
  .pb-vehicle { width: 28px; height: 28px; }
}
/* marker 内部样式（hull/turret/death/name/状态视觉）全部随 VehicleMarker 组件迁移：
   PR3 —— last-known/destroyed 弱化由 VehicleMarker .pb-graphics 容器承担（root 不再
   opacity，否则 ✕/label 也会被淡掉）；Selected 红色倒三角、Recorder 空心菱形、
   team outline/glow（friendly green|blue / enemy red，CSS vars 由根元素提供）。 */
.pb-cell { stroke: var(--map-grid-stroke, rgba(255,255,255,.16)); stroke-width: .5; fill: none; }
/* 激光炮线：外层光晕/内芯线宽逐元素绑定（6/view.scale、1.75/view.scale），不随缩放变粗 */
.pb-tracer, .pb-tracer-core { stroke-linecap: round; }
.pb-region-line { fill: none; stroke: var(--map-region-stroke, rgba(255,255,255,.28)); stroke-width: 1; }
.pb-spawn-friendly { fill: var(--map-spawn-friendly, #8ef7b0); }
.pb-spawn-enemy { fill: var(--map-spawn-enemy, #ff8d8d); }

/* 双方总血量条：阵营色填充（本方/敌方），随播放实时下降；争霸赛附点数 */
.pb-hp-bars { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.pb-hp-row { display: flex; align-items: center; gap: 8px; font-size: .78rem; color: var(--text-label); }
.pb-hp-label { width: 3.5em; flex-shrink: 0; }
.pb-hp-track { flex: 1; display: flex; height: 10px; border-radius: 5px; background: var(--bg-chip, rgba(128,128,128,.25)); overflow: hidden; }
.pb-hp-fill { height: 100%; transition: width .15s linear; }
.pb-hp-friendly { background: var(--map-spawn-friendly, #8ef7b0); }
.pb-hp-enemy { background: var(--map-spawn-enemy, #ff8d8d); }
.pb-hp-unknown { background: rgba(128,128,128,.45); }
.pb-hp-value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.pb-hp-unknown-text { color: var(--text-muted, #999); white-space: nowrap; }
.pb-hp-points { white-space: nowrap; }
.pb-info {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: .8rem;
  color: var(--text-label);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
}
.pb-popup {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: .8rem;
}
.pb-popup-head { display: flex; justify-content: space-between; font-weight: 700; }
.pb-popup ul { margin: 4px 0 0; padding-left: 16px; }
.pb-event-type { color: var(--accent); margin-right: 4px; }
.pb-close { border: none; background: none; cursor: pointer; color: var(--text-muted); }

/* 地图标注：工具栏 + 标注层 + 文字输入 */
.pb-annot-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.pb-annot-btn {
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-label);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: .78rem;
  cursor: pointer;
}
.pb-annot-btn.active {
  background: var(--accent, #2f7dff);
  border-color: var(--accent, #2f7dff);
  color: #fff;
}
.pb-annot-btn:disabled { opacity: .45; cursor: default; }
.pb-annot-color {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.pb-annot-color.active { border-color: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.7); }
.pb-annot-width {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .78rem;
  color: var(--text-label);
}
.pb-annot-width input { width: 80px; }
.pb-annot-width-val { font-variant-numeric: tabular-nums; min-width: 2ch; }
.pb-annot-sep { width: 1px; height: 16px; background: var(--border); }
.pb-annotations { pointer-events: none; }
/* 文字描边保证暗图上可读（paint-order 先描边后填充，不遮字） */
.pb-annot-text {
  paint-order: stroke;
  stroke: rgba(0, 0, 0, .65);
  stroke-width: 1;
}
/* 绘制模式下禁用车标按钮（pointer-events none），避免画到坦克上误触选中 */
.pb-drawing { pointer-events: none; }
.pb-text-input {
  position: absolute;
  width: 140px;
  font-size: 13px;
  padding: 2px 6px;
  border: 1px solid var(--accent, #2f7dff);
  border-radius: 3px;
  background: rgba(0, 0, 0, .8);
  color: #fff;
  z-index: 6;
}
</style>
