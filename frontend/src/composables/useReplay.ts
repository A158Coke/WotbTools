import { useI18n } from 'vue-i18n'
import { displayName, fileKey } from '../utils/helpers.js'
import { useReplaySession, chooseInitialResultTab } from './useReplaySession.js'
import { useLocalReplayAnalysis } from './useLocalReplayAnalysis.js'
import type { ReplayCapability } from '../types/workspace.js'

export { chooseInitialResultTab }

/**
 * Replay facade/orchestrator。共享状态由 useReplaySession 持有；分析（本机 WASM 解析 + 批次计算）
 * 与导出（客户端 xlsx）委托 useLocalReplayAnalysis。服务器没有 parser，也没有 job / 轮询。
 */
export function useReplay(initialCapability: ReplayCapability = 'data') {
  const { t } = useI18n()
  const session = useReplaySession(initialCapability)
  const analysis = useLocalReplayAnalysis(session, { t })
  const { files, pendingRemove } = session

  function askRemoveFile(file: File): void {
    pendingRemove.value = { file, label: displayName(file) }
  }

  function cancelRemove(): void {
    pendingRemove.value = null
  }

  function confirmRemove(): void {
    const pending = pendingRemove.value
    pendingRemove.value = null
    if (!pending) return
    const next = files.value.filter(f => fileKey(f) !== fileKey(pending.file))
    if (next.length) void analysis.changeFiles(next)
    else analysis.updateFiles([])
  }

  return {
    session,
    files,
    loading: session.loading,
    error: session.error,
    resp: session.resp,
    playerCols: session.playerCols,
    aggCols: session.aggCols,
    activeTab: session.activeTab,
    aggStats: session.aggStats,
    pendingRemove,
    selectionRevision: session.selectionRevision,
    isDemoSelection: session.isDemoSelection,
    analysis: session.analysis,
    analysisActive: session.analysisActive,
    updateFiles: analysis.updateFiles,
    changeFiles: analysis.changeFiles,
    updateDemoFile: analysis.updateDemoFile,
    analyze: analysis.analyze,
    cancelAnalysis: analysis.cancel,
    exportExcel: analysis.exportExcel,
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
    currentTargetFile: session.currentTargetFile,
    setWorkspaceTab: session.setWorkspaceTab,
    selectBattle: session.selectBattle,
    setDataViewMode: session.setDataViewMode,
    askRemoveFile, cancelRemove, confirmRemove,
  }
}
