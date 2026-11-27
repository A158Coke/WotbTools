
import type { GroundGeometryData } from '../groundGeometryData.js'
export type { GroundGeometryData }

export interface TerrainBuildRequest {
  cam: { x: number; y: number; z: number }
  fovY: number
  aspect: number
  hFovDeg: number | null
  includeNormals?: boolean
  measure: boolean
}
export interface TerrainSourceInit {
  field: Float32Array; n: number; span: number; cx: number; cz: number; refineMask: unknown
}
export type TerrainWorkerIn =
  | ({ type: 'init' } & TerrainSourceInit)
  | { type: 'mask'; refineMask: unknown }
  | ({ type: 'build'; id: number } & TerrainBuildRequest)
export type TerrainWorkerOut =
  | { type: 'built'; id: number; data: GroundGeometryData; workerMs: number }
  | { type: 'error'; id: number; message: string }

export interface TerrainWorkerLike {
  postMessage(msg: TerrainWorkerIn, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((ev: { data: TerrainWorkerOut }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface TerrainLodJob<S> {
  request: TerrainBuildRequest
  snapshot: S
  reason: string
}
export interface TerrainSwapInfo { queueMs: number; workerMs: number }

export interface TerrainLodSchedulerOptions<S> {
  createWorker: () => TerrainWorkerLike | null
  now?: () => number
  onSwap: (data: GroundGeometryData, job: TerrainLodJob<S>, info: TerrainSwapInfo) => void
  onWorkerLost: (job: TerrainLodJob<S> | null, reason: string) => void
  onDiscard?: (job: TerrainLodJob<S>) => void
}

export interface TerrainLodScheduler<S> {
  setSource(src: TerrainSourceInit): void
  setMask(refineMask: unknown): void
  invalidate(): void
  request(job: TerrainLodJob<S>): boolean
  readonly busy: boolean
  readonly available: boolean
  dispose(): void
}

export function createTerrainLodScheduler<S>(opts: TerrainLodSchedulerOptions<S>): TerrainLodScheduler<S> {
  const now = opts.now ?? (() => performance.now())
  let worker: TerrainWorkerLike | null = null
  let broken = false
  let disposed = false
  let generation = 0
  let nextId = 1
  let source: TerrainSourceInit | null = null
  let inflight: { id: number; gen: number; job: TerrainLodJob<S>; sentAt: number } | null = null

  function lose(reason: string, lostJob: TerrainLodJob<S> | null = inflight?.job ?? null) {
    if (broken) return
    broken = true
    const lost = lostJob
    inflight = null
    try { worker?.terminate() } catch { /* ignore */ }
    worker = null
    opts.onWorkerLost(lost, reason)
  }

  function ensureWorker(): TerrainWorkerLike | null {
    if (disposed || broken) return null
    if (worker) return worker
    try {
      const w = opts.createWorker()
      if (!w) { lose('unavailable'); return null }
      w.onmessage = (ev) => handle(ev.data)
      w.onerror = () => lose('worker-error')
      worker = w
      if (source) {
        try { w.postMessage({ type: 'init', ...source }) } catch { lose('post-failed'); return null }
      }
      return w
    } catch {
      lose('construct-failed')
      return null
    }
  }

  function send(job: TerrainLodJob<S>) {
    const w = ensureWorker()
    if (!w) return false
    const id = nextId++
    inflight = { id, gen: generation, job, sentAt: now() }
    try { w.postMessage({ type: 'build', id, ...job.request }) }
    catch { lose('post-failed'); return false }
    return true
  }

  function handle(msg: TerrainWorkerOut) {
    if (disposed || broken) return
    const cur = inflight
    if (!cur || cur.id !== msg.id) return
    inflight = null
    if (msg.type === 'error') { lose(`build-error: ${msg.message}`, cur.job); return }
    if (cur.gen !== generation) {
      try { opts.onDiscard?.(cur.job) } catch { /* 宿主回调异常不得破坏调度状态 */ }
      return
    }
    opts.onSwap(msg.data, cur.job, { queueMs: now() - cur.sentAt, workerMs: msg.workerMs })
  }

  function post(msg: TerrainWorkerIn) {
    if (!worker) return
    try { worker.postMessage(msg) } catch { lose('post-failed') }
  }

  return {
    setSource(src) {
      generation++
      source = src
      post({ type: 'init', ...src })
    },
    setMask(refineMask) {
      generation++
      if (source) source = { ...source, refineMask }
      post({ type: 'mask', refineMask })
    },
    invalidate() { generation++ },
    request(job) {
      if (disposed || broken) return false
      if (inflight) return true
      return send(job)
    },
    get busy() { return inflight !== null },
    get available() { return !disposed && !broken },
    dispose() {
      disposed = true
      inflight = null
      try { worker?.terminate() } catch { /* ignore */ }
      worker = null
    },
  }
}
