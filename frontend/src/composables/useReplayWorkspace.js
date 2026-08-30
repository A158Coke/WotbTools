import { computed, ref, watch } from 'vue'
import { useReplay } from './useReplay.js'

/**
 * Replay Workspace 只负责向现有组件暴露 session facade。
 * 实际状态 owner 是 useReplaySession；legacy fallback 仅供旧的 composable 单测 mock 使用，
 * 生产 useReplay 始终提供 replay.session，不会创建第二份 Workspace state。
 */
export function useReplayWorkspace(initialCapability = 'data') {
  const replay = useReplay(initialCapability)
  if (replay.session) return fromSession(replay, replay.session)
  return legacyWorkspace(replay, initialCapability)
}

function fromSession(replay, session) {
  return {
    replay,
    replayBatch: session.replayBatch,
    parsedBattles: session.parsedBattles,
    currentBattleId: session.currentBattleId,
    dataViewMode: session.dataViewMode,
    activeWorkspaceTab: session.activeWorkspaceTab,
    currentBattle: session.currentBattle,
    currentBattleIndex: session.currentBattleIndex,
    currentTargetBattleId: session.currentTargetBattleId,
    currentSourceId: session.currentSourceId,
    currentProcessingJobId: session.currentProcessingJobId,
    currentTargetFile: session.currentTargetFile,
    singleReplay: session.singleReplay,
    setWorkspaceTab: session.setWorkspaceTab,
    setDataViewMode: session.setDataViewMode,
    selectBattle: session.selectBattle,
  }
}

/**
 * Tests and third-party callers may still provide a minimal useReplay mock without session.
 * Keep this adapter temporary and read-only with respect to production ownership.
 */
function legacyWorkspace(replay, initialCapability) {
  const activeWorkspaceTab = ref(initialCapability === 'playback' || initialCapability === 'ai'
    ? initialCapability
    : 'data')
  const currentBattleId = ref(null)
  const dataViewMode = ref('SUMMARY')
  const replayBatch = computed(() => replay.files.value)
  const parsedBattles = computed(() => replay.resp.value?.battles || [])
  const singleReplay = computed(() => replay.files.value.length === 1)
  const currentBattleIndex = computed(() => {
    if (!currentBattleId.value) return -1
    return parsedBattles.value.findIndex(b => b?.sourceId === currentBattleId.value)
  })
  const currentBattle = computed(() => {
    if (!currentBattleId.value) return null
    return parsedBattles.value.find(b => b?.sourceId === currentBattleId.value) ?? null
  })
  const currentTargetBattleId = computed(() => currentBattleId.value || (singleReplay.value ? 'r0' : null))
  const currentSourceId = computed(() => currentTargetBattleId.value)
  const currentProcessingJobId = computed(() => replay.processingJobId.value)
  const currentTargetFile = computed(() => {
    const match = /^r(\d+)$/.exec(currentTargetBattleId.value || '')
    return match ? replay.files.value[Number.parseInt(match[1], 10)] ?? null : null
  })

  function setWorkspaceTab(tab) { activeWorkspaceTab.value = tab }
  function selectBattle(sourceId) {
    const match = /^r(\d+)$/.exec(sourceId == null ? '' : String(sourceId))
    if (!match) return
    currentBattleId.value = `r${Number.parseInt(match[1], 10)}`
    dataViewMode.value = 'SINGLE'
  }
  function setDataViewMode(mode) {
    if (mode === 'SINGLE') {
      if (!parsedBattles.value.length && !currentBattleId.value) {
        dataViewMode.value = 'SUMMARY'
        return
      }
      if (!currentBattleId.value && parsedBattles.value.length) currentBattleId.value = parsedBattles.value[0]?.sourceId
      dataViewMode.value = 'SINGLE'
      return
    }
    dataViewMode.value = 'SUMMARY'
    currentBattleId.value = parsedBattles.value[0]?.sourceId ?? null
  }

  watch(() => replay.resp.value, (result) => {
    if (!result) {
      currentBattleId.value = null
      dataViewMode.value = 'SUMMARY'
      return
    }
    const battles = Array.isArray(result.battles) ? result.battles : []
    currentBattleId.value = battles[0]?.sourceId ?? null
    dataViewMode.value = battles.length === 1 ? 'SINGLE' : 'SUMMARY'
  }, { immediate: true })
  watch(() => replay.selectionRevision.value, () => {
    currentBattleId.value = null
    dataViewMode.value = 'SUMMARY'
  })

  return {
    replay, replayBatch, parsedBattles, currentBattleId, dataViewMode, activeWorkspaceTab,
    currentBattle, currentBattleIndex, currentTargetBattleId, currentSourceId,
    currentProcessingJobId, currentTargetFile, singleReplay,
    setWorkspaceTab, selectBattle, setDataViewMode,
  }
}
