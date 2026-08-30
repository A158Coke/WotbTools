import { computed, ref, watch } from 'vue'
import { useReplay } from './useReplay.js'

/**
 * Replay Workspace 公共状态（单一 owner）。
 *
 * 权威字段（plan: 目标状态模型，Blocker #1）：
 * - replayBatch        = useReplay.files
 * - parsedBattles[]    = useReplay.resp.battles
 * - currentBattleId    = BattleDto.sourceId（'r<sourceIndex>'）| null；恒代表「当前单场」，
 *                       仅在无可用 battle 时为 null，
 *                        不能用 null 表示 summary 视图。
 * - dataViewMode       = 'SUMMARY' | 'SINGLE'；数据页视图轴（汇总视图 / 单场视图），
 *                        与选中单场联动（plan §5）：SUMMARY 视图会把当前回放归一第一场有效 battle，
 *                        SINGLE 视图锁定当前选中单场。
 * - activeWorkspaceTab = 'data' | 'ai' | 'playback'
 *
 * 派生（不新增状态字段）：
 * - currentBattle / currentBattleIndex：按 battle.sourceId === currentBattleId find/findIndex。
 *   sourceId 是唯一权威 identity（failure/duplicate 从 resp.battles 移除），
 *   rN 的 N 是文件 sourceIndex，与 parsedBattles 数组下标不等价，禁止直接当数组下标用。
 * - currentTargetBattleId / currentTargetFile / currentSourceId：喂 AiReviewPanel / BattlePlaybackPanel。
 *   currentTargetBattleId 显式 currentBattleId 优先，有 battle 时恒非 null；
 *   单文件尚未解析出 battle 时回退 'r0'。Data SUMMARY 归一后，AI/Playback 随之消费第一场（plan §5）。
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
    return parsedBattles.value.findIndex(b => b?.sourceId === id)
  })
  const currentBattle = computed(() => {
    const id = currentBattleId.value
    if (!id) return null
    return parsedBattles.value.find(b => b?.sourceId === id) ?? null
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

  /** 数据页视图切换：SUMMARY 把 currentBattleId 归一第一场（plan §5）；SINGLE 未选中时回退第一场。 */
  function setDataViewMode(mode) {
    if (mode === 'SINGLE') {
      const battles = parsedBattles.value
      if (!battles.length && !currentBattleId.value) {
        dataViewMode.value = 'SUMMARY'
        return
      }
      if (!currentBattleId.value && battles.length) currentBattleId.value = battles[0]?.sourceId
      dataViewMode.value = 'SINGLE'
      return
    }
    dataViewMode.value = 'SUMMARY'
    const battles = parsedBattles.value
    if (battles.length) currentBattleId.value = battles[0]?.sourceId ?? null
    else currentBattleId.value = null
  }

  // READY 后初始化数据子视图（plan §7）：单场 -> SINGLE + 该场；多场 -> SUMMARY + 第一场；
  // 无有效 battle -> SUMMARY + null。不再用 chooseInitialResultTab 推断——单文件即使有 aggregate
  // 也应默认直接显示单场结果（Blocker：单独上传一场仍先看到汇总）。
  watch(() => replay.resp.value, (resp) => {
    if (!resp) {
      currentBattleId.value = null
      dataViewMode.value = 'SUMMARY'
      return
    }
    const battles = Array.isArray(resp.battles) ? resp.battles : []
    if (battles.length === 1) {
      currentBattleId.value = battles[0]?.sourceId ?? null
      dataViewMode.value = 'SINGLE'
    } else if (battles.length > 1) {
      currentBattleId.value = battles[0]?.sourceId ?? null
      dataViewMode.value = 'SUMMARY'
    } else {
      currentBattleId.value = null
      dataViewMode.value = 'SUMMARY'
    }
  }, { immediate: true })

  // selection 变化（updateFiles / 删场 / 清空）→ 重算当前 battle（重新解析后 sourceId 重新分配）。
  watch(() => replay.selectionRevision.value, () => {
    currentBattleId.value = null
    dataViewMode.value = 'SUMMARY'
  })

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
  }
}
