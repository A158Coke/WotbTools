import { useI18n } from 'vue-i18n'
import { displayName, mapLabel, fileKey } from '../utils/helpers.js'
import { useReplaySession, chooseInitialResultTab } from './useReplaySession.js'
import { useLocalReplayAnalysis } from './useLocalReplayAnalysis.js'
import type { ReplayCapability } from '../types/workspace.js'
import type { Battle } from '../types/replay.js'

export { chooseInitialResultTab }

/**
 * Replay facade/orchestrator。共享状态由 useReplaySession 持有；分析（本机 WASM 解析 + 批次计算）
 * 与导出（客户端 xlsx）委托 useLocalReplayAnalysis。服务器没有 parser，也没有 job / 轮询。
 */
export function useReplay(initialCapability: ReplayCapability = 'data') {
  const { locale, t } = useI18n()
  const session = useReplaySession(initialCapability)
  const analysis = useLocalReplayAnalysis(session, { t })
  const { files, pendingRemove } = session

  function askRemoveBattle(battle: Battle, idx: number): void {
    pendingRemove.value = { type: 'battle', battle, label: `${mapLabel(battle.mapName, locale.value)} #${idx + 1}` }
  }

  function askRemoveFile(file: File): void {
    pendingRemove.value = { type: 'file', file, label: displayName(file) }
  }

  function cancelRemove(): void {
    pendingRemove.value = null
  }

  function confirmRemove(): void {
    const pending = pendingRemove.value
    pendingRemove.value = null
    if (!pending) return
    const next = pending.type === 'battle'
      ? files.value.filter(f => displayName(f) !== pending.battle.sourceName)
      : files.value.filter(f => fileKey(f) !== fileKey(pending.file))
    analysis.updateFiles(next)
    if (next.length) analysis.analyze()
  }

  function confirmRemoveBattle(): void {
    if (pendingRemove.value?.type === 'battle') confirmRemove()
    else pendingRemove.value = null
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
    updateDemoFile: analysis.updateDemoFile,
    analyze: analysis.analyze,
    cancelAnalysis: analysis.cancel,
    dismissAnalysis: analysis.dismiss,
    exportExcel: analysis.exportExcel,
    parsedFiles: analysis.parsedFiles,
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
    askRemoveBattle, askRemoveFile, cancelRemove, confirmRemove, confirmRemoveBattle,
  }
}
