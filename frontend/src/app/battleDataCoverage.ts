import { parseMapGridProfile } from '../replay-local/playback/toMapOverview.js'
import { reviewedPhysicalSpawns } from '../replay-local/battle-data/spawnResolver.js'
import type { SpawnStats, Summary } from '../api/admin-battle-data.js'

type RawSemantic = { mapId?: unknown; mapCodes?: unknown }
type SpawnStat = SpawnStats['items'][number]
type Side = SpawnStat['side']
export type SpawnMode = 'ALL' | 'RANDOM' | 'RATING'

const MODE_BONUS: Record<SpawnMode, SpawnStat['arenaBonusType']> = { ALL: null, RANDOM: 1, RATING: 7 }
const SPAWN_AXES: [Side, Side][] = [['NORTH', 'SOUTH'], ['WEST', 'EAST']]
const SIDE_KEYS: Record<Side, string> = { NORTH: 'top', SOUTH: 'bottom', WEST: 'west', EAST: 'east' }

/** Presentation key only: DB, API and Collector keep NORTH/SOUTH/WEST/EAST. */
export const spawnSideKey = (side: Side) => SIDE_KEYS[side]

/** Parsed once from the same canonical files and reviewed criterion as the Collector. */
const canonical = (Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', { eager: true, import: 'default' })) as RawSemantic[])
  .map(raw => {
    const mapId = typeof raw.mapId === 'string' ? raw.mapId : ''
    const mapCodes = (Array.isArray(raw.mapCodes) ? raw.mapCodes : []).filter((key): key is string => typeof key === 'string')
    return { mapId, mapCodes, sides: reviewedPhysicalSpawns(parseMapGridProfile(raw))?.map(group => group.side) ?? null }
  })

/** Joins Collector-addressable reviewed maps with observed counts; reviewed maps without rows stay visible at zero. */
export function mapCoverage(maps: Summary['maps']) {
  const observed = new Map(maps.map(row => [row.key, row]))
  const claimed = new Set<string>()
  const reviewed: { key: string; keys: string[]; sides: Side[]; count: number; latest: string | null }[] = []
  for (const row of canonical) {
    // Replay map_key only matches mapCodes; semantic-only files are never collected.
    if (!row.sides || row.mapCodes.length === 0) continue
    const keys = [row.mapId, ...row.mapCodes].map(key => key.trim().toLowerCase()).filter(Boolean)
    const matched = keys.flatMap(key => {
      const observation = observed.get(key)
      if (!observation) return []
      claimed.add(key)
      return [observation]
    })
    reviewed.push({
      key: row.mapCodes[0],
      keys,
      sides: row.sides,
      count: matched.reduce((total, item) => total + item.count, 0),
      latest: matched.map(item => item.latestReceivedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null,
    })
  }
  // Observed maps first; reviewed maps with zero observations remain visible at the end.
  reviewed.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  return { reviewed, other: maps.filter(row => !claimed.has(row.key)) }
}

/** One table per spawn axis for the selected mode. Counts stay facts; rates are derived at display time. */
export function spawnTables(coverage: ReturnType<typeof mapCoverage>, { items: stats }: SpawnStats, mode: SpawnMode) {
  const maps = [
    ...coverage.reviewed.map(row => ({ key: row.key, keys: row.keys, sides: row.sides, latest: row.latest, observedOnly: false })),
    ...coverage.other.map(row => ({ key: row.key, keys: [row.key], sides: [] as Side[], latest: row.latestReceivedAt as string | null, observedOnly: true })),
  ]
  return SPAWN_AXES.map(axis => ({
    axis,
    rows: maps.flatMap(map => {
      const own = stats.filter(row => map.keys.includes(row.mapKey))
      // An axis comes from canonical semantics or stored rows, so stored observations can never disappear.
      if (!axis.some(side => map.sides.includes(side) || own.some(row => row.side === side))) return []
      const sides = axis.map(side => {
        const rows = own.filter(row => row.side === side && row.arenaBonusType === MODE_BONUS[mode])
        const sum = (field: 'battles' | 'wins' | 'draws' | 'losses') => rows.reduce((total, row) => total + row[field], 0)
        return { side, battles: sum('battles'), wins: sum('wins'), draws: sum('draws'), losses: sum('losses') }
      })
      return [{ key: map.key, latest: map.latest, observedOnly: map.observedOnly, battles: Math.max(...sides.map(side => side.battles)), draws: sides[0].draws, sides }]
    }),
  })).filter(table => table.rows.length > 0)
}
