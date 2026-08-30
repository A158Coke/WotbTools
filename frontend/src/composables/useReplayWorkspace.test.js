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

function makeFiles(n) {
  return Array.from({ length: n }, (_, i) => new File(['x'], `f${i}.wotbreplay`))
}

describe('useReplayWorkspace', () => {
  beforeEach(() => {
    holder.state = newReplay()
  })

  it('暴露权威字段（replayBatch / parsedBattles / currentBattleId / dataViewMode / activeWorkspaceTab）', async () => {
    const ws = useReplayWorkspace('data')
    expect(ws.replay).toBe(holder.state)
    expect(ws.replayBatch.value).toBe(holder.state.files.value)
    expect(ws.parsedBattles.value).toEqual([])
    expect(ws.currentBattleId.value).toBe(null)
    expect(ws.dataViewMode.value).toBe('SUMMARY')
    expect(ws.activeWorkspaceTab.value).toBe('data')
  })

  it('单文件未解析时 currentTargetBattleId 回退 r0；多文件未选则 null', async () => {
    holder.state.files.value = makeFiles(1)
    const ws = useReplayWorkspace('data')
    // 单文件尚未解析出 battle → 回退 r0（唯一文件天然可分析）。
    expect(ws.currentTargetBattleId.value).toBe('r0')
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[0])

    // 多文件未显式选择 → null（需显式选 target）。
    holder.state.files.value = makeFiles(2)
    expect(ws.currentTargetBattleId.value).toBe(null)
    expect(ws.currentTargetFile.value).toBe(null)
  })

  it('selectBattle 设 currentBattleId + dataViewMode=SINGLE；selectSummary 保留选中单场只切视图', async () => {
    holder.state.files.value = makeFiles(2)
    const ws = useReplayWorkspace('data')
    ws.selectBattle('r1')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r1')
    expect(ws.dataViewMode.value).toBe('SINGLE')
    expect(holder.state.activeTab.value).toBe('b1')

    // SUMMARY 视图：currentBattleId 仍为 r1（选中单场持久）。
    ws.selectSummary()
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r1')
    expect(ws.dataViewMode.value).toBe('SUMMARY')
    expect(holder.state.activeTab.value).toBe('aggregate')
  })

  it('READY 后按 chooseInitialResultTab 初始化 currentBattleId 与 dataViewMode', async () => {
    holder.state.resp.value = { leagueMode: false, aggregate: [], battles: [{ mapName: 'x' }] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    // 无 aggregate 但有 battle → chooseInitialResultTab 返回 b0 → currentBattleId=r0, SINGLE。
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.dataViewMode.value).toBe('SINGLE')

    // 有 aggregate → chooseInitialResultTab 返回 aggregate → SUMMARY + currentBattleId=r0。
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [{ mapName: 'x' }] }
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.dataViewMode.value).toBe('SUMMARY')

    // 无 battle 但有 aggregate → currentBattleId=null，SUMMARY。
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [] }
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
    expect(ws.dataViewMode.value).toBe('SUMMARY')
  })

  it('selectionRevision 变化后重算 currentBattleId=null 并回 SUMMARY', async () => {
    holder.state.files.value = makeFiles(1)
    const ws = useReplayWorkspace('data')
    ws.selectBattle('r0')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    holder.state.selectionRevision.value++
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
    expect(ws.dataViewMode.value).toBe('SUMMARY')
  })

  it('回归：选 #8 → SUMMARY → AI/Playback 仍消费 #8（选中单场不随视图切换丢失）', async () => {
    holder.state.files.value = makeFiles(9)
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: makeFiles(9) }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')

    // 选 #8（index 7）
    ws.selectBattle('r7')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r7')
    // 切到 SUMMARY 视图
    ws.selectSummary()
    await nextTick()
    expect(ws.dataViewMode.value).toBe('SUMMARY')
    // AI / Playback 消费的 target 仍为 #8
    expect(ws.currentTargetBattleId.value).toBe('r7')
    expect(ws.currentSourceId.value).toBe('r7')
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[7])
  })

  it('setDataViewMode(SUMMARY) 保留选中单场；setDataViewMode(SINGLE) 无选中时回退第一场', async () => {
    holder.state.files.value = makeFiles(3)
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: makeFiles(3) }
    const ws = useReplayWorkspace('data')
    await nextTick()
    ws.setDataViewMode('SUMMARY')
    expect(ws.dataViewMode.value).toBe('SUMMARY')
    ws.selectBattle('r2')
    ws.setDataViewMode('SUMMARY')
    expect(ws.currentBattleId.value).toBe('r2')

    ws.setDataViewMode('SUMMARY')
    ws.setDataViewMode('SINGLE')
    expect(ws.dataViewMode.value).toBe('SINGLE')
    expect(ws.currentBattleId.value).toBe('r2')
  })
})
