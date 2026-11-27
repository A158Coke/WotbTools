// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  parseLocalPlaybackOffThread,
  __setCanonicalWorkerFactory,
} from './canonicalRuntime'
import type { CanonicalMessage, CanonicalRequest } from './canonicalWorkerProtocol'

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
    expect(ids[0]).not.toBe(ids[1])
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
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
  })

  it('postMessage 同步抛错 → inflight 立即清理 + 回退主线程（不泄漏 stale handler）', async () => {
    const fake = new FakeWorker()
    fake.mode = 'silent'
    let throwOnPost = true
    const throwingWorker = new FakeWorker()
    Object.defineProperty(throwingWorker, 'postMessage', {
      value: () => { if (throwOnPost) throw new Error('clone failed') },
    })
    __setCanonicalWorkerFactory(() => throwingWorker as unknown as Worker)
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
    throwOnPost = false
    fake.mode = 'done'
    __setCanonicalWorkerFactory(() => fake as unknown as Worker)
    const out = await parseLocalPlaybackOffThread(new ArrayBuffer(4))
    expect(out).toBe(fake.reply)
    expect(fake.requests).toHaveLength(1)
  })

  it('playback facet 复用：canonical 请求携带 scene 侧已解析的 playback（不二次 parsePlayback）', async () => {
    const fake = new FakeWorker()
    __setCanonicalWorkerFactory(() => fake as unknown as Worker)
    const facet = { meta: { samples: 1 } }
    const out = await parseLocalPlaybackOffThread(new ArrayBuffer(4), facet as never)
    expect(out).toBe(fake.reply)
    expect(fake.requests[0].playback).toBe(facet)
  })

  it('Worker 崩溃（onerror）→ 实例清掉并回退主线程重跑（fail-open）', async () => {
    const fake = new FakeWorker()
    fake.mode = 'crash'
    let calls = 0
    __setCanonicalWorkerFactory(() => { calls++; return fake as unknown as Worker })
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
    await expect(parseLocalPlaybackOffThread(new ArrayBuffer(8))).rejects.toThrow()
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})
