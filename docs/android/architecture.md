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
        ReplayIntentHandler.kt# ACTION_SEND/ACTION_VIEW → PendingReplay
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
- 复用现有 Web upload transport（`/api/replay/processing-jobs`）

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
  `ssl.ptlogin2.qq.com`、`ptlogin2.qq.com`、`open.juhedenglu.cn` 等只有在真实 top-level
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
- **QQ native login return bridge（Verified App Link）**：QQ App 完成授权后，把 Keycloak Juhe QQ broker
  callback 经 **Verified App Link** 路由回原 WotBTools App，复用同一 WebView / cookie jar / `inAuthFlow`，
  保持 AuthenticationSession continuity；绝不打开系统浏览器处理 broker callback（否则 Browser B != 原
  WebView A，getAndVerifyAuthenticationSession 无法恢复原 auth transaction → already_logged_in）。链路：
   `WebView → native QQ → verified HTTPS App Link → 同一 MainActivity（singleTask）→ 原 WebView.loadUrl(callback)`。
  App Link 只接管 exact `https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint`，不接管整个
  `auth.wotbtools.com` / 其它 realm / 其它 IdP provider。`AuthReturnPolicy` 仅做路由边界（scheme/host/path/
  type=qq/state/code presence），不解释 state/code 载荷（Keycloak 仍是认证 authority）；
  `auth.wotbtools.com/.well-known/assetlinks.json` 由 nginx 直接返回 application/json（非代理 Keycloak）。
  热返回走 `onNewIntent`（`handleAuthReturnHot`），冷返回（进程被杀）走 `pendingAuthReturn` + startup gate
  后加载（`handleAuthReturnColdStart`），不绕过网络/版本/强制更新门禁。日志只记录
  `auth-return action=... source=app-link`，不记录完整 callback URI/query/state/code（见 `AuthReturnPolicyTest`）。
- 返回 `wotbtools.com` / `www.wotbtools.com` 表示 callback 成功并结束 auth flow。认证外直接访问
  provider host 不获得 privileged WebView handling；其它 top-level host 由系统浏览器打开。
- Native Bridge 与 OAuth navigation 是两个独立安全边界。Bridge origins 仍严格限于
  `https://wotbtools.com` 与 `https://www.wotbtools.com`，不暴露给 Keycloak、QQ/IdP 或第三方 frame。
- 禁止在 WebView 与系统 browser 之间同步 Cookie。真机发现新 provider hostname 时，只记录不含
  query/code/Cookie/token 的 host evidence，判断其是否属于实际认证链后最小追加 allowlist。

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
