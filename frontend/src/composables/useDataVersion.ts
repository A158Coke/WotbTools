import { computed, ref, watch } from 'vue'
import { orderDatasetsForDisplay } from '../utils/datasetOrder.js'
import {
  ASSET_BASE_STORAGE,
  DATA_VERSION_QUERY,
  DATA_VERSION_STORAGE,
  assetOrigin,
  dataVersionId,
  stripDatasetSuffix,
} from '../scene/assetBase.js'


const CATALOG_SCHEMA = 1
const DATASET_ID_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const STATUSES = new Set(['active', 'deprecated', 'revoked'])

export type DatasetStatus = 'active' | 'deprecated' | 'revoked'

export interface DatasetEntry {
  id: string
  label: string
  content_digest: string
  status: DatasetStatus
  game_version?: string
  variant?: string | null
  release?: string
  tank_count?: number | null
  generated?: string
  manifest_sha256?: string
  min_client?: string | null
  notes?: string
}

export interface DatasetOption {
  value: string
  label: string
  tankCount: number | null
  preview: boolean
  status: DatasetStatus
  title: string
}

export interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  datasets: DatasetEntry[]
  defaultId: string | null
  error: string | null
}

const state = ref<CatalogState>({
  status: 'idle',
  datasets: [],
  defaultId: null,
  error: null,
})

let inflight: Promise<CatalogState> | null = null
let resolvingStaleSelection = false

function validDataset(entry: unknown): entry is DatasetEntry {
  if (!entry || typeof entry !== 'object') return false
  const candidate = entry as Record<string, unknown>
  return Boolean(
    typeof candidate.id === 'string'
    && DATASET_ID_RE.test(candidate.id)
    && typeof candidate.label === 'string'
    && candidate.label
    && typeof candidate.content_digest === 'string'
    && typeof candidate.status === 'string'
    && STATUSES.has(candidate.status),
  )
}

function isCatalog(doc: unknown): doc is { schema: number; default?: unknown; datasets: unknown[] } {
  if (!doc || typeof doc !== 'object') return false
  const candidate = doc as { schema?: unknown; datasets?: unknown }
  return candidate.schema === CATALOG_SCHEMA && Array.isArray(candidate.datasets)
}

export function dataVersionUrl(href: string, id: string): string {
  const url = new URL(href)
  if (id) url.searchParams.set(DATA_VERSION_QUERY, id)
  else url.searchParams.delete(DATA_VERSION_QUERY)
  const assets = url.searchParams.get('assets')
  if (assets) {
    const stripped = stripDatasetSuffix(assets)
    if (stripped !== assets) url.searchParams.set('assets', stripped)
  }
  return url.toString()
}

function requestedDatasetId(): string {
  const base = assetOrigin()
  const origin = stripDatasetSuffix(base)
  return origin === base ? dataVersionId() ?? '' : base.slice(origin.length + '/v/'.length)
}

function persistDataset(value: string): void {
  if (value) localStorage.setItem(DATA_VERSION_STORAGE, value)
  else localStorage.removeItem(DATA_VERSION_STORAGE)
  const storedBase = localStorage.getItem(ASSET_BASE_STORAGE)
  if (storedBase && storedBase !== stripDatasetSuffix(storedBase)) {
    localStorage.setItem(ASSET_BASE_STORAGE, stripDatasetSuffix(storedBase))
  }
}

async function resolveUnlistedDataset(origin: string, requested: string, datasets: DatasetEntry[]): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/v/${requested}/version.json`, { cache: 'no-cache' })
    if (!response.ok) return response.status === 404 || response.status === 410 ? '' : null
    const stamp = await response.json()
    return datasets.find(entry => entry.id === stamp?.dataset_id && entry.status !== 'revoked')?.id ?? ''
  } catch {
    return null
  }
}

export function loadDataVersionCatalog({ force = false }: { force?: boolean } = {}): Promise<CatalogState> {
  if (inflight && !force) return inflight
  const origin = stripDatasetSuffix(assetOrigin())
  if (!origin) {
    state.value = { status: 'unavailable', datasets: [], defaultId: null, error: null }
    return Promise.resolve(state.value)
  }
  state.value = { ...state.value, status: 'loading', error: null }
  inflight = fetch(`${origin}/versions.json`, { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(`versions.json: HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    })
    .then((doc) => {
      if (!isCatalog(doc)) throw new Error('versions.json schema 不支持')
      if (!doc.datasets.every(validDataset)) throw new Error('versions.json 含非法 dataset')
      const defaultId = typeof doc.default === 'string' ? doc.default : null
      const datasets = doc.datasets.filter(validDataset)
      state.value = {
        status: 'ready',
        datasets,
        defaultId,
        error: null,
      }
      return state.value
    })
    .catch((error: unknown) => {
      state.value = {
        status: 'error',
        datasets: [],
        defaultId: null,
        error: error instanceof Error ? error.message : String(error),
      }
      return state.value
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useDataVersion() {
  if (state.value.status === 'idle') void loadDataVersionCatalog()

  const selected = ref(requestedDatasetId())
  watch(state, async (snapshot) => {
    const requested = selected.value
    if (resolvingStaleSelection || snapshot.status !== 'ready' || !requested) return
    if (snapshot.datasets.some(entry => entry.id === requested)) return
    resolvingStaleSelection = true
    const target = await resolveUnlistedDataset(stripDatasetSuffix(assetOrigin()), requested, snapshot.datasets)
    if (target === null) {
      resolvingStaleSelection = false
      return
    }
    persistDataset(target)
    location.replace(dataVersionUrl(location.href, target))
  }, { immediate: true })
  const options = computed<DatasetOption[]>(() => orderDatasetsForDisplay(state.value.datasets).map((entry) => ({
    value: entry.id,
    label: entry.label,
    tankCount: typeof entry.tank_count === 'number' ? entry.tank_count : null,
    preview: Boolean(entry.variant),
    status: entry.status,
    title: [entry.game_version, entry.variant ? `+ ${entry.variant}` : null, entry.release]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · '),
  })))
  const currentDataset = computed<DatasetEntry | null>(
    () => state.value.datasets.find((entry) => entry.id === selected.value) ?? null,
  )

  function select(id: string): void {
    const value = id && DATASET_ID_RE.test(id) ? id : ''
    persistDataset(value)
    location.assign(dataVersionUrl(location.href, value))
  }

  return {
    state,
    selected,
    options,
    currentDataset,
    select,
    reload: () => loadDataVersionCatalog({ force: true }),
  }
}
