import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useReplaySession } from './useReplaySession.js'

function file(name) {
  return new File(['replay'], name)
}

function battle(sourceId) {
  return { sourceId, mapName: 'Lagoon', players: [] }
}

describe('useReplaySession', () => {
  it('analysisActive is true only while parsing', () => {
    const session = useReplaySession()
    session.analysis.value = { phase: 'parsing', done: 0, total: 2, failure: null }
    expect(session.analysisActive.value).toBe(true)
    session.analysis.value = { phase: 'failed', done: 1, total: 2, failure: 'UNKNOWN' }
    expect(session.analysisActive.value).toBe(false)
  })


  it('owns selection, local analysis state and workspace view state', () => {
    const session = useReplaySession('playback')

    expect(session.activeWorkspaceTab.value).toBe('playback')
    expect(session.files.value).toEqual([])
    expect(session.selectionRevision.value).toBe(0)
    expect(session.analysis.value).toEqual({ phase: 'idle', done: 0, total: 0, failure: null })
    expect(session.analysisActive.value).toBe(false)
    expect(session.currentBattleId.value).toBeNull()
    expect(session.dataViewMode.value).toBe('SUMMARY')
  })

  it('replaceSelection atomically invalidates analysis/result and resets selected battle', async () => {
    const session = useReplaySession()
    session.files.value = [file('a.wotbreplay')]
    session.analysis.value = { phase: 'ready', done: 1, total: 1, failure: null }
    session.resp.value = { battles: [battle('r0')], aggregate: [] }
    session.currentBattleId.value = 'r0'
    session.dataViewMode.value = 'SINGLE'

    session.replaceSelection([file('b.wotbreplay')])
    await nextTick()

    expect(session.files.value[0].name).toBe('b.wotbreplay')
    expect(session.selectionRevision.value).toBe(1)
    expect(session.analysis.value).toEqual({ phase: 'idle', done: 0, total: 0, failure: null })
    expect(session.resp.value).toBeNull()
    expect(session.currentBattleId.value).toBeNull()
    expect(session.dataViewMode.value).toBe('SUMMARY')
  })

  it('derives battle identity by sourceId rather than parsed array index', async () => {
    const session = useReplaySession()
    session.files.value = [file('a.wotbreplay'), file('b.wotbreplay'), file('c.wotbreplay')]
    session.commitReadyResult({ battles: [battle('r1'), battle('r2')], aggregate: [] })
    await nextTick()

    expect(session.currentBattleId.value).toBe('r1')
    expect(session.currentBattleIndex.value).toBe(0)
    expect(session.currentTargetFile.value).toBe(session.files.value[1])

    session.selectBattle('r2')
    expect(session.currentBattleId.value).toBe('r2')
    expect(session.currentBattleIndex.value).toBe(1)
    expect(session.currentTargetFile.value).toBe(session.files.value[2])
  })

  it('normalizes data view without inventing a second selected battle state', async () => {
    const session = useReplaySession()
    session.files.value = [file('a.wotbreplay'), file('b.wotbreplay')]
    session.commitReadyResult({ battles: [battle('r1'), battle('r2')], aggregate: [{ id: 1 }] })
    await nextTick()

    session.selectBattle('r2')
    session.setDataViewMode('SUMMARY')
    expect(session.currentBattleId.value).toBe('r1')
    expect(session.dataViewMode.value).toBe('SUMMARY')
  })
})
