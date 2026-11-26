// 整页重载后的回放恢复：把 replayReloadCache 暂存的当前回放重新放回工作台并重新解析。
//
// 只发生在「渲染设置重载」的一次性标记存在时；普通进入工作台不触碰 IndexedDB。
// 恢复的是回放**输入**，不是播放进度/镜头/选车状态（重载后仍从头开始）。
import { onMounted } from 'vue'
import type { Ref } from 'vue'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { takeReloadReplay } from '../replay-local/replayReloadCache.js'

export interface ReplayReloadRestoreDeps {
  files: Ref<readonly File[]>
  updateFiles: (files: File[]) => void
  updateDemoFile: (file: File) => void
  analyze: () => Promise<unknown>
  /** 恢复解析成功后通知工作台：本次自动开始不受日常自动播放偏好限制。 */
  onRestored?: (file: File) => void
  onError: (error: unknown) => void
}

/**
 * @returns 是否恢复了一份回放（false = 没有待恢复标记 / 已有选择 / 恢复失败）。
 */
export async function restoreStagedReplay(deps: ReplayReloadRestoreDeps): Promise<boolean> {
  if (deps.files.value.length) return false   // 用户已在本次页面重新选了文件：不覆盖
  let staged
  try {
    staged = await takeReloadReplay()
  } catch (error) {
    deps.onError(error)
    return false
  }
  if (!staged) return false
  try {
    let file: File
    if (staged.kind === 'demo') {
      file = await loadOfficialDemo()
      deps.updateDemoFile(file)
    } else {
      file = staged.file
      deps.updateFiles([file])
    }
    const result = (await deps.analyze()) as { completed?: boolean } | null | undefined
    if (result?.completed !== false) deps.onRestored?.(file)
    return true
  } catch (error) {
    deps.onError(error)
    return false
  }
}

/** 工作台挂载时消费一次待恢复回放（唯一调用点，避免多个页面重复恢复）。 */
export function useReplayReloadRestore(deps: ReplayReloadRestoreDeps): void {
  onMounted(() => { void restoreStagedReplay(deps) })
}