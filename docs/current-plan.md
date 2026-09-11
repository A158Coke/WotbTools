# Android 1.4.2 登录初始化卡死修复 Plan

本文件记录本 worktree 对用户在本任务中粘贴的完整 Plan 的执行状态；该 Plan 覆盖本文件之外的详细验收与非目标边界。

## Root-cause map

```text
App page
  -> useAuth()
  -> shared Keycloak adapter generation
  -> auth init transaction / watchdog
  -> ReplayWorkspace auth gate

Login click
  -> login()
  -> settled adapter login, or fresh recovery generation
  -> kc.login(...)
```

修复前，`useAuth` 模块级单例共享一个 `keycloak` 实例与一个 `initPromise`；ReplayWorkspace gate 和 `login()` 都等待该 Promise。确认的架构缺陷是 init 永久 pending 会同时锁死检查页面和登录入口。设备/WebView 的具体触发原因仍未确认。

调查记录：frontend lockfile 的 `keycloak-js` 为 `26.2.0`，生产 Keycloak 镜像 Dockerfile 为
`26.6.4`；realm 中 `wotbtools-web` 的 redirect URI / web origin 未扩大。官方 adapter 行为允许
`check-sso` 配合 silent redirect，但该 silent 路径依赖隐藏 iframe，因此本修复只在新的 login
recovery generation 中跳过 silent bootstrap，未把设备问题未经证据归因于 Keycloak、cookie 或 WebView。

## 执行状态

| Phase | 状态 | 证明 |
|---|---|---|
| 0 真实代码与配置审计 | 完成 | frontend auth callers、ReplayWorkspace、Android WebView/policies/manifest、Keycloak client JSON 与版本已核对 |
| 1 RED fixture / reproduction | 完成 | browser fixture 支持 authenticated/unauthenticated/reject/pending；真实 Chrome 场景覆盖 pending/reject |
| 2 explicit auth init state | 完成 | `idle/initializing/authenticated/unauthenticated/failed`，failure reason 可观测 |
| 3 app watchdog | 完成 | 12 秒 UX watchdog；旧 raw Promise 不被当作新状态来源 |
| 4 generation recovery | 完成 | retry/login-recovery 创建新 Keycloak adapter；late completion 被隔离 |
| 5 Android silent strategy | 完成 | 普通 Web/Android 初始化保持 silent check-sso；仅 failed/initializing recovery transaction 不使用 silent iframe |
| 6 ReplayWorkspace gate | 完成 | failed recovery UI + retry/direct login；failure 不进入匿名 replay |
| 7 login semantics | 完成 | `loginInFlight` 仅表示当前 redirect；失败/取消后可重试 |
| 8 observability | 完成 | init start/pending/timeout/abandoned/retry/completed/failed 与低敏 login diagnostics |
| 9 Android validation | 部分完成 | policy/manifest/config 静态核对；本环境无 Android Gradle wrapper/gradle 命令，Owner/异常真机复测待外部设备 |
| 10 automated tests | 部分完成 | AppShell/auth bootstrap targeted tests、full Vitest（117 files / 1688 passed / 37 skipped）、typecheck、build 与真实 Chrome interaction（14 scenarios）已通过；PR head `01b87f4c` 的 GitHub CI 已确认包含 Android assembleDebug、Android JVM tests、Frontend tests/build/browser interaction 全部成功 |
| AppShell generation-aware bootstrap | 完成 | AppShell 改为监听权威 `authInitState`/`authenticated`；每个 generation 真正 authenticated 时调用唯一 canonical `ensure()`，由现有 ready/inFlight 语义去重 |
| review/docs/PR | 完成（PR #294，repair CI green） | AppShell/auth bootstrap 回归覆盖 generation 1 failed/timeout settled → generation 2 authenticated、unauthenticated/failed/initializing 不 provisioning、steady authenticated 不重复 provisioning；当前 head `b629a974` 的 GitHub CI 11/11 成功 |

## 状态与安全不变量

- init timeout/reject 绝不等同于 authenticated，也不开放匿名 replay processing。
- Replay Workspace、Processing Job、Export Job 认证边界保持不变。
- Android `allowFileAccess=false`、`allowContentAccess=false`、`MIXED_CONTENT_NEVER_ALLOW` 与精确 auth host/native scheme allowlist 不变。
- 不增加运行时存储、文件、相机、联系人等权限；不清 WebView 数据、不无限 reload。

## 验证限制

- Owner device: pending confirmation（当前执行环境无该真机连接）。
- Reported affected device: vivo Y30 — pending confirmation。
- PR validation: prior head `01b87f4c` GitHub CI green；当前修复 head `b629a974` GitHub CI 11/11 green（含 Android debug build、Frontend test/build/browser interaction、Backend、Keycloak、contract 与 deploy smoke）。
- Android JVM/assembleDebug 只能证明 native policy/构建，不替代真实设备矩阵。
- Android build limitation: `android/` 当前没有 `gradlew`/`gradlew.bat`，执行环境也没有 `gradle` 命令，因此本次不能把 JVM/assembleDebug 说成通过。
