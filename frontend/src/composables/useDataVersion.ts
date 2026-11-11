import { computed, ref } from 'vue'
import {
  ASSET_BASE_STORAGE,
  DATA_VERSION_QUERY,
  DATA_VERSION_STORAGE,
  assetOrigin,
  dataVersionId,
  stripDatasetSuffix,
} from '../scene/assetBase.js'

/**
 * 数据版本（dataset）选择器状态。
 *
 * 目录来自资产 origin 的 `/versions.json`（WoT-Blitz-Agent `tools/asset_release.py catalog`
 * 生成）。选择结果写进 URL `?data=<id>` 与 localStorage，并**整页重载**——资产 provider、
 * 场景与 map2d 的模块级缓存在加载时按当前基址固化，重载是唯一不会留下旧 dataset 状态的
 * 切换方式（也避免每个消费方各写一套 reset）。
 *
 * 选择 `''` = 默认：删除 ?data=，回到 origin 根路径（服务端 current / versions.json.default）。
 */

const CATALOG_SCHEMA = 1
// `_` 供客户端 SmartDLC 槽位命名（s11.21.0_1.yaml → 11.21.0_1）；与 Agent 仓 asset_release.py 同款契约。
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

/** 共享给 MorePage / MorePanel / ReplayWorkspace 的目录状态（同一页面只拉一次）。 */
const state = ref<CatalogState>({
  status: 'idle',
  datasets: [],
  defaultId: null,
  error: null,
})

let inflight: Promise<CatalogState> | null = null

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

/** 纯函数：切换 dataset 后的目标 URL（保留其它查询参数）。 */
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
      state.value = {
        status: 'ready',
        datasets: doc.datasets.filter(validDataset),
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

  const selected = ref<string>(dataVersionId() ?? '')
  const options = computed<DatasetOption[]>(() => state.value.datasets.map((entry) => ({
    value: entry.id,
    label: entry.label,
    tankCount: typeof entry.tank_count === 'number' ? entry.tank_count : null,
    // Agent 的 collect_datasets 不输出 version.json.preview；预览通道以 catalog 的
    // variant 标记（stamp --variant），消费方只用真实存在的字段。
    preview: Boolean(entry.variant),
    status: entry.status,
    title: [entry.game_version, entry.variant ? `+ ${entry.variant}` : null, entry.release]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' · '),
  })))
  const currentDataset = computed<DatasetEntry | null>(
    () => state.value.datasets.find((entry) => entry.id === selected.value) ?? null,
  )

  /** 切换并重载；id 为空 = 默认。 */
  function select(id: string): void {
    const value = id && DATASET_ID_RE.test(id) ? id : ''
    if (value) localStorage.setItem(DATA_VERSION_STORAGE, value)
    else localStorage.removeItem(DATA_VERSION_STORAGE)
    // 持久化的 ?assets= override 若还带着旧 dataset 段（如曾访问
    // ?assets=https://origin/v/11.21.0），必须同步剥掉：否则重载后 withDataset
    // 走 escape hatch 原样使用旧 /v/<id>，选择器显示新 dataset、资产却仍从旧
    // dataset 取（review 复现案例）。URL 上的 assets 参数由 dataVersionUrl 剥。
    const storedBase = localStorage.getItem(ASSET_BASE_STORAGE)
    if (storedBase) {
      const stripped = stripDatasetSuffix(storedBase)
      if (stripped !== storedBase) localStorage.setItem(ASSET_BASE_STORAGE, stripped)
    }
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