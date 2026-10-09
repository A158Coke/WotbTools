// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeSponsorConfig } from './sponsor-config.js'

/**
 * 赞助内容源是**资产面**（assetBase）：Web = 构建注入的 asset origin（生产 = 对象存储），
 * Android = 本机 `/agent-assets`（Native 直连同一对象存储）。两者都不经生产网关下发。
 * assetBase 在模块作用域缓存（android 分支除外），因此每个用例重置模块后动态 import。
 *
 * 资产面在 Android 上带能力门禁（离线时 assetProvider 直接拒绝，不发请求）。
 */
const gate = vi.hoisted(() => ({ available: true }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => gate.available }) }))

async function loadSponsorModule({ mode = 'test', assetBase = '' } = {}) {
  vi.resetModules()
  vi.stubEnv('MODE', mode)
  vi.stubEnv('VITE_ASSET_BASE_URL', assetBase)
  return import('./sponsor-config.js')
}

const CONFIG = {
  enabled: true,
  methods: [
    { type: 'alipay', image: '/sponsor-assets/alipay.png' },
    { type: 'wechat', image: '/sponsor-assets/wechat.webp' }
  ]
}

beforeEach(() => {
  gate.available = true
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.clear()
})

describe('normalizeSponsorConfig', () => {
  it('accepts supported methods with server-relative image paths', () => {
    expect(normalizeSponsorConfig(CONFIG)).toEqual([
      { type: 'alipay', image: '/sponsor-assets/alipay.png' },
      { type: 'wechat', image: '/sponsor-assets/wechat.webp' }
    ])
  })

  it.each([
    null,
    [],
    {},
    { enabled: false, methods: [] },
    { enabled: true, methods: 'invalid' },
    { enabled: true, methods: [{ type: 'alipay', image: '/sponsor-assets/../secret.png' }] },
    { enabled: true, methods: [{ type: 'card', image: '/sponsor-assets/card.png' }] },
    {
      enabled: true,
      methods: [
        { type: 'alipay', image: '/sponsor-assets/alipay.png' },
        { type: 'alipay', image: '/sponsor-assets/duplicate.png' }
      ]
    }
  ])('rejects disabled or malformed config %#', (config) => {
    expect(normalizeSponsorConfig(config)).toEqual([])
  })
})

describe('loadSponsorMethods', () => {
  it('fetches config and QR images from the configured asset origin without caching', async () => {
    const { loadSponsorMethods } = await loadSponsorModule({ assetBase: 'https://assets.example.com' })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => CONFIG })

    await expect(loadSponsorMethods(fetchImpl)).resolves.toEqual([
      { type: 'alipay', image: 'https://assets.example.com/sponsor-assets/alipay.png' },
      { type: 'wechat', image: 'https://assets.example.com/sponsor-assets/wechat.webp' }
    ])
    expect(fetchImpl).toHaveBeenCalledWith('https://assets.example.com/sponsor-config.json', { cache: 'no-store' })
  })

  it('reads the same object storage through the local Android asset path', async () => {
    const { loadSponsorMethods } = await loadSponsorModule({ mode: 'android' })
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => CONFIG })

    // APK 本地 origin 只有 bundle：`/agent-assets` 由 Native AgentAssetProxy 直连对象存储。
    await expect(loadSponsorMethods(fetchImpl)).resolves.toEqual([
      { type: 'alipay', image: '/agent-assets/sponsor-assets/alipay.png' },
      { type: 'wechat', image: '/agent-assets/sponsor-assets/wechat.webp' }
    ])
    expect(fetchImpl).toHaveBeenCalledWith('/agent-assets/sponsor-config.json', { cache: 'no-store' })
  })

  it('falls back to no methods when no asset origin is configured', async () => {
    const { loadSponsorMethods } = await loadSponsorModule()
    const fetchImpl = vi.fn()

    await expect(loadSponsorMethods(fetchImpl)).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not attempt the object storage while the Android asset plane is unavailable', async () => {
    gate.available = false
    const { loadSponsorMethods } = await loadSponsorModule({ mode: 'android' })
    const fetchImpl = vi.fn()

    await expect(loadSponsorMethods(fetchImpl)).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back to no methods when loading fails', async () => {
    const { loadSponsorMethods } = await loadSponsorModule({ assetBase: 'https://assets.example.com' })
    await expect(loadSponsorMethods(vi.fn().mockRejectedValue(new Error('offline')))).resolves.toEqual([])
  })

  it('falls back to no methods when the object is missing', async () => {
    const { loadSponsorMethods } = await loadSponsorModule({ assetBase: 'https://assets.example.com' })
    await expect(loadSponsorMethods(vi.fn().mockResolvedValue({ ok: false, status: 404 }))).resolves.toEqual([])
  })
})
