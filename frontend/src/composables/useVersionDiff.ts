import { ref } from 'vue'
import { assetOrigin, stripDatasetSuffix } from '../scene/assetBase.js'
import { matchingTopConfig } from '../components/version-diff/versionDiffParameterRows.js'

/**
 * 版本变更页的静态 diff 数据源。
 *
 * 目录：`<asset origin>/diffs/index.json`（WoT-Blitz-Agent `tools/version_diff.py`
 * 生成）；逐对明细在 `diffs/<pair.path>/summary.json` 与 `tanks|maps/<id>.json`。
 * 与 `useDataVersion` 一样，目录只拉一次；pair 文件本身不可变，打开弹窗时再取。
 */
const CATALOG_SCHEMA = 1

export interface DiffPairSide { dataset: string; release?: string; label?: string; [key: string]: unknown }
export interface DiffPair {
  id: string
  path: string
  from: DiffPairSide
  to: DiffPairSide
  counts: Record<string, unknown>
  [key: string]: unknown
}
export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface CatalogState { status: CatalogStatus; pairs: DiffPair[]; error: string | null }

const state = ref<CatalogState>({ status: 'idle', pairs: [], error: null })
let inflight: Promise<CatalogState> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function diffOrigin() {
  const origin = stripDatasetSuffix(assetOrigin())
  if (!origin) throw new Error('asset origin is not configured')
  return origin
}

export function datasetAssetUrl(datasetId: string, path: string) {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${diffOrigin()}/v/${encodeURIComponent(datasetId)}${suffix}`
}

// 版本对比必须按「对比目标 dataset」取图，不能走当前选中 dataset 的 assetProvider。
export function datasetTankImageUrl(datasetId: string, tankId: string | number) {
  return `${diffOrigin()}/v/${encodeURIComponent(datasetId)}/tank_images/${encodeURIComponent(tankId)}.webp`
}

export function datasetMap2dUrl(datasetId: string, key: string) {
  return `${diffOrigin()}/v/${encodeURIComponent(datasetId)}/map2d/${encodeURIComponent(key)}.webp`
}

export function datasetCoverUrl(datasetId: string, key: string) {
  return `${diffOrigin()}/v/${encodeURIComponent(datasetId)}/cover/${encodeURIComponent(key)}.webp`
}

export function pairAssetUrl(pair: { path?: string } | null | undefined, rel: string) {
  const path = String(pair?.path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `${diffOrigin()}/diffs/${path}/${rel}`
}

function releaseStamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function validPair(pair: unknown): pair is DiffPair {
  if (!isRecord(pair) || !isRecord(pair.from) || !isRecord(pair.to)) return false
  return typeof pair.id === 'string'
    && typeof pair.from.dataset === 'string'
    && typeof pair.to.dataset === 'string'
    // 与 Android 门禁同一口径：release 必须是两侧的非空字符串；缺省时 undefined===undefined
    // 会让目录与 summary 的身份校验互相「对上」，旧数据就能冒充当前版本。
    && releaseStamp(pair.from.release)
    && releaseStamp(pair.to.release)
    && typeof pair.path === 'string'
    && isRecord(pair.counts)
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

export function loadVersionDiffCatalog({ force = false }: { force?: boolean } = {}): Promise<CatalogState> {
  if (state.value.status === 'ready' && !force) return Promise.resolve(state.value)
  if (inflight && !force) return inflight
  state.value = { ...state.value, status: 'loading', error: null }
  let url: string
  try {
    url = `${diffOrigin()}/diffs/index.json`
  } catch (error) {
    state.value = {
      status: 'error',
      pairs: [],
      error: error instanceof Error ? error.message : String(error),
    }
    return Promise.resolve(state.value)
  }
  inflight = fetchJson(url)
    .then((doc) => {
      if (!isRecord(doc) || doc.schema !== CATALOG_SCHEMA || !Array.isArray(doc.pairs)) {
        throw new Error('diffs/index.json schema 不支持')
      }
      const rawPairs = doc.pairs as unknown[]
      const pairs = rawPairs.filter(validPair)
      if (pairs.length !== rawPairs.length) throw new Error('diffs/index.json 含非法 pair')
      state.value = { status: 'ready', pairs, error: null }
      return state.value
    })
    .catch((error) => {
      state.value = {
        status: 'error',
        pairs: [],
        error: error instanceof Error ? error.message : String(error),
      }
      return state.value
    })
    .finally(() => { inflight = null })
  return inflight
}

export function fetchPairSummary(pair: DiffPair): Promise<Record<string, unknown>> {
  return fetchJson(pairAssetUrl(pair, 'summary.json')).then((summary) => {
    if (!isRecord(summary) || summary.schema !== CATALOG_SCHEMA) throw new Error('summary.json schema 不支持')
    // 目录与 summary 的版本身份必须一致：旧 summary 落在新 pair 路径下时 fail-closed，
    // 否则页面会把上一组数据的差异当成当前版本的变更展示。
    const meta = isRecord(summary.pair) ? summary.pair : null
    for (const side of ['from', 'to'] as const) {
      const stamped = meta && isRecord(meta[side]) ? meta[side] as Record<string, unknown> : null
      const expected = pair[side]
      if (!stamped || stamped.dataset !== expected.dataset || stamped.release !== expected.release) {
        throw new Error(`summary.json ${side} 版本身份与目录不一致`)
      }
    }
    return summary
  })
}

export function fetchDatasetParamsFormat(datasetId: string): Promise<Record<string, unknown> | null> {
  return fetchJson(datasetAssetUrl(datasetId, '/research/params/format.json'))
    .then(data => isRecord(data) && isRecord(data.params) ? data.params : null)
}

export function fetchDatasetTankCrops(datasetId: string): Promise<Record<string, unknown>> {
  return fetchJson(datasetAssetUrl(datasetId, '/tank_images/crops.json'))
    .then(data => (isRecord(data) && isRecord(data.icons) ? data.icons : {}))
}

export function datasetTankModelUrl(datasetId: string, path: unknown) {
  if (typeof path !== 'string' || !/^\/glb\/[0-9]+\/(collision|model)\.glb$/.test(path)) {
    throw new Error('Missing or invalid tank model path')
  }
  return datasetAssetUrl(datasetId, path)
}

export function fetchDatasetTank(datasetId: string, tankId: string | number): Promise<unknown> {
  return fetchJson(datasetAssetUrl(datasetId, '/tank/' + encodeURIComponent(tankId) + '.json'))
}

export async function fetchMatchingTopConfig(pair: DiffPair, tankId: number) {
  type Profile = { configs?: Parameters<typeof matchingTopConfig>[0] }
  const [before, after] = await Promise.all([
    fetchDatasetTank(pair.from.dataset, tankId),
    fetchDatasetTank(pair.to.dataset, tankId),
  ]) as [Profile | null, Profile | null]
  return matchingTopConfig(before?.configs, after?.configs)
}

export function fetchTankDiff(pair: DiffPair, tankId: string | number): Promise<unknown> {
  return fetchJson(pairAssetUrl(pair, `tanks/${tankId}.json`))
}

export function fetchMapDiff(pair: DiffPair, mapId: string | number): Promise<unknown> {
  return fetchJson(pairAssetUrl(pair, `maps/${mapId}.json`))
}

export function __resetVersionDiffForTests() {
  state.value = { status: 'idle', pairs: [], error: null }
  inflight = null
}

export { state as versionDiffCatalogState }