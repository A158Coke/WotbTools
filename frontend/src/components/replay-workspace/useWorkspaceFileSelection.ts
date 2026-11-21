/**
 * ReplayWorkspace —— 文件选择 / 移除 / 装载取消的处理链（拆分自 ReplayWorkspace.vue，行为原样）。
 */
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

  /** 选择即加载：这里是普通选择的唯一入口，Demo 与 Android 各自负责自己的那一次加载。 */
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

  /** 没有手动解析入口后，「已取消」无处可去：取消就是不打开这批回放。 */
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
