import { describe, expect, it, vi } from 'vitest'

const tokenLookup = vi.hoisted(() => vi.fn(() => 'existing-token'))
const initAuth = vi.hoisted(() => vi.fn())
vi.mock('../composables/useAuth.js', () => ({ currentAuthToken: tokenLookup, initAuth }))


describe('critical client telemetry', () => {
  it('sends a fixed shape once and ignores reporting failures without retries', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network failure'))
    vi.stubGlobal('fetch', fetch)
    const { reportClientFailure } = await import('./client-events.js')
    reportClientFailure('client.wasm_load_failed', 'CLIENT_WASM_LOAD_FAILED', {}, 'verified-token')
    reportClientFailure('client.wasm_load_failed', 'CLIENT_WASM_LOAD_FAILED', {}, 'verified-token')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/observability/client-events')
    expect(JSON.parse(init.body)).toEqual({ event: 'client.wasm_load_failed', errorCode: 'CLIENT_WASM_LOAD_FAILED', platform: 'web' })
    expect(init.headers.Authorization).toBe('Bearer verified-token')
    vi.unstubAllGlobals()
  })
  it('classifies WebView auth reports and sends only bounded diagnostics', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('window', { WotbNative: { postMessage() {} } })
    const { reportClientFailure } = await import('./client-events.js')
    const clientSessionId = crypto.randomUUID()
    reportClientFailure('client.auth_login_failed', 'AUTH_LOGIN_FAILED', { stage: 'login', clientSessionId }, '')
    await new Promise(resolve => setTimeout(resolve, 0))
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toEqual({ event: 'client.auth_login_failed', errorCode: 'AUTH_LOGIN_FAILED', platform: 'android', stage: 'login', clientSessionId })
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('uses the existing bearer for generic failures without initializing authentication', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { reportClientFailure } = await import('./client-events.js')
    reportClientFailure('client.bootstrap_failed', 'CLIENT_BOOTSTRAP_FAILED')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer existing-token')
    expect(tokenLookup).toHaveBeenCalledOnce()
    expect(initAuth).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

})
