import { computed, ref, watch } from 'vue'
import { useReplay, chooseInitialResultTab } from './useReplay.js'

/**
 * ReplayWorkspace 公共状态（单一 owner）。
 *
 * 权威字段（plan: 目标状态模型）：
 * - replayBatch        = useReplay.files
 * - parsedBattles[]    = useReplay.resp.battles
 * - currentBattleId    = 'r<i>' | null（null = summary view；对应原 activeTab==='aggregate'）
 * - activeWorkspaceTab = 'data' | 'ai' | 'playback'
 *
 * 派生（不新增状态字段）：
 * - currentBattle / currentBattleIndex
 * - currentTargetBattleId：显式 currentBattleId，否则单文件 -> 'r0'，否则 null
 * - currentTargetFile / currentSourceId：喂 AiReviewPanel / BattlePlaybackPanel
 *
 * 数据子视图：currentBattleId ↔ replay.activeTab 双向同步（guard 防环）。跨能力（AI/Playback）
 * 目标一律读 currentBattleId / currentTargetBattleId（sourceId，不用数组下标，避免删场漂移）。
 */
export function useReplayWorkspace(initialCapability = 'data') {
  const replay = useReplay()

  const activeWorkspaceTab = ref(initialCapability === 'playback' || initialCapability === 'ai'
    ? initialCapability
    : 'data')
  /** 'r<i>' | null；null = summary view。 */
  const currentBattleId = ref(null)

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
  /** 跨能力目标 battle id：显式选中优先；单文件回退 'r0'；多文件未选 -> null。 */
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

  function selectBattle(sourceId) {
    const m = /^r(\d+)$/.exec(sourceId == null ? '' : String(sourceId))
    if (!m) {
      selectSummary()
      return
    }
    currentBattleId.value = `r${parseInt(m[1], 10)}`
  }

  function selectSummary() {
    currentBattleId.value = null
  }

  // READY 后用 chooseInitialResultTab 初始化 currentBattleId：aggregate -> null（summary），
  // 'b<i>' -> 'r<i>'。仅在 resp 变化（同一 selectionRevision 内）初始化；用户操作优先。
  watch(() => replay.resp.value, (resp) => {
    if (!resp) {
      currentBattleId.value = null
      return
    }
    const tab = chooseInitialResultTab(resp)
    currentBattleId.value = tab === 'aggregate' ? null : `r${tab.replace('b', '')}`
  }, { immediate: true })

  // selection 变化（updateFiles / 删场 / 清空）→ 重算当前 battle（重新解析后 sourceId 重新分配）。
  watch(() => replay.selectionRevision.value, () => {
    currentBattleId.value = null
  })

  // currentBattleId（canonical）↔ replay.activeTab（数据子视图渲染）双向同步，guard 防环。
  watch(currentBattleId, (id) => {
    const idx = currentBattleIndex.value
    replay.activeTab.value = id ? `b${idx}` : 'aggregate'
  })
  watch(() => replay.activeTab.value, (tab) => {
    const isAgg = tab === 'aggregate'
    const newId = isAgg ? null : `r${String(tab).replace('b', '')}`
    if (newId !== currentBattleId.value) currentBattleId.value = newId
  })

  return {
    replay,
    replayBatch,
    parsedBattles,
    currentBattleId,
    activeWorkspaceTab,
    currentBattle,
    currentBattleIndex,
    currentTargetBattleId,
    currentSourceId,
    currentProcessingJobId,
    currentTargetFile,
    singleReplay,
    setWorkspaceTab,
    selectBattle,
    selectSummary,
  }
}
