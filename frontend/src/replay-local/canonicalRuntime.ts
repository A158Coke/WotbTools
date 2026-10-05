/**
 * 规范投影（v2 数据集）的**线程外**入口：优先在 Worker 里跑 `parseLocalPlayback`，
 * 不可用（无 Worker / 启动失败 / 传输失败）时**退回主线程**——退回会有一次停顿，
 * 但功能不受影响（fail-open，绝不因为线程化失败而让详情面板拿不到数据）。
 *
 * 线程化的动机见 `canonicalWorkerProtocol.ts`：主线程版正是"播放正常一小段后整页卡住"。
 */
import type { CanonicalMessage, CanonicalRequest } from './canonicalWorkerProtocol.js'
import { parseLocalPlayback, type LocalPlayback, type ParseLocalPlaybackOptions } from './playback/index.js'

export type CanonicalWorkerFactory = () => Worker

/** Worker 进程级崩溃（非"解析失败"）：只有它才值得回退主线程重跑一次 */
export class CanonicalWorkerCrash extends Error {}

const defaultFactory: CanonicalWorkerFactory = () =>
  new Worker(new URL('./canonical.worker.ts', import.meta.url), { type: 'module' })

let workerFactory: CanonicalWorkerFactory = defaultFactory

/** 测试注入点：替换 Worker 工厂（传 null 恢复默认）。**同时丢弃已缓存的 Worker 实例**
 *  ——否则换工厂后仍在用旧实例（测试隔离要的正是"从零开始"）。 */
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
    // Worker 崩溃：拒掉在途请求并把实例清掉，调用方据 CanonicalWorkerCrash 决定是否回退
    for (const entry of inflight.values()) entry.reject(new CanonicalWorkerCrash('canonical worker crashed'))
    inflight.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/**
 * 解析规范投影：Worker 优先、主线程兜底。
 *
 * `bytes` 走 structured clone（**不转移**）：回放体积 ~1-2MB，克隆成本毫秒级，且换掉
 * transfer 后不存在"转移即脱管、兜底无从读取"的坑（脱管的 ArrayBuffer 再 slice 会抛）。
 */
export async function parseLocalPlaybackOffThread(
  bytes: ArrayBuffer,
  options: ParseLocalPlaybackOptions = {},
): Promise<LocalPlayback> {
  const w = ensureWorker()
  if (w) {
    let posted = false
    try {
      return await new Promise<LocalPlayback>((resolve, reject) => {
        const id = ++seq
        inflight.set(id, { resolve, reject })
        const request: CanonicalRequest = { id, bytes }
        w.postMessage(request)
        posted = true
      })
    } catch (error) {
      // 已送达 Worker 后的失败：解析失败 = 真失败，原样抛出（在主线程重跑一遍只会同样失败
      // 并再停顿一次）；只有**进程级崩溃**才回退主线程重跑（fail-open，功能不丢）。
      if (posted && !(error instanceof CanonicalWorkerCrash)) throw error
      if (import.meta.env?.DEV) console.warn('规范投影 Worker 不可用，退回主线程:', error)
    }
  }
  return parseLocalPlayback(new Uint8Array(bytes), options)
}
