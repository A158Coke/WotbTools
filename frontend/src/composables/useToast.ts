import { ref } from 'vue'
import { haptic } from './useHaptics.js'
import type { HapticKind } from './useHaptics.js'
import { playSound } from './useSound.js'
import type { SoundKind } from './useSound.js'

/**
 * 全站 toast（design-language §10「反馈」）的唯一状态源，渲染出口是 `app/AppToast.vue`。
 * - success / info：4 秒后消失，悬停或按住时暂停计时；
 * - warning / error：不自动消失，必须由用户关闭或执行下一步；
 * - 同一 `id` 只保留一条（替换内容）；最多同时 3 条，超出时最早的一条让位。
 * 文案可以是已翻译的字符串，也可以是 i18n key（store 不依赖组件实例）。
 */
export type ToastTone = 'success' | 'info' | 'warning' | 'error'
export interface ToastAction { label?: string, labelKey?: string, run: () => void }
export interface ToastInput {
  id?: string
  tone: ToastTone
  title?: string
  titleKey?: string
  message?: string
  messageKey?: string
  hintKey?: string
  action?: ToastAction
  onDismiss?: () => void
}
export interface Toast extends ToastInput { id: string, persistent: boolean }

export const TOAST_DURATION_MS = 4000
export const TOAST_LIMIT = 3
const FEEDBACK: Record<ToastTone, { haptic: HapticKind | null, sound: SoundKind }> = {
  success: { haptic: 'success', sound: 'success' },
  info: { haptic: null, sound: 'notice' },
  warning: { haptic: null, sound: 'notice' },
  error: { haptic: 'error', sound: 'error' },
}

export const toasts = ref<Toast[]>([])
const timers = new Map<string, { handle: ReturnType<typeof setTimeout> | null, remaining: number, startedAt: number }>()
let seq = 0

function startTimer(id: string, remaining: number) {
  const timer = { remaining, startedAt: Date.now(), handle: setTimeout(() => dismissToast(id), remaining) }
  timers.set(id, timer)
}

export function showToast(input: ToastInput): string {
  const id = input.id ?? `toast-${++seq}`
  const persistent = input.tone === 'warning' || input.tone === 'error'
  const existing = toasts.value.findIndex(toast => toast.id === id)
  const toast: Toast = { ...input, id, persistent }
  if (existing >= 0) {
    clearTimeout(timers.get(id)?.handle ?? undefined)
    toasts.value = toasts.value.map((item, index) => (index === existing ? toast : item))
  } else {
    const next = [...toasts.value, toast]
    while (next.length > TOAST_LIMIT) {
      const dropped = next.shift()
      if (dropped) { clearTimeout(timers.get(dropped.id)?.handle ?? undefined); timers.delete(dropped.id); dropped.onDismiss?.() }
    }
    toasts.value = next
  }
  if (!persistent) startTimer(id, TOAST_DURATION_MS)
  const feedback = FEEDBACK[input.tone]
  if (feedback.haptic) void haptic(feedback.haptic)
  playSound(feedback.sound)
  return id
}

export function dismissToast(id: string) {
  const toast = toasts.value.find(item => item.id === id)
  clearTimeout(timers.get(id)?.handle ?? undefined)
  timers.delete(id)
  if (!toast) return
  toasts.value = toasts.value.filter(item => item.id !== id)
  toast.onDismiss?.()
}

/** 悬停 / 按住：暂停自动消失；离开时按剩余时间继续。 */
export function pauseToast(id: string) {
  const timer = timers.get(id)
  if (!timer?.handle) return
  clearTimeout(timer.handle)
  timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt))
  timer.handle = null
}

export function resumeToast(id: string) {
  const timer = timers.get(id)
  if (!timer || timer.handle) return
  startTimer(id, timer.remaining)
}

export function useToast() {
  return {
    toasts,
    show: showToast,
    dismiss: dismissToast,
    success: (title: string, message?: string) => showToast({ tone: 'success', title, message }),
    info: (title: string, message?: string) => showToast({ tone: 'info', title, message }),
    error: (title: string, message?: string, action?: ToastAction) => showToast({ tone: 'error', title, message, action }),
  }
}

export function __resetToastsForTest() {
  for (const timer of timers.values()) clearTimeout(timer.handle ?? undefined)
  timers.clear()
  toasts.value = []
}
