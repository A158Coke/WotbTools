// 用户域 transport（原 api-boost.js 中真正的用户域部分）。
//
// Boost 产品域已下线；本模块只承载 `user` 域端点（profile / wotb-account），
// 与后端 `com.wotb.web.user` 域一一对应。鉴权与错误语义与迁移前逐字一致：
// 401 ⇒ 触发 login 并抛出可解析错误；204 ⇒ null；其余非 2xx ⇒ 抛出可解析错误。
import { useAuth } from '../composables/useAuth.js'
import { apiErrorFromResponse, apiFetch } from './http.js'

async function userJsonHeaders() {
  const { token, ensureToken } = useAuth()
  await ensureToken(30)
  const accessToken = token()
  return accessToken ? { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } : { 'Content-Type': 'application/json' }
}

async function userHandle(r) {
  if (r.status === 401) {
    const { login } = useAuth()
    login()
    throw await apiErrorFromResponse(r)
  }
  if (!r.ok) {
    throw await apiErrorFromResponse(r)
  }
  if (r.status === 204) return null
  return r.json()
}

// ========== User Profile ==========
export async function getUserProfile() {
  return userHandle(await apiFetch('/api/users/profile', { headers: await userJsonHeaders() }))
}

/**
 * 幂等 ensure 当前用户的业务资料（PUT 语义，不是 create）：
 * 已存在 → 200 原样返回且不改任何绑定；不存在 → 按 canonical provisioning 创建。
 * 身份只取自当前 JWT，请求不发 body，因此无法冒充他人。
 * canonical owner 是全局 business bootstrap（useBusinessUserBootstrap），页面不自行调用。
 */
export async function ensureUserProfile() {
  return userHandle(await apiFetch('/api/users/profile', { method: 'PUT', headers: await userJsonHeaders() }))
}

export async function updateUserWotbAccount(body) {
  return userHandle(await apiFetch('/api/users/wotb-account', { method: 'PATCH', headers: await userJsonHeaders(), body: JSON.stringify(body) }))
}

export async function deleteUserWotbAccount() {
  return userHandle(await apiFetch('/api/users/wotb-account', { method: 'DELETE', headers: await userJsonHeaders() }))
}

/** WG ASIA 登录后的幂等同步：只读当前 JWT，昵称变化时刷新资料。 */
export async function syncUserWotbAccountFromLogin() {
  return userHandle(await apiFetch('/api/users/wotb-account/from-login', { method: 'PUT', headers: await userJsonHeaders() }))
}

export async function getUserHofRecords() {
  return userHandle(await apiFetch('/api/users/profile/records', { headers: await userJsonHeaders() }))
}
