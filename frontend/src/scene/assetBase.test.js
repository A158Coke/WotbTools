// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 资产 origin 解析优先级（数据源接通的配置契约）：
 *   ?assets= URL 参数 > localStorage override > 生产构建默认 VITE_ASSET_BASE_URL
 *   空值逐级视为未设置，且显式 ?assets= 空会清除 localStorage override（回落到
 *   生产默认）。
 * assetBase 在模块作用域缓存结果，因此每个用例都要重置模块后动态 import。
 */
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
    // 尾部斜杠归一化：拼接方恒为 path（'/glb/...'）
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
    // 既有行为：URL 参数写回 localStorage（一次配置会话内生效）
    expect(localStorage.getItem('wotb_asset_base')).toBe('https://query.example.com/pack')
  })

  it('normalizes a trailing slash on the query parameter', async () => {
    const { assetBase } = await loadAssetBase({ url: '/?assets=https://query.example.com/pack//' })
    expect(assetBase()).toBe('https://query.example.com/pack')
  })

  it('clears a stale override when ?assets= is empty and falls back to the production default', async () => {
    // 显式空值 = 清除 override 的手段，而不是把站点置成未配置
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

    // 空 localStorage 同样回落到（空）生产默认
    const emptyStorage = await loadAssetBase({ storage: '' })
    expect(emptyStorage.assetBase()).toBe('')
  })

  it('reports configured() consistently with the resolved origin', async () => {
    await loadAssetBase({ productionDefault: PROD })
    const configured = (await import('./assetProvider.js')).assetProvider
    expect(configured.configured()).toBe(true)
    // origin 与 logical path 的拼接契约（消费方只给 path）
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
    // 显式 ?data= 与运行手册一致地持久化：下次不带查询参数仍回到该 dataset。
    expect(localStorage.getItem('wotb_data_version')).toBe('11.21.0')
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
    // 显式空 ?data= 同时清除持久化选择：下次不带查询参数也不会静默回到旧 dataset。
    expect(localStorage.getItem('wotb_data_version')).toBeNull()
  })

  it('strips a dataset suffix so the selector can return to origin + ?data=', async () => {
    const { stripDatasetSuffix } = await loadAssetBase()
    expect(stripDatasetSuffix('https://assets.example.com/v/11.21.0')).toBe('https://assets.example.com')
    expect(stripDatasetSuffix('https://assets.example.com/v/11.21.0/')).toBe('https://assets.example.com')
    expect(stripDatasetSuffix('https://assets.example.com/pack')).toBe('https://assets.example.com/pack')
  })
})
