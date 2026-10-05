import Keycloak from 'keycloak-js'
import { record, recordLoginStart, recordReturnFacts } from './authDiagnostics.js'

const KEYCLOAK_CONFIG = Object.freeze({
  url: 'https://auth.wotbtools.com',
  realm: 'wotbtools',
  clientId: 'wotbtools-web',
})

/**
 * 普通浏览器的认证 owner：keycloak-js 全量 OIDC 流程仍在页面内跑（web 行为与迁移前一致）。
 * Android WebView **绝不**使用本 provider —— 由 useAuth.js 的运行时选择决定（见 androidAuthProvider.js）。
 *
 * 每个 provider 实例懒加载自己的 adapter：一次 init transaction 一个实例，
 * 因此 retry / login-recovery 拿到的是全新 adapter，被放弃的一代无法写回新状态。
 */
export function createBrowserAuthProvider() {
  let keycloak = null
  // A failed refresh must not immediately destroy the browser's projected identity.
  // keycloak-js does not expose a stable OAuth-vs-transport error contract from updateToken(),
  // so treating every rejection as a terminal session loss causes transient network/KC failures
  // to bounce users back through the external IdP (notably visible as repeated QQ login).
  // While refresh is unhealthy we withhold the access token from API callers, but keep the
  // adapter/refresh token intact so the next ensureToken() can retry naturally.
  let accessTokenUsable = true

  function adapter() {
    if (!keycloak) keycloak = new Keycloak(KEYCLOAK_CONFIG)
    return keycloak
  }

  return {
    name: 'web',

    /**
     * `normal`：check-sso —— 已有 SSO 会话时静默登录，未登录**不跳转**（保持迁移前语义）。
     * `login-recovery`：watchdog 放弃上一代后的重建，不再重复 check-sso bootstrap。
     */
    async init({ mode } = {}) {
      // 回程取证（2.1.0 Phase 2.5）：整页登录回来后，URL 上的 OIDC 参数存在性是
      // 「断在哪一跳」的关键事实——放在 adapter init 之前，失败路径也留痕。
      recordReturnFacts(window.location.search)
      const options = mode === 'login-recovery'
        ? {
            pkceMethod: 'S256',
            checkLoginIframe: false,
          }
        : {
            onLoad: 'check-sso',
            pkceMethod: 'S256',
            silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
            checkLoginIframe: false,
          }
      await adapter().init(options)
    },

    get authenticated() {
      return Boolean(keycloak?.authenticated)
    },

    get tokenParsed() {
      return keycloak?.tokenParsed || null
    },

    token() {
      return accessTokenUsable ? (keycloak?.token || '') : ''
    },

    /** 浏览器：redirect 真的会回到本页，redirectUri 由调用方（SPA 自己）决定并保留 view。 */
    login(redirectUri) {
      recordLoginStart(typeof redirectUri === 'string' ? redirectUri : null)
      return adapter().login({ redirectUri })
    },

    logout(redirectUri) {
      return adapter().logout({ redirectUri })
    },

    /**
     * keycloak-js 的 updateToken() rejection 不提供稳定、可依赖的错误分类契约：
     * transport failure 与服务端拒绝都可能表现为 rejection。这里 fail closed 于 API token
     * （token() 暂时返回空），但不把一次 rejection 等价成 logout；保留 adapter 的 refresh
     * state，让后续请求自然重试。真正的 session truth 会在 reload/check-sso 或显式 logout
     * 时由 Keycloak 收敛。
     */
    async ensureToken(minValidity = 30) {
      const kc = keycloak
      if (!kc || !kc.authenticated) return false
      try {
        await kc.updateToken(minValidity)
        accessTokenUsable = true
        return true
      } catch (error) {
        accessTokenUsable = false
        console.warn('[auth] browser_refresh_failed session=retained token=withheld')
        return false
      }
    },

    /** 浏览器里 auth 变化只能由页面自己感知（redirect / check-sso），没有 Native 推送。 */
    onAuthChanged() {
      return () => {}
    },
  }
}
