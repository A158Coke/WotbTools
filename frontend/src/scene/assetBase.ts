import { ANDROID_ASSET_BASE, isAndroidRuntime } from '../platform/runtime.js'

export const DATA_VERSION_QUERY = 'data'
export const DATA_VERSION_STORAGE = 'wotb_data_version'
export const ASSET_BASE_STORAGE = 'wotb_asset_base'
const DATASET_ID_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

const productionDefault = (import.meta.env.VITE_ASSET_BASE_URL ?? '').replace(/\/+$/, '')

let cachedOrigin: string | null = null
let cachedDataset: string | null | undefined

export function dataVersionId(): string | null {
  if (cachedDataset !== undefined) return cachedDataset
  cachedDataset = resolveDataVersion()
  return cachedDataset
}

export function __resetAssetBaseForTests(): void {
  cachedOrigin = null
  cachedDataset = undefined
}

function resolveDataVersion(): string | null {
  const q = searchParams().get(DATA_VERSION_QUERY)
  if (q !== null) {
    const id = DATASET_ID_RE.test(q) ? q : null
    const store = browserStorage()
    if (store) {
      if (id) store.setItem(DATA_VERSION_STORAGE, id)
      else store.removeItem(DATA_VERSION_STORAGE)
    }
    return id
  }
  const stored = browserStorage()?.getItem(DATA_VERSION_STORAGE) ?? null
  return stored && DATASET_ID_RE.test(stored) ? stored : null
}

function searchParams(): URLSearchParams {
  return new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
}

function browserStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function stripDatasetSuffix(origin: string): string {
  return origin.replace(/\/v\/[a-z0-9._-]+\/?$/, '')
}

function withDataset(origin: string): string {
  if (!origin) return ''
  if (/\/v\/[a-z0-9._-]+\/?$/.test(origin)) return origin.replace(/\/+$/, '')
  const id = dataVersionId()
  return id ? `${origin.replace(/\/+$/, '')}/v/${id}` : origin
}

export function assetOrigin(): string {
  if (isAndroidRuntime()) return ANDROID_ASSET_BASE
  if (cachedOrigin !== null) return cachedOrigin
  const q = searchParams().get('assets')
  const store = browserStorage()
  const override = q ?? store?.getItem(ASSET_BASE_STORAGE) ?? null
  const origin = (override || productionDefault).replace(/\/+$/, '')
  cachedOrigin = origin
  if (q !== null && store) {
    if (q) store.setItem(ASSET_BASE_STORAGE, origin)
    else store.removeItem(ASSET_BASE_STORAGE)
  }
  return origin
}

export function assetBase() {
  return withDataset(assetOrigin())
}

export function androidAssetBase() {
  return withDataset(ANDROID_ASSET_BASE)
}
