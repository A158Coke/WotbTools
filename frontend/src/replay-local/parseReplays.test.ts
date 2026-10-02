import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setParseWorkerFactoryForTest, parseReplayFiles, ReplayEngineUnavailableError } from './parseReplays.js'
import type { ParseMessage, ParseRequest } from './parseWorkerProtocol.js'

/** 桩 Worker：按脚本回放消息，记录 terminate */
function stubWorker(script: (req: ParseRequest) => ParseMessage[]) {
  const worker = {
    onmessage: null as ((e: MessageEvent<ParseMessage>) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(req: ParseRequest) {
      queueMicrotask(() => {
        for (const m of script(req)) worker.onmessage?.({ data: m } as MessageEvent<ParseMessage>)
      })
    },
  }
  return worker
}

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name)

afterEach(() => __setParseWorkerFactoryForTest(null))

describe('parseReplayFiles', () => {
  it('按输入顺序返回结果（Worker 乱序回报也不错位），逐文件回报进度，最后终止 Worker', async () => {
    const w = stubWorker((req) => [
      { type: 'file', index: 1, file: { name: req.files[1].name, result: null, error: 'bad' } },
      { type: 'file', index: 0, file: { name: req.files[0].name, result: { players: [] } as never, error: null } },
      { type: 'done' },
    ])
    __setParseWorkerFactoryForTest(() => w as unknown as Worker)
    const progress: number[] = []
    const out = await parseReplayFiles([file('a.wotbreplay'), file('b.wotbreplay')], {
      onProgress: (done) => progress.push(done),
    })
    expect(out.map((f) => f.name)).toEqual(['a.wotbreplay', 'b.wotbreplay'])
    expect(out[1].error).toBe('bad')
    expect(progress).toEqual([1, 2])
    expect(w.terminate).toHaveBeenCalled()
  })

  it('WASM 装载失败 → ReplayEngineUnavailableError（不回退服务端）', async () => {
    const w = stubWorker(() => [{ type: 'fatal', error: 'wasm missing' }])
    __setParseWorkerFactoryForTest(() => w as unknown as Worker)
    await expect(parseReplayFiles([file('a.wotbreplay')])).rejects.toBeInstanceOf(ReplayEngineUnavailableError)
    expect(w.terminate).toHaveBeenCalled()
  })

  it('已取消的 signal 不启动 Worker', async () => {
    const factory = vi.fn()
    __setParseWorkerFactoryForTest(factory)
    const ac = new AbortController()
    ac.abort()
    await expect(parseReplayFiles([file('a.wotbreplay')], { signal: ac.signal })).rejects.toBeTruthy()
    expect(factory).not.toHaveBeenCalled()
  })
})
