
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  normalizeAgentShotsOutcome,
  validateAgentAiReview,
  validateAgentAuthorInitialPosition,
  validateAgentRecorderCamera,
  validateAgentBattleResult,
  validateAgentPlayback,
  type AgentAiReviewFacet,
  type AgentAuthorInitialPosition,
  type AgentRecorderCamera,
  type AgentBattleResult,
  type AgentPlaybackFacet,
  type AgentShotsOutcome,
} from '../../api/agent-replay-facets.js'
import { groupByVehicle, magazineSizeOfVehicle, shellStatesAt, usablePhases, type ShellState } from '../../scene/reloadBar.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const PIN_JSON = join(REPO, 'deploy/agent/source.json')

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
  parseAuthorInitialPosition?: (bytes: Uint8Array) => string
  parseRecorderCamera?: (bytes: Uint8Array) => string
}

let mod: WasmModule | null = null

export async function wasm(): Promise<WasmModule> {
  if (mod) return mod
  const pin = JSON.parse(readFileSync(PIN_JSON, 'utf8')) as { ref: string; artifact: { release: string } }
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

export interface FixtureFacets {
  bytes: Uint8Array
  result: AgentBattleResult
  playback: AgentPlaybackFacet | null
  playbackError: string | null
  aiReview: AgentAiReviewFacet | null
  aiReviewError: string | null
}

const cache = new Map<string, FixtureFacets>()

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
  try { aiReview = validateAgentAiReview(JSON.parse(m.parseAiReview(bytes)), 'current-producer') } catch (e) { aiReviewError = String(e) }
  const out = { bytes, result, playback, playbackError, aiReview, aiReviewError }
  cache.set(file, out)
  return out
}

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

export async function replayFacets(path: string): Promise<FixtureFacets> {
  const m = await wasm()
  const bytes = new Uint8Array(readFileSync(path))
  const result = validateAgentBattleResult(JSON.parse(m.parseResult(bytes)))
  let playback: AgentPlaybackFacet | null = null
  let playbackError: string | null = null
  try { playback = validateAgentPlayback(JSON.parse(m.parsePlayback(bytes))) } catch (e) { playbackError = String(e) }
  let aiReview: AgentAiReviewFacet | null = null
  let aiReviewError: string | null = null
  try { aiReview = validateAgentAiReview(JSON.parse(m.parseAiReview(bytes)), 'current-producer') } catch (e) { aiReviewError = String(e) }
  return { bytes, result, playback, playbackError, aiReview, aiReviewError }
}

export async function shotsViaPinnedWasm(bytes: Uint8Array): Promise<AgentShotsOutcome> {
  const m = await wasm()
  return normalizeAgentShotsOutcome(JSON.parse(m.parseShotReplays(bytes)) as unknown)
}

export async function recorderCameraViaPinnedWasm(
  bytes: Uint8Array,
): Promise<AgentRecorderCamera | null> {
  const m = await wasm()
  const parse = m.parseRecorderCamera
  if (typeof parse !== 'function') {
    throw new Error('pinned agent WASM 缺 parseRecorderCamera（需要 v0.4.21+）')
  }
  return validateAgentRecorderCamera(JSON.parse(parse(bytes)) as unknown)
}

export async function authorInitialPositionViaPinnedWasm(
  bytes: Uint8Array,
): Promise<AgentAuthorInitialPosition | null> {
  const m = await wasm()
  const parse = m.parseAuthorInitialPosition
  if (typeof parse !== 'function') {
    throw new Error('pinned agent WASM 缺 parseAuthorInitialPosition（需要 v0.4.15+）')
  }
  return validateAgentAuthorInitialPosition(JSON.parse(parse(bytes)) as unknown)
}

export interface ReloadTelemetrySmoke {
  authorEid: number
  authorReloadEvents: number
  authorUsablePhases: number
  magazineSize: number
  samples: Array<{ t: number; states: ShellState[] | null }>
}

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
  const authorVehicle = (playback.vehicles ?? []).find((v) => v.eid === authorEid)
  const magazineSize = magazineSizeOfVehicle(authorVehicle)
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
