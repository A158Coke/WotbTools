import { computed } from 'vue'
import type { Ref } from 'vue'
import { projectAnnotationToSvg, semanticWidthFromSlider } from '../utils/annotation.js'
import type { MapAnnotation } from './useAnnotationState.js'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'

export function useAnnotationSvgProjection(
  mapView: Ref<PlaybackMapViewLike>,
  source: {
    widthSlider: Ref<number>
    annotations: Ref<MapAnnotation[]>
    draft: Ref<MapAnnotation | null>
    selectedIndex: Ref<number>
    replacingSelected: () => boolean
    showSelection: () => boolean
  },
) {
  const semPerSvgX = computed(() => {
    const b = mapView.value.renderBounds
    return b && mapView.value.W > 0 ? (b.xMax - b.xMin) / mapView.value.W : 1
  })
  const semPerSvgY = computed(() => {
    const b = mapView.value.renderBounds
    return b && mapView.value.H > 0 ? (b.yMax - b.yMin) / mapView.value.H : 1
  })
  const annotWidth = computed(() => semanticWidthFromSlider(source.widthSlider.value, {
    semanticSpan: mapView.value.renderBounds ? mapView.value.renderBounds.xMax - mapView.value.renderBounds.xMin : 0,
    logicalSpan: mapView.value.W,
  }))

  const renderedAnnotations = computed(() => {
    const toX = mapView.value.toX
    const toY = mapView.value.toY
    const invX = 1 / Math.max(1e-9, semPerSvgX.value)
    const invY = 1 / Math.max(1e-9, semPerSvgY.value)
    const list = [...source.annotations.value]
    const draft = source.draft.value
    if (draft) {
      if (source.replacingSelected() && source.selectedIndex.value >= 0) list[source.selectedIndex.value] = draft
      else list.push(draft)
    }
    const toSvgOptions = { toX, toY, invX, invY, widthFallback: annotWidth.value } as Parameters<typeof projectAnnotationToSvg>[1] & { toX: typeof toX; toY: typeof toY }
    return list.map((ann: MapAnnotation, index: number) => ({
      ...projectAnnotationToSvg(ann, toSvgOptions),
      selected: source.showSelection() && index === source.selectedIndex.value,
    }))
  })

  return { semPerSvgX, semPerSvgY, annotWidth, renderedAnnotations }
}
