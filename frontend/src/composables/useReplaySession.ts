import { computed, ref, watch } from 'vue'
import type { ExportJob, ProcessingJob, UploadProgress } from '../types/jobs.js'
import { sourceId as makeSourceId } from '../types/replay.js'
import type { Battle, ColumnDef, ProcessingJobId, ReplayResult, SourceId } from '../types/replay.js'
import type { DataViewMode, ReplayCapability } from '../types/workspace.js'

export type PendingRemove =
  | { type: 'battle'; battle: Battle; label: string }
  | { type: 'file'; file: File; label: string }

const JOB_ACTIVE = new Set(['QUEUED', 'PROCESSING'])

const PROCESSING_UI_STATES = Object.freeze({
  EMPTY: 'EMPTY',
  FILES_SELECTED: 'FILES_SELECTED',
  UPLOADING: 'UPLOADING',
  REGISTERING: 'REGISTERING',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  FINALIZING: 'FINALIZING',
  READY: 'READY',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
})

/**
 * Replay 的唯一 session state owner。
 *
 * API/轮询/上传副作用由 useReplay 驱动；本 composable 只拥有 selection、
 * processing/result/export identity 以及 Workspace view state，避免同一状态在
 * useReplay 与 useReplayWorkspace 各有一份可写副本。
 */
export function useReplaySession(initialCapability: ReplayCapability = 'data') {
  const files = ref<File[]>([])
  const selectionRevision = ref(0)
  const loading = ref(false)
  const error = ref('')
  const resp = ref<ReplayResult | null>(null)
  const activeTab = ref('aggregate')
  const pendingRemove = ref<PendingRemove | null>(null)

  const processingJob = ref<ProcessingJob | null>(null)
  const processingError = ref('')
  const uploadState = ref<UploadProgress | null>(null)
  const processingJobId = ref<ProcessingJobId | null>(null)

  const exportJob = ref<ExportJob | null>(null)
  const exportError = ref('')

  const activeWorkspaceTab = ref(initialCapability === 'playback' || initialCapability === 'ai'
    ? initialCapability
    : 'data')
  const currentBattleId = ref<SourceId | null>(null)
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
  const processingActive = computed(() => processingJob.value && JOB_ACTIVE.has(processingJob.value.status))
  const exportActive = computed(() => exportJob.value && JOB_ACTIVE.has(exportJob.value.status))
  const processingUiState = computed(() => {
    if (uploadState.value) return uploadState.value.phase
    const job = processingJob.value
    if (!job) return files.value.length ? PROCESSING_UI_STATES.FILES_SELECTED : PROCESSING_UI_STATES.EMPTY
    switch (job.status) {
      case 'QUEUED': return PROCESSING_UI_STATES.QUEUED
      case 'PROCESSING':
        return job.phase === 'FINALIZING_BATCH' ? PROCESSING_UI_STATES.FINALIZING : PROCESSING_UI_STATES.PROCESSING
      case 'READY': return PROCESSING_UI_STATES.READY
      case 'FAILED': return PROCESSING_UI_STATES.FAILED
      case 'CANCELLED': return PROCESSING_UI_STATES.CANCELLED
      default: return PROCESSING_UI_STATES.FILES_SELECTED
    }
  })
  const resultMatchesSelection = computed(() => !!processingJobId.value && !!resp.value)

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
  const currentProcessingJobId = computed(() => processingJobId.value)
  const currentTargetFile = computed(() => {
    const id = currentTargetBattleId.value
    if (!id) return null
    const match = /^r(\d+)$/.exec(id)
    if (!match) return null
    return files.value[Number.parseInt(match[1], 10)] ?? null
  })

  /** 选择变化的原子提交：先由 useReplay 停止副作用，再调用本方法。 */
  function replaceSelection(next: File[]) {
    files.value = next
    selectionRevision.value++
    processingJobId.value = null
    resp.value = null
    activeTab.value = 'aggregate'
    processingError.value = ''
    processingJob.value = null
    uploadState.value = null
    loading.value = false
    currentBattleId.value = null
    dataViewMode.value = 'SUMMARY'
  }

  function commitReadyResult(result: ReplayResult, jobId: ProcessingJobId) {
    resp.value = result
    processingJobId.value = jobId
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
    currentBattleId.value = parsedBattles.value[0]?.sourceId ?? null
  }

  // Result commit is the sole place that normalizes selected battle/view state.
  watch(resp, (result) => {
    if (!result) {
      currentBattleId.value = null
      dataViewMode.value = 'SUMMARY'
      return
    }
    const battles = Array.isArray(result.battles) ? result.battles : []
    currentBattleId.value = battles[0]?.sourceId ?? null
    dataViewMode.value = battles.length === 1 ? 'SINGLE' : 'SUMMARY'
  }, { immediate: true })

  return {
    files, selectionRevision, loading, error, resp, activeTab, pendingRemove,
    processingJob, processingError, uploadState, processingJobId,
    exportJob, exportError,
    playerCols, aggCols, aggStats, processingActive, exportActive,
    processingUiState, resultMatchesSelection,
    replayBatch, parsedBattles, singleReplay, currentBattleId, dataViewMode,
    activeWorkspaceTab, currentBattle, currentBattleIndex,
    currentTargetBattleId, currentSourceId, currentProcessingJobId, currentTargetFile,
    replaceSelection, commitReadyResult,
    setWorkspaceTab, selectBattle, setDataViewMode,
  }
}

export function chooseInitialResultTab(result) {
  if (result?.leagueMode === true) return 'aggregate'
  if (Array.isArray(result?.aggregate) && result.aggregate.length > 0) return 'aggregate'
  if (Array.isArray(result?.battles) && result.battles.length > 0) return 'b0'
  return 'aggregate'
}
