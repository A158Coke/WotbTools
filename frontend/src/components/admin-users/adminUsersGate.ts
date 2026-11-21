/**
 * AdminUsersPage —— 门禁与认证（拆分自 AdminUsersPage.vue，行为原样）。
 * 本页所有 backend 动作的**唯一**门禁（PR 467 review blocker）。
 */
import { ApiError } from '../../utils/http.js'
import { apiErrorCodeLabel, apiErrorLabel } from '../../utils/display.js'
import type { useI18n } from 'vue-i18n'

type Translate = ReturnType<typeof useI18n>['t']
type GateContext = {
  gate: () => boolean
  initPromise: Promise<unknown>
  ensureAuthToken: (minimumValiditySeconds: number) => Promise<boolean>
  login: () => void
  t: Translate
  te: (key: string) => boolean
}

/**
 * 用户管理整页都是 Keycloak Admin + 本地 user_profile 的聚合，没有任何可离线的本地投影，
 * 因此整体是 ONLINE_REQUIRED —— 但判定只能来自 capability SSOT（`useFeatureGate`），
 * 页面**不写** `connectivity === 'online'`、也不读 `navigator.onLine`：
 *
 * ```text
 * 门禁 → 认证（ensureToken / login） → backend
 * ```
 *
 * 顺序很关键：非-online 时**先**被门禁挡住，所以既不会触发 `login()` 跳转、也不会走 token
 * refresh 的失败路径，更不会发出 admin API 请求（`adminSearchUsers` / `adminGetUser` /
 * `adminDeleteUsers` 调用数恒为 0），用户立刻看到统一 connectivity notice。
 *
 * 已缓存的过期 admin session 仍然保留 claims/role（见 useAuth 的本地投影），因此「Admin Users」
 * 入口继续可见；只是这个页面在离线时不能登录、不能请求 backend。
 */
export function createAdminUsersGate({ gate, initPromise, ensureAuthToken, login, t, te }: GateContext) {
  function requireAdminUsersOnline() {
    return gate()
  }

  function apiError(error: unknown) {
    return apiErrorLabel(t, te, error)
  }

  function errorCodeLabel(code: string) {
    return apiErrorCodeLabel(t, te, code)
  }

  async function ensureToken() {
    await initPromise
    if (!(await ensureAuthToken(5))) {
      login()
      throw new ApiError({ code: 'AUTH_UNAUTHENTICATED', status: 401, retryable: false })
    }
  }

  return { requireAdminUsersOnline, apiError, errorCodeLabel, ensureToken }
}
