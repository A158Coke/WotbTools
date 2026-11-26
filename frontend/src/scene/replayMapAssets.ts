import { assetProvider } from './assetProvider.js'
import type { Map2dIndex, Map2dBounds } from '../data/map2dOverlay.js'

let mapIndexPromise: Promise<{ maps?: Record<string, { key: string }> } | null> | null = null
const mapIndexMissWarned = new Set<string>()

export function loadMapIndex() {
  if (!assetProvider.configured()) return Promise.resolve(null)
  if (!mapIndexPromise) {
    mapIndexPromise = assetProvider.json('/index.json').catch((e: unknown) => {
      mapIndexPromise = null
      console.warn('地图资产索引加载失败（本场地图回退占位网格；下次加载重试）:', e)
      return null
    })
  }
  return mapIndexPromise
}

export async function resolveMapKey(mapq: string) {
  const id = new URLSearchParams(mapq).get('id')
  const idx = assetProvider.configured() ? await loadMapIndex() : null
  const hit = idx && idx.maps && idx.maps[String(id)]
  if (idx && !hit && id && !mapIndexMissWarned.has(String(id))) {
    mapIndexMissWarned.add(String(id))
    console.warn('地图不在资产索引中（资产包过期或缺该地图？）: id=' + id)
  }
  return hit ? hit.key : null
}

export function __resetMapIndexForTest() {
  mapIndexPromise = null
  mapIndexMissWarned.clear()
}

export function mapCoverUrl(mapKey: string | null | undefined) {
  if (!mapKey || !assetProvider.configured()) return null
  return assetProvider.url(`/cover/${mapKey}.webp`)
}

export function map2dCanonicalUrl(mapKey: string | null | undefined) {
  if (!mapKey || !assetProvider.configured()) return null
  return assetProvider.url(`/map2d/${mapKey}.webp`)
}

let map2dIndexPromise: Promise<Map2dIndex | null> | null = null

export function loadMap2dIndex() {
  if (!assetProvider.configured()) return Promise.resolve(null)
  if (!map2dIndexPromise) {
    map2dIndexPromise = assetProvider.json<Map2dIndex>('/map2d/index.json').catch((e) => {
      map2dIndexPromise = null
      console.warn('map2d 索引加载失败（预览 2D 底图 fail-closed）:', e)
      return null
    })
  }
  return map2dIndexPromise
}

export function __resetMap2dIndexForTest() {
  map2dIndexPromise = null
}

async function sha256Hex(buffer: ArrayBuffer) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('crypto.subtle 不可用（需要安全上下文）')
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function resolveMap2dBasemap(
  mapKey: string | null | undefined,
  expectedBounds: Map2dBounds | null | undefined,
  fetchImpl: ((url: string) => Promise<Response>) | null = null,
) {
  const key = String(mapKey || '')
  if (!key) return { error: 'entry' }
  const url = map2dCanonicalUrl(key)
  if (!url) return { error: 'offline' }
  const index = await loadMap2dIndex()
  const { isValidIndex, geometryMatches } = await import('../data/map2dOverlay.js')
  if (!isValidIndex(index)) return { error: 'index' }
  const entry = index?.maps?.[String(key)]
  if (!entry) return { error: 'entry' }
  if (!geometryMatches(entry, expectedBounds)) return { error: 'geometry' }
  const doFetch = fetchImpl || ((u: string) => assetProvider.fetch(u))
  let buffer: ArrayBuffer
  try {
    const resp = await doFetch(url)
    if (!resp || !resp.ok) return { error: 'integrity', detail: `http ${resp && resp.status}` }
    buffer = await resp.arrayBuffer()
  } catch (e) {
    return { error: 'integrity', detail: String(e && (e as Error).message || e) }
  }
  let sha
  try {
    sha = await sha256Hex(buffer)
  } catch (e) {
    return { error: 'integrity', detail: String(e && (e as Error).message || e) }
  }
  if (sha !== entry.sha256) return { error: 'integrity', detail: 'sha256 mismatch' }
  return {
    bytes: buffer,
    sha256: sha,
    width: entry.width,
    height: entry.height,
    worldBounds: entry.worldBounds,
    orientation: entry.orientation,
  }
}

export function mapStaticUrl(kind: string, layer: string | null | undefined, mapKey: string | null | undefined) {
  if (!mapKey || !assetProvider.configured()) return null
  const f = (name: string) => assetProvider.url(`/map/${mapKey}/${name}`)
  switch (kind) {
    case 'map': return f('ground.webp')
    case 'terrain': return f('terrain.u16.bin')
    case 'terrain-meta': return f('terrain.json')
    case 'scenery': return f('scenery.glb')
    case 'lighting': return f('lighting.json')
    case 'ibl': return f('ibl.webp')
    case 'destructibles': return f('destructibles.json')
    case 'decals': return f('decals.json')
    case 'grass': return f('grass.json')
    case 'grassbin': return f('grass.bin')
    case 'grassproto': return f('grass.glb')
    case 'groundmeta': return f('ground.layers.json')
    case 'groundtex': return f(`ground/${layer}.webp`)
  }
  return null
}
