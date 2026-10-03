import { NATIVE_AUTH_CHANGED_GLOBAL, NATIVE_AUTH_METHODS } from './nativeBridgeContract.js'
import { callBridge } from '../composables/usePlatformBridge.js'

/**
 * native-auth RPC 的单次上限：Android 侧可能在回复前做 OIDC discovery + token refresh
 * （真实网络往返），5s 的通用默认预算不够；超时仍按「本次 auth 操作失败」处理，绝不挂起。
 */
const NATIVE_AUTH_TIMEOUT_MS = 20_000

/** init / authChanged 重新同步时要求的最小剩余有效期（与 keycloak-js 时代一致）。 */
const AUTH_TOKEN_MIN_VALIDITY_SECONDS = 30

const AUTH_RPC_OPTIONS = Object.freeze({ timeoutMs: NATIVE_AUTH_TIMEOUT_MS })

/**
 * Android 壳的认证 owner：OIDC 会话在 Native（AppAuth + external user-agent），
 * WebView 只经 bridge v2 读取状态 / 触发登录登出，**从不导航、从不构造 keycloak-js**。
 *
 * 调用方（useAuth.js）已确认 bridge v2 + `native-auth` 能力；这里只做协议映射。
 */
export function createAndroidAuthProvider() {
  let authenticated = false
  let claims = null
  let accessToken = ''
  let generation = 0

  function clear() {
    generation += 1
    authenticated = false
    claims = null
    accessToken = ''
    return false
  }

  /**
   * `authGetAccessToken` 的返回值是 token / claims 的唯一事实源：
   * Transient refresh failure invalidates the API token, not the Native-owned cached session.
   * Only a confirmed Native logout or malformed reply clears the local projection.
   */
  async function applyTokenReply(reply, expectedGeneration) {
    if (generation !== expectedGeneration) return false
    if (reply?.error === 'refresh-failed') {
      accessToken = ''
      const state = await callBridge(NATIVE_AUTH_METHODS.getState, {}, AUTH_RPC_OPTIONS)
      if (generation !== expectedGeneration) return false
      if (state?.authenticated !== true) return clear()
      authenticated = true
      return false
    }
    if (reply?.error || typeof reply?.token !== 'string' || !reply.token) return clear()
    authenticated = true
    accessToken = reply.token
    claims = reply.claims && typeof reply.claims === 'object' ? reply.claims : null
    return true
  }

  function readAccessToken(minValiditySeconds) {
    return callBridge(
      NATIVE_AUTH_METHODS.getAccessToken,
      { minValiditySeconds },
      AUTH_RPC_OPTIONS,
    )
  }

  /**
   * 唯一的状态加载路径：init 与 Native 的 authChanged 推送共用。
   * Native reports whether a cached session remains when refreshing cannot reach the server.
   */
  async function syncFromNative() {
    const expectedGeneration = ++generation
    const state = await callBridge(NATIVE_AUTH_METHODS.getState, {}, AUTH_RPC_OPTIONS)
    if (generation !== expectedGeneration) return false
    if (state?.authenticated !== true) return clear()
    return applyTokenReply(await readAccessToken(AUTH_TOKEN_MIN_VALIDITY_SECONDS), expectedGeneration)
  }

  return {
    name: 'android',

    async init() {
      await syncFromNative()
    },

    get authenticated() {
      return authenticated
    },

    get tokenParsed() {
      return claims
    },

    token() {
      return accessToken
    },

    /**
     * Native 用 external user-agent 打开授权页并立刻返回；redirectUri / view 因此无意义
     * （WebView 不导航，登录结果经 wotbtoolsOnAuthChanged 就地把状态同步回来）。
     */
    async login() {
      generation += 1
      return (await callBridge(NATIVE_AUTH_METHODS.login, {}, AUTH_RPC_OPTIONS)) === true
    },

    async logout() {
      // Invalidate pending token/state replies before the logout RPC can finish.
      clear()
      await callBridge(NATIVE_AUTH_METHODS.logout, {}, AUTH_RPC_OPTIONS)
    },

    async ensureToken(minValidity = AUTH_TOKEN_MIN_VALIDITY_SECONDS) {
      if (!authenticated) return false
      const expectedGeneration = generation
      return applyTokenReply(await readAccessToken(minValidity), expectedGeneration)
    },

    /**
     * Native 完成 login / logout 后调用页面全局 `wotbtoolsOnAuthChanged`（WebView 停在原页面）。
     * 推送不携带 payload：状态一律回读 Native，再通知 owner 重新投影。
     * 返回的退订函数会把全局槽位清掉（仅当它仍属于本次订阅）。
     */
    onAuthChanged(cb) {
      if (typeof window === 'undefined') return () => {}
      let subscribed = true
      const handler = async () => {
        await syncFromNative()
        if (subscribed) cb()
      }
      window[NATIVE_AUTH_CHANGED_GLOBAL] = handler
      return () => {
        subscribed = false
        generation += 1
        if (window[NATIVE_AUTH_CHANGED_GLOBAL] === handler) delete window[NATIVE_AUTH_CHANGED_GLOBAL]
      }
    },
  }
}

/**
 * Android 壳报告 bridge v1 / 版本未知 / 缺 `native-auth` 能力时的 fail-closed provider。
 *
 * 该客户端的认证 owner 仍是 WebView 里的 keycloak-js（bridge v1 时代），而本前端已经
 * 删除了那条路径：这里只把失败显式暴露给 `useAuth` 的 initError / initFailureReason /
 * authInitState，由既有 UI 提示；强制更新由 Native 的 mandatory-update gate 负责。
 * **绝不构造 keycloak-js，绝不导航 WebView。**
 */
export function createUnsupportedAuthProvider(reason) {
  function unsupportedError() {
    const error = new Error(`NATIVE_AUTH_UNSUPPORTED: ${reason}`)
    error.name = 'NATIVE_AUTH_UNSUPPORTED'
    error.code = 'NATIVE_AUTH_UNSUPPORTED'
    error.reason = reason
    return error
  }

  return {
    name: 'android-unsupported',

    authenticated: false,
    tokenParsed: null,

    token() {
      return ''
    },

    async init() {
      throw unsupportedError()
    },

    async login() {
      throw unsupportedError()
    },

    /** 没有可结束的 Native 会话：不抛错，也不做任何导航（保持登出按钮不会挂）。 */
    async logout() {},

    async ensureToken() {
      return false
    },

    onAuthChanged() {
      return () => {}
    },
  }
}
