import { computed, ref } from 'vue'
import { dismissToast, showToast } from './useToast.js'

type ConnectivityNotice = { titleKey: string | null; messageKey: string | null; hintKey: string | null }

const notice = ref<ConnectivityNotice | null>(null)
const TOAST_ID = 'connectivity'

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
