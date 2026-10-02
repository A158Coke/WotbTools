/**
 * 2D 战局回放本地投影 ↔ 服务端 Java golden（`__golden__/java-playback.json`）对比。
 *
 * 两个解析器重建时间轴的方式不同（Java 1 Hz 整秒帧 + 自有 AoI/HP 事件；WASM 0.1 s 网格），
 * 所以分两档：
 *  - 身份 / 名册 / 元数据 / 终局状态 / 地图档案：逐字段相等；
 *  - 位置、朝向、血量、掉血、事件、点数、基地、消耗品、热力：按文档化容差比较，实测值打印出来。
 * 每个容差都对应一条 README 记录的已知口径差异，而不是放水。
 */

import { describe, expect, it } from 'vitest'

import javaGolden from '../__golden__/java-playback.json'
import wasmGolden from '../__golden__/wasm-playback.json'
import tier7 from '../../../../common/tankopedia-tier7.json'
import tier8 from '../../../../common/tankopedia-tier8.json'
import tier9 from '../../../../common/tankopedia-tier9.json'
import tier10 from '../../../../common/tankopedia-tier10.json'
import { createTankopedia } from '../compute/tankopedia.js'
import { validateBattlePlaybackDataset } from '../../api/contract-runtime.js'
import { validateAgentPlayback, type AgentBattleResult } from '../../api/agent-replay-facets.js'
import type { BattlePlaybackDataset, PositionSegment, VehiclePlaybackTrack } from '../../types/playback-v2.js'
import { toBattlePlaybackDataset, type AgentDamageEvent } from './toBattlePlaybackDataset.js'
import { indexMapGridProfiles, toMapOverview, type LocalMapOverview } from './toMapOverview.js'

const semantics = Object.values(import.meta.glob('../../../../common/map-semantics/*.semantic.json', {
  eager: true, import: 'default',
}))
const profiles = indexMapGridProfiles(semantics)
const tankopedia = createTankopedia([tier7, tier8, tier9, tier10])

interface JavaEntry { battlePlaybackV2?: BattlePlaybackDataset | null; mapOverview?: LocalMapOverview | null; error?: string }
interface WasmEntry { result?: AgentBattleResult; playback?: unknown; playbackError?: string; aiDamage?: AgentDamageEvent[] }
const java = javaGolden as unknown as Record<string, JavaEntry>
const wasm = wasmGolden as unknown as Record<string, WasmEntry>

function local(file: string, withAiDamage = true) {
  const w = wasm[file]
  if (!w.playback) return null
  const dataset = toBattlePlaybackDataset(validateAgentPlayback(w.playback), w.result,
    { tankopedia, damageEvents: withAiDamage ? w.aiDamage : null })
  const overview = dataset ? toMapOverview(dataset, profiles, w.result) : null
  return { dataset, overview }
}

// ---------- 度量 ----------

type Knowledge = 'OBSERVED' | 'LAST_KNOWN' | null

function segmentAt(segments: PositionSegment[], t: number): PositionSegment | null {
  let hit: PositionSegment | null = null
  for (const s of segments) if (s.startSec <= t + 1e-6 && s.endSec >= t - 1e-6) hit = s
  return hit
}

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

function knowledgeAt(track: VehiclePlaybackTrack, t: number): Knowledge {
  return (segmentAt(track.positionSegments, t)?.knowledge as Knowledge) ?? null
}

function angle(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

function hullAt(track: VehiclePlaybackTrack, t: number): number | null {
  let best: number | null = null
  for (const seg of track.orientationSegments) {
    if (seg.knowledge !== 'CURRENT' || seg.startSec > t + 1e-6 || seg.endSec < t - 1e-6) continue
    let prev = seg.samples[0]
    for (const s of seg.samples) {
      if (s.timeSec > t + 1e-6) break
      prev = s
    }
    best = prev.hullYawDeg
  }
  return best
}

function hpAt(track: VehiclePlaybackTrack, t: number): number | null {
  let hp: number | null = null
  for (const h of track.healthTransitions) if (h.timeSec <= t + 1e-6) hp = h.currentHp
  return hp
}

const rms = (xs: number[]) => (xs.length ? Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length) : 0)
const pct = (n: number, d: number) => (d ? n / d : 1)

interface Report {
  vehicles: number
  posRmsMaxM: number
  posRmsMedianM: number
  posKnowledgeAgree: number
  hullErrP95Deg: number
  hpAgree: number
  lossCountJava: number
  lossCountLocal: number
  lossMatched: number
  lossToSecMaxDiff: number
  attackerAgree: number
  destroyedMaxDiffSec: number
  killPairsJava: number
  killPairsLocal: number
  killPairsCommon: number
  damageEventsJava: number
  damageEventsLocal: number
  pointsJava: number
  pointsLocal: number
  pointsMaxDiffSec: number
  basesJava: number
  basesLocal: number
  basesMaxDiffSec: number
  consumablesJava: number
  consumablesLocal: number
  consumablesMatched: number
  moduleJava: number
  moduleLocal: number
  heatmapMaxL1: number
}

function measure(j: BattlePlaybackDataset, l: BattlePlaybackDataset, jo: LocalMapOverview, lo: LocalMapOverview): Report {
  const byId = new Map(l.vehicles.map((v) => [v.accountId, v]))
  const posRms: number[] = []
  const hullErr: number[] = []
  let kAgree = 0, kTotal = 0, hpAgree = 0, hpTotal = 0
  let lossJ = 0, lossL = 0, lossM = 0, lossDt = 0, attAgree = 0, attTotal = 0
  let consJ = 0, consL = 0, consM = 0, modJ = 0, modL = 0
  let destroyedDiff = 0
  for (const jv of j.vehicles) {
    const lv = byId.get(jv.accountId)!
    const errs: number[] = []
    // 阵亡后：上游写 0（已击毁），Java 保留最后观测值（未观测到致命一击时停在旧值）——
    // 阵亡时刻另由 destroyedMaxDiffSec 比较，终局血量由「终局状态一致」用例按同一口径比较
    const deathSec = jv.lifeTransitions.find((x) => x.lifeState === 'DESTROYED')?.destroyedKnownAtSec ?? Infinity
    for (let t = 0; t <= j.durationSec; t++) {
      const jk = knowledgeAt(jv, t)
      // Java 段在整秒帧上，跨 AoI 边界 ±1 s 的帧不计入 knowledge 一致率
      const edge = [t - 1, t + 1].some((u) => knowledgeAt(jv, u) !== jk)
      if (!edge) {
        kTotal++
        if (knowledgeAt(lv, t) === jk) kAgree++
      }
      const js = segmentAt(jv.positionSegments, t)
      const ls = segmentAt(lv.positionSegments, t)
      if (js?.knowledge === 'OBSERVED' && ls?.knowledge === 'OBSERVED' && !edge) {
        const a = positionAt(js, t), b = positionAt(ls, t)
        errs.push(Math.hypot(a.x - b.x, a.y - b.y))
        const ha = hullAt(jv, t), hb = hullAt(lv, t)
        if (ha !== null && hb !== null) hullErr.push(angle(ha, hb))
      }
      const jh = hpAt(jv, t)
      if (jh !== null && !edge && t < deathSec - 1) {
        hpTotal++
        // 血量样本在 Java 被量化到下一整秒帧：允许 ±1 s
        if ([t - 1, t, t + 1].some((u) => hpAt(lv, u) === jh)) hpAgree++
      }
    }
    if (errs.length) posRms.push(rms(errs))
    lossJ += jv.damageLosses.length
    lossL += lv.damageLosses.length
    for (const jl of jv.damageLosses) {
      const m = lv.damageLosses.find((x) => x.fromHp === jl.fromHp && x.toHp === jl.toHp)
      if (!m) continue
      lossM++
      lossDt = Math.max(lossDt, Math.abs(m.toSec - jl.toSec))
      if (jl.attackerReliable) {
        attTotal++
        if (m.attackerAccountId === jl.attackerAccountId) attAgree++
      }
    }
    consJ += jv.consumableTransitions.length
    consL += lv.consumableTransitions.length
    const pool = lv.consumableTransitions.map((c) => `${c.state}|${c.logicalItemId}|${Math.round(c.timeSec)}`)
    for (const c of jv.consumableTransitions) {
      const key = `${c.state}|${c.logicalItemId}|${Math.round(c.timeSec)}`
      const i = pool.indexOf(key)
      if (i >= 0) { consM++; pool.splice(i, 1) }
    }
    modJ += jv.moduleCrewTransitions.length
    modL += lv.moduleCrewTransitions.length
    const jd = jv.lifeTransitions.find((x) => x.lifeState === 'DESTROYED')?.destroyedKnownAtSec
    const ld = lv.lifeTransitions.find((x) => x.lifeState === 'DESTROYED')?.destroyedKnownAtSec
    if (jd != null && ld != null) destroyedDiff = Math.max(destroyedDiff, Math.abs(jd - ld))
  }
  const kills = (d: BattlePlaybackDataset) => new Set(d.events.filter((e) => e.type === 'KILL').map((e) => `${e.accountId}>${e.targetAccountId}`))
  const kj = kills(j), kl = kills(l)
  const seqDiff = <T extends { timeSec: number }>(a: T[], b: T[], same: (x: T, y: T) => boolean) => {
    let max = 0
    for (const x of a) {
      const m = b.filter((y) => same(x, y))
      if (m.length === 0) return Number.POSITIVE_INFINITY
      max = Math.max(max, Math.min(...m.map((y) => Math.abs(y.timeSec - x.timeSec))))
    }
    return max
  }
  const heat = (o: LocalMapOverview) => (['friendly', 'enemy'] as const).flatMap((side) =>
    (['dwell', 'damage', 'deaths'] as const).map((k) => {
      const xs = o.heatmaps[side][k]
      const max = Math.max(...xs, 0)
      return xs.map((x) => (max > 0 ? x / max : 0))
    }))
  const hj = heat(jo), hl = heat(lo)
  const sorted = [...posRms].sort((a, b) => a - b)
  const sortedHull = [...hullErr].sort((a, b) => a - b)
  return {
    vehicles: j.vehicles.length,
    posRmsMaxM: Math.max(...posRms),
    posRmsMedianM: sorted[Math.floor(sorted.length / 2)],
    posKnowledgeAgree: pct(kAgree, kTotal),
    hullErrP95Deg: sortedHull[Math.floor(sortedHull.length * 0.95)] ?? 0,
    hpAgree: pct(hpAgree, hpTotal),
    lossCountJava: lossJ,
    lossCountLocal: lossL,
    lossMatched: lossM,
    lossToSecMaxDiff: lossDt,
    attackerAgree: pct(attAgree, attTotal),
    destroyedMaxDiffSec: destroyedDiff,
    killPairsJava: kj.size,
    killPairsLocal: kl.size,
    killPairsCommon: [...kj].filter((k) => kl.has(k)).length,
    damageEventsJava: j.events.filter((e) => e.type === 'DAMAGE').length,
    damageEventsLocal: l.events.filter((e) => e.type === 'DAMAGE').length,
    pointsJava: j.pointsSamples.length,
    pointsLocal: l.pointsSamples.length,
    pointsMaxDiffSec: seqDiff(j.pointsSamples, l.pointsSamples, (x, y) => x.team === y.team && x.points === y.points),
    basesJava: (j.baseStates ?? []).length,
    basesLocal: (l.baseStates ?? []).length,
    basesMaxDiffSec: seqDiff(j.baseStates ?? [], l.baseStates ?? [], (x, y) => x.baseId === y.baseId
      && x.ownerTeam === y.ownerTeam && x.capturingTeam === y.capturingTeam && x.captureProgress === y.captureProgress),
    consumablesJava: consJ,
    consumablesLocal: consL,
    consumablesMatched: consM,
    moduleJava: modJ,
    moduleLocal: modL,
    heatmapMaxL1: Math.max(...hj.map((layer, i) => layer.reduce((s, x, c) => s + Math.abs(x - hl[i][c]), 0) / Math.max(1, layer.length))),
  }
}

// ---------- 用例 ----------

describe('2D 战局回放本地投影 ↔ Java golden', () => {
  it('golden 覆盖全部 fixture；Java 不可用 / WASM 失败如实记录', () => {
    expect(Object.keys(java).sort()).toEqual(Object.keys(wasm).sort())
    // 9.8 训练室：Java 不产出回放（timeline 不可用），WASM 能解析
    expect(java['training-room-example.wotbreplay'].battlePlaybackV2).toBeNull()
    // 联赛 14-14：上游 v0.3.3 parsePlayback 在 type 0 包 Pickle 解码失败；v0.3.4 自行分帧后可解析
    expect(wasm['tournament-14-14-example.wotbreplay'].playbackError).toBeUndefined()
    expect(wasm['tournament-14-14-example.wotbreplay'].playback).toBeTruthy()
  })

  const comparable = Object.keys(java).filter((f) => java[f].battlePlaybackV2 && wasm[f].playback)

  for (const file of comparable) {
    describe(file, () => {
      const j = java[file].battlePlaybackV2!
      const jo = java[file].mapOverview!
      const out = local(file)!
      const l = out.dataset!
      const lo = out.overview!

      it('通过 HTTP 契约运行时校验（drop-in）', () => {
        const v = validateBattlePlaybackDataset(JSON.parse(JSON.stringify(l)))
        expect(v.diagnostics).toEqual([])
      })

      it('身份 / 元数据 / 名册逐字段一致', () => {
        for (const k of ['durationSec', 'mapCode', 'friendlyTeam', 'recorderAccountId', 'arenaBonusType',
          'assaultObjectivePresent', 'capability', 'limitations'] as const) {
          expect(l[k], k).toEqual(j[k])
        }
        const roster = (d: BattlePlaybackDataset) => d.vehicles.map((v) => ({
          accountId: v.accountId, playerName: v.playerName, tankId: v.tankId, tankName: v.tankName,
          tankClass: v.tankClass, tankTier: v.tankTier, team: v.team, friendly: v.friendly, loadout: v.loadout,
        }))
        expect(roster(l)).toEqual(roster(j))
      })

      it('终局状态一致：阵亡集合、终局血量', () => {
        const end = (d: BattlePlaybackDataset) => d.vehicles.map((v) => ({
          accountId: v.accountId,
          destroyed: v.lifeTransitions.some((x) => x.lifeState === 'DESTROYED'),
          finalHp: v.healthTransitions[v.healthTransitions.length - 1]?.currentHp ?? null,
        }))
        const je = end(j), le = end(l)
        expect(le.map((x) => [x.accountId, x.destroyed])).toEqual(je.map((x) => [x.accountId, x.destroyed]))
        // 唯一允许的差异：Java 对「终结哨兵」不改写 HP=0（保留最后观测值），上游血量链在阵亡时刻给 0
        je.forEach((x, i) => {
          if (le[i].finalHp !== x.finalHp) expect([x.destroyed, le[i].finalHp]).toEqual([true, 0])
        })
      })

      it('地图档案逐字段一致（MapOverview 非时序部分）', () => {
        // golden 坐标已舍入到 0.01（见 tools/parity/playback-golden.mjs），本地值同样舍入后比较
        const r2 = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(2))
          : Array.isArray(v) ? v.map(r2) : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r2(x)])) : v)
        for (const k of ['mapCode', 'displayName', 'displayNames', 'friendlyTeam', 'playableBounds', 'gridCells',
          'image', 'spawnPoints', 'arenaBonusType', 'recorderAccountId'] as const) {
          expect(r2(lo[k]), k).toEqual(jo[k])
        }
      })

      it('时序数据在文档化容差内', () => {
        const r = measure(j, l, jo, lo)
        // 退化路径（不注入 AiReview 伤害事件，只用 shots[] 归因）的实测值一并打印
        const fallback = local(file, false)!
        const rShots = measure(j, fallback.dataset!, jo, fallback.overview!)
        console.info(`[playback parity] ${file}\n${JSON.stringify(r, null, 2)}\n`
          + `shots-only attribution: attackerAgree=${rShots.attackerAgree.toFixed(3)} damageEvents=${rShots.damageEventsLocal}\n`
          + `phases java=${JSON.stringify(jo.phases)} local=${JSON.stringify(lo.phases)}`)
        expect(r.posRmsMaxM).toBeLessThan(TOL.posRmsMaxM)
        expect(r.posKnowledgeAgree).toBeGreaterThan(TOL.posKnowledgeAgree)
        expect(r.hullErrP95Deg).toBeLessThan(TOL.hullErrP95Deg)
        expect(r.hpAgree).toBeGreaterThan(TOL.hpAgree)
        expect(r.lossMatched).toBe(r.lossCountJava)
        expect(r.lossToSecMaxDiff).toBeLessThan(TOL.lossToSecMaxDiff)
        expect(r.attackerAgree).toBeGreaterThan(TOL.attackerAgree)
        expect(r.destroyedMaxDiffSec).toBeLessThan(TOL.destroyedMaxDiffSec)
        expect(r.killPairsCommon).toBe(r.killPairsJava)
        expect(r.pointsLocal).toBe(r.pointsJava)
        expect(r.pointsMaxDiffSec).toBeLessThan(TOL.eventTimeSec)
        expect(r.basesLocal).toBe(r.basesJava)
        expect(r.basesMaxDiffSec).toBeLessThan(TOL.eventTimeSec)
        expect(r.consumablesMatched / Math.max(1, r.consumablesJava)).toBeGreaterThan(TOL.consumableMatch)
        expect(r.heatmapMaxL1).toBeLessThan(TOL.heatmapMaxL1)
        // phases：UI 不读（MapOverview.vue 只读 heatmaps/gridCells/spawnPoints/名称/边界），只比 late 段
        // （同一时长口径）；opening 终点 Java 取 legacy DamageEvent（本组 fixture 为空 → 固定 45 s），本地取首次伤害
        const late = (o: LocalMapOverview) => o.phases.find((p) => p.key === 'late')
        expect(late(lo)).toEqual(late(jo))
      })
    })
  }
})

/**
 * 容差（2026-10-02 · 上游 v0.3.4 实测：random / CW / 联赛 14-14 三场）。每项都对应一条已知口径差异：
 *  - 位置：Java 1 Hz 帧 vs 上游 0.1 s 网格（本地抽 0.5 s）→ 每车 RMS 实测 ≤ 1.98 m（中位 0.59–0.79 m）；
 *  - knowledge：只在 AoI 边界 ±1 s 外比较 → 实测 0.9995 / 1.0；
 *  - 车体朝向：Java 取整秒位置包 yaw，上游取网格 → P95 实测 5.6° / 7.8°；
 *  - 血量：样本在 Java 被量化到下一整秒帧（±1 s 比较），只比存活期（阵亡后上游写 0、Java 停在最后观测值）；
 *  - 掉血 toSec / 阵亡时刻 / 点数 / 基地：同一原始时钟，只差 0.01 s 舍入 → 实测 ≤ 0.006 s；
 *  - 归因：AiReview 伤害事件 → 实测 1.0 / 1.0（只用 shots[] 时 0.929 / 0.828）；
 *  - 热力：层内 max 归一化后每格平均 |Δ| 实测 0.032 / 0.087（Java 按原始位置包计数）。
 */
const TOL = {
  posRmsMaxM: 3,
  posKnowledgeAgree: 0.99,
  hullErrP95Deg: 10,
  hpAgree: 0.95,
  lossToSecMaxDiff: 0.01,
  attackerAgree: 0.99,
  destroyedMaxDiffSec: 0.01,
  eventTimeSec: 0.01,
  consumableMatch: 0.999,
  heatmapMaxL1: 0.1,
}
