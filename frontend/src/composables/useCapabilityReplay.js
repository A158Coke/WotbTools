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
 * 目标文件与 identity 由 Workspace 的单一 reconcile 驱动（见 ReplayWorkspace.vue），
 * 本 composable 不做隐式 files watcher。identity = `${fileKey(file)}|${selectionRevision}`，
 * 同一 identity + 已 resolve 的 datasetRef → 幂等 no-op；identity 变化 / 未 resolve → (re)prepare；
 * 任何一次 `reset()`（仅 capability 自身）会作废在途 prepare（token guard），但不会清除 replay 核心状态。
 */
export function useCapabilityReplay(replay) {
  const { t, te } = useI18n()
  const { requestDirectAction } = replay

  const targetFile = ref(null)
  const datasetRef = ref(null)
  const datasetError = ref('')
  /** 在途 prepare 的认领 token：每次 (re)prepare / reset 自增，旧请求 resolve/reject 前校验，纯丢弃。 */
  let prepareToken = 0
  /** 已绑定的 identity：`${fileKey(file)}|${selectionRevision}`；null = 未绑定。 */
  let boundIdentity = null
  /** 当前 boundIdentity 是否有在途 requestDirectAction（防止同一 identity 重复 prepare / READY 后再触发）。 */
  let inFlight = false

  function reset() {
    prepareToken++
    inFlight = false
    boundIdentity = null
    targetFile.value = null
    datasetRef.value = null
    datasetError.value = ''
  }

  /**
   * 真正准备：绑定 file、清空旧结果、用 token 认领一次 requestDirectAction。
   * stale/abort/迟到 response 一律 pure discard（token + fileKey 双守卫）。
   */
  function prepare(file) {
    const fileKeyNow = fileKey(file)
    targetFile.value = file
    datasetRef.value = null
    datasetError.value = ''
    const token = ++prepareToken
    inFlight = true
    requestDirectAction(file).then((refValue) => {
      inFlight = false
      if (token !== prepareToken || !targetFile.value || fileKey(targetFile.value) !== fileKeyNow) return
      datasetRef.value = refValue
      datasetError.value = ''
    }).catch((e) => {
      inFlight = false
      if (token !== prepareToken || !targetFile.value || fileKey(targetFile.value) !== fileKeyNow) return
      datasetError.value = apiErrorLabel(t, te, e)
      datasetRef.value = null
    })
  }

  /**
   * Workspace 单一 reconcile 入口（幂等 + token-guarded）。
   * @param {{file: object|null, selectionRevision: number, active?: boolean}} spec
   *   active=false（非演出中的 capability）→ 保持不动（交由各自 capability 切换时再 reconcile）。
   */
  function reconcile({ file, selectionRevision, active = true }) {
    // 非活跃 capability：不主动 prepare，也不清除（切换时再 reconcile）。
    if (!active) return
    if (!file) {
      reset()
      return
    }
    const identity = `${fileKey(file)}|${selectionRevision}`
    if (boundIdentity === identity) {
      // 幂等：已 resolve → no-op；在途 → 让它完成（不重复请求）；失败（datasetError）→ 保持，交由 recover 重试。
      if (datasetRef.value || inFlight) return
      return
    }
    boundIdentity = identity
    prepare(file)
  }

  /** 为指定文件准备 Dataset 引用（back-compat；用于无 selectionRevision 上下文的直接调用）。 */
  function prepareForFile(file, { force = false } = {}) {
    if (!file) {
      reset()
      return
    }
    const identity = `${fileKey(file)}|0`
    if (!force && boundIdentity === identity && datasetRef.value) return
    boundIdentity = identity
    prepare(file)
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
    // 强制重建：即使 datasetRef 已 resolve（过期）也重新请求；保留当前 identity 以便 stale-guard。
    prepare(file)
  }

  /** 多文件未显式选择时的本地化提示（由 Workspace 判断后调用）。 */
  function setLimitError() {
    prepareToken++ // 作废任何在途 prepare，阻止迟到响应写回
    inFlight = false
    boundIdentity = null
    datasetError.value = t('workspace.single_replay_required')
    targetFile.value = null
    datasetRef.value = null
  }

  return {
    targetFile,
    datasetRef,
    datasetError,
    prepareForFile,
    reconcile,
    recover,
    reset,
    setLimitError,
  }
}
