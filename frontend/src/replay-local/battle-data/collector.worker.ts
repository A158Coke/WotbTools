/// <reference lib="webworker" />
import { parseAgentAuthorInitialPositionFromBytes } from '../../api/agent-replay-facets.js'
import { postBattleData } from '../../api/battle-data.js'
import { resolvePhysicalSpawns } from './spawnResolver.js'
import type { CollectorDone, CollectorTask } from './collectorWorkerProtocol.js'

const online = () => navigator.onLine !== false

self.onmessage = async (event: MessageEvent<CollectorTask>) => {
  const { id, blob, seed } = event.data
  try {
    if (!online()) return
    const probe = await parseAgentAuthorInitialPositionFromBytes(new Uint8Array(await blob.arrayBuffer()))
    const sides = resolvePhysicalSpawns(seed.mapKey, seed.authorTeam, probe)
    if (!sides || !online()) return
    const { authorTeam: _, teams, ...battle } = seed
    await postBattleData({ ...battle, teams: teams.map(team => ({
      ...team, spawn: team.team === 1 ? sides.team1 : sides.team2,
    })) })
  } catch { /* 此任务可以丢失；禁止让拒绝逃逸为 unhandledrejection。 */ }
  finally {
    const done: CollectorDone = { id }
    self.postMessage(done)
  }
}
