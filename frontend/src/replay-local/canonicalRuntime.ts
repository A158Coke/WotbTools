import type { CanonicalMessage, CanonicalRequest } from './canonicalWorkerProtocol.js'
import { parseLocalPlayback, type LocalPlayback, type ParseLocalPlaybackOptions } from './playback/index.js'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'

export type CanonicalWorkerFactory = () => Worker

export class CanonicalWorkerCrash extends Error {}

const defaultFactory: CanonicalWorkerFactory = () =>
  new Worker(new URL('./canonical.worker.ts', import.meta.url), { type: 'module' })

let workerFactory: CanonicalWorkerFactory = defaultFactory

export function __setCanonicalWorkerFactory(factory: CanonicalWorkerFactory | null) {
  workerFactory = factory ?? defaultFactory
  worker?.terminate()
  worker = null
  inflight.clear()
}

let seq = 0
let worker: Worker | null = null
const inflight = new Map<number, { resolve: (v: LocalPlayback) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = workerFactory()
  } catch {
    worker = null
  }
  if (!worker) return null
  worker.onmessage = (event: MessageEvent<CanonicalMessage>) => {
    const entry = inflight.get(event.data.id)
    if (!entry) return
    inflight.delete(event.data.id)
    if (event.data.type === 'done') entry.resolve(event.data.playback)
    else entry.reject(new Error(event.data.error))
  }
  worker.onerror = () => {
    for (const entry of inflight.values()) entry.reject(new CanonicalWorkerCrash('canonical worker crashed'))
    inflight.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export async function parseLocalPlaybackOffThread(
  bytes: ArrayBuffer,
  playback?: AgentPlaybackFacet,
  options: ParseLocalPlaybackOptions = {},
): Promise<LocalPlayback> {
  const w = ensureWorker()
  if (w) {
    let posted = false
    const id = ++seq
    try {
      return await new Promise<LocalPlayback>((resolve, reject) => {
        inflight.set(id, { resolve, reject })
        const request: CanonicalRequest = { id, bytes, playback }
        w.postMessage(request)
        posted = true
      })
    } catch (error) {
      inflight.delete(id)
      if (posted && !(error instanceof CanonicalWorkerCrash)) throw error
      if (import.meta.env?.DEV) console.warn('规范投影 Worker 不可用，退回主线程:', error)
    }
  }
  const opts: ParseLocalPlaybackOptions = { ...options }
  if (playback !== undefined) opts.playback = playback
  return parseLocalPlayback(new Uint8Array(bytes), opts)
}
