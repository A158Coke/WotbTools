import { ref } from 'vue'
import type { Ref } from 'vue'
import type { MapAnnotation } from './useAnnotationState.js'

/** 文件 kind 不区分视角：2D/3D 标注同为 ±300 语义系，同一张地图即可互导。 */
const IMPORT_KIND = 'map-preview-annotations'
/** 兼容合入前旧导出的 -2d / -3d 后缀 kind。 */
const IMPORT_KINDS = new Set([IMPORT_KIND, 'map-preview-annotations-2d', 'map-preview-annotations-3d'])
const MESSAGE_MS = 4000

/**
 * 地图预览标注 JSON 文件的唯一 owner（MapPreview2DPane 与 MapPreview3DPane 共用）：
 * 文件 schema（version / kind / mapKey / annotations）、fail-closed 导入校验、导出落盘，
 * 以及导入导出结果的短时提示。
 *
 * 宿主只注入数据差异：几何校验（2D 全 schema、3D pen-only）、净化（3D 剥离 session-local
 * 的 surface 锚点，导入导出都做）、文件名视角后缀、导入落地方式（宿主自己的撤销栈）。
 */
export function useMapPreviewAnnotationFile(options: {
  mapKey: () => string
  annotations: Ref<MapAnnotation[]>
  validate: (annotation: unknown) => boolean
  sanitize?: (annotations: MapAnnotation[]) => MapAnnotation[]
  suffix: string
  apply: (annotations: MapAnnotation[]) => void
  t: (key: string, values?: Record<string, unknown>) => string
}) {
  const sanitize = options.sanitize || ((list: MapAnnotation[]) => list)
  const importMessage = ref('')
  let importMessageTimer: ReturnType<typeof setTimeout> | undefined
  function flashImportMessage(key: string, values?: Record<string, unknown>) {
    importMessage.value = options.t(key, values)
    clearTimeout(importMessageTimer)
    importMessageTimer = setTimeout(() => { importMessage.value = '' }, MESSAGE_MS)
  }

  function exportAnnotations() {
    if (!options.annotations.value.length) {
      flashImportMessage('mapPreview.annotations.noAnnotations')
      return
    }
    const mapKey = options.mapKey()
    const payload = {
      version: 1,
      kind: IMPORT_KIND,
      mapKey,
      exportedAt: new Date().toISOString(),
      annotations: sanitize(options.annotations.value),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `map-annotations-${mapKey}-${options.suffix}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function rejectImport(reasonKey: string) {
    flashImportMessage('mapPreview.annotations.importFailed', { reason: options.t(reasonKey) })
  }

  async function importAnnotations(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0] || null
    input.value = ''
    if (!file) return
    let payload: { version?: unknown; kind?: unknown; mapKey?: unknown; annotations?: unknown } | null = null
    try {
      payload = JSON.parse(await file.text())
    } catch {
      rejectImport('mapPreview.annotations.importReasonFormat')
      return
    }
    if (!payload || payload.version !== 1 || !IMPORT_KINDS.has(payload.kind as string) || !Array.isArray(payload.annotations)) {
      rejectImport('mapPreview.annotations.importReasonFormat')
      return
    }
    if (payload.mapKey !== options.mapKey()) {
      rejectImport('mapPreview.annotations.importReasonMap')
      return
    }
    // 几何逐条校验（fail-closed，整份拒绝）：半校验条目会在渲染或 applyEraser 里 TypeError。
    if (!payload.annotations.every(options.validate)) {
      rejectImport('mapPreview.annotations.importReasonFormat')
      return
    }
    const items = sanitize(payload.annotations as MapAnnotation[])
    options.apply(items)
    flashImportMessage('mapPreview.annotations.importedCount', { count: items.length })
  }

  return { importMessage, exportAnnotations, importAnnotations }
}
