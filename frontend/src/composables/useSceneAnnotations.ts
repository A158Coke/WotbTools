import { computed, ref, watch } from 'vue'
import {
  ANNOT_COLORS, ANNOT_ERASER_RADIUS_DEFAULT, ANNOT_ERASER_RADIUS_MAX, ANNOT_ERASER_RADIUS_MIN,
  ANNOT_WIDTH_DEFAULT, ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN,
  applyEraser, canRedo, canUndo,
} from '../utils/annotation.js'
import { useAnnotationState } from './useAnnotationState.js'
import type { MapAnnotation } from './useAnnotationState.js'

interface SceneAnnotationApi {
  setAnnotations?: (annotations: MapAnnotation[]) => void
  setAnnotationInteraction?: (config: Record<string, unknown>) => void
  setAnnotationsVisible?: (visible: boolean) => void
}

export interface SceneErasePath {
  points: { x: number; y: number }[]
  radius: number
}

const ALLOWED_TOOLS = ['pen', 'eraser']

export function useSceneAnnotations(hooks: {
  getSceneApi: () => SceneAnnotationApi | null | undefined
  interactionReady: () => boolean
  canOpen?: () => boolean
  onOpen?: () => void
}) {
  const open = ref(false)
  const tool = ref<string | null>(null)
  const color = ref(ANNOT_COLORS[0])
  const widthSlider = ref(ANNOT_WIDTH_DEFAULT)
  const eraserRadius = ref(ANNOT_ERASER_RADIUS_DEFAULT)
  const visible = ref(true)
  const {
    history, historyIndex, annotations, replaceAnnotations, commitDraft, undo, redo, clearAll, reset: resetHistory,
  } = useAnnotationState()

  function pushProjection() {
    hooks.getSceneApi()?.setAnnotations?.(annotations.value)
  }
  function pushInteraction() {
    hooks.getSceneApi()?.setAnnotationInteraction?.({
      enabled: open.value && !!tool.value && hooks.interactionReady(),
      tool: tool.value,
      color: color.value,
      width: widthSlider.value,
      eraserWidth: eraserRadius.value,
    })
  }
  function pushVisibility() {
    hooks.getSceneApi()?.setAnnotationsVisible?.(visible.value)
  }
  function commitFromScene(annotation: MapAnnotation) {
    commitDraft(annotation)
  }
  function eraseFromScene(path: SceneErasePath) {
    const next = applyEraser(annotations.value, path.points, path.radius)
    if (next !== annotations.value) replaceAnnotations(next)
  }
  function toggleVisible() {
    visible.value = !visible.value
  }
  function setTool(next: string) {
    tool.value = next
    if (!visible.value) visible.value = true
  }
  function openAnnotation() {
    if (open.value || (hooks.canOpen && !hooks.canOpen())) return
    hooks.onOpen?.()
    open.value = true
    tool.value = 'pen'
    visible.value = true
    pushProjection()
    pushInteraction()
    pushVisibility()
  }
  function closeAnnotation() {
    open.value = false
    tool.value = null
    pushInteraction()
  }
  function resetAnnotationState() {
    resetHistory()
    open.value = false
    tool.value = null
    visible.value = true
    const api = hooks.getSceneApi()
    api?.setAnnotations?.([])
    api?.setAnnotationInteraction?.({ enabled: false, tool: null })
    api?.setAnnotationsVisible?.(true)
  }

  watch(annotations, pushProjection)
  watch([open, tool, color, widthSlider, eraserRadius, hooks.interactionReady], pushInteraction)
  watch(visible, pushVisibility)
  watch(hooks.interactionReady, (ready) => { if (!ready && open.value) closeAnnotation() })

  const toolbarProps = computed(() => ({
    open: open.value,
    activeTool: tool.value,
    annotColors: ANNOT_COLORS,
    annotColor: color.value,
    annotVisible: visible.value,
    annotWidthSlider: widthSlider.value,
    annotWidthMin: ANNOT_WIDTH_MIN,
    annotWidthMax: ANNOT_WIDTH_MAX,
    allowedTools: ALLOWED_TOOLS,
    eraserRadiusSlider: eraserRadius.value,
    eraserRadiusMin: ANNOT_ERASER_RADIUS_MIN,
    eraserRadiusMax: ANNOT_ERASER_RADIUS_MAX,
    historyIndex: historyIndex.value,
    history: history.value,
    canUndo,
    canRedo,
  }))
  const toolbarHandlers = {
    'toggle-tool': setTool,
    'set-annot-color': (next: string) => { color.value = next },
    'update:annot-width': (next: number) => { widthSlider.value = next },
    'update:eraser-radius': (next: number) => { eraserRadius.value = next },
    undo,
    redo,
    'clear-annotations': clearAll,
    'toggle-annotations': toggleVisible,
    close: closeAnnotation,
  }

  return {
    annotationOpen: open,
    annotationTool: tool,
    annotations,
    replaceAnnotations,
    pushAnnotationProjection: pushProjection,
    pushAnnotationInteraction: pushInteraction,
    pushAnnotationVisibility: pushVisibility,
    commitAnnotationFromScene: commitFromScene,
    eraseFromScene,
    openAnnotation,
    closeAnnotation,
    resetAnnotationState,
    toolbarProps,
    toolbarHandlers,
  }
}
