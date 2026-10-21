# WotBTools Android — 架构

## 定位

Android 是同一 Vue 应用的 Local-First App Shell。APK 自带 Vue chunks、唯一 Agent Rust/WASM
parser、2D 地图与图标资产；Native 只拥有系统能力、认证、外部文件 ingress 与 APK 更新。
ReplayWorkspace 仍是唯一回放编排器，selection 由现有 Vue store 持有，不建立 Android 业务分支。

```text
Android App（3.0 起）
   ├── AuthManager → external user-agent → Keycloak → QQ / WG
   ├── LocalRuntimeServer → http://127.0.0.1:21653（固定端口，APK 内 bundle 的唯一 origin）
   │    ├── /…                         APK assets/web (Vue, WASM, 2D assets)
   │    ├── /__native/replay-pending   pending replay stream（identity header）
   │    ├── /__native/replay-folder    目录选择 stream（selection + file identity header）
   │    └── /agent-assets/*            AgentAssetProxy → 对象存储（3D 资产）
   └── GeckoView（APK 自带、固定版本的 Web 引擎）→ http://127.0.0.1:21653/index.html
        ├── 内置扩展 gecko-bridge → window.WotbNative → Native Bridge
        └── HTTPS API / download surface: reviewed production origins
```

### 引擎：GeckoView（Android 3.0 起取代 System WebView）

2.x 由设备的 System WebView 渲染，版本随 ROM / 应用商店漂移：Android 9 等旧设备出现 CSS 错乱，
renderer 崩溃会直接带走整个 App（2.x 没有 `onRenderProcessGone`）。3.0 改为 APK 自带 Mozilla GeckoView
stable（精确版本见 `android/app/build.gradle.kts` 的 `geckoViewVersion`），用户运行的就是发布时验收的引擎。

- **所有权**：`GeckoWebRuntime` companion 持有进程级 `GeckoRuntime`（每进程只能创建一次，只在主进程、
  首次需要时创建）与内置 bridge 扩展；每个 Activity 一个 `GeckoSession` + delegates。没有 `Application` 子类。
- **版本策略**：只用 stable channel、精确版本号；每次升级 GeckoView 就是一次独立的 Android minor 发布
  （至少每季度一次，遇关键安全修复立即）。引擎随 APK 固定后，安全补丁只能靠发版——这是换来「可控引擎」的代价，
  导航锁定在本机 origin 缩小了它的攻击面。
- **工具链**：GeckoView 158 的 AAR 要求 `compileSdk 37.2` 与 Kotlin 2.4 metadata，因此 AGP 9.4 / Gradle 9.6 /
  KGP 2.4（AGP 9 built-in Kotlin，KGP 版本经根 `build.gradle.kts` 的 buildscript classpath 提升）。
  `targetSdk` 仍为 34（不随引擎迁移改变运行时行为），`minSdk` 26 与 GeckoView 一致。
- **APK**：单个 APK，release 只含 `arm64-v8a` + `armeabi-v7a`（debug 另含 `x86_64` 供模拟器），
  native libs 压缩打包（`useLegacyPackaging`），优先减小侧载下载体积。
- **设置**：只用公开 API——release 关闭 remote debugging / about:config / console 输出；Safe Browsing 关闭
  （只加载本机可信内容）；权限请求一律拒绝；页面引擎不创建多窗口（GeckoView 只用一个 `GeckoSession`，
  `onNewSession` 返回 null）。`window.open` / `target=_blank` 的最终处置见「运行时安全」的导航条目。
- **原生弹窗**：GeckoView 的 `PromptDelegate` 默认实现一律「取消」。已实现的只有 HTML `<select>`
  （`onChoicePrompt` → 原生单选 / 多选菜单，含 optgroup、disabled、页面侧关闭与选项更新）与
  `<input type=file>`（`onFilePrompt` → 系统 picker）。`alert` / `confirm` / `prompt`、日期 / 颜色选择、
  `beforeunload` 确认都未实现，页面确认框统一使用 `AppDialog`；以后新增这类原生输入前，先补对应 delegate。

普通文件选择（replay 与图片共用）：`ACTION_GET_CONTENT` 返回的 URI 仅由 Native 持有。
`FilePickerCache` 在后台通过 `ContentResolver` 完整复制到独立 `cache/file-picker/<uuid>/<safe-original-name>`，
全部成功后才在 UI 线程把 `file://` URI 交给 Gecko；DOM `File` 保留原文件名和扩展名。
保留 provider 的修改时间，缺失时由文件内容哈希生成稳定时间，避免重复选择被前端误判为新文件；TTL 单独按缓存目录创建时间计算。
复制按实际字节执行 Native 安全上限：单文件 25 MiB（复用 external ingress ceiling）、整批 256 MiB、128 文件；不信任 provider SIZE，超过时整批清理。前端仍负责 20 MiB／200 MiB／100 文件与图片规则。
缺少显示名时只按 provider MIME 推导扩展名，不猜测 replay。任意文件复制失败、空文件或请求已失效时
整批拒绝并清理；复制期间保持 chooser busy，晚到结果不会完成新请求。
成功 backing file 不在 confirm 后或打开下一次 picker 时删除；启动及下次复制前清理达到 1 小时的缓存，
避免 Gecko 延迟 `arrayBuffer()` 时文件已消失。目录 picker 与 external pending 各自保留独立生命周期。
没有真实路径解析、服务器上传或 Android 专用 parser fallback。

网页下载由 `ContentDelegate.onExternalResponse` 接管：后台消费并关闭 `WebResponse.body`（含 blob），
流入私有 cache 临时文件，再通过 `ACTION_CREATE_DOCUMENT` 选择保存位置并流式写入。
文件名优先 `Content-Disposition: filename*`，其次普通 filename / URL / MIME；路径分隔符与控制字符会被清理。
同一 Activity 只处理一个下载；从开始 spool 到保存结束均与 file / folder picker 互斥，
已有 picker 时下载在 spool 前拒绝并关闭 body；重复下载或操作冲突时提示重试。取消、失败与销毁清理临时文件。
choice / file prompt 被 Gecko 关闭时均完成对应 result；文件 picker 使用进程内不复用的请求码，
页面导航会清除旧 prompt 并关闭其 picker，迟到结果不会传给后续 prompt。

GeckoView 的下载派发**先**经过 `NavigationDelegate.onLoadRequest`，之后才进 `onExternalResponse`，
所以 `blob:` 下载 URL 必须在导航策略里放行（`NavigationPolicy.isTrustedLocalBlobUrl`：scheme `blob` +
内嵌 URL exact 本机 origin + canonical UUID，其它 host / port / scheme / malformed 一律拒绝）。它只是下载派发
例外，**不是** application origin——Native Bridge 的 sender 校验仍是 `MainActivity.isLocalAppUrl`，
blob URL 在那里恒为 false。本机 server 侧 `StreamResponse.data` 的 lifetime 由
`LocalRuntimeServer.sendResponse` 唯一拥有：HEAD、打开输出流失败、header 写入失败、body copy 失败、
flush 失败、客户端断开与意外异常都 close 恰好一次。

### 故障分级与诊断

- content 进程 **crash**：首次自动重开 session 并重载当前页；60 s 内第二次进入 Native 错误页
  （「重新加载」/「使用浏览器版」），避免重启风暴。
- content 进程被系统 **kill**（低内存回收）：不算故障，回到前台时静默重载被杀前的页面。
  恢复目标由 `RuntimeRecovery` 决定：最近一次**请求**加载或 Gecko **确认**的本机 URL——`loadUri` 之后、首个
  `onLocationChange` 之前就被杀（`currentUrl` 仍为 null，例如冷启动的 `?view=replay`）也不会丢目标；窗口可见时立即
  恢复，后台时等回前台、真正开始恢复才消费标记；crash 恢复用同一目标；runtime 关闭后不再恢复。session 已关闭时
  `load()` 先重开再加载，错误页「重新加载」同样有效。
- Gecko parent 进程运行在 App 进程内，它的 native crash 仍会结束 App——「不再闪退」的口径只覆盖 content 进程。
- 错误页带一行可长按复制的诊断（GeckoView 版本、Android / API、厂商型号、ABI、bridge 版本、crash / kill 计数、
  最近一次故障类型），同时写 logcat；不含账号、文件或回放信息。

### 升级时的一次性重置

2.x 的 localStorage（语言、列配置、回放偏好、onboarding、UI profile 等）属于 System WebView profile，
3.0 的 Gecko profile 读不到，升级后这些偏好恢复默认一次。登录会话与 pending replay 由 Native 持有，不受影响。
3.0 之后 origin 固定，偏好跨启动保留。

Sponsor runtime content（`/sponsor-config.json` + `/sponsor-assets/*`）**随构建进 APK bundle**：
构建期由 pin 住的 Release 资产注入 publicDir（`common/assets/`），Vite 拷进 `dist-android`，由本机 origin
同源伺服（离线可用）。它不是资产面读取，也不经生产网关（见 `docs/operations/sponsor-runtime-content.md`）。

Android bundling 和生产 Web deploy 是独立发布产物。更改 Android 使用的 bundled Vue 或 Native runtime
都需要重新构建 APK；生产 Web frontend 不再是 Android 启动或发布的 runtime dependency。

## 工程结构

```
android/
  settings.gradle.kts
  build.gradle.kts            # plugin 版本
  gradle.properties           # Version-as-Code：wotbVersion / wotbNativeBridgeVersion
  app/
    build.gradle.kts          # namespace com.wotbtools.app, minSdk 26, appauth, geckoview
    src/main/
      AndroidManifest.xml
      assets/gecko-bridge/    # 内置 WebExtension：content script 暴露 window.WotbNative
      java/com/wotbtools/app/
        MainActivity.kt       # Android 生命周期 / intent 分发 / 本机路由 / 门禁与错误页 / bridge 接线
        GeckoWebRuntime.kt    # GeckoRuntime / GeckoSession / delegates / bridge port / 故障分级
        LocalRuntimeServer.kt # 127.0.0.1 固定端口 HTTP（GET/HEAD、Host/Origin/路径校验、MIME）
        AgentAssetProxy.kt    # /agent-assets/* → 对象存储 + ETag 磁盘缓存
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
          OidcRedirectStrategy.kt # 固定 private scheme 回程（HTTPS 仅兼容旧交易）
          AuthResponseGuard.kt    # 事务归属校验（state / redirect / code / error，纯逻辑）
          AuthResult.kt           # 显式 result / error 模型
      res/
        layout/activity_main.xml         # GeckoView + versionGate + runtimeError（含诊断行）
        values/{strings,colors,themes}.xml
        xml/file_paths.xml               # FileProvider cache-path
        mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml
```

## 本地启动与更新

`MainActivity.LOCAL_APP_ORIGIN` 是 `http://127.0.0.1:21653`（端口的唯一事实源；固定端口让 origin 跨启动稳定，
localStorage 与生产 CORS 都依赖它），`LOCAL_APP_ENTRY` 是 `/index.html`；有 pending replay 时附加 `?view=replay`。
Vue Router 继续拥有深链和 Back/Forward。`LocalRuntimeServer` 把 URL path 映射到 APK `assets/web/<path>`，
与 Android Vite `base=/` 一致；无扩展名的未知路径回落 `index.html`（history 路由）。合成 replay resource 的
exact URL 优先，其次 `/agent-assets/*`，其余是 bundled assets；缺失本地资产返回本地 404，绝不访问网络。
端口被占用（例如应用分身同时运行）时显示 Native 错误页，「重新加载」会再试一次绑定。

页面加载必须等内置扩展安装完成、message delegate 注册之后才开始，保证首屏前 `window.WotbNative` 已就绪；
扩展用 `installBuiltIn`（每次进程启动都重装），升级 APK 后一定运行新的 `bridge.js`，不需要维护扩展版本号。

启动先加载 bundled document，再在系统确认 online 时异步获取版本 manifest（connect/read 各 3 秒）。
离线、manifest 获取失败或非法都不阻断本地界面；可达且有效的 manifest 仍执行
`installed < minSupportedVersionCode` mandatory update，较新版本使用 existing optional update。
恢复联网会触发一次 coalesced 检查，不 reload 页面或清空回放。Native 错误页只表示本机页面 / 引擎故障
（加载失败、扩展安装失败、content 进程连续崩溃、端口被占用）；不存在 Network Gate 或远程 frontend retry-only 页面。

## 网络与业务边界

Android API transport 从本地 origin 解析到 `https://wotbtools.com`，以 Native 短期 Bearer 调用；Web 保持
同源 transport。生产 ingress（`deploy/tx/Caddyfile`）为 exact `http://127.0.0.1:21653`（3.0+）与
`https://appassets.androidplatform.net`（2.x 及回滚预案）两个 origin 允许所需 API CORS，不启用 credentialed
CORS、不依赖 third-party cookies。Native Bridge RPC 不是任意 HTTP proxy。

本地 import/parse、Data、deterministic Rating、2D 和 shots 可离线使用；AI、HoF、Profile backend 与
3D remote assets 使用共享 ONLINE_REQUIRED capability gate，离线保留入口并在发请求前立即给连接提示。
已缓存 Native session 或离线过期 token 不影响本地回放；API 调用等待联网和可用 token。
恢复联网不自动提交 AI，也不 reset selection、logout 或 reload。

过期 cached session 离线无法 refresh 时，`authGetAccessToken` 仍返回 `token: null` /
`error: refresh-failed`，但现有 nullable `claims` / `expiresAt` 保留 Native cached projection，
仅用于本地 UI 与 admin 能力入口可见性；它不允许过期 token 发 API 请求。真正未认证或永久拒绝
清空会话后，这些字段仍为 null。仪器测试只注入并恢复内存 fixture，不写认证存储、不使用真实凭据。

## 能力边界（V2 冻结区）

Android 不在 Native 层重写 AI Review / Battle Reconstruction / capability 业务状态机，
这些由 Vue 提供。Android 只实现 Web 之外的系统能力：

- 本机 origin（LocalRuntimeServer）与 GeckoView 加载、系统连通性、best-effort 更新、back、生命周期、本地错误屏
- 原生 OIDC 认证（Authorization Code + PKCE S256，外部 user-agent）与 token 生命周期
- Replay 意图入口（ACTION_SEND / ACTION_VIEW → content URI）
- Native Bridge（`getCapabilities`/`getPendingReplay`/`consumePendingReplay`/`checkForUpdate`/
  `startUpdate`/`authGetState`/`authLogin`/`authLogout`/`authGetAccessToken`；禁止
  readFile/http/execute/launch、禁止任何 refresh token 出口）——
  **origin-scoped**：内置扩展的 content script 只在 exact `http://127.0.0.1:21653` 的 top frame 暴露与
  v2 同形的 `window.WotbNative`（`postMessage(string)` / `addEventListener('message')` /
  `removeEventListener`），经 native messaging port 交给 Native；Native 只接受「content script ∧ top
  frame ∧ 当前 session ∧ exact `http://127.0.0.1:21653`」的 port，再交给不变的
  `NativeBridge.handleMessage`。exact origin 由**两层**共同执行：content script 的
  `isTrustedBridgeLocation`（`http:` + `127.0.0.1` + `21653` + top frame）与 Native 的
  `MainActivity.isLocalAppUrl(sender.url)`；manifest 的 `matches` 因为 Gecko 的 WebExtension match
  pattern **不支持 port**（MDN match patterns；Firefox bug 1362809 / 1468162）只能是粗粒度的
  `http://127.0.0.1/*` 注入范围，**不构成** origin 保证。回归用例：
  `frontend/src/platform/geckoBridgeOriginGate.test.js`（执行真实 `bridge.js`，逐个 URL 断言只有 exact
  origin 才会 `connectNative`）。不暴露给 Keycloak / IdP /
  任意第三方 frame；Native → Web 事件只会调用 contract `events` 列出的 global
- APK 下载、SHA-256 校验、installer、未知来源授权
- 复用 Web 的本机解析（上游 Rust Core WASM，服务器没有 parser；Android 不实现第二套解析，
  也不携带任何自有凭据）

Native Bridge 的 `getCapabilities()` 只表达**原生能力**（`native-auth`/`replay-share`/`replay-open`/
`app-update` / `connectivity`），不涉及 replay 业务 capability 判断（FULL/DEGRADED/PERFORMANCE 等由 Web 端接入）。
wire contract 的 SSOT 是 `contracts/android-native-bridge.json`（`bridgeVersion` 由
`android/gradle.properties:wotbNativeBridgeVersion` 锁定，CI 用 `scripts/android-release/android_contract.py`
校验 Native 实现、FE 声明与契约三方一致）。

## Authentication Boundary（Android 2.0 起：Native owns auth）

Android **不再**沿用 Web 的 keycloak-js 认证链：页面引擎（2.x System WebView / 3.0 GeckoView）不参与 OIDC，
也不存在 provider 级引擎 navigation allowlist。

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
  private-use redirect，且明确不使用内嵌 WebView/GeckoView 做 OAuth）。**版本固定 `0.11.1`**：这是 Maven Central
  上的最新发布；上游 release 节奏停滞是已知维护风险。升级时评估仍在维护的 RFC 8252 兼容实现，不自行实现 OAuth。
- **Chrome Auth Tab 不是 2.0 的前置条件**（上游对它的 first-class 支持尚未完成）。

### Redirect transport（两条，同一套实现）

| transport | URI | 使用条件 |
|---|---|---|
| 主回程（2.1.0 起固定）：private-use scheme | `com.wotbtools.app:/oauth2redirect` | **唯一**授权回程：不依赖 domain verification / 用户设置 / OEM 行为，所有设备一致 |
| 兼容回退：HTTPS App Link | `https://auth.wotbtools.com/android/oauth/callback` | 不再由决策产出。仅 2.0.x 旧版本 APK 的交易、或设备没能处理 private scheme 时，浏览器停在该 URL 的 Caddy 落地页（带「返回 App」按钮转发登录结果） |

两者共用同一个 Keycloak client、同一份 PKCE 实现、同一个 `AuthSession` 与同一个 token store ——
**不存在两套 auth implementation**。private scheme 使用 application-id namespace，不使用过于泛化的
`wotbtools://`。HTTPS transport 的 domain association 由既有
`auth.wotbtools.com/.well-known/assetlinks.json`（package + 生产签名证书指纹）承载，仅在
兼容回退路径继续生效。

浏览器真的停在
`https://auth.wotbtools.com/android/oauth/callback`（2.0.x 旧版本交易 / 设备没处理 private scheme）时，
`deploy/tx/Caddyfile` 在该 host 上用一个最小落地页回答这个精确路径（不再落到 Keycloak 的
catch-all 404）：页面带「返回 WotBTools App」按钮——把本页持有的 OAuth 响应（`location.search`）
原样转发给 `com.wotbtools.app:/oauth2redirect`，否则 App 侧的 AuthResponseGuard 收不到响应、
交易永远 pending——并提供下载入口。Keycloak 自身的路径（`/realms/...`、`/resources/...`）行为不变。
这个按钮是**兜底，不是主认证机制**。

### 2D 底图随包（与 Web 同字节，无派生）

APK 里随包携带 29 张 2D 离线底图，**就是 `frontend/src/assets/maps/*.webp` 的 canonical 原图**
（WebP q90，1254×1254、合计约 21.5 MiB；来源 = Agent 仓 asset_pack `ground.webp` 派生，配方与验收见
[reference/maps.md](../reference/maps.md) §2026-10-16）——**Web 与 APK 用同一份字节，Android 不做任何
缩放/重编码**（2026-10-16 起取消此前的 ≤1024² 派生：视觉一致性优先于 APK 体积）。

- 随包完整性 **fail closed**：`scripts/build-android-bundle.mjs` 的 `buildMap2dEmbedded` 解析
  `src/data/mapImages.js` 注册表，逐张要求 APK assets 里存在对应 `<名>-<内容哈希>.webp`，缺一即构建失败；
  同时写下运行时的兜底判据 `map2d-embedded.json`（code → 随包 sha256）与 bundle manifest 的 `maps` 段
  （`{source: 'canonical-1254', files, totalBytes, largest}`）。
- 注册表完整性、1254² 规格与体积量级由 `src/assets/maps.test.js` 在 frontend CI 守（无需 Pillow / 无派生管线）；
- 由此 APK 体积比旧派生方案 +13.4 MiB（8.14 → 21.5 MiB，2D 底图部分）；这是刻意的取舍：
  少一条 Pillow 派生链、两端像素完全一致、离线兜底也是最高清的一份。

### 2D 底图的运行时更新（包内兜底 + 在线校验）

APK 里那套 29 张底图是**兜底层**（离线永远可用，且与 Web 同字节）。在线时 App 经 `/agent-assets` 与 Native `AgentAssetProxy` 从 Alibaba 的 `map2d/index.json`
（经 `AgentAssetProxy` 同源直连）核对：先取候选索引中 **`generated` 最大者**（stale proxy 的旧缓存
不得覆盖见过的新版），若它**比包内内容更新**（`generated > 包内 contentGeneratedAt`，该时间戳是
底图内容的生成时刻、不是构建时间）且该图 `sha256` 与包内不同，则拉取远端图、**sha256 校验通过**后
以 blob URL 顶替包内图；
取不到 / 校验失败 / 索引比包内旧 ⇒ 继续用包内（绝不降级、绝不抛错）。因此**更新已有地图的底图
不需要发 APK**（Agent 仓上传 `map2d/` 即达用户）；**新增地图仍需发版**（注册表与 WASM 在包内）。
2.5D（`BattleMap3D`）**不被该通道阻塞**：贴图始终先用包内图渲染到 ready，远端校验通过后
再在后台热替换 `material.map`（离线/慢网时 OTA 的最坏等待不再落在首次渲染路径上）。
规则与失败姿态、诊断开关（`window.__wotbMap2d`）、契约测试见
[reference/maps.md](../reference/maps.md) §2026-10-16；实现单点 = `frontend/src/data/map2dOverlay.js`。

观感"看起来够不够清楚"属**视觉验收**：由用户在真机 2D 回放目视确认；要改清晰度/体积，
改 Agent 仓 `tools/export_2d_basemaps.py` 的冻结配方（对比曲线/饱和/USM/编码参数）后重出底图。

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
  明确禁止：明文 SharedPreferences refresh token、页面 localStorage refresh token、
  Cookie → Native token 复制、Native → JS refresh token 暴露。
- **单飞 refresh**：并发 `authGetAccessToken` 只触发一次 refresh；refresh 的永久 token 拒绝清空 Native 会话；离线/网络/服务失败保留加密 cached session 并回报
  `refresh-failed`（`authGetAccessToken` 的 `error` 字段），Web 侧清除不可用的 API token，但保留 Native cached session 的登录投影和本地回放状态。
  Logout / 账号替换在同一把持久化锁下推进 session generation。迟到的 refresh 成功/拒绝不能恢复已登出会话、覆盖/清空新账号，也不能释放更新 generation 的 waiter。瞬时失败不会产生 authChanged 重试循环。


### 登录 / 登出语义

- `authLogin()` 只启动外部 user-agent；**页面不导航、不重载**，登录完成后 Native 通知页面
  （`window.wotbtoolsOnAuthChanged()`），SPA 保持在原视图并重新同步状态。
- `authLogout()` = 清 Native 会话 + 发起 Keycloak OIDC end-session（带 id-token hint）。**不**删除 Chrome
  cookie、**不**强制登出 QQ / Wargaming、**不**操作 provider session：下一次登录时若系统浏览器仍保有
  IdP session，那是 provider/browser 的正常 SSO 行为。

### Bridge 是独立边界

Native Bridge 与 OAuth 是两个独立安全边界。Bridge v3 只接受 canonical local origin
`http://127.0.0.1:21653` 的 top frame（v2 时代的 appassets / `wotbtools.com` 兼容 origins 已删除），
不暴露给 Keycloak、QQ/IdP 或第三方 frame；禁止在引擎与系统浏览器之间同步 Cookie。

## Replay 意图与认证的导航边界

外部 replay 是一个 **pending action**，不是特殊应用模式：Android 只负责安全接收、持久化与通知
Web，绝不自行决定「是否解析」「是否绕过登录」。

- **认证不再参与 navigation**：登录发生在外部浏览器，引擎不承载 OIDC，因此 replay intent 与认证
  之间没有所有权冲突 —— 登录期间收到 replay 正常持久化并按 `ReplayDispatchPolicy` 分发，正在进行的
  OIDC 事务不会被 replay 打断。分发只在页面被门禁 / 错误页 / 更新页接管时暂缓。
- **单一 ingress**：只有 Intent → private cache → Native Bridge → Web fetch 固定同源 synthetic
  resource（LocalRuntimeServer）一条路径；普通 file prompt 从不注入 pending replay。
- **跨 process death 存活**：pending metadata 落在 app private storage（1h TTL），启动时先恢复
  active pending、再按引用清理 orphan cache。
- **identity-aware ACK**：pending identity 是完整 UUID（`pendingId`）。Web 在本机分析完成后调用
  `consumePendingReplay(pendingId)`，Native 执行 compare-and-clear（纯策略 `PendingReplayAckPolicy`）：
  只有 identity 与当前 pending 完全一致才清 slot + metadata；identity 缺失或已被更新的 replay 取代
  （stale）一律不清理，保证 exactly-once 且绝不误清新 pending。
- **登录不是 replay 的前置条件**：本机分析在本机完成，未登录同样可打开、解析与导出；认证失败 / 取消
  不会让已接收的 pending replay 失效。

手动目录选择与 external pending 不同：可选 `replay-folder-picker` capability 经 SAF 只保留瞬时目录引用，固定同源 stream 读取后释放；不自动解析、不跨进程保存目录授权。FileDrop 继续持有回放筛选与完整批次校验，普通文件多选保持原样。旧 v2 APK 缺少能力时隐藏目录入口，不能以 `allowFolder=false` 禁掉多选。详见 [`replay-intent.md`](replay-intent.md)「App 手动目录导入」。

细节契约与日志白名单见 [`replay-intent.md`](replay-intent.md)。

## 运行时安全（GeckoView + LocalRuntimeServer）

- **导航**：主文档只允许 exact `http://127.0.0.1:21653`（与 `about:blank`）；唯一例外是内嵌 origin
  等于本机 origin 的 `blob:` 下载派发（见「引擎」一节的下载说明与 `NavigationPolicy`）；外部
  `https:` / `mailto:` 交给系统浏览器，其它 scheme 一律拒绝。引擎**不创建 Gecko 多窗口**：没有第二个
  `GeckoSession`，`onNewSession` 返回 null，`target=_blank` / `window.open` 按目标分四种处置：
  ① 本机 origin（含 `about:blank`）→ 降级为**当前 session** 导航（`load(uri)`），不新开窗口；
  ② 外部 `https:` / `mailto:` → 交 Android system handler（系统浏览器 / 邮件应用），页面不导航；
  ③ trusted local `blob:` → 只允许 Gecko 的下载派发（不 `load(blob)`、不交系统浏览器）；
  ④ 其它 scheme / 非可信 blob → fail-closed 拒绝。iframe 只允许本机 origin；生产 API、Keycloak 与
  IdP 不在引擎内导航。
- **本机 server**：只 bind `127.0.0.1`；`Host` 必须等于 `127.0.0.1:21653`（防 DNS rebinding）；带 `Origin`
  的请求必须来自本机 origin（挡住设备上其它浏览器里的跨源页面）；只收 GET/HEAD，不读 body、不列目录、
  不做代理；拒绝 `..` / 编码分隔符 / 反斜杠 / 控制字符；请求头大小与读超时有上限。设备上其它 App 也能
  连到 loopback：静态 bundle 本就公开在 APK 里，replay 字节只经 `/__native/*`，仍要求不可猜的 UUID
  identity header（pendingId / selectionId + fileId）。
- `usesCleartextTraffic=false` 不变：Native 的 HTTPS 客户端（更新、资产代理、认证）仍禁止明文；
  页面与本机 server 之间的 loopback HTTP 由 Gecko 自己的网络栈处理。
- 页面 CSP 不变（`default-src 'none'`，脚本 / WASM 只允许 self，`connect-src` 只有 self + 生产 API）。
- Native Bridge 只暴露给本机 origin 的 top frame，任意第三方页与 iframe 不可调用。
- App 不读取、复制或持久化引擎 Cookie；认证只用 Native Bearer。

## 权限（least privilege，规格 §69）

`INTERNET`、`ACCESS_NETWORK_STATE`、`REQUEST_INSTALL_PACKAGES` + FileProvider URI grant。
不申请 `READ_EXTERNAL_STORAGE` / `MANAGE_EXTERNAL_STORAGE` / Contacts / Location / Camera / Microphone。
GeckoView 库的 manifest 会合并进 `WAKE_LOCK` 与 `MODIFY_AUDIO_SETTINGS` 两个安装时 normal 权限（无运行时弹窗，
引擎媒体播放需要）；页面发起的相机 / 麦克风 / 定位 / 通知等请求由 `PermissionDelegate` 一律拒绝。

## 验证分工

CI 覆盖 Native JVM 单测、前端单测、bridge contract 三方一致、release helpers 与 APK bundle 身份。
2.x 的 WebView instrumentation smoke（基于 `WebView.evaluateJavascript`）随引擎迁移删除；
引擎层的真实行为（冷启动 / 离线、replay 导入、3D、fullscreen、认证回跳、自更新、后台回收恢复）由
发布前的真机验收负责（至少一台 Android 9 设备 + 一台 Android 13+ 设备），见 `release-process.md`。

执行真机矩阵时记录 model / Android / GeckoView 版本、最终 APK SHA256、bundle buildCommit 和每项 PASS/FAIL。

Android 严格 CSP 只允许本地脚本 / 现有 bootstrap hash 与 WASM 编译；业务 connect 仅 self 和 production wotbtools origin。既有 OpenAPI generator 生成 Ajv standalone ESM validators，GeckoView 无 runtime eval/new Function。Bundle URL graph / CSS references / APK 文件 SHA 全部 fail-closed。
