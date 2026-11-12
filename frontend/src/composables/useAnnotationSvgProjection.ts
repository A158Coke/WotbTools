import { computed } from 'vue'
import type { Ref } from 'vue'
import { projectAnnotationToSvg, semanticWidthFromSlider } from '../utils/annotation.js'
import type { MapAnnotation } from './useAnnotationState.js'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'

/**
 * 2D 标注的 SVG 投影唯一 owner（回放 2D 编辑器与地图预览 2D 共用）：
 * 语义单位 / SVG 像素比例、滑块 → 语义线宽、以及渲染列表（语义 → SVG，含进行中的 draft）。
 *
 * - x/y 轴因 preserveAspectRatio:none 比例可能不同；线宽 / 字号 / 半径按 x 轴换算；
 * - 滑块值 = SVG 像素口径（1× 下所见即所得）；
 * - draft 在「拖动已选标注」时覆盖原位，否则追加在末尾。
 * 几何算法的权威是 utils/annotation，这里只组合，不持有任何编辑状态。
 */
export function useAnnotationSvgProjection(
  mapView: Ref<PlaybackMapViewLike>,
  source: {
    widthSlider: Ref<number>
    annotations: Ref<MapAnnotation[]>
    draft: Ref<MapAnnotation | null>
    selectedIndex: Ref<number>
    /** draft 是否为被拖动的选中标注（替换原位而不是追加）。 */
    replacingSelected: () => boolean
    /** 是否显示选中态（标注模式打开）。 */
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
