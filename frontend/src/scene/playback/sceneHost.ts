import type { createPlaybackStore } from '../playbackStore.ts'
import type { useSceneAnnotations } from '../../composables/useSceneAnnotations.ts'

type AnnotationApi = ReturnType<typeof useSceneAnnotations>

export interface SceneHostOptions {
  container: HTMLElement
  store: ReturnType<typeof createPlaybackStore>
  labelOverlay?: HTMLElement | null
  onVehicleSelect?: (eid: number | null, event: MouseEvent | null) => void
  onAnnotationCommit?: AnnotationApi['commitAnnotationFromScene']
  onAnnotationErase?: AnnotationApi['eraseFromScene']
  recorderReticle?: HTMLElement | null
  /** 渲染设置整页重载前暂存当前回放（由 3D pane 提供；场景宿主只转发给 sceneState）。 */
  stageReloadReplay?: (() => Promise<void>) | null
}

export function createSceneHost({
  container,
  store,
  labelOverlay,
  onVehicleSelect,
  onAnnotationCommit,
  onAnnotationErase,
  recorderReticle,
  stageReloadReplay = null,
}: SceneHostOptions) {
  return {
    container,
    store,
    labelOverlay,
    onVehicleSelect,
    onAnnotationCommit,
    onAnnotationErase,
    recorderReticle,
    stageReloadReplay,
  }
}
