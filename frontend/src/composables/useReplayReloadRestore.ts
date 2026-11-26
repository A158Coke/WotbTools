import { onMounted } from 'vue'
import type { Ref } from 'vue'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { takeReloadReplay } from '../replay-local/replayReloadCache.js'
import type { StagedReload } from '../replay-local/replayReloadCache.js'

export interface ReplayReloadRestoreDeps {
  files: Ref<readonly File[]>
  selectionRevision: Ref<number>
  updateFiles: (files: File[]) => void
  updateDemoFile: (file: File) => void
  selectBattleIndex: (index: number) => void
  analyze: () => Promise<unknown>
  onRestoring?: (file: File, reloadId: string, contactShadows: boolean) => void
  onRestored?: (file: File, reloadId: string) => void
  onError: (error: unknown) => void
}

function selectionChanged(deps: ReplayReloadRestoreDeps, revision: number): boolean {
  return deps.files.value.length > 0 || deps.selectionRevision.value !== revision
}

export async function restoreStagedReplay(deps: ReplayReloadRestoreDeps): Promise<boolean> {
  if (deps.files.value.length) return false
  const revision = deps.selectionRevision.value
  let staged: StagedReload | null
  try {
    staged = await takeReloadReplay()
  } catch (error) {
    deps.onError(error)
    return false
  }
  if (!staged || selectionChanged(deps, revision)) return false
  try {
    let file: File
    const contactShadows = staged.replay.contactShadows === true
    if (staged.replay.kind === 'demo') {
      file = await loadOfficialDemo()
      if (selectionChanged(deps, revision)) return false
      deps.updateDemoFile(file)
    } else {
      const { files, currentIndex } = staged.replay
      file = files[currentIndex]
      deps.updateFiles(files)
      deps.selectBattleIndex(currentIndex)
    }
    deps.onRestoring?.(file, staged.id, contactShadows)
    const result = (await deps.analyze()) as { completed?: boolean } | null | undefined
    if (result?.completed !== false) deps.onRestored?.(file, staged.id)
    return true
  } catch (error) {
    deps.onError(error)
    return false
  }
}

export function useReplayReloadRestore(deps: ReplayReloadRestoreDeps): void {
  onMounted(() => { void restoreStagedReplay(deps) })
}
