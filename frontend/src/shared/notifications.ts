import type { InjectionKey } from 'vue'

export type OpenNotificationsPanel = (opener?: HTMLElement | null) => void
export const NOTIFICATIONS_PANEL_KEY: InjectionKey<OpenNotificationsPanel> = Symbol('wotbtools.notifications-panel')
