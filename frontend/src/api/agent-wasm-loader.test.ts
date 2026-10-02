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
    expect(fetchMock).toHaveBeenCalledWith(`/wasm/${FAKE_PIN.commit}/fingerprint.json`)
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
