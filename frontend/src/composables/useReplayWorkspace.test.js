import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useReplayWorkspace } from './useReplayWorkspace.js'

const holder = vi.hoisted(() => ({ state: null }))

vi.mock('./useReplay.js', () => ({
  useReplay: () => holder.state,
  chooseInitialResultTab: (result) => {
    if (result?.leagueMode === true) return 'aggregate'
    if (Array.isArray(result?.aggregate) && result.aggregate.length > 0) return 'aggregate'
    if (Array.isArray(result?.battles) && result.battles.length > 0) return 'b0'
    return 'aggregate'
  },
}))

function newReplay() {
  return {
    files: ref([]),
    resp: ref(null),
    activeTab: ref('aggregate'),
    selectionRevision: ref(0),
    processingJobId: ref(null),
    playerCols: ref([]),
    aggCols: ref([]),
    loading: ref(false),
    error: ref(''),
    updateFiles: vi.fn(),
    startProcessingJob: vi.fn(),
  }
}

describe('useReplayWorkspace', () => {
  beforeEach(() => {
    holder.state = newReplay()
  })

  it('暴露权威字段（replayBatch / parsedBattles / currentBattleId / activeWorkspaceTab）', async () => {
    const ws = useReplayWorkspace('data')
    expect(ws.replay).toBe(holder.state)
    expect(ws.replayBatch.value).toBe(holder.state.files.value)
    expect(ws.parsedBattles.value).toEqual([])
    expect(ws.currentBattleId.value).toBe(null)
    expect(ws.activeWorkspaceTab.value).toBe('data')
  })

  it('单文件回退 currentTargetBattleId=r0（多文件 summary 为 null）', async () => {
    holder.state.files.value = [new File(['x'], 'a.wotbreplay')]
    const ws = useReplayWorkspace('data')
    expect(ws.currentTargetBattleId.value).toBe('r0')
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[0])

    holder.state.files.value = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]
    expect(ws.currentTargetBattleId.value).toBe(null)
    expect(ws.currentTargetFile.value).toBe(null)
  })

  it('selectBattle 设 currentBattleId 并同步 activeTab；selectSummary 回 summary', async () => {
    holder.state.files.value = [new File(['x'], 'a.wotbreplay'), new File(['y'], 'b.wotbreplay')]
    const ws = useReplayWorkspace('data')
    ws.selectBattle('r1')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r1')
    expect(holder.state.activeTab.value).toBe('b1')

    ws.selectSummary()
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
    expect(holder.state.activeTab.value).toBe('aggregate')
  })

  it('READY 后按 chooseInitialResultTab 初始化 currentBattleId', async () => {
    holder.state.resp.value = { leagueMode: false, aggregate: [], battles: [{ mapName: 'x' }] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')

    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [] }
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
  })

  it('selectionRevision 变化后重算为 null', async () => {
    holder.state.files.value = [new File(['x'], 'a.wotbreplay')]
    const ws = useReplayWorkspace('data')
    ws.selectBattle('r0')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    holder.state.selectionRevision.value++
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
  })
})
