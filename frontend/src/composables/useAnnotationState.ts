import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { commit, redo as redoSnapshot, undo as undoSnapshot } from '../utils/annotation.js'

export interface MapAnnotation {
  type: string
  color: string
  [key: string]: unknown
}

interface UseAnnotationStateOptions {
  getRouteDraft?: () => MapAnnotation | null
}

export function useAnnotationState(options: UseAnnotationStateOptions = {}) {
  const history: Ref<MapAnnotation[][]> = ref([[]])
  const historyIndex = ref(0)
  const annotations: ComputedRef<MapAnnotation[]> = computed(() => history.value[historyIndex.value] || [])
  const draft: Ref<MapAnnotation | null> = ref(null)
  const selectedAnnotationIndex = ref(-1)
  const selectedAnnotation: ComputedRef<MapAnnotation | null> = computed(
    () => annotations.value[selectedAnnotationIndex.value] || null
  )

  function reset() {
    history.value = [[]]
    historyIndex.value = 0
    draft.value = null
    selectedAnnotationIndex.value = -1
  }

  function clearSelection() {
    selectedAnnotationIndex.value = -1
  }

  function replaceAnnotations(next: MapAnnotation[]) {
    const s = commit(history.value, historyIndex.value, next)
    history.value = s.history
    historyIndex.value = s.index
  }

  function commitDraft(ann: MapAnnotation) {
    replaceAnnotations([...annotations.value, ann])
  }

  function undo() {
    clearSelection()
    const s = undoSnapshot(history.value, historyIndex.value)
    history.value = s.history
    historyIndex.value = s.index
  }

  function redo() {
    clearSelection()
    const s = redoSnapshot(history.value, historyIndex.value)
    history.value = s.history
    historyIndex.value = s.index
  }

  function clearAll() {
    clearSelection()
    if (annotations.value.length) replaceAnnotations([])
  }

  function updateSelected(patch: Partial<MapAnnotation>) {
    if (!selectedAnnotation.value) return
    const index = selectedAnnotationIndex.value
    replaceAnnotations(annotations.value.map((ann, i) => (i === index ? { ...ann, ...patch } : ann)))
  }

  function deleteSelected() {
    if (!selectedAnnotation.value) return
    replaceAnnotations(annotations.value.filter((_, i) => i !== selectedAnnotationIndex.value))
    clearSelection()
  }

  function renameSelected(label: string) {
    const value = String(label).trim().slice(0, 60)
    if (selectedAnnotation.value?.type === 'text') updateSelected({ text: value })
    else updateSelected({ label: value })
  }

  function finishRoute(): boolean {
    const routeDraft = options.getRouteDraft?.() || null
    const points = (routeDraft?.points as unknown[] | undefined) || []
    if (points.length < 2) return false
    commitDraft(routeDraft as MapAnnotation)
    selectedAnnotationIndex.value = annotations.value.length - 1
    return true
  }

  return {
    history,
    historyIndex,
    annotations,
    draft,
    selectedAnnotationIndex,
    selectedAnnotation,
    reset,
    clearSelection,
    replaceAnnotations,
    commitDraft,
    undo,
    redo,
    clearAll,
    updateSelected,
    deleteSelected,
    renameSelected,
    finishRoute,
  }
}
