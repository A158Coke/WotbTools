import type { ParseMessage, ParsedReplayFile } from './parseWorkerProtocol.js'
import { tryCollect } from './battle-data/collector.js'

export type { ParsedReplayFile }

export interface ParseReplaysOptions {
  onProgress?: (done: number, total: number) => void
  onFile?: (index: number, file: ParsedReplayFile) => void
  signal?: AbortSignal
}

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

export function __setParseWorkerFactoryForTest(factory: WorkerFactory | null): void {
  workerFactory = factory ?? defaultWorkerFactory
}

export async function parseReplayFiles(files: File[], options: ParseReplaysOptions = {}): Promise<ParsedReplayFile[]> {
  const { onProgress, onFile, signal } = options
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
          onFile?.(message.index, message.file)
          done++
          onProgress?.(done, files.length)
          if (message.file.result && !message.file.error) tryCollect(files[message.index], message.file.result)
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
