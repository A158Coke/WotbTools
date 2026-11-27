import { ref } from 'vue'

const error = ref('')
const showError = ref(false)

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
