import { computed, ref } from 'vue'

/**
 * Browser fixture for the auth boundary. The page, router, AppShell, ReplayWorkspace and CSS
 * remain production code; only Keycloak's network/runtime boundary is replaced.
 *
 * Query contract:
 *   ws-auth=0|1                 -> unauthenticated / authenticated result
 *   ws-auth-init=resolve-authenticated|resolve-unauthenticated|reject|pending
 *   ws-auth-retry-init=<mode>   -> result used by retryAuth()
 *   ws-auth-timeout-ms=<ms>     -> shortens the fixture watchdog for browser tests
 *   ws-login=resolve|reject     -> login() success / provider rejection
 */
const params = new URLSearchParams(window.location.search)
const initialAuthenticated = params.get('ws-auth') !== '0'
const initialMode = params.get('ws-auth-init')
  || (initialAuthenticated ? 'resolve-authenticated' : 'resolve-unauthenticated')
const retryMode = params.get('ws-auth-retry-init') || 'resolve-unauthenticated'
const watchdogMs = Number(params.get('ws-auth-timeout-ms')) || 12_000

const authenticated = ref(false)
const initialized = ref(false)
const authInitState = ref('idle')
const initError = ref(null)
const initFailureReason = ref(null)
const loginInFlight = ref(false)
const tokenParsed = ref({
  preferred_username: 'fixture-user',
  realm_access: { roles: String(params.get('ws-roles') || '').split(',').filter(Boolean) },
})

const loginCalls = []
let generation = 0
let currentPromise = null
let currentGeneration = 0
let currentWatchdog = null
let resolveCurrentPromise = null
let currentPromiseSettled = false

const state = {
  loginCalls,
  authenticated,
  initialized,
  authInitState,
  initError,
  initFailureReason,
  loginInFlight,
  generation: 0,
  loginMode: params.get('ws-login') === 'reject' ? 'reject' : 'resolve',
  lastLoginError: null,
}
window.__wsAuth = state

function complete(nextGeneration, result) {
  if (nextGeneration !== currentGeneration) return
  clearTimeout(currentWatchdog)
  authenticated.value = Boolean(result)
  initialized.value = true
  initError.value = null
  initFailureReason.value = null
  authInitState.value = authenticated.value ? 'authenticated' : 'unauthenticated'
  resolvePromise(authenticated.value)
}

function resolvePromise(result) {
  if (currentPromiseSettled) return
  currentPromiseSettled = true
  resolveCurrentPromise(result)
}

function fail(nextGeneration, error, reason) {
  if (nextGeneration !== currentGeneration) return
  clearTimeout(currentWatchdog)
  initialized.value = true
  authenticated.value = false
  authInitState.value = 'failed'
  initError.value = error
  initFailureReason.value = reason
  resolvePromise(false)
}

function startInit(mode) {
  if (currentPromise && !currentPromiseSettled) resolvePromise(false)
  const nextGeneration = ++generation
  currentGeneration = nextGeneration
  state.generation = nextGeneration
  authInitState.value = 'initializing'
  initialized.value = false
  authenticated.value = false
  initError.value = null
  initFailureReason.value = null

  const publicPromise = new Promise(resolve => {
    resolveCurrentPromise = resolve
  })
  currentPromiseSettled = false
  currentPromise = publicPromise

  clearTimeout(currentWatchdog)
  currentWatchdog = setTimeout(() => {
    fail(nextGeneration, new Error('AUTH_INIT_WATCHDOG_TIMEOUT'), 'init-timeout')
  }, watchdogMs)

  const raw = mode === 'pending'
    ? new Promise(() => {})
    : mode === 'reject'
      ? Promise.reject(new Error('AUTH_INIT_FAILED'))
      : Promise.resolve(mode === 'resolve-authenticated')
  Promise.resolve(raw).then(
    result => complete(nextGeneration, result),
    error => fail(nextGeneration, error, 'init-error'),
  )
  return publicPromise
}

function initAuth() {
  return currentPromise || startInit(initialMode)
}

function retryAuth() {
  return startInit(retryMode)
}

async function login(view = 'profile') {
  if (loginInFlight.value) return false
  loginInFlight.value = true
  loginCalls.push(view)
  state.lastLoginError = null
  try {
    if (authInitState.value === 'idle' || authInitState.value === 'initializing' || authInitState.value === 'failed') {
      await startInit('resolve-unauthenticated')
      if (authInitState.value === 'failed') throw initError.value
    }
    if (state.loginMode === 'reject') {
      state.lastLoginError = 'fixture-provider-rejected'
      throw new Error('fixture login rejected')
    }
    return true
  } finally {
    loginInFlight.value = false
  }
}

async function logout() {
  authenticated.value = false
  authInitState.value = 'unauthenticated'
  return true
}

function isAuthenticated() { return authenticated.value }
function hasRole(role) {
  const roles = tokenParsed.value?.realm_access?.roles
  return Boolean(role) && Array.isArray(roles) && roles.includes(role)
}
function userName() { return tokenParsed.value?.preferred_username || '' }
function token() { return authenticated.value ? 'fixture-access-token' : '' }
async function ensureToken() { return authenticated.value }

export function useAuth() {
  return {
    keycloak: null,
    initAuth,
    initPromise: initAuth(),
    retryAuth,
    login,
    loginInFlight,
    logout,
    isAuthenticated,
    hasRole,
    userName,
    token,
    ensureToken,
    initialized,
    authenticated,
    authInitState,
    initFailureReason,
    tokenParsed,
    initError,
    displayName: computed(() => userName()),
  }
}
