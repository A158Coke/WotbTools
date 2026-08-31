import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useReplaySession } from './useReplaySession.js'
import { processingJobId, sourceId, type ReplayResult } from '../types/replay.js'

const result: ReplayResult = {
  battles: [{
    arenaId: null,
    mapName: 'Lagoon',
    version: null,
    durationS: null,
    startTime: null,
    winnerTeam: null,
    sourceId: sourceId('r0'),
    sourceName: 'sample.wotbreplay',
    players: [],
    league: null,
  }],
  aggregate: [],
  duplicates: [],
  failures: [],
  playerColumns: [],
  aggregateColumns: [],
  league: null,
  leagueUnavailableCode: null,
  leagueMode: false,
}

describe('typed ReplaySession contract', () => {
  it('keeps the single replay projection on the shared source identity', async () => {
    const session = useReplaySession()
    session.files.value = [new File(['replay'], 'sample.wotbreplay')]
    session.commitReadyResult(result, processingJobId('p1'))
    await nextTick()

    expect(session.singleReplay.value).toBe(true)
    expect(session.currentBattleId.value).toBe('r0')
    expect(session.currentTargetBattleId.value).toBe('r0')
    expect(session.currentTargetFile.value?.name).toBe('sample.wotbreplay')
    expect(session.processingJobId.value).toBe('p1')
  })
})
