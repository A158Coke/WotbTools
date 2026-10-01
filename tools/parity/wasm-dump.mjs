// 迁移期一次性对比工具（WASM 侧）：用前端打包的同一份上游 Rust Core WASM 跑 parseResult，
// 写成 {file: BattleSummary} JSON。只在本地跑；回放与输出都不入库。用法见 README.md。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const wasmDir = resolve(here, '../../common/assets/wasm')
const [dir, out] = process.argv.slice(2)
const mod = await import(pathToFileURL(join(wasmDir, 'wotb_replay_wasm.js')).href)
mod.initSync({ module: readFileSync(join(wasmDir, 'wotb_replay_wasm_bg.wasm')) })

const result = {}
const files = readdirSync(dir).filter((f) => f.endsWith('.wotbreplay')).sort()
for (const f of files) {
  try {
    result[f] = JSON.parse(mod.parseResult(new Uint8Array(readFileSync(join(dir, f)))))
  } catch (e) {
    result[f] = { error: String(e) }
  }
}
writeFileSync(out, JSON.stringify(result, null, 2))
console.log(`wasm: ${files.length} replays -> ${out}`)
