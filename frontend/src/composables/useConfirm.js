import { readonly, ref } from 'vue'

const request = ref(null)

/** @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean, signal?: AbortSignal | null }} [options] */
export function confirm({ title, message = '', confirmLabel = '', cancelLabel = '', danger = false, signal = null } = {}) {
  if (signal?.aborted) return Promise.resolve(false)
  if (request.value) request.value.resolve(false)
  return new Promise((resolve) => {
    const finish = value => { signal?.removeEventListener('abort', abort); resolve(value) }
    const abort = () => {
      if (request.value?.resolve === finish) request.value = null
      finish(false)
    }
    request.value = { title, message, confirmLabel, cancelLabel, danger, resolve: finish }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function useConfirmHost() {
  function settle(result) {
    const current = request.value
    request.value = null
    current?.resolve(result)
  }
  return { request: readonly(request), settle }
}

export function useConfirm() {
  return { confirm }
}
