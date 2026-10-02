#!/usr/bin/env node
// 重新导出 `src/replay-local/__golden__/wasm-results.json`：用 `deploy/agent/source.json` 锁定的上游 WASM
// （先 `bash scripts/fetch-agent-wasm.sh`）在 `batches.json` 列出的仓库 fixture 回放上跑 parseResult。
// Java 侧 golden（java-*）只读不再生成；上游 pin 升级后跑本脚本，再跑 replay-local 全部 golden 测试。
//
// 用法（在 frontend/ 下）：node scripts/export-wasm-results.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const golden = join(repo, 'frontend/src/replay-local/__golden__')
const wasmDir = join(repo, 'common/assets/wasm')
const pin = JSON.parse(readFileSync(join(repo, 'deploy/agent/source.json'), 'utf8'))
const fp = JSON.parse(readFileSync(join(wasmDir, 'fingerprint.json'), 'utf8'))
if (fp.tag !== pin.artifact.release) {
  console.error(`本地 WASM ${fp.tag} ≠ 锁定 ${pin.artifact.release}：先运行 scripts/fetch-agent-wasm.sh`)
  process.exit(1)
}
const mod = await import(pathToFileURL(join(wasmDir, 'wotb_replay_wasm.js')).href)
mod.initSync({ module: readFileSync(join(wasmDir, 'wotb_replay_wasm_bg.wasm')) })

const batches = JSON.parse(readFileSync(join(golden, 'batches.json'), 'utf8'))
const files = [...new Set(Object.values(batches).flat())].sort()
const out = {}
for (const rel of files) {
  const path = join(repo, rel)
  if (!existsSync(path)) {
    console.warn(`跳过（本地不存在）：${rel}`)
    continue
  }
  try {
    out[basename(rel)] = JSON.parse(mod.parseResult(new Uint8Array(readFileSync(path))))
  } catch (e) {
    out[basename(rel)] = { error: String(e) }
  }
}
const target = join(golden, 'wasm-results.json')
const previous = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {}
for (const [k, v] of Object.entries(previous)) if (!(k in out)) out[k] = v
writeFileSync(target, JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n')
console.log(`wasm-results.json ← ${pin.artifact.release}（${Object.keys(out).length} 个文件）`)
