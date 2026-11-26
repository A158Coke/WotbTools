import { readonly, ref } from 'vue'

const STORAGE_KEY = 'wotb-sidebar'
const collapsed = ref(readStored())

function readStored() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-sidebar', collapsed.value ? 'collapsed' : 'expanded')
}

function setCollapsed(value) {
  collapsed.value = Boolean(value)
  try {
    localStorage.setItem(STORAGE_KEY, collapsed.value ? 'collapsed' : 'expanded')
  } catch {
    // 隐私模式等存储不可用：只影响记忆，不影响当前会话
  }
  apply()
}

apply()

export function useSidebar() {
  return {
    collapsed: readonly(collapsed),
    setCollapsed,
    toggle: () => setCollapsed(!collapsed.value),
  }
}
