import { computed, ref } from 'vue'
import { Feature, getFeatureAvailability, profileBackendAllowed } from '../../src/app/featureCapabilities.js'

const state = ref('ready')
const error = ref(null)

export function shouldEnsureBusinessUser(context = {}) {
  return profileBackendAllowed(context)
}

export function businessProfileAvailability(connectivity) {
  return getFeatureAvailability(Feature.ACCOUNT_PROFILE, { connectivity })
}

export function ensureBusinessUser() {
  return Promise.resolve(true)
}

export function ensureBusinessUserIfAllowed(context = {}) {
  if (!profileBackendAllowed(context)) return Promise.resolve(false)
  return ensureBusinessUser()
}

export async function whenBusinessUserSettled(context = {}) {
  if (!profileBackendAllowed(context)) return false
  return true
}

export function retryBusinessUser() {
  return Promise.resolve(true)
}

export function retryBusinessUserIfAllowed(context = {}) {
  if (!profileBackendAllowed(context)) return Promise.resolve(false)
  return retryBusinessUser()
}

export function resetBusinessUserBootstrap() {
  state.value = 'ready'
  error.value = null
}

export function useBusinessUserBootstrap() {
  return {
    state,
    error,
    ready: computed(() => true),
    failed: computed(() => false),
    ensure: ensureBusinessUser,
    whenSettled: whenBusinessUserSettled,
    retry: retryBusinessUser,
  }
}
