/**
 * 新手引导回执持久化与远端同步（拆分自 useOnboarding.ts，行为原样）。
 * 归属代数（syncGeneration/syncAbort）在本工厂内闭环；宿主卸载时调用 stopSync()。
 */
import type { ComputedRef, Ref } from 'vue'
import { readOnboardingReceipt, saveOnboardingReceipt } from '../api/onboarding.js'
import { profileBackendAllowed, type ProfileBackendContext } from '../app/featureCapabilities.js'
import { whenBusinessUserSettled } from './useBusinessUserBootstrap.js'
import {
  EMPTY_RECEIPT,
  ONBOARDING_RELEASE,
  ONBOARDING_STORAGE_KEY,
  PRECEDENCE,
  mergeOnboardingReceipts,
  readCache,
  type Disposition,
  type LocalOnboardingReceipt,
} from './useOnboardingStorage.js'

export interface OnboardingReceiptSyncCtx {
  cache: Ref<Record<string, LocalOnboardingReceipt>>
  identity: ComputedRef<string>
  receiptKnown: Ref<boolean>
  anonymousTerminal: Ref<LocalOnboardingReceipt | null>
  authEpoch: () => number
  authInitState: Ref<string>
  authenticated: Ref<boolean>
  connectivity: Ref<ProfileBackendContext['connectivity']>
}

export function createOnboardingReceiptSync(ctx: OnboardingReceiptSyncCtx) {
  let syncGeneration = 0
  let syncAbort = new AbortController()

  function persist(identityKey: string, incoming: LocalOnboardingReceipt) {
    // Read before writing so a same-browser account switch/tab cannot erase other users' receipts.
    const disk = readCache()
    const merged = { ...disk, ...ctx.cache.value }
    for (const [key, value] of Object.entries(disk)) merged[key] = mergeOnboardingReceipts(merged[key] || EMPTY_RECEIPT, value)
    merged[identityKey] = mergeOnboardingReceipts(merged[identityKey] || EMPTY_RECEIPT, incoming)
    ctx.cache.value = merged
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version: 1, receipts: merged })) } catch { /* Session memory still suppresses repeated invitations. */ }
  }

  function record(disposition: Disposition) {
    const previous = ctx.cache.value[ctx.identity.value]
    const coreStep = disposition === 'OFFERED' && previous?.coreEpoch === ONBOARDING_RELEASE.coreEpoch ? previous.coreStep : undefined
    const migrationConsumed = previous?.coreEpoch === ONBOARDING_RELEASE.coreEpoch && previous.migrationConsumed === true
    const value = { coreEpoch: ONBOARDING_RELEASE.coreEpoch, disposition, ...(coreStep === undefined ? {} : { coreStep }), ...(migrationConsumed ? { migrationConsumed: true } : {}) }
    persist(ctx.identity.value, value)
    if (ctx.identity.value === 'anonymous' && !migrationConsumed && (disposition === 'COMPLETED' || disposition === 'SKIPPED')) ctx.anonymousTerminal.value = value
  }

  async function synchronize() {
    const generation = ++syncGeneration
    syncAbort.abort()
    syncAbort = new AbortController()
    const signal = syncAbort.signal
    const owner = ctx.identity.value
    const epoch = ctx.authEpoch()
    const context = { authInitState: ctx.authInitState.value, authenticated: ctx.authenticated.value, connectivity: ctx.connectivity.value }
    const owns = () => generation === syncGeneration && owner === ctx.identity.value && epoch === ctx.authEpoch() && !signal.aborted
    ctx.receiptKnown.value = owner === 'anonymous' && context.authInitState === 'unauthenticated'
    if (owner === 'anonymous' || owner === 'unknown-account' || !profileBackendAllowed(context)) return
    try {
      if (!await whenBusinessUserSettled(context) || !owns()) return
      const remote = await readOnboardingReceipt(signal)
      if (!owns()) return
      persist(owner, remote)
      ctx.receiptKnown.value = true
      const local = ctx.cache.value[owner]
      if (local && (local.disposition === 'COMPLETED' || local.disposition === 'SKIPPED')
        && (local.coreEpoch > remote.coreEpoch || (local.coreEpoch === remote.coreEpoch && PRECEDENCE[local.disposition] > PRECEDENCE[remote.disposition]))) {
        const saved = await saveOnboardingReceipt({ coreEpoch: local.coreEpoch, disposition: local.disposition }, signal)
        if (owns()) persist(owner, saved)
      }
    } catch { /* Unknown server receipt must never be interpreted as a fresh account. Manual guides remain available. */ }
  }

  /** 宿主卸载：使在飞同步失效并中止请求（原 onBeforeUnmount 内联逻辑）。 */
  function stopSync() {
    ++syncGeneration
    syncAbort.abort()
  }

  return { persist, record, synchronize, stopSync }
}

