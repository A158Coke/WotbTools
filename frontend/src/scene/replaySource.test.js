/**
 * 3D 回放路径的契约门禁回归（PR #411 review blocker）：
 * 真实 3D 路径 = playbackScene → loadPlaybackData → loadFromLocalFile →
 * mod.parsePlayback；此前该路径只做 JSON.parse，错版 WASM 可静默载入 v1 数据
 * （缺 supremacy_bases/supremacy_points），版本门禁形同虚设。
 * 本测试证明该路径现在复用 validateAgentPlayback：v1 被拒、v2 通过。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_WASM_COMMIT,
  AGENT_WASM_RELEASE,
  __resetAgentWasmForTest,
  __setAgentWasmResolverForTest,
} from '../api/agent-replay-facets.js'
import {
  __resetPlaybackJsonCacheForTest,
  loadFromLocalFile,
  loadPlaybackData,
  playbackParsePayload,
} from './replaySource.js'

// 最小合法 v2 PlaybackData（字段齐备且版本为 2）
function v2Doc() {
  return {
    version: 2,
    meta: { map_id: 3, map_name: 'Middleburg', winner_team: 1, friendly_team: 2, author_eid: 7, t_start: 0, samples: 10, duration: 1 },
    vehicles: [], shots: [], kills: [], periods: [], visibility: [],
    supremacy_bases: [], supremacy_points: [],
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
  __resetPlaybackJsonCacheForTest()   // 同一份字节 + 不同 WASM 桩：跨用例必须清缓存
})

describe('3D 路径（loadFromLocalFile / loadPlaybackData）契约门禁', () => {
  it('v2 通过（version=2 且 v2 键齐备）', async () => {
    setWasm(v2Doc())
    const data = await loadFromLocalFile(blob())
    expect(data.version).toBe(2)
    expect(Array.isArray(data.supremacy_bases)).toBe(true)
  })

  it('解析结果缓存：同文件第二次打开不再走 WASM 解析，且返回同一结果', async () => {
    let parseCalls = 0
    __setAgentWasmResolverForTest(() => Promise.resolve({
      parsePlayback: () => { parseCalls += 1; return JSON.stringify(v2Doc()) },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tag: AGENT_WASM_RELEASE, upstream_commit: AGENT_WASM_COMMIT }),
    })))
    const file = blob()
    const a = await loadFromLocalFile(file)
    const b = await loadFromLocalFile(file)
    expect(parseCalls).toBe(1)          // 第二次命中缓存：WASM 解析只跑了一次
    expect(b.version).toBe(2)
    expect(a.version).toBe(b.version)
  })

  it('缓存命中不绕过契约门禁：错版文件两次都被拒', async () => {
    setWasm({ ...v2Doc(), version: 1 })
    const file = blob()
    await expect(loadFromLocalFile(file)).rejects.toThrow(/不支持的契约版本/)
    // 第二次走缓存（缓存的是解析产物，不是校验结论），仍必须被拒
    await expect(loadFromLocalFile(file)).rejects.toThrow(/不支持的契约版本/)
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

describe('解析结果缓存的 key 正确性（metadata 相同 ≠ 同一场）', () => {
  const fileWith = (bytes, name = 'same.wotbreplay', lastModified = 123456) =>
    new File([new Uint8Array(bytes)], name, { lastModified })

  it('同 name / 同 mtime / 同长度但内容不同 → 绝不命中（不得串用另一场的结果）', async () => {
    let parseCalls = 0
    const docs = [
      { ...v2Doc(), meta: { ...v2Doc().meta, map_name: 'A' } },
      { ...v2Doc(), meta: { ...v2Doc().meta, map_name: 'B' } },
    ]
    __setAgentWasmResolverForTest(() => Promise.resolve({
      parsePlayback: () => JSON.stringify(docs[parseCalls++]),
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tag: AGENT_WASM_RELEASE, upstream_commit: AGENT_WASM_COMMIT }),
    })))

    const a = fileWith([1, 2, 3, 4])
    const b = fileWith([1, 2, 9, 4])
    // 前提：三者（name / lastModified / 长度）确实相同——旧实现据此认为「同一场」
    expect(b.name).toBe(a.name)
    expect(b.lastModified).toBe(a.lastModified)
    expect(b.size).toBe(a.size)

    const first = await loadFromLocalFile(a)
    const second = await loadFromLocalFile(b)
    expect(parseCalls).toBe(2)               // 旧实现这里是 1（常量指纹 → 误命中）
    expect(first.meta.map_name).toBe('A')
    expect(second.meta.map_name).toBe('B')   // 第二次必须返回 B，不得复用 A
  })

  it('同一文件对象第二次打开 → 命中缓存（保留原语义）', async () => {
    let parseCalls = 0
    __setAgentWasmResolverForTest(() => Promise.resolve({
      parsePlayback: () => { parseCalls += 1; return JSON.stringify(v2Doc()) },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tag: AGENT_WASM_RELEASE, upstream_commit: AGENT_WASM_COMMIT }),
    })))
    const file = fileWith([7, 7, 7, 7])
    await loadFromLocalFile(file)
    await loadFromLocalFile(file)
    expect(parseCalls).toBe(1)
  })

  it('LRU 仍为最近 3 场：第 4 场挤出最旧，被触碰过的保留', async () => {
    let parseCalls = 0
    __setAgentWasmResolverForTest(() => Promise.resolve({
      parsePlayback: () => { parseCalls += 1; return JSON.stringify(v2Doc()) },
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tag: AGENT_WASM_RELEASE, upstream_commit: AGENT_WASM_COMMIT }),
    })))
    // 同名同 mtime，只靠内容指纹区分（同时压测指纹必须真的参与 key）
    const one = fileWith([1, 1, 1, 1]); const two = fileWith([2, 2, 2, 2])
    const three = fileWith([3, 3, 3, 3]); const four = fileWith([4, 4, 4, 4])

    await loadFromLocalFile(one); await loadFromLocalFile(two); await loadFromLocalFile(three)
    expect(parseCalls).toBe(3)
    await loadFromLocalFile(one)          // 命中并把 one 推到最新
    expect(parseCalls).toBe(3)
    await loadFromLocalFile(four)         // 第 4 场 → 挤出最旧（two）
    expect(parseCalls).toBe(4)
    await loadFromLocalFile(one)          // one 被触碰过 → 仍在
    expect(parseCalls).toBe(4)
    await loadFromLocalFile(two)          // two 已被挤出 → 重新解析
    expect(parseCalls).toBe(5)
  })
})

describe('playbackParsePayload（Worker 传输载荷）', () => {
  it('整段 buffer：直接复用同一 ArrayBuffer（不复制）', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(playbackParsePayload(bytes)).toBe(bytes.buffer)
  })

  it('切片视图：只发这一段，不带 backing buffer 的无关字节', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
    const view = backing.subarray(2, 5)
    expect(Array.from(new Uint8Array(playbackParsePayload(view)))).toEqual([1, 2, 3])
  })

  it('非 Uint8Array fail loud（类型语义必须明确）', () => {
    expect(() => playbackParsePayload(new ArrayBuffer(4))).toThrow(TypeError)
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
