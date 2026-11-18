import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { loadMapIndex, mapCoverUrl } from '../scene/replaySource.js'
import { dataVersionId } from '../scene/assetBase.js'
import { mapImages } from '../data/mapImages.js'
import { hasChineseMapName, mapLabel } from '../utils/helpers.js'

type MapIndexEntry = { key?: string; display?: string; variantKey?: string; variant?: string }
type MapIndex = { maps?: Record<string, MapIndexEntry> }
type BundledImage = (typeof mapImages)[keyof typeof mapImages]
type Basemap =
  | { kind: 'map2d'; mapKey: string; fallbackImage?: BundledImage }
  | { kind: 'bundled'; image: BundledImage }
type MapVariant = { id: number; display: string; variantKey: string; variant: string | null }
type MapEntry = {
  key: string
  packDisplay: string
  basemap: Basemap
  thumb: string | null
  thumbFallback: string | null
  variants: MapVariant[]
  mapId: number | null
}
type LocalizedMap = MapEntry & { name: string }

export function useMapPreviewCatalog(locale: Ref<string>, authenticated: ComputedRef<boolean>) {
  /** Store locale-neutral map data; derive names and ordering from the active locale. */
  const rawMaps = ref<MapEntry[]>([])
  const failedThumbs = ref(new Set())
  const failedFallbacks = ref(new Set())
  const nameOf = (m: MapEntry) => {
    const localized = mapLabel(m.key, locale.value)
    return localized !== m.key ? localized : (m.packDisplay || m.key)
  }
  const maps = computed<LocalizedMap[]>(() => rawMaps.value
    .map((m) => ({
      ...m,
      name: nameOf(m),
      thumb: failedThumbs.value.has(m.key) ? null : m.thumb,
      thumbFallback: failedFallbacks.value.has(m.key) ? null : m.thumbFallback,
    }))
    .sort((a, b) => collator.compare(a.name, b.name)))
  /** Visibility uses the approved map list, independent of locale, and resets each visit. */
  const showAllMaps = ref(false)
  /** Search localized names and keys; a query includes unapproved maps regardless of the visibility switch. */
  const mapQuery = ref('')
  const visibleMaps = computed(() => {
    const query = mapQuery.value.trim().toLocaleLowerCase()
    if (query) return maps.value.filter((m) => m.name.toLocaleLowerCase().includes(query) || m.key.toLowerCase().includes(query))
    return showAllMaps.value ? maps.value : maps.value.filter((m) => hasChineseMapName(m.key))
  })
  const indexFailed = ref(false)
  const indexLoaded = ref(false)
  const collator = new Intl.Collator()

  async function loadMaps() {
    indexFailed.value = false
    const idx = await loadMapIndex() as MapIndex | null
    const entries = idx && idx.maps ? Object.entries(idx.maps) : null
    if (!entries) {
      indexFailed.value = true
      rawMaps.value = []
      indexLoaded.value = true
      return
    }
    const byKey = new Map<string, MapEntry>()
    // An explicitly selected dataset prefers its calibrated map2d; offline/default use prefers bundled images.
    const preferDatasetBasemap = Boolean(dataVersionId())
    for (const [id, m] of entries) {
      const key = String(m.key || '')
      if (!key) continue
      // Multiple ids for one key share the map entry but retain per-id variant metadata.
      let group = byKey.get(key)
      if (!group) {
        const bundled = mapImages[key as keyof typeof mapImages] || null
        group = {
          key,
          packDisplay: m.display || '',
          // Keep a bundled fallback for calibrated map2d images when one exists.
          basemap: (preferDatasetBasemap || !bundled)
            ? { kind: 'map2d', mapKey: key, ...(bundled ? { fallbackImage: bundled } : {}) }
            : { kind: 'bundled', image: bundled },
          thumb: safeCoverUrl(key),
          thumbFallback: bundled ? bundled.src : null,
          variants: [] as MapVariant[],
          mapId: null,
        }
        byKey.set(key, group)
      }
      group.variants.push({
        id: Number(id),
        display: m.display || '',
        variantKey: String(m.variantKey || ''),
        variant: typeof m.variant === 'string' ? m.variant : null,
      })
    }
    for (const group of byKey.values()) group.mapId = group.variants[0]?.id ?? null
    rawMaps.value = [...byKey.values()]
    indexLoaded.value = true
  }
  /** Offline asset providers may throw; let the bundled cover fallback handle that case. */
  function safeCoverUrl(key: string) {
    try {
      return mapCoverUrl(key)
    } catch {
      return null
    }
  }

  function onThumbError(m: LocalizedMap) {
    if (!m.thumb || failedThumbs.value.has(m.key)) return
    const next = new Set(failedThumbs.value)
    next.add(m.key)
    failedThumbs.value = next
  }

  /** Keep fallback failures separate so a known-failed remote cover is not retried. */
  function onFallbackError(m: LocalizedMap) {
    if (!m.thumbFallback || failedFallbacks.value.has(m.key)) return
    const next = new Set(failedFallbacks.value)
    next.add(m.key)
    failedFallbacks.value = next
  }
  watch(authenticated, (ok) => { if (ok && !indexLoaded.value) loadMaps() }, { immediate: true })
  return { maps, visibleMaps, showAllMaps, mapQuery, indexFailed, indexLoaded, loadMaps, onThumbError, onFallbackError }
}
