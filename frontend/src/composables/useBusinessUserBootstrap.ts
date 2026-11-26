import { computed, readonly, ref } from 'vue'
import { ensureUserProfile } from '../api/user-profile.js'
import { Feature, getFeatureAvailability, profileBackendAllowed, type ProfileBackendContext } from '../app/featureCapabilities.js'


const state = ref<'idle' | 'pending' | 'ready' | 'failed'>('idle')
const error = ref<unknown>(null)

let inFlight: Promise<boolean> | null = null
let ownerEpoch = 0
let generation = 0

async function run() {
  const requestGeneration = generation
  state.value = 'pending'
  error.value = null
  try {
    await ensureUserProfile()
    if (requestGeneration !== generation) return false
    state.value = 'ready'
    return true
  } catch (e) {
    if (requestGeneration !== generation) return false
    error.value = e
    state.value = 'failed'
    return false
  } finally {
    if (requestGeneration === generation) inFlight = null
  }
}

function selectIdentity(context: ProfileBackendContext) {
  if (context.authEpoch !== undefined && context.authEpoch !== ownerEpoch) {
    resetBusinessUserBootstrap()
    ownerEpoch = context.authEpoch
  }
  return ownerEpoch
}

export function businessProfileAvailability(connectivity: unknown) {
  return getFeatureAvailability(Feature.ACCOUNT_PROFILE, { connectivity })
}

export function shouldEnsureBusinessUser(context: ProfileBackendContext = {}) {
  return profileBackendAllowed(context)
}

function ensureBusinessUser() {
  if (state.value === 'ready') return Promise.resolve(true)
  if (inFlight) return inFlight
  inFlight = run()
  return inFlight
}

export async function whenBusinessUserSettled(context: ProfileBackendContext = {}) {
  const epoch = selectIdentity(context)
  if (!profileBackendAllowed(context)) return false
  if (state.value !== 'ready') {
    await ensureBusinessUser()
  }
  return epoch === ownerEpoch && state.value === 'ready'
}

export function ensureBusinessUserIfAllowed(context: ProfileBackendContext = {}) {
  selectIdentity(context)
  if (!profileBackendAllowed(context)) return Promise.resolve(false)
  return ensureBusinessUser()
}

function retryBusinessUser() {
  state.value = 'idle'
  error.value = null
  return ensureBusinessUser()
}

export function retryBusinessUserIfAllowed(context: ProfileBackendContext = {}) {
  selectIdentity(context)
  if (!profileBackendAllowed(context)) return Promise.resolve(false)
  return retryBusinessUser()
}

export function resetBusinessUserBootstrap() {
  generation += 1
  ownerEpoch = 0
  state.value = 'idle'
  error.value = null
  inFlight = null
}

export function useBusinessUserBootstrap() {
  return {
    state: readonly(state),
    error: readonly(error),
    ready: computed(() => state.value === 'ready'),
    failed: computed(() => state.value === 'failed'),
    ensure: ensureBusinessUserIfAllowed,
    whenSettled: whenBusinessUserSettled,
    retry: retryBusinessUserIfAllowed,
  }
}
