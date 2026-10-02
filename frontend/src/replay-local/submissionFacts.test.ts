import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../utils/http.js'

// mock 最底层 WASM 解析与结算事实投影：只测 submissionFacts 的顺序 / 失败映射契约。
const wasm = vi.hoisted(() => ({ parseAgentResultFromBytes: vi.fn() }))
vi.mock('../api/agent-replay-facets.js', () => wasm)
vi.mock('./battleFacts.js', () => ({
  toBattleFacts: (result: { text: string }) => ({ source: result.text }),
}))

import { appendReplayFacts, replayFactsJson, replayRecorderAccountId } from './submissionFacts.js'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('submissionFacts', () => {
  beforeEach(() => {
    wasm.parseAgentResultFromBytes.mockReset()
    wasm.parseAgentResultFromBytes.mockImplementation(async (bytes: Uint8Array) => ({ text: decode(bytes), author_account_id: 77 }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('replayFactsJson projects the locally parsed result to facts JSON', async () => {
    await expect(replayFactsJson(new Blob(['abc']))).resolves.toBe(JSON.stringify({ source: 'abc' }))
  })

  it('replayFactsJson maps any local parse failure to INVALID_REPLAY_FILE', async () => {
    wasm.parseAgentResultFromBytes.mockRejectedValue(new Error('corrupt'))
    const error = await replayFactsJson(new Blob(['x'])).catch(e => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('INVALID_REPLAY_FILE')
  })

  it('appendReplayFacts appends one facts entry per replay in order, replacing stale facts', async () => {
    const fd = new FormData()
    fd.append('facts', 'stale')
    fd.append('replays', new File(['one'], '1.wotbreplay'))
    fd.append('replays', new File(['two'], '2.wotbreplay'))

    await appendReplayFacts(fd)

    expect((fd.getAll('facts') as string[]).map(f => JSON.parse(f).source)).toEqual(['one', 'two'])
  })

  it('replayRecorderAccountId returns the recorder id; missing id → INVALID_REPLAY_FILE', async () => {
    await expect(replayRecorderAccountId(new Blob(['x']))).resolves.toBe(77)

    wasm.parseAgentResultFromBytes.mockResolvedValue({ text: 'x', author_account_id: 0 })
    const error = await replayRecorderAccountId(new Blob(['x'])).catch(e => e)
    expect(error.code).toBe('INVALID_REPLAY_FILE')
  })
})
