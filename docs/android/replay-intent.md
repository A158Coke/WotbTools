# Android Replay Intent

## 支持通道（V1 单个）

- **App 内选择**：现有 Vue `<input type="file" accept=".wotbreplay">`（`FileUploader.vue`）。
- **Share to WotBTools**：`ACTION_SEND`，`content://` URI。
- **Open With WotBTools**：`ACTION_VIEW`，文件管理器 → `content://` URI。

`ReplayIntentHandler` 只提取 `name/uri/size`，**不解析 replay**；业务校验（`.wotbreplay`、
20 MiB / 100 文件 / 200 MiB）沿用现有 `frontend/src/utils/replayUpload.js` 与后端 validator
（Kotlin 不复制，规格 §40）。

## 单一交接通道（唯一 ingress，不依赖 Base64，规格 §38/§39）

```text
ACTION_SEND / ACTION_VIEW
  → external content URI（ContentResolver 读取，不依赖真实路径）
  → 最小验证(.wotbreplay) + 复制到 app private cache
  → app-owned FileProvider URI + pendingId（完整 UUID，authoritative identity）+ createdAt
  → pending slot（single slot：最新 replay 取代旧 pending）+ SharedPreferences metadata
  → Web 已登录时经 NativeBridge getPendingReplay() 取回 pendingId/name/size/uri
  → Web fetch(content://) 读字节构造 File → 现有 FileUploader/validate 管线
  → POST /api/replay/processing-jobs（需登录；Bearer；operationId = pendingId，可重放安全）
  → server 接受（202 + jobId）后 Web 调 consumePendingReplay(pendingId) ACK（compare-and-clear）
```

Android 外部 replay **只有这一条** ingress。曾经的第二条路径——WebView `onShowFileChooser`
拦截 `<input type=file>` 并把 pending URI 直接回传给页面——已删除；普通 Web file chooser 仍走
Android 系统 picker，与 pending replay 无关。Kotlin 侧不做任何 replay 解析、不建立第二套
uploader。

非 `.wotbreplay` candidate 安全忽略（返回 null，不交给 Web upload pipeline）。`allowContentAccess=false`
与 app-owned FileProvider URI 兼容：字节经 `WebViewClient.shouldInterceptRequest` 以文件流返回给
Web，不依赖 WebView 直接读取 external content URI，也不放宽 WebView 安全边界。

## 导航所有权（auth flow 恒优先）

- **verified auth return 优先级最高**：`onNewIntent` 先走 `handleAuthReturnHot`（冷启动走
  `handleAuthReturnColdStart`），命中即结束，绝不进入 replay ingress / 分发；auth return 会把
  `inAuthFlow` 置 true，因此也不可能触发 replay 导航。
- 其余 intent 先进 replay ingress 入队；**是否分发、如何分发**由纯策略
  `ReplayDispatchPolicy.decide(hasPendingReplay, inAuthFlow, webViewVisible, currentUrl)` 唯一决定：

| 条件 | 动作 |
|---|---|
| 无 pending / `inAuthFlow=true` / WebView 容器不可见 | `NONE`——只入队，不 `loadUrl`，不 `evaluateJavascript` |
| 已在 replay workspace（URL 含 `view=replay`） | `NOTIFY_WEB` → `window.wotbtoolsOnReplay()` |
| 其它 | `NAVIGATE_REPLAY` → `loadUrl(https://wotbtools.com?view=replay)` |

- auth flow 期间收到新 replay 只记录 `replay-pending deferred reason=auth-flow`，**绝不打断当前
  authentication transaction**（不抢 WebView navigation）。auth 结束后刻意不新增「重新导航 replay」
  的第二套来源：登录完成后 Web 应用会重新加载并经 Native Bridge 自行消费 pending。
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
  `fetch(content://)` 的响应流），留到下一次启动 orphan cleanup 安全清理。

## ACK 语义（identity-aware exactly-once）

Web 侧 `useNativeReplayImport` 的顺序固定为：

```text
getPendingReplay → fetch(content://) → await onPendingFile(file, pending) → 受理成功
  → consumePendingReplay(pending.pendingId)
```

- **ACK 必须携带 exact pending identity**（`pendingId`，完整 UUID；不是 `content://` URI 字符串）。
  Native 执行 **compare-and-clear**（纯策略 `PendingReplayAckPolicy`）：
  - `expected == current` → 清 pending slot + metadata，返回 `true`（`ack success ref=<short>`）；
  - `expected != current`（处理期间已被更新的 replay 取代）→ **绝不清掉当前 pending**，返回 `false`
    （`ack mismatch expected=<short> current=<short>`）；已受理的那个 job 仍然有效；
  - `expected` 缺失/空白 → 拒绝且不清理（`ack rejected reason=missing-identity`）。
  严禁「无参数清掉当前 pending」的路径存在。
- `onPendingFile` 返回 `true` 的唯一条件：`POST /api/replay/processing-jobs` 已返回 `jobId`
  （server accepted）——ACK 边界**不是** job READY：字节一旦进入后端 Processing Job lifecycle，
  Native 不再负责重试。
- **可重放安全**：Web 把 `pendingId` 作为 create 的 multipart 字段 `operationId` 传给后端；同一已认证
  subject + 同一 `operationId` 幂等返回同一个 job。因此「server 已接受 → ACK 前 process death →
  冷启动重新导入同一份 pending」不会创建第二个 Processing Job。
- 未登录、未受理、读取失败或抛错：**不 ACK**，Native pending 原样保留供重试；Web 侧以 `inflight`
  防并发、以 `pendingId` 集合防同一份 pending 重复注入。同一 pending 的重复回调只允许一次
  in-flight processing create。
- 未登录期间 pending 既不消费也不丢失：登录成功后页面重新加载，由 Replay Workspace 再次触发消费，
  因此登录前不会发出任何 `POST /api/replay/processing-jobs`。

## 生命周期

- **Cold Start**：`onCreate` → 恢复持久 pending → 按引用清理 orphan → intent 分类（auth return 优先）
  → 启动门禁（网络/版本）→ Web ready → 已登录则消费，未登录则先走登录流程。
- **Warm Start**：`onNewIntent` → auth return 优先 → replay 入队 → 按 `ReplayDispatchPolicy` 分发
  （已在 replay view 就地通知，否则切到 canonical replay view）。
- **Background Resume / auth 期间 process death**：pending 在 private storage 存活 → QQ 完成后
  App Link cold start → 登录完成 → 消费 pending exactly once。

## 日志白名单

允许（低敏感、低噪音）：`replay-pending stored ref=<short>`、
`replay-pending restored ref=<short>`、`replay-pending deferred reason=auth-flow`、
`replay-pending dispatched`、`replay-pending ack success ref=<short>`、
`replay-pending ack mismatch expected=<short> current=<short|none>`、
`replay-pending ack rejected reason=missing-identity`、
`auth-return action=ALLOW_AUTH_RETURN source=app-link cold=true|false`，以及既有的
`nav scheme/host/action/source` 认证导航 trace。

`<short>` 一律是完整 `pendingId` 的前 8 位（`pendingLogRef` / `PendingReplay.logRef`）；后端幂等日志同理只打
`operationId` 前 8 位。

绝不记录：完整 pendingId / operationId、原文件完整路径、文件名、replay 内容、QQ code、OIDC state、token、
完整 callback URI。

## 待真机验证（规格 §35 / §84）

`.wotbreplay` 无可靠标准 MIME。实现用保守默认，最终按真实 WoT Blitz Android 导出记录
`action / mime / scheme / URI / displayName / size / flags` 调优 Intent Filter；
禁止未经验证用 `*/*`，避免出现在无关分享菜单。模拟器不能代表真机 Intent 行为。

外部 replay + auth 的 acceptance 必须在真机覆盖：清数据后未登录打开 replay、已有 SSO 打开 replay、
登录中取消/返回、登录失败、QQ 登录期间 kill 进程后 App Link 冷启动、auth 进行中再打开一个 replay
（只 pending、不抢导航）。
