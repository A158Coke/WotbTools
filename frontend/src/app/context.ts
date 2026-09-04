import type { InjectionKey } from 'vue'

/**
 * Application-level navigation command. Vue Router remains the single browser-history owner;
 * feature components may request a product destination without depending on router internals.
 */
export type NavigateView = (view: string) => void

export const NAVIGATE_VIEW_KEY: InjectionKey<NavigateView> = Symbol('wotbtools.navigate-view')
