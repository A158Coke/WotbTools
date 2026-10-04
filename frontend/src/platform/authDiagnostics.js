/**
 * Web 认证链路的**安全诊断**（2.1.0 Phase 2.5）：
 *
 * 目的：`cookie_not_found` / `Failed to verify login action` 集中在 Keycloak 的
 * IdP / first-broker-login 阶段，但 SPA 在登录期间会整页跳走，回来时只剩 URL 上的
 * OIDC 参数——这里把「SPA 能看到的少数事实」以**布尔 / 枚举**形式落成 breadcrumbs，
 * 与 Keycloak 侧事件（时间线）对齐后即可定位断点（详见 docs/auth/web-qq-diagnostics.md）。
 *
 * 字段纪律（与计划 Phase 2.5 一致，review 的红线）：
 * - 允许：事件名、generation、平台、redirect 类别、URL 参数**存在性布尔**、
 *   Keycloak 的错误**码**（固定枚举，如 identity_provider_login_failure / access_denied）。
 * - 禁止：任何 cookie 值、authorization code、token、refresh token、state/nonce 的
 *   **值**、PKCE verifier、QQ openid。实现上只读参数的存在性，从不复制参数值。
 *
 * 输出：`console.info('[auth-diag]', <json>)`（可 grep）+ 30 条环形缓冲
 * （`window.__authDiag?.snapshot()` 供支持排障导出；无 ?debug 门槛——诊断本身不含敏感值）。
 */

const BUFFER_LIMIT = 30
const buffer = []

/** Keycloak/OIDC 错误码是固定枚举，允许出现在诊断里；未知码原样保留（仍是码不是值）。 */
export function errorCategory(search) {
  let error = ''
  for (const [key, value] of new URLSearchParams(search || '')) {
    if (key === 'error') error = String(value || '')
  }
  return error
}

/** URL 参数存在性布尔（只读存在性，永不复制参数值）。 */
export function returnParamFacts(search) {
  const params = new URLSearchParams(search || '')
  return {
    hasCode: params.has('code'),
    hasState: params.has('state'),
    hasSessionState: params.has('session_state'),
    hasError: params.has('error'),
    error: params.has('error') ? errorCategory(search) : 'none',
    // iss（Keycloak 4.1+ 的 OpenID Discovery 扩展）出现 = 回程经过 Keycloak 的
    // 标准错误/成功返回； absence 说明用户是手动返回或未到达 Keycloak。
    hasIss: params.has('iss'),
  }
}

export function record(event, fields = {}) {
  const entry = { at: new Date().toISOString(), event, ...fields }
  // 先序列化再入缓冲：缓冲里的每一项都是 JSON 安全的（快照导出永不炸），
  // 序列化失败则整条丢弃——诊断绝不反噬登录。
  try {
    const line = JSON.stringify(entry)
    buffer.push(JSON.parse(line))
    if (buffer.length > BUFFER_LIMIT) buffer.shift()
    console.info('[auth-diag]', line)
  } catch {
    // 序列化失败（不该发生）：静默丢弃本条。
  }
  return entry
}

/** 登录跳转前的最后一个 SPA 侧事实（之后整页离开，直到回程）。
 *  redirectUri 是本站 URL：只记 view 参数与路径，不记录完整 URL（纪律：最小事实）。 */
export function recordLoginStart(redirectUri) {
  let destination = 'invalid'
  try {
    const url = new URL(redirectUri, typeof window !== 'undefined' ? window.location.origin : 'https://wotbtools.invalid')
    destination = url.searchParams.get('view') || url.pathname
  } catch {
    destination = 'invalid'
  }
  return record('login_started', { destination })
}

/** 回程 / check-sso 时读取当前 URL：OIDC 参数存在性布尔（含错误码枚举）。 */
export function recordReturnFacts(search = typeof window !== 'undefined' ? window.location.search : '') {
  return record('return_facts', returnParamFacts(search))
}

/** 支持排障导出：只含上面记录过的字段，天然无敏感值。 */
export function snapshot() {
  return [...buffer]
}

/** 测试专用：清空环形缓冲。 */
export function __resetAuthDiagnosticsForTest() {
  buffer.length = 0
}
