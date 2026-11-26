import { assetProvider } from './assetProvider.js'
import * as pitchLimits from './pitchLimits.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  AGENT_WASM_COMMIT,
  AGENT_WASM_RELEASE,
  __resetAgentWasmForTest,
  __setAgentWasmResolverForTest,
} from '../api/agent-replay-facets.js'
import {
  __resetMapIndexForTest,
  __resetPlaybackJsonCacheForTest,
  __setParseWorkerForTest,
  exactArrayBuffer,
  loadFromLocalFile,
  loadPlaybackData,
  playbackParsePayload,
  replayContentDigest,
  resolveMapKey,
  mapStaticUrl,
} from './replaySource.js'

const sha256hex = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex')

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
  __resetPlaybackJsonCacheForTest()
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
    expect(parseCalls).toBe(1)
    expect(b.version).toBe(2)
    expect(a.version).toBe(b.version)
  })

  it('缓存命中不绕过契约门禁：错版文件两次都被拒', async () => {
    setWasm({ ...v2Doc(), version: 1 })
    const file = blob()
    await expect(loadFromLocalFile(file)).rejects.toThrow(/不支持的契约版本/)
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

  const legacySampledFingerprint = (bytes) => {
    const n = bytes.byteLength
    let h = 2166136261
    const window = 4096
    const step = Math.max(1, Math.floor(n / 3))
    for (const start of new Set([0, step, Math.max(0, n - window)])) {
      const end = Math.min(n, start + window)
      for (let i = start; i < end; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) }
    }
    return (h >>> 0).toString(36)
  }

  function countParses(docs) {
    let parseCalls = 0
    __setAgentWasmResolverForTest(() => Promise.resolve({
      parsePlayback: () => JSON.stringify(docs[parseCalls++] ?? docs[docs.length - 1]),
    }))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tag: AGENT_WASM_RELEASE, upstream_commit: AGENT_WASM_COMMIT }),
    })))
    return () => parseCalls
  }

  it('同 name / 同 mtime / 同长度但内容不同 → 绝不命中（不得串用另一场的结果）', async () => {
    const docs = [
      { ...v2Doc(), meta: { ...v2Doc().meta, map_name: 'A' } },
      { ...v2Doc(), meta: { ...v2Doc().meta, map_name: 'B' } },
    ]
    const parseCalls = countParses(docs)

    const a = fileWith([1, 2, 3, 4])
    const b = fileWith([1, 2, 9, 4])
    expect(b.name).toBe(a.name)
    expect(b.lastModified).toBe(a.lastModified)
    expect(b.size).toBe(a.size)

    const first = await loadFromLocalFile(a)
    const second = await loadFromLocalFile(b)
    expect(parseCalls()).toBe(2)
    expect(first.meta.map_name).toBe('A')
    expect(second.meta.map_name).toBe('B')
  })

  it('64KB：只改「旧采样窗口之外」的一个字节 → 必须 miss（旧首/中/尾方案在此必然 collision）', async () => {
    const size = 64 * 1024
    const a = new Uint8Array(size).fill(7)
    const b = new Uint8Array(size).fill(7)
    const step = Math.max(1, Math.floor(size / 3))
    const blindSpot = Math.floor(size * 0.7)
    b[blindSpot] = 9

    const fileA = new File([a], 'blind-spot.wotbreplay', { lastModified: 777 })
    const fileB = new File([b], 'blind-spot.wotbreplay', { lastModified: 777 })
    expect(fileB.name).toBe(fileA.name)
    expect(fileB.lastModified).toBe(fileA.lastModified)
    expect(fileB.size).toBe(fileA.size)

    const legacyWindows = [[0, 4096], [step, step + 4096], [size - 4096, size]]
    for (const [s, e] of legacyWindows) {
      expect(a.subarray(s, e)).toEqual(b.subarray(s, e))
    }
    expect(legacyWindows.some(([s, e]) => blindSpot >= s && blindSpot < e)).toBe(false)
    expect(legacySampledFingerprint(a)).toBe(legacySampledFingerprint(b))
    expect(await replayContentDigest(a)).not.toBe(await replayContentDigest(b))

    const docs = [
      { ...v2Doc(), meta: { ...v2Doc().meta, map_name: 'A' } },
      { ...v2Doc(), meta: { ...v2Doc().meta, map_name: 'B' } },
    ]
    const parseCalls = countParses(docs)
    const first = await loadFromLocalFile(fileA)
    const second = await loadFromLocalFile(fileB)
    expect(parseCalls()).toBe(2)
    expect(first.meta.map_name).toBe('A')
    expect(second.meta.map_name).toBe('B')
  })

  it('同一文件对象第二次打开 → 命中缓存（保留原语义）', async () => {
    const parseCalls = countParses([v2Doc()])
    const file = fileWith([7, 7, 7, 7])
    await loadFromLocalFile(file)
    await loadFromLocalFile(file)
    expect(parseCalls()).toBe(1)
  })

  it('WebCrypto 不可用 → 完全不使用缓存（宁可多解析一次，也不做概率性回退）', async () => {
    vi.stubGlobal('crypto', {})
    const parseCalls = countParses([v2Doc()])
    const file = fileWith([1, 2, 3, 4])
    const first = await loadFromLocalFile(file)
    const second = await loadFromLocalFile(file)
    expect(parseCalls()).toBe(2)
    expect(first.version).toBe(2)
    expect(second.version).toBe(2)
  })

  it('LRU 仍为最近 3 场：第 4 场挤出最旧，被触碰过的保留', async () => {
    const parseCalls = countParses([v2Doc()])
    const one = fileWith([1, 1, 1, 1]); const two = fileWith([2, 2, 2, 2])
    const three = fileWith([3, 3, 3, 3]); const four = fileWith([4, 4, 4, 4])

    await loadFromLocalFile(one); await loadFromLocalFile(two); await loadFromLocalFile(three)
    expect(parseCalls()).toBe(3)
    await loadFromLocalFile(one)
    expect(parseCalls()).toBe(3)
    await loadFromLocalFile(four)
    expect(parseCalls()).toBe(4)
    await loadFromLocalFile(one)
    expect(parseCalls()).toBe(4)
    await loadFromLocalFile(two)
    expect(parseCalls()).toBe(5)
  })
})

describe('内容身份与精确字节区间（exactArrayBuffer / replayContentDigest）', () => {
  it('digest 覆盖完整内容，与独立实现（node:crypto）一致', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    expect(await replayContentDigest(bytes)).toBe(sha256hex(bytes))
  })

  it('sliced view：只覆盖 byteOffset..byteOffset+byteLength，不吃 backing buffer', async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
    const view = backing.subarray(2, 5)
    const digest = await replayContentDigest(view)
    expect(digest).toBe(sha256hex(new Uint8Array([1, 2, 3])))
    expect(digest).not.toBe(sha256hex(backing))
  })

  it('exactArrayBuffer：整段零拷贝复用，切片只取该段，非 Uint8Array fail loud', () => {
    const whole = new Uint8Array([1, 2, 3])
    expect(exactArrayBuffer(whole)).toBe(whole.buffer)
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9])
    expect(Array.from(new Uint8Array(exactArrayBuffer(backing.subarray(2, 5))))).toEqual([1, 2, 3])
    expect(() => exactArrayBuffer(new ArrayBuffer(4))).toThrow(TypeError)
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
    expect(b0.owner_team).toBeNull()
    expect(b0.capturing_team).toBeNull()
    expect(b0.capture_progress).toBeNull()
    expect(b0.owner_team).not.toBe(0)
    const b1 = data.supremacy_bases[1]
    expect(b1.owner_team).toBe(1)
    expect(b1.capturing_team).toBeNull()
  })
})

it('迟到地图解析不会改变当前会话的资产 URL', async () => {
  const configured = vi.spyOn(assetProvider, 'configured').mockReturnValue(true)
  const json = vi.spyOn(assetProvider, 'json').mockResolvedValue({ maps: { 1: { key: 'map_a' }, 2: { key: 'map_b' } } })
  const url = vi.spyOn(assetProvider, 'url').mockImplementation((path) => 'https://assets.example' + path)
  try {
    __resetMapIndexForTest()
    const keyB = await resolveMapKey('id=2')
    await resolveMapKey('id=1')
    expect(mapStaticUrl('terrain', undefined, keyB)).toBe('https://assets.example/map/map_b/terrain.u16.bin')
    expect(mapStaticUrl('groundtex', 'cm', keyB)).toBe('https://assets.example/map/map_b/ground/cm.webp')
    expect(mapStaticUrl('map', undefined, null)).toBeNull()
  } finally {
    configured.mockRestore(); json.mockRestore(); url.mockRestore()
    __resetMapIndexForTest()
  }
})

describe('地图索引的失败语义', () => {
  it('index.json 瞬时失败 → 本次 null（告警），但不得缓存失败：下一次加载重试成功', async () => {
    const configured = vi.spyOn(assetProvider, 'configured').mockReturnValue(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = vi.spyOn(assetProvider, 'json')
      .mockRejectedValueOnce(new Error('asset /index.json: HTTP 502'))
      .mockResolvedValueOnce({ maps: { 3: { key: 'middleburg' } } })
    try {
      __resetMapIndexForTest()
      expect(await resolveMapKey('id=3&name=middleburg')).toBeNull()
      expect(json).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)

      expect(await resolveMapKey('id=3&name=middleburg')).toBe('middleburg')
      expect(json).toHaveBeenCalledTimes(2)

      expect(await resolveMapKey('id=3')).toBe('middleburg')
      expect(json).toHaveBeenCalledTimes(2)
    } finally {
      configured.mockRestore(); json.mockRestore(); warn.mockRestore()
      __resetMapIndexForTest()
    }
  })

  it('索引 miss（id 不在资产包）→ null + console 点名 id，按 id 去重不刷屏', async () => {
    const configured = vi.spyOn(assetProvider, 'configured').mockReturnValue(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = vi.spyOn(assetProvider, 'json').mockResolvedValue({ maps: { 1: { key: 'karelia' } } })
    try {
      __resetMapIndexForTest()
      expect(await resolveMapKey('id=42&name=new_map')).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('42')
      expect(await resolveMapKey('id=42&name=new_map')).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(await resolveMapKey('id=43')).toBeNull()
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      configured.mockRestore(); json.mockRestore(); warn.mockRestore()
      __resetMapIndexForTest()
    }
  })

  it('未配置资产 origin：不请求索引、不告警（UI 另有"资产源未配置"提示）', async () => {
    const configured = vi.spyOn(assetProvider, 'configured').mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = vi.spyOn(assetProvider, 'json')
    try {
      __resetMapIndexForTest()
      expect(await resolveMapKey('id=3')).toBeNull()
      expect(json).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      configured.mockRestore(); json.mockRestore(); warn.mockRestore()
      __resetMapIndexForTest()
    }
  })
})

describe('解析生命周期：abort / 看门狗 / 迟到回包', () => {
  it('abort：被撤下的解析立即以 AbortError 结束；同文件之后仍可正常解析（无残留状态）', async () => {
    setWasm(v2Doc())
    const controller = new AbortController()
    const stale = loadPlaybackData({ kind: 'local', file: blob(), signal: controller.signal })
    controller.abort()
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
    const data = await loadPlaybackData({ kind: 'local', file: blob(), signal: new AbortController().signal })
    expect(data.version).toBe(2)
  })

  it('abort 后到达的迟到回包被忽略（不产生未处理拒绝）；被撤下时 Worker 整体让位', async () => {
    setWasm(v2Doc())
    const fake = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
    __setParseWorkerForTest(fake)
    try {
      const controller = new AbortController()
      const stale = loadPlaybackData({ kind: 'local', file: blob(), signal: controller.signal })
      await vi.waitFor(() => { if (!fake.postMessage.mock.calls.length) throw new Error('not posted yet') })
      const requestId = fake.postMessage.mock.calls[0][0].id
      const staleSettled = expect(stale).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await staleSettled
      expect(fake.terminate).toHaveBeenCalledTimes(1)
      expect(() => fake.onmessage({ data: { id: requestId, json: JSON.stringify(v2Doc()) } })).not.toThrow()
    } finally {
      __setParseWorkerForTest(null)
    }
    const data = await loadPlaybackData({ kind: 'local', file: blob(), signal: new AbortController().signal })
    expect(data.version).toBe(2)
  })

  it('看门狗：Worker 不回包也不报错 → 超时整体失败 + terminate；下次请求重建并完成', async () => {
    setWasm(v2Doc())
    vi.useFakeTimers()
    try {
      const fake = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null }
      __setParseWorkerForTest(fake)
      const stuck = loadFromLocalFile(blob())
      await vi.waitFor(() => { if (!fake.postMessage.mock.calls.length) throw new Error('not posted yet') })
      vi.useFakeTimers()
      const watchdogSettled = expect(stuck).rejects.toThrow(/未回包/)
      await vi.advanceTimersByTimeAsync(120_000)
      await watchdogSettled
      expect(fake.terminate).toHaveBeenCalledTimes(1)
      expect(fake.postMessage).toHaveBeenCalledTimes(1)
      __setParseWorkerForTest(null)
      vi.useRealTimers()
      const data = await loadFromLocalFile(blob())
      expect(data.version).toBe(2)
    } finally {
      vi.useRealTimers()
      __setParseWorkerForTest(null)
    }
  })
})


describe('可选加载诊断', () => {
  it('区分冷解析与缓存命中，诊断异常不影响业务结果', async () => {
    setWasm(v2Doc())
    const file = blob()
    const events = []
    await loadFromLocalFile(file, undefined, event => events.push(event))
    expect(events).toContainEqual({ stage: 'json.cache', status: 'miss' })
    expect(events.some(event => event.stage === 'file.arrayBuffer' && event.durationMs >= 0)).toBe(true)
    expect(events.some(event => event.stage === 'first.parse' && event.durationMs >= 0)).toBe(true)
    const cached = []
    await loadFromLocalFile(file, undefined, event => cached.push(event))
    expect(cached).toContainEqual({ stage: 'json.cache', status: 'hit' })
    expect(cached).toContainEqual({ stage: 'first.parse', status: 'skipped' })
    await expect(loadFromLocalFile(file, undefined, () => { throw Error('observer') })).resolves.toMatchObject({ version: 2 })
  })
})


it('俯仰锚定失败保留首遍结果并标记 fallback', async () => {
  setWasm(v2Doc())
  const failed = vi.spyOn(pitchLimits, 'buildPitchLimits').mockRejectedValueOnce(new Error('unavailable'))
  try {
    const events = []
    const result = await loadFromLocalFile(blob(), undefined, event => events.push(event))
    expect(result.version).toBe(2)
    expect(events).toContainEqual({ stage: 'pitchLimits.wait', status: 'fallback' })
    expect(events).toContainEqual({ stage: 'second.parse', status: 'skipped' })
  } finally { failed.mockRestore() }
})


it('第二遍解析失败保留首遍结果并标记 fallback', async () => {
  setWasm(v2Doc())
  let calls = 0
  __setAgentWasmResolverForTest(() => Promise.resolve({ parsePlayback: () => {
    if (++calls === 2) throw new Error('second parse failed')
    return JSON.stringify(v2Doc())
  } }))
  const limits = vi.spyOn(pitchLimits, 'buildPitchLimits').mockResolvedValueOnce({ player: { dep: -5, ele: 10 } })
  try {
    const events = []
    const result = await loadFromLocalFile(blob(), undefined, event => events.push(event))
    expect(result.version).toBe(2)
    expect(events).toContainEqual({ stage: 'second.parse', status: 'fallback' })
    expect(calls).toBe(2)
  } finally { limits.mockRestore() }
})
