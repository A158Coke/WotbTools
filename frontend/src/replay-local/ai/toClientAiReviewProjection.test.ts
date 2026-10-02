/**
 * client canonical AI projection：语义不变量 + 永久 golden。
 *
 * golden（`common/fixtures/ai-projection/<fixture>.json.gz` = `{ battle, projection }`）由锁定版本的上游 WASM
 * 在仓库 fixture 回放上现场生成；本测试断言现场结果与已提交 golden 逐字段相等——上游 pin 或投影规则
 * 变化必须显式重生成（`WOTB_UPDATE_AI_PROJECTION_GOLDEN=1 npx vitest run <本文件>`）并在评审中可见。
 * Java 侧 `ClientAiProjectionParityTest` 读取同一 golden，与 Java 删除前冻结的 canonical 重建逐层比对语义。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'

import { fixtureFacets, type FixtureFacets } from '../__golden__/agentWasmNode.js'
import { toBattleFacts } from '../battleFacts.js'
import { toClientAiReviewProjection, UNAVAILABLE_EVIDENCE, type ClientAiReviewProjection } from './toClientAiReviewProjection.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const GOLDEN_DIR = join(REPO, 'common/fixtures/ai-projection')
const FIXTURES = ['random-battle-example', 'cw-training-15-14-example', 'tournament-14-14-example'] as const
const UPDATE = process.env.WOTB_UPDATE_AI_PROJECTION_GOLDEN === '1'

function engineOf(): { release: string; commit: string } {
  const fp = JSON.parse(readFileSync(join(REPO, 'common/assets/wasm/fingerprint.json'), 'utf8'))
  return { release: fp.tag, commit: fp.upstream_commit }
}

function project(f: FixtureFacets): ClientAiReviewProjection | null {
  return toClientAiReviewProjection({ result: f.result, playback: f.playback!, aiReview: f.aiReview!, engine: engineOf() })
}

describe('client canonical AI projection', () => {
  const facets: Record<string, FixtureFacets> = {}
  beforeAll(async () => {
    for (const name of FIXTURES) facets[name] = await fixtureFacets(`${name}.wotbreplay`)
  })

  for (const name of FIXTURES) {
    describe(name, () => {
      it('与已提交 golden 逐字段相等（golden 供 Java 语义 parity 使用）', () => {
        const f = facets[name]
        const doc = { battle: toBattleFacts(f.result), projection: project(f) }
        const path = join(GOLDEN_DIR, `${name}.json.gz`)
        if (UPDATE) {
          mkdirSync(GOLDEN_DIR, { recursive: true })
          writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 }))
        }
        expect(existsSync(path), `${path} 缺失：WOTB_UPDATE_AI_PROJECTION_GOLDEN=1 重新生成`).toBe(true)
        const golden = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'))
        expect(JSON.parse(JSON.stringify(doc))).toEqual(golden)
      })

      it('只含结算实际参战者；身份 / 队伍 / 录像者取 canonical 结论', () => {
        const f = facets[name]
        const p = project(f)!
        const settlement = new Map(f.result.players.map((pl) => [pl.account_id, pl]))
        expect(p.participants.length).toBeGreaterThan(0)
        for (const pt of p.participants) {
          expect(settlement.get(pt.accountId)?.team).toBe(pt.team)
          expect(pt.recorder).toBe(pt.accountId === f.result.author_account_id)
        }
        const ids = new Set(p.participants.map((x) => x.entityId))
        for (const list of [p.observationWindows, p.positions, p.turrets, p.prop3Health, p.healthEvents]) {
          for (const x of list) expect(ids.has(x.entityId)).toBe(true)
        }
        expect(p.perspective.recorderAccountId).toBe(f.result.author_account_id)
        expect(p.perspective.perspectiveTeam).toBe(settlement.get(f.result.author_account_id)!.team)
      })

      it('证据保持原始形态：位姿为原始观测（列式 stride 5）、HP 为原始 u16、method8 已按旧口径分类', () => {
        const p = project(facets[name])!
        for (const tr of p.positions) {
          expect(tr.stride).toBe(5)
          expect(tr.samples.length % 5).toBe(0)
          for (let i = 5; i < tr.samples.length; i += 5) expect(tr.samples[i]).toBeGreaterThanOrEqual(tr.samples[i - 5])
        }
        for (const h of [...p.prop3Health, ...p.healthEvents]) {
          expect(Number.isInteger(h.hpRaw) && h.hpRaw >= 0 && h.hpRaw <= 0xffff).toBe(true)
        }
        // 录像者实体按 Avatar 协议角色分派：它上面的 method8 不是伤害通知
        for (const n of p.damageNotices) expect(p.perspective.recorderEntityIds).not.toContain(n.envelopeEntityId)
        expect(new Set(p.damageNotices.map((n) => n.kind))).toEqual(new Set(['HIT', 'UNDECODED_VARIANT']))
      })

      it('引擎不提供的证据显式列出；完整回放无能力降级', () => {
        const p = project(facets[name])!
        expect(p.unavailableEvidence).toEqual([...UNAVAILABLE_EVIDENCE])
        expect(p.limitations).toEqual([])
        expect(p.engine.agentRelease).toMatch(/^v\d+\.\d+\.\d+$/)
      })
    })
  }

  it('视角无法解析 / 回放截断 → limitations（不缺省队伍、不假装完整）', () => {
    const f = facets['random-battle-example']
    const p1 = toClientAiReviewProjection({ result: { ...f.result, author_account_id: 0 }, playback: f.playback!, aiReview: f.aiReview!, engine: engineOf() })!
    expect(p1.perspective.perspectiveTeam).toBeNull()
    expect(p1.limitations).toContain('PERSPECTIVE_TEAM_UNRESOLVED')

    const start = f.aiReview!.battle.periods.find((x) => x.period === 3)!.clock
    const cut = start + 90
    const ai = {
      ...f.aiReview!,
      battle: { ...f.aiReview!.battle, periods: f.aiReview!.battle.periods.filter((x) => x.period !== 4) },
    }
    const pb = { ...f.playback!, meta: { ...f.playback!.meta, duration: cut } }
    const p2 = toClientAiReviewProjection({ result: f.result, playback: pb, aiReview: ai, engine: engineOf() })!
    expect(p2.limitations).toContain('REPLAY_STREAM_TRUNCATED')
    expect(p2.clock.battleEndRawClockSec).toBeNull()
  })

  it('时间轴不可用（9.8 训练室无 period 广播）→ null，AI 复盘不可执行', async () => {
    const room = await fixtureFacets('training-room-example.wotbreplay')
    expect(room.playback && room.aiReview ? project(room) : null).toBeNull()
  })
})
