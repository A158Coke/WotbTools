import { computed, ref } from 'vue'

const NOTIFICATIONS_STORAGE_KEY = 'wotb-notifications'
export const NOTIFICATION_LIMIT = 20
export type NotificationKind = 'replay-parsed' | 'ai-review' | 'app-update' | 'submission'
export interface AppNotification {
  id: string
  kind: NotificationKind
  titleKey: string
  bodyKey?: string
  params?: Record<string, string | number>
  view?: string
  at: number
  read: boolean
}

function valid(item: unknown): item is AppNotification {
  if (!item || typeof item !== 'object') return false
  const n = item as Record<string, unknown>
  return typeof n.id === 'string' && typeof n.kind === 'string' && typeof n.titleKey === 'string'
    && typeof n.at === 'number' && typeof n.read === 'boolean'
}

function read(): AppNotification[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(valid).slice(0, NOTIFICATION_LIMIT) : []
  } catch {
    return []
  }
}

export const notifications = ref<AppNotification[]>(typeof window === 'undefined' ? [] : read())
export const unreadCount = computed(() => notifications.value.filter(item => !item.read).length)

function persist() {
  try {
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications.value))
  } catch {
    // 隐私模式 / 配额：保持内存态
  }
}

let seq = 0
export function notify(input: Omit<AppNotification, 'id' | 'at' | 'read'> & { id?: string }) {
  const id = input.id ?? `${input.kind}-${Date.now()}-${++seq}`
  const item: AppNotification = { ...input, id, at: Date.now(), read: false }
  notifications.value = [item, ...notifications.value.filter(n => n.id !== id)].slice(0, NOTIFICATION_LIMIT)
  persist()
  return id
}

export function markAllRead() {
  if (!unreadCount.value) return
  notifications.value = notifications.value.map(item => ({ ...item, read: true }))
  persist()
}

export function markRead(id: string) {
  notifications.value = notifications.value.map(item => (item.id === id ? { ...item, read: true } : item))
  persist()
}

export function __reloadNotificationsForTest() {
  notifications.value = read()
}
