/**
 * 测试专用：在 Node 里加载 `deploy/agent/source.json` 锁定的上游 WASM，直接解析仓库已提交的 fixture 回放。
 *
 * 语义 golden（2D 回放 / AI 投影）不再读手工导出的 `wasm-*` 中间件，而是现场跑锁定版本——
 * 测试与线上走同一个上游产物，pin 升级后 golden 自动覆盖新版本。产物缺失或版本不符直接失败
 * （本地先跑 `bash scripts/fetch-agent-wasm.sh`；CI 在单测前已执行该步骤）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  validateAgentAiReview,
  validateAgentBattleResult,
  validateAgentPlayback,
  type AgentAiReviewFacet,
  type AgentBattleResult,
  type AgentPlaybackFacet,
} from '../../api/agent-replay-facets.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const WASM_DIR = join(REPO, 'common/assets/wasm')

/** 仓库 fixture 回放（相对仓库根） */
export const FIXTURE_REPLAYS: Record<string, string> = {
  'random-battle-example.wotbreplay': 'common/fixtures/replays/random-battle-example.wotbreplay',
  'cw-training-15-14-example.wotbreplay': 'common/fixtures/replays/cw-training-15-14-example.wotbreplay',
  'tournament-14-14-example.wotbreplay': 'common/fixtures/replays/tournament-14-14-example.wotbreplay',
  'training-room-example.wotbreplay': 'common/fixtures/hall-of-fame/training-room-example.wotbreplay',
}

interface WasmModule {
  initSync: (opts: { module: Uint8Array }) => void
  parseResult: (bytes: Uint8Array) => string
  parsePlayback: (bytes: Uint8Array) => string
  parseAiReview: (bytes: Uint8Array) => string
}

let mod: WasmModule | null = null

async function wasm(): Promise<WasmModule> {
  if (mod) return mod
  const pin = JSON.parse(readFileSync(join(REPO, 'deploy/agent/source.json'), 'utf8')) as { ref: string; artifact: { release: string } }
  const fingerprintPath = join(WASM_DIR, 'fingerprint.json')
  if (!existsSync(fingerprintPath)) {
    throw new Error('agent WASM 缺失：先运行 `bash scripts/fetch-agent-wasm.sh`（按 deploy/agent/source.json 拉取锁定产物）')
  }
  const fp = JSON.parse(readFileSync(fingerprintPath, 'utf8')) as { tag: string; upstream_commit: string }
  if (fp.tag !== pin.artifact.release || fp.upstream_commit !== pin.ref) {
    throw new Error(`本地 agent WASM（${fp.tag}）与锁定版本（${pin.artifact.release}）不符：重新运行 scripts/fetch-agent-wasm.sh`)
  }
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(join(WASM_DIR, 'wotb_replay_wasm.js')).href)) as WasmModule
  loaded.initSync({ module: readFileSync(join(WASM_DIR, 'wotb_replay_wasm_bg.wasm')) })
  mod = loaded
  return loaded
}

export interface FixtureFacets {
  bytes: Uint8Array
  result: AgentBattleResult
  playback: AgentPlaybackFacet | null
  playbackError: string | null
  aiReview: AgentAiReviewFacet | null
  aiReviewError: string | null
}

const cache = new Map<string, FixtureFacets>()

/** 用锁定 WASM 解析一个 fixture 的三个切面（按文件缓存；时序切面失败如实记录） */
export async function fixtureFacets(file: string): Promise<FixtureFacets> {
  const hit = cache.get(file)
  if (hit) return hit
  const rel = FIXTURE_REPLAYS[file]
  if (!rel) throw new Error(`unknown fixture ${file}`)
  const m = await wasm()
  const bytes = new Uint8Array(readFileSync(join(REPO, rel)))
  const result = validateAgentBattleResult(JSON.parse(m.parseResult(bytes)))
  let playback: AgentPlaybackFacet | null = null
  let playbackError: string | null = null
  try { playback = validateAgentPlayback(JSON.parse(m.parsePlayback(bytes))) } catch (e) { playbackError = String(e) }
  let aiReview: AgentAiReviewFacet | null = null
  let aiReviewError: string | null = null
  try { aiReview = validateAgentAiReview(JSON.parse(m.parseAiReview(bytes))) } catch (e) { aiReviewError = String(e) }
  const out = { bytes, result, playback, playbackError, aiReview, aiReviewError }
  cache.set(file, out)
  return out
}
