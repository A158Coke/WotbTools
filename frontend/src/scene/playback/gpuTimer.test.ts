import { describe, expect, it, vi } from 'vitest'
import { createGpuFrameTracker, createGpuTimer } from './gpuTimer'
import { createPerf } from './perf'

function fixture(supported = true) {
  const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }
  let sequence = 0
  let available = false
  let disjoint = false
  let result = 2_500_000
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: vi.fn(() => supported ? ext : null),
    createQuery: vi.fn(() => ({ id: ++sequence })),
    beginQuery: vi.fn(), endQuery: vi.fn(), deleteQuery: vi.fn(),
    getParameter: vi.fn(() => disjoint),
    getQueryParameter: vi.fn((_query: object, name: number) => name === 3 ? available : result),
  }
  return {
    gl, context: gl as never,
    available(value: boolean) { available = value },
    disjoint(value: boolean) { disjoint = value },
    result(value: number) { result = value },
  }
}

describe('GPU timer query', () => {
  it('reports unsupported without allocating queries', () => {
    const f = fixture(false)
    const timer = createGpuTimer(f.context)
    expect(timer.status).toBe('unsupported')
    expect(timer.begin(1, 'main')).toBe(false)
    expect(timer.poll()).toEqual([])
    expect(f.gl.createQuery).not.toHaveBeenCalled()
  })

  it('associates asynchronous results with the originating frame and pass', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context)
    expect(timer.begin(12, 'main')).toBe(true)
    timer.end()
    expect(timer.poll()).toEqual([])
    expect(timer.pending).toBe(1)
    f.available(true)
    expect(timer.poll()).toEqual([{ epoch: 0, frame: 12, pass: 'main', status: 'complete', durationMs: 2.5 }])
    expect(timer.pending).toBe(0)
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(1)
  })

  it('discards all pending queries on disjoint, even when unavailable', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context)
    timer.begin(1, 'main'); timer.end()
    timer.begin(1, 'armor'); timer.end()
    f.disjoint(true)
    expect(timer.poll()).toEqual([
      { epoch: 0, frame: 1, pass: 'main', status: 'disjoint', durationMs: null },
      { epoch: 0, frame: 1, pass: 'armor', status: 'disjoint', durationMs: null },
    ])
    expect(timer.invalid).toBe(2)
    expect(f.gl.getQueryParameter).not.toHaveBeenCalled()
  })

  it('rejects nested queries and limits pending objects', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context, 1)
    expect(timer.begin(1, 'main')).toBe(true)
    expect(timer.begin(1, 'nested')).toBe(false)
    timer.end()
    expect(timer.begin(2, 'main')).toBe(false)
    expect(timer.dropped).toBe(2)
    expect(f.gl.beginQuery).toHaveBeenCalledTimes(1)
    expect(f.gl.endQuery).toHaveBeenCalledTimes(1)
  })

  it('handles allocation failure and invalid durations', () => {
    const f = fixture()
    f.gl.createQuery.mockReturnValueOnce(null as never)
    const timer = createGpuTimer(f.context)
    expect(timer.begin(1, 'main')).toBe(false)
    expect(timer.dropped).toBe(1)
    timer.begin(2, 'main'); timer.end()
    f.available(true); f.result(Number.NaN)
    expect(timer.poll()[0]).toMatchObject({ status: 'invalid', durationMs: null, frame: 2 })
    expect(timer.invalid).toBe(1)
  })

  it('pairs an active query on reset and discards all previous results', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context)
    timer.begin(1, 'main'); timer.end()
    timer.begin(2, 'main')
    timer.reset()
    expect(f.gl.endQuery).toHaveBeenCalledTimes(2)
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(2)
    expect(timer.epoch).toBe(1)
    expect(timer.poll()).toEqual([])
    timer.begin(3, 'main'); timer.end(); f.available(true)
    expect(timer.poll()[0]).toMatchObject({ epoch: 1, frame: 3 })
  })

  it('invalidates lost context queries and obtains the new extension on restore', () => {
    const old = fixture()
    const replacement = fixture()
    const timer = createGpuTimer(old.context)
    timer.begin(1, 'main'); timer.end()
    timer.contextLost()
    expect(timer.status).toBe('context-lost')
    expect(timer.invalid).toBe(1)
    expect(timer.poll()).toEqual([])
    expect(old.gl.deleteQuery).toHaveBeenCalledTimes(1)
    timer.contextRestored(replacement.context)
    expect(timer.status).toBe('available')
    timer.begin(2, 'main'); timer.end(); replacement.available(true)
    expect(timer.poll()[0]).toMatchObject({ epoch: 2, frame: 2 })
    timer.destroy(); timer.destroy()
    expect(timer.status).toBe('destroyed')
    expect(timer.begin(3, 'main')).toBe(false)
  })

  it('does not leak a query if beginning or ending fails', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context)
    f.gl.beginQuery.mockImplementationOnce(() => { throw new Error('begin') })
    expect(timer.begin(1, 'main')).toBe(false)
    expect(timer.status).toBe('error')
    const other = fixture()
    const timer2 = createGpuTimer(other.context)
    timer2.begin(2, 'main')
    other.gl.endQuery.mockImplementationOnce(() => { throw new Error('end') })
    expect(() => timer2.end()).not.toThrow()
    expect(timer2.pending).toBe(1)
    expect(timer2.invalid).toBe(1)
    expect(other.gl.deleteQuery).toHaveBeenCalledTimes(1)
    expect(timer2.poll()).toEqual([{ epoch: 0, frame: 2, pass: 'main', status: 'invalid', durationMs: null }])
    expect(timer2.pending).toBe(0)
  })

  it('bounds queued end failures and clears them on reset', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context, 1)
    timer.begin(8, 'main')
    f.gl.endQuery.mockImplementationOnce(() => { throw new Error('end') })
    timer.end()
    expect(timer.begin(9, 'main')).toBe(false)
    expect(timer.dropped).toBe(1)
    timer.reset()
    expect(timer.pending).toBe(0)
    expect(timer.poll()).toEqual([])
    expect(timer.epoch).toBe(1)
  })

  it('handles extension discovery failures and reacquires after restore', () => {
    const f = fixture()
    f.gl.getExtension.mockImplementationOnce(() => { throw new Error('extension') })
    const timer = createGpuTimer(f.context)
    expect(timer.status).toBe('error')
    expect(timer.invalid).toBe(1)
    expect(timer.begin(1, 'main')).toBe(false)
    timer.contextRestored(f.context)
    expect(timer.status).toBe('available')
  })

  it.each(['getParameter', 'getQueryParameter'] as const)('invalidates pending frames when %s throws', (method) => {
    const f = fixture()
    const timer = createGpuTimer(f.context)
    timer.begin(4, 'main'); timer.end()
    f.gl[method].mockImplementationOnce(() => { throw new Error('read') })
    expect(timer.poll()).toEqual([{ epoch: 0, frame: 4, pass: 'main', status: 'invalid', durationMs: null }])
    expect(timer.status).toBe('error')
    expect(timer.invalid).toBe(1)
    expect(timer.pending).toBe(0)
  })

  it('keeps reset, context loss and destroy safe when ending or deleting queries throws', () => {
    for (const action of ['reset', 'contextLost', 'destroy'] as const) {
      const f = fixture()
      const timer = createGpuTimer(f.context)
      timer.begin(1, 'main'); timer.end(); timer.begin(2, 'armor')
      f.gl.endQuery.mockImplementationOnce(() => { throw new Error('end') })
      f.gl.deleteQuery.mockImplementation(() => { throw new Error('delete') })
      expect(() => timer[action]()).not.toThrow()
      expect(timer.pending).toBe(0)
      expect(timer.invalid).toBeGreaterThanOrEqual(2)
      expect(timer.status).toBe(action === 'contextLost' ? 'context-lost' : action === 'destroy' ? 'destroyed' : 'error')
    }
  })

  it('preserves the result and exposes cleanup failure if deleteQuery throws while polling', () => {
    const f = fixture()
    const timer = createGpuTimer(f.context)
    timer.begin(1, 'main'); timer.end(); f.available(true)
    f.gl.deleteQuery.mockImplementationOnce(() => { throw new Error('delete') })
    expect(timer.poll()[0]).toMatchObject({ frame: 1, status: 'complete', durationMs: 2.5 })
    expect(timer.status).toBe('error')
    expect(timer.invalid).toBe(1)
    expect(() => timer.destroy()).not.toThrow()
  })
})

describe('GPU frame tracker', () => {
  function setup(supported = true, frameLimit = 240) {
    const f = fixture(supported)
    const canvas = new EventTarget()
    const sink = { gpuResult: vi.fn(), gpuStatus: vi.fn(), event: vi.fn(), setIdentity: vi.fn() }
    const tracker = createGpuFrameTracker(sink, frameLimit)
    const renderer = { getContext: () => f.context, domElement: canvas }
    tracker.attach(renderer)
    return { f, canvas, sink, tracker, renderer }
  }

  it('joins actual pass timings to their original recorded frame', () => {
    const { f, sink, tracker } = setup()
    const id = tracker.beginFrame()
    expect(id).toBe(0)
    expect(tracker.begin('main')).toBe(true); tracker.end()
    expect(tracker.begin('color')).toBe(true); tracker.end()
    tracker.submitFrame(); tracker.recorded(id)
    tracker.poll(); expect(sink.gpuResult).not.toHaveBeenCalled()
    f.available(true); tracker.poll()
    expect(sink.gpuResult.mock.calls).toEqual([[0, 'main', 2.5], [0, 'color', 2.5], [0, 'total', 5]])
    expect(sink.gpuStatus).toHaveBeenCalledWith(0, 'complete')
    tracker.dispose()
  })

  it('publishes immediate unsupported and dropped statuses only after frame record', () => {
    const { sink, tracker } = setup(false)
    const id = tracker.beginFrame()
    expect(tracker.begin('main')).toBe(false)
    tracker.submitFrame()
    expect(sink.gpuStatus).not.toHaveBeenCalled()
    tracker.recorded(id)
    expect(sink.gpuStatus).toHaveBeenCalledWith(id, 'unsupported')
    expect(sink.gpuResult).toHaveBeenCalledWith(id, 'total', null)
    tracker.dispose()
  })

  it('marks disjoint frames invalid without reporting a total duration', () => {
    const { f, sink, tracker } = setup()
    const id = tracker.beginFrame(); tracker.begin('main'); tracker.end(); tracker.submitFrame(); tracker.recorded(id)
    f.disjoint(true); tracker.poll()
    expect(sink.gpuStatus).toHaveBeenCalledWith(id, 'disjoint')
    expect(sink.gpuResult).toHaveBeenCalledWith(id, 'total', null)
    tracker.dispose()
  })

  it('invalidates the old context, restores the timer, and keeps frame ids unique across attaches', () => {
    const { f, canvas, sink, tracker, renderer } = setup()
    const id = tracker.beginFrame(); tracker.begin('main'); tracker.end(); tracker.submitFrame(); tracker.recorded(id)
    canvas.dispatchEvent(new Event('webglcontextlost'))
    expect(sink.gpuStatus).toHaveBeenCalledWith(id, 'context-lost')
    expect(tracker.snapshot().status).toBe('context-lost')
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    const next = tracker.beginFrame(); expect(next).toBe(1)
    tracker.begin('main'); tracker.end(); tracker.submitFrame(); tracker.recorded(next)
    f.available(true); tracker.poll()
    expect(sink.gpuStatus).toHaveBeenCalledWith(next, 'complete')
    tracker.attach(renderer)
    expect(tracker.beginFrame()).toBe(2)
    tracker.dispose()
  })

  it('evicts bounded pending frames and clears attribution on reset', () => {
    const { f, sink, tracker } = setup(true, 1)
    const old = tracker.beginFrame(); tracker.begin('main'); tracker.end(); tracker.submitFrame(); tracker.recorded(old)
    const next = tracker.beginFrame()
    expect(sink.gpuStatus).toHaveBeenCalledWith(old, 'dropped')
    expect(tracker.snapshot().droppedFrames).toBe(1)
    tracker.begin('main'); tracker.end(); tracker.submitFrame(); tracker.recorded(next)
    tracker.reset()
    expect(tracker.snapshot()).toMatchObject({ pending: 0, droppedFrames: 0 })
    f.available(true); tracker.poll()
    expect(sink.gpuStatus).not.toHaveBeenCalledWith(next, 'complete')
    expect(tracker.beginFrame()).toBe(2)
    tracker.dispose()
  })

  it('unregisters context listeners and handles absent/throwing contexts', () => {
    const sink = { gpuResult: vi.fn(), gpuStatus: vi.fn(), event: vi.fn(), setIdentity: vi.fn() }
    const tracker = createGpuFrameTracker(sink)
    const canvas = new EventTarget()
    tracker.attach({ getContext: () => { throw new Error('context') }, domElement: canvas })
    expect(tracker.snapshot().status).toBe('error')
    expect(tracker.beginFrame()).toBeNull()
    const f = fixture()
    tracker.attach({ getContext: () => f.context, domElement: canvas })
    tracker.dispose()
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(f.gl.getExtension).toHaveBeenCalledTimes(1)
  })

  it('attributes delayed results to the interrupted capture across session changes', () => {
    const f = fixture()
    const perf = createPerf({ now: () => 0 })
    const tracker = createGpuFrameTracker(perf)
    tracker.attach({ getContext: () => f.context, domElement: new EventTarget() })
    perf.beginSession(); perf.startCapture({ scenarioId: 'old' })
    const old = tracker.beginFrame(); tracker.begin('main'); tracker.end(); tracker.submitFrame()
    perf.record({ gpuFrameId: old }, 1); tracker.recorded(old)
    perf.interrupt('file-change'); perf.beginSession()
    const next = tracker.beginFrame(); tracker.begin('main'); tracker.end(); tracker.submitFrame()
    perf.record({ gpuFrameId: next }, 2); tracker.recorded(next)
    f.available(true); tracker.poll()
    const snapshot = perf.snapshot()
    expect(snapshot.capture?.frames[0]).toMatchObject({ gpuFrameId: old, gpu_main_ms: 2.5, gpu_total_ms: 2.5, gpuStatus: 'complete' })
    expect(snapshot.latest).toMatchObject({ gpuFrameId: next, gpu_main_ms: 2.5, gpu_total_ms: 2.5, gpuStatus: 'complete' })
    tracker.dispose()
  })
})
