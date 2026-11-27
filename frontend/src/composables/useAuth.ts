import { computed, ref, type Ref } from 'vue'
import { NATIVE_AUTH_CAPABILITY } from '../platform/nativeBridgeContract.js'
import { createBrowserAuthProvider } from '../platform/browserAuthProvider.js'
import {
  createAndroidAuthProvider,
  createUnsupportedAuthProvider,
} from '../platform/androidAuthProvider.js'
import {
  getNativeBridgeVersion,
  isAndroidApp,
  isNativeBridgeCompatible,
  supports,
} from './usePlatformBridge.js'
import { useConnectivity } from './useConnectivity.js'
import { ConnectivityState } from '../platform/connectivity.js'
import type { AuthClaims, AuthInitMode, AuthProvider } from '../types/auth.js'
import {
  abandonTransaction,
  releaseProvider,
  resolveTransaction,
  type AuthTransaction,
} from './authTransaction.js'
import { elapsedMs, errorType, identityKeyOf, logInitStarted } from './authInitDiagnostics.js'
import { loginRedirectUri, logoutRedirectUri, type LoginDestination } from './authRedirects.js'
import {
  clearPendingRemoteLogout,
  hasPendingRemoteLogout,
  markPendingRemoteLogout,
} from './authPendingRemoteLogout.js'

type AuthInitState = 'idle' | 'initializing' | 'authenticated' | 'unauthenticated' | 'failed'

type AuthRoleSource = { authenticated: Ref<boolean>; tokenParsed: Ref<AuthClaims | null> }

const AUTH_INIT_WATCHDOG_MS = 12_000
const AUTH_INIT_WATCHDOG_NATIVE_MS = 60_000
const AUTH_INIT_PENDING_LOG_MS = 5_000

let currentTransaction: AuthTransaction | null = null
let authGeneration = 0

const authInitState = ref<AuthInitState>('idle')
const initialized = ref(false)
const authenticated = ref(false)
const tokenParsed = ref<AuthClaims | null>(null)
const initError = ref<unknown>(null)
const initFailureReason = ref<string | null>(null)

const loginInFlight = ref(false)


async function resolveAuthProvider(): Promise<AuthProvider> {
  if (!isAndroidApp()) return createBrowserAuthProvider()

  const bridgeVersion = await getNativeBridgeVersion()
  if (!isNativeBridgeCompatible(bridgeVersion)) {
    return createUnsupportedAuthProvider(
      bridgeVersion !== null ? `bridge-v${bridgeVersion}` : 'bridge-version-unknown',
    )
  }
  if (!(await supports(NATIVE_AUTH_CAPABILITY))) {
    return createUnsupportedAuthProvider('native-auth-capability-missing')
  }
  return createAndroidAuthProvider()
}



function markFailed(transaction: AuthTransaction, error: unknown, reason: string) {
  if (currentTransaction !== transaction || transaction.settled) return
  transaction.settled = true
  clearTimeout(transaction.watchdog!)
  clearTimeout(transaction.pendingLog!)
  initialized.value = true
  projectSession({ isAuthenticated: false, parsedToken: null, state: 'failed' })
  initError.value = error || new Error('AUTH_INIT_FAILED')
  initFailureReason.value = reason
  if (reason === 'init-timeout' && !transaction.timeoutLogged) {
    console.warn(
      `[auth] init_timeout generation=${transaction.generation} elapsedMs=${elapsedMs(transaction)}`,
    )
  } else {
    console.warn(
      `[auth] init_failed generation=${transaction.generation} errorType=${errorType(error)} `
      + `elapsedMs=${elapsedMs(transaction)}`,
    )
  }
  resolveTransaction(transaction, false)
}

let authIdentityEpoch = 0
let projectedIdentity: string | null = null

function projectSession({ isAuthenticated: isAuthed, parsedToken, state }: {
  isAuthenticated: boolean
  parsedToken: AuthClaims | null | undefined
  state?: AuthInitState
}) {
  const nextIdentity = identityKeyOf(isAuthed, parsedToken)
  if (nextIdentity !== projectedIdentity) {
    projectedIdentity = nextIdentity
    authIdentityEpoch += 1
  }
  authenticated.value = isAuthed
  tokenParsed.value = parsedToken || null
  authInitState.value = state || (isAuthed ? 'authenticated' : 'unauthenticated')
}

function applyProviderState(provider: AuthProvider) {
  const isAuthed = Boolean(provider.authenticated)
  projectSession({ isAuthenticated: isAuthed, parsedToken: isAuthed ? provider.tokenParsed : null })
}

function completeTransaction(transaction: AuthTransaction) {
  if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
  transaction.settled = true
  clearTimeout(transaction.watchdog!)
  clearTimeout(transaction.pendingLog!)
  applyProviderState(transaction.provider!)
  initialized.value = true
  initError.value = null
  initFailureReason.value = null
  console.debug(
    `[auth] init_completed generation=${transaction.generation} `
    + `authenticated=${authenticated.value} elapsedMs=${elapsedMs(transaction)}`,
  )
  resolveTransaction(transaction, authenticated.value)
}

function startAuthInit({ mode = 'normal', reason = 'startup' }: { mode?: AuthInitMode; reason?: string } = {}) {
  if (currentTransaction && !currentTransaction.settled) abandonTransaction(currentTransaction)
  releaseProvider(currentTransaction)

  const transaction: AuthTransaction = {
    generation: ++authGeneration,
    provider: null,
    unsubscribe: null,
    reason,
    startedAt: Date.now(),
    settled: false,
    abandoned: false,
    watchdog: null,
    pendingLog: null,
    timeoutLogged: false,
    publicResolved: false,
    resolve: null,
    promise: null,
  }
  currentTransaction = transaction
  initialized.value = false
  projectSession({ isAuthenticated: false, parsedToken: null, state: 'initializing' })
  initError.value = null
  initFailureReason.value = null

  const promise = new Promise<boolean>(resolve => { transaction.resolve = resolve })
  transaction.promise = promise
  logInitStarted(transaction)

  transaction.watchdog = setTimeout(() => {
    if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
    transaction.timeoutLogged = true
    console.warn(
      `[auth] init_timeout generation=${transaction.generation} elapsedMs=${elapsedMs(transaction)}`,
    )
    abandonTransaction(transaction)
    markFailed(transaction, new Error('AUTH_INIT_WATCHDOG_TIMEOUT'), 'init-timeout')
  }, isAndroidApp() ? AUTH_INIT_WATCHDOG_NATIVE_MS : AUTH_INIT_WATCHDOG_MS)
  transaction.pendingLog = setTimeout(() => {
    if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
    console.debug(`[auth] init_pending generation=${transaction.generation} elapsedMs=${elapsedMs(transaction)}`)
  }, AUTH_INIT_PENDING_LOG_MS)

  const run = (async () => {
    const provider = await resolveAuthProvider()
    if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
    transaction.provider = provider
    transaction.unsubscribe = provider.onAuthChanged(() => {
      if (currentTransaction !== transaction || transaction.abandoned) return
      applyProviderState(provider)
      console.debug(
        `[auth] auth_changed generation=${transaction.generation} authenticated=${authenticated.value}`,
      )
    })
    await provider.init({ mode })
  })()
  run.then(
    () => completeTransaction(transaction),
    error => markFailed(transaction, error, 'init-error'),
  )

  return promise
}

async function initAuth() {
  if (currentTransaction) {
    await currentTransaction.promise
    return
  }
  if (hasPendingRemoteLogout()) {
    console.warn('[auth] init_skip_check_sso reason=pending-remote-logout')
    await startAuthInit({ mode: 'login-recovery', reason: 'pending-remote-logout' })
    return
  }
  await startAuthInit()
}

async function retryAuth() {
  const promise = startAuthInit({ reason: 'retry' })
  console.debug(`[auth] init_retry generation=${authGeneration}`)
  return promise
}


async function login(destination: LoginDestination = 'profile') {
  if (loginInFlight.value) {
    console.debug(`[auth] login_deduplicated destination=${typeof destination === 'string' ? destination : 'location'} reason=redirect-in-flight`)
    return false
  }
  loginInFlight.value = true
  console.debug(`[auth] login_requested destination=${typeof destination === 'string' ? destination : 'location'} generation=${authGeneration}`)
  try {
    if (!currentTransaction || authInitState.value === 'initializing' || authInitState.value === 'failed') {
      const promise = startAuthInit({ mode: 'login-recovery', reason: 'login-recovery' })
      await promise
      if (authInitState.value === 'failed') throw initError.value || new Error('AUTH_INIT_FAILED')
    }
    const transaction = currentTransaction
    if (!transaction || transaction.abandoned || !transaction.provider) {
      throw new Error('AUTH_INIT_NOT_READY')
    }
    clearPendingRemoteLogout()
    return await transaction.provider.login(loginRedirectUri(destination))
  } finally {
    loginInFlight.value = false
  }
}

async function logout() {
  const provider = currentTransaction?.provider
  if (!provider) {
    console.warn('[auth] logout_skipped reason=no-provider')
    return
  }
  projectSession({ isAuthenticated: false, parsedToken: null })

  if (provider.name === 'android') {
    await provider.logout(logoutRedirectUri())
    applyProviderState(provider)
    return
  }

  if (offlineKnown()) {
    markPendingRemoteLogout()
    console.warn('[auth] logout_offline reason=end-session-navigation-skipped')
    return
  }
  clearPendingRemoteLogout()
  await provider.logout(logoutRedirectUri())
}


function isAuthenticated() {
  return authenticated.value
}

function offlineKnown() {
  return useConnectivity().connectivity.value === ConnectivityState.OFFLINE
}

function hasRole(role: string) {
  return Boolean(role) && Array.isArray(tokenParsed.value?.realm_access?.roles)
    && tokenParsed.value.realm_access.roles.includes(role)
}

const isAdmin = computed(() => hasRole('wotbtools-admin'))

const isHofAdmin = computed(() => hasRole('HoF-admin') || isAdmin.value)

export function tournamentAdminAllowed(auth: AuthRoleSource = useAuth()) {
  const roles = auth.tokenParsed.value?.realm_access?.roles
  return auth.authenticated.value && Array.isArray(roles)
    && roles.includes('tournament-admin')
}
const isTournamentAdmin = computed(() => tournamentAdminAllowed({ authenticated, tokenParsed }))

export function contentAdminAllowed(auth: AuthRoleSource = useAuth()) {
  const roles = auth.tokenParsed.value?.realm_access?.roles
  return auth.authenticated.value && Array.isArray(roles)
    && roles.includes('content-admin')
}
const isContentAdmin = computed(() => contentAdminAllowed({ authenticated, tokenParsed }))

export function leagueBroadcastAdminAllowed(auth: AuthRoleSource = useAuth()) {
  const roles = auth.tokenParsed.value?.realm_access?.roles
  return auth.authenticated.value && Array.isArray(roles) && roles.includes('wotbtools-admin')
}
const isLeagueBroadcastAdmin = computed(() => leagueBroadcastAdminAllowed({ authenticated, tokenParsed }))

const displayName = computed(
  () => tokenParsed.value?.displayName || tokenParsed.value?.preferred_username || '',
)

function token() {
  return currentTransaction?.provider?.token() || ''
}

function authEpoch() {
  return authIdentityEpoch
}

async function ensureToken(minValidity = 30) {
  const provider = currentTransaction?.provider
  if (!provider || !provider.authenticated) return false
  let refreshed: boolean
  try {
    refreshed = await provider.ensureToken(minValidity)
  } catch {
    refreshed = false
  }
  if (currentTransaction?.provider !== provider) return false
  if (!refreshed) {
    if (provider.name === 'android') applyProviderState(provider)
    console.warn(
      `[auth] refresh_failed generation=${authGeneration} platform=${provider.name} session=retained`,
    )
    return false
  }
  tokenParsed.value = provider.tokenParsed || null
  return true
}

export function useAuth() {
  return {
    initAuth,
    initPromise: initAuth(),
    retryAuth,
    login,
    loginInFlight,
    logout,
    isAuthenticated,
    authEpoch,
    hasPendingRemoteLogout,
    hasRole,
    isAdmin,
    isHofAdmin,
    isTournamentAdmin,
    isContentAdmin,
    isLeagueBroadcastAdmin,
    token,
    ensureToken,
    initialized,
    authenticated,
    authInitState,
    initFailureReason,
    tokenParsed,
    initError,
    displayName,
  }
}
