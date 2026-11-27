import type { InjectionKey } from 'vue'

export const FEEDBACK_KEY: InjectionKey<() => void> = Symbol('wotbtools.feedback')
