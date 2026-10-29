import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentBattleResult } from '../../api/agent-replay-facets.js'
import results from '../__golden__/wasm-results.json'
import { __setCollectorWorkerFactoryForTest } from './collector.js'
import { __setParseWorkerFactoryForTest, parseReplayFiles } from '../parseReplays.js'
import { replayFactsJson, replayRecorderAccountId } from '../submissionFacts.js'
import type { ParseMessage, ParseRequest } from '../parseWorkerProtocol.js'

const parse = vi.hoisted(() => vi.fn())
vi.mock('../../api/agent-replay-facets.js', () => ({ parseAgentResultFromBytes: parse }))
vi.mock('../battleFacts.js', () => ({ toBattleFacts: () => ({ arena_id: 'main-facts-unchanged', winner_team: 0 }) }))

const valid = results['random-battle-example.wotbreplay'] as unknown as AgentBattleResult
function collector(fault: string) {
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    terminate: vi.fn(),
    postMessage: vi.fn(() => {
      if (fault === 'postMessage') throw Error('clone failed')
      if (fault === 'crash') w.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent)
      // pending deliberately never completes.
    }),
  }
  const factory = vi.fn(() => {
    if (fault === 'constructor') throw Error('Worker unavailable')
    return w as unknown as Worker
  })
  __setCollectorWorkerFactoryForTest(factory)
  return { w, factory }
}

describe('main parser and HoF complete independently of Collector', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal('navigator', { onLine: true })
    vi.stubEnv('VITE_BATTLE_DATA_COLLECTOR_ENABLED', 'true')
    parse.mockResolvedValue(valid)
  })
  afterEach(() => {
    __setCollectorWorkerFactoryForTest(null); __setParseWorkerFactoryForTest(null)
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
  })
  it.each(['pending', 'constructor', 'postMessage', 'crash'])('batch result/progress unaffected by %s Collector', async fault => {
    const c = collector(fault)
    const order: string[] = []
    const main = {
      onmessage: null as ((e: MessageEvent<ParseMessage>) => void) | null,
      onerror: null,
      terminate: vi.fn(),
      postMessage(req: ParseRequest) {
        queueMicrotask(() => {
          main.onmessage?.({ data: { type: 'file', index: 0, file: { name: req.files[0].name, result: valid, error: null } } } as MessageEvent<ParseMessage>)
          main.onmessage?.({ data: { type: 'done' } } as MessageEvent<ParseMessage>)
        })
      },
    }
    __setParseWorkerFactoryForTest(() => main as unknown as Worker)
    const file = new File(['main replay bytes'], 'private-name.wotbreplay')
    const out = await parseReplayFiles([file], { onFile: () => order.push('file'), onProgress: () => order.push('progress') })
    expect(out).toEqual([{ name: file.name, result: valid, error: null }])
    expect(order).toEqual(['file', 'progress'])
    expect(main.terminate).toHaveBeenCalledOnce()
    expect(c.factory).toHaveBeenCalledOnce()
    if (fault === 'pending') {
      expect(c.w.terminate).not.toHaveBeenCalled()
      vi.advanceTimersByTime(15_000)
      expect(out[0].error).toBeNull()
      expect(out[0].result).toBe(valid)
    }
  })
  it.each(['pending', 'constructor', 'postMessage', 'crash'])('HoF Blob facts unaffected by %s Collector', async fault => {
    const c = collector(fault)
    const source = new Blob(['hof replay'])
    await expect(replayFactsJson(source)).resolves.toBe('{"arena_id":"main-facts-unchanged","winner_team":0}')
    expect(c.factory).toHaveBeenCalledOnce()
    if (fault === 'pending') {
      expect(c.w.postMessage.mock.calls[0]).toHaveLength(1)
      expect(c.w.terminate).not.toHaveBeenCalled()
    }
  })
  it('account verification parser does not collect', async () => {
    const c = collector('pending')
    await expect(replayRecorderAccountId(new Blob(['profile']))).resolves.toBe(valid.author_account_id)
    expect(c.factory).not.toHaveBeenCalled()
  })
})
