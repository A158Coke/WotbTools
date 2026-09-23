# WotBTools Android — 架构

## 定位

WotBTools Android 是现有 Vue/Web 的**纯联网 Thin Client**（用户规格 §8）。它不是第二套 WotBTools：
所有业务运算（replay 解析、Rating、AI、战局重建）仍在服务器；Android 只负责设备能力、文件入口、
Web 容器、网络门禁与 APK 更新。

```text
Android App (Native shell)
   └── WebView ──> https://wotbtools.com
```

普通业务更新 = Web deploy → Android 自动获得，无需重发 APK；只有 Native 层变化（Intent/
WebView/manifest/bridge/updater/shell）才重发 APK。

## 工程结构

```
android/
  settings.gradle.kts
  build.gradle.kts            # plugin 版本
  gradle.properties
  app/
    build.gradle.kts          # namespace com.wotbtools.app, minSdk 26
    src/main/
      AndroidManifest.xml
      java/com/wotbtools/app/
        MainActivity.kt       # 编排（门禁/web/back/意图/file-chooser/bridge）
        StartupGate.kt        # 网络 + version.json（fail-closed）
        VersionManifest.kt    # version.json 解析
        ApkUpdater.kt         # 下载 / SHA-256 / installer
        ReplayIntentHandler.kt# ACTION_SEND/ACTION_VIEW → PendingReplay（+ metadata 持久化/恢复）
        ReplayDispatchPolicy.kt # pending replay 分发决策（纯逻辑，JVM 单测）
        NativeBridge.kt       # getCapabilities / getPendingReplay / ...（白名单）
      res/
        layout/activity_main.xml         # webView + networkGate + versionGate + webError
        values/{strings,colors,themes}.xml
        xml/file_paths.xml               # FileProvider cache-path
        drawable/ic_launcher_foreground.xml
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
- Replay 意图入口（ACTION_SEND / ACTION_VIEW → content URI）
- 极薄 Native Bridge（`getCapabilities`/`getPendingReplay`/`consumePendingReplay`/
  `checkForUpdate`/`startUpdate`；禁止 readFile/http/execute/launch）——
  **origin-scoped**：经 AndroidX WebKit `WebMessageListener`（`addWebMessageListener`），
  仅 `https://wotbtools.com` / `https://www.wotbtools.com` 可调，不暴露给 Keycloak / IdP /
  任意第三方 frame（替代 `addJavascriptInterface` 的全 frame 暴露）
- APK 下载、SHA-256 校验、installer、未知来源授权
- 复用现有 Web upload transport（`/api/replay/processing-jobs`，后端要求已登录的
  `wotbtools-user` / `wotbtools-admin`；Android 不实现第二套上传/解析，也不携带任何自有凭据）

Native Bridge 的 `getCapabilities()` 只表达**原生能力**（`replay-share`/`replay-open`/
`app-update`），不涉及 replay 业务 capability 判断（FULL/DEGRADED/PERFORMANCE 等由 Web 端接入）。

## Authentication Boundary

- Android 沿用 Web Keycloak/OIDC，不实现 native OAuth client、token store 或第二套登录状态。
- Keycloak → QQ/IdP → Keycloak callback 的一次 authentication transaction 必须始终运行在同一个
  WebView cookie jar 中。`MainActivity.configureWebView()` 显式启用 WebView CookieManager 的
  first-party 与认证所需 third-party cookies；应用不读取、复制或持久化 Cookie。
- `auth.wotbtools.com` 只在 WebView 内启动/保持 `inAuthFlow`。认证期间，provider 仅按
  `AuthNavigationPolicy.AUTH_PROVIDER_HOSTS` 的精确 hostname allowlist 留在 WebView；当前有仓库
  证据的 QQ host 是 `graph.qq.com` 与 `xui.ptlogin2.qq.com`（后者基于 Android 1.0.8 真机 ADB
  生产链 evidence：Keycloak → graph.qq.com → xui.ptlogin2.qq.com → callback，见
  `AuthNavigationPolicyTest.productionQqAuthChainStaysInWebViewUntilAppCallback`）。
  `ssl.ptlogin2.qq.com`、`ptlogin2.qq.com` 等只有在真实 top-level
  navigation evidence 确认后才可逐个加入，并必须同步 regression test；禁止 `*.qq.com` 或整个
  `qq.com` 通配。
- **Native auth handoff**：Android 1.0.9 真机 ADB 证据显示 `xui.ptlogin2.qq.com` 之后 QQ 登录会发起
  native 跳转 `wtloginmqq://ptlogin/...`。这里 `ptlogin` **不是**普通 HTTPS hostname，而是 QQ native
  login handoff 的 URI host。用 `AuthNavigationPolicy.NATIVE_AUTH_TARGETS` 以精确 (scheme, host) 建模
  （当前 evidence-backed 目标为 `scheme=wtloginmqq` `host=ptlogin`），并严格区分：
   - **Web authentication hosts**（`AUTH_PROVIDER_HOSTS`）：`graph.qq.com` / `xui.ptlogin2.qq.com`
     → `ALLOW_AUTH_WEBVIEW`，仅在 `inAuthFlow=true`。
   - **Native authentication handoff**（`NATIVE_AUTH_TARGETS`）：`wtloginmqq://ptlogin` 在
     `inAuthFlow=true` 时 `NATIVE_AUTH_HANDOFF`，交给 QQ App（ACTION_VIEW）并保留当前 WebView
     auth transaction 与 cookie jar；**不**进入 `auth-recovery`、不 reload 首页、不打开系统浏览器、
     不复制 cookie。QQ App 未安装时 fail closed（提示安装后重试），不 silent fallback。
  native handoff 不做 scheme 前缀 / host 后缀 / `mqq*` / `*.qq.com` 通配信任；未观察到的 native
  scheme/host（含 host=null 的未知 custom scheme）在 auth flow 内仍 `AUTH_FAILURE` 且不退出 auth flow
  （fail closed）。日志只记录 `scheme`/`host`/`source`，不记录
  完整 URI/query/token/code/state（见 `AuthNavigationPolicyTest.verifiedNativeQqHandoffOnlyDuringAuthFlow`）。
- **QQ native login return：Primary（app-owned native return）+ Fallback（Verified App Link）**：QQ App
  完成授权后回程有两类通道，终点都必须是原 WotBTools App —— 同一 MainActivity（singleTask）/ 同一
  WebView / 同一 cookie jar，`inAuthFlow` 保持，绝不用系统浏览器处理 broker callback（否则
  Browser B != 原 WebView A，getAndVerifyAuthenticationSession 无法恢复原 auth transaction →
  already_logged_in）。
  - **Fallback（当前唯一在产机制）**：
    `WebView → native QQ → HTTPS broker callback → Verified App Link → 同一 MainActivity → 原 WebView.loadUrl(callback)`。
    **Verified App Link is fallback, not the sole auth-continuity mechanism**：它的实际可用性依赖设备 /
    ROM 的 domain verification，不能作为唯一回程。App Link 只接管以下**唯一** exact callback
    （`idp-qq` 是唯一生产 QQ alias；聚合数据 provider 已从镜像与 Android 侧退役）：
    `https://auth.wotbtools.com/realms/wotbtools/broker/idp-qq/endpoint`，不接管整个
    `auth.wotbtools.com` / 其它 realm / 其它 IdP provider。`AuthReturnPolicy` 严格校验 scheme/host/path、
    `state`。成功回调要求 `code`（OAuth error 回调则有 `error`）；历史聚合 provider 的
    `type` / `ticket` 参数不再被识别，其 callback path 直接判定为非本 App 的 broker return；
    `auth.wotbtools.com/.well-known/assetlinks.json` 由 nginx 直接返回 application/json（非代理 Keycloak）。
    热返回走 `onNewIntent`（`handleAuthReturnHot`），冷返回（进程被杀）走 `pendingAuthReturn` + startup gate
    后加载（`handleAuthReturnColdStart`），不绕过网络/版本/强制更新门禁。日志只记录
    `auth-return action=... source=app-link`，不记录完整 callback URI/query/state/code（见 `AuthReturnPolicyTest`）。
  - **Primary（app-owned native return mechanism；future / not enabled）**：让 QQ 的 native 登录回程
    直接回到本 App，而不是经过系统浏览器。**具体 return mechanism 尚未决定**：把 `schemacallback`
    指向 App 自有的 custom scheme 只是**候选之一**，PR A 刻意不冻结任何 scheme、也不冻结任何具体
    URI 形态 —— 启用前必须先做单独 security review（custom scheme hijacking 风险、是否存在
    package-bound / 其它更强绑定形式、callback 是否携带可被第三方窃取的 credential，若有更强机制应
    优先评估），并且必须拿到真机 URI 证据（见下面的 evidence 小节）。
    **当前生产恒不启用**：`QqNativeHandoffPolicy.RECOGNIZED_SHAPE_EVIDENCE = false` ⇒
    `plan(...).rewrite` 一律 `DO_NOT_REWRITE` ⇒ handoff 逐字节沿用 QQ 原始 URI
    （`startActivity(Intent(ACTION_VIEW, originalUri))`，production 不做任何 URI mutation），并记录
    `native-handoff rewrite=fallback reason=<token> category=<browser|unknown>`。
    原因：QQ 的 `wtloginmqq://ptlogin/...` 参数形状属于**未经证实的私有 contract**，猜测性改写会让
    QQ 不再回调 HTTPS broker callback ⇒ 全量登录失败。决策边界独立成纯策略
    `QqNativeHandoffPolicy`（JVM 单测覆盖）：它**不**复制第二份 (scheme, host) 信任表，而是直接读
    `AuthNavigationPolicy.NATIVE_AUTH_TARGETS`；`schemacallback` 只判断**存在性**并按其**值的 scheme 段**
    分类（`browser`／其它一律 `unknown`），value 本身不返回、不落日志。
  - **App Link 健康诊断 + OEM recovery（`AuthLinkHealth`，只诊断、不 gate 登录）**：Android 12+
    （API 31）用 `DomainVerificationManager.getDomainVerificationUserState()` 读取 `auth.wotbtools.com`
    的状态，归一化为 `VERIFIED` / `SELECTED` / `NONE` / `UNAVAILABLE`（`UNAVAILABLE` = API 不支持 /
    平台返回未知取值 / 系统服务异常；用户关闭「打开支持的链接」时，即使 host 已 VERIFIED / SELECTED 也
    归一化为 `NONE`）。纯归一化逻辑（`AuthLinkHealth`，JVM 单测覆盖）与 Android adapter
    （`MainActivity.probeAuthLinkHealth`，用平台常量翻译成本地枚举、不比较裸数字）分离；process 内只探测
    一次并记录一次 `auth-link-health host=auth.wotbtools.com state=<token>`。`NONE` **不** fail closed：
    QQ 登录照常继续；只有当 QQ handoff **真的**交给了外部 App（`startActivity` 成功）后才显示一次
    （process 级一次性）recovery banner —— QQ 未安装 / 启动失败时只提示「未检测到 QQ 客户端」，
    不叠一条无意义的 app-link 提示。按钮跳
    `Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS`（API 31+）或 `ACTION_APPLICATION_DETAILS_SETTINGS` 的
    `package:com.wotbtools.app` 页；App **不自动修改任何系统设置**，也不循环提示。banner 的生命周期只
    绑定「本次 QQ auth transaction 可能回不来」这一前提：一旦收到**受信任的** auth return
    （`handleAuthReturnHot` / `handleAuthReturnColdStart` 通过 `AuthReturnPolicy` 校验）就立即
    `dismissAuthLinkRecovery(reason=trusted-auth-return)`（用户点按钮则是
    `reason=open-settings`，两个 token 不混用）；普通页面 reload / 门禁切换**不**清除提示
    （用户可能仍在有风险的 auth flow 中）。
  - **`UNAVAILABLE` 的语义边界**：只记录诊断，**不**显示「未开启 supported links」这类可能误导的提示
    （该状态的含义是「无法判断」，不是「未验证」）。

### QQ native handoff evidence（PR A 记录；Primary 通道启用的前置条件）

已证实（Android 1.0.9 真机 ADB）：

- `scheme = wtloginmqq`、`host = ptlogin`（`AuthNavigationPolicy.NATIVE_AUTH_TARGETS`，唯一可信目标）。

尚未证实（**必须**先取得真机证据才能启用 rewrite）：

- path 形状（现有记录只到 `wtloginmqq://ptlogin/...`）；
- query **key 名**集合；
- `schemacallback` 是否存在、其值形态、QQ 是否真的按它回调；
- QQ 是否把可恢复的 HTTPS continuation 交给该 callback（否则改写只会中断登录）。

DEBUG-only 取证：debug 构建下 native handoff 会多打一行
`native-qq-shape pathPresent=true pathSegmentCount=2 keys=[...] schemacallback=true|false` —— 只输出
**结构**：path 是否存在、path segment 的**数量**、query **key 名**、`schemacallback` 是否存在。
`describeQqHandoffShape` 的签名里既没有 raw path、也没有任何 value，因此 raw path / path segment 内容 /
query value / `schemacallback` value / `p` / `state` / `code` / `ticket` / `token` 在物理上无法进入日志
（path 只记结构计数，因为 QQ 私有 contract 未取证，无法证明 path 不携带 opaque / session-like value）。
取证完成后该诊断与 `describeQqHandoffShape` 整体删除。

> domain verification may differ by device / ROM：同一份 manifest + assetlinks.json 在不同 OEM / ROM 上
> 可能得到不同的 `DomainVerificationUserState`，因此 App Link 不能作为唯一 auth-continuity 机制。

- 返回 `wotbtools.com` / `www.wotbtools.com` 表示 callback 成功并结束 auth flow。认证外直接访问
  provider host 不获得 privileged WebView handling；其它 top-level host 由系统浏览器打开。
- Native Bridge 与 OAuth navigation 是两个独立安全边界。Bridge origins 仍严格限于
  `https://wotbtools.com` 与 `https://www.wotbtools.com`，不暴露给 Keycloak、QQ/IdP 或第三方 frame。
- 禁止在 WebView 与系统 browser 之间同步 Cookie。真机发现新 provider hostname 时，只记录不含
  query/code/Cookie/token 的 host evidence，判断其是否属于实际认证链后最小追加 allowlist。

## Replay 意图与认证的导航边界

外部 replay 是一个 **pending action**，不是特殊应用模式：Android 只负责安全接收、持久化与通知
Web，绝不自行决定「是否解析」「是否绕过登录」。

- **认证是唯一 navigation authority**：`inAuthFlow=true` 期间到达的 replay intent 只入队
  （`ReplayDispatchPolicy` → `NONE`），不 `loadUrl`、不 `evaluateJavascript`，当前 Keycloak/QQ
  authentication transaction 不被 replay 打断；auth return（当前为 verified HTTPS App Link）恒为最高
  优先级；`ReplayDispatchPolicy` 在门禁 / 错误页接管（WebView 不可见）时同样不分发。
- **单一 ingress**：只有 Intent → private cache → Native Bridge → Web fetch 固定同源 HTTPS synthetic resource 一条路径；
  已删除 `onShowFileChooser` 对 pending replay 的注入分支。
- **跨 process death 存活**：pending metadata 落在 app private storage（24h TTL），启动时先恢复
  active pending、再按引用清理 orphan cache。
- **identity-aware ACK**：pending identity 是完整 UUID（`pendingId`）。Web 在 server 接受 processing
  request 之后调用 `consumePendingReplay(pendingId)`，Native 执行 compare-and-clear（纯策略
  `PendingReplayAckPolicy`）：只有 identity 与当前 pending 完全一致才清 slot + metadata；identity
  缺失或已被更新的 replay 取代（stale）一律不清理，保证 exactly-once 且绝不误清新 pending。Web 同时把
  `pendingId` 作为 processing create 的 `operationId`，使「server 已接受但 ACK 前 process death」的
  重放拿回同一个 job（不产生 duplicate Processing Job）。
- **未登录不解析**：未登录时 pending 原样保留且不消费，登录完成前不会发出 processing 请求。

细节契约与日志白名单见 [`replay-intent.md`](replay-intent.md)。

## WebView 安全（规格 §28–§29 / §86–§88）

- app host 始终允许留在 WebView；Keycloak 与 provider 仅按上面的 Authentication Boundary 在认证
  flow 中允许留在 WebView；其它外链走系统浏览器。
- `usesCleartextTraffic=false`；`mixedContentMode=NEVER_ALLOW`；`allowFileAccess=false`；
  `allowContentAccess=false`；`setGeolocationEnabled(false)`。
- 禁用 `allowUniversalAccessFromFileURLs` / `ignoreSslErrors`；SSL 错误必须失败。
- Native Bridge 只加到 `wotbtools.com` 页面，第三方页不可调用。

## 权限（least privilege，规格 §69）

`INTERNET`、`ACCESS_NETWORK_STATE`、`REQUEST_INSTALL_PACKAGES` + FileProvider URI grant。
不申请 `READ_EXTERNAL_STORAGE` / `MANAGE_EXTERNAL_STORAGE` / Contacts / Location / Camera / Microphone。
