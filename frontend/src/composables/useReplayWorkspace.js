import { useReplay } from './useReplay.js'

/**
 * Replay Workspace facade. The ReplaySession returned by useReplay is the
 * only owner of selection, result identity, selected battle, and workspace
 * view state; this module exposes that contract to the orchestration SFC.
 */
export function useReplayWorkspace(initialCapability = 'data') {
  const replay = useReplay(initialCapability)
  const { session } = replay

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
