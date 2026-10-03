/**
 * Agent WASM 装载的 URL identity 与版本门禁（stale WASM 的根因回归）。
 *
 * 旧行为：固定 `/wasm/wotb_replay_wasm.js` → 浏览器长期缓存里躺着**别的 build 的
 * Agent**，同一个 frontend 用错版引擎解析，直到 AI Review 才以 `poses` 缺失暴露。
 *
 * 现在锁定：
 *  - URL 是 commit-addressed（`/wasm/<source.json ref>/…`），不再有 stable 路径；
 *  - fingerprint 在 dynamic import **之前**校验（commit/tag 任一不符即失败）；
 *  - 不一致抛 `AgentWasmVersionMismatchError`，且**绝不调用 parse\***。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './agent-replay-facets.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PIN = JSON.parse(readFileSync(resolve(REPO, 'deploy/agent/source.json'), 'utf8'))
const PINNED_COMMIT = PIN.ref
const PINNED_RELEASE = PIN.artifact.release

/** 假 pin（与真实 source.json 无关），用于驱动装载路径的成功/失败分支 */
const FAKE_PIN = { release: 'v0.9.9', commit: 'a'.repeat(40) }
const FAKE_MODULE = { parseResult: () => '{}', default: async () => {} }

function fetchServing(fingerprint, { ok = true, status = 200 } = {}) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => fingerprint,
  }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  api.__resetAgentWasmForTest()
})

afterEach(() => {
  vi.unstubAllGlobals()
  api.__resetAgentWasmForTest()
})

describe('Agent WASM URL identity（commit-addressed，stable 路径已废除）', () => {
  it('装载 URL 与 fingerprint URL 都带 build 期 pin 的 commit', () => {
    // vite `define` 在测试里已被替换为真实 source.json 的值（vite.config.js 是唯一 SSOT）
    expect(api.AGENT_WASM_COMMIT).toBe(PINNED_COMMIT)
    expect(api.AGENT_WASM_RELEASE).toBe(PINNED_RELEASE)
    expect(api.agentWasmBase()).toBe(`/wasm/${PINNED_COMMIT}`)
    expect(api.agentWasmModuleUrl()).toBe(`/wasm/${PINNED_COMMIT}/wotb_replay_wasm.js`)
    expect(api.agentWasmFingerprintUrl()).toBe(`/wasm/${PINNED_COMMIT}/fingerprint.json`)
  })

  it('不存在 stable /wasm/wotb_replay_wasm.js 引用', () => {
    const source = readFileSync(resolve(REPO, 'frontend/src/api/agent-replay-facets.ts'), 'utf8')
    expect(source).not.toContain("'/wasm/wotb_replay_wasm.js'")
  })
})

describe('Agent WASM 版本门禁（fingerprint 先于模块解析）', () => {
  it('fingerprint 匹配 → 通过注桩装载模块（URL 用 build 期 pin 的 commit）', async () => {
    const fetchMock = fetchServing({ tag: FAKE_PIN.release, upstream_commit: FAKE_PIN.commit })
    vi.stubGlobal('fetch', fetchMock)
    api.__setAgentWasmResolverForTest(async (expected) => {
      expect(expected).toEqual(FAKE_PIN)
      return FAKE_MODULE
    })
    await expect(api.loadAgentWasmModule(FAKE_PIN)).resolves.toBe(FAKE_MODULE)
    // fingerprint 请求带专属 AbortSignal（body 阶段超时要能真正切断请求）
    expect(fetchMock).toHaveBeenCalledWith(
      `/wasm/${FAKE_PIN.commit}/fingerprint.json`,
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('commit 不一致 → AgentWasmVersionMismatchError（携带四个可诊断字段）', async () => {
    vi.stubGlobal('fetch', fetchServing({ tag: FAKE_PIN.release, upstream_commit: 'f'.repeat(40) }))
    const error = await api.loadAgentWasm(FAKE_PIN).catch((e) => e)
    expect(error).toBeInstanceOf(api.AgentWasmVersionMismatchError)
    expect(error.expectedCommit).toBe(FAKE_PIN.commit)
    expect(error.expectedRelease).toBe(FAKE_PIN.release)
    expect(error.actualCommit).toBe('f'.repeat(40))
    expect(error.actualRelease).toBe(FAKE_PIN.release)
  })

  it('release 不一致 → AgentWasmVersionMismatchError', async () => {
    vi.stubGlobal('fetch', fetchServing({ tag: 'v0.0.1', upstream_commit: FAKE_PIN.commit }))
    const error = await api.loadAgentWasm(FAKE_PIN).catch((e) => e)
    expect(error).toBeInstanceOf(api.AgentWasmVersionMismatchError)
    expect(error.actualRelease).toBe('v0.0.1')
  })

  it('fingerprint 404 / 非 JSON / 缺字段 → 一律 fail closed', async () => {
    const cases = [
      fetchServing(null, { ok: false, status: 404 }),
      vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } })),
      fetchServing({ tag: FAKE_PIN.release }),
      fetchServing({ upstream_commit: FAKE_PIN.commit }),
      fetchServing([1, 2, 3]),
    ]
    for (const fetchMock of cases) {
      vi.stubGlobal('fetch', fetchMock)
      await expect(api.loadAgentWasm(FAKE_PIN)).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
    }
  })

  it('fingerprint 网络不可读 → fail closed（不是静默降级）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(api.verifyAgentWasmFingerprint(FAKE_PIN)).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
  })

  it('错版时不调用任何 parse*（不允许跑到 poses 缺失才发现）', async () => {
    let resolverCalls = 0
    api.__setAgentWasmResolverForTest(async () => { resolverCalls++; return FAKE_MODULE })
    vi.stubGlobal('fetch', fetchServing({ tag: 'v0.0.1', upstream_commit: 'f'.repeat(40) }))

    // 真实路径下的顺序是「先 fingerprint 再解析模块」，所以错版时模块从未装载，
    // 桩 resolver 一次都不会被调用——parse* 在拿到引擎之前就失败了。
    expect(api.agentWasmIdentity()).toBeNull()
    for (const parse of [
      api.parseAgentResultFromBytes,
      api.parseAgentPlaybackFromBytes,
      api.parseAgentAiReviewFromBytes,
      api.parseAgentShotsFromBytes,
    ]) {
      await expect(parse(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
    }
    expect(resolverCalls).toBe(0)
  })

  it('真实（未注桩）路径：fingerprint 校验失败时装载直接失败，不产生模块缓存', async () => {
    api.__setAgentWasmResolverForTest(null)
    vi.stubGlobal('fetch', fetchServing({ tag: FAKE_PIN.release, upstream_commit: 'f'.repeat(40) }))
    await expect(api.loadAgentWasm(FAKE_PIN)).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
    // 失败不得留下"已装载"的 identity（否则后续调用会以为产物可用）
    expect(api.agentWasmIdentity()).toBeNull()
  })
})

/**
 * 看门狗必须覆盖**完整 fingerprint request lifecycle**（request → headers → body →
 * JSON parse），不能只包 `fetch()`。
 *
 * 为什么这是独立的 P0 回归：`fetch()` 在**收到 response headers 后就 resolve**。
 * CDN / 代理「headers 正常返回、body 永久不结束」时，只包 fetch 的 20s 看门狗形同虚设——
 * `await response.json()` 仍可永久 pending，而 `fingerprintPromises` 会把这个 pending
 * Promise 缓存起来给整个页面会话复用（它是 thenable，不是 null），于是「解析永久卡住」
 * 的原始 failure mode 原样保留。这里用 `json()` 永不 settle 的 Response-like 对象锁死它：
 * 删除 body 阶段的看门狗（回到只包 fetch）后，用例 1 会以「永久 pending」失败。
 */
describe('fingerprint 看门狗覆盖 body 阶段（headers 已到、body 永久不结束）', () => {
  const STALL_TIMEOUT_MS = 50

  /** headers 正常返回的 Response-like：`json()` 永不 settle（body 停滞） */
  function fetchWithStalledBody() {
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) signals.push(init.signal)
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise<never>(() => {}),
      })
    })
    return { fetchMock, signals }
  }

  beforeEach(() => {
    api.__setAgentWasmTimeoutForTest(STALL_TIMEOUT_MS)
  })

  it('body 停滞 → 有限时间内 reject（不是永久 pending），且 abort 真的切断了请求', async () => {
    const { fetchMock, signals } = fetchWithStalledBody()
    vi.stubGlobal('fetch', fetchMock)

    const error = await api.verifyAgentWasmFingerprint(FAKE_PIN).then(
      () => { throw new Error('body 停滞的 fingerprint 竟然成功了') },
      (e) => e,
    )
    expect(error).toBeInstanceOf(api.AgentWasmVersionMismatchError)   // fail closed，保持既有语义
    expect(String(error.message)).toMatch(/未完成/)
    expect(String(error.message)).toMatch(/fingerprint .*fingerprint\.json/)   // 点明是哪个 URL 停滞
    // 专属 AbortController：超时不是「放弃等待」，而是真的 abort 掉网络请求 / body stream
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
    expect((signals[0].reason as DOMException | undefined)?.name).toBe('TimeoutError')
  })

  it('超时清掉 fingerprintPromises 缓存：下一次调用重新发起请求并可正常完成', async () => {
    const stalled = fetchWithStalledBody()
    vi.stubGlobal('fetch', stalled.fetchMock)
    await expect(api.verifyAgentWasmFingerprint(FAKE_PIN)).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
    expect(stalled.fetchMock).toHaveBeenCalledTimes(1)

    // 第二次：正常 body（缓存必须已被超时清掉，否则这里会拿到上一次的 pending/拒绝）
    const fetchMock = fetchServing({ tag: FAKE_PIN.release, upstream_commit: FAKE_PIN.commit })
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.verifyAgentWasmFingerprint(FAKE_PIN)).resolves.toEqual({
      tag: FAKE_PIN.release,
      upstream_commit: FAKE_PIN.commit,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)   // 重新发起，而不是复用缓存

    // 成功结果照常进缓存：第三次不再请求
    await expect(api.verifyAgentWasmFingerprint(FAKE_PIN)).resolves.toEqual({
      tag: FAKE_PIN.release,
      upstream_commit: FAKE_PIN.commit,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('body 停滞会连带拖死 loadAgentWasm / loadAgentWasmModule：两者都必须在有限时间内失败', async () => {
    const { fetchMock } = fetchWithStalledBody()
    vi.stubGlobal('fetch', fetchMock)
    let resolverCalls = 0
    api.__setAgentWasmResolverForTest(async () => { resolverCalls++; return FAKE_MODULE })

    // 无超时的话这两条都是永久 pending（装载链没有别的失败出口）
    await expect(api.loadAgentWasm(FAKE_PIN)).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
    await expect(api.loadAgentWasmModule(FAKE_PIN)).rejects.toBeInstanceOf(api.AgentWasmVersionMismatchError)
    expect(resolverCalls).toBe(0)              // 产物身份没通过门禁，模块桩从未被调用
    expect(api.agentWasmIdentity()).toBeNull()
  })

  it('boundary：HTTP error / 非法 JSON / 身份不一致 仍按原语义立刻失败，不吃看门狗', async () => {
    // 这些分支不依赖 body 停滞：必须在远早于看门狗的时刻就结束（用超长超时证明）
    api.__setAgentWasmTimeoutForTest(60_000)
    const cases: Array<[ReturnType<typeof vi.fn>, RegExp]> = [
      [fetchServing(null, { ok: false, status: 503 }), /HTTP 503/],
      [vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json') } })), /不是合法 JSON/],
      [fetchServing({ tag: FAKE_PIN.release, upstream_commit: 'f'.repeat(40) }), /upstream_commit/],
      [fetchServing({ tag: 'v0.0.1', upstream_commit: FAKE_PIN.commit }), /tag/],
      [vi.fn(async () => { throw new TypeError('Failed to fetch') }), /不可读/],
    ]
    for (const [fetchMock, pattern] of cases) {
      vi.stubGlobal('fetch', fetchMock)
      const error = await api.verifyAgentWasmFingerprint(FAKE_PIN).catch((e) => e)
      expect(error).toBeInstanceOf(api.AgentWasmVersionMismatchError)
      expect(String(error.message)).toMatch(pattern)
      expect(String(error.message)).not.toMatch(/未完成/)   // 不是被看门狗兜掉的
    }
    // 身份/HTTP/JSON 失败同样是 fail closed：产物从未建立
    expect(api.agentWasmIdentity()).toBeNull()
  })

  it('成功路径不留下 abort listener：已 settle 的清单不会在超时后被 abort', async () => {
    const seen: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) seen.push(init.signal)
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ tag: FAKE_PIN.release, upstream_commit: FAKE_PIN.commit }),
      })
    }))
    await api.verifyAgentWasmFingerprint(FAKE_PIN)
    expect(seen).toHaveLength(1)
    expect(seen[0].aborted).toBe(false)

    // 成功路径必须摘掉 listener / 清掉 timer：切到假定时器把超时窗口推过去，
    // 若还有残留的 abort 任务，signal 会被 abort（挂着的 listener 也会被调用）
    vi.useFakeTimers()
    try {
      let aborted = false
      seen[0].addEventListener('abort', () => { aborted = true })
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 4)
      expect(aborted).toBe(false)
      expect(seen[0].aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
