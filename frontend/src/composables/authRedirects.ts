/** 浏览器 login/logout 重定向地址（拆分自 useAuth.ts，行为原样）。 */
import { stringifyQuery, type LocationQueryRaw } from 'vue-router'
import { hasAuthReturn } from '../platform/authDiagnostics.js'

/** 浏览器登录目的地：同一 view 保留上下文，也接受完整 router location（仅本站）。 */
export type LoginDestination = string | { path?: string; query?: LocationQueryRaw; hash?: string } | null | undefined

/** 浏览器登录目的地：同一 view 保留上下文，也接受完整 router location（仅本站）。 */
export function loginRedirectUri(destination: LoginDestination) {
  const current = new URL(window.location.href)
  let url: URL
  if (typeof destination === 'string') {
    url = current.searchParams.get('view') === destination
      ? current
      : new URL(current.origin + current.pathname)
    url.searchParams.set('view', destination)
  } else if (!destination) {
    url = current
  } else {
    url = new URL(destination.path || current.pathname, current.origin)
    if (url.origin !== current.origin) throw new Error('AUTH_REDIRECT_ORIGIN_MISMATCH')
    url.search = stringifyQuery(destination.query || {})
    url.hash = destination.hash || ''
  }
  // Explicit restart must not carry an unconsumed query callback into its new redirect.
  // Preserve product context and ordinary anchors; the SDK owns the new transaction.
  if (hasAuthReturn({ search: url.search, hash: '' })) {
    for (const key of ['code', 'state', 'session_state', 'iss', 'error', 'error_description',
      'error_uri', 'kc_action_status', 'kc_action']) url.searchParams.delete(key)
  }
  return url.toString()
}

/** OIDC end-session 之后回到 **HOME**（2.1.0 Phase 5.3：登出落点固定首页，
 *  不保留登出前的 view——`?view=profile` 那种回跳会把用户又带回个人中心）。
 *  浏览器专用；Android 不导航，回跳地址被忽略（App 侧落点由 SPA 自己收敛）。 */
export function logoutRedirectUri() {
  return window.location.origin + '/'
}
