import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBattleResult } from '../../api/agent-replay-facets.js'
import results from '../__golden__/wasm-results.json'
import type { CollectorTask } from './collectorWorkerProtocol.js'

const events = new EventTarget()
vi.stubGlobal('window', events)
const { tryCollect, __setCollectorWorkerFactoryForTest } = await import('./collector.js')
afterAll(() => vi.unstubAllGlobals())
const valid = results['random-battle-example.wotbreplay'] as unknown as AgentBattleResult
const blob = () => new Blob(['replay'])
function stub() {
  return {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage: vi.fn<(task: CollectorTask) => void>(), terminate: vi.fn(),
  }
}
type Stub = ReturnType<typeof stub>
const complete = (w: Stub, id = w.postMessage.mock.calls.at(-1)![0].id) => w.onmessage?.({ data: { id } } as MessageEvent)

describe('bounded best-effort Collector scheduler', () => {
  let workers: Stub[]
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('navigator', { onLine: true })
    vi.stubEnv('VITE_BATTLE_DATA_COLLECTOR_ENABLED', 'true')
    workers = []
    __setCollectorWorkerFactoryForTest(() => { const w = stub(); workers.push(w); return w as unknown as Worker })
  })
  afterEach(() => { __setCollectorWorkerFactoryForTest(null); vi.useRealTimers(); vi.unstubAllEnvs() })

  it('retains only one active + two waiting, drops excess without reading bytes', () => {
    const inputs = Array.from({ length: 5 }, blob)
    inputs.forEach(b => { vi.spyOn(b, 'arrayBuffer'); tryCollect(b, valid) })
    expect(workers).toHaveLength(1)
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1)
    expect(workers[0].postMessage.mock.calls[0][0].blob).toBe(inputs[0])
    complete(workers[0]); complete(workers[0]); complete(workers[0])
    expect(workers[0].postMessage.mock.calls.map(([t]) => t.blob)).toEqual(inputs.slice(0, 3))
    inputs.forEach(b => expect(b.arrayBuffer).not.toHaveBeenCalled())
  })
  it('accepts exact 32MiB files and 64MiB waiting; rejects oversized files', () => {
    const sizeOnly = (size: number) => ({ size, arrayBuffer: vi.fn() }) as unknown as Blob
    tryCollect(sizeOnly(32 * 1024 * 1024 + 1), valid)
    expect(workers).toHaveLength(0)
    const inputs = Array.from({ length: 4 }, () => sizeOnly(32 * 1024 * 1024))
    inputs.forEach(b => tryCollect(b, valid))
    complete(workers[0]); complete(workers[0]); complete(workers[0])
    expect(workers[0].postMessage.mock.calls.map(([t]) => t.blob)).toEqual(inputs.slice(0, 3))
  })
  it('timeout discards active and queue; new work recreates Worker, old replies ignored', () => {
    tryCollect(blob(), valid); tryCollect(blob(), valid)
    const old = workers[0], oldId = old.postMessage.mock.calls[0][0].id
    vi.advanceTimersByTime(15_000)
    expect(old.terminate).toHaveBeenCalledOnce()
    tryCollect(blob(), valid); tryCollect(blob(), valid)
    expect(workers).toHaveLength(2)
    complete(old, oldId)
    expect(workers[1].postMessage).toHaveBeenCalledOnce()
    complete(workers[1], oldId)
    expect(workers[1].postMessage).toHaveBeenCalledOnce()
    complete(workers[1])
    expect(workers[1].postMessage).toHaveBeenCalledTimes(2)
  })
  it('reuses idle Worker, releases it after 15s, and cancels idle timer for new work', () => {
    tryCollect(blob(), valid); complete(workers[0])
    vi.advanceTimersByTime(14_999); expect(workers[0].terminate).not.toHaveBeenCalled()
    tryCollect(blob(), valid); vi.advanceTimersByTime(1)
    expect(workers).toHaveLength(1); expect(workers[0].terminate).not.toHaveBeenCalled()
    complete(workers[0]); vi.advanceTimersByTime(15_000)
    expect(workers[0].terminate).toHaveBeenCalledOnce()
  })
  it.each(['offline', 'pagehide'])('%s drops queued work and does not resend on online', event => {
    tryCollect(blob(), valid); tryCollect(blob(), valid)
    events.dispatchEvent(new Event(event))
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    events.dispatchEvent(new Event('online')); vi.advanceTimersByTime(60_000)
    expect(workers).toHaveLength(1)
    tryCollect(blob(), valid); expect(workers).toHaveLength(2)
  })
  it('checks online/build flag before constructing or dispatching a Worker', () => {
    vi.stubGlobal('navigator', { onLine: false }); tryCollect(blob(), valid)
    expect(workers).toHaveLength(0)
    vi.stubGlobal('navigator', { onLine: true }); vi.stubEnv('VITE_BATTLE_DATA_COLLECTOR_ENABLED', 'false')
    tryCollect(blob(), valid); expect(workers).toHaveLength(0)
  })
  it('rechecks connectivity when dequeuing', () => {
    tryCollect(blob(), valid); tryCollect(blob(), valid)
    vi.stubGlobal('navigator', { onLine: false }); complete(workers[0])
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(workers[0].postMessage).toHaveBeenCalledOnce()
  })
  it.each(['error', 'messageerror'])('%s discards queue and allows later lazy recreation', event => {
    tryCollect(blob(), valid); tryCollect(blob(), valid)
    if (event === 'error') workers[0].onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
    else workers[0].onmessageerror?.()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    tryCollect(blob(), valid); expect(workers).toHaveLength(2)
  })
  it('contains constructor, postMessage, projection and terminate exceptions', () => {
    __setCollectorWorkerFactoryForTest(() => { throw Error('no Worker') })
    expect(() => tryCollect(blob(), valid)).not.toThrow()
    const w = stub(); w.postMessage.mockImplementation(() => { throw Error('clone failed') }); w.terminate.mockImplementation(() => { throw Error('terminate failed') })
    __setCollectorWorkerFactoryForTest(() => w as unknown as Worker)
    expect(() => tryCollect(blob(), valid)).not.toThrow()
    expect(w.terminate).toHaveBeenCalledOnce()
    const malformed = { get arena_bonus_type() { throw Error('bad projection') } } as AgentBattleResult
    expect(() => tryCollect(blob(), malformed)).not.toThrow()
    expect(() => tryCollect(null as unknown as Blob, valid)).not.toThrow()
  })
})
