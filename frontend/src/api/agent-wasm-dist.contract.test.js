/**
 * Agent WASM dist 契约（Docker build / CI dist smoke / TX 镜像校验共用同一实现）。
 *
 * 锁定三件事：
 *  1. 产物只在 `/wasm/<source.json ref>/` 下——stable `/wasm/wotb_replay_wasm.js` 禁止回归；
 *  2. fingerprint 与 `deploy/agent/source.json` 逐字段一致（错版产物不得进镜像）；
 *  3. `_bg.wasm` 是真实 WASM（magic），不是占位文件/HTML 错误页。
 *
 * 用真实 `deploy/agent/source.json` + 临时目录构造 dist，不依赖真实构建产物。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { verifyAgentWasmDist } from '../../scripts/verify-agent-wasm-dist.mjs'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = resolve(FRONTEND, '..')
const PIN_PATH = join(REPO, 'deploy/agent/source.json')
const PIN = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
const REF = PIN.ref
const RELEASE = PIN.artifact.release

const WASM_BYTES = Buffer.from('0061736d01000000', 'hex')

const roots = []

function makeDist({ ref = REF, tag = RELEASE, commit = REF, wasm = WASM_BYTES, extra = null, omit = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-wasm-dist-'))
  roots.push(root)
  const dir = join(root, 'wasm', ref)
  mkdirSync(dir, { recursive: true })
  if (omit !== 'js') writeFileSync(join(dir, 'wotb_replay_wasm.js'), '// glue\n')
  if (omit !== 'wasm') writeFileSync(join(dir, 'wotb_replay_wasm_bg.wasm'), wasm)
  if (omit !== 'fingerprint') {
    writeFileSync(join(dir, 'fingerprint.json'), JSON.stringify({ upstream_commit: commit, tag, bindgen: 'wasm-bindgen 0.0.0' }))
  }
  if (extra) writeFileSync(join(root, 'wasm', extra), 'stale\n')
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true })
})

describe('Agent WASM dist 契约（commit-addressed）', () => {
  it('dist/wasm/<ref>/ 三件套 + fingerprint == source.json → PASS', () => {
    const result = verifyAgentWasmDist(makeDist(), PIN_PATH)
    expect(result.ref).toBe(REF)
    expect(result.release).toBe(RELEASE)
    expect(result.dir.endsWith(join('wasm', REF))).toBe(true)
  })

  it('stable /wasm/wotb_replay_wasm.js 存在 → FAIL（禁止回归）', () => {
    expect(() => verifyAgentWasmDist(makeDist({ extra: 'wotb_replay_wasm.js' }), PIN_PATH))
      .toThrow(/必须只含 pin 的 commit 目录/)
  })

  it('额外 /wasm/fingerprint.json（旧 flat 布局残留）→ FAIL', () => {
    expect(() => verifyAgentWasmDist(makeDist({ extra: 'fingerprint.json' }), PIN_PATH))
      .toThrow(/必须只含 pin 的 commit 目录/)
  })

  it('fingerprint.upstream_commit 与 source.json ref 不一致 → FAIL', () => {
    expect(() => verifyAgentWasmDist(makeDist({ commit: 'f'.repeat(40) }), PIN_PATH))
      .toThrow(/upstream_commit/)
  })

  it('fingerprint.tag 与 source.json artifact.release 不一致 → FAIL', () => {
    expect(() => verifyAgentWasmDist(makeDist({ tag: 'v0.0.0' }), PIN_PATH))
      .toThrow(/artifact\.release/)
  })

  it('产物目录不是 pin 的 commit（部署了别的 build 的 Agent）→ FAIL', () => {
    expect(() => verifyAgentWasmDist(makeDist({ ref: 'a'.repeat(40) }), PIN_PATH))
      .toThrow(/必须只含 pin 的 commit 目录/)
  })

  it('缺 js / wasm / fingerprint → FAIL', () => {
    for (const omit of ['js', 'wasm', 'fingerprint']) {
      expect(() => verifyAgentWasmDist(makeDist({ omit }), PIN_PATH)).toThrow(/缺文件/)
    }
  })

  it('_bg.wasm 无 wasm magic（HTML 错误页/占位文件）→ FAIL', () => {
    expect(() => verifyAgentWasmDist(makeDist({ wasm: Buffer.from('<html>404') }), PIN_PATH))
      .toThrow(/wasm magic/)
  })

  it('dist 里没有 wasm 目录 → FAIL', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-wasm-none-'))
    roots.push(root)
    expect(() => verifyAgentWasmDist(root, PIN_PATH)).toThrow(/没有 Agent 产物目录/)
  })
})
