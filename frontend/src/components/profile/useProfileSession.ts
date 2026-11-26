import { watch } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { getUserProfile, syncUserWotbAccountFromLogin } from '../../api/user-profile.js'

type SessionContext = {
  phase: Ref<string>; loading: Ref<boolean>; profile: Ref<Awaited<ReturnType<typeof getUserProfile>>>
  isAuthenticated: () => boolean; authEpoch: () => number; ownEpoch: (epoch: number) => boolean
  epochArg: (value: unknown) => number; requireProfileOnline: () => boolean
  availabilityProfile: () => { available: boolean }; connectivity: Ref<string>
  whenBusinessUserSettled: (context: { authInitState: string; authenticated: boolean; connectivity: string; authEpoch: number }) => Promise<boolean>
  syncFromLoginPending: Ref<boolean>; syncFromLoginError: Ref<unknown>; isWargamingLogin: ComputedRef<boolean>
  loadRecords: (epoch?: number) => Promise<void>; loadHundredStatus: (epoch?: number) => Promise<void>
  getUserProfile: typeof getUserProfile
}

/** @param {{
 *  phase: import('vue').Ref<string>,
 *  loading: import('vue').Ref<boolean>,
 *  profile: import('vue').Ref<object|null>,
 *  isAuthenticated: () => boolean,
 *  authEpoch: () => number,
 *  ownEpoch: (epoch: number) => boolean,
 *  epochArg: (v: unknown) => number,
 *  requireProfileOnline: () => boolean,
 *  availabilityProfile: () => { available: boolean },
 *  connectivity: import('vue').Ref<string>,
 *  whenBusinessUserSettled: (context: unknown) => Promise<boolean>,
 *  syncFromLoginPending: import('vue').Ref<boolean>,
 *  syncFromLoginError: import('vue').Ref<unknown>,
 *  isWargamingLogin: import('vue').ComputedRef<boolean>,
 *  loadRecords: (epoch?: number) => Promise<void>,
 *  loadHundredStatus: (epoch?: number) => Promise<void>,
 * }} ctx */
export function useProfileSession({
  phase, loading, profile, isAuthenticated, authEpoch, ownEpoch, epochArg,
  requireProfileOnline, availabilityProfile, connectivity, whenBusinessUserSettled,
  syncFromLoginPending, syncFromLoginError, isWargamingLogin,
  loadRecords, loadHundredStatus, getUserProfile,
}: SessionContext) {
  function enterConnectivityUnavailable() {
    phase.value = 'connectivity-unavailable'
  }

  async function loadProfile() {
    if (loading.value || !isAuthenticated()) return
    if (!requireProfileOnline()) {
      enterConnectivityUnavailable()
      return
    }
    const epoch = authEpoch()
    loading.value = true
    phase.value = 'done'
    try {
      const settled = await whenBusinessUserSettled({
        authInitState: 'authenticated',
        authenticated: true,
        connectivity: connectivity.value,
        authEpoch: epoch,
      })
      if (!ownEpoch(epoch)) return
      if (!settled) {
        if (!availabilityProfile().available) {
          enterConnectivityUnavailable()
        } else {
          profile.value = null
          phase.value = 'profile-error'
        }
        return
      }
      if (!requireProfileOnline()) {
        enterConnectivityUnavailable()
        return
      }
      const fetchedProfile = await getUserProfile()
      if (!ownEpoch(epoch)) return
      profile.value = fetchedProfile
    } catch {
      if (!ownEpoch(epoch)) return
      profile.value = null
      if (availabilityProfile().available) phase.value = 'profile-error'
      else enterConnectivityUnavailable()
      return
    } finally {
      if (ownEpoch(epoch)) loading.value = false
    }
    if (!ownEpoch(epoch)) return
    phase.value = 'done'
    await syncFromLogin(epoch)
    if (!ownEpoch(epoch)) return
    if (profile.value?.wotbAccountId) {
      loadRecords(epoch)
      loadHundredStatus(epoch)
    }
  }

  watch(connectivity, () => {
    if (!isAuthenticated()) return
    if (profile.value || loading.value) return
    if (phase.value !== 'connectivity-unavailable') return
    if (!availabilityProfile().available) return
    void loadProfile()
  })

  async function syncFromLogin(epochInput: unknown) {
    const epoch = epochArg(epochInput)
    if (!ownEpoch(epoch)) return
    if (!isWargamingLogin.value) return
    if (!requireProfileOnline()) return
    syncFromLoginPending.value = true
    syncFromLoginError.value = null
    try {
      const synced = await syncUserWotbAccountFromLogin()
      if (!ownEpoch(epoch)) return
      if (synced) {
        profile.value = synced
      }
    } catch (e) {
      if (!ownEpoch(epoch)) return
      syncFromLoginError.value = e
    } finally {
      if (ownEpoch(epoch)) syncFromLoginPending.value = false
    }
  }

  return { loadProfile, syncFromLogin, enterConnectivityUnavailable }
}
