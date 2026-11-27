// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadAssetBase({ url = '/', storage = null, dataStorage = null, productionDefault = '' } = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_ASSET_BASE_URL', productionDefault)
  if (storage === null) localStorage.removeItem('wotb_asset_base')
  else localStorage.setItem('wotb_asset_base', storage)
  if (dataStorage === null) localStorage.removeItem('wotb_data_version')
  else localStorage.setItem('wotb_data_version', dataStorage)
  window.history.replaceState({}, '', url)
  return import('./assetBase.js')
}

const PROD = 'https://assets.example.com/pack'

describe('assetBase origin precedence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('falls back to the production build default when nothing else is configured', async () => {
    const { assetBase } = await loadAssetBase({ productionDefault: `${PROD}/` })
    expect(assetBase()).toBe(PROD)
  })

  it('prefers the localStorage override over the production default', async () => {
    const { assetBase } = await loadAssetBase({
      storage: 'https://override.example.com/pack',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe('https://override.example.com/pack')
  })

  it('prefers the ?assets= query parameter over localStorage and the production default', async () => {
    const { assetBase } = await loadAssetBase({
      url: '/?assets=https://query.example.com/pack',
      storage: 'https://override.example.com/pack',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe('https://query.example.com/pack')
    expect(localStorage.getItem('wotb_asset_base')).toBe('https://query.example.com/pack')
  })

  it('normalizes a trailing slash on the query parameter', async () => {
    const { assetBase } = await loadAssetBase({ url: '/?assets=https://query.example.com/pack//' })
    expect(assetBase()).toBe('https://query.example.com/pack')
  })

  it('clears a stale override when ?assets= is empty and falls back to the production default', async () => {
    const { assetBase } = await loadAssetBase({
      url: '/?assets=',
      storage: 'https://stale.example.com/pack',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe(PROD)
    expect(localStorage.getItem('wotb_asset_base')).toBeNull()
  })

  it('treats an empty production default as unconfigured', async () => {
    const nothing = await loadAssetBase()
    expect(nothing.assetBase()).toBe('')

    const emptyStorage = await loadAssetBase({ storage: '' })
    expect(emptyStorage.assetBase()).toBe('')
  })

  it('reports configured() consistently with the resolved origin', async () => {
    await loadAssetBase({ productionDefault: PROD })
    const configured = (await import('./assetProvider.js')).assetProvider
    expect(configured.configured()).toBe(true)
    expect(configured.url('/glb/1/model.glb')).toBe(`${PROD}/glb/1/model.glb`)

    await loadAssetBase()
    const unconfigured = (await import('./assetProvider.js')).assetProvider
    expect(unconfigured.configured()).toBe(false)
    expect(() => unconfigured.url('/glb/1/model.glb')).toThrow(/未配置/)
  })
})

describe('assetBase data version', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('appends an explicit ?data= dataset to the origin', async () => {
    const { assetBase } = await loadAssetBase({
      url: '/?data=11.21.0',
      productionDefault: `${PROD}/`,
    })
    expect(assetBase()).toBe(`${PROD}/v/11.21.0`)
    expect(localStorage.getItem('wotb_data_version')).toBe('11.21.0')
  })

  it('accepts client SmartDLC slot ids with underscore in ?data= and /v/ bases', async () => {
    const { assetBase, stripDatasetSuffix } = await loadAssetBase({
      url: '/?data=11.21.0_1',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe(`${PROD}/v/11.21.0_1`)
    expect(localStorage.getItem('wotb_data_version')).toBe('11.21.0_1')
    expect(stripDatasetSuffix(`${PROD}/v/11.21.0_1`)).toBe(PROD)
    expect(stripDatasetSuffix(`${PROD}/v/11.4.0.130/`)).toBe(PROD)
  })

  it('reads the persisted dataset selection when the URL has no ?data=', async () => {
    const { assetBase } = await loadAssetBase({
      dataStorage: '11.21.0-t11-preview',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe(`${PROD}/v/11.21.0-t11-preview`)
  })

  it('lets a versioned ?assets= base win over ?data=', async () => {
    const { assetBase } = await loadAssetBase({
      url: '/?assets=https://query.example.com/pack/v/11.21.0&data=11.22.0',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe('https://query.example.com/pack/v/11.21.0')
  })

  it('treats an explicit empty ?data= as default and ignores the stored selection', async () => {
    const { assetBase } = await loadAssetBase({
      url: '/?data=',
      dataStorage: '11.21.0',
      productionDefault: PROD,
    })
    expect(assetBase()).toBe(PROD)
    expect(localStorage.getItem('wotb_data_version')).toBeNull()
  })

  it('strips a dataset suffix so the selector can return to origin + ?data=', async () => {
    const { stripDatasetSuffix } = await loadAssetBase()
    expect(stripDatasetSuffix('https://assets.example.com/v/11.21.0')).toBe('https://assets.example.com')
    expect(stripDatasetSuffix('https://assets.example.com/v/11.21.0/')).toBe('https://assets.example.com')
    expect(stripDatasetSuffix('https://assets.example.com/pack')).toBe('https://assets.example.com/pack')
  })

  it('pins the effective dataset for the page lifetime (multi-tab isolation)', async () => {
    const { dataVersionId } = await loadAssetBase({
      dataStorage: '11.21.0',
      productionDefault: PROD,
    })
    expect(dataVersionId()).toBe('11.21.0')

    localStorage.setItem('wotb_data_version', 'supertest')
    expect(dataVersionId()).toBe('11.21.0')

    window.history.replaceState({}, '', '/?data=supertest')
    expect(dataVersionId()).toBe('11.21.0')
  })
})
