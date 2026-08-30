import { computed, ref, watch } from 'vue'
import { useReplay, chooseInitialResultTab } from './useReplay.js'

/**
 * Replay Workspace 公共状态（单一 owner）。
 *
 * 权威字段（plan: 目标状态模型，Blocker #1）：
 * - replayBatch        = useReplay.files
 * - parsedBattles[]    = useReplay.resp.battles
 * - currentBattleId    = 'r<i>' | null；恒代表「当前单场」，仅在无可用 battle 时为 null，
 *                        不能用 null 表示 summary 视图。
 * - dataViewMode       = 'SUMMARY' | 'SINGLE'；数据页视图轴（汇总视图 / 单场视图），
 *                        与选中单场解耦：SUMMARY 视图下 selected battle 依然持久。
 * - activeWorkspaceTab = 'data' | 'ai' | 'playback'
 *
 * 派生（不新增状态字段）：
 * - currentBattle / currentBattleIndex
 * - currentTargetBattleId / currentTargetFile / currentSourceId：喂 AiReviewPanel / BattlePlaybackPanel。
 *   「选 #8 → 汇总 → AI/Playback」始终消费 #8：currentTargetBattleId 显式 currentBattleId 优先，
 *   有 battle 时恒非 null（不随视图切换丢失）；单文件尚未解析出 battle 时回退 'r0'。
 *
 * replay.activeTab 仅作为旧渲染兼容层，由 dataViewMode + currentBattleId 单向派生：
 *   SUMMARY -> 'aggregate'，SINGLE -> 'b<index>'。不再双向写回，避免把「选中单场」用 null 挤掉。
 */
export function useReplayWorkspace(initialCapability = 'data') {
  const replay = useReplay()

  const activeWorkspaceTab = ref(initialCapability === 'playback' || initialCapability === 'ai'
    ? initialCapability
    : 'data')
  /** 'r<i>' | null；null = 无可用 battle。恒代表当前单场。 */
  const currentBattleId = ref(null)
  /** 'SUMMARY' | 'SINGLE'；数据页视图轴。 */
  const dataViewMode = ref('SUMMARY')

  const replayBatch = computed(() => replay.files.value)
  const parsedBattles = computed(() => replay.resp.value?.battles || [])
  const singleReplay = computed(() => replay.files.value.length === 1)

  const currentBattleIndex = computed(() => {
    const id = currentBattleId.value
    if (!id) return -1
    const m = /^r(\d+)$/.exec(id)
    return m ? parseInt(m[1], 10) : -1
  })
  const currentBattle = computed(() => {
    const idx = currentBattleIndex.value
    return idx >= 0 ? (parsedBattles.value[idx] ?? null) : null
  })
  /**
   * 跨能力目标 battle id：显式选中（currentBattleId）优先；单文件尚未解析出 battle 时回退 'r0'
   * （唯一文件天然可分析，不阻塞 AI/Playback）；否则 null（多文件必须显式选择）。
   * 注意：这只用于「喂哪个文件给 AI/Playback」，不写回 currentBattleId，不表示视图。
   */
  const currentTargetBattleId = computed(() => {
    if (currentBattleId.value) return currentBattleId.value
    return singleReplay.value ? 'r0' : null
  })
  const currentSourceId = computed(() => currentTargetBattleId.value)
  const currentProcessingJobId = computed(() => replay.processingJobId.value)
  const currentTargetFile = computed(() => {
    const id = currentTargetBattleId.value
    if (!id) return null
    const m = /^r(\d+)$/.exec(id)
    if (!m) return null
    const idx = parseInt(m[1], 10)
    return replay.files.value[idx] ?? null
  })

  function setWorkspaceTab(tab) {
    activeWorkspaceTab.value = tab
  }

  /** 单场选择：显式选中某场 → 切到单场视图（summary 视图下不会清空选中单场）。 */
  function selectBattle(sourceId) {
    const m = /^r(\d+)$/.exec(sourceId == null ? '' : String(sourceId))
    if (!m) return
    currentBattleId.value = `r${parseInt(m[1], 10)}`
    dataViewMode.value = 'SINGLE'
  }

  /** 切到汇总视图：只改视图轴，保留当前选中单场（供 AI/Playback 消费）。 */
  function selectSummary() {
    dataViewMode.value = 'SUMMARY'
  }

  /** 数据页视图切换：SUMMARY 只改视图；SINGLE 若未选中单场则回退第一场（有 battle 时）。 */
  function setDataViewMode(mode) {
    if (mode === 'SINGLE') {
      const battles = parsedBattles.value
      if (!battles.length && !currentBattleId.value) {
        dataViewMode.value = 'SUMMARY'
        return
      }
      if (!currentBattleId.value && battles.length) currentBattleId.value = 'r0'
      dataViewMode.value = 'SINGLE'
      return
    }
    dataViewMode.value = 'SUMMARY'
  }

  // READY 后用 chooseInitialResultTab 初始化数据子视图：aggregate -> SUMMARY + 第一场，
  // 'b<i>' -> SINGLE + 'r<i>'。仅当 resp 存在时设置 currentBattleId（有 battle 恒非 null）。
  watch(() => replay.resp.value, (resp) => {
    if (!resp) {
      currentBattleId.value = null
      dataViewMode.value = 'SUMMARY'
      return
    }
    const tab = chooseInitialResultTab(resp)
    const hasBattles = Array.isArray(resp.battles) && resp.battles.length > 0
    currentBattleId.value = hasBattles ? 'r0' : null
    dataViewMode.value = tab === 'aggregate' ? 'SUMMARY' : 'SINGLE'
  }, { immediate: true })

  // selection 变化（updateFiles / 删场 / 清空）→ 重算当前 battle（重新解析后 sourceId 重新分配）。
  watch(() => replay.selectionRevision.value, () => {
    currentBattleId.value = null
    dataViewMode.value = 'SUMMARY'
  })

  // dataViewMode + currentBattleId（canonical）→ replay.activeTab（旧渲染兼容层）单向派生。
  watch([dataViewMode, currentBattleId], () => {
    const idx = currentBattleIndex.value
    const tab = dataViewMode.value === 'SINGLE' && idx >= 0 ? `b${idx}` : 'aggregate'
    if (replay.activeTab.value !== tab) replay.activeTab.value = tab
  }, { immediate: true })

  return {
    replay,
    replayBatch,
    parsedBattles,
    currentBattleId,
    dataViewMode,
    activeWorkspaceTab,
    currentBattle,
    currentBattleIndex,
    currentTargetBattleId,
    currentSourceId,
    currentProcessingJobId,
    currentTargetFile,
    singleReplay,
    setWorkspaceTab,
    setDataViewMode,
    selectBattle,
    selectSummary,
  }
}
