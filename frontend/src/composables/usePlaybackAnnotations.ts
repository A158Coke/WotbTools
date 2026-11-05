import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { commit, redo as redoSnapshot, undo as undoSnapshot } from '../utils/annotation.js'

/** 标注记录的结构最小集（schema 几何由 utils/annotation 权威，这里只要求可辨识）。 */
export interface PlaybackAnnotation {
  type: string
  color: string
  [key: string]: unknown
}

interface UsePlaybackAnnotationsOptions {
  /** route 草稿由宿主 gesture 状态派生（routePoints + 颜色/宽度），route 提交时取值。 */
  getRouteDraft?: () => PlaybackAnnotation | null
}

/**
 * 2D 标注编辑状态的唯一 owner（#820 Wave B5B）：
 * 快照历史（history + historyIndex）+ 当前标注列表 + 进行中草稿 + 选中项，
 * 以及 commit / undo / redo / clear / updateSelected / delete / rename / route 提交 / reset。
 *
 * 边界（不在此处，也不做双向同步）：
 * - 几何与历史算法的权威仍是 `utils/annotation`（只消费，不复制）；
 * - pointer gesture 临时状态（routePoints、drawStart/points、moveOriginal）、工具与颜色/宽度、
 *   textSession、地图 viewport、播放时钟归宿主 BattlePlayback；gesture 产生的草稿通过
 *   写 `draft` ref 进入同一 owner，不建第二份草稿状态。
 */
export function usePlaybackAnnotations(options: UsePlaybackAnnotationsOptions = {}) {
  const history: Ref<PlaybackAnnotation[][]> = ref([[]]) // 快照栈（不可变数组），history[0] = 初始空
  const historyIndex = ref(0)
  const annotations: ComputedRef<PlaybackAnnotation[]> = computed(() => history.value[historyIndex.value] || [])
  const draft: Ref<PlaybackAnnotation | null> = ref(null) // 进行中的标注（未提交）
  const selectedAnnotationIndex = ref(-1)
  const selectedAnnotation: ComputedRef<PlaybackAnnotation | null> = computed(
    () => annotations.value[selectedAnnotationIndex.value] || null
  )

  /** 切换文件等场景的整体重置：历史、草稿、选中项全部回到初始态。 */
  function reset() {
    history.value = [[]]
    historyIndex.value = 0
    draft.value = null
    selectedAnnotationIndex.value = -1
  }

  function clearSelection() {
    selectedAnnotationIndex.value = -1
  }

  /** 快照式提交：next 成为新历史项（utils/annotation.commit 权威）。 */
  function replaceAnnotations(next: PlaybackAnnotation[]) {
    const s = commit(history.value, historyIndex.value, next)
    history.value = s.history
    historyIndex.value = s.index
  }

  function commitDraft(ann: PlaybackAnnotation) {
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

  function updateSelected(patch: Partial<PlaybackAnnotation>) {
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

  /**
   * 提交进行中的路线（≥2 个点才有效）。返回是否实际提交；宿主负责随后清 gesture 状态与切回 select。
   */
  function finishRoute(): boolean {
    const routeDraft = options.getRouteDraft?.() || null
    const points = (routeDraft?.points as unknown[] | undefined) || []
    if (points.length < 2) return false
    commitDraft(routeDraft as PlaybackAnnotation)
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
