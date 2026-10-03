import { computed, ref } from 'vue'
import { stringifyQuery } from 'vue-router'
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

const AUTH_INIT_WATCHDOG_MS = 12_000
/**
 * Android 的 init 要走 bridge：版本 / 能力查询（各 5s）之后还有 authGetState 与
 * authGetAccessToken（各上限 20s，含 OIDC discovery / refresh）。12s 会把正常但缓慢的
 * native 初始化误判成超时，所以 watchdog 必须覆盖整条链路——但仍是硬上限，
 * authInitState 绝不会永远停在 initializing。
 */
const AUTH_INIT_WATCHDOG_NATIVE_MS = 60_000
const AUTH_INIT_PENDING_LOG_MS = 5_000

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

function platformName() {
  return isAndroidApp() ? 'android' : 'web'
}

/**
 * 运行时 provider 选择（**绝不回退**）：
 * - 没有 `window.WotbNative`（普通浏览器）→ BrowserAuthProvider（keycloak-js 仍在页面内）。
 * - Android 壳且 bridge v2 + 广告 `native-auth` → AndroidAuthProvider（Native 拥有 OIDC 会话）。
 * - Android 壳但 bridge v1 / 版本未知 / 缺能力 → unsupported provider：只暴露失败，
 *   绝不退化成「WebView 里跑 keycloak-js」——那正是本次 cutover 要消灭的路径。
 */
async function resolveAuthProvider() {
  if (!isAndroidApp()) return createBrowserAuthProvider()

  const bridgeVersion = await getNativeBridgeVersion()
  if (!isNativeBridgeCompatible(bridgeVersion)) {
    return createUnsupportedAuthProvider(
      Number.isInteger(bridgeVersion) ? `bridge-v${bridgeVersion}` : 'bridge-version-unknown',
    )
  }
  if (!(await supports(NATIVE_AUTH_CAPABILITY))) {
    return createUnsupportedAuthProvider('native-auth-capability-missing')
  }
  return createAndroidAuthProvider()
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

function resolveTransaction(transaction, result) {
  if (transaction.publicResolved) return
  transaction.publicResolved = true
  transaction.resolve(result)
}

/** 退订 Native 推送：transaction 一旦不再是 owner（被放弃或被新一代取代）就必须解除。 */
function releaseProvider(transaction) {
  if (!transaction?.unsubscribe) return
  transaction.unsubscribe()
  transaction.unsubscribe = null
}

function abandonTransaction(transaction) {
  if (!transaction || transaction.settled || transaction.abandoned) return
  transaction.abandoned = true
  clearTimeout(transaction.watchdog)
  clearTimeout(transaction.pendingLog)
  releaseProvider(transaction)
  resolveTransaction(transaction, false)
  console.debug(`[auth] init_abandoned generation=${transaction.generation}`)
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

/**
 * 把 provider 的当前状态投影到组件可见的 refs。init 落定、Native 推送
 * （`wotbtoolsOnAuthChanged`）与 Android logout 共用这一条投影路径：只有一个状态 owner。
 */
function applyProviderState(provider) {
  authenticated.value = Boolean(provider.authenticated)
  tokenParsed.value = provider.tokenParsed || null
  authInitState.value = authenticated.value ? 'authenticated' : 'unauthenticated'
}

function completeTransaction(transaction) {
  if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
  transaction.settled = true
  clearTimeout(transaction.watchdog)
  clearTimeout(transaction.pendingLog)
  applyProviderState(transaction.provider)
  initialized.value = true
  initError.value = null
  initFailureReason.value = null
  console.debug(
    `[auth] init_completed generation=${transaction.generation} `
    + `authenticated=${authenticated.value} elapsedMs=${elapsedMs(transaction)}`,
  )
  resolveTransaction(transaction, authenticated.value)
}

function startAuthInit({ mode = 'normal', reason = 'startup' } = {}) {
  if (currentTransaction && !currentTransaction.settled) abandonTransaction(currentTransaction)
  // 上一代（含已落定的一代）必须先退订：Native 的 authChanged 全局只有一个槽位。
  releaseProvider(currentTransaction)

  const transaction = {
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
    // Provider 的迟到完成由 generation/abandoned 检查忽略；retry 总是拿到新的 provider。
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

  // provider 解析本身是异步的（Android 要读 bridge 版本与能力），但 watchdog 已开始计时：
  // 解析失败 / init 失败 / 超时都落到 failed，绝不会停在 initializing。
  const run = (async () => {
    const provider = await resolveAuthProvider()
    if (currentTransaction !== transaction || transaction.settled || transaction.abandoned) return
    transaction.provider = provider
    // Native 在 external browser 里完成 login / logout 后推送：WebView 停在原页面，
    // 这里就地把最新状态投影回 refs，不需要 reload。
    transaction.unsubscribe = provider.onAuthChanged(() => {
      if (currentTransaction !== transaction || transaction.abandoned) return
      applyProviderState(provider)
      console.debug(
        `[auth] auth_changed generation=${transaction.generation} authenticated=${authenticated.value}`,
      )
    })
    // provider 已落定；login() 只会在本 transaction settle 之后调用，绝不在未初始化的 provider 上调用。
    await provider.init({ mode })
  })()
  run.then(
    () => completeTransaction(transaction),
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

/** 浏览器登录目的地：同一 view 保留上下文，也接受完整 router location（仅本站）。 */
function loginRedirectUri(destination) {
  const current = new URL(window.location.href)
  if (typeof destination === 'string') {
    const url = current.searchParams.get('view') === destination
      ? current
      : new URL(current.origin + current.pathname)
    url.searchParams.set('view', destination)
    return url.toString()
  }
  if (!destination) return current.toString()

  const url = new URL(destination.path || current.pathname, current.origin)
  if (url.origin !== current.origin) throw new Error('AUTH_REDIRECT_ORIGIN_MISMATCH')
  url.search = stringifyQuery(destination.query || {})
  url.hash = destination.hash || ''
  return url.toString()
}

/** OIDC end-session 之后回到本页（浏览器专用；Android 不导航，回跳地址被忽略）。 */
function logoutRedirectUri() {
  return window.location.origin + window.location.pathname
}

/**
 * 两个 provider 的 login 都接受 redirectUri，但语义刻意不对称：
 * - 浏览器：redirect 回到明确 view 或完整 router location，场景 query 必须保留。
 * - Android：OIDC 在 external browser 里完成、WebView 从不导航，provider 直接忽略该 URI；
 *   登录结果由 `wotbtoolsOnAuthChanged` 就地把状态同步回来，页面停在原地，
 *   当前 view 天然保留，所以 `view` 对 Native 侧没有任何意义。
 *
 * bootstrap 仍在进行或已失败时：放弃那一代并重建（浏览器走不带 check-sso 的
 * login-recovery），旧 promise 既不能阻塞本次跳转，也不能写回当前状态。
 */
async function login(destination = 'profile') {
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
  await provider.logout(logoutRedirectUri())
  // 浏览器 provider 立刻导航到 OIDC end-session，refs 无需更新；
  // Android 的 WebView 不导航（Native 清会话），必须把本地状态落回未登录。
  if (provider.name === 'android') applyProviderState(provider)
}

function isAuthenticated() {
  return authenticated.value
}

function hasRole(role) {
  return Boolean(role) && Array.isArray(tokenParsed.value?.realm_access?.roles)
    && tokenParsed.value.realm_access.roles.includes(role)
}

/**
 * `wotbtools-admin` 用于管理入口与现有 Tankopedia 入口策略；Replay capabilities 不依赖角色。
 */
const isAdmin = computed(() => hasRole('wotbtools-admin'))

/** 名人堂审核权限：`HoF-admin` 或全站管理员。 */
const isHofAdmin = computed(() => hasRole('HoF-admin') || isAdmin.value)

/**
 * 展示名（顶栏账户入口 / 个人中心）：Keycloak `display-name-mapper` 映射的 `displayName`
 * （WG 官方昵称 / QQ 昵称）。`preferred_username` 是内部登录名（形如 `wg_eu_572253806`），
 * 只在 claim 缺失时兜底，绝不作为首选展示。
 */
const displayName = computed(
  () => tokenParsed.value?.displayName || tokenParsed.value?.preferred_username || '',
)

/** 当前 provider 缓存的 access token（Android 侧由 authGetAccessToken 续期并回写）。 */
function token() {
  return currentTransaction?.provider?.token() || ''
}

/** Keep the token valid for at least minValidity seconds when the user is signed in. */
async function ensureToken(minValidity = 30) {
  const provider = currentTransaction?.provider
  if (!provider || !provider.authenticated) return false
  let refreshed
  try {
    refreshed = await provider.ensureToken(minValidity)
  } catch {
    refreshed = false
  }
  if (currentTransaction?.provider !== provider) return false
  if (!refreshed) {
    // Native may retain an offline session while denying a usable API token.
    if (provider.name === 'android') applyProviderState(provider)
    else {
      authenticated.value = false
      tokenParsed.value = null
      authInitState.value = 'unauthenticated'
    }
    return false
  }
  // 刷新后 claims 可能变化（角色 / displayName）：重新投影 provider 的当前 claims。
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
    hasRole,
    isAdmin,
    isHofAdmin,
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
