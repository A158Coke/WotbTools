# WotBTools Android — 架构

## 定位

Android 是同一 Vue 应用的 Local-First App Shell。APK 自带 Vue chunks、唯一 Agent Rust/WASM
parser、2D 地图与图标资产；Native 只拥有系统能力、认证、外部文件 ingress 与 APK 更新。
ReplayWorkspace 仍是唯一回放编排器，selection 由现有 Vue store 持有，不建立 Android 业务分支。

```text
Android App
   ├── AuthManager → external user-agent → Keycloak → QQ / WG
   └── WebView → https://appassets.androidplatform.net/index.html
        ├── self: APK assets/web (Vue, WASM, 2D assets)
        └── HTTPS API / remote 3D assets: reviewed production origins
```

Android bundling 和生产 Web deploy 是独立发布产物。更改 Android 使用的 bundled Vue 或 Native runtime
都需要重新构建 APK；生产 Web frontend 不再是 Android 启动或发布的 runtime dependency。

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
        StartupGate.kt        # bounded best-effort version.json discovery
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
        layout/activity_main.xml         # webView + versionGate + local webError
        values/{strings,colors,themes}.xml
        xml/file_paths.xml               # FileProvider cache-path
        mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml
```

## 本地启动与更新

`MainActivity.LOCAL_APP_ORIGIN` 是 `https://appassets.androidplatform.net`，`LOCAL_APP_ENTRY` 是
`/index.html`；有 pending replay 时附加 `?view=replay`。Vue Router 继续拥有深链和 Back/Forward。
`WebViewAssetLoader` 的 `/` handler 把 URL path 映射到 APK `assets/web/<path>`，与 Android Vite `base=/`
一致。合成 pending replay exact URL 优先拦截，其次 bundled assets；缺失本地资产返回本地 404，绝不访问网络。

启动先加载 bundled document，再在系统确认 online 时异步获取版本 manifest（connect/read 各 3 秒）。
离线、manifest 获取失败或非法都不阻断本地界面；可达且有效的 manifest 仍执行
`installed < minSupportedVersionCode` mandatory update，较新版本使用 existing optional update。
恢复联网会触发一次 coalesced 检查，不 reload 页面或清空回放。Native WebError 只表示 local bundle/WebView
加载失败；不存在 Network Gate 或远程 frontend retry-only 页面。

## 网络与业务边界

Android API transport 从本地 origin 解析到 `https://wotbtools.com`，以 Native 短期 Bearer 调用；Web 保持
同源 transport。生产 ingress 只为 exact `https://appassets.androidplatform.net` 允许所需 API CORS，
不依赖 third-party cookies。Native Bridge RPC 不是任意 HTTP proxy。

本地 import/parse、Data、deterministic Rating、2D 和 shots 可离线使用；AI、HoF、Profile backend 与
3D remote assets 使用共享 ONLINE_REQUIRED capability gate，离线保留入口并在发请求前立即给连接提示。
已缓存 Native session 或离线过期 token 不影响本地回放；API 调用等待联网和可用 token。
恢复联网不自动提交 AI，也不 reset selection、logout 或 reload。

## 能力边界（V2 冻结区）

Android 不在 Native 层重写 AI Review / Battle Reconstruction / capability 业务状态机，
这些由 Vue 提供。Android 只实现 Web 之外的系统能力：

- 本地 WebView 加载、系统连通性、best-effort 更新、back、生命周期、本地错误屏
- 原生 OIDC 认证（Authorization Code + PKCE S256，外部 user-agent）与 token 生命周期
- Replay 意图入口（ACTION_SEND / ACTION_VIEW → content URI）
- Native Bridge（`getCapabilities`/`getPendingReplay`/`consumePendingReplay`/`checkForUpdate`/
  `startUpdate`/`authGetState`/`authLogin`/`authLogout`/`authGetAccessToken`；禁止
  readFile/http/execute/launch、禁止任何 refresh token 出口）——
  **origin-scoped**：经 AndroidX WebKit `WebMessageListener`（`addWebMessageListener`），
  仅 `https://appassets.androidplatform.net` / `https://wotbtools.com` / `https://www.wotbtools.com` 的主 frame 可调，不暴露给 Keycloak / IdP /
  任意第三方 frame（替代 `addJavascriptInterface` 的全 frame 暴露）
- APK 下载、SHA-256 校验、installer、未知来源授权
- 复用 Web 的本机解析（上游 Rust Core WASM，服务器没有 parser；Android 不实现第二套解析，
  也不携带任何自有凭据）

Native Bridge 的 `getCapabilities()` 只表达**原生能力**（`native-auth`/`replay-share`/`replay-open`/
`app-update` / `connectivity`），不涉及 replay 业务 capability 判断（FULL/DEGRADED/PERFORMANCE 等由 Web 端接入）。
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

- **回程投递（PendingIntent 必须是 mutable）**：AppAuth 的 `AuthorizationManagementActivity` 不复用
  调用方给的 Intent —— 它先组装一个新的响应 Intent（`EXTRA_RESPONSE` / `EXTRA_EXCEPTION` + 完整
  redirect URI 作为 data），再 `callback.send(context, 0, responseData)` 交给 completion
  `PendingIntent`。因此登录与 end-session 的回程 PendingIntent 都用
  `FLAG_UPDATE_CURRENT | (SDK ≥ 31 ? FLAG_MUTABLE : 0)`（`appAuthCallbackFlags()`，minSdk 26 需降级）：
  `FLAG_IMMUTABLE` 会冻结创建时的 Intent、静默丢弃填充，`MainActivity` 于是连
  `isAuthorizationIntent()` 都不成立，授权码永远不会被交换 —— 真机表现是「浏览器里认证成功、
  App 里始终未登录」，而 JVM/CI 完全测不出来（由 `AuthManagerTest` 的源契约断言守住）。
  可变的是「允许 AppAuth 填 extras」，基础 Intent 仍然是显式组件 `Intent(appContext, activityClass())`。

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
- **单飞 refresh**：并发 `authGetAccessToken` 只触发一次 refresh；refresh 的永久 token 拒绝清空 Native 会话；离线/网络/服务失败保留加密 cached session 并回报
  `refresh-failed`（`authGetAccessToken` 的 `error` 字段），Web 侧清除不可用的 API token，但保留 Native cached session 的登录投影和本地回放状态。
  Logout / account replacement advances the session generation under the same persistence lock.
  Late refresh success/rejection cannot restore a logged-out session, overwrite/clear a new account,
  or release a newer generation's waiters. Transient failures emit no authChanged retry loop.


### 登录 / 登出语义

- `authLogin()` 只启动外部 user-agent；**WebView 不导航、不重载**，登录完成后 Native 通知页面
  （`window.wotbtoolsOnAuthChanged()`），SPA 保持在原视图并重新同步状态。
- `authLogout()` = 清 Native 会话 + 发起 Keycloak OIDC end-session（带 id-token hint）。**不**删除 Chrome
  cookie、**不**强制登出 QQ / Wargaming、**不**操作 provider session：下一次登录时若系统浏览器仍保有
  IdP session，那是 provider/browser 的正常 SSO 行为。

### Bridge 是独立边界

Native Bridge 与 OAuth 是两个独立安全边界。Bridge origins 严格限于 canonical local origin
`https://appassets.androidplatform.net` 以及 bridge v2 生产兼容 origins `https://wotbtools.com` / `https://www.wotbtools.com`，不暴露给 Keycloak、QQ/IdP 或第三方 frame；禁止在 WebView 与系统浏览器
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

- 主 frame 只留在 exact HTTPS local origin；外部 HTTPS / mailto 交给系统浏览器，其它 scheme 阻断。
  生产 API origin、Keycloak 与 IdP 不在 WebView 中导航。
- `usesCleartextTraffic=false`；`mixedContentMode=NEVER_ALLOW`；`allowFileAccess=false`；
  `allowContentAccess=false`；`setGeolocationEnabled(false)`。
- 禁用 `allowUniversalAccessFromFileURLs` / `ignoreSslErrors`；SSL 错误必须失败。
- Native Bridge 只暴露给三个 reviewed exact origins 的主 frame，任意第三方页与 iframe 不可调用。
- WebView third-party cookies 禁用；CookieManager 不承担认证语义，App 不读取、复制或持久化 Cookie。

## 权限（least privilege，规格 §69）

`INTERNET`、`ACCESS_NETWORK_STATE`、`REQUEST_INSTALL_PACKAGES` + FileProvider URI grant。
不申请 `READ_EXTERNAL_STORAGE` / `MANAGE_EXTERNAL_STORAGE` / Contacts / Location / Camera / Microphone。

## 自动化 WebView smoke

`gradle :app:connectedDebugAndroidTest --no-daemon` 使用系统 framework instrumentation runner，
不增加 production test 依赖；test-only APK provider 从 `common/fixtures/replays` 读取同一匿名 fixture。
测试临时启用飞行模式并恢复原设置，检查 local origin、真实 Vue shell 挂载、Activity restart、
Bridge v2 / native-auth / offline authority，以及 external content Intent → private cache → bundled WASM
分析 → Data 结果 → identity ACK 清 pending。这是模拟器运行证据，不能代替物理设备的 provider、
文件分享和视觉验收。

## PR B 人工交接（2026-10-03）

Automated B13/B14 已验证；Physical B13/B14 为 **PENDING HUMAN VALIDATION**。
模拟器为 API34，Native JVM 98 项、真实 local Vue/Intent/WASM/ACK smoke 1 项通过。
Browser offline matrix 使用真实 pinned WASM，覆盖手动导入、Data/Rating/2D/shots、深链门禁与连接切换。
执行真机矩阵时记录 model/Android/WebView、最终 APK SHA256、bundle buildCommit 和每项 PASS/FAIL。

- B13：飞行模式 cold start/restart；手动及外部回放；Result/Rating/2D/shots；坏文件可重试；
  pending process death/resume 后成功 ACK；AI/HoF/3D/Profile 入口保留、即时提示、零请求/离线登录。
- B13：联网→断网→联网保留回放/车辆/shot；3D 由用户 quality→Start；断网释放场景、重连无风暴。
  人工核验 GPU/3D 画面/地图方向/装甲 viewer 交接；既有角色权限保持。
- B14：Keycloak chooser、QQ、具备测试账号的 WG ASIA/EU/NA；preferred App Link/fallback scheme；
  access token、refresh、logout/relogin/account switch、授权中 process death/resume；
  authenticated→offline 与 expired token offline 本地可用，无 WebView OIDC 导航。无账号项标为未测。
- 发布：先部署 exact-origin CORS/gateway 与 Keycloak client，minSupported 至少 2000001。
  本轮只读 repo variable 为 2000000，publish 将拒绝。本 PR 未 stage/publish，未写 production version.json。

Android 严格 CSP 只允许本地脚本/现有 bootstrap hash 与 WASM 编译；业务 connect 仅 self 和
生产 wotbtools origin。既有 OpenAPI generator 生成 Ajv standalone ESM validators，
WebView 无 runtime eval/new Function。Bundle URL graph/CSS references/APK 文件 SHA 全部 fail-closed。

### B15 critical review

| 项 | 结论与证据 |
|---|---|
| 1–4 cold start/document/BASE/file | 即时 APK /index.html；appassets 文档；无远程 frontend startup/file URL。MainActivity + emulator smoke。 |
| 5 bridge | 仅 appassets、https://wotbtools.com、https://www.wotbtools.com，main frame；合同/JVM。 |
| 6–8 API/CORS/Bearer | Android absolute API；Caddy exact-origin 匿名预检与真实响应；Native Bearer、omit cookies；实际 Caddy HTTP。 |
| 9 offline auth | capability 先于 login/API，browser matrix 零离线 login，Native transient failure 保留 cached session。 |
| 10 parser | APK commit-addressed JS/WASM，与 deploy/agent/source.json v0.3.11 pin 一致。 |
| 11–13 pending | exact local synthetic GET、无网络回退；full UUID/compare-clear ACK；JVM 持久恢复与 emulator Activity recreation。完整 OS process-death 属真机矩阵。 |
| 14–17 local | Result/Rating/2D bundled，shots compact tank parameters/shell table bundled；真实 WASM offline matrix。 |
| 18–20 remote offline | AI/HoF/3D 在 mount/login/data/dispatch 前门控，matrix 零业务 HTTP/远程资产。 |
| 21–22 owner | ReplayWorkspace/session 是唯一 orchestrator/selection owner，无 Android fork。 |
| 23 reconnect | HoF/Profile 去重，AI 不自动提交，3D 保留 main quality→Start；local selection 不 reset。 |
| 24 refresh | Native lock/generation 与 FE generation 防迟到回复；transient failure 不 logout/clear replay。 |
| 25 release APK | signed stage 复用 build:android、签名后实际 APK inventory/SHA/aapt gate；debug实包/CI验证。本轮未 stage/sign release。 |
| 26–27 publish/Web | immutable staged APK，不 rebuild/resign；production Web commit 不再是 Android runtime 依赖。 |
| 28–29 readiness | Keycloak client gate 保留；真实 profile preflight/401、gateway JSON/exposed headers fail-closed。 |
| 30 commit point | version.json 仍是最后 production mutation，release helpers 锁定顺序。 |
