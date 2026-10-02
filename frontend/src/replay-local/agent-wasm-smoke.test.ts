/**
 * Agent WASM 四入口 smoke（真实锁定产物，不 mock）——stale WASM 的症状回归。
 *
 * 两个真实故障的症状都在这里锁住：
 *  1. AI Review 报 `ai_review.poses 缺失`（旧产物没有 v0.3.7 的原始位姿）；
 *  2. 装填条**永远不动**——错版 WASM 给出 `reloads = 0`，UI 再把"无遥测"兜底成满条。
 *
 * 本测试用 `deploy/agent/source.json` pin 的产物在仓库 fixture 上真实跑
 * `parseResult` / `parsePlayback` / `parseAiReview` / `parseShotReplays` 四入口，
 * 锁 canonical 投影与装填渲染**必需**的证据形状：
 *
 *  - `ai_review.poses` / `ai_review.turrets` **存在且是数组**（只锁存在性——具体条数
 *    是单场属性，不是通用契约）；
 *  - `playback.reloads` 存在且**作者车拥有真实的装填相位**（不是"锁死具体条数"：
 *    `reloads === N` 不是 wire contract，只有"有遥测 + 作者有 timeline"是）；
 *  - 契约版本门禁（playback version=2 / facets v1）真实通过。
 *
 * 本机原始问题回放（1.5MB，不入库）可加跑，额外锁该场次的具体数字：
 *   WOTB_SMOKE_REPLAY=<path/to.wotbreplay> npx vitest run src/replay-local/agent-wasm-smoke.test.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  FIXTURE_REPLAYS,
  fixtureFacets,
  reloadTelemetryFor,
  replayFacets,
  requireFixtures,
  shotsViaPinnedWasm,
} from './__golden__/agentWasmNode.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SMOKE_REPLAY = process.env.WOTB_SMOKE_REPLAY
const FIXTURES = Object.keys(FIXTURE_REPLAYS)
/** 参考 fixture（仓库已提交，CI 可跑） */
const REFERENCE = 'random-battle-example.wotbreplay'

describe('Agent WASM 四入口 smoke（pin 产物真实解析）', () => {
  it('fixture 名单非空（scanner self-check）', () => {
    expect(FIXTURES.length).toBeGreaterThan(0)
  })

  it.each(FIXTURES)('%s：parseResult / parsePlayback / parseAiReview 全部可用', async (file) => {
    const facets = await fixtureFacets(file)
    // parseResult：结果能力（轻校验通过 = 可用）
    expect(facets.result.players.length).toBeGreaterThan(0)
    // parsePlayback：契约 v2
    expect(facets.playback?.version).toBe(2)
    // parseAiReview：contract v1 + canonical 投影必需证据
    expect(facets.aiReview?.version).toBe(1)
    expect(Array.isArray(facets.aiReview?.poses)).toBe(true)
    expect(Array.isArray(facets.aiReview?.turrets)).toBe(true)
    expect(Array.isArray(facets.aiReview?.events)).toBe(true)
    expect(Array.isArray(facets.aiReview?.rosters)).toBe(true)
  })

  it('poses / turrets 是 per-entity 数组（锁存在性，不锁条数）', async () => {
    const { aiReview } = requireFixtures(await fixtureFacets(REFERENCE))
    expect(aiReview.poses.length).toBeGreaterThan(0)
    expect(aiReview.turrets.length).toBeGreaterThan(0)
    for (const track of [...aiReview.poses, ...aiReview.turrets]) {
      expect(typeof track.eid).toBe('number')
      expect(Array.isArray(track.t)).toBe(true)
    }
  })

  it('parseShotReplays 入口可用（author_path ∈ ok|error，shots 是数组）', async () => {
    const bytes = new Uint8Array(readFileSync(join(REPO, FIXTURE_REPLAYS[REFERENCE])))
    const outcome = await shotsViaPinnedWasm(bytes)
    expect(Array.isArray(outcome.shots)).toBe(true)
    expect(['ok', 'error']).toContain(outcome.author_path)
    if (outcome.author_path === 'error') expect(typeof outcome.author_error).toBe('string')
  })

  it('装填遥测形状：reloads 是数组，条目带 clock/eid/phase（无遥测则整场为空数组）', async () => {
    const { playback } = requireFixtures(await fixtureFacets(REFERENCE))
    expect(Array.isArray(playback.reloads)).toBe(true)
    for (const event of playback.reloads ?? []) {
      expect(Number.isFinite(event.clock)).toBe(true)
      expect(typeof event.eid).toBe('number')
      expect(typeof event.phase).toBe('number')
    }
  })
})

/**
 * 装填条真实故障回归（错版 WASM：`reloads = 0` → 装填条永远不动的"假满条"）。
 *
 * 只锁长期契约，不锁单场条数：遥测存在 + **作者车拥有装填 timeline** + 状态机在装填
 * 窗口内给出非 null 的逐发状态（无遥测时必须 null，由 `reloadBar.test.js` 逐例覆盖）。
 */
describe('Agent WASM 装填遥测 smoke（fixture）', () => {
  /**
   * 两种合法形态都必须成立：
   *  - 作者车**有**可用相位 → 状态机（生产同款采样）给出非 null 的可绘制状态；
   *  - 作者车**没有**遥测（如训练房无交战场次）→ 采样为空且**不得**凭空造出满弹状态。
   */
  it.each(FIXTURES)('%s：作者车装填遥测与逐发状态一致（无遥测 → 不伪造）', async (file) => {
    const { playback } = requireFixtures(await fixtureFacets(file))
    const telemetry = reloadTelemetryFor(playback)
    expect(telemetry.samples.length).toBe(telemetry.authorUsablePhases)
    if (telemetry.authorUsablePhases === 0) {
      expect(telemetry.samples).toHaveLength(0)
      expect(telemetry.magazineSize).toBeGreaterThanOrEqual(1)
      return
    }
    expect(telemetry.magazineSize).toBeGreaterThanOrEqual(1)
    for (const { t, states } of telemetry.samples) {
      expect(states, `${file} t=${t} 采样得到 null（无遥测）`).not.toBeNull()
    }
  })
})

// 本机原始问题回放（opt-in，不入库）：额外锁该场次的具体证据数量
const describeSmoke = SMOKE_REPLAY ? describe : describe.skip
describeSmoke('原始问题回放（WOTB_SMOKE_REPLAY）', () => {
  it('AI Review 不再报 poses 缺失：poses = 18、turrets = 14', async () => {
    const facets = await replayFacets(SMOKE_REPLAY as string)
    const { aiReview, playback } = requireFixtures(facets)
    expect(aiReview.poses).toHaveLength(18)
    expect(aiReview.turrets).toHaveLength(14)
    expect(playback.version).toBe(2)
    expect(facets.result.players.length).toBeGreaterThan(0)
  })

  /**
   * 装填条故障现场：错版 WASM 下 `reloads = 0` → UI 画出"永远不动的满条"。
   * 只锁"遥测存在 + 作者车有 reload timeline + 状态随相位变化"，不锁 `reloads === 121`
   * 这种单场条数（不是 wire contract）。`reload_effective`（method 35 多段 profile）
   * 对 autoreloader 仍为 0，属 upstream follow-up，不作为本 PR 的 parser blocker。
   */
  it('装填条不再"永远不动"：作者车有 reload timeline，逐发状态随相位变化', async () => {
    const { playback } = requireFixtures(await replayFacets(SMOKE_REPLAY as string))
    const reloads = playback.reloads ?? []
    expect(reloads.length).toBeGreaterThan(0)
    // method 35 对 autoreloader 多段 profile 仍无记录 → 该字段可缺省（skip-when-empty 线形状）
    expect(playback.reload_effective == null || Array.isArray(playback.reload_effective)).toBe(true)

    const telemetry = reloadTelemetryFor(playback)
    const authorEid = playback.meta.author_eid
    expect(reloads.some((event) => event.eid === authorEid)).toBe(true)
    expect(telemetry.authorEid).toBe(authorEid)
    expect(telemetry.authorUsablePhases).toBeGreaterThan(0)

    // 状态机必须给出真实状态（不是 null，也不是恒定满弹）
    const signatures = new Set<string>()
    for (const { t, states } of telemetry.samples) {
      expect(states, `t=${t} 无装填状态（装填条无从绘制）`).not.toBeNull()
      signatures.add(JSON.stringify(states))
    }
    expect(signatures.size).toBeGreaterThan(1)
  })
})
