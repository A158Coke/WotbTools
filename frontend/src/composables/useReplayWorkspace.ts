import { onScopeDispose, watch, getCurrentScope, shallowReactive } from 'vue'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { LocalPlayback } from '../replay-local/playback/parseLocalPlayback.js'
import { useReplay } from './useReplay.js'
import type { ReplayCapability } from '../types/workspace.js'

type PlaybackReadiness = 'idle' | 'loading' | 'ready' | 'error'

export interface WorkspacePlayback {
  scenePlayback: AgentPlaybackFacet | null
  sceneError: unknown
  sceneState: PlaybackReadiness
  canonical: LocalPlayback | null
  canonicalError: unknown
  canonicalState: PlaybackReadiness
}

/**
 * Replay Workspace facade. The ReplaySession returned by useReplay is the
 * only owner of selection, result identity, selected battle, and workspace
 * view state; this module exposes that contract to the orchestration SFC.
 */
export function useReplayWorkspace(initialCapability: ReplayCapability = 'data') {
  const replay = useReplay(initialCapability)
  const { session } = replay
  // Separate readiness: scene never awaits canonical; both remain workspace-owned.
  const entries = new WeakMap<File, {
    state: WorkspacePlayback
    scenePromise?: Promise<AgentPlaybackFacet>
    canonicalPromise?: Promise<LocalPlayback | null>
    controller: AbortController | null
    canonicalGeneration: number
  }>()
  type Entry = NonNullable<ReturnType<typeof entries.get>>
  const pending = new Set<Entry>()
  function entryFor(file: File): Entry {
    let entry = entries.get(file)
    if (!entry) {
      entry = { state: shallowReactive<WorkspacePlayback>({
        scenePlayback: null, sceneError: null, sceneState: 'idle',
        canonical: null, canonicalError: null, canonicalState: 'idle',
      }), controller: null, canonicalGeneration: 0 }
      entries.set(file, entry)
    }
    return entry
  }
  function releasePending(entry: Entry) {
    if (entry.state.sceneState !== 'loading' && entry.state.canonicalState !== 'loading') pending.delete(entry)
  }
  function invalidateCanonical(file: File) {
    const entry = entryFor(file)
    // Canonical WASM projection has no AbortSignal: stale-discard only, not physical abort.
    entry.canonicalGeneration++
    entry.canonicalPromise = undefined
    entry.state.canonical = null
    entry.state.canonicalError = null
    entry.state.canonicalState = 'idle'
    releasePending(entry)
  }
  function cancelPending() {
    for (const entry of pending) {
      entry.controller?.abort() // Real Worker cancellation; also withdraw scheduled enrichment.
      entry.controller = null
      if (entry.state.sceneState === 'loading') {
        entry.scenePromise = undefined
        entry.state.sceneState = 'idle'
      }
      if (entry.state.canonicalState === 'loading') {
        entry.canonicalGeneration++
        entry.canonicalPromise = undefined
        entry.state.canonicalState = 'idle'
      }
    }
    pending.clear()
  }
  watch(session.currentTargetFile, cancelPending, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(cancelPending)
  const playbackSession = {
    getState(file: File) { return entryFor(file).state },
    invalidateCanonical,
    invalidate(file: File) {
      const entry = entryFor(file)
      entry.controller?.abort()
      entry.controller = null
      entry.scenePromise = undefined
      entry.state.scenePlayback = null
      entry.state.sceneError = null
      entry.state.sceneState = 'idle'
      invalidateCanonical(file)
    },
    loadScene(file: File): Promise<AgentPlaybackFacet> {
      const entry = entryFor(file)
      if (entry.scenePromise) {
        // Reselecting a cached scene resumes enrichment withdrawn with the old selection.
        if (entry.state.sceneState === 'ready' && entry.state.canonicalState === 'idle') {
          void playbackSession.loadCanonical(file).catch(() => {})
        }
        return entry.scenePromise
      }
      const controller = new AbortController()
      entry.controller = controller
      entry.state.sceneState = 'loading'
      pending.add(entry)
      const task = (async () => {
        const { loadFromLocalFile } = await import('../scene/replaySource.js')
        const playback = await loadFromLocalFile(file, controller.signal)
        if (controller.signal.aborted) throw new DOMException('Playback scene cancelled', 'AbortError')
        entry.state.scenePlayback = playback
        entry.state.sceneError = null
        entry.state.sceneState = 'ready'
        return playback
      })().catch(error => {
        if (entry.controller === controller) {
          entry.state.sceneError = error
          entry.state.sceneState = 'error'
        }
        throw error
      }).finally(() => { releasePending(entry) })
      entry.scenePromise = task
      // Publish raw readiness first. Canonical runs in the background and never gates scene.
      task.then(() => {
        if (!controller.signal.aborted) void playbackSession.loadCanonical(file).catch(() => {})
      }, () => {})
      return task
    },
    loadCanonical(file: File): Promise<LocalPlayback | null> {
      const entry = entryFor(file)
      if (entry.canonicalPromise) return entry.canonicalPromise
      const generation = ++entry.canonicalGeneration
      entry.state.canonicalState = 'loading'
      pending.add(entry)
      const current = () => generation === entry.canonicalGeneration
      const task = (async () => {
        const playback = await playbackSession.loadScene(file)
        if (!current()) throw new DOMException('Canonical projection withdrawn', 'AbortError')
        // 线程外投影（Worker 优先）：整条 canonical（3 次 Rust 解析 + 整场 JS 投影）在主线程
        // 跑会停顿数百 ms~数秒——用户实测的"播放正常一小段后卡住"。见 canonicalRuntime.ts。
        const { parseLocalPlaybackOffThread } = await import('../replay-local/canonicalRuntime.js')
        if (!current()) throw new DOMException('Canonical projection withdrawn', 'AbortError')
        const canonical = await parseLocalPlaybackOffThread(await file.arrayBuffer())
        if (!current()) throw new DOMException('Canonical projection withdrawn', 'AbortError')
        entry.state.canonical = canonical
        entry.state.canonicalError = null
        entry.state.canonicalState = 'ready'
        return canonical
      })().catch(error => {
        if (!current()) throw error
        entry.state.canonicalError = error
        entry.state.canonicalState = 'error'
        return null
      }).finally(() => { releasePending(entry) })
      entry.canonicalPromise = task
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
