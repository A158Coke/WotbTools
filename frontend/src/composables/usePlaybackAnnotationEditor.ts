import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { Ref } from 'vue'
import {
  ANNOT_COLORS,
  ANNOT_TANK_CLASSES,
  ANNOT_WIDTH_DEFAULT,
  annotationDraftFromTool,
  applyEraser,
  hitTestAnnotation,
  isDegenerateAnnotation,
  translateAnnotation,
  screenToSemantic,
  svgToScreen,
} from '../utils/annotation.js'
import { useAnnotationState } from './useAnnotationState.js'
import { useAnnotationSvgProjection } from './useAnnotationSvgProjection.js'
import type { MapAnnotation } from './useAnnotationState.js'
import type { PlaybackCamera, PlaybackMapViewLike } from './usePlaybackCamera.js'

/** 语义坐标点（回放地图用户坐标系）。 */
export interface SemanticPoint {
  x: number
  y: number
}

/** 文字输入会话（BattleMap 的 text input 绑定对象）。 */
export interface TextSession {
  point: SemanticPoint
  text: string
  committed?: boolean
  cancelled?: boolean
}

/**
 * 2D 回放标注编辑器（#820 Agent C 拆分）：工具/绘制手势/文字会话/route 的**唯一 owner**。
 *
 * - 历史快照 / 草稿 / 选中项的唯一事实源仍是 useAnnotationState（#820 Wave B5B），
 *   本 composable 是它的唯一消费者，持有 gesture 临时状态（工具、颜色/宽度、routePoints、
 *   绘制采样、文字会话）；
 * - 标注几何一律存语义坐标；坐标换算复用 usePlaybackCamera 的 view/MapRenderRect（同一视口），
 *   地形起伏的投影/反投影由宿主注入（activeTerrainRelief 仍由宿主按地图匹配）；
 * - pointer 事件由 usePlaybackMapGestures 转入（startDrawing/moveDrawing/endDrawing/cancelDrawing），
 *   双指捏合仍归手势层，第二指落下时手势层调用 cancelDrawing。
 */
export function usePlaybackAnnotationEditor(
  camera: Pick<PlaybackCamera, 'view' | 'screenPoint' | 'mapRenderRect' | 'mapWidth' | 'mapHeight'>,
  mapView: Ref<PlaybackMapViewLike>,
  hooks: {
    /** 文字输入框（BattleMap 内的 input 桥）。 */
    textInputRef: () => { focus: (opts?: { preventScroll?: boolean }) => void } | null
    /** 打开标注模式时宿主副作用（暂停播放、收起 display 浮层）。 */
    onOpen: () => void
    /** 标注重置时同步清空手势状态（pointer/pan/pinch）。 */
    resetGestures: () => void
    /** 地形起伏反投影：normalized viewport 坐标 → 语义坐标；无模型返回 null。 */
    reliefUnproject: (xNorm: number, yNorm: number) => SemanticPoint | null
    /** 地形起伏正投影：语义坐标 → normalized viewport 坐标；无模型回退 mapView 线性映射。 */
    projectedSemanticNorm: (x: number, y: number) => { xNorm: number; yNorm: number }
    /** 当前地图是否命中地形起伏模型（文字定位分支与原实现逐行等价）。 */
    reliefHasModel: () => boolean
    /** 切换文件（overview 引用变化）→ 清空标注。 */
    overview: () => unknown
  },
) {
  const { view } = camera
// JS 工具（无类型）在 TS 边界上的最小注解：工具表与草稿对象按运行时形状消费。
const TANK_CLASSES = ANNOT_TANK_CLASSES as ReadonlyArray<{ key: string }>

  // ---- 地图标注（临时纯前端：切视图/切文件即清空；几何一律存语义坐标） ----
  // 历史快照 / 草稿 / 选中项的唯一 owner 是 useAnnotationState（#820 Wave B5B）；
  // 工具、颜色/宽度、routePoints 等 gesture 临时状态在本 composable。
  const annotationOpen = ref(false)
  const activeTool = ref<string | null>(null) // null outside marking mode; select, tank classes, route or legacy drawing tools
  const routePoints = ref<SemanticPoint[]>([])
  let moveOriginal: MapAnnotation | null = null
  const annotColor = ref(ANNOT_COLORS[0])
  const annotVisible = ref(true)
  const annotWidthSlider = ref(ANNOT_WIDTH_DEFAULT) // 滑块值 = SVG 像素口径（1× 下所见即所得）
  const {
    history,
    historyIndex,
    annotations,
    draft,
    selectedAnnotationIndex,
    selectedAnnotation,
    reset: resetAnnotationState,
    clearSelection,
    replaceAnnotations,
    commitDraft,
    undo: undoHistory,
    redo: redoHistory,
    clearAll: clearAllAnnotations,
    updateSelected,
    deleteSelected,
    renameSelected,
    finishRoute: finishRouteCommit,
  } = useAnnotationState({ getRouteDraft: () => routeDraft() })
  // SVG 投影（语义↔SVG 比例、滑块线宽、渲染列表）唯一 owner = useAnnotationSvgProjection。
  const { semPerSvgX, semPerSvgY, annotWidth, renderedAnnotations } = useAnnotationSvgProjection(mapView, {
    widthSlider: annotWidthSlider,
    annotations,
    draft,
    selectedIndex: selectedAnnotationIndex,
    replacingSelected: () => !!moveOriginal,
    showSelection: () => annotationOpen.value,
  })
  const textSession = ref<TextSession | null>(null) // reactive({ point, text })，文字输入会话
  const ANNOT_THIN_PX = 2 // 笔迹抽稀阈值（屏幕 CSS px，与坐标体系无关）
  let drawStart: SemanticPoint | null = null // 绘制起点（语义坐标）
  let drawPoints: SemanticPoint[] = [] // pen/eraser 已采点（语义坐标）
  let drawScreen: { x: number; y: number }[] = [] // 与 drawPoints 一一对应的屏幕点（CSS px，用于抽稀）
  let drawingPointerId: number | null = null
  let drawingStartScreen: { x: number; y: number } | null = null

  function resetAnnotations() {
    resetAnnotationState()
    activeTool.value = null
    annotationOpen.value = false
    annotVisible.value = true
    routePoints.value = []
    moveOriginal = null
    hooks.resetGestures()
    if (textSession.value) cancelSession(textSession.value)
    drawStart = null
    drawPoints = []
    drawScreen = []
    drawingPointerId = null
    drawingStartScreen = null
  }
  // 切换文件（overview 引用变化；MapOverview 未按文件 key 复用）→ 清空标注
  watch(hooks.overview, resetAnnotations)

  function cancelDrawing() {
    drawingStartScreen = null
    draft.value = routePoints.value.length ? routeDraft() : null
    drawStart = null
    drawPoints = []
    drawScreen = []
    moveOriginal = null
    drawingPointerId = null
  }
  function cancelRoute() {
    routePoints.value = []
    cancelDrawing()
  }
  function toggleTool(tool: string) {
    if (textSession.value) commitSession(textSession.value)
    cancelRoute()
    selectedAnnotationIndex.value = -1
    annotVisible.value = true
    activeTool.value = tool
  }
  function toggleAnnotation() {
    if (annotationOpen.value) return closeAnnotation()
    hooks.onOpen()
    annotationOpen.value = true
    activeTool.value = 'select'
  }
  function closeAnnotation() {
    if (textSession.value) commitSession(textSession.value)
    cancelRoute()
    annotationOpen.value = false
    activeTool.value = null
    selectedAnnotationIndex.value = -1
  }

  function undoAnnot() {
    cancelRoute()
    undoHistory()
  }
  function redoAnnot() {
    cancelRoute()
    redoHistory()
  }
  function clearAll() {
    cancelRoute()
    clearAllAnnotations()
  }
  function setAnnotColor(color: string) {
    annotColor.value = color
    if (selectedAnnotation.value) updateSelected({ color })
    if (routePoints.value.length) draft.value = routeDraft()
  }
  function toggleAnnotations() {
    cancelRoute()
    clearSelection()
    annotVisible.value = !annotVisible.value
  }
  function routeDraft() {
    return { type: 'route', color: annotColor.value, width: annotWidth.value, points: [...routePoints.value] }
  }
  function finishRoute() {
    if (!finishRouteCommit()) return
    cancelRoute()
    activeTool.value = 'select'
  }

  function draftFromTool(tool: string, a: SemanticPoint, b: SemanticPoint) {
    return annotationDraftFromTool(tool, a, b, { color: annotColor.value, width: annotWidth.value })
  }

  /** 指针 client 坐标 → 语义坐标（CSS px → 撤销 viewport 变换 → CSS↔SVG 比例 → fromX/fromY）。 */
  function semanticPoint(e: { clientX: number; clientY: number }): SemanticPoint | null {
    const sp = camera.screenPoint(e.clientX, e.clientY)
    const rect = camera.mapRenderRect()
    if (rect.width > 0 && rect.height > 0 && view.scale > 0) {
      const xNorm = ((sp.x - view.tx) / view.scale) / rect.width
      const yNorm = ((sp.y - view.ty) / view.scale) / rect.height
      const point = hooks.reliefUnproject(xNorm, yNorm)
      if (point) return { x: point.x, y: point.y }
    }
    return screenToSemantic(view, mapView.value, sp.x, sp.y, camera.mapWidth(), camera.mapHeight())
  }

  function startDrawing(e: PointerEvent) {
    const p = semanticPoint(e)
    if (!p) return
    if (!annotVisible.value) return
    drawingPointerId = e.pointerId
    drawingStartScreen = { x: e.clientX, y: e.clientY }
    if (activeTool.value === 'select') {
      const rect = camera.mapRenderRect()
      const tolerance = 12 * semPerSvgX.value * mapView.value.W / (rect.width || mapView.value.W) / view.scale
      selectedAnnotationIndex.value = hitTestAnnotation(annotations.value, p, tolerance)
      moveOriginal = selectedAnnotation.value
      drawStart = p
      return
    }
    if (activeTool.value === 'route' || TANK_CLASSES.some(cls => cls.key === activeTool.value)) {
      drawStart = p
      return
    }
    if (activeTool.value === 'text') {
      if (textSession.value) commitSession(textSession.value) // 先提交上一个未完成的文字
      textSession.value = reactive({ point: p, text: '' })
      nextTick(() => hooks.textInputRef()?.focus())
      return
    }
    if (activeTool.value === 'pen' || activeTool.value === 'eraser') {
      drawPoints = [p]
      drawScreen = [{ x: e.clientX, y: e.clientY }]
      draft.value = { type: activeTool.value as string, color: annotColor.value, width: annotWidth.value, points: [p] }
    } else {
      drawStart = p
      draft.value = draftFromTool(activeTool.value as string, p, p)
    }
  }

  function moveDrawing(e: PointerEvent) {
    const p = semanticPoint(e)
    if (!p) return
    const tool = activeTool.value
    if (tool === 'select' && moveOriginal && drawStart) {
      if (Math.hypot(p.x - drawStart.x, p.y - drawStart.y) > 1e-9) draft.value = translateAnnotation(moveOriginal, p.x - drawStart.x, p.y - drawStart.y)
      return
    }
    if (tool === 'route' || TANK_CLASSES.some(cls => cls.key === tool)) return
    if (tool === 'pen' || tool === 'eraser') {
      // 屏幕空间抽稀：相邻采样点 ≥ ANNOT_THIN_PX CSS px（不依赖 scale/渲染比例，避免换算误差累积）
      const last = drawScreen[drawScreen.length - 1]
      if (last == null || Math.hypot(e.clientX - last.x, e.clientY - last.y) >= ANNOT_THIN_PX) {
        drawScreen.push({ x: e.clientX, y: e.clientY })
        drawPoints.push(p)
        // route 草稿在采点过程中始终携带 points 列（原实现同形状）。
        draft.value = { ...(draft.value as MapAnnotation), points: [...drawPoints] }
      }
    } else if (drawStart) {
      draft.value = draftFromTool(tool as string, drawStart, p)
    }
  }

  function endDrawing() {
    const tool = activeTool.value
    if (!tool) return
    if (tool === 'select') {
      if (draft.value && moveOriginal && selectedAnnotationIndex.value >= 0) {
        const index = selectedAnnotationIndex.value
        replaceAnnotations(annotations.value.map((ann, i) => i === index && draft.value ? draft.value : ann))
      }
    } else if (tool === 'route') {
      if (drawStart) {
        const last = routePoints.value.at(-1)
        if (!last || Math.hypot(last.x - drawStart.x, last.y - drawStart.y) > 1e-9) routePoints.value.push(drawStart)
      }
      cancelDrawing()
      return
    } else if (TANK_CLASSES.some(cls => cls.key === tool) && drawStart) {
      commitDraft({ type: 'unit', tankClass: tool, color: annotColor.value, x: drawStart.x, y: drawStart.y, radius: 16 * semPerSvgX.value, label: '' })
      selectedAnnotationIndex.value = annotations.value.length - 1
      activeTool.value = 'select'
    } else if (tool === 'pen') {
      if (drawPoints.length >= 2) commitDraft({ type: 'pen', color: annotColor.value, width: annotWidth.value, points: drawPoints })
    } else if (tool === 'eraser') {
      if (drawPoints.length) {
        const next = applyEraser(annotations.value, drawPoints, annotWidth.value)
        if (next !== annotations.value) replaceAnnotations(next)
      }
    } else if (draft.value && !isDegenerateAnnotation(draft.value)) {
      commitDraft(draft.value)
    }
    cancelDrawing()
  }

  /** 文字提交（幂等：Enter/blur/移除输入框都会触发，committed 防重复）。 */
  function commitSession(session: TextSession) {
    if (textSession.value === session) textSession.value = null
    if (!session || session.cancelled || session.committed) return
    session.committed = true
    const text = session.text.trim()
    if (!text) return
    commitDraft({ type: 'text', color: annotColor.value, x: session.point.x, y: session.point.y, text })
  }

  function cancelSession(session: TextSession) {
    if (textSession.value === session) {
      textSession.value = null
      session.cancelled = true
    }
  }

  /** 文字输入框屏幕定位：语义 → SVG unit → CSS px（渲染尺寸比例）→ viewport 变换（与 screenToSvg 互逆）。 */
  const textInputStyle = computed(() => {
    const session = textSession.value
    if (!session) return null
    if (hooks.reliefHasModel()) {
      const rect = camera.mapRenderRect()
      const point = hooks.projectedSemanticNorm(session.point.x, session.point.y)
      return {
        left: `${point.xNorm * rect.width * view.scale + view.tx}px`,
        top: `${point.yNorm * rect.height * view.scale + view.ty}px`,
      }
    }
    const s = svgToScreen(
      mapView.value,
      view,
      mapView.value.toX(session.point.x),
      mapView.value.toY(session.point.y),
      camera.mapWidth(),
      camera.mapHeight(),
    )
    if (!s) return null
    return { left: `${s.x}px`, top: `${s.y}px` }
  })

  return {
    annotationOpen,
    activeTool,
    routePoints,
    annotColor,
    annotVisible,
    annotWidthSlider,
    annotWidth,
    semPerSvgX,
    semPerSvgY,
    textSession,
    textInputStyle,
    renderedAnnotations,
    history,
    historyIndex,
    annotations,
    draft,
    selectedAnnotationIndex,
    selectedAnnotation,
    drawingPointerId: () => drawingPointerId,
    drawingStartScreen: () => drawingStartScreen,
    resetAnnotations,
    cancelDrawing,
    cancelRoute,
    toggleTool,
    toggleAnnotation,
    closeAnnotation,
    undoAnnot,
    redoAnnot,
    clearAll,
    setAnnotColor,
    toggleAnnotations,
    routeDraft,
    finishRoute,
    draftFromTool,
    semanticPoint,
    startDrawing,
    moveDrawing,
    endDrawing,
    commitSession,
    cancelSession,
    clearSelection,
    deleteSelected,
    renameSelected,
  }
}

export type PlaybackAnnotationEditor = ReturnType<typeof usePlaybackAnnotationEditor>
