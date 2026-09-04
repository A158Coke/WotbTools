# Android QQ Auth Return Bridge

## 状态

IMPLEMENTED / SELF-REVIEW FIXED / PR VALIDATED / PRODUCTION VALIDATED

## 证据

- Android QQ native handoff 已实机证实为 `wtloginmqq://ptlogin`。
- QQ 授权返回时由 QQ 显式启动 `com.android.chrome` 打开 `https://ssl.ptlogin2.qq.com/...`，因此普通 Verified App Link 不能接管这一步。
- `auth.wotbtools.com` App Link 已修复为 `verified`，且手工 ACTION_VIEW 能直接打开 WotBTools；问题是 QQ/Chrome return chain 的 browser-context 切换。
- Keycloak 在旧 Chrome callback 中报 `IDENTITY_PROVIDER_LOGIN_ERROR error=already_logged_in`，失败发生在 `getAndVerifyAuthenticationSession(state)` 恢复原 AuthenticationSession 之前。
- PR #237 已合并并部署到生产；生产 Keycloak 运行 `ghcr.io/a158coke/wotbtools-keycloak:sha-4682b7ad`。
- 2026-09-04 Android 真机完成完整 QQ 登录链路并成功登录，证明 return bridge 能把授权流程从 Chrome 返回原 WotBTools WebView，并恢复 Keycloak AuthenticationSession continuity。

## 实现

1. Bridge 决策在登录发起阶段绑定，而不是在 Chrome 回程靠 Android UA 猜测：只有原请求 UA 符合 Android WebView（`Android` + `; wv)`）时，Juhe `redirect_uri` 才指向 `/endpoint/mobile-return?state=...`；普通 Android Chrome / desktop browser 继续使用原 `/endpoint?state=...`。
2. `mobile-return` 只服务已在 login-start 被分类为 app/WebView 的 transaction，不再读取回程 User-Agent 做二次判断。
3. Android return 在 Keycloak 内签发 2 分钟、单次消费、256-bit 随机 opaque ticket；ticket server-side 保存 `state/type/code`，Android intent 不携带真实 state/code。
4. `mobile-return` 返回需要用户点击的“返回 WotBTools”页面，使用 `intent:` + `package=com.wotbtools.app` 显式回到 App。
5. 无 browser fallback callback：intent 不携带 `browser_fallback_url`，Chrome 无法打开 App 时 ticket 不会在错误 browser context 被 consume；页面明确提示返回 App 后重新发起登录。
6. App 继续复用 PR #236 的 exact HTTPS callback App Link 与 `singleTask` MainActivity；intent 使用非敏感 `state=bridge&code=bridge` 只满足现有路由边界，真正 payload 由 ticket 恢复。
7. 原 WebView 请求 broker endpoint 后 atomic consume ticket，再执行原 `getAndVerifyAuthenticationSession(state)` → Juhe code exchange → `authenticated()`；不绕过 Keycloak session 校验。
8. 日志只记录 `callbackRef` / `returnRef`（SHA-256 前缀）和 stage，不记录 ticket/state/code/full callback URL。

## 约束

- 当前 app-origin routing marker 使用平台 Android WebView UA 的 `; wv)` token；它只决定 return routing，不参与身份认证或授权。最终认证 authority 仍是 Keycloak state / AuthenticationSession 校验。
- 当前 ticket store 是 JVM-local，符合当前单 Keycloak instance 生产拓扑；未来水平扩容 Keycloak 前必须替换为共享 atomic store。
- hot return（原 WebView 仍存活）是 authoritative path；cold start 仍是 best effort。
- 不扩大 QQ host/scheme allowlist，不新增 native OAuth/AppAuth，不复制 Cookie。

## Self-review 修复

- Major #1 已修：不再用 callback Chrome 的 Android UA 决定是否拉 App；routing 在原 login request 阶段绑定，普通 Android Chrome 保持 browser-direct。
- Major #2 已修：删除 `browser_fallback_url -> mobile-resume -> consume(ticket)` 失败链；无法打开 App 时不在 Chrome 中消费 ticket。

## 生产验证结果

生产真机已验证成功：

`WotBTools WebView -> Keycloak -> Juhe -> QQ -> QQ App -> Chrome -> mobile-return -> WotBTools -> original WebView -> Keycloak broker callback -> login success`

验收结论：

- Android App QQ 登录成功。
- return bridge 能将 Chrome 中的授权回程显式交还 WotBTools App。
- 原 WebView 的 Keycloak AuthenticationSession continuity 得以恢复。
- 旧 `already_logged_in` 生产故障不再阻塞该登录链路。

普通 Android Chrome 网页登录仍必须保持 `browser-direct`，不得被拉起 WotBTools App。
