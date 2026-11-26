import { nextTick } from 'vue'
import type { Ref } from 'vue'

type WorkspaceFileContext = {
  workspace: { replay: {
    files: Ref<File[]>
    resp: Ref<unknown | null>
    updateFiles: (files: File[]) => void
    changeFiles: (files: File[]) => Promise<void>
    askRemoveFile: (file: File) => void
  } }
  analyze: () => Promise<void>
  cancelAnalysis: () => void
  sourcePicker: Ref<{ chooseFiles: () => void; addDropped: (files: FileList) => void } | null>
}

/**
 * @param {{
 *  workspace: { replay: { files: Ref, resp: Ref, updateFiles(files): void, changeFiles(files): Promise,
 *    askRemoveFile(file): void } },
 *  analyze: () => Promise,
 *  cancelAnalysis: () => void,
 *  sourcePicker: Ref<{ chooseFiles(): void, addDropped(files: FileList): void } | null>,
 * }} ctx
 */
export function useWorkspaceFileSelection({ workspace, analyze, cancelAnalysis, sourcePicker }: WorkspaceFileContext) {
  const { files, resp, updateFiles, changeFiles } = workspace.replay

  function clearSelection() {
    updateFiles([])
  }

  function onFilesUpdate(next: File[]) {
    if (!next.length) {
      clearSelection()
    } else if (files.value.length) {
      void changeFiles(next)
    } else {
      updateFiles(next)
      void analyze()
    }
  }

  function onCancelLoading() {
    cancelAnalysis()
    clearSelection()
  }

  async function onRemoveFile(file: File) {
    if (resp.value) {
      await nextTick()
      workspace.replay.askRemoveFile(file)
      return
    }
    onFilesUpdate(files.value.filter(item => item !== file))
  }

  async function openOtherReplay() {
    clearSelection()
    await nextTick()
    sourcePicker.value?.chooseFiles()
  }

  function onWorkspaceDrop(event: DragEvent) {
    const droppedFiles = event.dataTransfer?.files
    if (droppedFiles) sourcePicker.value?.addDropped(droppedFiles)
  }

  return { clearSelection, onFilesUpdate, onCancelLoading, onRemoveFile, openOtherReplay, onWorkspaceDrop }
}
