/**
 * 主线程入口：把选中的回放文件交给解析 Worker，逐文件回报进度，返回与输入同序的解析结果。
 *
 * 服务器没有 parser：解析失败只会是「该文件解析失败」或「WASM 不可用」，不存在回退到服务端。
 */
import type { ParseMessage, ParsedReplayFile } from './parseWorkerProtocol.js'

export type { ParsedReplayFile }

export interface ParseReplaysOptions {
  /** 每完成一个文件回调一次（done = 已完成个数） */
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** WASM 装载失败（产物缺失 / 浏览器不支持）：整批不可用，与单文件解析失败区分 */
export class ReplayEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayEngineUnavailableError'
  }
}

type WorkerFactory = () => Worker

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })

let workerFactory: WorkerFactory = defaultWorkerFactory

/** 测试注入点：以桩 Worker 替换真实 Worker；传 null 复位。生产代码不调用。 */
export function __setParseWorkerFactoryForTest(factory: WorkerFactory | null): void {
  workerFactory = factory ?? defaultWorkerFactory
}

export async function parseReplayFiles(files: File[], options: ParseReplaysOptions = {}): Promise<ParsedReplayFile[]> {
  const { onProgress, signal } = options
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  const payload = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })))
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')

  const worker = workerFactory()
  const results: ParsedReplayFile[] = new Array(files.length)
  let done = 0
  try {
    return await new Promise<ParsedReplayFile[]>((resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.onmessage = (event: MessageEvent<ParseMessage>) => {
        const message = event.data
        if (message.type === 'file') {
          results[message.index] = message.file
          done++
          onProgress?.(done, files.length)
        } else if (message.type === 'fatal') {
          reject(new ReplayEngineUnavailableError(message.error))
        } else {
          signal?.removeEventListener('abort', abort)
          resolve(results)
        }
      }
      worker.onerror = (event) => reject(new ReplayEngineUnavailableError(event.message || 'parse worker crashed'))
      worker.postMessage({ files: payload }, payload.map((f) => f.bytes))
    })
  } finally {
    worker.terminate()
  }
}
