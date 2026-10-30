import { parseMapGridProfile } from '../replay-local/playback/toMapOverview.js'
import { reviewedPhysicalSpawns } from '../replay-local/battle-data/spawnResolver.js'
import type { Summary } from '../api/admin-battle-data.js'

type RawSemantic = { mapId?: unknown; mapCodes?: unknown }
/** Parsed once from the same canonical files and reviewed criterion as the Collector. */
const canonical = (Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', { eager: true, import: 'default' })) as RawSemantic[])
  .map(raw => {
    const mapId = typeof raw.mapId === 'string' ? raw.mapId : ''
    const mapCodes = (Array.isArray(raw.mapCodes) ? raw.mapCodes : []).filter((key): key is string => typeof key === 'string')
    return { mapId, mapCodes, reviewed: reviewedPhysicalSpawns(parseMapGridProfile(raw)) !== null }
  })
const unresolved = canonical.filter(row => !row.reviewed).map(row => row.mapId).filter(Boolean)

/** Joins canonical reviewed maps with observed counts; reviewed maps without rows stay visible at zero. */
export function mapCoverage(maps: Summary['maps']) {
  const observed = new Map(maps.map(row => [row.key, row]))
  const claimed = new Set<string>()
  const reviewed: { key: string; count: number; latest: string | null }[] = []
  for (const row of canonical) {
    if (!row.reviewed) continue
    const keys = [row.mapId, ...row.mapCodes].map(key => key.trim().toLowerCase()).filter(Boolean)
    const matched = keys.flatMap(key => {
      const observation = observed.get(key)
      if (!observation) return []
      claimed.add(key)
      return [observation]
    })
    reviewed.push({
      key: row.mapCodes[0] || row.mapId,
      count: matched.reduce((total, item) => total + item.count, 0),
      latest: matched.map(item => item.latestReceivedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null,
    })
  }
  // Observed maps first; reviewed maps with zero observations remain visible at the end.
  reviewed.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  return { reviewed, unresolved, other: maps.filter(row => !claimed.has(row.key)) }
}
