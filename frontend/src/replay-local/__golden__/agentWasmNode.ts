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
  normalizeAgentShotsOutcome,
  validateAgentAiReview,
  validateAgentBattleResult,
  validateAgentPlayback,
  type AgentAiReviewFacet,
  type AgentBattleResult,
  type AgentPlaybackFacet,
  type AgentShotsOutcome,
} from '../../api/agent-replay-facets.js'
import { groupByVehicle, inferMagazineSize, shellStatesAt, usablePhases, type ShellState } from '../../scene/reloadBar.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const PIN_JSON = join(REPO, 'deploy/agent/source.json')

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
  parseShotReplays: (bytes: Uint8Array, limits?: string, shells?: string) => string
}

let mod: WasmModule | null = null

/**
 * 锁定产物装载（pin 的 `common/assets/wasm/<ref>/`，fingerprint 与 source.json 一致才装载）。
 * 导出给 smoke/回归测试复用同一装载路径，避免测试各自拼产物路径。
 */
export async function wasm(): Promise<WasmModule> {
  if (mod) return mod
  const pin = JSON.parse(readFileSync(PIN_JSON, 'utf8')) as { ref: string; artifact: { release: string } }
  // 产物落位是 commit-addressed 目录（stable `/wasm/wotb_replay_wasm.js` 已废除）
  const wasmDir = join(REPO, 'common/assets/wasm', pin.ref)
  const fingerprintPath = join(wasmDir, 'fingerprint.json')
  if (!existsSync(fingerprintPath)) {
    throw new Error('agent WASM 缺失：先运行 `bash scripts/fetch-agent-wasm.sh`（按 deploy/agent/source.json 拉取锁定产物）')
  }
  const fp = JSON.parse(readFileSync(fingerprintPath, 'utf8')) as { tag: string; upstream_commit: string }
  if (fp.tag !== pin.artifact.release || fp.upstream_commit !== pin.ref) {
    throw new Error(`本地 agent WASM（${fp.tag}@${fp.upstream_commit}）与锁定版本（${pin.artifact.release}@${pin.ref}）不符：重新运行 scripts/fetch-agent-wasm.sh`)
  }
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(join(wasmDir, 'wotb_replay_wasm.js')).href)) as WasmModule
  loaded.initSync({ module: readFileSync(join(wasmDir, 'wotb_replay_wasm_bg.wasm')) })
  mod = loaded
  return loaded
}

/**
 * fixture 三切面。校验被 trust boundary 拒绝时 `playback` / `aiReview` 为 `null`，原始错误
 * 保留在 `*Error` 上。
 *
 * 消费方若直接读 `f.playback!.meta`（或任何 `!` 断言），得到的只会是二次症状
 * `Cannot read properties of null (reading 'meta')`——真正被 trust boundary 拒绝的 producer
 * contract 错误被彻底吞掉。凡是要**解释** fixture 的测试，必须走 [`requireFixtures()`]：
 * producer 契约与 WotbTools validator 再次漂移时，CI 直接显示
 * `agent facets: playback.reloads[123].duration_s ...`，而不是 null 解引用。
 */
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

/**
 * `fixtureFacets()` 的**严格**读取路径（测试解释 fixture 的默认入口）：任一被 trust
 * boundary 拒绝的切面直接抛出**原始 validation error**，绝不降级成 `null` 让下游崩在
 * `null.meta` 上。这条断言是「producer ⇄ validator 漂移」的 fail-visible 闸门。
 *
 * `fixtureFacets()` 本身仍保留失败态（供「不该解析成功」的负向测试显式检查）。
 */
export function requireFixtures(f: FixtureFacets): FixtureFacets & {
  playback: AgentPlaybackFacet
  aiReview: AgentAiReviewFacet
} {
  if (!f.playback) {
    throw new Error(`agent facets: fixture ${f.result.file_name} playback 契约校验失败——${f.playbackError}`)
  }
  if (!f.aiReview) {
    throw new Error(`agent facets: fixture ${f.result.file_name} aiReview 契约校验失败——${f.aiReviewError}`)
  }
  return f as FixtureFacets & { playback: AgentPlaybackFacet; aiReview: AgentAiReviewFacet }
}

/** 用锁定产物解析**任意**回放文件（smoke/opt-in 回归；不走 fixture 缓存） */
export async function replayFacets(path: string): Promise<FixtureFacets> {
  const m = await wasm()
  const bytes = new Uint8Array(readFileSync(path))
  const result = validateAgentBattleResult(JSON.parse(m.parseResult(bytes)))
  let playback: AgentPlaybackFacet | null = null
  let playbackError: string | null = null
  try { playback = validateAgentPlayback(JSON.parse(m.parsePlayback(bytes))) } catch (e) { playbackError = String(e) }
  let aiReview: AgentAiReviewFacet | null = null
  let aiReviewError: string | null = null
  try { aiReview = validateAgentAiReview(JSON.parse(m.parseAiReview(bytes))) } catch (e) { aiReviewError = String(e) }
  return { bytes, result, playback, playbackError, aiReview, aiReviewError }
}

/** 射击链入口（`parseShotReplays`）的同步包装：与 `normalizeAgentShotsOutcome` 同一归一化 */
export async function shotsViaPinnedWasm(bytes: Uint8Array): Promise<AgentShotsOutcome> {
  const m = await wasm()
  return normalizeAgentShotsOutcome(JSON.parse(m.parseShotReplays(bytes)) as unknown)
}

/** 作者车的装填遥测（生产装配的同款形状 + 逐发状态采样） */
export interface ReloadTelemetrySmoke {
  authorEid: number
  /** 作者车的装填条目总数（facet `reloads` 按 eid 归组后） */
  authorReloadEvents: number
  /** 作者车可用于逐发状态机的条目数（有正时长的 f2=3/4/6/7） */
  authorUsablePhases: number
  /** 相位 + 计数推断出的弹夹容量（无证据 → 1，不猜） */
  magazineSize: number
  /** 采样时刻的逐发状态（无遥测 → `null`，调用方据此不画装填条） */
  samples: Array<{ t: number; states: ShellState[] | null }>
}

/**
 * 用**生产同款**装配（`scene/reloadBar`）从 PlaybackData 取作者车装填遥测 + 采样逐发状态。
 *
 * 采样点只取**稳定**时刻：每条定时相位的 50% 进度点。这样既覆盖"无遥测 → null"，
 * 也覆盖"有遥测 → 非 null 状态"，且不把某一场的相位时刻写死进断言。
 */
export function reloadTelemetryFor(playback: AgentPlaybackFacet): ReloadTelemetrySmoke {
  const byEid = groupByVehicle(playback.reloads)
  const fires = new Map<number, number[]>()
  for (const shot of playback.shots ?? []) {
    const eid = shot.shooter_eid
    if (eid == null || !Number.isFinite(shot.t_fire)) continue
    const list = fires.get(eid) ?? []
    list.push(shot.t_fire)
    fires.set(eid, list)
  }
  for (const list of fires.values()) list.sort((a, b) => a - b)

  const authorEid = playback.meta.author_eid
  const events = byEid.get(authorEid) ?? []
  const magazineSize = inferMagazineSize(events)
  const authorFires = fires.get(authorEid) ?? []
  const samples = usablePhases(events).map((event) => {
    const t = event.clock + Number(event.duration_s) / 2
    return { t, states: shellStatesAt(events, authorFires, t, magazineSize) }
  })
  return {
    authorEid,
    authorReloadEvents: events.length,
    authorUsablePhases: usablePhases(events).length,
    magazineSize,
    samples,
  }
}
