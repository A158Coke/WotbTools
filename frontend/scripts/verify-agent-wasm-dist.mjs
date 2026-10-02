#!/usr/bin/env node
/**
 * Agent WASM dist 契约校验（唯一实现，被 Docker build 与 CI 的 dist smoke 共用）。
 *
 * 断言 dist 里的 Agent 产物是 **commit-addressed** 的，并且与 `deploy/agent/source.json`
 * 这一唯一 identity 来源逐字段一致：
 *
 *   dist/wasm/<ref>/wotb_replay_wasm.js
 *   dist/wasm/<ref>/wotb_replay_wasm_bg.wasm          (wasm magic = 0061736d)
 *   dist/wasm/<ref>/fingerprint.json                  (upstream_commit/tag == source.json)
 *   dist/wasm/ 下**不得**再有别的条目（stable `/wasm/wotb_replay_wasm.js` 禁止回归）
 *
 * 用法（frontend/ 下）：
 *   node scripts/verify-agent-wasm-dist.mjs [--dist <dir>] [--pin <source.json>]
 * 默认：--dist dist --pin ../deploy/agent/source.json
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '..')
const PIN_PATH = resolve(FRONTEND, '../deploy/agent/source.json')

const JS_NAME = 'wotb_replay_wasm.js'
const WASM_NAME = 'wotb_replay_wasm_bg.wasm'
const FINGERPRINT_NAME = 'fingerprint.json'
const REF_RE = /^[0-9a-f]{40}$/
const WASM_MAGIC = '0061736d'

function fail(message) {
  throw new Error(`agent wasm dist contract: ${message}`)
}

function parseArgs(argv) {
  const options = { dist: join(FRONTEND, 'dist'), pin: PIN_PATH }
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--dist' || flag === '--pin') {
      const value = argv[++i]
      if (!value) fail(`${flag} 需要一个路径参数`)
      options[flag === '--dist' ? 'dist' : 'pin'] = resolve(process.cwd(), value)
    } else {
      fail(`未知参数 ${flag}`)
    }
  }
  return options
}

/** dist 契约校验；任何一条不成立都抛错（fail-closed）。 */
export function verifyAgentWasmDist(distDir = join(FRONTEND, 'dist'), pinPath = PIN_PATH) {
  const pin = JSON.parse(readFileSync(pinPath, 'utf8'))
  const ref = pin?.ref
  const release = pin?.artifact?.release
  if (typeof ref !== 'string' || !REF_RE.test(ref)) fail(`${pinPath} 的 ref 不是完整 40 位小写 commit SHA`)
  if (typeof release !== 'string' || !release) fail(`${pinPath} 的 artifact.release 为空`)

  const wasmRoot = join(distDir, 'wasm')
  let entries
  try {
    entries = readdirSync(wasmRoot)
  } catch {
    fail(`dist 里没有 Agent 产物目录 ${wasmRoot}`)
  }
  if (entries.length !== 1 || entries[0] !== ref) {
    fail(`dist/wasm/ 必须只含 pin 的 commit 目录 ${ref}，实际：${JSON.stringify(entries.sort())}`)
  }

  const artifactDir = join(wasmRoot, ref)
  for (const name of [JS_NAME, WASM_NAME, FINGERPRINT_NAME]) {
    const path = join(artifactDir, name)
    let stat
    try {
      stat = statSync(path)
    } catch {
      fail(`缺文件 ${path}`)
    }
    if (!stat.isFile() || stat.size === 0) fail(`文件为空 ${path}`)
  }

  const binary = readFileSync(join(artifactDir, WASM_NAME))
  if (binary.subarray(0, 4).toString('hex') !== WASM_MAGIC) {
    fail(`${WASM_NAME} 缺 wasm magic（期望 ${WASM_MAGIC}）`)
  }

  const fingerprint = JSON.parse(readFileSync(join(artifactDir, FINGERPRINT_NAME), 'utf8'))
  if (fingerprint?.upstream_commit !== ref) {
    fail(`${FINGERPRINT_NAME}.upstream_commit = ${JSON.stringify(fingerprint?.upstream_commit)} ≠ source.json ref ${ref}`)
  }
  if (fingerprint?.tag !== release) {
    fail(`${FINGERPRINT_NAME}.tag = ${JSON.stringify(fingerprint?.tag)} ≠ source.json artifact.release ${release}`)
  }

  return { ref, release, dir: artifactDir }
}

function main(argv) {
  try {
    const options = parseArgs(argv)
    const { ref, release } = verifyAgentWasmDist(options.dist, options.pin)
    console.log(`agent wasm dist contract: PASS（/wasm/${ref}/ = ${release}）`)
    return 0
  } catch (e) {
    console.error(`FAIL: ${e.message}`)
    return 1
  }
}

// 直接执行（被 vitest 作为库 import 时不跑）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv))
}
