// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANDROID_APP_ORIGIN, ANDROID_ASSET_BASE, PRODUCTION_API_ORIGIN, resolveApiUrl } from './runtime.js'
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { assetProvider } from '../scene/assetProvider.js'
import { apiFetch } from '../utils/http.js'

const gate = vi.hoisted(() => ({ available: true }))
vi.mock('../composables/useFeatureGate.js', () => ({ useFeatureGate: () => ({ requireFeature: () => gate.available }) }))
afterEach(() => { gate.available = true; vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('Android local resource / remote service boundary', () => {
  it('preserves Web same-origin requests', () => {
    vi.stubEnv('MODE', 'production')
    expect(resolveApiUrl('/api/hof')).toBe('/api/hof')
  })
  it('resolves all service paths but keeps parser, icons and 2D resources local', async () => {
    vi.stubEnv('MODE', 'android')
    expect(resolveApiUrl('/api/ai/reviews')).toBe(`${PRODUCTION_API_ORIGIN}/api/ai/reviews`)
    expect(resolveApiUrl('/download/android/version.json')).toBe(`${PRODUCTION_API_ORIGIN}/download/android/version.json`)
    for (const path of ['/assets/chunk.js', '/wasm/ref/parser.wasm', '/maps/map.png', '/__native/replay-pending']) expect(resolveApiUrl(path)).toBe(path)
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetch)
    await apiFetch('/api/hof', { headers: { Authorization: 'Bearer native-token' }, credentials: 'include' })
    expect(fetch).toHaveBeenCalledWith(`${PRODUCTION_API_ORIGIN}/api/hof`, { headers: { Authorization: 'Bearer native-token' }, credentials: 'omit' })
    // A missing bridge in a packaged runtime must never select WebView Keycloak.
    expect(isAndroidApp()).toBe(true)
    expect(ANDROID_APP_ORIGIN).toBe('https://appassets.androidplatform.net')
    // 3D 资产是本机路径（same-origin），由 Native AgentAssetProxy 直连对象存储——
    // 一旦这里变成远程 origin，WebView fetch 会被桶 CORS 拦截（白名单不含本 origin）。
    expect(ANDROID_ASSET_BASE).toBe('/agent-assets')
  })
  it('rejects AI, HoF, Profile, Admin Users and previously resolved 3D assets before dispatch when offline', async () => {
    vi.stubEnv('MODE', 'android')
    const url = assetProvider.url('/index.json')
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    gate.available = false
    for (const path of [
      '/api/ai/reviews',
      '/api/hof',
      '/api/users/profile',
      // Admin Users 是 ONLINE_REQUIRED：列表与详情/删除都不允许在非-online 时离开设备。
      '/api/admin/users',
      '/api/admin/users/kc-a',
    ]) {
      await expect(apiFetch(path)).rejects.toMatchObject({ errorCode: 'NETWORK_ERROR' })
    }
    expect(() => assetProvider.fetch(url)).toThrow('NETWORK_ERROR')
    expect(fetch).not.toHaveBeenCalled()
  })

})
