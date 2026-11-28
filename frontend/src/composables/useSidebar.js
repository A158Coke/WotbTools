import { readonly, ref } from 'vue'

const STORAGE_KEY = 'wotb-sidebar'
const MOTION_ATTR = 'data-sidebar-motion'
const collapsed = ref(readStored())
let motionTimer = null

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

function clearMotion() {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute(MOTION_ATTR)
  if (motionTimer !== null) {
    clearTimeout(motionTimer)
    motionTimer = null
  }
}

function motionDurationMs() {
  if (typeof window === 'undefined') return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--duration-base').trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return 0
  return raw.endsWith('ms') ? value : value * 1000
}

function toggle() {
  const next = !collapsed.value
  if (typeof document === 'undefined') {
    setCollapsed(next)
    return
  }
  const root = document.documentElement
  root.setAttribute(MOTION_ATTR, '')
  // 读一次 token 触发样式重算，确保过渡在 data-sidebar 变化前已经挂上。
  const duration = motionDurationMs()
  setCollapsed(next)
  if (motionTimer !== null) clearTimeout(motionTimer)
  motionTimer = setTimeout(clearMotion, duration + 40)
}

apply()

export function useSidebar() {
  return {
    collapsed: readonly(collapsed),
    setCollapsed,
    toggle,
  }
}
