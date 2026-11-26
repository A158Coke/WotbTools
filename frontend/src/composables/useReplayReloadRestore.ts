// 整页重载后的回放恢复：把 replayReloadCache 暂存的完整回放选择重新放回工作台并重新解析。
//
// 只发生在「渲染设置重载」的一次性 id 存在时；普通进入工作台不触碰 IndexedDB。
// 恢复的是回放**输入**（完整批次 + 当前场次），不是播放进度/镜头/选车状态（重载后仍从头开始）。
import { onMounted } from 'vue'
import type { Ref } from 'vue'
import { loadOfficialDemo } from '../replay-local/demo.js'
import { takeReloadReplay } from '../replay-local/replayReloadCache.js'
import type { StagedReload } from '../replay-local/replayReloadCache.js'

export interface ReplayReloadRestoreDeps {
  files: Ref<readonly File[]>
  /** 选择代次：等待 IndexedDB / demo 下载期间用户重新选择时，恢复必须作废。 */
  selectionRevision: Ref<number>
  updateFiles: (files: File[]) => void
  updateDemoFile: (file: File) => void
  /** 批次恢复后先指向原场次，再统一解析（不依赖 parsedBattles 的先后）。 */
  selectBattleIndex: (index: number) => void
  analyze: () => Promise<unknown>
  onRestoring?: (file: File, reloadId: string, contactShadows: boolean) => void
  /** 恢复解析成功后通知工作台这次自动重播请求绑定哪个 File。 */
  onRestored?: (file: File, reloadId: string) => void
  onError: (error: unknown) => void
}

/** 等待异步存储期间用户是否已经建立自己的选择；是则放弃恢复，绝不覆盖。 */
function selectionChanged(deps: ReplayReloadRestoreDeps, revision: number): boolean {
  return deps.files.value.length > 0 || deps.selectionRevision.value !== revision
}

/**
 * @returns 是否恢复了一份回放（false = 没有待恢复 id / 用户已重新选择 / 恢复失败）。
 */
export async function restoreStagedReplay(deps: ReplayReloadRestoreDeps): Promise<boolean> {
  if (deps.files.value.length) return false   // 用户已在本次页面重新选了文件：不覆盖
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

/** 工作台挂载时消费一次待恢复回放（唯一调用点，避免多个页面重复恢复）。 */
export function useReplayReloadRestore(deps: ReplayReloadRestoreDeps): void {
  onMounted(() => { void restoreStagedReplay(deps) })
}
