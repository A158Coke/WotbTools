import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useReplaySession } from './useReplaySession.js'
import { sourceId, type ReplayResult } from '../types/replay.js'

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
  it.each([['r0', 'r1'], ['r1', 'r2'], ['r0', 'r2']])('maps sparse IDs %s/%s to original Files', async (first, second) => {
    const session = useReplaySession()
    const files = [0, 1, 2].map(i => new File([String(i)], `${i}.wotbreplay`))
    session.replaceSelection(files)
    session.commitReadyResult({ ...result, battles: [first, second].map(id => ({ ...result.battles[0]!, sourceId: sourceId(id) })) })
    await nextTick()
    for (const id of [first, second]) {
      session.selectBattle(id)
      expect(session.currentTargetFile.value).toBe(files[Number(id.slice(1))])
    }
  })
  it('keeps the single replay projection on the shared source identity', async () => {
    const session = useReplaySession()
    session.files.value = [new File(['replay'], 'sample.wotbreplay')]
    session.commitReadyResult(result)
    await nextTick()

    expect(session.singleReplay.value).toBe(true)
    expect(session.currentBattleId.value).toBe('r0')
    expect(session.currentTargetBattleId.value).toBe('r0')
    expect(session.currentTargetFile.value?.name).toBe('sample.wotbreplay')
    expect(session.activeTab.value).toBe('b0')
  })
})
