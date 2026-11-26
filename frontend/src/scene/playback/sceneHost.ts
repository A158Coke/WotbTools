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
  stageReloadReplay?: ((contactShadows?: boolean) => Promise<void>) | null
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
