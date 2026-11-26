
import { beforeAll, describe, expect, it } from 'vitest'

import javaGolden from '../__golden__/java-playback.json'
import { fixtureFacets, requireFixtures, FIXTURE_REPLAYS, type FixtureFacets } from '../__golden__/agentWasmNode.js'
import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia } from '../compute/tankopedia.js'
import { validateBattlePlaybackDataset } from '../../api/contract-runtime.js'
import { validateAgentAiReview, type AgentAiReviewFacet } from '../../api/agent-replay-facets.js'
import type {
  BattlePlaybackDataset, HealthTransition, LifeTransition, PositionSegment, VehiclePlaybackTrack,
} from '../../types/playback-v2.js'
import { PERSPECTIVE_TEAM_UNRESOLVED, REPLAY_STREAM_TRUNCATED, toBattlePlaybackDataset } from './toBattlePlaybackDataset.js'
import { indexMapGridProfiles, toMapOverview, type LocalMapOverview } from './toMapOverview.js'

const semantics = Object.values(import.meta.glob('../../../../common/map-semantics/*.semantic.json', {
  eager: true, import: 'default',
}))
const profiles = indexMapGridProfiles(semantics)
const tankopedia = createTankopedia([tier7, tier8, tier9, tier10])

interface JavaEntry { battlePlaybackV2?: BattlePlaybackDataset | null; mapOverview?: LocalMapOverview | null }
const java = javaGolden as unknown as Record<string, JavaEntry>

const PINNED_KNOWLEDGE_DIFFS: Array<{ file: string; accountId: number; t: number; java: string | null; local: string | null; reason: string }> = []

const PINNED_BASE_ABORT_CLEARS: Record<string, number> = {
  'random-battle-example.wotbreplay': 0,
  'cw-training-15-14-example.wotbreplay': 0,
  'tournament-14-14-example.wotbreplay': 2,
}
const PINNED_ASSAULT_RESET_ROWS: Record<string, number> = {
  'random-battle-example.wotbreplay': 1,
  'cw-training-15-14-example.wotbreplay': 0,
  'tournament-14-14-example.wotbreplay': 0,
}

const PINNED_LOADOUT_UPGRADES: Record<string, number> = {
  'random-battle-example.wotbreplay': 5,
  'cw-training-15-14-example.wotbreplay': 0,
  'tournament-14-14-example.wotbreplay': 1,
}

const PINNED_LOADOUT_CORRECTIONS: Record<string, Record<number, { provisions?: string[]; confidence?: string }>> = {
  'tournament-14-14-example.wotbreplay': {
    3105519605: {
      provisions: ['LARGE_FOOD', 'IMPROVED_FUEL', 'IMPROVED_GEAR_OIL'],
      confidence: 'HIGH',
    },
    3116319903: {
      provisions: ['LARGE_FOOD', 'IMPROVED_GEAR_OIL', 'IMPROVED_FUEL'],
      confidence: 'HIGH',
    },
  },
}

function datasetOf(f: FixtureFacets): ReturnType<typeof toBattlePlaybackDataset> {
  const { playback, result, aiReview } = requireFixtures(f)
  return toBattlePlaybackDataset(playback, result, aiReview, { tankopedia })
}


function segmentAt<T extends { startSec: number; endSec: number }>(segments: T[], t: number): T | null {
  let hit: T | null = null
  for (const s of segments) if (s.startSec <= t + 1e-6 && s.endSec >= t - 1e-6) hit = s
  return hit
}

function lastAt<T extends { timeSec: number }>(list: T[], t: number): T | null {
  let hit: T | null = null
  for (const x of list) if (x.timeSec <= t + 1e-6) hit = x
  return hit
}

const healthKey = (h: HealthTransition | null) => h && [h.currentHp, h.knowledge, h.source, h.confidence, h.displayCapacityHp, h.relativeFull].join('|')
const lifeKey = (l: LifeTransition | null) => l?.lifeState ?? null

function positionAt(seg: PositionSegment, t: number): { x: number; y: number } {
  const s = seg.samples
  if (seg.knowledge !== 'OBSERVED' || s.length === 1) return s[s.length - 1]
  for (let i = 1; i < s.length; i++) {
    if (s[i].timeSec >= t) {
      const a = s[i - 1], b = s[i]
      const k = b.timeSec === a.timeSec ? 1 : (t - a.timeSec) / (b.timeSec - a.timeSec)
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
  }
  return s[s.length - 1]
}

const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
const lossKey = (l: VehiclePlaybackTrack['damageLosses'][number]) =>
  [l.fromHp, l.toHp, l.hpLoss, l.attackerAccountId, l.attackerReliable, l.damageEventCount, l.displayCapacityHp, l.transientAllowed].join('|')

function multisetDiff(a: string[], b: string[]): { missing: string[]; extra: string[] } {
  const pool = [...b]
  const missing: string[] = []
  for (const x of a) {
    const i = pool.indexOf(x)
    if (i >= 0) pool.splice(i, 1)
    else missing.push(x)
  }
  return { missing, extra: pool }
}


const comparable = Object.keys(java).filter((f) => java[f].battlePlaybackV2)

describe('2D 战局回放 canonical 语义 ↔ Java golden', () => {
  it('golden 覆盖全部 fixture；Java 不可用的场次本地同样不可用', async () => {
    expect(Object.keys(java).sort()).toEqual(Object.keys(FIXTURE_REPLAYS).sort())
    const room = await fixtureFacets('training-room-example.wotbreplay')
    expect(java['training-room-example.wotbreplay'].battlePlaybackV2).toBeNull()
    expect(room.playbackError, String(room.playbackError)).toBeNull()
    expect(room.aiReviewError, String(room.aiReviewError)).toBeNull()
    expect(datasetOf(room)).toBeNull()
  })

  for (const file of comparable) {
    describe(file, () => {
      const j = java[file].battlePlaybackV2!
      const jo = java[file].mapOverview!
      let l: BattlePlaybackDataset
      let lo: LocalMapOverview
      let byId: Map<number, VehiclePlaybackTrack>
      beforeAll(async () => {
        const f = await fixtureFacets(file)
        l = datasetOf(f)!
        lo = toMapOverview(l, profiles, f.result)!
        byId = new Map(l.vehicles.map((v) => [v.accountId, v]))
      })

      it('通过 HTTP 契约运行时校验（drop-in）', () => {
        expect(validateBattlePlaybackDataset(JSON.parse(JSON.stringify(l))).diagnostics).toEqual([])
      })

      it('定时消耗品 lifecycle 携带上游派生的 duration/endsAt（v0.4.18 pin）', () => {
        const observed = l.vehicles.flatMap((v) => v.consumableTransitions)
          .filter((t) => !t.invalidation && t.state === 'ACTIVATED'
            && typeof t.durationSec === 'number' && t.durationSec > 0)
        expect(observed.length, 'ACTIVATED 且 duration>0 的定时消耗品条数').toBeGreaterThan(0)
        for (const t of observed) {
          expect(t.endsAt, JSON.stringify(t)).not.toBeNull()
          expect(t.endsAt!).toBeGreaterThanOrEqual(t.timeSec)
          expect(t.everActivated, JSON.stringify(t)).toBe(true)
        }
      })

      it('身份 / 元数据 / 名册 / capability / limitations 逐字段一致', () => {
        for (const k of ['durationSec', 'mapCode', 'friendlyTeam', 'recorderAccountId', 'arenaBonusType',
          'assaultObjectivePresent', 'capability', 'limitations'] as const) {
          expect(l[k], k).toEqual(j[k])
        }
        const roster = (d: BattlePlaybackDataset) => d.vehicles.map((v) => ({
          accountId: v.accountId, playerName: v.playerName, tankId: v.tankId, tankName: v.tankName,
          tankClass: v.tankClass, tankTier: v.tankTier, team: v.team, friendly: v.friendly, loadout: v.loadout,
        }))
        const jr = roster(j)
        const lr = roster(l)
        expect(lr.map((x) => x.accountId)).toEqual(jr.map((x) => x.accountId))
        const upgrades: number[] = []
        for (let i = 0; i < jr.length; i++) {
          const a = jr[i]
          const b = lr[i]
          if (a.loadout === null && b.loadout !== null) {
            upgrades.push(a.accountId)
            expect({ ...b, loadout: null }).toEqual(a)
            continue
          }
          const correction = PINNED_LOADOUT_CORRECTIONS[file]?.[a.accountId]
          if (correction && a.loadout) {
            expect(b).toEqual({ ...a, loadout: { ...a.loadout, ...correction } })
            continue
          }
          expect(b).toEqual(a)
        }
        expect(upgrades, `loadout 升级清单（Java null → 本地有值）变化：${JSON.stringify(upgrades)}`)
          .toHaveLength(PINNED_LOADOUT_UPGRADES[file] ?? 0)
      })

      it('位置 / 朝向 knowledge：每个整秒帧一致（仅固定差异放行）', () => {
        const diffs: Array<{ accountId: number; t: number; java: string | null; local: string | null }> = []
        for (const jv of j.vehicles) {
          const lv = byId.get(jv.accountId)!
          for (let t = 0; t <= j.durationSec; t++) {
            const jk = segmentAt(jv.positionSegments, t)?.knowledge ?? null
            const lk = segmentAt(lv.positionSegments, t)?.knowledge ?? null
            if (jk !== lk) diffs.push({ accountId: jv.accountId, t, java: jk, local: lk })
            const jo2 = segmentAt(jv.orientationSegments, t)?.knowledge ?? null
            const lo2 = segmentAt(lv.orientationSegments, t)?.knowledge ?? null
            if (jk === lk) expect([jv.accountId, t, lo2]).toEqual([jv.accountId, t, jo2])
          }
        }
        expect(diffs).toEqual(PINNED_KNOWLEDGE_DIFFS.filter((p) => p.file === file)
          .map(({ accountId, t, java: jk, local: lk }) => ({ accountId, t, java: jk, local: lk })))
      })

      it('位置 / 车体朝向：OBSERVED 帧上与 Java 原始位置包的偏差在网格分辨率内', () => {
        let worstRms = 0
        const hull: number[] = []
        for (const jv of j.vehicles) {
          const lv = byId.get(jv.accountId)!
          const errs: number[] = []
          for (let t = 0; t <= j.durationSec; t++) {
            const js = segmentAt(jv.positionSegments, t)
            const ls = segmentAt(lv.positionSegments, t)
            if (js?.knowledge !== 'OBSERVED' || ls?.knowledge !== 'OBSERVED') continue
            const a = positionAt(js, t), b = positionAt(ls, t)
            errs.push(Math.hypot(a.x - b.x, a.y - b.y))
            const jh = lastAt(segmentAt(jv.orientationSegments, t)?.samples ?? [], t)?.hullYawDeg
            const lh = lastAt(segmentAt(lv.orientationSegments, t)?.samples ?? [], t)?.hullYawDeg
            if (jh != null && lh != null) hull.push(angle(jh, lh))
          }
          if (errs.length) worstRms = Math.max(worstRms, Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length))
        }
        hull.sort((a, b) => a - b)
        expect(worstRms).toBeLessThan(3)
        expect(hull[Math.floor(hull.length * 0.95)]).toBeLessThan(10)
      })

      it('LAST_KNOWN 不前进：段内位置恒定、不允许插值；OBSERVED 段之外不存在 CURRENT 朝向', () => {
        for (const v of l.vehicles) {
          for (const s of v.positionSegments.filter((x) => x.knowledge === 'LAST_KNOWN')) {
            expect(s.interpolationAllowed).toBe(false)
            for (const p of s.samples) expect([p.x, p.y]).toEqual([s.samples[0].x, s.samples[0].y])
          }
          for (const o of v.orientationSegments.filter((x) => x.knowledge === 'CURRENT')) {
            for (const smp of o.samples) expect(segmentAt(v.positionSegments, smp.timeSec)?.knowledge).toBe('OBSERVED')
          }
        }
      })

      it('血量：每个整秒帧的 当前血量 / knowledge / provenance / 置信度 / 量程 / relativeFull 一致', () => {
        for (const jv of j.vehicles) {
          const lv = byId.get(jv.accountId)!
          for (let t = 0; t <= j.durationSec; t++) {
            expect([jv.accountId, t, healthKey(lastAt(lv.healthTransitions, t))])
              .toEqual([jv.accountId, t, healthKey(lastAt(jv.healthTransitions, t))])
          }
        }
      })

      it('生命：每个整秒帧的生命状态一致；击毁时刻差 ≤ 0.01 s（Java 舍入）', () => {
        for (const jv of j.vehicles) {
          const lv = byId.get(jv.accountId)!
          for (let t = 0; t <= j.durationSec; t++) {
            expect([jv.accountId, t, lifeKey(lastAt(lv.lifeTransitions, t))])
              .toEqual([jv.accountId, t, lifeKey(lastAt(jv.lifeTransitions, t))])
          }
          const jd = jv.lifeTransitions.find((x) => x.lifeState === 'DESTROYED')?.destroyedKnownAtSec ?? null
          const ld = lv.lifeTransitions.find((x) => x.lifeState === 'DESTROYED')?.destroyedKnownAtSec ?? null
          expect(ld === null, `${jv.accountId} destroyed`).toBe(jd === null)
          if (jd !== null && ld !== null) expect(Math.abs(jd - ld)).toBeLessThan(0.01)
        }
      })

      it('掉血：区间 / 血量 / 攻击者 / 可靠性 / 证据条数 / 量程 / transientAllowed 多重集精确相等', () => {
        for (const jv of j.vehicles) {
          const lv = byId.get(jv.accountId)!
          expect(multisetDiff(jv.damageLosses.map(lossKey), lv.damageLosses.map(lossKey)), String(jv.accountId))
            .toEqual({ missing: [], extra: [] })
          const jt = jv.damageLosses.map((x) => [x.fromSec, x.toSec]).sort((a, b) => a[0] - b[0])
          const lt = lv.damageLosses.map((x) => [x.fromSec, x.toSec]).sort((a, b) => a[0] - b[0])
          jt.forEach(([f, t], i) => {
            expect(Math.abs(f - lt[i][0])).toBeLessThan(0.01)
            expect(Math.abs(t - lt[i][1])).toBeLessThan(0.01)
          })
        }
      })

      it('事件：DAMAGE（攻击者→受击者）/ KILL / DESTROYED 多重集一致', () => {
        const key = (d: BattlePlaybackDataset, type: string) => d.events.filter((e) => e.type === type)
          .map((e) => `${e.accountId}>${e.targetAccountId}|${e.observedHpLoss}`)
        for (const type of ['DAMAGE', 'KILL', 'DESTROYED']) {
          expect(multisetDiff(key(j, type), key(l, type)), type).toEqual({ missing: [], extra: [] })
        }
        const times = (d: BattlePlaybackDataset) => d.events.filter((e) => e.type === 'DESTROYED')
          .map((e) => [e.accountId, e.timeSec] as const).sort((a, b) => a[0]! - b[0]!)
        times(j).forEach(([, t], i) => expect(Math.abs(t - times(l)[i][1])).toBeLessThan(0.01))
      })

      it('点数 / 基地：同序列、同时刻（≤ 0.01 s）；消耗品 / 模块迁移一致', () => {
        const pts = (d: BattlePlaybackDataset) => d.pointsSamples.map((p) => `${p.team}:${p.points}`)
        expect(pts(l)).toEqual(pts(j))
        l.pointsSamples.forEach((p, i) => expect(Math.abs(p.timeSec - j.pointsSamples[i].timeSec)).toBeLessThan(0.01))
        const bases = (d: BattlePlaybackDataset) => (d.baseStates ?? []).map((b) => `${b.baseId}:${b.ownerTeam}:${b.capturingTeam}:${b.captureProgress}`)
        const ZERO_ASSAULT = /^BASE:null:null:0$/
        const all = bases(l)
        const resets = all.filter((r) => ZERO_ASSAULT.test(r))
        const lb = all.filter((r) => !ZERO_ASSAULT.test(r))
        const jb = bases(j)
        expect(resets.length, `单基地归零行数应为冻结值 ${PINNED_ASSAULT_RESET_ROWS[file]}`)
          .toBe(PINNED_ASSAULT_RESET_ROWS[file])
        expect(lb.length, `基地行数差异只允许"单基地归零行"一类：local=${JSON.stringify(all)} java=${JSON.stringify(jb)}`).toBe(jb.length)
        let clearedByAbort = 0
        lb.forEach((b, i) => {
          if (b === jb[i]) return
          const [bId, o, c, p] = b.split(':')
          const jId = jb[i].split(':')[0]
          expect(bId === jId && o === 'null' && c === 'null' && p === 'null',
            `基地差异只允许"占领中断清空"一类：java=${jb[i]} local=${b}`).toBe(true)
          clearedByAbort++
        })
        expect(clearedByAbort, `占领中断清空行数应为冻结值 ${PINNED_BASE_ABORT_CLEARS[file]}`)
          .toBe(PINNED_BASE_ABORT_CLEARS[file])
        ;(l.baseStates ?? []).filter((b) => !(b.baseId === 'BASE' && b.captureProgress === 0)).forEach((b, i) => expect(Math.abs(b.timeSec - j.baseStates![i].timeSec)).toBeLessThan(0.02))
        for (const jv of j.vehicles) {
          const lv = byId.get(jv.accountId)!
          const c = (v: VehiclePlaybackTrack) => v.consumableTransitions.map((x) => `${x.state}|${x.logicalItemId}|${Math.round(x.timeSec)}`)
          expect(multisetDiff(c(jv), c(lv)).missing).toEqual([])
          const m = (v: VehiclePlaybackTrack) => v.moduleCrewTransitions.map((x) => `${x.component}|${x.state}|${Math.round(x.timeSec)}`)
          if (jv.moduleCrewTransitions.length > 0) expect(m(lv)).toEqual(m(jv))
          else if (lv.moduleCrewTransitions.length > 0) {
            expect(jv.accountId).toBe(j.recorderAccountId)
            expect(lv.moduleCrewTransitions.every((x) => x.recorderVisible)).toBe(true)
          }
        }
      })

      it('地图档案逐字段一致（MapOverview 非时序部分）', () => {
        const r2 = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(2))
          : Array.isArray(v) ? v.map(r2) : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r2(x)])) : v)
        for (const k of ['mapCode', 'displayName', 'displayNames', 'friendlyTeam', 'playableBounds', 'gridCells',
          'image', 'spawnPoints', 'arenaBonusType', 'recorderAccountId'] as const) {
          expect(r2(lo[k]), k).toEqual(jo[k])
        }
        const late = (o: LocalMapOverview) => o.phases.find((p) => p.key === 'late')
        expect(late(lo)).toEqual(late(jo))
      })
    })
  }
})


describe('2D canonical 场景', () => {
  let random: FixtureFacets, cw: FixtureFacets, tournament: FixtureFacets
  beforeAll(async () => {
    [random, cw, tournament] = await Promise.all([
      fixtureFacets('random-battle-example.wotbreplay'),
      fixtureFacets('cw-training-15-14-example.wotbreplay'),
      fixtureFacets('tournament-14-14-example.wotbreplay'),
    ])
  })

  it('随机战（攻防图）：单基地目标存在 + 占领进度（BASE，无队伍语义）', () => {
    const d = datasetOf(random)!
    expect(d.arenaBonusType).toBe(1)
    expect(d.assaultObjectivePresent).toBe(true)
    expect(d.baseStates!.every((b) => b.baseId === 'BASE' && b.ownerTeam === null && b.capturingTeam === null)).toBe(true)
    expect(d.baseStates!.map((b) => b.captureProgress)).toEqual([1, 2, 3, 0])
  })

  it('联赛（arenaBonusType 4）与 CW（2）：争霸点数 + A–D 基地归属迁移', () => {
    for (const f of [cw, tournament]) {
      const d = datasetOf(f)!
      expect(d.pointsSamples.length).toBeGreaterThan(0)
      expect(new Set(d.pointsSamples.map((p) => p.team))).toEqual(new Set([1, 2]))
      expect(d.baseStates!.some((b) => b.ownerTeam !== null)).toBe(true)
      expect(d.baseStates!.every((b) => ['A', 'B', 'C', 'D'].includes(b.baseId))).toBe(true)
    }
    expect(datasetOf(tournament)!.arenaBonusType).toBe(4)
    expect(datasetOf(cw)!.arenaBonusType).toBe(2)
  })

  it('基地存在但全程无占领：目标存在性独立于进度，不因没有迁移就判定无基地', () => {
    const { playback, result, aiReview } = requireFixtures(random)
    const pb = { ...playback, assault_bases: [] }
    const d = toBattlePlaybackDataset(pb, result, aiReview, { tankopedia })!
    expect(d.assaultObjectivePresent).toBe(true)
    expect(d.baseStates).toEqual([])
    expect(d.capability).toBe('FULL')
  })

  it('录像者阵亡：DESTROYED 生命迁移 + DESTROYED 事件，阵亡后不再有 ALIVE', () => {
    for (const f of [cw, tournament]) {
      const d = datasetOf(f)!
      const rec = d.vehicles.find((v) => v.accountId === d.recorderAccountId)!
      const death = rec.lifeTransitions.find((x) => x.lifeState === 'DESTROYED')!
      expect(death.destroyedKnownAtSec).not.toBeNull()
      expect(rec.lifeTransitions.filter((x) => x.timeSec > death.timeSec).every((x) => x.lifeState === 'DESTROYED')).toBe(true)
      expect(d.events.some((e) => e.type === 'DESTROYED' && e.accountId === d.recorderAccountId)).toBe(true)
    }
  })

  it('录像者被击中：method8 在录像者 Avatar 实体上不是伤害通知 → 掉血无直击证据（固定的旧口径）', () => {
    const d = datasetOf(tournament)!
    const rec = d.vehicles.find((v) => v.accountId === d.recorderAccountId)!
    expect(rec.damageLosses.length).toBeGreaterThan(0)
    expect(rec.damageLosses.every((x) => !x.attackerReliable && x.attackerAccountId === null && x.damageEventCount === 0)).toBe(true)
  })

  it('临时离开视野 → LAST_KNOWN；重新观测 → CURRENT（段边界 = AoI 观测段边界）', () => {
    const f = cw
    const d = datasetOf(f)!
    const start = f.aiReview!.battle.periods.find((p) => p.period === 3)!.clock
    let checked = 0
    for (const v of d.vehicles) {
      const segs = v.positionSegments
      for (let i = 1; i + 1 < segs.length; i++) {
        if (segs[i - 1].knowledge !== 'OBSERVED' || segs[i].knowledge !== 'LAST_KNOWN' || segs[i + 1].knowledge !== 'OBSERVED') continue
        const eids = f.aiReview!.rosters.filter((r) => r.account_id === v.accountId).map((r) => r.eid)
        const windows = f.aiReview!.events.filter((e) => e.type === 'visibility' && eids.includes(e.eid))
          .map((e) => e as { t_in: number; t_out?: number }).map((e) => [e.t_in - start, e.t_out === undefined ? Infinity : e.t_out - start])
        expect(windows.some(([, out]) => segs[i].startSec >= out - 1e-6 && segs[i].startSec - out <= 0.5 + 1e-6)).toBe(true)
        expect(windows.some(([inn, out]) => segs[i + 1].startSec >= inn - 1e-6 && segs[i + 1].startSec < out)).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('掉血归属三态：确认攻击者 / 证据冲突（≥1 条但不可靠）/ 无证据（0 条）并存，未知攻击者绝不强行归因', () => {
    const all = [random, cw, tournament].flatMap((f) => datasetOf(f)!.vehicles.flatMap((v) => v.damageLosses))
    expect(all.some((x) => x.attackerReliable && x.attackerAccountId !== null && x.damageEventCount >= 1)).toBe(true)
    expect(all.some((x) => !x.attackerReliable && x.damageEventCount >= 1)).toBe(true)
    expect(all.some((x) => !x.attackerReliable && x.damageEventCount === 0)).toBe(true)
    expect(all.filter((x) => !x.attackerReliable).every((x) => x.attackerAccountId === null)).toBe(true)
  })

  it('终态哨兵 0xFFFD：血量未知、不改写为 0（与 Java 同为停在最后一个可信值），也不产生致死掉血', () => {
    const d = datasetOf(tournament)!
    const v = d.vehicles.find((x) => x.accountId === 3101365552)!
    expect(v.lifeTransitions.some((x) => x.lifeState === 'DESTROYED')).toBe(true)
    expect(v.healthTransitions.at(-1)!.currentHp).toBe(33)
    expect(v.damageLosses.some((x) => x.toHp === 0)).toBe(false)
  })

  it('回放在战斗结束前截断（无 AFTERBATTLE、流末早于时长）→ REPLAY_STREAM_TRUNCATED / PARTIAL', () => {
    const f = random
    const start = f.aiReview!.battle.periods.find((p) => p.period === 3)!.clock
    const cut = start + 100
    const ai: AgentAiReviewFacet = {
      ...f.aiReview!,
      battle: { ...f.aiReview!.battle, periods: f.aiReview!.battle.periods.filter((p) => p.period !== 4) },
      events: f.aiReview!.events.filter((e) => ('t' in e ? e.t : e.t_in) <= cut),
    }
    const pb = { ...f.playback!, periods: f.playback!.periods.filter((p) => p.period !== 4), meta: { ...f.playback!.meta, duration: cut } }
    const d = toBattlePlaybackDataset(pb, f.result, ai, { tankopedia })!
    expect(d.limitations).toContain(REPLAY_STREAM_TRUNCATED)
    expect(d.capability).toBe('PARTIAL')
  })

  it('参战者缺实体映射 → PLAYBACK_COMBATANT_TRACK_INCOMPLETE；视角无法解析 → 不缺省队伍、PARTIAL', () => {
    const f = random
    const missing = f.result.players.find((p) => p.account_id !== f.result.author_account_id)!.account_id
    const ai = { ...f.aiReview!, rosters: f.aiReview!.rosters.filter((r) => r.account_id !== missing) }
    const d1 = toBattlePlaybackDataset(f.playback!, f.result, ai, { tankopedia })!
    expect(d1.limitations).toContain('PLAYBACK_COMBATANT_TRACK_INCOMPLETE')
    expect(d1.vehicles.some((v) => v.accountId === missing)).toBe(false)

    const d2 = toBattlePlaybackDataset(f.playback!, { ...f.result, author_account_id: 0 }, f.aiReview!, { tankopedia })!
    expect(d2.friendlyTeam).toBeNull()
    expect(d2.vehicles.every((v) => v.friendly === null)).toBe(true)
    expect(d2.limitations).toContain(PERSPECTIVE_TEAM_UNRESOLVED)
    expect(d2.capability).toBe('PARTIAL')
  })

  it('实体自报队伍与结算矛盾 → 该实体不进 canonical、TEAM_ENTITY_MAPPING_CONFLICT', () => {
    const f = random
    const victim = f.aiReview!.rosters.find((r) => r.account_id && r.team && r.account_id !== f.result.author_account_id)!
    const ai = { ...f.aiReview!, rosters: f.aiReview!.rosters.map((r) => (r === victim ? { ...r, team: r.team === 1 ? 2 : 1 } : r)) }
    const d = toBattlePlaybackDataset(f.playback!, f.result, ai, { tankopedia })!
    expect(d.limitations).toContain('TEAM_ENTITY_MAPPING_CONFLICT')
    expect(d.vehicles.some((v) => v.accountId === victim.account_id)).toBe(false)
  })

  it('畸形 / 旧版 AiReview 切面（缺 hp_raw 或 prop3 health）在信任边界被拒绝，不降级猜测', () => {
    const ai = random.aiReview!
    const noRaw = { ...ai, events: ai.events.map((e) => (e.type === 'damage' ? { ...e, hp_raw: undefined } : e)) }
    expect(() => validateAgentAiReview(JSON.parse(JSON.stringify(noRaw)), 'current-producer')).toThrow(/hp_raw/)
    const noProp3 = { ...ai, events: ai.events.filter((e) => e.type !== 'health') }
    expect(() => validateAgentAiReview(noProp3, 'current-producer')).toThrow(/health/)
  })
})
