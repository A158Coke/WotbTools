import { ref } from 'vue'
import type { Ref } from 'vue'
import type { MapAnnotation } from './useAnnotationState.js'

const IMPORT_KIND = 'map-preview-annotations'
const IMPORT_KINDS = new Set([IMPORT_KIND, 'map-preview-annotations-2d', 'map-preview-annotations-3d'])
const MESSAGE_MS = 4000

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
