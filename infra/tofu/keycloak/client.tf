resource "keycloak_openid_client" "web" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-web"
  name      = "WoTBTools Frontend"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  # Browser client parity with the current production client: the realm login
  # theme applies, the client is always listed in the Account/Admin UI,
  # front-channel logout is on, consent is off, and PKCE is not required
  # ("" is the provider's "no code challenge method" value).
  consent_required            = false
  login_theme                 = "wotbtools"
  always_display_in_console   = true
  frontchannel_logout_enabled = true
  pkce_code_challenge_method  = ""
  # keycloak/keycloak 5.9.0 has no typed field for the Keycloak client attribute
  # "Front-channel logout session required" (frontchannel.logout.session.required,
  # OIDCConfigAttributes in Keycloak 26.6.4). It is declared through the provider's
  # documented extra_config map; Keycloak's own default for it is also true.
  extra_config = {
    "frontchannel.logout.session.required" = "true"
  }

  valid_redirect_uris = [
    "https://wotbtools.com/*",
    "https://*.wotbtools.com/*",
    "http://localhost:5173/*",
    "http://localhost:8088/*",
  ]
  web_origins = [
    "https://wotbtools.com",
    "https://*.wotbtools.com",
    "http://localhost:5173",
    "http://localhost:8088",
  ]

  lifecycle {
    prevent_destroy = true
  }
}

# Android 2.0 起认证 owner 是 Native（AppAuth / RFC 8252，external user-agent + PKCE
# S256），不再是应用内 WebView；因此 Android 必须有自己的 client，绝不能复用
# `wotbtools-web`：
#   1. 浏览器 client 的 `wotbtools.com/*` 通配 redirect 会把 App 的授权码交回站点，
#      而 App Link（https://auth.wotbtools.com/android/oauth/callback）要求**精确**
#      redirect URI，两者不能共存于同一个 client；
#   2. 崩一个不牵连另一个：Android 侧 redirect/flow 变更不得触碰线上 Web 登录的客户端契约。
# 关键契约（改动前先读 docs/current-plan.md「SSOT / 冻结接口」）：
#   - PUBLIC：App 无法保管 client secret；安全边界是 PKCE S256，不是 secret。
#   - 只开 standard flow：implicit / direct access grants 对原生 App 都是降级。
#   - PKCE 由 Keycloak 强制（pkce_code_challenge_method = "S256"），非仅客户端行为。
#   - 无 front-channel logout：登出走 RP-initiated end-session + App Link / 私有 scheme 回跳。
#   - redirect URI 精确、无通配：https App Link 与 com.wotbtools.app:/oauth2redirect，
#     两条 transport 共用同一实现；post-logout 也用同一对值。
#   - 不 pin client scope 列表：realm 默认 client scope 自带 `roles`，Android 因此拿到
#     与 Web 相同的 realm roles（见 roles.tf / realm 默认 scope 配置）。
# 幂等：本资源只创建，不迁移状态——首次 plan 是 create（无 prior state），apply 后
# 第二次 plan 为 no-op；validate-plan.sh 同时接受 create/update、拒绝 delete/replace。
resource "keycloak_openid_client" "android" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-android"
  name      = "WoTBTools Android"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  service_accounts_enabled     = false
  consent_required             = false
  login_theme                  = "wotbtools"
  always_display_in_console    = true
  frontchannel_logout_enabled  = false
  pkce_code_challenge_method   = "S256"

  valid_redirect_uris = [
    "https://auth.wotbtools.com/android/oauth/callback",
    "com.wotbtools.app:/oauth2redirect",
  ]
  # RP-initiated logout (OIDC end-session) returns to the app through the same
  # two transports, so both lists are deliberately the same frozen pair.
  valid_post_logout_redirect_uris = [
    "https://auth.wotbtools.com/android/oauth/callback",
    "com.wotbtools.app:/oauth2redirect",
  ]

  lifecycle {
    prevent_destroy = true
  }
}

resource "keycloak_openid_client" "admin_api" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-admin-api"
  name      = "WoTBTools Backend Admin API"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  client_secret_wo             = var.keycloak_admin_client_secret
  client_secret_wo_version     = var.keycloak_admin_client_secret_version

  lifecycle {
    prevent_destroy = true
  }
}

# Read-only runtime E2E check identity. `deploy/tx/runtime-check.sh` obtains a
# client_credentials token with it and drives the real business chain (processing
# job -> dataset -> map overview -> battle playback -> export) against the live
# production runtime.
# It is deliberately a confidential, service-account-only client with no redirect
# URIs, and it holds exactly one realm role (`wotbtools-user`), so the check can
# prove the user-facing path works while every admin endpoint provably rejects
# this authenticated non-admin principal.
resource "keycloak_openid_client" "e2e" {
  realm_id  = keycloak_realm.wotbtools.id
  client_id = "wotbtools-e2e"
  name      = "WoTBTools Cutover E2E Gate"
  enabled   = true

  access_type                  = "CONFIDENTIAL"
  service_accounts_enabled     = true
  standard_flow_enabled        = false
  implicit_flow_enabled        = false
  direct_access_grants_enabled = false
  client_secret_wo             = var.e2e_client_secret
  client_secret_wo_version     = var.e2e_client_secret_version

  lifecycle {
    prevent_destroy = true
  }
}
