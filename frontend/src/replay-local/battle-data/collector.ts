import type { AgentBattleResult } from '../../api/agent-replay-facets.js'
import { toCollectorSeed } from './collectorProjection.js'
import type { CollectorDone, CollectorTask } from './collectorWorkerProtocol.js'

// 资源策略仅约束旁路，不改变主回放文件限制。
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_WAITING_BYTES = 64 * 1024 * 1024
const MAX_WAITING = 2
const TASK_TIMEOUT_MS = 15_000
const IDLE_TIMEOUT_MS = 15_000
const defaultFactory = () => new Worker(new URL('./collector.worker.ts', import.meta.url), { type: 'module' })
let factory: () => Worker = defaultFactory
let worker: Worker | undefined
let active: CollectorTask | undefined
const waiting: CollectorTask[] = []
let waitingBytes = 0
let sequence = 0
let taskTimer: ReturnType<typeof setTimeout> | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined

function discard(): void {
  clearTimeout(taskTimer)
  clearTimeout(idleTimer)
  active = undefined
  waiting.length = 0
  waitingBytes = 0
  const previous = worker
  worker = undefined
  try { previous?.terminate() } catch { /* 已失败的 Worker 也不影响主流程。 */ }
}

function dispatch(task: CollectorTask): void {
  if (navigator.onLine === false) { discard(); return }
  clearTimeout(idleTimer)
  active = task
  if (!worker) {
    const current = factory()
    worker = current
    current.onmessage = (event: MessageEvent<CollectorDone>) => {
      // Worker identity + 单调 task id 防止已终止实例的迟到回复完成新任务。
      if (worker !== current || event.data?.id !== active?.id) return
      clearTimeout(taskTimer)
      active = undefined
      try {
        const next = waiting.shift()
        if (next) {
          waitingBytes -= next.blob.size
          dispatch(next)
        } else {
          idleTimer = setTimeout(discard, IDLE_TIMEOUT_MS)
        }
      } catch { discard() }
    }
    current.onerror = event => {
      event.preventDefault?.()
      if (worker === current) discard()
    }
    current.onmessageerror = () => { if (worker === current) discard() }
  }
  taskTimer = setTimeout(discard, TASK_TIMEOUT_MS)
  worker.postMessage(task)
}

/** 同步、有界、不抛错；调用方不得等待 Collector 完成。 */
export function tryCollect(blob: Blob, result: AgentBattleResult): void {
  try {
    if (import.meta.env.VITE_BATTLE_DATA_COLLECTOR_ENABLED === 'false' || navigator.onLine === false
      || blob.size > MAX_FILE_BYTES) return
    const seed = toCollectorSeed(result)
    if (!seed) return
    const task = { id: ++sequence, blob, seed }
    if (!active) { dispatch(task); return }
    if (waiting.length >= MAX_WAITING || waitingBytes + blob.size > MAX_WAITING_BYTES) return
    waiting.push(task)
    waitingBytes += blob.size
  } catch { discard() }
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', discard)
  window.addEventListener('pagehide', discard)
}

/** 与 parser Worker 相同的测试注入边界；生产调用方不用。 */
export function __setCollectorWorkerFactoryForTest(value: (() => Worker) | null): void {
  discard()
  factory = value ?? defaultFactory
}
