import { onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { useReplaySession, chooseInitialResultTab } from './useReplaySession.js'
import { useProcessingJob } from './useProcessingJob.js'
import { useExportJob } from './useExportJob.js'

export { chooseInitialResultTab }

/**
 * Replay compatibility facade/orchestrator.
 * Shared state is owned by useReplaySession; Processing and Export lifecycles
 * are delegated to their respective composables while this facade preserves
 * the public composable contract used by existing pages and capability panels.
 */
export function useReplay(initialCapability = 'data') {
  const { locale, t, te } = useI18n()
  const session = useReplaySession(initialCapability)
  const processingController = useProcessingJob(session, { t, te })
  const exportController = useExportJob(session)
  const {
    files, loading, error, resp, playerCols, aggCols, aggStats, activeTab, pendingRemove,
    selectionRevision, processingJob, processingError, processingActive, processingJobId,
    uploadState, processingUiState, exportJob, exportError, exportActive,
  } = session

  function askRemoveBattle(battle, idx) {
    pendingRemove.value = { type: 'battle', battle, label: `${mapLabel(battle.mapName, locale.value)} #${idx + 1}` }
  }

  function askRemoveFile(file) {
    pendingRemove.value = { type: 'file', file, label: displayName(file) }
  }

  function cancelRemove() {
    pendingRemove.value = null
  }

  function confirmRemove() {
    const pending = pendingRemove.value
    pendingRemove.value = null
    if (!pending) return
    const next = pending.type === 'battle'
      ? files.value.filter(f => displayName(f) !== pending.battle.sourceName)
      : files.value.filter(f => fileKey(f) !== fileKey(pending.file))
    processingController.updateFiles(next)
    if (next.length) processingController.startProcessingJob()
  }

  function confirmRemoveBattle() {
    if (pendingRemove.value?.type === 'battle') confirmRemove()
    else pendingRemove.value = null
  }

  onUnmounted(() => {
    exportController.stopPolling()
  })

  return {
    session,
    files, loading, error, resp, playerCols, aggCols, activeTab, aggStats, pendingRemove,
    selectionRevision,
    updateFiles: processingController.updateFiles,
    processingJob, processingError, processingActive, processingJobId,
    uploadState, processingUiState,
    exportJob, exportError, exportActive,
    replayBatch: session.replayBatch,
    parsedBattles: session.parsedBattles,
    singleReplay: session.singleReplay,
    activeWorkspaceTab: session.activeWorkspaceTab,
    currentBattleId: session.currentBattleId,
    dataViewMode: session.dataViewMode,
    currentBattle: session.currentBattle,
    currentBattleIndex: session.currentBattleIndex,
    currentTargetBattleId: session.currentTargetBattleId,
    currentSourceId: session.currentSourceId,
    currentProcessingJobId: session.currentProcessingJobId,
    currentTargetFile: session.currentTargetFile,
    setWorkspaceTab: session.setWorkspaceTab,
    selectBattle: session.selectBattle,
    setDataViewMode: session.setDataViewMode,
    startProcessingJob: processingController.startProcessingJob,
    cancelProcessingJob: processingController.cancelProcessingJob,
    cancelProcessing: processingController.cancelProcessing,
    dismissProcessingJob: processingController.dismissProcessingJob,
    invalidateExpiredProcessingDataset: processingController.invalidateExpiredProcessingDataset,
    requestDirectAction: processingController.requestDirectAction,
    startExportJob: exportController.start,
    cancelExportJob: exportController.cancel,
    downloadExportResult: exportController.download,
    dismissExportJob: exportController.dismiss,
    askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}
