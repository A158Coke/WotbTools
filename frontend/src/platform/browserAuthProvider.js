import Keycloak from 'keycloak-js'

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
      return keycloak?.token || ''
    },

    /** 浏览器：redirect 真的会回到本页，redirectUri 由调用方（SPA 自己）决定并保留 view。 */
    login(redirectUri) {
      return adapter().login({ redirectUri })
    },

    logout(redirectUri) {
      return adapter().logout({ redirectUri })
    },

    /** 刷新失败（refresh token 失效 / 网络）向上抛，由 useAuth 落回未登录。 */
    async ensureToken(minValidity = 30) {
      const kc = keycloak
      if (!kc || !kc.authenticated) return false
      await kc.updateToken(minValidity)
      return true
    },

    /** 浏览器里 auth 变化只能由页面自己感知（redirect / check-sso），没有 Native 推送。 */
    onAuthChanged() {
      return () => {}
    },
  }
}
