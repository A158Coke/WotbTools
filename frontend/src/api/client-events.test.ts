import { describe, expect, it, vi } from 'vitest'

vi.mock('../composables/useAuth.js', () => ({ useAuth: () => ({ token: () => 'verified-token' }) }))

describe('critical client telemetry', () => {
  it('sends a fixed shape once and ignores reporting failures without retries', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network failure'))
    vi.stubGlobal('fetch', fetch)
    const { reportClientFailure } = await import('./client-events.js')
    reportClientFailure('client.wasm_load_failed', 'CLIENT_WASM_LOAD_FAILED')
    reportClientFailure('client.wasm_load_failed', 'CLIENT_WASM_LOAD_FAILED')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/observability/client-events')
    expect(JSON.parse(init.body)).toEqual({ event: 'client.wasm_load_failed', errorCode: 'CLIENT_WASM_LOAD_FAILED', platform: 'web' })
    expect(init.headers.Authorization).toBe('Bearer verified-token')
    vi.unstubAllGlobals()
  })
})
