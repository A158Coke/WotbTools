import { describe, expect, it, vi } from 'vitest'

const wasm = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../api/agent-replay-facets.js', () => ({ loadAgentWasmModule: wasm.load }))

describe('playback parse worker diagnostics', () => {
  it('returns optional timings without changing the JSON response', async () => {
    const postMessage = vi.fn()
    const worker = { postMessage, onmessage: null }
    vi.stubGlobal('self', worker)
    wasm.load.mockResolvedValue({ parsePlayback: () => '{"version":2}' })
    await import('./playbackParse.worker.js')
    await worker.onmessage({ data: { id: 1, bytes: new ArrayBuffer(1), diagnostics: true } })
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 1, json: '{"version":2}',
      diagnostics: { wasmReadyMs: expect.any(Number), parseMs: expect.any(Number) },
    }))
    await worker.onmessage({ data: { id: 2, bytes: new ArrayBuffer(1) } })
    expect(postMessage).toHaveBeenLastCalledWith({ id: 2, json: '{"version":2}' })
    vi.unstubAllGlobals()
  })
})
