import { computed, ref } from 'vue'

/**
 * `src/composables/useAuth.js` 的浏览器测试替身。
 *
 * 只被 `scripts/browser-workspace-interaction.mjs` 启动的 Vite 实例通过 `resolve.alias`
 * 载入；生产 bundle 永不包含本文件。替代范围严格限定在「Keycloak 网络边界」：
 * 认证态、login 发起、失败模式；其余（router / AppShell / ReplayWorkspace / 全部 CSS）
 * 都是真实生产代码。
 *
 * 行为由 URL query 驱动，便于同一个真实页面覆盖多种认证场景：
 *   ws-auth=0|1          → 未登录 / 已登录（默认 1）
 *   ws-login=resolve|reject → login() 成功发起 / provider 拒绝
 *   ws-roles=a,b         → tokenParsed.realm_access.roles
 *
 * 可观测面挂在 `window.__wsAuth`，供 harness 断言（不记录任何用户敏感信息）。
 */
const params = new URLSearchParams(window.location.search)
const authenticated = ref(params.get('ws-auth') !== '0')
const initialized = ref(true)
const initError = ref(null)
const loginInFlight = ref(false)
const tokenParsed = ref({
  preferred_username: 'fixture-user',
  realm_access: { roles: String(params.get('ws-roles') || '').split(',').filter(Boolean) },
})

const loginCalls = []
const loginMode = params.get('ws-login') === 'reject' ? 'reject' : 'resolve'
const initPromise = Promise.resolve(authenticated.value)

const state = {
  loginCalls,
  authenticated,
  loginInFlight,
  loginMode,
  lastLoginError: null,
}
window.__wsAuth = state

async function initAuth() {
  return initPromise
}

async function login(view = 'profile') {
  loginCalls.push(view)
  state.lastLoginError = null
  if (loginMode === 'reject') {
    state.lastLoginError = 'fixture-provider-rejected'
    throw new Error('fixture login rejected')
  }
  return true
}

async function logout() {
  authenticated.value = false
  return true
}

function isAuthenticated() {
  return authenticated.value
}

function hasRole(role) {
  const roles = tokenParsed.value?.realm_access?.roles
  return Boolean(role) && Array.isArray(roles) && roles.includes(role)
}

function userName() {
  return tokenParsed.value?.preferred_username || ''
}

function token() {
  return authenticated.value ? 'fixture-access-token' : ''
}

async function ensureToken() {
  return authenticated.value
}

export function useAuth() {
  return {
    keycloak: null,
    initAuth,
    initPromise,
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
    tokenParsed,
    initError,
    displayName: computed(() => userName()),
  }
}
