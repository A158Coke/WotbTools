// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PRODUCTION_CATALOG from './__fixtures__/versions.production.json'

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

  it('accepts client SmartDLC slot ids with underscore and still rejects URL-unsafe ids', async () => {
    const catalog = {
      schema: 1,
      default: '11.21.0',
      datasets: [
        { id: '11.21.0', label: '11.21.0', content_digest: 'sha256:a', status: 'active' },
        { id: '11.21.0_1', label: '11.21.0_1', content_digest: 'sha256:b', status: 'active' },
        { id: '11.4.0.130', label: '超测服', content_digest: 'sha256:c', status: 'active' },
      ],
    }
    const ok = await load({ fetchImpl: vi.fn(async () => ({ ok: true, json: async () => catalog })) })
    const state = await ok.loadDataVersionCatalog()
    expect(state.status).toBe('ready')
    expect(state.datasets.map((entry) => entry.id)).toEqual(['11.21.0', '11.21.0_1', '11.4.0.130'])

    const bad = {
      ...catalog,
      datasets: [
        { id: '11.21.0', label: '11.21.0', content_digest: 'sha256:a', status: 'active' },
        { id: '11.21.0+x', label: 'bad', content_digest: 'sha256:d', status: 'active' },
      ],
    }
    const rejected = await load({ fetchImpl: vi.fn(async () => ({ ok: true, json: async () => bad })) })
    const badState = await rejected.loadDataVersionCatalog()
    expect(badState.status).toBe('error')
    expect(badState.error).toContain('非法')
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
    expect(options.value.map((option) => option.value)).toEqual(['11.21.0-t11-preview', '11.21.0'])
    expect(options.value[0].tankCount).toBe(740)
    expect(options.value[0].preview).toBe(true)
    expect(options.value[1].preview).toBe(false)
    expect(currentDataset.value.id).toBe('11.21.0-t11-preview')
  })

  it.each(['bookmark', 'saved', 'versioned origin'])('migrates an unlisted %s onto the official dataset path', async (source) => {
    const origin = 'https://dev.example.com/assets'
    const canonical = CATALOG.datasets[1].id
    const url = new URL('https://localhost/?view=agent-tankopedia&tank=42')
    if (source === 'bookmark') url.searchParams.set('data', 'superseded')
    if (source === 'versioned origin') {
      url.searchParams.set('assets', `${origin}/v/superseded`)
      url.searchParams.set('data', CATALOG.default)
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => CATALOG })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ dataset_id: canonical }) })
    const mod = await load({ origin, url: url.pathname + url.search, fetchImpl: fetchMock })
    if (source === 'saved') localStorage.setItem('wotb_data_version', 'superseded')
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    try {
      mod.useDataVersion()
      await mod.loadDataVersionCatalog()
      await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
      expect(fetchMock).toHaveBeenLastCalledWith(`${origin}/v/superseded/version.json`, { cache: 'no-cache' })
      const dest = new URL(replace.mock.calls[0][0])
      expect(dest.searchParams.get('data')).toBe(canonical)
      expect(dest.searchParams.get('tank')).toBe('42')
      expect(localStorage.getItem('wotb_data_version')).toBe(canonical)
      if (source === 'versioned origin') {
        expect(dest.searchParams.get('assets')).toBe(origin)
        expect(localStorage.getItem('wotb_asset_base')).toBe(origin)
      }
    } finally {
      replace.mockRestore()
    }
  })

  it.each([
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ ok: false, status: 503 }),
  ])('keeps the requested path and usable selector when the canonical id cannot be resolved', async (aliasResponse) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => CATALOG })
      .mockImplementationOnce(aliasResponse)
    const mod = await load({ url: '/?data=unlisted', fetchImpl: fetchMock })
    const replace = vi.spyOn(window.location, 'replace')
    try {
      const { selected } = mod.useDataVersion()
      const catalog = await mod.loadDataVersionCatalog()
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(catalog.status).toBe('ready')
      expect(selected.value).toBe('unlisted')
      expect(localStorage.getItem('wotb_data_version')).toBe('unlisted')
      expect(replace).not.toHaveBeenCalled()
    } finally {
      replace.mockRestore()
    }
  })

  it('真实生产 catalog（无 preview 字段）也用 variant 标记预览通道', async () => {
    expect('preview' in PRODUCTION_CATALOG.datasets[1]).toBe(false)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => PRODUCTION_CATALOG }))
    const mod = await load({ fetchImpl: fetchMock })
    await mod.loadDataVersionCatalog()
    const { options } = mod.useDataVersion()
    expect(options.value.map((option) => [option.value, option.preview])).toEqual([
      ['11.4.0.138-r5', true],
      ['11.21.0_1', false],
      ['11.21.0', false],
    ])
  })

  it('目录就绪后选择器才挂载：下线的持久化 id 注册即自愈回默认（watch immediate）', async () => {
    const replace = vi.fn()
    vi.spyOn(window.location, 'replace').mockImplementation(replace)
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => CATALOG })
      .mockResolvedValue({ ok: false, status: 404 })
    const mod = await load({ url: '/?localuser=1', fetchImpl: fetchMock })
    await mod.loadDataVersionCatalog()
    localStorage.setItem('wotb_data_version', 'supertest')
    const { selected } = mod.useDataVersion()
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem('wotb_data_version')).toBeNull()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain('data=supertest')
  })

  it('选择器先挂载、目录后才就绪：快照就绪同样触发自愈', async () => {
    const replace = vi.fn()
    vi.spyOn(window.location, 'replace').mockImplementation(replace)
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => CATALOG })
      .mockResolvedValue({ ok: false, status: 404 })
    const mod = await load({ url: '/?localuser=1', fetchImpl: fetchMock })
    localStorage.setItem('wotb_data_version', 'supertest')
    const { selected } = mod.useDataVersion()
    await mod.loadDataVersionCatalog()
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem('wotb_data_version')).toBeNull()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain('data=supertest')
  })

  it('strips a persisted versioned ?assets= override when selecting a dataset', async () => {
    const assign = vi.fn()
    vi.spyOn(window.location, 'assign').mockImplementation(assign)
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => CATALOG }))
    const mod = await load({ url: '/?data=11.21.0', fetchImpl: fetchMock })
    localStorage.setItem('wotb_asset_base', 'https://assets.example.com/v/11.21.0')
    await mod.loadDataVersionCatalog()
    const { select } = mod.useDataVersion()
    select('11.21.0-t11-preview')
    expect(localStorage.getItem('wotb_asset_base')).toBe('https://assets.example.com')
    expect(localStorage.getItem('wotb_data_version')).toBe('11.21.0-t11-preview')
    const target = new URL(assign.mock.calls[0][0])
    expect(target.searchParams.get('data')).toBe('11.21.0-t11-preview')
    vi.restoreAllMocks()
  })
})
