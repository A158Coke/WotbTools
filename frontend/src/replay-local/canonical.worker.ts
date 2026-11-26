/// <reference lib="webworker" />
import { parseLocalPlayback } from './playback/index.js'
import type { CanonicalMessage, CanonicalRequest } from './canonicalWorkerProtocol.js'

const post = (message: CanonicalMessage) => (self as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<CanonicalRequest>) => {
  const { id, bytes, playback } = event.data
  try {
    const result = await parseLocalPlayback(new Uint8Array(bytes), { playback })
    post({ type: 'done', id, playback: result })
  } catch (error) {
    post({ type: 'error', id, error: error instanceof Error ? error.message : String(error) })
  }
}
