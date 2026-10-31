import { describe, expect, it } from 'vitest'
import { nextTick, watch } from 'vue'
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
    session.files.value = [file('a.wotbreplay'), file('b.wotbreplay'), file('c.wotbreplay')]
    session.commitReadyResult({ battles: [battle('r1'), battle('r2')], aggregate: [{ id: 1 }] })
    await nextTick()

    session.selectBattle('r2')
    session.setDataViewMode('SUMMARY')
    expect(session.currentBattleId.value).toBe('r2')
    expect(session.dataViewMode.value).toBe('SUMMARY')
  })

  describe('changeSelection', () => {
    async function ready(names, selected) {
      const session = useReplaySession()
      const files = names.map(file)
      session.files.value = files
      session.commitReadyResult({ battles: files.map((_, i) => battle(`r${i}`)), aggregate: [{ id: 1 }] })
      await nextTick()
      session.selectBattle(selected)
      await nextTick()
      const targets = []
      watch(session.currentTargetFile, value => targets.push(value), { flush: 'sync' })
      return { session, files, targets }
    }

    it('adding files keeps the result and the current File', async () => {
      const { session, files, targets } = await ready(['a', 'b'], 'r1')
      const result = session.resp.value
      session.changeSelection([...files, file('c')])
      expect(session.currentTargetFile.value).toBe(files[1])
      expect(session.resp.value).toBe(result)
      expect(session.selectionRevision.value).toBe(1)
      expect(targets).toEqual([])
    })

    it('removing another file only moves the derived sourceId; sync observers see no transition', async () => {
      const { session, files, targets } = await ready(['a', 'b', 'c'], 'r2')
      session.changeSelection([files[1], files[2]])
      expect(session.currentBattleId.value).toBe('r1')
      expect(session.currentTargetFile.value).toBe(files[2])
      expect(targets).toEqual([])
    })

    it('removing the current file lands on the next battle, in one transition', async () => {
      const { session, files, targets } = await ready(['a', 'b', 'c'], 'r1')
      session.changeSelection([files[0], files[2]])
      expect(session.currentTargetFile.value).toBe(files[2])
      expect(targets).toEqual([files[2]])
    })

    it('removing the last battle falls back to the previous one', async () => {
      const { session, files } = await ready(['a', 'b', 'c'], 'r2')
      session.changeSelection([files[0], files[1]])
      expect(session.currentTargetFile.value).toBe(files[1])
    })

    it('a new result keeps the current battle and data view; a lost battle falls back to the first', async () => {
      const { session, files } = await ready(['a', 'b'], 'r1')
      const c = file('c')
      session.changeSelection([...files, c])
      session.commitReadyResult({ battles: [battle('r0'), battle('r1'), battle('r2')], aggregate: [{ id: 1 }] })
      await nextTick()
      expect(session.currentTargetFile.value).toBe(files[1])
      expect(session.dataViewMode.value).toBe('SINGLE')

      session.commitReadyResult({ battles: [battle('r0'), battle('r2')], aggregate: [{ id: 1 }] })
      await nextTick()
      expect(session.currentTargetFile.value).toBe(files[0])
      expect(session.dataViewMode.value).toBe('SUMMARY')
    })

    it('revokes the official demo identity', async () => {
      const { session, files } = await ready(['a', 'b'], 'r0')
      session.changeSelection(files.slice(0, 1))
      expect(session.isDemoSelection.value).toBe(false)
    })
  })
})
