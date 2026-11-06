import { describe, expect, it, vi } from 'vitest'
import { createPerf, summarize } from './perf'

describe('performance samples', () => {
  it('uses nearest rank, true max, and filters invalid samples', () => {
    expect(summarize(Array.from({length: 240}, (_, i) => i + 1))).toMatchObject({p50:120,p90:216,p95:228,p99:238,max:240})
    expect(summarize([null, NaN, Infinity, -1])).toMatchObject({sampleCount:0,discarded:3,max:null})
  })
  it('counts invalid stage durations without turning them into zero', () => {
    const p = createPerf()
    p.record({ armorPick: NaN, armorState: Infinity, armorThick: -1 }, 1)
    const statistics = p.snapshot().statistics
    expect(statistics.armorPick).toMatchObject({ sampleCount: 0, discarded: 1, max: null })
    expect(statistics.armorState).toMatchObject({ sampleCount: 0, discarded: 1, max: null })
    expect(statistics.armorThick).toMatchObject({ sampleCount: 0, discarded: 1, max: null })
  })
  it('preserves latest across repeated wraps and resets idle intervals', () => {
    const p = createPerf()
    for (let i=0;i<481;i++) p.record({t:i}, i * 300)
    expect(p.snapshot().latest).toMatchObject({t:480,frameIntervalMs:300})
    expect(p.snapshot().sampleCount).toBe(240)
    p.idle(); p.record({t:481}, 999999)
    expect(p.snapshot().latest?.frameIntervalMs).toBeNull()
  })
  it('summarizes the whole capture rather than the rolling window', () => {
    let time = 0
    const p = createPerf({ now: () => time })
    p.startCapture({ scenarioId: 'long', durationMs: 60000 })
    for (let i = 1; i <= 300; i++) { time = i; p.record({ work: i }, time) }
    const captured = p.stopCapture()!
    expect(p.snapshot().sampleCount).toBe(240)
    expect(captured.statistics.work).toMatchObject({ sampleCount: 300, p50: 150, max: 300 })
  })
  it('associates late GPU samples with their original captured frame', () => {
    const p = createPerf({ capacity: 1, now: () => 0 })
    p.startCapture({ scenarioId: 'gpu' })
    p.record({ gpuFrameId: 4 }, 1); p.record({ gpuFrameId: 5 }, 2)
    p.gpuResult(4, 'main', 3.5)
    expect(p.stopCapture()?.frames[0].gpu_main_ms).toBe(3.5)
    expect(p.snapshot().latest?.gpu_main_ms).toBeUndefined()
    p.reset(); p.gpuResult(4, 'main', 99)
    expect(p.snapshot().sampleCount).toBe(0)
  })
  it('starts a new frame window on session change while preserving interrupted capture', () => {
    const p = createPerf({ now: () => 0 })
    p.beginSession(); p.startCapture({ scenarioId: 'old' }); p.record({ work: 100 }, 1)
    p.interrupt('file-change'); p.beginSession(); p.record({ work: 2 }, 1000)
    const snapshot = p.snapshot()
    expect(snapshot.sampleCount).toBe(1)
    expect(snapshot.latest).toMatchObject({ work: 2, frameIntervalMs: null })
    expect(snapshot.statistics.work.max).toBe(2)
    expect(snapshot.capture).toMatchObject({ interrupted: true, frames: [{ work: 100 }] })
  })
  it('keeps the newest frames after session change and repeated wraps', () => {
    const p = createPerf({ capacity: 3 })
    p.record({ work: 99 }, 0)
    p.beginSession()
    for (let i = 1; i <= 4; i++) p.record({ work: i }, i)
    expect(p.snapshot().statistics.work).toMatchObject({ sampleCount: 3, p50: 3, max: 4, p90: 4 })
    expect(p.snapshot().slowest.map(frame => frame.work).sort()).toEqual([2, 3, 4])
    for (let i = 5; i <= 7; i++) p.record({ work: i }, i)
    const snapshot = p.snapshot()
    expect(snapshot.statistics.work).toMatchObject({ sampleCount: 3, p50: 6, max: 7 })
    expect(snapshot.latest?.work).toBe(7)
  })
  it('keeps loading milestones in capture with their session identity', () => {
    const p = createPerf({ now: () => 0 })
    p.beginSession(); p.event({ stage: 'first' })
    p.beginSession(); p.event({ stage: 'second' })
    p.startCapture({ scenarioId: 'session' })
    p.event({ stage: 'ready' })
    const captured = p.stopCapture()!
    expect(captured.events.map(e => e.stage)).toEqual(['second', 'ready'])
    expect(captured.events.every(e => e.sessionId === p.snapshot().sessionId)).toBe(true)
  })
  it('counts dropped events for the capture session without attributing prior sessions', () => {
    const p = createPerf({ now: () => 0 })
    p.beginSession(); for (let i = 0; i < 501; i++) p.event({ stage: 'old' })
    p.beginSession(); p.event({ stage: 'new' }); p.startCapture({ scenarioId: 'new' })
    expect(p.stopCapture()?.droppedEvents).toBe(0)
  })
  it('ignores events from a reset epoch', () => {
    const p = createPerf(); const old = p.epoch
    p.reset(); p.event({ stage: 'old' }, old)
    expect(p.snapshot().events).toEqual([])
  })
  it('bounds capture by capacity and time and resets its state', () => {
    vi.useFakeTimers()
    let time=0
    const p=createPerf({now:()=>time,captureCapacity:2})
    p.startCapture({scenarioId:'one',durationMs:100})
    p.record({},time++); p.record({},time++)
    expect(p.snapshot().capture).toMatchObject({reason:'capacity',frames:[{},{}]})
    p.startCapture({scenarioId:'two',durationMs:100})
    time=102; vi.advanceTimersByTime(100)
    expect(p.snapshot().capture?.reason).toBe('duration')
    p.reset(); expect(p.snapshot().capture).toBeNull()
    vi.useRealTimers()
  })
})
