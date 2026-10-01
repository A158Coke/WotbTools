import { readonly, ref } from 'vue'

/**
 * 桌面侧边栏的折叠偏好（design-language §9）：展开（图标 + 文字）或折叠成图标栏。
 * 只在桌面档（≥1200）生效；平板档固定为图标栏。偏好按浏览器保存在 localStorage，
 * 并写到 <html data-sidebar>，由 tokens/scale.css 据此派生 --sidebar-w（布局只读这一个值）。
 */
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
