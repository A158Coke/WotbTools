import { onScopeDispose, watch, getCurrentScope, shallowReactive } from 'vue'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { LocalPlayback } from '../replay-local/playback/parseLocalPlayback.js'
import { useReplay } from './useReplay.js'
import type { ReplayCapability } from '../types/workspace.js'

export interface WorkspacePlayback {
  scenePlayback: AgentPlaybackFacet
  canonical: LocalPlayback | null
  canonicalError: unknown
}

/**
 * Replay Workspace facade. The ReplaySession returned by useReplay is the
 * only owner of selection, result identity, selected battle, and workspace
 * view state; this module exposes that contract to the orchestration SFC.
 */
export function useReplayWorkspace(initialCapability: ReplayCapability = 'data') {
  const replay = useReplay(initialCapability)
  const { session } = replay
  // Playback parsing belongs to the workspace session, never to a renderer or Details.
  const results = new WeakMap<File, Promise<WorkspacePlayback>>()
  const states = new WeakMap<File, WorkspacePlayback>()
  const pending = new Map<File, AbortController>()
  function cancelPending() {
    for (const [file, controller] of pending) {
      results.delete(file)
      controller.abort()
    }
    pending.clear()
  }
  watch(session.currentTargetFile, cancelPending, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(cancelPending)
  const playbackSession = {
    invalidate(file: File) {
      pending.get(file)?.abort()
      pending.delete(file)
      results.delete(file)
    },
    load(file: File): Promise<WorkspacePlayback> {
      const cached = results.get(file)
      if (cached) return cached
      const controller = new AbortController()
      pending.set(file, controller)
      const task = (async () => {
        const [{ loadFromLocalFile }, { parseLocalPlayback }] = await Promise.all([
          import('../scene/replaySource.js'), import('../replay-local/playback/index.js'),
        ])
        const previous = states.get(file)
        const playback = previous?.scenePlayback ?? await loadFromLocalFile(file, controller.signal)
        if (controller.signal.aborted) throw new DOMException('Playback session cancelled', 'AbortError')
        let canonical: LocalPlayback | null = null
        let canonicalError: unknown = null
        try { canonical = await parseLocalPlayback(file, { playback }) }
        catch (error) { canonicalError = error }
        if (controller.signal.aborted) throw new DOMException('Playback session cancelled', 'AbortError')
        // Keep one reactive result identity: a 2D retry also repairs retained 3D Details.
        const result = previous ?? shallowReactive({ scenePlayback: playback, canonical: null, canonicalError: null } as WorkspacePlayback)
        result.canonical = canonical
        result.canonicalError = canonicalError
        states.set(file, result)
        return result
      })()
      results.set(file, task)
      task.catch(() => { if (results.get(file) === task) results.delete(file) })
        .finally(() => { if (pending.get(file) === controller) pending.delete(file) })
      return task
    },
  }

  return {
    replay,
    playbackSession,
    replayBatch: session.replayBatch,
    parsedBattles: session.parsedBattles,
    currentBattleId: session.currentBattleId,
    dataViewMode: session.dataViewMode,
    activeWorkspaceTab: session.activeWorkspaceTab,
    currentBattle: session.currentBattle,
    currentBattleIndex: session.currentBattleIndex,
    currentTargetBattleId: session.currentTargetBattleId,
    currentSourceId: session.currentSourceId,
    currentTargetFile: session.currentTargetFile,
    singleReplay: session.singleReplay,
    setWorkspaceTab: session.setWorkspaceTab,
    setDataViewMode: session.setDataViewMode,
    selectBattle: session.selectBattle,
  }
}
