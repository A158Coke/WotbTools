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

  it('installs both counters together and counts real upload bytes', () => {
    const { context } = fakeContext()
    const counts = stats()
    const attempted = new WeakSet<object>()

    expect(installUploadTracking(context as never, counts, attempted)).toBe(true)
    context.bufferData(0, new Uint8Array(8), 0)
    context.bufferSubData(0, 0, new Uint8Array(4))
    expect(counts).toEqual({ bufferDataCalls: 1, bufferDataBytes: 8, bufferSubDataCalls: 1, bufferSubDataBytes: 4 })
  })
})