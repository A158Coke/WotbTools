import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from './agent-replay-facets.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PIN = JSON.parse(readFileSync(resolve(REPO, 'deploy/agent/source.json'), 'utf8')) as {
  ref: string
  artifact: { release: string }
}

const VALID: api.AgentAuthorInitialPosition = {
  author_eid: 1961229,
  clock: 0.410819,
  position: [-138.75604, 31.585732, -165.30302],
}

function stubWasm(module: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag: PIN.artifact.release, upstream_commit: PIN.ref }),
  })))
  api.__setAgentWasmResolverForTest(async () => module as never)
}

beforeEach(() => {
  vi.unstubAllGlobals()
  api.__resetAgentWasmForTest()
})

afterEach(() => {
  vi.unstubAllGlobals()
  api.__resetAgentWasmForTest()
})

describe('validateAgentAuthorInitialPosition', () => {
  it('合法对象通过，并保留原始 [x,y,z] 顺序', () => {
    const parsed = api.validateAgentAuthorInitialPosition(VALID)
    expect(parsed).toEqual(VALID)
    expect(parsed?.position).toEqual([-138.75604, 31.585732, -165.30302])
  })

  it('null 是合法证据不足结果', () => {
    expect(api.validateAgentAuthorInitialPosition(null)).toBeNull()
  })

  const invalid: Array<[string, unknown]> = [
    ['author_eid = 0', { ...VALID, author_eid: 0 }],
    ['author_eid 负数', { ...VALID, author_eid: -1 }],
    ['author_eid 非整数', { ...VALID, author_eid: 1.5 }],
    ['author_eid NaN', { ...VALID, author_eid: Number.NaN }],
    ['clock NaN', { ...VALID, clock: Number.NaN }],
    ['clock Infinity', { ...VALID, clock: Number.POSITIVE_INFINITY }],
    ['clock 负数', { ...VALID, clock: -0.1 }],
    ['position 缺失', (() => { const v = { ...VALID } as Record<string, unknown>; delete v.position; return v })()],
    ['position 长度 2', { ...VALID, position: [1, 2] }],
    ['position 长度 4', { ...VALID, position: [1, 2, 3, 4] }],
    ['position 含 NaN', { ...VALID, position: [1, Number.NaN, 3] }],
    ['position 含 Infinity', { ...VALID, position: [1, 2, Number.POSITIVE_INFINITY] }],
    ['position 含非数值', { ...VALID, position: [1, '2', 3] }],
    ['整体缺失', undefined],
  ]

  for (const [name, value] of invalid) {
    it(`拒绝：${name}`, () => {
      expect(() => api.validateAgentAuthorInitialPosition(value)).toThrow()
    })
  }

  it('拒绝的旧形状不会变成 [0,0,0]', () => {
    expect(() => api.validateAgentAuthorInitialPosition({ ...VALID, position: undefined }))
      .toThrow(/position/)
  })
})

describe('parseAgentAuthorInitialPositionFromBytes', () => {
  it('合法对象 JSON → typed object', async () => {
    stubWasm({ parseAuthorInitialPosition: () => JSON.stringify(VALID) })
    await expect(api.parseAgentAuthorInitialPositionFromBytes(new Uint8Array([1])))
      .resolves.toEqual(VALID)
  })

  it('JSON null → null（不是 [0,0,0]）', async () => {
    stubWasm({ parseAuthorInitialPosition: () => 'null' })
    await expect(api.parseAgentAuthorInitialPositionFromBytes(new Uint8Array([1])))
      .resolves.toBeNull()
  })

  it('旧产物缺 export → fail closed（不静默返回 null）', async () => {
    stubWasm({})
    await expect(api.parseAgentAuthorInitialPositionFromBytes(new Uint8Array([1])))
      .rejects.toThrow(/parseAuthorInitialPosition 缺失/)
  })

  it('非法形状 → fail closed', async () => {
    stubWasm({ parseAuthorInitialPosition: () => JSON.stringify({ ...VALID, author_eid: 0 }) })
    await expect(api.parseAgentAuthorInitialPositionFromBytes(new Uint8Array([1])))
      .rejects.toThrow(/author_eid/)
  })
})
