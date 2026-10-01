import { readonly, ref } from 'vue'

/**
 * 应用内确认对话框（审计 PG-09：取代 window.confirm——WebView 里样式简陋且显示域名）。
 * 全应用一个实例：AppShell 挂载 ConfirmDialogHost，业务代码 `if (!(await confirm({...}))) return`。
 * 同一时刻只有一个确认请求；新的请求会把旧请求按「取消」结束。
 */
const request = ref(null) // { title, message, confirmLabel, cancelLabel, danger, resolve }

export function confirm({ title, message = '', confirmLabel = '', cancelLabel = '', danger = false } = {}) {
  if (request.value) request.value.resolve(false)
  return new Promise((resolve) => {
    request.value = { title, message, confirmLabel, cancelLabel, danger, resolve }
  })
}

/** 宿主组件用：读取当前请求并给出结果。 */
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
