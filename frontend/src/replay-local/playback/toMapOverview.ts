/**
 * 2D「地图鸟瞰」MapOverview（服务端 map-overview artifact 同形状）的本地投影：
 * 地图档案取仓库 `common/map-semantics/*.semantic.json`（Java `MapGridRegistry` 同源），
 * 三语名取 `common/map_names.json`（Java `MapNames` 同源），热力/路线/阶段由
 * `toBattlePlaybackDataset` 的输出聚合（Java `MapOverviewBuilder` 同规则）。
 *
 * 与 Java 的口径差异：Java 的驻留热力/路线按原始 Type10 位置包计数；这里按回放数据集的
 * OBSERVED 位置样本（等间隔）计数——绝对值不同，前端按层内 max 归一化后可比（golden 量化）。
 */

import MAP_NAMES from '../../../../common/map_names.json'
import type { BattlePlaybackDataset, VehiclePlaybackTrack } from '../../types/playback-v2.js'
import type { AgentBattleResult } from '../../api/agent-replay-facets.js'

export interface MapBounds { xMin: number; xMax: number; yMin: number; yMax: number }
export interface MapGridCell { id: string; nineGridRegion: number; bounds: MapBounds }
export interface MapSpawnPoint { name: string; team: number; x: number; y: number }
export interface MapPhase { key: 'opening' | 'mid' | 'late'; startSec: number; endSec: number }
export interface MapHeatLayer { dwell: number[]; damage: number[]; deaths: number[] }
export interface MapRoutePoint { x: number; y: number; timeSec: number }
export interface MapRoute {
  accountId: number
  playerName: string
  tankId: number
  team: number
  points: MapRoutePoint[]
  firstObservedSec: number
  lastObservedSec: number
  deathSec: number | null
}

/** 服务端 `MapOverview` record 的 JSON 形状（`java/wotb-playback/.../dto/MapOverview.java`）。 */
export interface LocalMapOverview {
  mapCode: string
  displayName: string
  displayNames: Record<string, string>
  friendlyTeam: number
  playableBounds: MapBounds
  gridCells: MapGridCell[]
  image: null
  spawnPoints: MapSpawnPoint[]
  phases: MapPhase[]
  heatmaps: { friendly: MapHeatLayer; enemy: MapHeatLayer }
  routes: MapRoute[]
  arenaBonusType: number | null
  recorderAccountId: number | null
}

/** Java `MapGridProfile`：语义文件中 overview 需要的部分。 */
export interface MapGridProfile {
  displayName: string
  playableBounds: MapBounds
  gridCells: MapGridCell[]
  spawnPoints: MapSpawnPoint[]
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const bounds = (v: unknown): MapBounds | null =>
  isObj(v) && ['xMin', 'xMax', 'yMin', 'yMax'].every((k) => typeof v[k] === 'number')
    ? { xMin: v.xMin as number, xMax: v.xMax as number, yMin: v.yMin as number, yMax: v.yMax as number }
    : null

/** Java `MapGridRegistry.parse`：缺边界/无有效网格 → null。 */
export function parseMapGridProfile(semantic: unknown): MapGridProfile | null {
  if (!isObj(semantic) || typeof semantic.mapId !== 'string' || !semantic.mapId) return null
  const playable = bounds(semantic.playableBoundsMeters)
  if (!playable) return null
  const cells: MapGridCell[] = []
  const grid = isObj(semantic.analysisGrid) ? semantic.analysisGrid.cells : null
  for (const c of Array.isArray(grid) ? grid : []) {
    if (!isObj(c)) continue
    const b = bounds(c.boundsMeters)
    if (!b) continue
    cells.push({ id: typeof c.id === 'string' ? c.id : '', nineGridRegion: Math.trunc(num(c.nineGridRegion, -1)), bounds: b })
  }
  if (cells.length === 0) return null
  const spawns: MapSpawnPoint[] = []
  const points = isObj(semantic.sceneEvidence) ? semantic.sceneEvidence.battlePoints : null
  for (const p of Array.isArray(points) ? points : []) {
    if (!isObj(p) || p.type !== 'spawnpoint' || !Array.isArray(p.position) || p.position.length < 2) continue
    spawns.push({
      name: typeof p.name === 'string' ? p.name : '',
      team: Math.trunc(num(p.team, -1)),
      x: num(p.position[0]),
      y: num(p.position[1]),
    })
  }
  return {
    displayName: typeof semantic.displayName === 'string' ? semantic.displayName : semantic.mapId,
    playableBounds: playable,
    gridCells: cells,
    spawnPoints: spawns,
  }
}

/** Java `MapGridRegistry.load`：按 mapId 与 mapCodes（小写）建索引，先到先得。 */
export function indexMapGridProfiles(semantics: readonly unknown[]): Map<string, MapGridProfile> {
  const out = new Map<string, MapGridProfile>()
  for (const s of semantics) {
    const profile = parseMapGridProfile(s)
    if (!profile || !isObj(s)) continue
    const keys = [s.mapId, ...(Array.isArray(s.mapCodes) ? s.mapCodes : [])]
    for (const k of keys) {
      const key = typeof k === 'string' ? k.trim().toLowerCase() : ''
      if (key && !out.has(key)) out.set(key, profile)
    }
  }
  return out
}

/** Java `MapGridProfile.cellAt`：首个包含点的格子（闭区间）。 */
function cellIndexAt(profile: MapGridProfile, x: number, y: number): number {
  return profile.gridCells.findIndex((c) => x >= c.bounds.xMin && x <= c.bounds.xMax && y >= c.bounds.yMin && y <= c.bounds.yMax)
}

const NAMES = MAP_NAMES as Record<string, { zh?: string; en?: string; ru?: string }>

function displayNames(mapCode: string, fallbackEn: string): Record<string, string> {
  const n = NAMES[mapCode] ?? {}
  const en = n.en?.trim() ? n.en : fallbackEn
  return { zh: n.zh?.trim() ? n.zh : en, en, ru: n.ru?.trim() ? n.ru : en }
}

interface Pos { t: number; x: number; y: number }

function observedPositions(track: VehiclePlaybackTrack): Pos[] {
  const out: Pos[] = []
  for (const seg of track.positionSegments) {
    if (seg.knowledge !== 'OBSERVED') continue
    for (const s of seg.samples) out.push({ t: s.timeSec, x: s.x, y: s.y })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Java `PlayerResultFormat.deathSec`：非存活且结算存活时长 > 0。 */
function settlementDeathSec(result: AgentBattleResult | null | undefined, accountId: number): number | null {
  const p = result?.players.find((x) => x.account_id === accountId)
  if (!p || p.survived !== false) return null
  return typeof p.life_time_secs === 'number' && p.life_time_secs > 0 ? p.life_time_secs : null
}

/** Java `BattlePhaseSummary.buildRelativePhases` + `MapOverviewBuilder.buildPhases`。 */
function phases(dataset: BattlePlaybackDataset): MapPhase[] {
  const OPENING = 45, FIRST_CONTACT = 10, LATE_WINDOW = 15
  const end = dataset.durationSec
  if (!(end > 0)) return []
  const contact = dataset.events.find((e) => e.type === 'DAMAGE' && e.timeSec >= 0)?.timeSec ?? -1
  const validContact = contact >= 0 && contact < end
  let openingEnd = validContact && contact < OPENING ? Math.min(contact, end) : Math.min(OPENING, end)
  if (validContact) {
    const contactEnd = Math.min(contact + FIRST_CONTACT, end)
    if (contactEnd > contact) openingEnd = Math.max(openingEnd, contactEnd)
  }
  const lateStart = Math.max(openingEnd, end - LATE_WINDOW)
  const out: MapPhase[] = [{ key: 'opening', startSec: 0, endSec: openingEnd }]
  if (lateStart > openingEnd + 1e-3) out.push({ key: 'mid', startSec: openingEnd, endSec: lateStart })
  out.push({ key: 'late', startSec: lateStart, endSec: end })
  return out
}

/**
 * 投影入口。地图未收录（无语义网格）/ 视角未解析 / 无位置 → null（与服务端 204 同义，
 * BattlePlaybackPanel 的 `mapOverview = null` 分支）。
 */
export function toMapOverview(
  dataset: BattlePlaybackDataset,
  profiles: ReadonlyMap<string, MapGridProfile>,
  result?: AgentBattleResult | null,
): LocalMapOverview | null {
  const mapCode = dataset.mapCode
  const profile = mapCode ? profiles.get(mapCode) : undefined
  if (!mapCode || !profile || dataset.friendlyTeam == null) return null
  const friendlyTeam = dataset.friendlyTeam
  const cells = profile.gridCells.length
  const layer = (): MapHeatLayer => ({ dwell: new Array(cells).fill(0), damage: new Array(cells).fill(0), deaths: new Array(cells).fill(0) })
  const friendly = layer()
  const enemy = layer()
  const routes: MapRoute[] = []
  const interval = Math.max(2, dataset.durationSec / 200)

  for (const track of dataset.vehicles) {
    const positions = observedPositions(track)
    if (positions.length === 0) continue
    const side = track.team === friendlyTeam ? friendly : enemy
    for (const p of positions) {
      const i = cellIndexAt(profile, p.x, p.y)
      if (i >= 0) side.dwell[i]++
    }
    // 伤害按受击方位置落格（±3 s 内最近位置）
    for (const loss of track.damageLosses) {
      let best: Pos | null = null
      for (const p of positions) if (!best || Math.abs(p.t - loss.toSec) < Math.abs(best.t - loss.toSec)) best = p
      if (!best || Math.abs(best.t - loss.toSec) > 3) continue
      const i = cellIndexAt(profile, best.x, best.y)
      if (i >= 0) side.damage[i] += loss.hpLoss
    }
    const deathSec = settlementDeathSec(result, track.accountId)
    if (deathSec !== null) {
      const before = positions.filter((p) => p.t <= deathSec)
      const at = before[before.length - 1]
      const i = at ? cellIndexAt(profile, at.x, at.y) : -1
      if (i >= 0) side.deaths[i]++
    }
    const points: MapRoutePoint[] = []
    let next = positions[0].t
    for (const p of positions) {
      if (p.t >= next - 1e-6) {
        points.push({ x: p.x, y: p.y, timeSec: p.t })
        next = p.t + interval
      }
    }
    const last = positions[positions.length - 1]
    if (points[points.length - 1].timeSec < last.t - 1e-6) points.push({ x: last.x, y: last.y, timeSec: last.t })
    routes.push({
      accountId: track.accountId,
      playerName: track.playerName,
      tankId: track.tankId,
      team: track.team,
      points,
      firstObservedSec: positions[0].t,
      lastObservedSec: last.t,
      deathSec,
    })
  }
  if (routes.length === 0) return null

  return {
    mapCode,
    displayName: profile.displayName,
    displayNames: displayNames(mapCode, profile.displayName),
    friendlyTeam,
    playableBounds: { ...profile.playableBounds },
    gridCells: profile.gridCells.map((c) => ({ ...c, bounds: { ...c.bounds } })),
    image: null,
    spawnPoints: profile.spawnPoints.map((s) => ({ ...s })),
    phases: phases(dataset),
    heatmaps: { friendly, enemy },
    routes,
    arenaBonusType: dataset.arenaBonusType ?? null,
    recorderAccountId: dataset.recorderAccountId ?? null,
  }
}
