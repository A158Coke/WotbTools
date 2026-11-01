import { computed, ref, shallowRef, toRaw, watch } from 'vue'
import { isOfficialDemo } from '../replay-local/demo.js'
import { sourceId as makeSourceId } from '../types/replay.js'
import type { Battle, ColumnDef, ReplayResult, SourceId } from '../types/replay.js'
import type { DataViewMode, ReplayAnalysis, ReplayCapability } from '../types/workspace.js'
import { toReplayCapability } from '../types/workspace.js'

export interface PendingRemove {
  file: File
  label: string
}

/**
 * Replay 的唯一 session state owner。
 *
 * 本地解析副作用由 useLocalReplayAnalysis 驱动；本 composable 只拥有 selection、
 * 分析状态 / 结果以及 Workspace view state，避免同一状态在多处各有一份可写副本。
 * 服务器没有 parser：分析完全在本机完成，没有 job / 上传 / 轮询状态。
 */
export function useReplaySession(initialCapability: ReplayCapability = 'data') {
  const files = ref<File[]>([])
  const selectionRevision = ref(0)
  const demoFile = shallowRef<File | null>(null)
  const isDemoSelection = computed(() => demoFile.value != null
    && files.value.length === 1 && toRaw(files.value[0]) === demoFile.value && isOfficialDemo(demoFile.value))
  const loading = ref(false)
  const error = ref('')
  const resp = ref<ReplayResult | null>(null)
  const activeTab = ref('aggregate')
  const pendingRemove = ref<PendingRemove | null>(null)

  const analysis = ref<ReplayAnalysis>({ phase: 'idle', done: 0, total: 0, failure: null })

  const activeWorkspaceTab = ref<ReplayCapability>(toReplayCapability(initialCapability))
  /**
   * 当前场次的身份是 File，sourceId 只是它在 files 里的位置：集合增删会移动位置，但不能换场。
   * 这里只有一份状态：currentBattleId 由它派生，写入时再解析回 File。
   */
  const currentBattleFile = shallowRef<File | null>(null)
  const currentBattleId = computed<SourceId | null>({
    get() {
      const index = currentBattleFile.value ? files.value.indexOf(currentBattleFile.value) : -1
      return index >= 0 ? makeSourceId(`r${index}`) : null
    },
    set(id) {
      const match = /^r(\d+)$/.exec(id ?? '')
      const file = match ? files.value[Number.parseInt(match[1], 10)] : null
      currentBattleFile.value = file ? toRaw(file) : null
    },
  })
  const dataViewMode = ref<DataViewMode>('SUMMARY')

  const playerCols = computed<ColumnDef[]>(() => resp.value?.playerColumns || [])
  const aggCols = computed<ColumnDef[]>(() => resp.value?.aggregateColumns || [])
  const aggStats = computed(() => {
    if (!resp.value) return null
    const battles = Array.isArray(resp.value.battles) ? resp.value.battles : []
    const agg = resp.value.aggregate || []
    let maxDmg = 0
    battles.forEach(b => (b.players || []).forEach(p => {
      maxDmg = Math.max(maxDmg, Number(p.cells.damage_dealt) || 0)
    }))
    return { battles: battles.length, players: agg.length, maxDmg }
  })
  const analysisActive = computed(() => analysis.value.phase === 'parsing')

  const parsedBattles = computed<Battle[]>(() => Array.isArray(resp.value?.battles) ? resp.value.battles : [])
  const replayBatch = computed(() => files.value)
  const singleReplay = computed(() => files.value.length === 1)
  const currentBattleIndex = computed(() => {
    if (!currentBattleId.value) return -1
    return parsedBattles.value.findIndex(b => b?.sourceId === currentBattleId.value)
  })
  const currentBattle = computed(() => {
    if (!currentBattleId.value) return null
    return parsedBattles.value.find(b => b?.sourceId === currentBattleId.value) ?? null
  })
  const currentTargetBattleId = computed(() => {
    if (currentBattleId.value) return currentBattleId.value
    return singleReplay.value ? 'r0' : null
  })
  const currentSourceId = computed(() => currentTargetBattleId.value)
  const currentTargetFile = computed(() => {
    const id = currentTargetBattleId.value
    if (!id) return null
    const match = /^r(\d+)$/.exec(id)
    if (!match) return null
    return files.value[Number.parseInt(match[1], 10)] ?? null
  })

  /** 选择变化的原子提交：先由 useReplay 停止副作用，再调用本方法。 */
  function replaceSelection(next: File[]) {
    demoFile.value = null
    files.value = next
    selectionRevision.value++
    resp.value = null
    activeTab.value = 'aggregate'
    analysis.value = { phase: 'idle', done: 0, total: 0, failure: null }
    loading.value = false
    currentBattleId.value = null
    dataViewMode.value = 'SUMMARY'
  }

  /** 当前文件被移出时的落点：同位置的下一场，末位取前一场。 */
  function fallbackBattleFile(current: File, next: Set<File>): File | null {
    const battleFiles = parsedBattles.value
      .map(b => files.value[Number.parseInt(String(b?.sourceId).slice(1), 10)])
      .filter((file): file is File => !!file)
      .map(file => toRaw(file))
    const index = battleFiles.indexOf(current)
    return battleFiles.slice(index + 1).find(file => next.has(file))
      ?? battleFiles.slice(0, Math.max(index, 0)).reverse().find(file => next.has(file))
      ?? null
  }

  /**
   * 集合增删（有结果时）：保留结果与当前场次，只换 files。落点先于 files 写入，
   * currentTargetFile 的 sync 观察者因此只会看到一次真实换场，看不到中间态。
   */
  function changeSelection(next: File[]) {
    const current = currentBattleFile.value
    const rawNext = next.map(file => toRaw(file))
    const kept = new Set(rawNext)
    if (current && !kept.has(current)) currentBattleFile.value = fallbackBattleFile(current, kept)
    demoFile.value = null
    files.value = rawNext
    selectionRevision.value++
  }

  /** Only the verified loader can supply this identity. Ordinary selection always revokes it. */
  function replaceDemoSelection(file: File) {
    if (!isOfficialDemo(file)) throw new Error('Unverified official replay')
    replaceSelection([file])
    demoFile.value = toRaw(file)
  }

  function commitReadyResult(result: ReplayResult) {
    resp.value = result
    activeTab.value = chooseInitialResultTab(result)
  }

  function setWorkspaceTab(tab: ReplayCapability) {
    activeWorkspaceTab.value = tab
  }

  function selectBattle(sourceId: SourceId | string | null) {
    const match = /^r(\d+)$/.exec(sourceId == null ? '' : String(sourceId))
    if (!match) return
    const id = makeSourceId(`r${Number.parseInt(match[1], 10)}`)
    if (!parsedBattles.value.some(b => b?.sourceId === id)) return
    currentBattleId.value = id
    dataViewMode.value = 'SINGLE'
  }

  function setDataViewMode(mode: DataViewMode) {
    if (mode === 'SINGLE') {
      const battles = parsedBattles.value
      if (!battles.length && !currentBattleId.value) {
        dataViewMode.value = 'SUMMARY'
        return
      }
      if (!currentBattleId.value && battles.length) currentBattleId.value = battles[0]?.sourceId ?? null
      dataViewMode.value = 'SINGLE'
      return
    }
    dataViewMode.value = 'SUMMARY'
  }

  // Result commit is the sole place that normalizes selected battle/view state.
  watch(resp, (result) => {
    if (!result) {
      currentBattleId.value = null
      dataViewMode.value = 'SUMMARY'
      return
    }
    const battles = Array.isArray(result.battles) ? result.battles : []
    // 集合增删后的新结果：当前场次还在就原地不动，连同数据视图一起保留。
    if (currentBattleId.value && battles.some(b => b?.sourceId === currentBattleId.value)) return
    currentBattleId.value = battles[0]?.sourceId ?? null
    dataViewMode.value = battles.length === 1 ? 'SINGLE' : 'SUMMARY'
  }, { immediate: true })

  return {
    files, selectionRevision, isDemoSelection, loading, error, resp, activeTab, pendingRemove,
    analysis, analysisActive,
    playerCols, aggCols, aggStats,
    replayBatch, parsedBattles, singleReplay, currentBattleId, dataViewMode,
    activeWorkspaceTab, currentBattle, currentBattleIndex,
    currentTargetBattleId, currentSourceId, currentTargetFile,
    replaceSelection, changeSelection, replaceDemoSelection, commitReadyResult,
    setWorkspaceTab, selectBattle, setDataViewMode,
  }
}

export function chooseInitialResultTab(result) {
  if (result?.leagueMode === true) return 'aggregate'
  if (Array.isArray(result?.aggregate) && result.aggregate.length > 0) return 'aggregate'
  if (Array.isArray(result?.battles) && result.battles.length > 0) return 'b0'
  return 'aggregate'
}
