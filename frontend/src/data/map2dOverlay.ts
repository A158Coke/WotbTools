
import { reactive, ref } from 'vue'
import { isAndroidRuntime } from '../platform/runtime.js'
import { androidAssetBase, dataVersionId } from '../scene/assetBase.js'
import { mapImages } from './mapImages.js'

export interface Map2dIndexEntry {
  sha256?: unknown
  path?: unknown
  bytes?: unknown
  width?: unknown
  height?: unknown
  orientation?: unknown
  worldBounds?: { xMin?: unknown; xMax?: unknown; yMin?: unknown; yMax?: unknown } | null
  [key: string]: unknown
}

export interface Map2dIndex {
  schemaVersion?: unknown
  generated?: unknown
  contentGeneratedAt?: unknown
  maps?: Record<string, Map2dIndexEntry | null> | null
  [key: string]: unknown
}

export interface Map2dEmbeddedManifest {
  contentGeneratedAt?: unknown
  maps?: Record<string, { sha256?: unknown } | null> | null
  [key: string]: unknown
}

export interface Map2dBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface Map2dUseEntry {
  sha256: string
  path: string
  bytes: number | null
  width: number | null
  height: number | null
}

export interface Map2dDecision {
  active: boolean
  reason: string
  index: Map2dIndex | null
  source: 'remote' | 'stored' | null
  use: Record<string, Map2dUseEntry>
  rejected: Record<string, string>
}

const EMBEDDED_URL = '/map2d-embedded.json'
const indexUrl = () => `${androidAssetBase()}/map2d/index.json`
const LEGACY_STORE_KEY = 'wotb.map2d.index.v1'
const storeKey = () => {
  const datasetId = dataVersionId()
  return datasetId ? `${LEGACY_STORE_KEY}:${datasetId}` : LEGACY_STORE_KEY
}
const SCHEMA_VERSION = 2
const ORIENTATION = 'top=+Z,left=+X'
const INDEX_TIMEOUT_MS = 8000
const IMAGE_TIMEOUT_MS = 20000

export const map2dRevision = ref(0)

export interface Map2dDiagnosticEntry {
  source: 'embedded' | 'remote' | 'pending' | 'rejected'
  reason?: string
  bytes?: number | null
}

export interface Map2dState {
  status: 'off' | 'no-embedded' | 'no-index' | 'schema' | 'timestamp' | 'stale-index' | 'active' | 'error'
  contentGeneratedAt: string | null
  indexGenerated: string | null
  indexSource: 'remote' | 'stored' | null
  maps: Record<string, Map2dDiagnosticEntry>
}

export const map2dState = reactive<Map2dState>({
  status: 'off',
  contentGeneratedAt: null,
  indexGenerated: null,
  indexSource: null,
  maps: {},             // code → { source: embedded|remote|pending|rejected, reason?, bytes? }
})

const overrides = reactive<Record<string, { url: string; sha256: string; bytes: number }>>({})
const triggered = new Set<string>()
let readyPromise: Promise<Map2dDecision> | null = null

function timeoutSignal(ms: number): { signal: AbortSignal | undefined; done: () => void } {
  if (typeof AbortController === 'undefined') return { signal: undefined, done: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

async function fetchJson<T = unknown>(url: string): Promise<T | null> {
  const { signal, done } = timeoutSignal(INDEX_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal, cache: 'no-store' })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    done()
  }
}

function readStoredIndex(): Map2dIndex | null {
  try {
    const raw = localStorage.getItem(storeKey())
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeStoredIndex(index: Map2dIndex): void {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(index))
  } catch {
    /* 配额/隐私模式失败不影响功能：本轮仍用远端索引 */
  }
}

export function isValidIndex(index: Map2dIndex | null | undefined): boolean {
  if (!index || typeof index !== 'object') return false
  if (index.schemaVersion !== SCHEMA_VERSION) return false
  return Number.isFinite(Date.parse(String(index.generated ?? '')))
}

function invalidReason(index: Map2dIndex | null | undefined): string {
  if (!index || typeof index !== 'object') return 'no-index'
  if (index.schemaVersion !== SCHEMA_VERSION) return 'schema'
  return 'timestamp'
}

export function pickNewestIndex(candidates: Array<{ index: Map2dIndex | null | undefined; source: 'remote' | 'stored' }>): { index: Map2dIndex; source: 'remote' | 'stored'; time: number } | null {
  let best: { index: Map2dIndex; source: 'remote' | 'stored'; time: number } | null = null
  for (const candidate of candidates) {
    if (!isValidIndex(candidate?.index)) continue
    const time = Date.parse(String(candidate.index!.generated))
    if (!best || time >= best.time) best = { index: candidate.index!, source: candidate.source, time }
  }
  return best
}

export function selectMap2dSources({ remoteIndex = null, storedIndex = null, embedded = null, boundsByCode = {} }: {
  remoteIndex?: Map2dIndex | null
  storedIndex?: Map2dIndex | null
  embedded?: Map2dEmbeddedManifest | null
  boundsByCode?: Record<string, Map2dBounds | undefined>
} = {}): Map2dDecision {
  const embeddedMaps = embedded && typeof embedded === 'object' ? embedded.maps : null
  if (!embeddedMaps || typeof embeddedMaps !== 'object' || Object.keys(embeddedMaps).length === 0) {
    return { active: false, reason: 'no-embedded', index: null, source: null, use: {}, rejected: {} }
  }
  const newest = pickNewestIndex([
    { index: storedIndex, source: 'stored' },
    { index: remoteIndex, source: 'remote' },
  ])
  if (!newest) {
    const supplied = remoteIndex || storedIndex
    return { active: false, reason: supplied ? invalidReason(remoteIndex || storedIndex) : 'no-index',
             index: null, source: null, use: {}, rejected: {} }
  }
  const contentStamp = Date.parse(String(embedded?.contentGeneratedAt ?? ''))
  if (!Number.isFinite(contentStamp)) {
    return { active: false, reason: 'timestamp', index: newest.index, source: newest.source, use: {}, rejected: {} }
  }
  if (newest.time <= contentStamp) {
    return { active: false, reason: 'stale-index', index: newest.index, source: newest.source, use: {}, rejected: {} }
  }
  const use: Record<string, Map2dUseEntry> = {}
  const rejected: Record<string, string> = {}
  const indexMaps = newest.index.maps && typeof newest.index.maps === 'object' ? newest.index.maps : {}
  for (const [code, entry] of Object.entries(indexMaps)) {
    const local = embeddedMaps[code]
    if (!local || !entry) continue
    if (typeof entry.sha256 !== 'string' || typeof entry.path !== 'string') continue
    if (!geometryMatches(entry, boundsByCode[code])) { rejected[code] = 'geometry'; continue }
    if (entry.sha256 === local.sha256) continue
    use[code] = {
      sha256: entry.sha256,
      path: entry.path,
      bytes: typeof entry.bytes === 'number' && Number.isFinite(entry.bytes) ? entry.bytes : null,
      width: typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : null,
      height: typeof entry.height === 'number' && Number.isFinite(entry.height) ? entry.height : null,
    }
  }
  return { active: true, reason: newest.source === 'remote' ? 'remote-index' : 'stored-index',
           index: newest.index, source: newest.source, use, rejected }
}

export function geometryMatches(entry: Map2dIndexEntry | null | undefined, bounds: Map2dBounds | null | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false
  if (entry.orientation !== ORIENTATION) return false
  if (!(Number.isFinite(entry.width) && Number.isFinite(entry.height)) || entry.width !== entry.height) return false
  const wb = entry.worldBounds
  if (!wb || typeof wb !== 'object') return false
  if (!bounds || typeof bounds !== 'object') return false
  const b = bounds as Map2dBounds
  return (['xMin', 'xMax', 'yMin', 'yMax'] as const).every((k) => {
    const v = wb[k]
    return typeof v === 'number' && Number.isFinite(v) && v === b[k]
  })
}

async function init(): Promise<Map2dDecision> {
  if (!isAndroidRuntime()) {
    map2dState.status = 'off'
    return { active: false, reason: 'off', index: null, source: null, use: {}, rejected: {} }
  }
  const embedded = await fetchJson<Map2dEmbeddedManifest>(EMBEDDED_URL)
  if (!embedded) {
    map2dState.status = 'no-embedded'
    return { active: false, reason: 'no-embedded', index: null, source: null, use: {}, rejected: {} }
  }
  map2dState.contentGeneratedAt = (embedded.contentGeneratedAt ?? null) as string | null
  const stored = readStoredIndex()
  const remote = await fetchJson<Map2dIndex>(indexUrl())
  if (remote && isValidIndex(remote)) {
    const remoteTime = Date.parse(String(remote.generated))
    const storedTime = stored && isValidIndex(stored) ? Date.parse(String(stored.generated)) : Number.NEGATIVE_INFINITY
    if (remoteTime >= storedTime) writeStoredIndex(remote)
  }
  const decision = selectMap2dSources({ remoteIndex: remote, storedIndex: readStoredIndex(), embedded, boundsByCode: registryBounds() })
  map2dState.status = (decision.active ? 'active' : decision.reason) as Map2dState['status']
  map2dState.indexGenerated = (decision.index?.generated ?? null) as string | null
  map2dState.indexSource = decision.source
  for (const code of Object.keys(embedded.maps ?? {})) {
    if (decision.use[code]) map2dState.maps[code] = { source: 'pending', bytes: decision.use[code].bytes }
    else if (decision.rejected?.[code]) map2dState.maps[code] = { source: 'rejected', reason: decision.rejected[code] }
    else map2dState.maps[code] = { source: 'embedded' }
  }
  return decision
}

function registryBounds(): Record<string, Map2dBounds> {
  const out: Record<string, Map2dBounds> = {}
  for (const [code, entry] of Object.entries(mapImages || {})) {
    if (entry && entry.coordinateBounds) out[code] = entry.coordinateBounds
  }
  return out
}

export function ensureMap2dReady(): Promise<Map2dDecision> {
  if (!readyPromise) {
    readyPromise = init().catch((): Map2dDecision => ({
      active: false, reason: 'error', index: null, source: null, use: {}, rejected: {},
    }))
  }
  return readyPromise
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function ensureMap2dImage(code: string): Promise<string | null> {
  const decision = await ensureMap2dReady()
  const want = decision && decision.active ? decision.use[code] : null
  if (!want) return null
  if (overrides[code]) return overrides[code].url
  const { signal, done } = timeoutSignal(IMAGE_TIMEOUT_MS)
  try {
    const response = await fetch(`${androidAssetBase()}/${want.path}`, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    if (want.bytes != null && buffer.byteLength !== want.bytes) throw new Error('size mismatch')
    const digest = await sha256Hex(buffer)
    if (!digest) throw new Error('no-subtle-crypto')
    if (digest !== want.sha256) throw new Error('sha256 mismatch')
    const url = URL.createObjectURL(new Blob([buffer], { type: 'image/webp' }))
    try {
      await assertDecodedGeometry(url, want)
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
    overrides[code] = { url, sha256: want.sha256, bytes: buffer.byteLength }
    map2dState.maps[code] = { source: 'remote', bytes: buffer.byteLength }
    map2dRevision.value += 1
    return url
  } catch (error) {
    map2dState.maps[code] = { source: 'rejected', reason: String((error as Error)?.message || error) }
    return null
  } finally {
    done()
  }
}

async function assertDecodedGeometry(url: string, want: Map2dUseEntry): Promise<void> {
  if (!(typeof want.width === 'number' && typeof want.height === 'number')) throw new Error('geometry:no-dims')
  const image = new Image()
  image.src = url
  if (typeof image.decode === 'function') await image.decode()
  else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject })
  if (image.naturalWidth !== want.width || image.naturalHeight !== want.height) {
    throw new Error(`geometry:${image.naturalWidth}x${image.naturalHeight}≠${want.width}x${want.height}`)
  }
}

export function map2dSrc(code: string, fallbackSrc: string): string {
  const override = overrides[code]
  if (override) return override.url
  if (code && !triggered.has(code)) {
    triggered.add(code)
    void ensureMap2dImage(code).catch(() => {})
  }
  return fallbackSrc
}

export function __resetMap2dForTests() {
  readyPromise = null
  triggered.clear()
  for (const code of Object.keys(overrides)) delete overrides[code]
  for (const code of Object.keys(map2dState.maps)) delete map2dState.maps[code]
  map2dState.status = 'off'
  map2dState.contentGeneratedAt = null
  map2dState.indexGenerated = null
  map2dState.indexSource = null
  map2dRevision.value = 0
}

if (typeof window !== 'undefined' && (isAndroidRuntime() || import.meta.env?.DEV)) {
  window.__wotbMap2d = map2dState
}
