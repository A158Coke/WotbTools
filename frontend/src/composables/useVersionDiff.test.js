// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://assets.example.com'

const INDEX = {
  schema: 1,
  pairs: [
    {
      id: '11.21.0_1__11.22.0',
      from: { dataset: '11.21.0_1', release: '20261120-aaaa' },
      to: { dataset: '11.22.0', release: '20261126-bbbb' },
      path: '11.21.0_1__11.22.0/20261120-aaaa__20261126-bbbb',
      counts: { tanks: { added: 3, removed: 0, changed: 19 }, maps: { changed: 36 } },
    },
  ],
}

async function load({ url = '/', origin = ORIGIN, fetchImpl = null } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_ASSET_BASE_URL', origin)
  localStorage.clear()
  window.history.replaceState({}, '', url)
  if (fetchImpl) vi.stubGlobal('fetch', fetchImpl)
  return import('./useVersionDiff.js')
}

function catalogFetch(doc = INDEX) {
  return vi.fn(async () => ({ ok: true, json: async () => doc }))
}

describe('useVersionDiff', () => {
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

  it('builds dataset and pair asset urls from the asset origin', async () => {
    const {
      datasetAssetUrl, datasetCoverUrl, datasetMap2dUrl, datasetTankImageUrl, pairAssetUrl,
    } = await load()
    expect(datasetAssetUrl('11.21.0_1', '/tank_images/42.webp'))
      .toBe(`${ORIGIN}/v/11.21.0_1/tank_images/42.webp`)
    expect(datasetAssetUrl('11.22.0', 'tank_images/42.webp'))
      .toBe(`${ORIGIN}/v/11.22.0/tank_images/42.webp`)
    expect(datasetTankImageUrl('11.21.0_1', 42))
      .toBe(`${ORIGIN}/v/11.21.0_1/tank_images/42.webp`)
    expect(datasetMap2dUrl('11.22.0', 'karelia'))
      .toBe(`${ORIGIN}/v/11.22.0/map2d/karelia.webp`)
    expect(datasetCoverUrl('11.22.0', 'karelia'))
      .toBe(`${ORIGIN}/v/11.22.0/cover/karelia.webp`)
    expect(pairAssetUrl(INDEX.pairs[0], 'summary.json'))
      .toBe(`${ORIGIN}/diffs/11.21.0_1__11.22.0/20261120-aaaa__20261126-bbbb/summary.json`)
  })

  it('strips a versioned ?assets= origin before building urls', async () => {
    const { datasetAssetUrl, diffOrigin } = await load({
      url: `/?assets=${ORIGIN}/v/11.21.0`,
    })
    expect(diffOrigin()).toBe(ORIGIN)
    expect(datasetAssetUrl('11.22.0', '/map2d/karelia.webp'))
      .toBe(`${ORIGIN}/v/11.22.0/map2d/karelia.webp`)
  })

  it('loads and validates the catalog once, then serves it from cache', async () => {
    const fetchMock = catalogFetch()
    const { loadVersionDiffCatalog, versionDiffCatalogState } = await load({ fetchImpl: fetchMock })

    const state = await loadVersionDiffCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/diffs/index.json`, { cache: 'no-cache' })
    expect(state.status).toBe('ready')
    expect(state.pairs.map(pair => pair.id)).toEqual(['11.21.0_1__11.22.0'])
    expect(versionDiffCatalogState.value).toBe(state)

    await loadVersionDiffCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetches the catalog when forced', async () => {
    const fetchMock = catalogFetch()
    const { loadVersionDiffCatalog } = await load({ fetchImpl: fetchMock })
    await loadVersionDiffCatalog()
    await loadVersionDiffCatalog({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an unsupported catalog schema instead of treating it as empty', async () => {
    const fetchMock = catalogFetch({ schema: 2, pairs: [] })
    const { loadVersionDiffCatalog } = await load({ fetchImpl: fetchMock })
    const state = await loadVersionDiffCatalog()
    expect(state.status).toBe('error')
    expect(state.pairs).toEqual([])
    expect(state.error).toContain('schema')
  })

  it('rejects a pair missing its dataset, path or counts', async () => {
    const bad = {
      schema: 1,
      pairs: [{ id: 'p', from: { dataset: 'a' }, to: { dataset: 'b' }, path: 'p', counts: null }],
    }
    const { loadVersionDiffCatalog } = await load({ fetchImpl: catalogFetch(bad) })
    const state = await loadVersionDiffCatalog()
    expect(state.status).toBe('error')
    expect(state.error).toContain('非法')
  })

  it('surfaces HTTP errors without wedging the loader', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 }))
    const { loadVersionDiffCatalog } = await load({ fetchImpl: fetchMock })
    const state = await loadVersionDiffCatalog()
    expect(state.status).toBe('error')
    expect(state.error).toContain('HTTP 503')

    const retry = vi.fn(async () => ({ ok: true, json: async () => INDEX }))
    vi.stubGlobal('fetch', retry)
    const again = await loadVersionDiffCatalog()
    expect(again.status).toBe('ready')
  })

  it('fetches per-pair summary, tank and map documents by relative path', async () => {
    const docs = {
      [`${ORIGIN}/diffs/11.21.0_1__11.22.0/20261120-aaaa__20261126-bbbb/summary.json`]: { schema: 1, tanks: [] },
      [`${ORIGIN}/diffs/11.21.0_1__11.22.0/20261120-aaaa__20261126-bbbb/tanks/42.json`]: { tankId: 42 },
      [`${ORIGIN}/diffs/11.21.0_1__11.22.0/20261120-aaaa__20261126-bbbb/maps/7.json`]: { mapId: 7 },
    }
    const fetchMock = vi.fn(async url => ({ ok: true, json: async () => docs[url] }))
    const { fetchPairSummary, fetchTankDiff, fetchMapDiff } = await load({ fetchImpl: fetchMock })

    await expect(fetchPairSummary(INDEX.pairs[0])).resolves.toEqual({ schema: 1, tanks: [] })
    await expect(fetchTankDiff(INDEX.pairs[0], 42)).resolves.toEqual({ tankId: 42 })
    await expect(fetchMapDiff(INDEX.pairs[0], 7)).resolves.toEqual({ mapId: 7 })
  })

  it('fetches per-version tank documents and crop metadata for the comparison viewer', async () => {
    const docs = {
      [`${ORIGIN}/v/11.22.0/tank/16257.json`]: { tankId: 16257, armor_model: { hull: { plates: { 1: 50 } } } },
      [`${ORIGIN}/v/11.21.0_1/tank_images/crops.json`]: { icons: { 16257: { canvas_w: 256, x: 0, y: 0, w: 200, h: 90 } } },
      [`${ORIGIN}/v/11.22.0/tank_images/crops.json`]: { note: 'no icons block' },
    }
    const fetchMock = vi.fn(async url => ({ ok: true, json: async () => docs[url] }))
    const { fetchDatasetTank, fetchDatasetTankCrops } = await load({ fetchImpl: fetchMock })

    await expect(fetchDatasetTank('11.22.0', 16257)).resolves.toMatchObject({ tankId: 16257 })
    expect(fetchMock).toHaveBeenCalledWith(`${ORIGIN}/v/11.22.0/tank/16257.json`, { cache: 'no-cache' })
    await expect(fetchDatasetTankCrops('11.21.0_1')).resolves.toEqual({
      16257: { canvas_w: 256, x: 0, y: 0, w: 200, h: 90 },
    })
    await expect(fetchDatasetTankCrops('11.22.0')).resolves.toEqual({})
  })

  it('only hands pack-relative collision/model paths to the armor comparison viewer', async () => {
    const { datasetTankModelUrl } = await load()
    expect(datasetTankModelUrl('11.22.0', '/glb/16257/collision.glb'))
      .toBe(`${ORIGIN}/v/11.22.0/glb/16257/collision.glb`)
    expect(datasetTankModelUrl('11.22.0', '/glb/16257/model.glb'))
      .toBe(`${ORIGIN}/v/11.22.0/glb/16257/model.glb`)
    for (const bad of [undefined, '', '/tank/16257.json', '/glb/16257/other.glb', '/glb/x/collision.glb',
      '/glb/16257/collision.glb?x=1', 'https://evil.example.com/glb/1/collision.glb']) {
      expect(() => datasetTankModelUrl('11.22.0', bad), String(bad)).toThrow('model path')
    }
  })

  it('rejects a summary with an unsupported schema', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ schema: 9 }) }))
    const { fetchPairSummary } = await load({ fetchImpl: fetchMock })
    await expect(fetchPairSummary(INDEX.pairs[0])).rejects.toThrow('schema')
  })

  it('fails closed when no asset origin is configured', async () => {
    const fetchMock = vi.fn()
    const { loadVersionDiffCatalog } = await load({ origin: '', fetchImpl: fetchMock })
    const state = await loadVersionDiffCatalog()
    expect(state.status).toBe('error')
    expect(state.error).toContain('asset origin')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})