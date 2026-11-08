import { computed, ref } from 'vue'
import { dismissToast, showToast } from './useToast.js'

/**
 * 连通性提示的唯一状态源（渲染出口是全站 toast：`app/AppToast.vue`，固定 id `connectivity`）。
 *
 * 为什么不再叫「offline notice」（review P1）：同一个提示面现在要表达四种**语义不同**的状态 ——
 * 用户确实离线（`offline`）、无法确认连接状态（`unknown`）、连接不稳定（`degraded`）、
 * 在线服务暂不可用（`service-unavailable`）。它们共用一套 UI，但文案必须来自 capability 模型
 * 给出的 title/body/hint key，绝不允许把后三种说成「你现在离线」。
 *
 * 离线不是错误状态，因此这里刻意与 `useError`（danger tone 的全局错误弹窗）分开：
 * 用 warning 语气的 toast（不自动消失、可关闭），不带危险语义，也不允许各功能自己写 toast / modal。
 */
type ConnectivityNotice = { titleKey: string | null; messageKey: string | null; hintKey: string | null }

const notice = ref<ConnectivityNotice | null>(null)
const TOAST_ID = 'connectivity'

/** 展示提示；入参是 `getFeatureAvailability()` 的结果（无 messageKey 时静默忽略）。 */
export function showConnectivityNotice(availability: ConnectivityNotice | null | undefined) {
  if (!availability?.messageKey) return
  notice.value = {
    titleKey: availability.titleKey,
    messageKey: availability.messageKey,
    hintKey: availability.hintKey,
  }
  showToast({
    id: TOAST_ID,
    tone: 'warning',
    titleKey: availability.titleKey ?? undefined,
    messageKey: availability.messageKey,
    hintKey: availability.hintKey ?? undefined,
    onDismiss: () => { notice.value = null },
  })
}

function closeConnectivityNotice() {
  notice.value = null
  dismissToast(TOAST_ID)
}

export function useConnectivityNotice() {
  return {
    notice,
    visible: computed(() => notice.value !== null),
    show: showConnectivityNotice,
    close: closeConnectivityNotice,
  }
}
