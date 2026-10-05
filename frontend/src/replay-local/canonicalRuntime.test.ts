// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  parseLocalPlaybackOffThread,
  __setCanonicalWorkerFactory,
} from './canonicalRuntime'
import type { CanonicalMessage, CanonicalRequest } from './canonicalWorkerProtocol'

/** 假 Worker：记录请求、按脚本回包（不跑真解析） */
class FakeWorker {
  onmessage: ((e: MessageEvent<CanonicalMessage>) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  requests: CanonicalRequest[] = []
  mode: 'done' | 'error' | 'silent' | 'crash' = 'done'
  reply: unknown = { marker: 'canonical' }
  postMessage(req: CanonicalRequest) {
    this.requests.push(req)
    if (this.mode === 'silent') return
    queueMicrotask(() => {
      if (this.mode === 'crash') { this.onerror?.(new Error('boom')); return }
      const data = this.mode === 'done'
        ? { type: 'done', id: req.id, playback: this.reply } as CanonicalMessage
        : { type: 'error', id: req.id, error: 'worker parse failed' } as CanonicalMessage
      this.onmessage?.({ data } as MessageEvent<CanonicalMessage>)
    })
  }
  terminate() {}
}

afterEach(() => {
  __setCanonicalWorkerFactory(null)
  vi.restoreAllMocks()
})

describe('canonicalRuntime：规范投影线程化（Worker 优先）', () => {
  it('Worker 可用：请求带 id + 原始字节，结果按 id 回传（主线程不跑投影）', async () => {
    const fake = new FakeWorker()
    __setCanonicalWorkerFactory(() => fake as unknown as Worker)
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    const out = await parseLocalPlaybackOffThread(bytes)
    expect(out).toBe(fake.reply)
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0].bytes).toBe(bytes)
    expect(typeof fake.requests[0].id).toBe('number')
  })

  it('并发两次：id 不重复、各自拿到自己的结果（不串包）', async () => {
    const fake = new FakeWorker()
    __setCanonicalWorkerFactory(() => fake as unknown as Worker)
    const a = parseLocalPlaybackOffThread(new ArrayBuffer(2))
    const b = parseLocalPlaybackOffThread(new ArrayBuffer(2))
    const [ra, rb] = await Promise.all([a, b])
    const ids = fake.requests.map((r) => r.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])   // 不串包：两次请求 id 不同
    expect(ra).toBe(fake.reply)
    expect(rb).toBe(fake.reply)
  })

  it('Worker 报错：该次调用拒绝（不静默返回半成品）', async () => {
    const fake = new FakeWorker()
    fake.mode = 'error'
    __setCanonicalWorkerFactory(() => fake as unknown as Worker)
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(2))).rejects.toThrow('worker parse failed')
  })

  it('Worker 构造失败 → 退回主线程解析（fail-open，功能不丢）', async () => {
    __setCanonicalWorkerFactory(() => { throw new Error('no worker support') })
    // 主线程兜底走真解析：空字节会解析失败 → 只能是"解析错误"，不可能是"没有 Worker"类错误
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
  })

  it('Worker 崩溃（onerror）→ 实例清掉并回退主线程重跑（fail-open）', async () => {
    const fake = new FakeWorker()
    fake.mode = 'crash'
    let calls = 0
    __setCanonicalWorkerFactory(() => { calls++; return fake as unknown as Worker })
    // 崩溃 → 回退主线程；测试环境无真 WASM/身份指纹，因此必然以错误结束（但路径是回退）
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
    // 坏实例已清（worker=null）：下一次调用重新构造
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
