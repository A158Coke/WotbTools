/**
 * 3D 回放路径的契约门禁回归（PR #411 review blocker）：
 * 真实 3D 路径 = playbackScene → loadPlaybackData → loadFromLocalFile →
 * mod.parsePlayback；此前该路径只做 JSON.parse，错版 WASM 可静默载入 v1 数据
 * （缺 supremacy_bases/supremacy_points/aim_frames），版本门禁形同虚设。
 * 本测试证明该路径现在复用 validateAgentPlayback：v1 被拒、v2 通过。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_WASM_COMMIT,
  AGENT_WASM_RELEASE,
  __resetAgentWasmForTest,
  __setAgentWasmResolverForTest,
} from '../api/agent-replay-facets.js'
import { loadFromLocalFile, loadPlaybackData } from './replaySource.js'

// 最小合法 v2 PlaybackData（字段齐备且版本为 2）
function v2Doc() {
  return {
    version: 2,
    meta: { map_id: 3, map_name: 'Middleburg', winner_team: 1, friendly_team: 2, author_eid: 7, t_start: 0, samples: 10, duration: 1 },
    vehicles: [], shots: [], kills: [], periods: [], visibility: [],
    supremacy_bases: [], supremacy_points: [], aim_frames: [],
  }
}
const stub = (doc) => ({ parsePlayback: () => JSON.stringify(doc) })
const blob = () => new Blob([new Uint8Array([1, 2, 3])])

/**
 * 装载器桩：3D 路径与表格/AI 路径共用 `loadAgentWasmModule`，测试在此注入产物
 * （不依赖真实 WASM）。fingerprint 门禁仍生效，所以同时桩住 versioned 清单。
 */
function setWasm(doc) {
  __setAgentWasmResolverForTest(() => Promise.resolve(stub(doc)))
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    expect(url).toBe(`/wasm/${AGENT_WASM_COMMIT}/fingerprint.json`)
    return { ok: true, status: 200, json: async () => ({ tag: AGENT_WASM_RELEASE, upstream_commit: AGENT_WASM_COMMIT }) }
  }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  __resetAgentWasmForTest()
})

describe('3D 路径（loadFromLocalFile / loadPlaybackData）契约门禁', () => {
  it('v2 通过（version=2 且 v2 键齐备）', async () => {
    setWasm(v2Doc())
    const data = await loadFromLocalFile(blob())
    expect(data.version).toBe(2)
    expect(Array.isArray(data.supremacy_bases)).toBe(true)
  })

  it('v1 被拒——经 loadFromLocalFile 抛出版本错误（不再静默通过）', async () => {
    const v1 = { ...v2Doc(), version: 1 }
    delete v1.supremacy_bases
    setWasm(v1)
    await expect(loadFromLocalFile(blob())).rejects.toThrow(/不支持的契约版本/)
  })

  it('v1 被拒——经 loadPlaybackData 统一入口同样抛出', async () => {
    setWasm({ ...v2Doc(), version: 1 })
    await expect(loadPlaybackData({ kind: 'local', file: blob() })).rejects.toThrow(/不支持的契约版本/)
  })

  it('错版（version=3）同样被拒', async () => {
    setWasm({ ...v2Doc(), version: 3 })
    await expect(loadFromLocalFile(blob())).rejects.toThrow(/不支持的契约版本/)
  })
})

describe('Supremacy base 空态可空性（PR #411 review blocker）', () => {
  it('neutral/cleared 态的显式 null 被保留，不会被当作有值', async () => {
    const doc = v2Doc()
    doc.supremacy_bases = [
      { clock: 37, base_id: 1, owner_team: null, capturing_team: null, capture_progress: null },
      { clock: 40, base_id: 2, owner_team: 1, capturing_team: null, capture_progress: null },
    ]
    setWasm(doc)
    const data = await loadFromLocalFile(blob())
    const b0 = data.supremacy_bases[0]
    // null 必须原样保留（不是 undefined、不是 0）——渲染侧据此判定"无主/未占领"
    expect(b0.owner_team).toBeNull()
    expect(b0.capturing_team).toBeNull()
    expect(b0.capture_progress).toBeNull()
    expect(b0.owner_team).not.toBe(0)      // 0 是一个合法队伍值，不得混淆
    const b1 = data.supremacy_bases[1]
    expect(b1.owner_team).toBe(1)
    expect(b1.capturing_team).toBeNull()
  })
})
