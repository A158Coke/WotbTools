# WotBTools Android — 架构

## 定位

WotBTools Android 是现有 Vue/Web 的**纯联网 Thin Client**（用户规格 §8）。它不是第二套 WotBTools：
所有业务运算（replay 解析、Rating、AI、战局重建）仍在客户端 Agent WASM / 服务端；Android 只负责
设备能力、文件入口、Web 容器、认证、网络门禁与 APK 更新。

```text
Android App (Native shell)
   ├── AuthManager ──> 外部 user-agent ──> Keycloak ──> QQ / WG IdP
   └── WebView ──> https://wotbtools.com
```

Android 2.0 起**认证由 Native 独占**（见下面的 Authentication Boundary）。普通业务更新 = Web deploy
→ Android 自动获得，无需重发 APK；只有 Native 层变化（Intent/WebView/manifest/bridge/updater/shell/auth）
才重发 APK。

## 工程结构

```
android/
  settings.gradle.kts
  build.gradle.kts            # plugin 版本
  gradle.properties           # Version-as-Code：wotbVersion / wotbNativeBridgeVersion
  app/
    build.gradle.kts          # namespace com.wotbtools.app, minSdk 26, appauth
    src/main/
      AndroidManifest.xml
      java/com/wotbtools/app/
        MainActivity.kt       # Android 生命周期 / intent 分发 / WebView / bridge 接线
        StartupGate.kt        # 网络 + version.json（fail-closed）
        VersionManifest.kt    # version.json 解析
        ApkUpdater.kt         # 下载 / SHA-256 / installer
        ReplayIntentHandler.kt# ACTION_SEND/ACTION_VIEW → PendingReplay（+ metadata 持久化/恢复）
        ReplayDispatchPolicy.kt # pending replay 分发决策（纯逻辑，JVM 单测）
        NativeBridge.kt       # 方法白名单分发（含 auth*）
        auth/
          AuthManager.kt          # login/logout/token 编排（AppAuth），单飞 refresh
          SecureSlotStore.kt      # 加密槽位原语（Keystore AES-GCM）+ 状态域隔离契约
          AuthTransactionStore.kt # 进行中的授权交易（交易身份 state + 本次回程 URI，纯逻辑）
          AuthSessionStore.kt     # 已建立的会话（AppAuth AuthState JSON，纯逻辑）
          AuthSession.kt          # 当前会话快照 + 过期判定（纯逻辑）
          OidcConfiguration.kt    # issuer / clientId / redirect URIs / scope
          OidcRedirectStrategy.kt # HTTPS App Link vs private scheme（纯决策 + API31 探测）
          AuthResponseGuard.kt    # 事务归属校验（state / redirect / code / error，纯逻辑）
          AuthResult.kt           # 显式 result / error 模型
      res/
        layout/activity_main.xml         # webView + networkGate + versionGate + webError
        values/{strings,colors,themes}.xml
        xml/file_paths.xml               # FileProvider cache-path
        mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml
```

## 启动门禁

```text
网络 OK? ──No──▶ Network Gate（重试）
   │Yes
version.json 拉取 ──失败──▶ Network Gate（fail-closed）
   │成功
installed < minSupportedVersionCode ──▶ Mandatory Update
installed < latestVersionCode        ──▶ Optional Update [立即更新][稍后]
else                                  ──▶ Load https://wotbtools.com
```

`version.json` 获取失败不允许进入业务（fail-closed，规格 §16）。

## 能力边界（V2 冻结区）

Android 不在 Native 层重写 AI Review / Battle Reconstruction / capability 业务状态机，
这些由 Vue 提供。Android 只实现 Web 之外的系统能力：

- 网络/版本门禁、WebView 加载、splash、back、生命周期、错误屏
- 原生 OIDC 认证（Authorization Code + PKCE S256，外部 user-agent）与 token 生命周期
- Replay 意图入口（ACTION_SEND / ACTION_VIEW → content URI）
- Native Bridge（`getCapabilities`/`getPendingReplay`/`consumePendingReplay`/`checkForUpdate`/
  `startUpdate`/`authGetState`/`authLogin`/`authLogout`/`authGetAccessToken`；禁止
  readFile/http/execute/launch、禁止任何 refresh token 出口）——
  **origin-scoped**：经 AndroidX WebKit `WebMessageListener`（`addWebMessageListener`），
  仅 `https://wotbtools.com` / `https://www.wotbtools.com` 可调，不暴露给 Keycloak / IdP /
  任意第三方 frame（替代 `addJavascriptInterface` 的全 frame 暴露）
- APK 下载、SHA-256 校验、installer、未知来源授权
- 复用 Web 的本机解析（上游 Rust Core WASM，服务器没有 parser；Android 不实现第二套解析，
  也不携带任何自有凭据）

Native Bridge 的 `getCapabilities()` 只表达**原生能力**（`native-auth`/`replay-share`/`replay-open`/
`app-update`），不涉及 replay 业务 capability 判断（FULL/DEGRADED/PERFORMANCE 等由 Web 端接入）。
wire contract 的 SSOT 是 `contracts/android-native-bridge.json`（`bridgeVersion` 由
`android/gradle.properties:wotbNativeBridgeVersion` 锁定，CI 用 `scripts/android-release/android_contract.py`
校验 Native 实现、FE 声明与契约三方一致）。

## Authentication Boundary（Android 2.0 起：Native owns auth）

Android **不再**沿用 Web 的 keycloak-js 认证链：WebView 不参与 OIDC，也不存在 provider 级
WebView navigation allowlist。

```text
Vue login() ──bridge──▶ authLogin() ──▶ AuthManager
                                          │ AppAuth AuthorizationService（PKCE S256）
                                          ▼
                             外部 user-agent（Custom Tab / 浏览器）
                                          │
                              keycloak.wotbtools.com 登录页（主题内选 IdP）
                                          │
                        QQ / WG ASIA / WG EU / WG NA（Keycloak identity brokering）
                                          │
                    HTTPS App Link  或  com.wotbtools.app:/oauth2redirect
                                          │
                     RedirectUriReceiverActivity → MainActivity.onActivityResult
                                          │
                        AuthManager 换 code → Keystore 加密持久化 → authChanged 通知 Web
```

- **Android 不认识 IdP**：`idp-qq` / `wargaming-asia|eu|na` 全部只属于 Keycloak。Android 只有一个
  「Login」入口，provider 选择发生在 Keycloak 登录主题里，因此**增加 / 删除 IdP、临时关闭某地区、
  更换 provider 都不需要发 APK**。
- **协议不手写**：使用 `net.openid:appauth`（RFC 8252 外部 user-agent、Custom Tabs、PKCE、App Links、
  private-use redirect，且明确不使用 WebView 做 OAuth）。**版本固定 `0.11.1`**：这是 Maven Central
  上的最新发布，上游 release 节奏停滞属于已知维护风险，依赖审计结论记录在
  `docs/current-plan.md`；升级路径是评估 maintained 的 RFC 8252 兼容实现，永远不是自己实现 OAuth。
- **Chrome Auth Tab 不是 2.0 的前置条件**（上游对它的 first-class 支持尚未完成）。

### Redirect transport（两条，同一套实现）

| transport | URI | 使用条件 |
|---|---|---|
| 首选：HTTPS App Link | `https://auth.wotbtools.com/android/oauth/callback` | domain verification 判定**已知可用**：API 31+ 的 `DomainVerificationManager` 给出 `DOMAIN_STATE_VERIFIED` 且 `isLinkHandlingAllowed` |
| 回退：private-use scheme | `com.wotbtools.app:/oauth2redirect` | 其它一切情况（API < 31、探测异常、用户关闭 supported links） |

两者共用同一个 Keycloak client、同一份 PKCE 实现、同一个 `AuthSession` 与同一个 token store ——
**不存在两套 auth implementation**。private scheme 使用 application-id namespace，不使用过于泛化的
`wotbtools://`。HTTPS transport 的 domain association 由既有
`auth.wotbtools.com/.well-known/assetlinks.json`（package + 生产签名证书指纹）承载，因此 ROM 差异
不会让登录不可用，只会退回 private scheme。

App **未安装**（或该设备没走 App Link）时，浏览器会真的停在
`https://auth.wotbtools.com/android/oauth/callback`：`deploy/tx/Caddyfile` 在该 host 上用一个最小
落地页回答这个精确路径（不再落到 Keycloak 的 catch-all 404），并提供下载入口。Keycloak 自身的
路径（`/realms/...`、`/resources/...`）行为不变。

### 校验边界（谁负责什么）

- **AppAuth 负责**：它自己那一份响应 `state` 与请求 `state` 的比较（`AuthorizationManagementActivity`
  不匹配即丢弃并回 `STATE_MISMATCH`）、nonce 断言、以及 code verifier 的归属 —— verifier 只存在于
  `AuthorizationRequest` 内，随响应对象回到本进程后才用于交换，应用层拿不到也不需要拿。
- **本 App 负责**（`AuthResponseGuard`，JVM 单测覆盖）：响应携带的 `state` 必须等于**本次交易**的
  持久化身份（我们独立存了一份，因此即使 intent 里的请求缺失或被替换，也不会有响应被算作
  「我们发起的交易」）；response 携带的 redirect URI 必须等于**本次交易实际使用的那一条**
  （不一致 fail closed）；成功路径必须有 code；OAuth `error`（含用户取消）分类为显式失败；
  取消/失败后必须仍可重新登录（不得留下卡死的 auth 状态）。
  失败时的交易清理同样是身份匹配的：state 对不上（陈旧 / 外来的回程）时只拒绝这次回程，
  **保留**当前交易；只有能证明属于当前交易的回程才会消费它。
- **PKCE 必须显式声明 S256**：AppAuth 单参数 `setCodeVerifier()` 会算出 challenge 但**不设置**
  `code_challenge_method`，只带 `code_challenge` 时 Keycloak 按 `plain` 处理 —— 那是真实的 PKCE 降级，
  因此必须用三参数 `setCodeVerifier(verifier, challenge, S256)`。

### Token 安全边界

- **Native 独占**：authorization code、PKCE verifier、refresh token、OIDC state/nonce、refresh 生命周期、
  持久认证会话。
- **Vue 可以拿到**：短生命周期 access token（`authGetAccessToken(minValiditySeconds)`）、`authenticated`
  状态、access token 解码后的 claims（realm roles / `displayName` / `wotb_*`）、expiry。
- **Vue 永远拿不到**：refresh token、authorization code、PKCE verifier、state/nonce secret。Bridge 不提供
  `getRefreshToken` / `setToken` / `setCookie` / `executeAuthUrl` / 任意 OAuth 请求入口。
- **持久化分成两个互不相干的状态域**（`SecureSlotStore` 的独立 slot，均为 Android Keystore
  AES-256-GCM 加密后写入 app private `SharedPreferences`）：
  - `AuthTransactionStore`：进行中的授权交易（交易身份 `state` + 本次选定的回程 URI + 建立时刻）。
    只有登录启动、回程校验与交换消费这三处读写它。**消费一律按身份**（`clearIfState`）：只有回程
    带回的 `state` 与当前交易身份一致时才清空它 —— 登录先落盘成功才允许打开浏览器，落盘失败
    直接返回可重试的失败（不启动、不假装已受理）。
  - `AuthSessionStore`：已建立的会话（AppAuth `AuthState` JSON，含 refresh token）。
    `authGetState`、token 读取、刷新与 logout **只**经这一个域。
  两条硬规则：任何人都不解析、不清理对方的状态；交换成功时先写会话、再消费交易（顺序不可颠倒）。
  这样「登录途中进程被杀 + App 重启读会话（甚至是坏会话）」不会作废那笔交易，反过来交易损坏也不会
  清掉已有会话 —— 单槽位实现正是死在这里：`authGetState` 会把交易当成 `AuthState` 解析，失败即整份清空，
  回程 callback 于是再也无法通过校验。解密/解析失败一律只清出问题的那个域并回到未登录。
  第三条硬规则：**陈旧 / 外来的回程不得作废新交易** —— 「登录 A → 用户返回 → 登录 B → 旧回程 A 到达」
  时，A 的回程（含库判定的 `STATE_MISMATCH`、读不出 `state` 的取消）对自身 fail closed，但 B 原样保留；
  异步 token 交换同样带着自己那笔交易的身份去消费，等待期间用户再次登录不会被成功回调抹掉。
  明确禁止：明文 SharedPreferences refresh token、WebView localStorage refresh token、
  Cookie → Native token 复制、Native → JS refresh token 暴露。
- **单飞 refresh**：并发 `authGetAccessToken` 只触发一次 refresh；refresh 无效时清空 Native 会话并回报
  `unauthenticated`（`authGetAccessToken` 的 `error` 字段），Web 侧据此回到未登录态。

### 登录 / 登出语义

- `authLogin()` 只启动外部 user-agent；**WebView 不导航、不重载**，登录完成后 Native 通知页面
  （`window.wotbtoolsOnAuthChanged()`），SPA 保持在原视图并重新同步状态。
- `authLogout()` = 清 Native 会话 + 发起 Keycloak OIDC end-session（带 id-token hint）。**不**删除 Chrome
  cookie、**不**强制登出 QQ / Wargaming、**不**操作 provider session：下一次登录时若系统浏览器仍保有
  IdP session，那是 provider/browser 的正常 SSO 行为。

### Bridge 是独立边界

Native Bridge 与 OAuth 是两个独立安全边界。Bridge origins 仍严格限于 `https://wotbtools.com` 与
`https://www.wotbtools.com`，不暴露给 Keycloak、QQ/IdP 或第三方 frame；禁止在 WebView 与系统浏览器
之间同步 Cookie。

## Replay 意图与认证的导航边界

外部 replay 是一个 **pending action**，不是特殊应用模式：Android 只负责安全接收、持久化与通知
Web，绝不自行决定「是否解析」「是否绕过登录」。

- **认证不再参与 navigation**：登录发生在外部浏览器，WebView 不承载 OIDC，因此 replay intent 与认证
  之间没有所有权冲突 —— 登录期间收到 replay 正常持久化并按 `ReplayDispatchPolicy` 分发，正在进行的
  OIDC 事务不会被 replay 打断。分发只在 WebView 容器被门禁 / 错误页 / 更新页接管时暂缓。
- **单一 ingress**：只有 Intent → private cache → Native Bridge → Web fetch 固定同源 HTTPS synthetic
  resource 一条路径；已删除 `onShowFileChooser` 对 pending replay 的注入分支。
- **跨 process death 存活**：pending metadata 落在 app private storage（24h TTL），启动时先恢复
  active pending、再按引用清理 orphan cache。
- **identity-aware ACK**：pending identity 是完整 UUID（`pendingId`）。Web 在本机分析完成后调用
  `consumePendingReplay(pendingId)`，Native 执行 compare-and-clear（纯策略 `PendingReplayAckPolicy`）：
  只有 identity 与当前 pending 完全一致才清 slot + metadata；identity 缺失或已被更新的 replay 取代
  （stale）一律不清理，保证 exactly-once 且绝不误清新 pending。
- **登录不是 replay 的前置条件**：本机分析在本机完成，未登录同样可打开、解析与导出；认证失败 / 取消
  不会让已接收的 pending replay 失效。

细节契约与日志白名单见 [`replay-intent.md`](replay-intent.md)。

## WebView 安全（规格 §28–§29 / §86–§88）

- app host（`wotbtools.com` / `www.wotbtools.com`）始终允许留在 WebView；其它外链走系统浏览器。
  WebView 不再承载任何 OIDC / IdP 导航，因此不存在认证专用的 host allowlist。
- `usesCleartextTraffic=false`；`mixedContentMode=NEVER_ALLOW`；`allowFileAccess=false`；
  `allowContentAccess=false`；`setGeolocationEnabled(false)`。
- 禁用 `allowUniversalAccessFromFileURLs` / `ignoreSslErrors`；SSL 错误必须失败。
- Native Bridge 只加到 `wotbtools.com` 页面，第三方页不可调用。
- WebView 的 CookieManager 不再承担认证语义（认证由 Native 持有）；App 不读取、不复制、不持久化 Cookie。

## 权限（least privilege，规格 §69）

`INTERNET`、`ACCESS_NETWORK_STATE`、`REQUEST_INSTALL_PACKAGES` + FileProvider URI grant。
不申请 `READ_EXTERNAL_STORAGE` / `MANAGE_EXTERNAL_STORAGE` / Contacts / Location / Camera / Microphone。
