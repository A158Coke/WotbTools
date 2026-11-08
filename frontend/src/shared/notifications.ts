import type { InjectionKey } from 'vue'

/** 打开本机通知中心面板（AppShell 拥有面板；顶栏铃铛与侧边栏入口通过它打开）。参数是关闭后焦点要回到的元素。 */
export type OpenNotificationsPanel = (opener?: HTMLElement | null) => void
export const NOTIFICATIONS_PANEL_KEY: InjectionKey<OpenNotificationsPanel> = Symbol('wotbtools.notifications-panel')
