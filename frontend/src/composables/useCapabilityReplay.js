import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiErrorLabel } from '../utils/display.js'
import { fileKey } from '../utils/helpers.js'

/**
 * Capability（AI 复盘 / 战局回放）的 Dataset 准备逻辑，作为 Workspace 单一事实源共享。
 *
 * 与 useReplay 分离：useReplay 只负责基础 selection / Processing Job；
 * 本 composable 消费某个目标文件，在需要时使用 requestDirectAction 确保 Dataset 引用
 * （processingJobId + sourceId）就绪——绝不重传 / 重 parse。
 *
 * 每个 capability（ai / playback）各持有一份，保证 AI 失败不污染 Playback、反之亦然。
 * 目标文件由 Workspace 的「active replay」显式传入（单文件 = 该文件；多文件 = 显式选择），
 * 不做隐式 files watcher——避免两个 capability 在数据 tab 也被自动 prepare。
 */
export function useCapabilityReplay(replay) {
  const { t, te } = useI18n()
  const { requestDirectAction } = replay

  const targetFile = ref(null)
  const datasetRef = ref(null)
  const datasetError = ref('')
  let prepareRevision = 0

  function reset() {
    prepareRevision++
    targetFile.value = null
    datasetRef.value = null
    datasetError.value = ''
  }

  /**
   * 为指定文件准备 Dataset 引用。同一文件重复调用是 no-op（requestDirectAction 内部已单飞）。
   * @param {object} file 目标文件
   * @param {{force?: boolean}} opts force=true 强制重新准备（dataset 过期/缺失时恢复用，跳过幂等守卫）。
   */
  function prepareForFile(file, { force = false } = {}) {
    if (!file) {
      targetFile.value = null
      datasetRef.value = null
      datasetError.value = ''
      return
    }
    // 幂等（plan §9.1）：同一目标文件（按 fileKey 稳定比较，Vue ref 对对象赋值为 reactive Proxy，
    // 不能用 ===）、已有 dataset 引用 → 不复位、不重复请求、不闪断。
    if (!force && targetFile.value && datasetRef.value && fileKey(targetFile.value) === fileKey(file)) return
    datasetRef.value = null
    datasetError.value = ''
    targetFile.value = file
    const revision = ++prepareRevision
    requestDirectAction(file).then((refValue) => {
      if (revision !== prepareRevision || !targetFile.value || fileKey(targetFile.value) !== fileKey(file)) return
      datasetRef.value = refValue
      datasetError.value = ''
    }).catch((e) => {
      if (revision !== prepareRevision || !targetFile.value || fileKey(targetFile.value) !== fileKey(file)) return
      datasetError.value = apiErrorLabel(t, te, e)
      datasetRef.value = null
    })
  }

  /**
   * Dataset 引用过期 / 缺失时由面板触发重建（只对当前 file 重试一次；失败保持可恢复错误）。
   */
  function recover() {
    const file = targetFile.value
    if (!file) {
      datasetError.value = t('workspace.dataset_prepare_failed')
      return
    }
    prepareForFile(file, { force: true })
  }

  /** 多文件未显式选择时的本地化提示（由 Workspace 判断后调用）。 */
  function setLimitError() {
    datasetError.value = t('workspace.single_replay_required')
    targetFile.value = null
    datasetRef.value = null
  }

  return {
    targetFile,
    datasetRef,
    datasetError,
    prepareForFile,
    recover,
    reset,
    setLimitError,
  }
}
