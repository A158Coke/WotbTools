import type { InjectionKey } from 'vue'

export type NavigationTarget =
  | string
  | { query: Record<string, string> }

export type NavigateView = (target: NavigationTarget) => void

export const NAVIGATE_VIEW_KEY: InjectionKey<NavigateView> = Symbol('wotbtools.navigate-view')
