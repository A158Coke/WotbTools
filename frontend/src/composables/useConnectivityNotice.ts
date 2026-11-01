import { computed, ref } from 'vue'

/**
 * 连通性提示的唯一状态源（**唯一**渲染出口是 `app/ConnectivityNoticeDialog.vue`）。
 *
 * 为什么不再叫「offline notice」（review P1）：同一个提示面现在要表达四种**语义不同**的状态 ——
 * 用户确实离线（`offline`）、无法确认连接状态（`unknown`）、连接不稳定（`degraded`）、
 * 在线服务暂不可用（`service-unavailable`）。它们共用一套 UI，但文案必须来自 capability 模型
 * 给出的 title/body/hint key，绝不允许把后三种说成「你现在离线」。
 *
 * 离线不是错误状态（计划 §0），因此这里刻意与 `useError`（danger tone 的全局错误弹窗）分开：
 * 走同一套 AppDialog 设计体系，但不带危险语义，也不允许各功能自己写 toast / modal。
 */
const notice = ref(null)

/** 展示提示；入参是 `getFeatureAvailability()` 的结果（无 messageKey 时静默忽略）。 */
export function showConnectivityNotice(availability) {
  if (!availability?.messageKey) return
  notice.value = {
    titleKey: availability.titleKey,
    messageKey: availability.messageKey,
    hintKey: availability.hintKey,
  }
}

export function closeConnectivityNotice() {
  notice.value = null
}

export function useConnectivityNotice() {
  return {
    notice,
    visible: computed(() => notice.value !== null),
    show: showConnectivityNotice,
    close: closeConnectivityNotice,
  }
}
