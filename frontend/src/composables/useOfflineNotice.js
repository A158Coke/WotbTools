import { ref } from 'vue'

/**
 * 离线提示的唯一状态源（**唯一**渲染出口是 `app/OfflineNoticeDialog.vue`）。
 *
 * 离线不是错误状态（计划 §0）：因此这里刻意与 `useError`（danger tone 的全局错误弹窗）分开，
 * 走同一套 AppDialog 设计体系但不带危险语义。三个联网功能共用这一个提示面，
 * 不允许每个功能自己写一份 toast / modal。
 */
const noticeKey = ref('')
const visible = ref(false)

/** 展示离线提示；`messageKey` 来自 capability 模型（例如 `featureOffline.aiReview`）。 */
export function showOfflineNotice(messageKey) {
  if (typeof messageKey !== 'string' || !messageKey) return
  noticeKey.value = messageKey
  visible.value = true
}

export function closeOfflineNotice() {
  visible.value = false
  noticeKey.value = ''
}

export function useOfflineNotice() {
  return {
    noticeKey,
    visible,
    show: showOfflineNotice,
    close: closeOfflineNotice,
  }
}
