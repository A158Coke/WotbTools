import type { InjectionKey } from 'vue'

/** 产品目的地：`view` 字符串，或带 query 的完整目的地（如装甲查看器 `?view=agent-armor&tank=…`）。 */
export type NavigationTarget =
  | string
  | { query: Record<string, string> }

/**
 * Feature-neutral application navigation command. Vue Router remains the single browser-history
 * owner; features request a product destination without importing app/router internals.
 */
export type NavigateView = (target: NavigationTarget) => void

export const NAVIGATE_VIEW_KEY: InjectionKey<NavigateView> = Symbol('wotbtools.navigate-view')
