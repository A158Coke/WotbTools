/** 新手引导回执与 pending-login 存储层（拆分自 useOnboarding.ts，行为原样）。 */
import { ONBOARDING_GUIDES } from './useOnboardingGuides.js'
import type { OnboardingTopic } from '../shared/onboarding.js'
import type { OnboardingReceipt } from '../api/onboarding.js'

export const ONBOARDING_STORAGE_KEY = 'wotbtools-onboarding'
export const ONBOARDING_PENDING_LOGIN_KEY = 'wotbtools-onboarding-pending-login'
const PENDING_LOGIN_MAX_AGE_MS = 30 * 60 * 1000
export const ONBOARDING_RELEASE = Object.freeze({ enabled: true, coreEpoch: 1, contentRevision: 8 })
export type Disposition = OnboardingReceipt['disposition'] | 'OFFERED'
export interface LocalOnboardingReceipt { coreEpoch: number; disposition: Disposition; coreStep?: number; migrationConsumed?: boolean }
export interface OnboardingGuidePosition { topic: OnboardingTopic; index: number; stageIndex: number; generation?: number }
export interface PendingLogin { requestedAt: number; receipt?: LocalOnboardingReceipt; guide?: OnboardingGuidePosition }
/** Where a guide was when an explicit login took the document away (OIDC redirect, #670). */
export const EMPTY_RECEIPT: LocalOnboardingReceipt = { coreEpoch: 0, disposition: 'NONE' }
export const PRECEDENCE: Record<Disposition, number> = { NONE: 0, OFFERED: 1, SKIPPED: 2, COMPLETED: 3 }

export function validOnboardingReceipt(value: unknown): value is LocalOnboardingReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as LocalOnboardingReceipt
  return Number.isSafeInteger(receipt.coreEpoch) && receipt.coreEpoch >= 0
    && Object.hasOwn(PRECEDENCE, receipt.disposition)
    && (receipt.coreEpoch > 0 || receipt.disposition === 'NONE')
    && (receipt.coreStep === undefined || Number.isSafeInteger(receipt.coreStep) && receipt.coreStep >= 0)
    && (receipt.migrationConsumed === undefined || typeof receipt.migrationConsumed === 'boolean')
}

/** Same-epoch completion wins; old devices cannot overwrite a newer release. */
export function mergeOnboardingReceipts(a: LocalOnboardingReceipt, b: LocalOnboardingReceipt): LocalOnboardingReceipt {
  if (a.coreEpoch !== b.coreEpoch) return { ...(a.coreEpoch > b.coreEpoch ? a : b) }
  return { ...(PRECEDENCE[a.disposition] > PRECEDENCE[b.disposition] ? a : b),
    ...(a.migrationConsumed || b.migrationConsumed ? { migrationConsumed: true } : {}) }
}

export function shouldOfferOnboarding(receipt: LocalOnboardingReceipt, epoch: number = ONBOARDING_RELEASE.coreEpoch) {
  return receipt.coreEpoch < epoch || (receipt.coreEpoch === epoch && receipt.disposition === 'NONE')
}
export function readCache(): Record<string, LocalOnboardingReceipt> {
  try {
    const value = JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) || '{}')
    if (value.version !== 1 || !value.receipts || typeof value.receipts !== 'object') return {}
    return Object.fromEntries(Object.entries(value.receipts).filter(([, receipt]) => validOnboardingReceipt(receipt))) as Record<string, LocalOnboardingReceipt>
  } catch { return {} }
}

export function validGuidePosition(value: unknown): value is OnboardingGuidePosition {
  if (!value || typeof value !== 'object') return false
  const position = value as OnboardingGuidePosition
  return typeof position.topic === 'string' && Object.hasOwn(ONBOARDING_GUIDES, position.topic)
    && Number.isSafeInteger(position.index) && position.index >= 0
    && Number.isSafeInteger(position.stageIndex) && position.stageIndex >= 0
    && (position.generation === undefined || Number.isSafeInteger(position.generation) && position.generation >= 0)
}

/**
 * The 30-minute TTL must be re-checked at consume time, not only when the storage is read:
 * Android keeps one document alive while the external user-agent authenticates, so a marker
 * can sit in memory long after it became stale.
 */
export function pendingLoginFresh(pending: PendingLogin | null | undefined): pending is PendingLogin {
  if (!pending) return false
  const age = Date.now() - pending.requestedAt
  return Number.isFinite(age) && age >= 0 && age <= PENDING_LOGIN_MAX_AGE_MS
}

export function readPendingLogin(): PendingLogin | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(ONBOARDING_PENDING_LOGIN_KEY) || 'null')
    const receipt = validOnboardingReceipt(pending?.receipt) && ['COMPLETED', 'SKIPPED'].includes(pending.receipt.disposition)
      ? pending.receipt : null
    const guide = validGuidePosition(pending?.guide) ? pending.guide : null
    if ((receipt || guide) && pendingLoginFresh(pending)) {
      return { requestedAt: pending.requestedAt, ...(receipt ? { receipt } : {}), ...(guide ? { guide } : {}) }
    }
    sessionStorage.removeItem(ONBOARDING_PENDING_LOGIN_KEY)
  } catch { /* The same-SPA handoff can still use session memory. */ }
  return null
}

export function writePendingLogin(pending: PendingLogin | null) {
  try {
    if (pending) sessionStorage.setItem(ONBOARDING_PENDING_LOGIN_KEY, JSON.stringify(pending))
    else sessionStorage.removeItem(ONBOARDING_PENDING_LOGIN_KEY)
  } catch { /* Login and manual guides remain usable without storage. */ }
}

export function withoutReceipt(pending: PendingLogin | null): PendingLogin | null {
  return pending?.guide ? { requestedAt: pending.requestedAt, guide: pending.guide } : null
}

export function withoutGuide(pending: PendingLogin | null): PendingLogin | null {
  return pending?.receipt ? { requestedAt: pending.requestedAt, receipt: pending.receipt } : null
}

