type PerfFrame = { at: number; frameIntervalMs: number | null; sequence: number; gpuFrameId?: number | null; gpuStatus?: string; [key: string]: number | string | null | undefined }
export function summarize(values: Array<number | null>) {
  const valid = values.filter((n): n is number => n !== null && Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
  const q = (p: number) => valid.length ? valid[Math.ceil(p * valid.length) - 1] : null
  return { sampleCount: valid.length, discarded: values.filter(n => n !== null).length - valid.length,
    p50: q(.5), p90: q(.9), p95: q(.95), p99: q(.99), max: valid.length ? valid[valid.length - 1] : null }
}
type Capture = { scenarioId: string; durationMs: number; startedAt: number; frames: PerfFrame[]; stoppedAt: number | null; reason: string | null; interrupted: boolean; identity: Record<string, unknown>; events: Record<string, unknown>[]; droppedEvents: number }
export function createPerf({ now = () => performance.now(), capacity = 240, captureCapacity = 20000 }: { now?: () => number; capacity?: number; captureCapacity?: number } = {}) {
  let frames: PerfFrame[] = []
  let gpuFrames = new Map<number, PerfFrame>()
  let sequence = 0
  let sessionStartSequence = 0
  let lastAt: number | null = null
  let capture: Capture | null = null
  let captureFirstSequence = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let epoch = 0
  let sessionId = 0
  let droppedEvents = 0
  let sessionDroppedEvents = 0
  let events: Record<string, unknown>[] = []
  let identity: Record<string, unknown> = { identityComplete: false }
  function finish(reason: string) {
    if (!capture || capture.stoppedAt !== null) return
    capture.stoppedAt = now(); capture.reason = reason
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  function statisticsFor(rows: PerfFrame[]) {
    const keys = new Set(rows.flatMap(row => Object.keys(row)).filter(k => !['at', 'sequence', 't', 'gpuFrameId', 'gpuStatus'].includes(k)))
    return Object.fromEntries([...keys].map(key => [key, summarize(rows.map(row => typeof row[key] === 'number' ? row[key] as number : null))]))
  }
  function slowFrames(rows: PerfFrame[]) {
    const intervals = rows.map(row => row.frameIntervalMs).filter((n): n is number => n !== null && Number.isFinite(n) && n >= 0)
    return { over16_7ms: intervals.filter(n => n > 1000 / 60).length, over33_3ms: intervals.filter(n => n > 1000 / 30).length,
      over50ms: intervals.filter(n => n > 50).length, over100ms: intervals.filter(n => n > 100).length }
  }
  function snapshot() {
    const rows = [...frames].sort((a,b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    const statistics = statisticsFor(rows)
    const slowest = rows.filter(r => r.frameIntervalMs !== null && Number.isFinite(r.frameIntervalMs) && r.frameIntervalMs >= 0).sort((a, b) => b.frameIntervalMs! - a.frameIntervalMs!).slice(0, 12).map(r => ({ ...r }))
    return { sessionId, sessionFrames: sequence - sessionStartSequence, droppedEvents, identity: { ...identity, viewport: Array.isArray(identity.viewport) ? [...identity.viewport] : identity.viewport }, events: events.map(e => ({ ...e })), sampleCount: rows.length, totalFrames: sequence, windowMs: rows.length > 1 ? rows[rows.length-1].at - rows[0].at : 0,
      latest: rows.length ? { ...rows[rows.length-1] } : null, statistics, slowest, slowFrames: slowFrames(rows),
      capture: capture ? { ...capture, identity: { ...capture.identity, viewport: Array.isArray(capture.identity.viewport) ? [...capture.identity.viewport] : capture.identity.viewport }, events: capture.events.map(e => ({ ...e })), frames: capture.frames.map(f => ({ ...f })), statistics: statisticsFor(capture.frames), slowFrames: slowFrames(capture.frames) } : null }
  }
  return {
    record(data: Record<string, number | null>, at = now()) {
      const interval = lastAt === null ? null : at - lastAt
      lastAt = at
      const frame: PerfFrame = { ...data, at, frameIntervalMs: interval, sequence: sequence++, gpuStatus: typeof data.gpuFrameId === 'number' ? 'pending' : 'unsupported' }
      if (typeof data.gpuFrameId === 'number') gpuFrames.set(data.gpuFrameId, frame)
      if (frames.length < capacity) frames.push(frame); else {
        const index = (frame.sequence - sessionStartSequence) % capacity
        const old = frames[index]
        if (typeof old.gpuFrameId === 'number' && !(capture && old.sequence! >= captureFirstSequence && old.sequence! < captureFirstSequence + capture.frames.length)) gpuFrames.delete(old.gpuFrameId)
        frames[index] = frame
      }
      if (capture && capture.stoppedAt === null) {
        if (at - capture.startedAt >= capture.durationMs) finish('duration')
        else { capture.frames.push(frame); if (capture.frames.length >= captureCapacity) finish('capacity') }
      }
    },
    gpuResult(frameId: number, pass: string, durationMs: number | null) {
      const frame = gpuFrames.get(frameId)
      if (frame) frame[`gpu_${pass}_ms`] = durationMs
    },
    gpuStatus(frameId: number, status: string) {
      const frame = gpuFrames.get(frameId)
      if (frame) frame.gpuStatus = status
    },
    idle() { lastAt = null },
    interrupt(reason: string) { if (capture && capture.stoppedAt === null) { capture.interrupted = true; finish(reason) } },
    get epoch() { return epoch },
    beginSession() {
      sessionId++; sessionDroppedEvents = 0; sessionStartSequence = sequence; frames = []; lastAt = null
      gpuFrames = new Map((capture?.frames ?? []).filter(f => typeof f.gpuFrameId === 'number').map(f => [f.gpuFrameId!, f]))
    },
    event(event: Record<string, unknown>, expectedEpoch = epoch) {
      if (expectedEpoch !== epoch) return
      const entry = { ...event, sessionId }
      events.push(entry); if (events.length > 500) { const removed = events.shift(); droppedEvents++; if (removed?.sessionId === sessionId) sessionDroppedEvents++ }
      if (capture && capture.stoppedAt === null) { capture.events.push(entry); if (capture.events.length > 500) { capture.events.shift(); capture.droppedEvents++ } }
    },
    setIdentity(value: Record<string, unknown>) { identity = { ...identity, ...value } },
    snapshot,
    report() {
      const s = snapshot()
      const lines = [s.sampleCount ? `frames=${s.sessionFrames} (window ${s.sampleCount}, ${s.windowMs.toFixed(1)}ms)` : 'no frames',
        `identity: ${JSON.stringify(s.identity)}`, `events (dropped=${s.droppedEvents}): ${JSON.stringify(s.events)}`]
      for (const [key, stats] of Object.entries(s.statistics)) lines.push(`${key}: ${JSON.stringify(stats)}`)
      lines.push(`now: ${JSON.stringify(s.latest)}`)
      lines.push(`slow frames: ${JSON.stringify(s.slowFrames)}`)
      lines.push(`slowest frames: ${JSON.stringify(s.slowest)}`)
      return lines.join('\n')
    },
    startCapture({ scenarioId, durationMs = 60000 }: { scenarioId: string; durationMs?: number }) {
      if (capture && capture.stoppedAt === null) throw new Error('capture already running')
      if (typeof scenarioId !== 'string' || !scenarioId || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('invalid capture options')
      captureFirstSequence = sequence
      gpuFrames = new Map(frames.filter(f => typeof f.gpuFrameId === 'number').map(f => [f.gpuFrameId!, f]))
      capture = { scenarioId, durationMs: Math.min(durationMs, 60000), startedAt: now(), frames: [], stoppedAt: null, reason: null, interrupted: false, identity: { ...identity, viewport: Array.isArray(identity.viewport) ? [...identity.viewport] : identity.viewport }, events: events.filter(e => e.sessionId === sessionId).map(e => ({ ...e })), droppedEvents: sessionDroppedEvents }
      timer = setTimeout(() => finish('duration'), capture.durationMs)
    },
    stopCapture() { finish('manual'); return snapshot().capture },
    reset() { if (timer !== null) clearTimeout(timer); timer = null; frames = []; gpuFrames.clear(); sequence = 0; sessionStartSequence = 0; lastAt = null; capture = null; events = []; droppedEvents = 0; sessionDroppedEvents = 0; epoch++ },
  }
}
