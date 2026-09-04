# Android QQ Auth Return Bridge

## 状态

IMPLEMENTED / PR VALIDATION REQUIRED / PRODUCTION VALIDATION REQUIRED

## 证据

- Android QQ native handoff 已实机证实为 `wtloginmqq://ptlogin`。
- QQ 授权返回时由 QQ 显式启动 `com.android.chrome` 打开 `https://ssl.ptlogin2.qq.com/...`，因此普通 Verified App Link 不能接管这一步。
- `auth.wotbtools.com` App Link 已修复为 `verified`，且手工 ACTION_VIEW 能直接打开 WotBTools；问题是 QQ/Chrome return chain 的 browser-context 切换。
- Keycloak 在 Chrome callback 中报 `IDENTITY_PROVIDER_LOGIN_ERROR error=already_logged_in`，失败发生在 `getAndVerifyAuthenticationSession(state)` 恢复原 AuthenticationSession 之前。

## 实现

1. Juhe `redirect_uri` 改为精确 `/realms/wotbtools/broker/juhe-qq/endpoint/mobile-return?state=...`。
2. 非 Android User-Agent 保持同一 browser context，直接继续现有 broker callback。
3. Android return 在 Keycloak 内签发 2 分钟、单次消费、256-bit 随机 opaque ticket；ticket server-side 保存 `state/type/code`，Android intent 不携带真实 state/code。
4. `mobile-return` 返回需要用户点击的“返回 WotBTools”页面，使用 `intent:` + `package=com.wotbtools.app` 显式回到 App；fallback 指向 `mobile-resume?ticket=...`。
5. App 继续复用 PR #236 的 exact HTTPS callback App Link 与 `singleTask` MainActivity；intent 使用非敏感 `state=bridge&code=bridge` 只满足现有路由边界，真正 payload 由 ticket 恢复。
6. 原 WebView 请求 broker endpoint 后 atomic consume ticket，再执行原 `getAndVerifyAuthenticationSession(state)` → Juhe code exchange → `authenticated()`；不绕过 Keycloak session 校验。
7. 日志只记录 `callbackRef` / `returnRef`（SHA-256 前缀）和 stage，不记录 ticket/state/code/full callback URL。

## 约束

- 当前 ticket store 是 JVM-local，符合当前单 Keycloak instance 生产拓扑；未来水平扩容 Keycloak 前必须替换为共享 atomic store。
- hot return（原 WebView 仍存活）是 authoritative path；cold start 仍是 best effort。
- 不扩大 QQ host/scheme allowlist，不新增 native OAuth/AppAuth，不复制 Cookie。

## 验收

Targeted/module CI：

- `keycloak-juhe-qq-provider` tests
- Android existing auth return tests（PR #236 contract 不应回归）

生产真机期望 stage：

`mobile_return_entered -> auth_return_ticket_issued -> callback_entered(returnMode=android-bridge) -> authentication_session_restored -> juhe_callback_accepted -> before_broker_authenticated -> broker_authenticated`

失败时不得再出现 callback 落 Chrome 后直接 `already_logged_in` 的旧链路。
