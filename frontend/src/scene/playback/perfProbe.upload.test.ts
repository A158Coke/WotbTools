import { describe, expect, it } from 'vitest'
import { installUploadTracking } from './perfProbe.ts'

type FakeContext = {
  bufferData(...args: unknown[]): void
  bufferSubData(...args: unknown[]): void
}

function fakeContext({ dataWritable = true, subWritable = true } = {}) {
  const calls: string[] = []
  const context: FakeContext = {
    bufferData(...args) { calls.push('data:' + String(args.length)) },
    bufferSubData(...args) { calls.push('sub:' + String(args.length)) },
  }
  Object.defineProperty(context, 'bufferData', {
    value: context.bufferData,
    writable: dataWritable,
    configurable: true,
  })
  Object.defineProperty(context, 'bufferSubData', {
    value: context.bufferSubData,
    writable: subWritable,
    configurable: true,
  })
  return { context, calls }
}

function stats() {
  return { bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0, bufferSubDataBytes: 0 }
}

describe('installUploadTracking', () => {
  it('rolls back a partial install and does not wrap the same context again', () => {
    const { context } = fakeContext({ subWritable: false })
    const counts = stats()
    const attempted = new WeakSet<object>()

    expect(installUploadTracking(context as never, counts, attempted)).toBe(false)
    expect(counts.bufferDataCalls).toBe(0)
    context.bufferData(new ArrayBuffer(8), 0)
    expect(counts.bufferDataCalls).toBe(0)

    expect(installUploadTracking(context as never, counts, attempted)).toBe(false)
    expect(counts.bufferDataCalls).toBe(0)
  })

  it('does not wrap the writable method when the other side is read-only', () => {
    const { context } = fakeContext({ dataWritable: false, subWritable: true })
    const counts = stats()
    const attempted = new WeakSet<object>()

    expect(installUploadTracking(context as never, counts, attempted)).toBe(false)
    context.bufferSubData(0, 0, new Uint8Array(4))
    expect(counts).toEqual({ bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0, bufferSubDataBytes: 0 })
  })

  it('does not add a wrapper per frame after a failed install', () => {
    const { context } = fakeContext({ subWritable: false })
    const counts = stats()
    const attempted = new WeakSet<object>()
    for (let i = 0; i < 20; i++) expect(installUploadTracking(context as never, counts, attempted)).toBe(false)
    context.bufferData(new ArrayBuffer(8), 0)
    expect(counts).toEqual({ bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0, bufferSubDataBytes: 0 })
  })

  it('does not throw when a context exposes no upload methods', () => {
    const counts = stats()
    expect(installUploadTracking({} as never, counts, new WeakSet<object>())).toBe(false)
  })

  it('installs both counters together and counts real upload bytes', () => {
    const { context } = fakeContext()
    const counts = stats()
    const attempted = new WeakSet<object>()

    expect(installUploadTracking(context as never, counts, attempted)).toBe(true)
    context.bufferData(0, new Uint8Array(8), 0)
    context.bufferSubData(0, 0, new Uint8Array(4))
    expect(counts).toEqual({ bufferDataCalls: 1, bufferDataBytes: 8, bufferSubDataCalls: 1, bufferSubDataBytes: 4 })
  })

  it('prototype timing hook installed after counters still sees the real uploads exactly once', () => {
    const nativeCalls: string[] = []
    const samples: Array<{ start: number; ms: number; key: string }> = []
    class FakeGL {
      bufferData(..._args: unknown[]) { nativeCalls.push('data') }
      bufferSubData(..._args: unknown[]) { nativeCalls.push('sub') }
    }
    const context = new FakeGL()
    const counts = stats()
    // Review validation order: upload counter first, timing hook second. The counter must
    // dispatch through the prototype's current method instead of a bound native snapshot.
    expect(installUploadTracking(context as never, counts, new WeakSet<object>())).toBe(true)
    for (const key of ['bufferData', 'bufferSubData'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(FakeGL.prototype, key)!
      const native = descriptor.value as (...args: unknown[]) => unknown
      Object.defineProperty(FakeGL.prototype, key, {
        ...descriptor,
        value: function (this: FakeGL, ...args: unknown[]) {
          const start = performance.now()
          const result = Reflect.apply(native, this, args)
          samples.push({ start, ms: performance.now() - start, key })
          return result
        },
      })
    }

    context.bufferData(0, new Uint8Array(8), 0)
    context.bufferSubData(0, 0, new Uint8Array(4))

    expect(nativeCalls).toEqual(['data', 'sub'])   // 无递归、无重复调用
    expect(counts).toEqual({ bufferDataCalls: 1, bufferDataBytes: 8, bufferSubDataCalls: 1, bufferSubDataBytes: 4 })
    expect(samples.map(sample => sample.key)).toEqual(['bufferData', 'bufferSubData'])
    expect(samples.every(sample => Number.isFinite(sample.start) && sample.ms >= 0)).toBe(true)
  })
})