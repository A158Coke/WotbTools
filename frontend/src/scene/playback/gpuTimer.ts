/** 异步 WebGL2 timer query；调用者只在启用诊断时创建，且在每个实际 render 边界调用。 */
export type GpuTimerStatus = 'not-initialized' | 'available' | 'unsupported' | 'context-lost' | 'error' | 'destroyed'
export type GpuSampleStatus = 'complete' | 'disjoint' | 'invalid'

export interface GpuSample {
  epoch: number
  frame: number
  pass: string
  status: GpuSampleStatus
  durationMs: number | null
}

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

interface PendingQuery {
  query: WebGLQuery
  epoch: number
  frame: number
  pass: string
}

export interface GpuTimer {
  readonly status: GpuTimerStatus
  readonly pending: number
  readonly dropped: number
  readonly invalid: number
  readonly epoch: number
  /** 不允许嵌套；失败时仍必须执行原 render。 */
  begin(frame: number, pass: string): boolean
  end(): void
  /** 最多检查各 pending query 一次，永不等待 GPU。 */
  poll(): GpuSample[]
  reset(): void
  contextLost(): void
  contextRestored(gl: WebGL2RenderingContext): void
  destroy(): void
}

export function createGpuTimer(initialGl: WebGL2RenderingContext, maxPending = 64): GpuTimer {
  let gl = initialGl
  let extension: TimerExtension | null = null
  let status: GpuTimerStatus = 'unsupported'
  let epoch = 0
  let dropped = 0
  let invalid = 0
  let active: PendingQuery | null = null
  let pending: PendingQuery[] = []
  let failed: GpuSample[] = []
  const limit = Number.isFinite(maxPending) ? Math.max(0, Math.floor(maxPending)) : 64

  function acquireExtension(): void {
    try {
      extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
      status = extension ? 'available' : 'unsupported'
    } catch {
      extension = null
      status = 'error'
      invalid++
    }
  }
  function deleteQuery(query: WebGLQuery): void {
    try { gl.deleteQuery(query) } catch {
      invalid++
      if (status !== 'context-lost' && status !== 'destroyed') status = 'error'
    }
  }
  acquireExtension()

  function clearQueries(): void {
    if (active) {
      // endQuery is paired even when reset is requested between begin/end.
      if (status === 'available' && extension) {
        try { gl.endQuery(extension.TIME_ELAPSED_EXT) } catch { status = 'error'; invalid++ }
      }
      deleteQuery(active.query)
      active = null
    }
    for (const item of pending) deleteQuery(item.query)
    pending = []
    failed = []
  }

  function begin(frame: number, pass: string): boolean {
    if (status !== 'available' || !extension) return false
    if (active || pending.length + failed.length >= limit) { dropped++; return false }
    let query: WebGLQuery | null
    try { query = gl.createQuery() } catch { dropped++; invalid++; status = 'error'; return false }
    if (!query) { dropped++; return false }
    try {
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
    } catch {
      deleteQuery(query)
      dropped++
      invalid++
      status = 'error'
      return false
    }
    active = { query, epoch, frame, pass }
    return true
  }

  function end(): void {
    if (!active || !extension || status !== 'available') return
    const item = active
    active = null
    try {
      gl.endQuery(extension.TIME_ELAPSED_EXT)
      pending.push(item)
    } catch {
      deleteQuery(item.query)
      invalid++
      failed.push({ epoch: item.epoch, frame: item.frame, pass: item.pass, status: 'invalid', durationMs: null })
    }
  }

  function poll(): GpuSample[] {
    const samples = failed
    failed = []
    if (status !== 'available' || !extension) {
      for (const item of pending) {
        invalid++
        samples.push({ epoch: item.epoch, frame: item.frame, pass: item.pass, status: 'invalid', durationMs: null })
        deleteQuery(item.query)
      }
      pending = []
      return samples
    }
    let disjoint = false
    let readFailed = false
    try { disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT)) } catch { status = 'error'; readFailed = true }
    const waiting: PendingQuery[] = []
    for (const item of pending) {
      let ns: unknown = null
      try {
        if (!disjoint && !readFailed && !gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) {
          waiting.push(item)
          continue
        }
        if (!disjoint && !readFailed) ns = gl.getQueryParameter(item.query, gl.QUERY_RESULT)
      } catch {
        status = 'error'
        readFailed = true
      }
      const valid = typeof ns === 'number' && Number.isFinite(ns) && ns >= 0
      const sampleStatus: GpuSampleStatus = disjoint && !readFailed ? 'disjoint' : valid ? 'complete' : 'invalid'
      if (!valid) invalid++
      samples.push({ epoch: item.epoch, frame: item.frame, pass: item.pass, status: sampleStatus, durationMs: valid && typeof ns === 'number' ? ns / 1e6 : null })
      deleteQuery(item.query)
    }
    pending = waiting
    return samples
  }

  function reset(): void {
    if (status === 'destroyed') return
    dropped = 0
    invalid = 0
    clearQueries()
    epoch++
  }

  return {
    get status() { return status },
    get pending() { return pending.length + failed.length + (active ? 1 : 0) },
    get dropped() { return dropped },
    get invalid() { return invalid },
    get epoch() { return epoch },
    begin, end, poll, reset,
    contextLost() {
      if (status === 'destroyed' || status === 'context-lost') return
      // Lost contexts cannot produce trustworthy results. WebGL permits deleting lost objects.
      invalid += pending.length + (active ? 1 : 0)
      status = 'context-lost'
      clearQueries()
      extension = null
      epoch++
    },
    contextRestored(nextGl) {
      if (status === 'destroyed') return
      clearQueries()
      gl = nextGl
      acquireExtension()
      epoch++
    },
    destroy() {
      if (status === 'destroyed') return
      clearQueries()
      extension = null
      status = 'destroyed'
      epoch++
    },
  }
}

interface GpuFrameSink {
  gpuResult(frame: number, pass: string, durationMs: number | null): void
  gpuStatus(frame: number, status: string): void
  event(value: Record<string, unknown>): void
  setIdentity(value: Record<string, unknown>): void
}

interface GpuRenderer {
  getContext(): WebGL2RenderingContext
  domElement: EventTarget
}

interface FrameQuery {
  id: number
  epoch: number
  expected: number
  completed: number
  total: number
  failure: string | null
  submitted: boolean
  recorded: boolean
}

/** 场景只在 ?perf 下创建；帧 id 跨 renderer 重建保持单调。 */
export function createGpuFrameTracker(sink: GpuFrameSink, maxFrames = 240) {
  let renderer: GpuRenderer | null = null
  let timer: GpuTimer | null = null
  let fallback: GpuTimerStatus = 'not-initialized'
  let sequence = 0
  let droppedFrames = 0
  let active: FrameQuery | null = null
  const frames = new Map<number, FrameQuery>()
  const limit = Number.isFinite(maxFrames) ? Math.max(1, Math.floor(maxFrames)) : 240

  function complete(frame: FrameQuery): void {
    if (!frame.submitted || !frame.recorded || frame.completed !== frame.expected) return
    sink.gpuResult(frame.id, 'total', frame.failure ? null : frame.total)
    sink.gpuStatus(frame.id, frame.failure ?? 'complete')
    frames.delete(frame.id)
  }
  function failFrames(reason: string): void {
    for (const frame of frames.values()) {
      frame.failure = reason
      frame.completed = frame.expected
      frame.submitted = true
      complete(frame)
    }
    active = null
  }
  function poll(): void {
    if (!timer) return
    for (const sample of timer.poll()) {
      const frame = frames.get(sample.frame)
      if (!frame || frame.epoch !== sample.epoch) continue
      frame.completed++
      if (sample.status !== 'complete' || sample.durationMs === null) frame.failure = sample.status
      else frame.total += sample.durationMs
      sink.gpuResult(sample.frame, sample.pass, sample.durationMs)
      complete(frame)
    }
  }
  function lost(): void { timer?.contextLost(); failFrames('context-lost') }
  function restored(): void {
    if (!renderer || !timer) return
    try { timer.contextRestored(renderer.getContext()) } catch { timer.contextLost() }
  }
  function detach(): void {
    if (renderer) {
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      renderer.domElement.removeEventListener('webglcontextrestored', restored)
    }
    failFrames('invalid')
    timer?.destroy()
    timer = null
    renderer = null
  }
  function attach(next: GpuRenderer): void {
    detach()
    renderer = next
    let gl: WebGL2RenderingContext
    try { gl = next.getContext() } catch { fallback = 'error'; sink.event({ stage: 'gpu', status: fallback, durationMs: null }); return }
    if (!gl || typeof gl.getExtension !== 'function') {
      fallback = 'unsupported'; sink.event({ stage: 'gpu', status: fallback, durationMs: null }); return
    }
    try { sink.setIdentity({ gpuRenderer: gl.getParameter(gl.RENDERER) || null }) } catch { sink.setIdentity({ gpuRenderer: null }) }
    timer = createGpuTimer(gl)
    next.domElement.addEventListener('webglcontextlost', lost)
    next.domElement.addEventListener('webglcontextrestored', restored)
    sink.event({ stage: 'gpu', status: timer.status, durationMs: null })
  }
  function beginFrame(): number | null {
    poll()
    if (!timer) return null
    if (active) abortFrame()
    const frame: FrameQuery = { id: sequence++, epoch: timer.epoch, expected: 0, completed: 0, total: 0, failure: null, submitted: false, recorded: false }
    frames.set(frame.id, frame)
    active = frame
    while (frames.size > limit) {
      const oldest = frames.keys().next().value
      if (oldest === undefined) break
      const evicted = frames.get(oldest)
      if (evicted?.recorded) sink.gpuStatus(oldest, 'dropped')
      frames.delete(oldest)
      droppedFrames++
    }
    return frame.id
  }
  function begin(pass: string): boolean {
    if (!timer || !active) return false
    active.expected++
    const started = timer.begin(active.id, pass)
    if (!started) { active.failure = timer.status === 'available' ? 'dropped' : timer.status; active.completed++ }
    return started
  }
  function end(): void { timer?.end() }
  function submitFrame(): void {
    if (!active) return
    active.submitted = true
    complete(active)
    active = null
  }
  function recorded(id: number | null): void {
    if (id === null) return
    const frame = frames.get(id)
    if (frame) { frame.recorded = true; complete(frame) }
  }
  function abortFrame(): void {
    if (!active) return
    frames.delete(active.id)
    active = null
  }
  function reset(): void {
    timer?.reset()
    frames.clear()
    active = null
    droppedFrames = 0
  }
  return {
    attach, detach, beginFrame, begin, end, submitFrame, recorded, abortFrame, poll, reset,
    snapshot: () => timer
      ? { status: timer.status, pending: timer.pending, dropped: timer.dropped, invalid: timer.invalid, droppedFrames }
      : { status: fallback, pending: 0, dropped: 0, invalid: 0, droppedFrames },
    dispose: detach,
  }
}
