/// <reference lib="webworker" />
import { loadAgentWasmModule } from '../api/agent-replay-facets.js'

export type PlaybackParseKind = 'playback' | 'recorder-camera'
export interface PlaybackParseRequest { id: number; kind?: PlaybackParseKind; bytes: ArrayBuffer; limitsJson?: string; diagnostics?: boolean }
export interface PlaybackParseDiagnostics { wasmReadyMs: number; parseMs: number }
export type PlaybackParseResponse =
  | { id: number; json: string; error?: undefined; diagnostics?: PlaybackParseDiagnostics }
  | { id: number; json?: undefined; error: string; diagnostics?: PlaybackParseDiagnostics }

const post = (message: PlaybackParseResponse) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<PlaybackParseRequest>) => {
  const { id, kind, bytes, limitsJson, diagnostics } = event.data
  const start = diagnostics ? performance.now() : 0
  try {
    const mod = await loadAgentWasmModule()
    const ready = diagnostics ? performance.now() : 0
    if (kind === 'recorder-camera') {
      if (typeof mod.parseRecorderCamera !== 'function') {
        throw new Error('agent wasm: parseRecorderCamera 缺失（产物版本早于 v0.4.21）')
      }
      const json = mod.parseRecorderCamera(new Uint8Array(bytes))
      post({ id, json, ...(diagnostics ? { diagnostics: { wasmReadyMs: ready - start, parseMs: performance.now() - ready } } : {}) })
      return
    }
    if (typeof mod.parsePlayback !== 'function') {
      throw new Error('agent wasm: parsePlayback 缺失（产物版本早于契约 v2）')
    }
    const json = mod.parsePlayback(new Uint8Array(bytes), undefined, limitsJson || undefined)
    post({ id, json, ...(diagnostics ? { diagnostics: { wasmReadyMs: ready - start, parseMs: performance.now() - ready } } : {}) })
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
