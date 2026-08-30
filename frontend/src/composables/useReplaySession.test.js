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
  it('owns selection, processing/result identity and workspace view state', () => {
    const session = useReplaySession('playback')

    expect(session.activeWorkspaceTab.value).toBe('playback')
    expect(session.files.value).toEqual([])
    expect(session.selectionRevision.value).toBe(0)
    expect(session.processingJobId.value).toBeNull()
    expect(session.currentBattleId.value).toBeNull()
    expect(session.dataViewMode.value).toBe('SUMMARY')
  })

  it('replaceSelection atomically invalidates dataset/result and resets selected battle', async () => {
    const session = useReplaySession()
    session.files.value = [file('a.wotbreplay')]
    session.processingJob.value = { jobId: 'p1', status: 'READY' }
    session.processingJobId.value = 'p1'
    session.resp.value = { battles: [battle('r0')], aggregate: [] }
    session.currentBattleId.value = 'r0'
    session.dataViewMode.value = 'SINGLE'
    session.exportJob.value = { jobId: 'e1', status: 'PROCESSING' }

    session.replaceSelection([file('b.wotbreplay')])
    await nextTick()

    expect(session.files.value[0].name).toBe('b.wotbreplay')
    expect(session.selectionRevision.value).toBe(1)
    expect(session.processingJob.value).toBeNull()
    expect(session.processingJobId.value).toBeNull()
    expect(session.resp.value).toBeNull()
    expect(session.currentBattleId.value).toBeNull()
    expect(session.dataViewMode.value).toBe('SUMMARY')
    expect(session.exportJob.value).toEqual({ jobId: 'e1', status: 'PROCESSING' })
  })

  it('derives battle identity by sourceId rather than parsed array index', async () => {
    const session = useReplaySession()
    session.files.value = [file('a.wotbreplay'), file('b.wotbreplay'), file('c.wotbreplay')]
    session.commitReadyResult({ battles: [battle('r1'), battle('r2')], aggregate: [] }, 'p1')
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
    session.commitReadyResult({ battles: [battle('r1'), battle('r2')], aggregate: [{ id: 1 }] }, 'p1')
    await nextTick()

    session.selectBattle('r2')
    session.setDataViewMode('SUMMARY')
    expect(session.currentBattleId.value).toBe('r1')
    expect(session.dataViewMode.value).toBe('SUMMARY')
  })
})
