import type { InjectionKey, Ref } from 'vue'

export type HofCountStatus = 'hidden' | 'loading' | 'ready' | 'unknown'
export type HofCountReason = 'offline' | 'unauthorized' | 'forbidden' | 'timeout' | 'unavailable'
export type HofCountSnapshot = Readonly<{ hundred: number; mark3: number; total: number; sampledAt: number }>
export interface HofPendingCount {
  status: Readonly<Ref<HofCountStatus>>
  reason: Readonly<Ref<HofCountReason | null>>
  snapshot: Readonly<Ref<HofCountSnapshot | null>>
  retry(): void
  captureInvalidation(): () => void
}

export const HOF_PENDING_COUNT_KEY: InjectionKey<HofPendingCount> = Symbol('wotbtools.hof-pending-count')
