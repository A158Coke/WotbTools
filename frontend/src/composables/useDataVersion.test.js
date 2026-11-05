// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 数据版本选择器的契约：
 *   - ?data=<id> 写/删与 ?assets= 完整版本基址的剥离（dataVersionUrl 纯函数）
 *   - versions.json 的加载/校验/错误状态
 *   - 选项映射（label / tank_count / preview / status）
 */
async function load({ url = '/', origin = 'https://assets.example.com', fetchImpl = null } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_ASSET_BASE_URL', origin)
  localStorage.clear()
  window.history.replaceState({}, '', url)
  if (fetchImpl) vi.stubGlobal('fetch', fetchImpl)
  return import('./useDataVersion.js')
}

const CATALOG = {
  schema: 1,
  updated: '2026-11-05T00:00:00+00:00',
  default: '11.21.0',
  datasets: [
    {
      id: '11.21.0',
      label: '11.21.0',
      game_version: 'release/11.21.0',
      variant: null,
      release: '20261101-aaaaaaaa',
      tank_count: 738,
      generated: '2026-11-01T00:00:00+00:00',
      content_digest: 'sha256:aaa',
      manifest_sha256: 'bbb',
      status: 'active',
      preview: null,
    },
    {
      id: '11.21.0-t11-preview',
      label: '11.21.0 + Tier XI 预览',
      game_version: 'release/11.21.0',
      variant: 't11-preview',
      release: '20261104-bbbbbbbb',
      tank_count: 740,
      generated: '2026-11-04T00:00:00+00:00',
      content_digest: 'sha256:ccc',
      manifest_sha256: 'ddd',
      status: 'active',
      preview: { client_version: '11.22_supertest_tier11_4' },
    },
  ],
}

describe('useDataVersion', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('dataVersionUrl sets, removes and keeps other query parameters', async () => {
    const { dataVersionUrl } = await load()
    const set = new URL(dataVersionUrl('https://a/?view=replay&data=11.21.0', '11.22.0'))
    expect(set.searchParams.get('view')).toBe('replay')
    expect(set.searchParams.get('data')).toBe('11.22.0')

    const reset = new URL(dataVersionUrl('https://a/?view=replay&data=11.21.0', ''))
    expect(reset.searchParams.get('view')).toBe('replay')
    expect(reset.searchParams.has('data')).toBe(false)
  })

  it('strips a versioned ?assets= base when switching back to ?data=', async () => {
    const { dataVersionUrl } = await load()
    const url = new URL(dataVersionUrl(
      'https://a/?assets=https://assets.example.com/v/11.21.0&data=11.21.0',
      '11.22.0',
    ))
    expect(url.searchParams.get('assets')).toBe('https://assets.example.com')
    expect(url.searchParams.get('data')).toBe('11.22.0')
  })

  it('loads and validates versions.json', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const { loadDataVersionCatalog } = await load({ fetchImpl: fetchMock })
    const state = await loadDataVersionCatalog()
    expect(fetchMock).toHaveBeenCalledWith('https://assets.example.com/versions.json', { cache: 'no-cache' })
    expect(state.status).toBe('ready')
    expect(state.defaultId).toBe('11.21.0')
    expect(state.datasets.map((entry) => entry.id)).toEqual(['11.21.0', '11.21.0-t11-preview'])
  })

  it('strips a versioned ?assets= base before fetching the catalog', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const { loadDataVersionCatalog } = await load({
      url: '/?assets=https://assets.example.com/v/11.21.0',
      fetchImpl: fetchMock,
    })
    await loadDataVersionCatalog()
    expect(fetchMock).toHaveBeenCalledWith('https://assets.example.com/versions.json', { cache: 'no-cache' })
  })

  it('surfaces a schema error instead of silently accepting a bad catalog', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ schema: 2, datasets: [] }) }))
    const { loadDataVersionCatalog } = await load({ fetchImpl: fetchMock })
    const state = await loadDataVersionCatalog()
    expect(state.status).toBe('error')
    expect(state.datasets).toEqual([])
    expect(state.error).toContain('schema')
  })

  it('is unavailable without an asset origin and never calls fetch', async () => {
    const fetchMock = vi.fn()
    const { loadDataVersionCatalog } = await load({ origin: '', fetchImpl: fetchMock })
    const state = await loadDataVersionCatalog()
    expect(state.status).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps catalog entries to selector options and resolves the selected dataset', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const mod = await load({ url: '/?data=11.21.0-t11-preview', fetchImpl: fetchMock })
    await mod.loadDataVersionCatalog()
    const { options, selected, currentDataset } = mod.useDataVersion()
    expect(selected.value).toBe('11.21.0-t11-preview')
    expect(options.value.map((option) => option.value)).toEqual(['11.21.0', '11.21.0-t11-preview'])
    expect(options.value[1].tankCount).toBe(740)
    expect(options.value[1].preview).toBe(true)
    expect(currentDataset.value.id).toBe('11.21.0-t11-preview')
  })
})