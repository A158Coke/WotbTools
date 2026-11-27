import { onScopeDispose, watch, getCurrentScope, shallowReactive } from 'vue'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { LocalPlayback } from '../replay-local/playback/parseLocalPlayback.js'
import { useReplay } from './useReplay.js'
import type { ReplayCapability } from '../types/workspace.js'
import type { PlaybackDiagnosticEvent, PlaybackDiagnosticObserver } from '../scene/replaySource.js'

function emitPlaybackDiagnostic(observer: PlaybackDiagnosticObserver, event: PlaybackDiagnosticEvent) {
  try { observer(event) } catch { /* diagnostic consumers cannot affect loading */ }
}

type PlaybackReadiness = 'idle' | 'loading' | 'ready' | 'error'

export interface WorkspacePlayback {
  scenePlayback: AgentPlaybackFacet | null
  sceneError: unknown
  sceneState: PlaybackReadiness
  canonical: LocalPlayback | null
  canonicalError: unknown
  canonicalState: PlaybackReadiness
  replayDigest: string | null
}

export function useReplayWorkspace(initialCapability: ReplayCapability = 'data') {
  const replay = useReplay(initialCapability)
  const { session } = replay
  const entries = new WeakMap<File, {
    state: WorkspacePlayback
    scenePromise?: Promise<AgentPlaybackFacet>
    canonicalPromise?: Promise<LocalPlayback | null>
    controller: AbortController | null
    canonicalGeneration: number
    observers?: Set<PlaybackDiagnosticObserver>
  }>()
  type Entry = NonNullable<ReturnType<typeof entries.get>>
  const pending = new Set<Entry>()
  function entryFor(file: File): Entry {
    let entry = entries.get(file)
    if (!entry) {
      entry = { state: shallowReactive<WorkspacePlayback>({
        scenePlayback: null, sceneError: null, sceneState: 'idle',
        canonical: null, canonicalError: null, canonicalState: 'idle', replayDigest: null,
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
    entry.canonicalGeneration++
    entry.canonicalPromise = undefined
    entry.state.canonical = null
    entry.state.canonicalError = null
    entry.state.canonicalState = 'idle'
    releasePending(entry)
  }
  function cancelPending() {
    for (const entry of pending) {
      entry.controller?.abort()
      entry.controller = null
      entry.observers = undefined
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
      entry.observers = undefined
      entry.scenePromise = undefined
      entry.state.scenePlayback = null
      entry.state.sceneError = null
      entry.state.sceneState = 'idle'
      entry.state.replayDigest = null
      invalidateCanonical(file)
    },
    loadScene(file: File, observer?: PlaybackDiagnosticObserver): Promise<AgentPlaybackFacet> {
      const entry = entryFor(file)
      if (entry.scenePromise) {
        if (observer) {
          emitPlaybackDiagnostic(observer, { stage: 'workspace.cache', status: entry.state.sceneState === 'ready' ? 'hit' : 'shared-inflight' })
          if (entry.state.sceneState === 'ready') {
            for (const stage of [
              'file.arrayBuffer', 'replay.digest', 'json.cache',
              'first.worker.roundtrip', 'first.wasm.ready', 'first.parse', 'first.json.parse', 'first.worker.unattributed',
              'pitchLimits.wait', 'second.worker.roundtrip', 'second.wasm.ready',
              'second.parse', 'second.worker.unattributed', 'json.parse', 'validation', 'enrichment',
            ]) emitPlaybackDiagnostic(observer, { stage, status: 'skipped' })
          }
          if (entry.state.sceneState === 'loading') {
            if (!entry.observers) emitPlaybackDiagnostic(observer, { stage: 'workspace.inflightTiming', status: 'unavailable' })
            else entry.observers.add(observer)
          }
          if (entry.state.sceneState === 'ready' && entry.state.replayDigest) {
            emitPlaybackDiagnostic(observer, { stage: 'replay.identity', digest: entry.state.replayDigest })
          }
        }
        if (entry.state.sceneState === 'ready' && entry.state.canonicalState === 'idle') {
          void playbackSession.loadCanonical(file).catch(() => {})
        }
        return entry.scenePromise
      }
      if (observer) {
        emitPlaybackDiagnostic(observer, { stage: 'workspace.cache', status: 'miss' })
        ;(entry.observers ??= new Set()).add(observer)
      }
      const controller = new AbortController()
      entry.controller = controller
      entry.state.sceneState = 'loading'
      pending.add(entry)
      const task = (async () => {
        const { loadFromLocalFile } = await import('../scene/replaySource.js')
        const playback = await loadFromLocalFile(file, controller.signal, observer ? event => {
          if (entry.controller === controller && !controller.signal.aborted) {
            for (const current of entry.observers ?? []) emitPlaybackDiagnostic(current, event)
          }
        } : undefined, digest => { entry.state.replayDigest = digest })
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
      }).finally(() => {
        if (entry.controller === controller) entry.observers = undefined
        releasePending(entry)
      })
      entry.scenePromise = task
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
        const playback = entry.state.scenePlayback ?? undefined
        const { parseLocalPlaybackOffThread } = await import('../replay-local/canonicalRuntime.js')
        if (!current()) throw new DOMException('Canonical projection withdrawn', 'AbortError')
        const canonical = await parseLocalPlaybackOffThread(await file.arrayBuffer(), playback)
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
