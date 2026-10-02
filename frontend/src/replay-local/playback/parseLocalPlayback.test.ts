import { beforeEach, describe, expect, it, vi } from 'vitest'

import wasmGolden from '../__golden__/wasm-playback.json'
import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia } from '../compute/tankopedia.js'
import { validateBattlePlaybackDataset } from '../../api/contract-runtime.js'

const facets = vi.hoisted(() => ({
  parseAgentResultFromBytes: vi.fn(),
  parseAgentPlaybackFromBytes: vi.fn(),
  parseAgentAiReviewFromBytes: vi.fn(),
}))
vi.mock('../../api/agent-replay-facets.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...facets,
}))

const { parseLocalPlayback } = await import('./parseLocalPlayback.js')
const { toBattlePlaybackDataset } = await import('./toBattlePlaybackDataset.js')
const { validateAgentPlayback } = await import('../../api/agent-replay-facets.js')

type Entry = { result: never; playback: unknown; aiDamage: Array<Record<string, unknown>> }
const golden = wasmGolden as unknown as Record<string, Entry>
const tankopedia = createTankopedia([tier7, tier8, tier9, tier10])

function arrange(file: string) {
  const g = golden[file]
  facets.parseAgentResultFromBytes.mockResolvedValue(g.result)
  facets.parseAgentPlaybackFromBytes.mockResolvedValue(validateAgentPlayback(structuredClone(g.playback)))
  facets.parseAgentAiReviewFromBytes.mockResolvedValue({ events: g.aiDamage.map((d) => ({ type: 'damage', ...d })) })
}

describe('parseLocalPlayback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('字节 → 与服务端同形状的 dataset + overview（合同校验通过）', async () => {
    arrange('cw-training-15-14-example.wotbreplay')
    const out = await parseLocalPlayback(new Uint8Array([1, 2, 3]), { tankopedia })
    expect(validateBattlePlaybackDataset(JSON.parse(JSON.stringify(out.dataset))).diagnostics).toEqual([])
    expect(out.overview?.mapCode).toBe('malinovka')
    expect(out.overview?.heatmaps.friendly.dwell).toHaveLength(36)
    expect(facets.parseAgentPlaybackFromBytes).toHaveBeenCalledTimes(1)
  })

  it('AiReview 入口失败不阻断回放：退化为 shots[] 归因', async () => {
    arrange('random-battle-example.wotbreplay')
    facets.parseAgentAiReviewFromBytes.mockRejectedValue(new Error('boom'))
    const out = await parseLocalPlayback(new Uint8Array([1]), { tankopedia })
    const g = golden['random-battle-example.wotbreplay']
    const expected = toBattlePlaybackDataset(validateAgentPlayback(structuredClone(g.playback)), g.result, { tankopedia })
    expect(out.dataset).toEqual(expected)
  })

  it('9.8 训练室（无 period 广播，服务端 timeline 不可用）：本地同样 unavailable，与 Java 一致', async () => {
    arrange('training-room-example.wotbreplay')
    const out = await parseLocalPlayback(new Uint8Array([1]), { tankopedia })
    expect(out.dataset).toBeNull()
    expect(out.overview).toBeNull()
  })
})
