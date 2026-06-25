import { ref, onMounted, onUnmounted } from 'vue'
import { readTheme, saveTheme, applyTheme } from '../utils/theme.js'

export function useTheme() {
  const theme = ref(readTheme() || 'auto')
  const mql = window.matchMedia('(prefers-color-scheme: dark)')

  function handleTheme(t) {
    theme.value = t
    saveTheme(t)
    applyTheme(t)
  }

  function onSystemChange() {
    if (theme.value === 'auto') handleTheme('auto')
  }

  mql.addEventListener('change', onSystemChange)

  // 初始化 : 已有 cookie/localStorage + no-flash 保护(index.html head 脚本),这里只同步 Vue 状态
  applyTheme(theme.value)

  onUnmounted(() => mql.removeEventListener('change', onSystemChange))

  return { theme, handleTheme }
}
