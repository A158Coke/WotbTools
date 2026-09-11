import Keycloak from 'keycloak-js'
import { computed, ref } from 'vue'

const AUTH_INIT_WATCHDOG_MS = 12_000
const AUTH_INIT_PENDING_LOG_MS = 5_000
const KEYCLOAK_CONFIG = Object.freeze({
  url: 'https://auth.wotbtools.com',
  realm: 'wotbtools',
  clientId: 'wotbtools-web',
})

let keycloak = null
let currentTransaction = null
let authGeneration = 0

const authInitState = ref('idle')
const initialized = ref(false)
const authenticated = ref(false)
const tokenParsed = ref(null)
const initError = ref(null)
const initFailureReason = ref(null)

/**
 * 只表示「此刻正有一个 login redirect 正在发起」的短生命周期状态。
 * 绝不用它推断「历史上是否 login 过」——取消 / provider 失败 / WebView 中断后
 * 必须始终能重新发起 login。
 */
const loginInFlight = ref(false)

function ensureKeycloak() {
  if (!keycloak) keycloak = new Keycloak(KEYCLOAK_CONFIG)
  return keycloak
}

function platformName() {
  return typeof window !== 'undefined' && window.WotbNative ? 'android' : 'web'
}

function errorType(error) {
  if (error?.name && typeof error.name === 'string') return error.name
  if (error?.error && typeof error.error === 'string') return error.error
  return 'unknown'
}

function elapsedMs(transaction) {
  return Date.now() - transaction.startedAt
}

function logInitStarted(transaction) {
  console.debug(
    `[auth] init_started generation=${transaction.generation} platform=${platformName()} `
    + `reason=${transaction.reason}`,
  )
}

function abandonTransaction(transaction) {
  if (!transaction || transaction.settled || transaction.abandoned) return
  transaction.abandoned = true
  clearTimeout(transaction.watchdog)
  clearTimeout(transaction.pendingLog)
  resolveTransaction(transaction, false)
  console.debug(`[auth] init_abandoned generation=${transaction.generation}`)
}

function resolveTransaction(transaction, result) {
  if (transaction.publicResolved) return
  transaction.publicResolved = true
  transaction.resolve(result)
}

function markFailed(transaction, error, reason) {
  if (currentTransaction !== transaction || transaction.settled) return
  transaction.settled = true
  clearTimeout(transaction.watchdog)
  clearTimeout(transaction.pendingLog)
  authInitState.value = 'failed'
  initialized.value = true
  authenticated.value = false
  tokenParsed.value = null
  initError.value = error
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

function completeTransaction(transaction, isLoggedIn) {
  if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
  transaction.settled = true
  clearTimeout(transaction.watchdog)
  clearTimeout(transaction.pendingLog)
  authenticated.value = Boolean(isLoggedIn && transaction.keycloak.authenticated)
  tokenParsed.value = transaction.keycloak.tokenParsed || null
  initialized.value = true
  initError.value = null
  initFailureReason.value = null
  authInitState.value = authenticated.value ? 'authenticated' : 'unauthenticated'
  console.debug(
    `[auth] init_completed generation=${transaction.generation} `
    + `authenticated=${authenticated.value} elapsedMs=${elapsedMs(transaction)}`,
  )
  resolveTransaction(transaction, authenticated.value)
}

function initOptions(mode) {
  if (mode === 'login-recovery') {
    // Fresh adapter recovery avoids repeating the bootstrap that the watchdog abandoned.
    // Normal browser/WebView SSO keeps check-sso below.
    return {
      pkceMethod: 'S256',
      checkLoginIframe: false,
    }
  }
  return {
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
    checkLoginIframe: false,
  }
}

function startAuthInit({ mode = 'normal', reason = 'startup' } = {}) {
  if (currentTransaction && !currentTransaction.settled) abandonTransaction(currentTransaction)

  const transaction = {
    generation: ++authGeneration,
    keycloak: new Keycloak(KEYCLOAK_CONFIG),
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
  keycloak = transaction.keycloak
  currentTransaction = transaction
  authInitState.value = 'initializing'
  initialized.value = false
  authenticated.value = false
  tokenParsed.value = null
  initError.value = null
  initFailureReason.value = null

  transaction.promise = new Promise(resolve => { transaction.resolve = resolve })
  logInitStarted(transaction)

  transaction.watchdog = setTimeout(() => {
    if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
    // The raw keycloak promise is intentionally left alone; its late completion is ignored by
    // generation/abandoned checks. A later retry always receives a new adapter instance.
    transaction.timeoutLogged = true
    console.warn(
      `[auth] init_timeout generation=${transaction.generation} elapsedMs=${elapsedMs(transaction)}`,
    )
    abandonTransaction(transaction)
    markFailed(transaction, new Error('AUTH_INIT_WATCHDOG_TIMEOUT'), 'init-timeout')
  }, AUTH_INIT_WATCHDOG_MS)
  transaction.pendingLog = setTimeout(() => {
    if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
    console.debug(`[auth] init_pending generation=${transaction.generation} elapsedMs=${elapsedMs(transaction)}`)
  }, AUTH_INIT_PENDING_LOG_MS)

  let rawPromise
  try {
    // init() installs the adapter synchronously. login() is only called after this fresh
    // transaction settles, never on an uninitialized adapter.
    rawPromise = transaction.keycloak.init(initOptions(mode))
  } catch (error) {
    rawPromise = Promise.reject(error)
  }
  Promise.resolve(rawPromise).then(
    result => completeTransaction(transaction, result),
    error => markFailed(transaction, error, 'init-error'),
  )

  return transaction.promise
}

async function initAuth() {
  if (currentTransaction) return currentTransaction.promise
  return startAuthInit()
}

async function retryAuth() {
  const promise = startAuthInit({ reason: 'retry' })
  console.debug(`[auth] init_retry generation=${currentTransaction.generation}`)
  return promise
}

function loginRedirectUri(view) {
  const url = new URL(window.location.origin + window.location.pathname)
  url.searchParams.set('view', view)
  return url.toString()
}

/**
 * Normal login uses the settled current adapter. If bootstrap is still running or has failed,
 * abandon that generation and perform a fresh, non-silent adapter init; the stale promise can
 * never block this redirect or write back into current auth state.
 */
async function login(view = 'profile') {
  if (loginInFlight.value) {
    console.debug(`[auth] login_deduplicated view=${view} reason=redirect-in-flight`)
    return false
  }
  loginInFlight.value = true
  console.debug(`[auth] login_requested view=${view} generation=${authGeneration}`)
  try {
    if (!currentTransaction || authInitState.value === 'initializing' || authInitState.value === 'failed') {
      const promise = startAuthInit({ mode: 'login-recovery', reason: 'login-recovery' })
      await promise
      if (authInitState.value === 'failed') throw initError.value || new Error('AUTH_INIT_FAILED')
    }
    const transaction = currentTransaction
    if (!transaction || transaction.abandoned || !transaction.keycloak) {
      throw new Error('AUTH_INIT_NOT_READY')
    }
    return await transaction.keycloak.login({ redirectUri: loginRedirectUri(view) })
  } finally {
    loginInFlight.value = false
  }
}

async function logout() {
  const kc = ensureKeycloak()
  return kc.logout({ redirectUri: window.location.origin + window.location.pathname })
}

function isAuthenticated() {
  return authenticated.value
}

function hasRole(role) {
  return Boolean(role) && Array.isArray(tokenParsed.value?.realm_access?.roles)
    && tokenParsed.value.realm_access.roles.includes(role)
}

function userName() {
  return tokenParsed.value?.preferred_username
    || tokenParsed.value?.name
    || tokenParsed.value?.email
    || ''
}

function token() {
  return keycloak?.token || ''
}

/** Keep the token valid for at least minValidity seconds when the user is signed in. */
async function ensureToken(minValidity = 30) {
  const kc = ensureKeycloak()
  if (!kc.authenticated) return false
  try {
    const refreshed = await kc.updateToken(minValidity)
    if (refreshed) tokenParsed.value = kc.tokenParsed
    return true
  } catch {
    authenticated.value = false
    tokenParsed.value = null
    authInitState.value = 'unauthenticated'
    return false
  }
}

export function useAuth() {
  return {
    get keycloak() {
      return currentTransaction?.keycloak || ensureKeycloak()
    },
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
