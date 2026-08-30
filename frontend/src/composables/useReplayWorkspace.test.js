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

/** BattleDto 投影：sourceId = r<sourceIndex>（唯一权威 identity）。 */
function battle(sourceId, mapName = 'Lagoon') {
  return { sourceId, mapName, players: [] }
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
    expect(ws.currentTargetBattleId.value).toBe('r0')
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[0])

    holder.state.files.value = makeFiles(2)
    expect(ws.currentTargetBattleId.value).toBe(null)
    expect(ws.currentTargetFile.value).toBe(null)
  })

  it('selectBattle 设 currentBattleId + dataViewMode=SINGLE；setDataViewMode(SUMMARY) 归一到第一场（plan §5）', async () => {
    holder.state.files.value = makeFiles(2)
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [battle('r0'), battle('r1')] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    ws.selectBattle('r1')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r1')
    expect(ws.currentBattleIndex.value).toBe(1)
    expect(ws.dataViewMode.value).toBe('SINGLE')

    ws.setDataViewMode('SUMMARY')
    await nextTick()
    // plan §5：SUMMARY 把 Workspace 当前回放归一第一场有效 battle。
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.dataViewMode.value).toBe('SUMMARY')
    expect(ws.currentTargetBattleId.value).toBe('r0')
  })

  it('READY 初始化用 resp.battles[0].sourceId（禁止硬编码 r0）', async () => {
    // r0 缺失（failed/duplicate 移除），有效 battle 从 r3 开始。
    holder.state.resp.value = { leagueMode: false, aggregate: [], battles: [battle('r3')] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r3')
    expect(ws.currentBattleIndex.value).toBe(0)
    expect(ws.currentBattle.value?.sourceId).toBe('r3')
    expect(ws.dataViewMode.value).toBe('SINGLE')
  })

  it('plan §7：单 replay（即使 aggregate 有数据）默认 dataViewMode=SINGLE，直接单场结果', async () => {
    holder.state.files.value = makeFiles(1)
    // 单独上传一场：后端仍产出 aggregate（14 名选手），但默认必须是单场视图。
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [battle('r0')] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.dataViewMode.value).toBe('SINGLE')
    expect(ws.currentBattleIndex.value).toBe(0)
  })

  it('plan §7：多场默认 SUMMARY + 第一场；无有效 battle 回 SUMMARY + null', async () => {
    holder.state.files.value = makeFiles(3)
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [battle('r0'), battle('r1'), battle('r2')] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.dataViewMode.value).toBe('SUMMARY')

    holder.state.resp.value = { leagueMode: false, aggregate: [], battles: [] }
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
    expect(ws.dataViewMode.value).toBe('SUMMARY')
  })

  it('边界：r0 failed、r1/r2 valid → 初始必须选 r1（sourceId 是唯一 identity）', async () => {
    holder.state.files.value = makeFiles(3)
    holder.state.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [battle('r1'), battle('r2')], // r0 failed，不在 resp.battles
    }
    const ws = useReplayWorkspace('data')
    await nextTick()
    // 第一场有效 battle = r1（不是 r0）。
    expect(ws.currentBattleId.value).toBe('r1')
    expect(ws.currentBattle.value?.sourceId).toBe('r1')
    expect(ws.currentBattleIndex.value).toBe(0)
    // sourceId r1 → files[1]（source index），不是数组下标 0。
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[1])
  })

  it('边界：r1 duplicate、valid=r0/r2 → 选第二个有效 battle 得 sourceId r2、files[2]、parsedBattles index 1', async () => {
    holder.state.files.value = makeFiles(3)
    holder.state.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [battle('r0'), battle('r2')], // r1 duplicate 移除
    }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.currentBattleIndex.value).toBe(0)

    ws.selectBattle('r2')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r2')
    // parsedBattles = [r0, r2] → r2 在数组 index 1；但 source index = 2 → files[2]。
    expect(ws.currentBattleIndex.value).toBe(1)
    expect(ws.currentBattle.value?.sourceId).toBe('r2')
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[2])
  })

  it('回归：选 #8 → SUMMARY → Workspace 归一到 #1，AI/Playback 消费 #1（plan §5）', async () => {
    holder.state.files.value = makeFiles(9)
    holder.state.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: Array.from({ length: 9 }, (_, i) => battle(`r${i}`)),
    }
    const ws = useReplayWorkspace('data')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')

    ws.selectBattle('r7')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r7')
    expect(ws.currentBattleIndex.value).toBe(7)
    ws.setDataViewMode('SUMMARY')
    await nextTick()
    expect(ws.dataViewMode.value).toBe('SUMMARY')
    // plan §5：SUMMARY 归一 first valid battle（r0）。
    expect(ws.currentBattleId.value).toBe('r0')
    expect(ws.currentTargetBattleId.value).toBe('r0')
    expect(ws.currentSourceId.value).toBe('r0')
    expect(ws.currentTargetFile.value).toBe(holder.state.files.value[0])
  })

  it('selectionRevision 变化后重算 currentBattleId=null 并回 SUMMARY', async () => {
    holder.state.files.value = makeFiles(1)
    holder.state.resp.value = { leagueMode: false, aggregate: [{ a: 1 }], battles: [battle('r0')] }
    const ws = useReplayWorkspace('data')
    await nextTick()
    ws.selectBattle('r0')
    await nextTick()
    expect(ws.currentBattleId.value).toBe('r0')
    holder.state.selectionRevision.value++
    await nextTick()
    expect(ws.currentBattleId.value).toBe(null)
    expect(ws.dataViewMode.value).toBe('SUMMARY')
  })

  it('setDataViewMode(SUMMARY) 归一到第一场；setDataViewMode(SINGLE) 无选中时回退第一场 sourceId', async () => {
    holder.state.files.value = makeFiles(3)
    holder.state.resp.value = {
      leagueMode: false,
      aggregate: [{ a: 1 }],
      battles: [battle('r0'), battle('r2')], // r1 duplicate 移除
    }
    const ws = useReplayWorkspace('data')
    await nextTick()
    ws.selectBattle('r2')
    ws.setDataViewMode('SUMMARY')
    // plan §5：SUMMARY 归一 first valid battle（r0）。
    expect(ws.currentBattleId.value).toBe('r0')
    // 无选中时 SINGLE 回退第一场有效 battle 的 sourceId（r0）。
    ws.currentBattleId.value = null
    ws.setDataViewMode('SINGLE')
    expect(ws.currentBattleId.value).toBe('r0')
  })
})
