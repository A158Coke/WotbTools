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
import { useConnectivity } from './useConnectivity.js'
import { ConnectivityState } from '../platform/connectivity.js'

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
  initialized.value = true
  projectSession({ isAuthenticated: false, parsedToken: null, state: 'failed' })
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
 * **身份/session 归属代数**（与 init 交易代数 `authGeneration` 无关）：
 * 业务侧的在途请求用它判定「结果还属不属于当前账号」。
 *
 * 前进时机 = 有效身份边界变化：未登录 → 已登录、已登录 → 未登录、A → B（`sub` 变化）。
 * 刻意**不**绑定 init 交易代数：Native `authChanged` 登录成功、logout、账号切换都发生在
 * 同一笔 init 交易里，交易代数不会前进（review blocker 2）。
 * 同一身份的重复投影（如 token 刷新后 claims 更新）不前进。
 */
let authIdentityEpoch = 0
let projectedIdentity = null

/** 身份键：已登录取 token 的 `sub`（缺失时用占位键——仍是"已登录"这个身份），未登录为 null。 */
function identityKeyOf(isAuthenticatedValue, parsedToken) {
  if (!isAuthenticatedValue) return null
  const sub = parsedToken && typeof parsedToken === 'object' ? parsedToken.sub : null
  return typeof sub === 'string' && sub ? `sub:${sub}` : 'authenticated:unknown-sub'
}

/**
 * 唯一的投影写入路径：init 落定、Native 推送（`wotbtoolsOnAuthChanged`）、logout、
 * ensureToken 失效都经这里，`authIdentityEpoch` 因而覆盖所有身份变化。
 */
function projectSession({ isAuthenticated: isAuthed, parsedToken, state }) {
  const nextIdentity = identityKeyOf(isAuthed, parsedToken)
  if (nextIdentity !== projectedIdentity) {
    projectedIdentity = nextIdentity
    authIdentityEpoch += 1
  }
  authenticated.value = isAuthed
  tokenParsed.value = parsedToken || null
  authInitState.value = state || (isAuthed ? 'authenticated' : 'unauthenticated')
}

/**
 * 把 provider 的当前状态投影到组件可见的 refs。init 落定、Native 推送
 * （`wotbtoolsOnAuthChanged`）与 Android logout 共用这一条投影路径：只有一个状态 owner。
 */
function applyProviderState(provider) {
  const isAuthed = Boolean(provider.authenticated)
  projectSession({ isAuthenticated: isAuthed, parsedToken: isAuthed ? provider.tokenParsed : null })
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
  initialized.value = false
  projectSession({ isAuthenticated: false, parsedToken: null, state: 'initializing' })
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

/**
 * 首次 auth bootstrap 的**落定信号**（`initPromise` 的来源）。
 *
 * 只表达「这次初始化已经结束」（成功 / 失败 / 被放弃都算落定），**不表达当前登录态**：
 * `currentTransaction` 是模块级的一次性 init 交易，`logout()` 只把 reactive session 投影成
 * unauthenticated —— 既不会重建它，也不会改写它已经 resolve 的结果。所以从这里读出来的
 * 任何值都只是**第一次 init 时的历史快照**，登出 / 账号切换之后立刻失效。
 *
 * 登录态一律只认 reactive `isAuthenticated()` / `authenticated`。为了让「历史 promise 的
 * 值 == session truth」在结构上不可能发生，这里刻意**不 resolve 值**（恒为 undefined）。
 *
 * 反例（Android 2.1.0 真机）：ProfilePage remount 时 `const loggedIn = await initPromise`
 * 拿到历史 true → 误进 done → 当前 session 其实是未登录 → 永久停在「正在初始化登录…」。
 */
async function initAuth() {
  if (currentTransaction) {
    await currentTransaction.promise
    return
  }
  // 离线登出后远端会话未收敛：本次不静默 check-sso（否则会被悄悄登回去）；
  // 用户显式点登录时由 login() 清标记并照常走登录。
  if (hasPendingRemoteLogout()) {
    console.warn('[auth] init_skip_check_sso reason=pending-remote-logout')
    await startAuthInit({ mode: 'login-recovery', reason: 'pending-remote-logout' })
    return
  }
  await startAuthInit()
}

/**
 * 新建一代 init 交易。返回值是**那一次** init 的结果，同样不是当前 session truth
 * （`retryAuth()` 目前没有生产消费方；新代码不要用它的 resolve 值判断登录态）。
 */
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

/** OIDC end-session 之后回到 **HOME**（2.1.0 Phase 5.3：登出落点固定首页，
 *  不保留登出前的 view——`?view=profile` 那种回跳会把用户又带回个人中心）。
 *  浏览器专用；Android 不导航，回跳地址被忽略（App 侧落点由 SPA 自己收敛）。 */
function logoutRedirectUri() {
  return window.location.origin + '/'
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
    // 用户显式登录：清掉"远端登出未完成"标记（这次登录本身就会重建会话）
    clearPendingRemoteLogout()
    return await transaction.provider.login(loginRedirectUri(destination))
  } finally {
    loginInFlight.value = false
  }
}

/**
 * 登出分两层，**本地会话清理恒执行，远端 end-session 才是 best effort**（review blocker 1）：
 *
 * ```text
 * 1. 先清 SPA 投影（当前页面立即 signed-out，不等任何网络往返）
 * 2. Android：provider.logout() = bridge authLogout —— Native 侧**先清本地会话（Keystore）**
 *    再 best-effort 打开 end-session；本地清理不依赖网络，所以离线也必须调用。
 *    跳过它 = Native 会话残留，重启 / auth 同步会把用户"复活"成已登录。
 * 3. Web：provider.logout() 的全部作用就是**导航到远端 end-session 页**；离线时这次导航
 *    只会撞出浏览器的错误页，因此离线只跳过导航本身，本地投影已清。残留的 Keycloak SSO
 *    cookie 由 `pendingRemoteLogout` 标记兜住：下次 init 不再静默 check-sso 复登
 *    （否则离线登出会被下一次刷新悄悄撤销），用户显式点登录才会清标记。
 * ```
 */
async function logout() {
  const provider = currentTransaction?.provider
  if (!provider) {
    console.warn('[auth] logout_skipped reason=no-provider')
    return
  }
  // 1) 本地投影先行（Phase 5.4）
  projectSession({ isAuthenticated: false, parsedToken: null })

  if (provider.name === 'android') {
    // 2) Native 本地会话清理是**强制**步骤（远端 end-session 在 Native 内部自己 best-effort）
    await provider.logout(logoutRedirectUri())
    applyProviderState(provider)
    return
  }

  if (offlineKnown()) {
    // 3) Web 离线：跳过远端导航，但记下"远端登出未完成"——否则恢复在线后的下一次
    //    check-sso 会把用户静默登回去，登出就不"永久"了。
    markPendingRemoteLogout()
    console.warn('[auth] logout_offline reason=end-session-navigation-skipped')
    return
  }
  clearPendingRemoteLogout()
  await provider.logout(logoutRedirectUri())
}

/**
 * 「远端 end-session 尚未完成」标记（仅浏览器离线登出会置位）。
 * 存 localStorage：登出意图必须跨刷新存活，否则下一次加载就会把用户静默登回去。
 */
const PENDING_REMOTE_LOGOUT_KEY = 'wotb-auth-pending-remote-logout'

function markPendingRemoteLogout() {
  try { localStorage.setItem(PENDING_REMOTE_LOGOUT_KEY, '1') } catch { /* 隐私模式：降级为会话内语义 */ }
}

function clearPendingRemoteLogout() {
  try { localStorage.removeItem(PENDING_REMOTE_LOGOUT_KEY) } catch { /* 同上 */ }
}

/** 是否处于「离线登出后、远端会话未收敛」状态：init 不静默复登。 */
function hasPendingRemoteLogout() {
  try { return localStorage.getItem(PENDING_REMOTE_LOGOUT_KEY) === '1' } catch { return false }
}

function isAuthenticated() {
  return authenticated.value
}

/** 只有确定离线才跳过网络动作：unknown / degraded / service-unavailable 仍按在线语义尝试
 *  （unknown ≠ offline——否则「连接未知」会被误当成离线，静默跳过 end-session / 保留失效会话）。 */
function offlineKnown() {
  return useConnectivity().connectivity.value === ConnectivityState.OFFLINE
}

/**
 * ⚠️ [本机测试旁路·提交前请还原] `git checkout -- frontend/src/composables/useAuth.js`
 *
 * 本地账号没有 `wotbtools-admin` / `HoF-admin` realm 角色时，admin 视图会被
 * `viewFromRoute` 收敛回默认视图、导航里也不出现入口。dev 构建下显式带
 * `?admin=1` 即把这两个角色视为已持有：
 *  - 生产构建 `import.meta.env.DEV === false` → 恒为 false，门禁原样生效（无产品行为变化）；
 *  - vitest 环境无 query（jsdom 默认 URL）→ 同样为 false，角色断言不受影响。
 * 它只改**前端可见性**：后端仍按真实 token 鉴权，越权调用照样 401/403。
 */
const DEV_ADMIN_ROLES = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('admin')

function hasRole(role) {
  if (DEV_ADMIN_ROLES && (role === 'wotbtools-admin' || role === 'HoF-admin')) return true
  return Boolean(role) && Array.isArray(tokenParsed.value?.realm_access?.roles)
    && tokenParsed.value.realm_access.roles.includes(role)
}

/**
 * `wotbtools-admin` 用于管理入口与现有 Tankopedia 入口策略；Replay capabilities 不依赖角色。
 */
const isAdmin = computed(() => hasRole('wotbtools-admin'))

/** 名人堂审核权限：`HoF-admin` 或全站管理员。 */
const isHofAdmin = computed(() => hasRole('HoF-admin') || isAdmin.value)

/** Real token claims are the shared tournament boundary; local visibility shortcuts never authorize it. */
export function tournamentAdminAllowed(auth = useAuth()) {
  const roles = auth.tokenParsed.value?.realm_access?.roles
  return auth.authenticated.value && Array.isArray(roles)
    && roles.includes('tournament-admin')
}
const isTournamentAdmin = computed(() => tournamentAdminAllowed({ authenticated, tokenParsed }))

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

/** 当前**身份代数**（未登录→已登录 / 已登录→未登录 / A→B 各前进一次）：业务侧在途请求的
 *  归属判定用。请求发起时记下 epoch，await 之后必须复核——不相等即身份已变，迟到结果不得写入。
 *  与 `authGeneration`（init 交易代数）不同：后者在同一身份内的重试 / 推送里不前进。 */
function authEpoch() {
  return authIdentityEpoch
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
    // 离线 / 连接未知时的刷新失败是**瞬时**失败（Phase 9.3）：绝不能销毁有效缓存身份
    // ——本地功能继续用缓存会话，恢复在线后由下一次 ensureToken 自然收敛。
    // 只有**明确离线**才保留缓存身份（unknown ≠ offline：连接未知时按老行为收敛为未登录，
    // 避免把「后端拒绝刷新」误当网络问题而长期挂着失效会话）。
    if (offlineKnown()) {
      console.warn(`[auth] refresh_failed_offline generation=${authGeneration} session=retained`)
      return false
    }
    // Native may retain an offline session while denying a usable API token.
    if (provider.name === 'android') applyProviderState(provider)
    else {
      projectSession({ isAuthenticated: false, parsedToken: null })
    }
    return false
  }
  // 刷新后 claims 可能变化（角色 / displayName）：重新投影 provider 的当前 claims
  // （同一身份 → 身份代数不前进）。
  tokenParsed.value = provider.tokenParsed || null
  return true
}

export function useAuth() {
  return {
    initAuth,
    // 只表示「auth bootstrap 已落定」这个**事件**，resolve 值为 undefined：
    // 它是模块级一次性的，logout 不会重建它，所以绝不能拿它的值当 session truth。
    // 需要登录态请读 isAuthenticated() / authenticated（见 initAuth 注释）。
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
