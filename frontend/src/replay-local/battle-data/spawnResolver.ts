import type { AgentAuthorInitialPosition } from '../../api/agent-replay-facets.js'
import type { components } from '../../api/generated/http-contract.js'
import { indexMapGridProfiles, type MapGridProfile } from '../playback/toMapOverview.js'

type Side = components['schemas']['BattleDataSpawn']
const opposite: Record<Side, Side> = { NORTH: 'SOUTH', SOUTH: 'NORTH', WEST: 'EAST', EAST: 'WEST' }
let profiles: Map<string, MapGridProfile> | undefined

/** 保守接收策略：早期观测且仅命中一个 exact scene 出生侧；未知整场丢弃。 */
export function resolvePhysicalSpawns(
  mapKey: string, authorTeam: number, probe: AgentAuthorInitialPosition | null,
  mapProfiles?: ReadonlyMap<string, MapGridProfile>,
): { team1: Side; team2: Side } | null {
  if (!probe || (authorTeam !== 1 && authorTeam !== 2)
    || !Number.isFinite(probe.clock) || probe.clock < 0 || probe.clock > 1
    || probe.position.length !== 3 || !probe.position.every(Number.isFinite)) return null
  if (!mapProfiles) {
    profiles ??= indexMapGridProfiles(Object.values(import.meta.glob('../../../../common/map-semantics/*.semantic.json', {
      eager: true, import: 'default',
    })))
    mapProfiles = profiles
  }
  const groups = mapProfiles.get(mapKey)?.physicalSpawns
  if (!groups || groups.length !== 2 || opposite[groups[0].side] !== groups[1].side) return null
  // 与既有 playback 投影一致：replay x/z 对应 semantic x/y。
  const [x, , y] = probe.position
  const hits = groups.filter((g) => g.points.some((p) => Math.hypot(p.x - x, p.y - y) <= 2))
  if (hits.length !== 1) return null
  const authorSide = hits[0].side
  return authorTeam === 1
    ? { team1: authorSide, team2: opposite[authorSide] }
    : { team1: opposite[authorSide], team2: authorSide }
}
