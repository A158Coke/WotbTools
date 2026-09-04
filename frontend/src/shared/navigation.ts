import type { InjectionKey } from 'vue'

/**
 * Feature-neutral application navigation command. Vue Router remains the single browser-history
 * owner; features request a product destination without importing app/router internals.
 */
export type NavigateView = (view: string) => void

export const NAVIGATE_VIEW_KEY: InjectionKey<NavigateView> = Symbol('wotbtools.navigate-view')
