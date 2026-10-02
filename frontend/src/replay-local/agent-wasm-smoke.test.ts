/**
 * Agent WASM 四入口 smoke（真实锁定产物，不 mock）——stale WASM 的症状回归。
 *
 * 症状：AI Review 报 `ai_review.poses 缺失`（旧产物没有 v0.3.7 的原始位姿）。
 * 本测试用 `deploy/agent/source.json` pin 的产物在仓库 fixture 上真实跑
 * `parseResult` / `parsePlayback` / `parseAiReview` / `parseShotReplays` 四入口，
 * 锁 canonical 投影**必需**的证据形状：
 *
 *  - `ai_review.poses` / `ai_review.turrets` **存在且是数组**（只锁存在性——具体条数
 *    是单场属性，不是通用契约）；
 *  - 契约版本门禁（playback version=2 / facets v1）真实通过。
 *
 * 本机原始问题回放（1.5MB，不入库）可加跑，额外锁该场次的具体数量：
 *   WOTB_SMOKE_REPLAY=<path/to.wotbreplay> npx vitest run src/replay-local/agent-wasm-smoke.test.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { FIXTURE_REPLAYS, fixtureFacets, replayFacets, requireFixtures, shotsViaPinnedWasm } from './__golden__/agentWasmNode.js'

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
})
