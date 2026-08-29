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
  const { files, requestDirectAction } = replay

  const targetFile = ref(null)
  const datasetRef = ref(null)
  const datasetError = ref('')
  let prepareRevision = 0

  function validRef(value) {
    return !!value
      && typeof value.processingJobId === 'string' && value.processingJobId.trim() !== ''
      && typeof value.sourceId === 'string' && /^r\d+$/.test(value.sourceId)
  }

  function reset() {
    prepareRevision++
    targetFile.value = null
    datasetRef.value = null
    datasetError.value = ''
  }

  /** 为指定文件准备 Dataset 引用。同一文件重复调用是 no-op（requestDirectAction 内部已单飞）。 */
  function prepareForFile(file) {
    datasetRef.value = null
    datasetError.value = ''
    if (!file) {
      targetFile.value = null
      return
    }
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
    prepareForFile(file)
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
