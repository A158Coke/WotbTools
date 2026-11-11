// 地形 LOD 异步重建调度（Issue #728 Workstream B）。
//
// 主线程只做三件事：判据命中 → 发请求（相机快照）→ 结果回来在帧边界换装。整张网格的构建
// （~15 万顶点，240–570 ms）在 terrainBuild.worker.ts 里跑。**最新者胜出**：同时只有一个在途任务
// + 一个待发快照；在途时再命中只覆盖待发快照。代号（generation）变化（会话重置 / 地图切换 /
// 掩码重建 / 销毁）使在途结果作废。Worker 不可用或出错 → `onWorkerLost`，调用方回到同步路径。

import type { GroundGeometryData } from '../groundGeometryData.js'
export type { GroundGeometryData }

export interface TerrainBuildRequest {
  cam: { x: number; y: number; z: number }
  fovY: number
  aspect: number
  hFovDeg: number | null
  /** 让 Worker 回传分段耗时（仅 perf 开启时） */
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

/** 一次调度任务：请求参数 + 调用方的不透明快照（换装时回交，用于更新「屏幕上那张网格」的 LOD 状态）。 */
export interface TerrainLodJob<S> {
  request: TerrainBuildRequest
  snapshot: S
  reason: string
}
export interface TerrainSwapInfo { queueMs: number; workerMs: number }

export interface TerrainLodSchedulerOptions<S> {
  createWorker: () => TerrainWorkerLike | null
  now?: () => number
  /** 结果换装（主线程帧边界）。抛错不会破坏调度状态。 */
  onSwap: (data: GroundGeometryData, job: TerrainLodJob<S>, info: TerrainSwapInfo) => void
  /** 待发快照相对「刚换上的」是否仍过期；不传则待发快照总是发出。 */
  stillStale?: (applied: S, next: S) => boolean
  /** Worker 构造失败 / 运行出错（调用方改走同步路径；`job` 为未能完成的那个任务）。 */
  onWorkerLost: (job: TerrainLodJob<S> | null, reason: string) => void
}

export interface TerrainLodScheduler<S> {
  /** 高度场 / 地图变化：新代号，丢弃在途与待发，并（重新）发送 init。 */
  setSource(src: TerrainSourceInit): void
  /** 走廊掩码变化：新代号并更新 Worker 内的掩码。 */
  setMask(refineMask: unknown): void
  /** 作废在途与待发（会话重置等）。 */
  invalidate(): void
  /** 提交任务；在途时覆盖待发快照。返回 false 表示 Worker 不可用（调用方应同步构建）。 */
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
  let pending: TerrainLodJob<S> | null = null

  function lose(reason: string) {
    if (broken) return
    broken = true
    const lost = inflight?.job ?? pending
    inflight = null; pending = null
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
      if (source) w.postMessage({ type: 'init', ...source })
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
    if (msg.type === 'error') { lose(`build-error: ${msg.message}`); return }
    if (cur.gen !== generation) {
      // 过期结果丢弃（TypedArray 是 Worker 转移来的，无 GPU 资源，交给 GC）；
      // 新代号下排队的任务此时才能发出（同时只有一个在途）
      if (pending) { const p = pending; pending = null; send(p) }
      return
    }
    try {
      opts.onSwap(msg.data, cur.job, { queueMs: now() - cur.sentAt, workerMs: msg.workerMs })
    } finally {
      const p = pending
      pending = null
      if (p && (!opts.stillStale || opts.stillStale(cur.job.snapshot, p.snapshot))) send(p)
    }
  }

  return {
    setSource(src) {
      generation++
      pending = null
      source = src
      // 在途结果因代号不符将在返回时丢弃（inflight 保留以便按 id 对账）
      if (worker) worker.postMessage({ type: 'init', ...src })
    },
    setMask(refineMask) {
      generation++
      pending = null
      if (source) source = { ...source, refineMask }
      worker?.postMessage({ type: 'mask', refineMask })
    },
    invalidate() { generation++; pending = null },
    request(job) {
      if (disposed || broken) return false
      if (inflight) { pending = job; return true }
      return send(job)
    },
    get busy() { return inflight !== null },
    get available() { return !disposed && !broken },
    dispose() {
      disposed = true
      inflight = null; pending = null
      try { worker?.terminate() } catch { /* ignore */ }
      worker = null
    },
  }
}
