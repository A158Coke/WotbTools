import { ref } from 'vue'

const error = ref('')
const showError = ref(false)

/** 全局错误弹窗。任何组件均可调用 showError(msg) 展示。 */
export function useError() {
  function show(msg) {
    error.value = msg
    showError.value = true
  }

  function close() {
    showError.value = false
    error.value = ''
  }

  return { error, showError, show, close }
}
