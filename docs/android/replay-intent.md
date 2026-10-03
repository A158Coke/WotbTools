# Android Replay Intent

## 支持通道（V1 单个）

- **App 内选择**：现有 Vue `<input type="file" accept=".wotbreplay">`（`FileDrop.vue`）。
- **Share to WotBTools**：`ACTION_SEND`，`content://` URI。
- **Open With WotBTools**：`ACTION_VIEW`，文件管理器 → `content://` URI。

`ReplayIntentHandler` 只提取 `name/uri/size`，**不解析 replay**；业务校验（`.wotbreplay`、
20 MiB / 100 文件 / 200 MiB）沿用现有 `frontend/src/utils/replayUpload.js` 与后端 validator
（Kotlin 不复制，规格 §40）。

## 单一交接通道（唯一 ingress，不依赖 Base64，规格 §38/§39）

### HTTPS pending resource（2026-09-10 hotfix）

旧链路在 `allowContentAccess=false` 的 WebView 中 `fetch(content://...)`，登录成功后可能无法读取字节，
因此无法创建 Processing Job。修复保留 `allowFileAccess=false` / `allowContentAccess=false`。

- Bridge 的 `uri` 固定为 `https://wotbtools.com/__native/replay-pending`；这是 Native resource，不是后端 API。
  App canonical origin 是 `https://wotbtools.com`；URL 不含 query、pendingId、文件名、本地路径或凭据。
- Web 用 `X-Wotb-Pending-Id` request header 传 metadata identity；Native 比较当前 snapshot 的 identity，
  再打开同一 snapshot 的 backing file，防止新 replay B 替换 A 后，B 的内容被关联到 A 的 pendingId。
- Exact URL 始终 Native-owned：文件存在返回 200 octet-stream + FileInputStream；无 pending/文件返回 404；
  identity 缺失或不匹配返回 409；打开文件异常返回 500。错误不能 return null 或落到真实网络。
- 所有响应 `Cache-Control: no-store`；Web fetch 使用 `cache: no-store`，防固定 URL 复用旧内容。
- fetch/blob 失败复用 Replay 错误区和重试按钮，不分析、不 ACK、不删除 metadata。
  分析完成后的 compare-and-clear ACK 与 deferred drain 保持原有顺序。
- 阶段日志只允许 event/status/已有 short ref；禁止 full ID、文件名、路径、异常原文、OAuth code/state、token/cookie。
- 必须发布更新 APK 和 Web；仅部署 Web 无法修复旧 APK 的 content transport。

真机发布验收（不能用 JVM/Vitest 代替）：未登录打开 replay → 本机分析 → Data（不发出任何回放相关后端请求）；
已登录同样直接导入；process death 后重开会恢复并重新分析同一份 pending（本机分析无副作用，
结果相同）。记录低敏 `replay-pending stream requested/served`、analysis completed；
勿保存完整请求头、OAuth URL 或 pending identity。清 App 数据须由测试者明确同意。

```text
ACTION_SEND / ACTION_VIEW
  → external content URI（ContentResolver 读取，不依赖真实路径）
  → 最小验证(.wotbreplay) + 复制到 app private cache
  → private cache backing file + pendingId（完整 UUID，authoritative identity）+ createdAt
  → pending slot（single slot：最新 replay 取代旧 pending）+ SharedPreferences metadata
  → 工作台挂载后经 NativeBridge getPendingReplay() 取回 pendingId/name/size/uri
  → Web fetch 固定同源 HTTPS synthetic resource 读字节构造 File → 现有 FileDrop/validate 管线
  → 本机分析（上游 Rust Core WASM；服务器没有 parser，不上传回放）
  → 分析完成后 Web 调 consumePendingReplay(pendingId) ACK（compare-and-clear）
```

Android 外部 replay **只有这一条** ingress。曾经的第二条路径——WebView `onShowFileChooser`
拦截 `<input type=file>` 并把 pending URI 直接回传给页面——已删除；普通 Web file chooser 仍走
Android 系统 picker，与 pending replay 无关。Kotlin 侧不做任何 replay 解析、不建立第二套
uploader。

非 `.wotbreplay` candidate 安全忽略（返回 null，不交给 Web upload pipeline）。`allowContentAccess=false`
与 app-owned FileProvider URI 兼容：字节经 `WebViewClient.shouldInterceptRequest` 以文件流返回给
Web，不依赖 WebView 直接读取 external content URI，也不放宽 WebView 安全边界。

## 导航所有权（与认证完全解耦）

Android 2.0 起认证由 Native 在**外部浏览器**完成，WebView 不再承载任何 OIDC 导航，因此 replay
ingress 与认证之间**不存在**所有权冲突：replay 意图没有 auth-return 分支，认证也没有任何
WebView navigation 可以「优先」。

- intent 分类只做一件事：非 replay intent 返回 false，replay candidate 入队；**是否分发、如何分发**
  由纯策略 `ReplayDispatchPolicy.decide(hasPendingReplay, webViewVisible, currentUrl)` 唯一决定：

| 条件 | 动作 |
|---|---|
| 无 pending / WebView 容器不可见（门禁 / 错误 / 更新页接管） | `NONE`——只入队，不 `loadUrl`，不 `evaluateJavascript` |
| 已在 replay workspace（URL 含 `view=replay`） | `NOTIFY_WEB` → `window.wotbtoolsOnReplay()` |
| 其它 | `NAVIGATE_REPLAY` → `loadUrl(https://wotbtools.com?view=replay)` |

- **登录期间收到 replay**：正常持久化并分发（WebView 没有被认证占用）；正在进行的 OIDC 事务在外部
  浏览器里，不会被 replay 打断。**登录失败 / 取消 / 未登录**时 pending replay 原样保留且仍可用——
  认证不是 replay 的前置条件。
- 非 replay intent（例如 launcher `ACTION_MAIN`）不清空既有 pending：pending 只由 Web consume、
  TTL/损坏判断或另一份更新的 replay 取代。
- `ReplayDispatchPolicy.REPLAY_VIEW_MARKER` 同时用于构造 `REPLAY_URL` 与识别「已在 replay view」，
  避免导航目标与识别条件漂移。

## 跨 process death 的 pending durability

- metadata 持久化在 app private storage（SharedPreferences `replay_pending`）：
  `pendingId`（完整 UUID，authoritative identity）/ `cacheFilename` / `originalName` / `size` /
  `createdAt`；行式 `key=value` 编码，`pendingId` 需通过长度与非空校验。
  **不保存** replay 内容、不 Base64、不保存 external 绝对路径、不保存 token/cookie/QQ 凭据。
- replay 字节仍放在 app private `cache/replay/`（FileProvider `cache-path`）。
- 启动顺序：`ReplayIntentHandler.restorePending()` 先尝试恢复 active pending（metadata 可解码、
  filename 通过安全校验、backing file 存在、未过期），随后
  `ReplayIntentHandler.cleanupOrphans(context, activeFile)` **只清理不再被它引用的**缓存文件——
  active backing file 绝不删除。不再无条件清空整个 replay cache。
- TTL 24 小时（`PENDING_TTL_MS`）：本地 cache hygiene，与 Keycloak/client login timeout 无关；
  过期 pending 在下次启动被丢弃并清理。
- ACK 后（`consumePendingReplay(pendingId)`）：清 pending slot + 清持久 metadata（exactly-once），
  下次启动不再恢复该 replay。backing file 不立即删除（Chromium 可能仍在读取 Web
  synthetic HTTPS resource 的响应流），留到下一次启动 orphan cleanup 安全清理。

## ACK 语义（identity-aware exactly-once）

Web 侧 `useNativeReplayImport` 的顺序固定为：

```text
getPendingReplay → fetch(synthetic HTTPS resource) → await onPendingFile(file, pending) → 受理成功
  → consumePendingReplay(pending.pendingId)
```

- **ACK 必须携带 exact pending identity**（`pendingId`，完整 UUID；不是资源 URI 字符串）。
  Native 执行 **compare-and-clear**（纯策略 `PendingReplayAckPolicy`）：
  - `expected == current` → 清 pending slot + metadata，返回 `true`（`ack success ref=<short>`）；
  - `expected != current`（处理期间已被更新的 replay 取代）→ **绝不清掉当前 pending**，返回 `false`
    （`ack mismatch expected=<short> current=<short>`）；
  - `expected` 缺失/空白 → 拒绝且不清理（`ack rejected reason=missing-identity`）。
  严禁「无参数清掉当前 pending」的路径存在。
- `onPendingFile` 返回 `true` 的唯一条件：本机分析已完成（`analyze()` 返回 `{ completed: true }`，
  无论有没有有效场次）。回放引擎装载失败（`ENGINE_UNAVAILABLE`，可重试）不 ACK，保留 pending。
- **可重放安全**：本机分析没有任何服务端副作用，「分析完成 → ACK 前 process death → 冷启动重新导入同一份
  pending」只会把同一份文件再分析一次、得到相同结果，不需要服务端幂等键。
- **单飞 + deferred drain**：Web 同时最多跑一个 import；import 进行中到达的 Native 通知
  （`window.wotbtoolsOnReplay()`）绝不被丢弃——只 coalesce 成一次 rerun，当前 import 结束后立即再
  drain 一次 Native pending。因此「A 处理中 Android 又收到 replay B，Native 只通知一次」时，B 会在 A
  完成后自动被处理：不需要用户再打开一次文件，也不需要外部第二次触发。
- 引擎不可用、读取失败或抛错：**不 ACK**，Native pending 原样保留供重试；Web 侧以 `inflight`
  防并发、以 `pendingId` 集合防同一份 pending 重复注入。同一 pending 的重复回调只允许一次
  in-flight 分析。
- 工作台挂载前 pending 既不消费也不丢失：挂载后由 Replay Workspace 触发消费；分析在本机进行，
  不依赖登录状态。

## 生命周期

- **Cold Start**：`onCreate` → 恢复持久 pending → 按引用清理 orphan → intent 分类（非 replay intent
  早退）→ 启动门禁（网络/版本）→ Web ready → Web 应用经 Native Bridge 消费 pending（无需登录）。
- **Warm Start**：`onNewIntent` → replay 入队 → 按 `ReplayDispatchPolicy` 分发
  （已在 replay view 就地通知，否则切到 canonical replay view）。
- **Background Resume / process death**：pending 在 private storage 存活 → 重新进入 App 后恢复并消费
  exactly once；原生登录在外部浏览器里，与 pending 的存活互不影响。

## 日志白名单

允许（低敏感、低噪音）：`replay-pending stored ref=<short>`、
`replay-pending restored ref=<short>`、
`replay-pending dispatched`、`replay-pending ack success ref=<short>`、
`replay-pending ack mismatch expected=<short> current=<short|none>`、
`replay-pending ack rejected reason=missing-identity`。

`<short>` 一律是完整 `pendingId` 的前 8 位（`pendingLogRef` / `PendingReplay.logRef`）。

绝不记录：完整 pendingId、原文件完整路径、文件名、replay 内容、OAuth code、OIDC state/nonce、
token、refresh token、完整 callback URI。

## 待真机验证（规格 §35 / §84）

`.wotbreplay` 无可靠标准 MIME。实现用保守默认，最终按真实 WoT Blitz Android 导出记录
`action / mime / scheme / URI / displayName / size / flags` 调优 Intent Filter；
禁止未经验证用 `*/*`，避免出现在无关分享菜单。模拟器不能代表真机 Intent 行为。

外部 replay 与认证的 acceptance 必须在真机覆盖：清数据后未登录打开 replay、已有 SSO 打开 replay、
原生登录进行中再打开一个 replay（正常 pending + 正常分发）、登录取消 / 登录失败后 replay 仍可用、
登录期间 kill 进程后 replay 仍能从 private storage 恢复。
