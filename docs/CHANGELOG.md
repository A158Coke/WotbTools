# 技术版本历史

技术架构、基础设施、CI/CD、重构、代码质量变更。产品功能见 `CHANGELOG-PRODUCT.md`。

## [Unreleased]

### Architecture
- **Replay backend modularization**：在保持单一 `wotb-web` Spring Boot/JVM/container
  的前提下，将 Result、Playback、AI、Processing Job lifecycle/artifact state 与当前本地
  processing executor 拆为 Maven feature modules。Coordinator 只通过
  `ReplayProcessingDispatcher` 请求执行；`wotb-replay-processing` 保留既有
  `ReplayParseScheduler` 的默认并发 2、公平排队与取消语义。未引入 MQ、独立 worker、对象存储
  或跨进程回调，HTTP 路由、认证、错误 envelope 和指标契约不变。

### Replay / Auth
- **登录发起失败不再被静默吞掉**：`ReplayWorkspace.requestLogin` 由 `Promise.resolve().then(login).catch(() => {})` 改为把失败交回项目统一错误 UI（`useError` → AppShell 的 `GlobalErrorDialog`）。用户主动发起（点 capability tab / 点登录按钮）失败时可见并有明确文案（三语）；挂载时的自动登录失败不弹窗（auth gate 本身已是确定且可重试的可见表面）。仍只释放 in-flight、不写任何 component-lifetime 状态，因此失败/取消后随时可再次点击重试；`useAuth.login()` 的同一个进行中 redirect 去重语义不变。PR286/290 的 Android external replay auth/pending 状态机未改动。
- **Replay Workspace retryable auth gate**：删除 `ReplayWorkspace` 的 component-lifetime `loginAttempted` 一次性锁，Workspace 改为三态 UI gate（auth 检查中 / Login Required + 可重试登录 / 工作台）：未登录不再渲染 Source panel、上传器与任何 capability 面板，`useAuth.login()` 只对「同一个进行中的 redirect」去重（`loginInFlight` 短生命周期 ref，`finally` 释放），登录失败或取消后可从 capability tabs、登录按钮或 UserMenu 重新发起，不再出现点击 tab 静默 no-op。
- **Processing Job 授权收紧（前后端同一 PR）**：`/api/replay/processing-jobs/**`（POST 创建 / GET 状态 / GET result / DELETE 取消）由 `permitAll()` 改为要求 `wotbtools-user` 或 `wotbtools-admin`（匿名 401 `AUTH_UNAUTHENTICATED`、已登录无角色 403 `AUTH_FORBIDDEN`）；前端 `src/api/replay.ts` 四条端点统一 `ensureToken(30)` + `Authorization: Bearer`（XHR 上传进度保留，不覆盖 multipart `Content-Type`/boundary），401/403 继续走统一 error contract。`/api/preview` 与 `/api/export`（legacy）的公开契约不变；`/api/replay/export-jobs/**` 随后与 Processing 同级收紧（见下）。
- **Android 外部 replay auth 状态机修复**：pending replay 增加 `pendingId`/`createdAt` 与 app private storage metadata（24h TTL），启动时先恢复 active pending、再只清理不再被它引用的 orphan cache，QQ 登录期间 process death 后 replay 不再丢失；日志补齐 `replay-pending stored/restored/deferred/dispatched/acknowledged`（不记录路径、内容、code、state、token）。新增纯策略 `ReplayDispatchPolicy`（JVM 单测）：auth flow 期间 replay intent 只入队，绝不 `loadUrl`/`evaluateJavascript` 抢占认证导航；删除 `onShowFileChooser` 的 pending replay 注入分支，external replay 只剩 Native Bridge 单一 ingress。
- **Android pending replay exactly-once ACK**：`useNativeReplayImport` 改为 `await onPendingFile(file, pending)`，只有 `startProcessingJob()` 返回 `{accepted:true, jobId}`（server 已接受 processing request，不等待 READY）才调用 Native `consumePendingReplay(pendingId)`；未登录、未受理或抛错一律不 ACK，pending 保留可重试，登录前不发出任何 processing 请求。
- **Pending replay identity-aware ACK（compare-and-clear）**：pending 的 authoritative identity 改为完整 UUID（`pendingId`，日志只保留前 8 位短引用；metadata 持久化完整 identity）。`consumePendingReplay(expectedPendingId)` 由「清掉当前 pending」改为 compare-and-clear：identity 缺失 → 拒绝且不清理；与当前 pending 不一致（处理期间已出现更新的 replay）→ 返回 stale 且**绝不清掉新 pending**；只有完全一致才清 slot + metadata。identity 判定抽成纯策略 `PendingReplayAckPolicy`（JVM 单测），杜绝「ACK 旧 replay 误删新 replay」。前端以 `pendingId`（不是 URI）做 exactly-once 去重，并改为**单飞 + deferred drain**：import 进行中到达的 Native 通知不再被丢弃，只 coalesce 成一次 rerun，当前 import 结束后自动再消费一次 Native pending——因此「A 处理中 Android 又收到 replay B（Native 只通知一次）」时 B 会在 A 完成后自动解析，无需用户再打开一次文件。
- **Replay Processing create 幂等（可重放安全）**：`POST /api/replay/processing-jobs` 新增可选表单字段 `operationId`；同一已认证 subject + 同一 `operationId` 重复提交返回**同一个 jobId**（不重复上传 / 不重复登记 / 不重复提交调度器），覆盖「server 已接受但 Native ACK 前进程被杀 → 冷启动重新导入同一份 pending replay」的 duplicate create。identity 按 subject 分域（绝不跨用户复用），索引为内存态、生命周期跟随 Job TTL（清理后同一 `operationId` 允许重建，此时旧 dataset 已不可读）；字段缺失（普通 Web 手工上传）保持「每次提交都是新 job」语义。并发同 identity 由 Store 的**单一权威状态机**协调（`ABSENT` / `IN_FLIGHT(future)` / `COMMITTED(jobId)`，全部转换在同一个 `ConcurrentHashMap#compute` 线性化边界内完成）：committed 判定与 creator 领取不是两次独立读取，因此不存在 TOCTOU 窗口；唯一 creator 创建并提交，duplicate 等待同一 future；只有 `dispatcher.submit` 成功之后才进入 `COMMITTED`，creator 失败（如 `PROCESSING_QUEUE_FULL`）时两个 caller 一起失败，绝不返回「随后被清理的 jobId」，也不产生两个 job；失败会回到 `ABSENT` 并清空 doomed job 与临时存储，后续同 identity 请求可重新创建有效 job。
- **Replay Export Job 授权收紧**：`/api/replay/export-jobs/**`（创建 / 状态 / 取消 / download）由 `permitAll()` 改为要求 `wotbtools-user` 或 `wotbtools-admin`——Export 是 Dataset-only，消费 Processing Job 的 `ProcessedDataset`，匿名可调用等于绕过 `GET /api/replay/processing-jobs/{jobId}/result` 的认证保护（auth bypass）。前端四条端点统一 `ensureToken(30)` + `Authorization: Bearer`，download 走 authenticated fetch（blob → object URL），不使用无法附带 header 的 `<a href>` 裸链。`/api/export`（legacy，已废弃 410）与 `/api/preview` 的公开契约不变。

### CI/CD
- **Build / Deploy immutable handoff**：Build 与 Deploy 保持独立；Build 从冻结 SHA 只构建受影响镜像并上传 `deployment-manifest`，Deploy 仅消费成功 Build 的精确 artifact、校验 SHA/镜像存在性后按 manifest 目标发布，不重新计算 diff、不在 Deploy 构建或测试。应用镜像只使用 immutable `sha-<short>` tag，配置-only 与 targeted deploy 保留未变更应用 tag，旧 release run 通过 run number guard 拒绝。
- **Android Version-as-Code + Native Bridge gate**：Android 版本从 committed `android/gradle.properties` 确定，Bridge 以 `contracts/android-native-bridge.json` 为唯一协议来源；Gradle、Native runtime、FE compatibility、`version.json` 与 release workflow 均消费或校验同一版本。PR CI 新增 runtime version bump、strict semver、breaking bridge diff、Native source/FE compatibility 与 production older/equal/newer gate；release workflow 移除手工版本输入并固定 source SHA。
- **Build / Deploy workflow split**：将生产镜像构建拆到独立的 `build.yml`，Build 成功后由 `workflow_run` 自动接力 Deploy，同时保留手动入口；Build 的 `changes` job 只解析一次事件携带的 full SHA，backend/frontend/keycloak 使用同一个冻结 commit 构建 production SHA 镜像并生成权威 manifest，不依赖 `latest`，不能由 feature ref 或移动的 main 绕过 PR merge gate。Deploy 只消费并校验 manifest，不重新计算变更、不重新 build、不重复跑测试；targeted deploy 不提升 LKG，失败时只恢复目标 service 的 pre-deploy snapshot，完整 `all` 发布继续执行应用健康 gate、LKG promotion 与 fail-closed rollback。
 
### 用户资料 self-heal（KC User ↔ user_profile 生命周期）
- **幂等 ensure 取代懒创建**：`PUT /api/users/profile` 取代 `POST /api/users/profile`（后者删除，仓库内唯一消费方是 ProfilePage / BoostPage，nginx 对 `index.html` 为 `no-store` 且 `/assets/` 带内容 hash，不存在持有旧 bundle 的客户端）。PUT 是 **ensure 而非 create**：已存在 → 200 原样返回且不改写任何绑定；不存在 → 走 canonical provisioning（可信 WG claims → 对应区服 + `WARGAMING`，否则 `CN` + `MANUAL`）。`UserProfileService.create()` 与 `syncFromLogin()` 的创建分支统一收敛到同一个私有 `newProfile()`，不存在两套创建语义。身份只取自 JWT（`requireUserId` / `currentUsername` / `currentDisplayName` / 可信 claims），不接受 body 字段，无法冒充他人。
- **并发 ensure 与真实身份冲突的精确区分**：`ensureCurrentProfile` 刻意不加外层 `@Transactional`——并发败者在 `keycloak_user_id` 唯一约束上失败后 PostgreSQL 会把该事务标记为 aborted，只有让「插入」与「冲突后重读」各自持有独立短事务，败者才能读到胜者已提交的 profile 并幂等成功（1 个 KC sub 恰好 1 条 profile，两个调用方都成功）。冲突**按约束名**区分（抽出公共 `util/ConstraintViolations`，`BoosterService` 改为复用）：`user_profile_keycloak_user_id_key` → 重读既有 profile；`uk_user_profile_wotb_account` → 仍是 409 `WOTB_ACCOUNT_ALREADY_USED`，绝不把真实账号占用吞成幂等成功。冲突后重读不到自身 profile 属于服务端不变量破坏，抛 500 `PROFILE_BOOTSTRAP_FAILED`（新增 `IllegalStateException` 的 500 分支），与 409 业务冲突区分。随之删除已无生产者的 `PROFILE_ALREADY_EXISTS`（handler 分支 + 三语 `api_codes`）。
- **全局 authenticated bootstrap**：新增 `frontend/src/composables/useBusinessUserBootstrap.js` + `AppShell` 触发点——只要 Keycloak 认证成功并进入 SPA（home / replay / battle-playback / AI Review / HoF / admin / profile / boost 任意 view）就 ensure 当前用户资料，不再依赖访问 Profile / Boost 页面。状态机 `idle → pending → ready | failed`；失败**不回退认证状态、不删除 Keycloak 用户、不永久缓存失败**，同一个 rejected Promise 在 `finally` 中释放，刷新 / 重新挂载 / 通知条上的重试都会重新 ensure（不做自动重试循环），并在 AppShell 给出可重试的可见提示（三语）。ProfilePage / BoostPage 的 `GET 失败 → POST 创建` 局部 lazy-create 已删除，改为等待全局 bootstrap 结果再读取资料。
- **Boost 打手选择器改用 business-user segment**：`adminSearchUsers('', {segment:'local', size:100})` / `adminSearchUsers(query, {segment:'local', size:10})`，并排除 `keycloakUserMissing=true` 的孤儿绑定（那是管理员清理对象，不是有效打手候选）——与后端 `findEntityByKeycloakUserIdForUpdate(...).orElseThrow(USER_PROFILE_NOT_FOUND)` 的前提一致。`adminSearchUsers()` 的默认 `segment=keycloak` 与 AdminUsersPage 的 Keycloak inventory 语义（`hasLocalProfile=false` 仍可见）保持不变，孤儿过滤只属于 picker，不进通用 Admin Users API。
- **契约同步**：`contracts/http/openapi.yaml` 新增 `/api/users/profile`（`GET` + `PUT` ensure）与 `UserProfile` schema，`npm run api:generate` 重生成产物。

### 名人堂 ownership 与 Admin 批量删除
- **HoF ownership 解耦为 `(区服, WotB 账号)`**：新增 Flyway `V22__hof_ownership_by_wotb_account.sql`，把 `hundred_battle_submission` / `mark3_submission` 的 `game_account_id_snapshot` 重命名为 `wotb_account_id`、新增 `wotb_server varchar(16) NOT NULL` 快照列（CHECK `ck_hundred_wotb_server` / `ck_mark3_wotb_server`，取值 `CN|ASIA|EU|NA`）并删除 `user_keycloak_id`；partial unique index 由 `(user_keycloak_id, vehicle_id)` 改为 `(wotb_server, wotb_account_id, vehicle_id)`（百场 `uk_hundred_battle_pending_account_vehicle` / `uk_hundred_battle_current_account_vehicle` 两个独立 partial index，三环单组合索引 `uk_mark3_submission_active_account_vehicle`），查询索引改为 `idx_hundred_battle_submission_account` / `idx_mark3_submission_account`，两者均含区服列。canonical owner 与 `user_profile` 的 `UNIQUE (wotb_server, wotb_account_id)` 口径一致：`(CN, 123456)` 与 `(EU, 123456)` 是两个不同账号，只按账号 ID 归属会造成跨服 ownership / authorization 串号。历史行的区服列由「旧 `user_keycloak_id` 对应的 profile 当前仍绑定同一账号」回填（唯一有证据支持的来源）。单场 `hall_of_fame_record` **不变**（仍只按 `account_id` 归属、无区服维度——已声明的遗留限制，见 `docs/features/hall-of-fame.md`）。
- **V22 是 fail-fast preflight，不含任何自动消解**：迁移顺序为「加 `wotb_server`（先可空）→ 回填 → preflight → 收紧 NOT NULL + CHECK → 重建索引 → 删 `user_keycloak_id`」。preflight 对「无法解析区服的历史行」与「新 ownership 键下重复 active 记录」直接抛错并给出可操作诊断（样例 id / 冲突键 / 检查 SQL），**不选 winner、不改任何 `status`、不删任何 replay evidence、不清空任何截图、不为无法解析的历史行猜区服（尤其不默认 `CN`）**。Flyway 在 PostgreSQL 上把迁移包在单一事务里，preflight 失败时 V22 的全部 DDL/DML 回滚，数据库停留在 V21。preflight 失败后 schema 停留在 V21，因此诊断里给运维的检查命令一律只用 V21 列（`user_keycloak_id` / `game_account_id_snapshot`），候选区服通过 `LEFT JOIN user_profile` 反推；处置路径是管理员**有意**清理后重跑迁移——迁移失败时新版本起不来，本次新增的 bulk-delete 端点不可用，只有旧版本的单条 delete 可用且只接受 `CURRENT`，非 `CURRENT` 行需运维显式动作。判定口径两域不同——百场按 `(区服, 账号, 车辆, 状态)`（PENDING/CURRENT 是独立索引，可共存），三环按 `(区服, 账号, 车辆)` **跨状态**（组合索引，CURRENT 与 PENDING 并存即冲突）。
- **服务层 ownership 切换**：百场/三环 `cancelSubmission` / `userStatus` 统一由 `UserProfileService.currentWotbIdentity(keycloakUserId)` 解析当前登录用户绑定的 `(区服, 账号)`，再**同时比较区服与账号**判定归属（任一不符或未绑定 → 403 `HUNDRED_FORBIDDEN` / `MARK3_FORBIDDEN`；未绑定账号时 `userStatus` 返回三个空列表）。创建、PENDING 唯一性检查、CURRENT 门槛与 APPROVE 复核同样带上区服维度。记录创建后用户改绑到别的区服/账号时，记录仍属于原 `(区服, 账号)`，因此不可再取消。
- **Admin Users 服务端分页 + 合并数据源 + 批量删除**：`GET /api/admin/users` 响应由裸数组改为 `{items,page,size,totalItems,totalPages}`，旧的 `?limit=` 参数移除（取消 `limit=200` 假分页）；新增 `segment=keycloak|local` 与 `idpAlias`——`segment=keycloak`（默认）以 Keycloak realm users 为权威源，没有任何本地 profile 的 Keycloak-only 用户也能被找到并删除（旧 Juhe QQ cleanup 前提）；`segment=local` 以本地 `user_profile` 为权威源，暴露 Keycloak 侧已不存在的孤儿绑定（`keycloakUserMissing=true`），删除它可释放 `(wotb_server, wotb_account_id)` 唯一槽位，传 `idpAlias` → 400 `IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT`。列表行 DTO 改为 `AdminUserListItemDto`（旧 `AdminUserDto` 删除），删除用户合并为单一端点 `DELETE /api/admin/users?confirm=true`，**请求体是 Keycloak sub 的 JSON 数组**——删除单个用户就是长度为 1 的数组，因此不存在单独的「批量删除」端点，原有的单条 `DELETE /api/admin/users/{keycloakUserId}` 一并移除（`confirm` 缺失/false → 整个请求 400 `CONFIRMATION_REQUIRED`；每用户独立事务，允许 partial success）。
- **Admin HoF 批量删除**：新增 `POST /api/admin/hof/records/bulk-delete`（`{ids}`，单场没有 reason——它本来就是 hard delete 且无 reason 语义）、`POST /api/admin/hof/hundred/submissions/bulk-delete` 与 `POST /api/admin/hof/mark3/submissions/bulk-delete`（`{ids, reason, reasonText}`）。**bulk delete == 逐条重复权威单条删除语义**，没有第二套删除规则：单场仍是 hard delete，百场/三环仍是 soft delete（仅 CURRENT 可删，非 CURRENT 逐条失败于 `HUNDRED_NOT_CURRENT` / `MARK3_NOT_CURRENT` 而不阻塞其他记录）；每条目标独立事务，去重后上限 100 → 400 `BULK_LIMIT_EXCEEDED`。
- **新增错误码与契约同步**：`util/ErrorCode.java` 新增 `BULK_LIMIT_EXCEEDED`、`INVALID_USER_SEGMENT`、`IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT`。`contracts/http/openapi.yaml` 本轮新增 `GET /api/admin/users`（分页）、`DELETE /api/admin/users`（body 为字符串数组）、`POST /api/admin/hof/records/bulk-delete`、`POST /api/admin/hof/mark3/submissions/bulk-delete` 四个端点，以及 `AdminUserListItem` / `AdminUserPage` / `DeleteUserResult` / `DeleteUsersResponse` / `BulkDeleteModerationRequest` / `BulkDeleteRecordsRequest` 六个 schema；百场 admin 的 `gameAccountIdSnapshot` 改名为 `wotbAccountId` 并新增 `wotbServer`（`HundredAdminListItem` / `HundredAdminDetail`）。Java 侧 `HundredAdminListItemDto` / `HundredAdminDetailDto` / `Mark3AdminListItemDto` / `Mark3AdminDetailDto` 都新增 `wotbServer`，前端 `HoFAdminPage.vue` 在百场/三环的列表与详情共 4 处渲染为 `{{ wotbServer }}·{{ wotbAccountId }}`。**既有缺口（如实记录，本轮未补全）**：mark3 的 admin GET 家族从未进入 `openapi.yaml`，单场 HoF admin 列表/详情的完整字段同样未覆盖——即便两个 mark3 DTO 已新增 `wotbServer`，契约里也没有对应 schema。
- **IAM ≠ HoF 不变量**：HoF 数据属于 WotB 游戏账号而非 Keycloak 用户：V22 后百场/三环的 canonical owner 是 `(wotb_server, wotb_account_id)`，单场 `hall_of_fame_record` 只按 `account_id` 归属（无区服维度，遗留）；仓库中没有任何 FK 指向 `user_profile`（全仓唯一的 `on delete cascade` 在 `V3__create_boosting_tables.sql`，boost 域内部），删除 Keycloak 用户不连带删除 HoF 行。因此删除用户必须走 WotBTools admin API（先删本地 profile 再删 Keycloak 用户），绕过它直连 Keycloak 会留下孤儿 profile 并阻塞重绑，需用 Admin Users 的 `segment=local` 清理。

### Replay processing
- 新增默认跳过、显式 `-Dperformance=true` 才运行的 replay core 性能基准：递归发现 `common/data`，仅在未设置 `corpusPath` 且无数据时回退到三份 committed fixtures；显式 corpus 路径无效时 fail-closed；按 archive/parser/reconstruction/full 分阶段测量，支持并发矩阵、确定性 SHA-256 facts fingerprint、JSON/CSV/Markdown 报告与 JFR。
- 基于本地 extended JFR 的证据，将 reconstruction 中每个 packet type 的统计更新从重复 HashMap lookup 合并为单次 `computeIfAbsent`；保留现有 production facade、reconstruction facts 与 parity contract。
- PR #284 收口候选：`ObservedMaxHp.populate` 复用单次 `ReplayHpTimeline.build` 结果完成 max-HP 与 timeline 两条 reduction；backend 迁移至 Java 25 / Spring Boot 4.1.1，Spring web 启用可覆盖的 Virtual Threads，AI blocking worker 使用有界 virtual-thread workers；replay CPU scheduler、export worker、watchdog 与业务 admission/queue 约束保持不变。新增显式 real-provider Platform-vs-Virtual benchmark（默认关闭，固定短 prompt，不进 CI）。

### OpenTofu
- 新增独立 Grafana OpenTofu root，纳管现有 9 个 dashboard 并保留 dashboard JSON 为 canonical source；Prometheus/Loki datasource 因 Grafana read-only 限制继续由 file provisioning 管理。PR 使用 `GRAFANA_PAT` 做 plan，合并到 main 后自动 apply 精确 saved plan；任意 dashboard delete/replacement fail-closed，apply 后只读校验全部 dashboard UID。
- 扩展 production root 纳管已发现的 Tencent Lighthouse 上海生产节点及其现有四条 firewall 规则；owner 手工 import 后 authenticated plan 为 `No changes`，不纳管未完成读取证据的 VPC、subnet、security-group 或 disk，并新增 Lighthouse delete/replacement safety gate。
- 新增最小 COS-only OpenTofu production baseline：声明现有生产 COS bucket、手工 import 流程、状态安全规则与不注入生产凭据的 GitHub Actions validation workflow；不包含自动 plan、import 或 apply。
- 将 production root 切换到 Tencent COS S3-compatible remote state；新增 trusted same-repo authenticated plan、fork PR 无凭据路径、workflow concurrency 与 artifact bucket delete/replace safety gate；state bucket 保持 owner-managed bootstrap boundary，不自动 import/apply。
- 完成现有 production artifact bucket 的 owner-managed remote-state bootstrap；import 后 authenticated plan 为 `No changes`，并移除仅用于排查凭据的临时 workflow diagnostics。

### Battle Playback
- **手机/平板流内控制条 pointer-events 继承回归**：`PlaybackMobileOverlay.vue` scoped 的 legacy `@media (width<768px)` 仍把 `.pb-mobile-overlay-content` 设为 `pointer-events: none`（那是为旧的「浮层未唤起」形态写的）。三形态重构把非全屏 mobile/tablet 的控制条改成地图下方的流内常驻卡片时只改了 wrapper，没有改 content；`pointer-events` 是继承属性，于是子控件全部不可命中——真浏览器实测点 play 的命中对象是父级 `.pb-mobile-overlay`，时钟停在 `00:00 / 01:00`，而 desktop 1440×900 与平板 ≥768 正常。修复落在形态表（`playback-mobile.css` / `playback-tablet.css`）的流内 content 规则上显式恢复 `pointer-events: auto`，三档形态文件仍是各自布局的唯一权威（未删除组件 scoped 块，因为 `<768px` 的 tablet 卡片外观仍依赖它）。
- **`duration<=0` 的播放控件不可用态**：`BattlePlayback.play()` 对 `duration<=0` 有一句静默 `return`，而 `PlaybackControls` 没有任何 disabled 绑定，于是按钮看起来可用、点击什么都不发生。现在 `PlaybackControls` 以自身 `duration` 为唯一判据计算 `timelineUsable`：play / ±5s / 进度条显式 disabled + `aria-disabled` + 明确原因文案（三语），速度档位 / 重置视图 / 全屏 / 面板等不依赖时间线者保持可用。后端 dataset contract 未改动（未证明 producer 错误，前端不猜时间）。
- **进度条 UA margin 造成的页面级横向溢出**：`input[type=range]` 的 UA 默认 `margin: 2px` 与 `width: 100%` 相加，在 1024 视口上实测 `scrollWidth=1026`，越界元素正是这个 input。`PlaybackTimeline` 将其 margin 归零（上下间距已由 `.pb-progress` 承担）。
- **浏览器级交互回归夹具**：新增 `frontend/scripts/browser-workspace-interaction.mjs`（`npm run test:browser-interaction`）——真实 Chrome + CDP，用**原始输入事件**点击真实坐标，并用页面内事件记录证明「真实 click 的 target 就是目标按钮」（比静态 `elementFromPoint` 更强）。覆盖 375×812 / 390×844 竖屏粗指针、740×360 横屏粗指针、1024×768 平板、1600×900 桌面、未登录登录失败可重试 + 失败可观测、`duration<=0` 不可用态、竖屏→横屏旋转后的形态与命中。只替换 Keycloak 网络边界（auth / business-user bootstrap），router / AppShell / ReplayWorkspace / 全部 CSS 都是真实生产代码。⚠️ `Input.synthesizeTapGesture` 在本机 Chrome 上只派发 touch 事件、不合成兼容 click（连控制组按钮都拿不到 click），会让「点击是否真的产生行为」全部假阳性，因此夹具只用 `Input.dispatchTouchEvent` / `dispatchMouseEvent`。
- **Chrome 发现逻辑去重**：抽到 `frontend/scripts/browser-chrome.mjs`，`browser-playback-layout.mjs` 与新的交互夹具共用；绝对路径只做存在性检查（Windows 上 Chrome 已运行时 `<exe> --version` 会被转发给既有会话），顺带修好 `test:browser-layout` 在 Windows 上找不到 Chrome 的问题。
- **Battle Playback Type 5 H Zetsu dedicated asset repair**：根据 8033 与 9057 的真实 BlitzKit bake 证据拆分 `type-5-heavy` 与 `type-5-h-zetsu`；两者模块、纹理和 turret raster 均不同，9057 不再复用旧 Type 5 Heavy 资产。
- **Battle Playback Tier X 2D vehicle model fallback repair**：补齐 Zmije（tankId 23425）的 BlitzKit source-faithful turreted 模型、映射、战术 profile 与 inventory；runtime 为结构、图片和模块失败提供确定性 fallback reason，图片失败只做一次有界重试并保留成功/失败缓存与并发去重；Tier X coverage 现在贯通 mapping、metadata、source asset 与 production dist，避免缺目录静默漏检。
- **Battle Playback HD basemap runtime sharpness**：2D fallback 使用与 overlay SVG、markers 共用 logical render frame 的 `.pb-basemap` `<img>`；2.5D 主路径的 WebGL canvas 现在按实际 layout-scaled CSS frame 配置 drawing buffer，并受 HD source 与 GPU renderbuffer 上限约束；同时修复碰撞 presentation offset 的 screen-pixel 单位回归。真实 Playback 的同地图/同位置/同缩放 A/B 对照显示 WebGL 与直接 HD raster 基本等价，剩余柔化归类为当前 4048×4048 source-detail ceiling；保留现有 mipmap 过滤策略，不修改 29 张原图或 HD 资源。
- **Battle Playback strict tank marker collision**：密集车辆的可见 model box 现在会自适应扩张布局直到完全不重叠；被移开的 marker 通过 leader line 回指 canonical 位置，且不改变 hit/selection、伤害反馈或轨迹坐标。
- **Battle Playback HD 地图验证收口**：29 张 HD 底图增加 coverage/hash/真实尺寸/严格 2× frame/map import/5 MiB 单图预算的 deterministic gate；terrain attitude 补齐 yaw=90°、反向与 45° 局部轴测试。视觉几何仍要求人工 29/29 source↔HD QA，manifest 的 `geometryTransform=NONE` 仅描述生成流程，不作为视觉真实性证明。

### Production observability
- **Production deploy bootstrap cleanup**：移除事故恢复遗留的无 LKG 部署 bypass、workflow_dispatch 选项与 legacy previous 回滚；已有健康 live deployment 仍可在正常发布流程中建立初始 LKG，没有可验证 LKG 时统一 fail-closed。
- **Production application gate simplified**：发布与回滚现在只由 backend、frontend/nginx（`Host: wotbtools.com`）和 Keycloak OIDC discovery 决定；Prometheus/Loki/Alloy/Grafana 故障只输出 `OBSERVABILITY DEGRADED`，不再触发 application rollback。移除 `KEYCLOAK_MANAGEMENT` capability、Keycloak `:9000` health/metrics contract 与 Prometheus Keycloak scrape，Keycloak dashboard 收缩为登录、QQ callback、broker/IdP 与 WARN/ERROR 日志；新增 Grafana/Prometheus/Loki/Alloy 非阻断和应用 gate/rollback smoke cases。
- **Production observability refresh isolation**：Grafana force-recreate 后仅在 Grafana 从 frontend 网络可解析且健康时刷新 frontend nginx；Grafana 重建失败跳过 refresh 并保留应用成功/健康 rollback。monitor proxy 使用 `Host: monitor.wotbtools.com`，Android canary 使用 `Host: wotbtools.com`。
- **Keycloak production runtime hardening**：Keycloak 构建阶段固定 PostgreSQL、health、metrics，生产/本地 runtime env 开启 HTTP metrics histograms，编排统一使用 `start --optimized`；新增真实 Docker runtime smoke，验证 discovery、management readiness/metrics、无宿主机管理端口暴露及无启动时 augmentation。
- **Production deploy LKG rollback contract**：成功部署后保存完整、经 health/observability gate 验证的 Last Known Good 部署树；失败只从 LKG 回滚，损坏或缺失 LKG 时 fail-closed 并保留当前 live tree，`deploy.prev` 仅作取证；补充 A/B、损坏 bundle、健康 live 初始 LKG seeding 与无 LKG fail-closed 回归 smoke。
- **Production deploy initial LKG seeding**：当已有 live deployment 但尚无 LKG 时，先完成应用健康检查并使用已校验的 staged observability 配置建立初始 LKG；没有可验证 live deployment 时保持 fail-closed，正常部署与回滚仍要求完整 health/observability gate。
- **Production deploy capability-aware rollback**：Keycloak management readiness 从 Docker 内部网络执行并接受实际 JSON whitespace；rollback verifier 固定由当前 deployment runner 持有，历史 LKG 通过 capability metadata 执行 core rollback gate，不再因缺少新版本 management capability 或 verifier 文件而二次失败。
- **Production deploy health-check contract**：前端容器内的部署探针显式发送 `Host: wotbtools.com`，避免误命中 Grafana virtual host；Prometheus 与 observability gate 统一使用 backend 专用 management `8088` 端口，并补充 rollback smoke regression。
- **Production observability deploy gate fail-closed**：部署显式 reload Prometheus/Alloy，Prometheus target 必须满足 `up == 1`，Loki 必须收到本次部署唯一 canary；失败回滚同时恢复上一版 observability 配置，避免 bind-mounted 配置残留。
- **AI Review 生产事故可追踪**：Team validator 冲突分类提升到 INFO 安全结构化日志；AI Review/Incident Explorer 看板增加 parse、validation、conflict、retry、upstream 与最终失败生命周期查询，SSE failure 复用 correlationId 作为 canonical error id，并由前端展示可复制的诊断 ID。Prometheus 仍只使用低基数统计，不记录 prompt、原始模型输出或用户级 token usage；部署后的真实数据验收保留为手工清单。
- **Team AI Review Quality Harness v1**：新增 `evidenceBasis` 结构化质量契约、推理顺序与反 settlement-shortcut deterministic checks；真实 `.wotbreplay` offline harness 复用生产解析/时间线/grounding 链并保持 0-token；新增显式 opt-in real-replay benchmark 与无 prompt/key 的 JSON/Markdown 报告。synthetic prompt PASS 与真实回放质量明确分层，默认 CI 不调用 provider。

### AI Review
- **Team AI Review contract resilience**：Team Call #2 最终只接受严格有效的 `TeamAiReviewResult` JSON；局部可安全规范化的问题会保留可用内容，真正不可用时基于 canonical battle context 最多执行一次 fresh JSON recovery，失败 completion 不会回传给模型或直接展示。两次均失败返回 `AI_REVIEW_SCHEMA_FAILED`，SSE/OpenAPI/前端与低基数日志、累计 token 指标保持一致。
- **Team AI Review technical schema resilience**：primary response 的局部 optional reference/field 缺陷现在由 backend 确定性 salvage；形成最低 contract 时不触发 recovery。真正不可用时仍严格执行至多一次 recovery，unknown field 不会进入最终 DTO，plain-text 结果仍不会放行。
- **Team AI Review bounded salvage and localized recovery**：episodes 超限会截断到上限但保持 primary 结果可用；summary/episodes 真正缺失或类型错误才触发一次 recovery，recovery 指令跟随允许语言生成。
- **Team AI Review v0.6**：升级 Team Call #2 的战术因果推理顺序，补强 Information/Remaining uncertainty/Decision impact、objective obligation、effective local participation、episode propagation、HP 下游验证与状态触发训练建议；保持 v0.5 JSON/API/前端契约不变，不新增模型调用或后端战术语义裁判，默认 CI 仍为 0 provider token。
- **Team AI Review v0.5**：Team Call #2 改为结构化 `teamReview` 结果，增加 episode/训练建议/重点复查/高贡献者契约与运行时校验；移除生产 Team Autopsy 追加、第三次模型调用及 settlement-only tactical validator，SSE `done` 与前端三语渲染同步升级。
- **Team AI Review v0.4**：强化 Information → remaining uncertainty → decision impact 因果链，明确距离只是证据而非战术价值，并禁止无证据的通用距离/固定时刻/车种职责规则。重点复查、高贡献者与关键威胁必须绑定正文 tactical episode，不能从结算榜单重新选人；传播检查允许保持未知。未修改 parser、reconstruction、backend tactical evidence、输出长度或 token cap。
- **Team AI Review v0.3**：将 Team Review 从过度压缩的 concise review 调整为 selective but complete tactical review；保留现有 A–H reasoning/evidence 边界，要求关键 episode 解释信息状态、参与车辆、重要性与下一阶段影响，并优先保留 Information、Objectives、局部交战和 cross-local propagation。`primaryDiagnosis` 仍只是摘要，重点复查/高贡献者改为有 structural evidence 时才输出的可选 section；Team Call #2 默认专用输出上限提升至 8192 tokens。未新增 backend tactical verdict、parser、SSE/API 或 frontend scope。

### League Rating V6 批次汇总
- 批次选手与战队 Rating 统一改为基于有效单场 `finalRating` 的 pooled raw sum/count，并分别使用 5 与 1 的对称 prior，anchor 为 475。
- 选手与战队汇总改用 `rating`、`observedMean`、`dimensionMeans` 和 `ratedBattles`；median 不再驱动主 Rating、维度、排名或 MVP。
- 同步 Java domain/API/Mapper、CW 汇总表与 Drawer、三语文案、Excel 导出、测试和 V6 canonical 算法文档；V5 文档标记为历史版本。
- 修复 frontend Alpine Docker 构建：放行/复制 V6 算法文档，Docker build identity 不再调用不存在的 git，并确保 `dist/version.json` 始终可写；V6 summary Rating 通过 DTO/API 保留完整精度，前端仅在展示层保留 1 位小数。

### Fixed
- **Android pending replay transport（2.12.78）**：固定同源 HTTPS synthetic resource 替换 Web `content://` fetch，保留 WebView file/content access 禁用。Native 流式读取且失败不 fallback 网络；header identity 校验防 pending 替换串包、no-store 防缓存复用。读取失败复用 Replay 错误区与重试，补充低敏阶段日志；server accepted 后 ACK、operationId 幂等及 auth gate 不变。需更新 APK 与 Web。
- **Battle Playback 全屏 HUD / 安全区布局修复**：PC、平板和手机全屏下双方 HP / 点数 / 基地状态固定归属地图顶部 HUD，不再被通用 `pb-side-slots` 优化搬到侧栏；camera fit 按真实 HUD 与可见移动端底部控制条动态保留 safe inset，side-slot 仅作用于非移动端 controls，并按实际 map workspace 宽度判定，避免把 Details 列误算为 gutter；`test:browser-layout` 新增 fullscreen + side-slot 的真实 Chrome 几何回归。
- **Android QQ 登录返回原 WebView（Verified App Link，CODE READY / PRODUCTION VALIDATION REQUIRED）**：QQ App 完成授权后
  会把 `auth.wotbtools.com/.../broker/juhe-qq/endpoint` callback 打开到系统浏览器，导致 Browser B != 原 WebView A、
  AuthenticationSession continuity 被破坏 → `already_logged_in`。现用 **Verified App Link** 把这个 exact Juhe QQ
  broker callback 路由回原 WotBTools App（same MainActivity / same WebView / same cookie jar，inAuthFlow 保持 true），
  复用同一次 auth transaction。App Link 只接管 `https://auth.wotbtools.com/realms/wotbtools/broker/juhe-qq/endpoint`，
  不接管整个 `auth.wotbtools.com` / 其它 realm / 其它 IdP provider；`AuthReturnPolicy` 仅做路由边界
  （scheme/host/path/type=qq/state/code presence），不解释 state/code 载荷；`auth.wotbtools.com/.well-known/assetlinks.json`
  由 nginx 直接返回 `application/json`（非代理 Keycloak）。热返回走 `onNewIntent`，冷返回（进程被杀）走
  `pendingAuthReturn` + startup gate，不绕过强制更新。日志只记录 `auth-return action=... source=app-link`，
  不记录完整 callback URI/query/state/code。同步 `AuthReturnPolicyTest` 与 `docs/android/architecture.md`。
  需真机 + 生产 Keycloak 验证 App Link 路由与 `already_logged_in` 消除（PR 描述已标注 PRODUCTION VALIDATION REQUIRED）。
- **Battle Playback review regressions**：开局投影现在保留战前每个 canonical 据点的最后完整状态并在缺少显式 `t=0` 时 seed，确保 3/4 据点回放从 `00:00` 显示完整状态；最近 2 秒轨迹只按合法 OBSERVED segment 与 `interpolationAllowed` 裁剪，不再用固定 5 秒断线；坦克标记按可靠车体 metadata 显示，车辆模型碰撞只做 tank-vs-tank 小范围 presentation-only 软避让（不因视口边缘移动车辆、接近/离开视口自然裁剪）；无比分/据点时敌方仍固定在 HUD 第 3 列。
- **生产 Grafana 看板 runtime crash**：移除 `WotBTools · Keycloak` 看板若干 panel 的非法 dashboard links（`type=dashboard + uid` 但缺失有效 `url`），该结构会触发 Grafana 前端 `TypeError: Cannot read properties of undefined (reading 'replace')`；并在 CI observability 校验中加入静态守卫，禁止此类 panel links 回归。
- **Android QQ 登录 auth host allowlist（1.0.9）**：允许已在生产链证实的 `xui.ptlogin2.qq.com`
  进入 `AuthNavigationPolicy.AUTH_PROVIDER_HOSTS`（基于 Android 1.0.8 真机 ADB 证据：
  Keycloak → graph.qq.com → xui.ptlogin2.qq.com → callback，此前因 allowlist 缺失触发
  `AUTH_FAILURE`）。仅追加 exact hostname，不扩 `*.qq.com` / suffix / 整域 trust；auth flow 内
  unknown host 仍 `AUTH_FAILURE`，非 auth 外链仍 `OPEN_EXTERNAL`，CookieManager /
  Native Bridge origin 边界不变。同步 `AuthNavigationPolicyTest`（新增生产链 regression +
  xui 边界 + sourceCategory）与 `docs/android/architecture.md` Authentication Boundary。
- **Android QQ 登录 native auth handoff**：真实生产链在 `xui.ptlogin2.qq.com` 之后会发起
  `wtloginmqq://ptlogin/...` native 跳转（`ptlogin` 不是普通 HTTPS hostname）。新增
  `AuthNavigationAction.NATIVE_AUTH_HANDOFF` 与 `AuthNavigationPolicy.NATIVE_AUTH_TARGETS`
  （精确 `scheme=wtloginmqq` + `host=ptlogin` pair），仅在 `inAuthFlow=true` 时把该 URI 交给
  QQ App（ACTION_VIEW），保留当前 WebView auth transaction / cookie jar，不进入 `auth-recovery`、
  不 reload 首页、不切系统浏览器；QQ App 未安装时提示安装后重试（fail closed，不 silent fallback）。
  不把 `ptlogin` 加入 `AUTH_PROVIDER_HOSTS`，不扩 `mqq*`/`*.qq.com`/suffix/前缀通配；未知
  native scheme/host（含 host=null 的未知 custom scheme）在 auth flow 内仍 `AUTH_FAILURE` 且不退出
  auth flow（fail closed）。同步 `AuthNavigationPolicyTest`
  （native handoff 精确匹配 + 越权/越域 rejection + 生产链到 native handoff）与
  `docs/android/architecture.md` Authentication Boundary（区分 Web auth hosts 与 native handoff）。

### Added
- **Team AI Tactical Review v0.2**：Team Call #2 改为 information/vision → objectives → local engagements → position/tempo → team execution → HP/trades 的证据优先推理顺序；新增信息/视野与局部传播 prompt skill，升级既有四个战术模块，并在 canonical timeline 中向 Team prompt 暴露已解码的实时基地状态与争霸点数中立时间线。补充三语本地化契约、反捷径 golden cases 与 objective timeline 回归；不新增后端 tactical verdict 或并行 episode schema。
- **Team AI Tactical Review v0.1**：训练房/联赛 Team Call #2 增加模块化团队执行、位置节奏、HP/火力交换与模式目标推理参考；`primaryDiagnosis` 不再强制制造错误，Strategic Prior 明确为非权威基线，无法由回放证明的通信/call 原因保持跳过。同步三语 prompt 契约、grounding 回归与 golden cases。
- **Juhe QQ callback 阶段追踪与 callbackRef 关联（已脱敏）**：JuheQqEndpoint.handleCallback 增加完整 stage 序列
  （callback_entered → authentication_session_restored → juhe_callback_accepted → before_broker_authenticated →
  broker_authenticated / broker_authenticated_failed），所有 stage 带同一 callbackRef（state 的 SHA-256 前 8 hex，
  单向、不可逆、可关联同一 transaction 的重复 callback / replay）。仅记录 realm / provider / juheType /
  authenticationSession=present|invalid / socialUid=present|empty / exception；绝不记录完整 state、authorization
  code、access token、appkey、Cookie、完整 callback URL/query、social_uid 原值。用于定位 Keycloak
  IDENTITY_PROVIDER_LOGIN_ERROR already_logged_in 的真实失败边界（evidence-first，本阶段不改登录行为）。
  同步 JuheQqEndpointTest / JuheQqIdentityProviderTest（stage 顺序 + callbackRef 稳定/不可逆 + 敏感值不落日志）。
- **Local Frontend → Production Backend / Keycloak 开发模式**：前端新增 `npm run dev:production-remote`，通过 Vite `/api` 开发代理连接生产站点，同时复用现有生产 Keycloak issuer 配置；开发 Topbar 显示非模态环境提示并提醒不要上传测试或敏感数据。普通 `npm run dev` 的本地后端代理保持不变。详见 `docs/frontend/local-production-dev.md`。

### Changed
- **Battle Playback workspace / HUD / event / destroyed 增强**：fullscreen 改为 3-column Workspace（64px Left Rail + Map Workspace + Right Details；Right Details 未选状态默认 Battle Summary）；HUD 显示完整整数（去掉 1k/22.3k 缩写）并带「己方总HP / 敌方总HP / 点数」语义 label + Team HP 延迟伤害 chip（seek/恢复帧 hpNoTransition 直接同步、prefers-reduced-motion 禁用）；kill feed 改为 Map Workspace top-center Event Banner（玩家名（车辆名）被击毁、victim-only、最多 2 条队列、约 3s）；destroyed 单车隐藏 HP、Details 明确「已击毁」。坐标 SSoT：SVG map / HTML marker / collision / hitbox / label / float 同用 .pb-map / mapWidth() rect，fullscreen/contain 下 marker 不再跑进 gutter（新增 source-level 回归）。
- **Battle Playback playback enhancement**：接入 wrapper12 权威 A/B/C/D 基地状态并按回放时间查询；新增不跨观测断点的最近 2 秒车辆轨迹（默认开启且记忆）；全屏 shell 以 grid/flex 保证 HUD、地图、控制和时间轴共同可见，密集坦克标记做稳定的 presentation-only 避让；无权威点数/目标时移除虚假占位符，标注色板增加纯黑。保持 backend route aggregate 供 AI/export 消费，但不恢复独立 Routes UI。
- **Battle Playback responsive shell**：Battle Playback now uses a shared map-first shell with a universal three-column HUD, compact playback controls, on-demand Battle/Vehicle/Display/Events panels, and a collapsible annotation toolbar. Mobile keeps the map and HUD visible by default, reveals controls on map activity, and uses best-effort landscape fullscreen without changing replay state or the V2/API contract.
- **Android auth flow 未知 host 策略与失败恢复**：auth flow 内遇到未验证 host 不再 `OPEN_EXTERNAL + 清空 inAuthFlow`（这是 `cookie_not_found` 与黑屏的关键根因之一），改为 `AUTH_FAILURE` 阻断该导航并进入 auth-failure recovery：退出 auth flow、返回 WotBTools 首页并提示「登录失败，请重试」。非 auth flow 的普通外链 `OPEN_EXTERNAL` 行为不变；不新增 `*.qq.com` 等通配白名单，仅在未来真实 navigation trace 证明后逐个加入 exact hostname。
- **Battle Playback Event Panel presentation cleanup**：事件面板仅展示 `DAMAGE`、`KILL` 和 `DESTROYED`；`authoritativeEvents` 仍完整供播放状态、战斗反馈、炮线和统计使用，不改变 canonical 事件事实。
- **Battle Playback UI hierarchy cleanup**：移除用户可见路线视图、路线筛选/图例与相关残留；时间轴改为无事件标记装饰，事件集中到默认折叠且可点击 seek 的 Event Panel；控制栏收敛为播放、±5 秒、0.5/1/2/4 倍速、Reset View 和 Fullscreen。保留后端 route aggregate 合同及真实事件、HP、选中状态。
- **手机端（<768px）UI 布局优化**：Mobile 断点统一为 `@media (width < 768px)` range 语法并消除 JS/CSS 1px 错配；补齐 classic 浅色主题在 AdminUsers/Contact/Boost/Profile 的对比度覆写；修复 HoF mark3 工具条挤压、分析面板表格裁剪、admin 表头移动端 sticky 偏移、modal 遮罩 showcase 语义反转、ColumnPicker 触屏不可重排序（新增上/下移按钮 + 三语 i18n）、批量选择 bottom-sheet 无遮罩等问题；移动端输入框字号 ≥16px、主要触控目标 ≥36px，并预留 viewport-fit/safe-area 兼容。无 API/路由/数据契约变化。

### Removed
- **Hundred WG statistics path**：移除百场 `WARGAMING_API` 官方统计、自动审核 endpoint、snapshot DTO/映射与前端分支；Wargaming ASIA/EU/NA 登录和 Profile 同步保留，百场统一走 MANUAL 截图 + 5 replay 审核。新增生产存量清理工具，默认 dry-run，并按共享引用保护 MANUAL 与单场名人堂回放。

### Changed
- **Homepage feature card backgrounds**：为 Replay 解析、AI 复盘、战局重建、Boost 和 Sponsor 卡片分配独立视觉素材，并按业务用途整理资源文件名；不改变页面布局和功能。
- **Showcase background assets**：主页、各功能页和独立赞助页改用用户提供的原创背景素材；保留现有 canonical 资源路径、页面结构与响应式规则。
- **Keycloak 与生产观测升级**：Keycloak 26.6.4 image build 启用 health/metrics，management `/metrics` 通过 Docker 内部端口 `9000` 纳入 Prometheus；Alloy/Loki 纳入 Keycloak 日志；新增固定版本 node-exporter、AI review queue depth Gauge 与 Keycloak/生产总览 Dashboard。保持公共 HTTP/Android contract、数据库 schema、业务处理入口与无用户级 metric label 不变。
- **Battle Playback V2 backend-owned state facts**：将相对满血证明、DamageLoss 的 transient/ghost
  事实、模块/乘员清除 transition 与 consumable 全局失效边界收敛到 canonical backend projection；
  前端只按时间查询并负责百分比、格式化和展示，legacy artifact 兼容仍限于读取边界。
- **Battle Playback V2 canonical truth closure**：V2 HTTP playback now removes the dead
  `shots`/`ShotTrack` surface, transports canonical `damageLosses`, and keeps capability
  limited to `FULL`/`PARTIAL`; old persisted artifacts are normalized only while being read.
  Position/orientation sample knowledge is no longer duplicated, perspective remains neutral
  when unresolved, consumable slots and 3/3/9 loadout shapes are explicit, and marker/HP/
  Inspector/damage-log consumers read the current V2 dataset directly.
- **Battle Playback V2 canonical consumption cleanup**：Battle Playback now consumes
  `VehiclePlaybackTrack` directly. V2-native health/team-health selectors unify marker,
  team bar, Details and Inspector presentation; `track.friendly`, position interpolation
  permission and canonical life/health transitions are authoritative; health decreases are the
  received-damage truth, while event `observedHpLoss` is used only for reliable attacker attribution.
  Type5 combat-vehicle opening HP now seeds the canonical timeline. No OpenAPI shape change.
- **Battle Playback temporal/loadout closure**：active-battle playback now excludes negative-time events while retaining canonical provenance, deduplicates pre-battle `INITIALIZED` seeds by entity+wireCode, and rejects negative temporal fields at the producer boundary. Type5 loadout decoding now shares the Type32 consumable mapping and covers the reviewed 11.19 food, fuel, protective-kit, and gear-oil wire-code families; current BlitzKit `equipment.pb` identity for vehicle-specific raw equipment `120` (`Improved Modules +`) is cataloged and generated into the three-language Inspector labels; unknown codes retain raw values. Contract-invalid playback responses have an explicit localized error instead of the generic unknown error, and the Inspector equipment rows remain a fixed 3×3 grid at narrow widths.
- **真实 DeepSeek E2E 测试隔离**：三个真实 provider probe 统一标记为 `ai-live`，`wotb-web` 默认 Surefire 排除 live probe；普通测试即使存在 `AI_API_KEY` 也不会因此发起付费请求。新增 deterministic isolation guard，并明确 live probe 的人工显式运行约定；mock、loopback、prompt contract 与 AI eval 测试保持普通测试路径。
- **FE ↔ BE HTTP contract infrastructure**：新增 OpenAPI 3.1 wire contract 作为 HTTP 唯一事实源，生成前端 transport/schema/error-code registry，加入 OpenAPI/ref、generated drift、生产形状 fixture、Ajv runtime 与 Playback serialization 的独立 CI gate；补齐 domain/transport/artifact compatibility 与 ApiError 维护规则。Playback 旧 artifact 仅在读取边界兼容，live response 不放宽为 legacy enum；server error registry 与前端 network/abort/malformed 等 synthetic application error 分层。
- **League #301-only + settled fingerprint + PR-E single-source AI dispatch**：League Rating 以 #301 的 14 settled combatants 为唯一 authority——删除 `settlementAccountsCoveredByRoster`/`settlementRosterTeamConsistent` eligibility 依赖及字段（#201 仅用于 nickname/clan/rank/prebattle metadata enrichment，缺失/extra 不阻塞评分；`Battle.rosterComplete` 保留给 SURVIVOR_SETTLEMENT/annihilation 推断）。`LeagueRatingConflictDetector` 改为确定性 settlement/Rating 指纹（第一份 canonical，O(n) 非 all-pairs），删除 roster/#201/clan/killer/resultEntity 等非 Rating identity 字段。AI 复盘改为单文件 `ReplayProcessingResult` 直接 scope/eligibility/consumer dispatch（不再 `List.of(result) -> BatchAnalyzer -> grouping -> representative`）；`ReplayProcessingCapabilities` 收敛为 5 个不可重算事实（删除 recorderParticipantResolved / recorderEntityMapped / playerFeatureExtractionPossible 三个可推导状态）。无 Web/Android contract、Flyway 或生产处理入口变化。
- **PR203 AI eligibility 单一 SSOT**：AI eligibility 判定收敛为单一来源——`ReplayProcessingCapabilities.aiAnalyzable(scope)` 按当前 result 的实际 capability facts 即时判定（PLAYER_FOCUSED 需 summary+recorder；TEAM_PERSPECTIVE 需 summary+perspectiveTeamResolved+recorder/feature），删除独立 `AiAnalysisEligibility` utility（Reuse/Extend：职责最匹配的现有类型是 capabilities value）与 `BatchAnalyzer` 内重复 `isAiAnalyzable` switch；`BatchAnalyzer.analyzePartition()` 与 web 单文件 consumer 复用同一 SSOT；`ReplayProcessingResult.analyzable()` 死代码删除（零调用方）。无 Web/Android contract、Flyway 或生产处理入口变化。
- **Replay/League authority cleanup**：settlement `#301 field24 lifeTime` 成为唯一业务死亡秒值；Playback/live reconstruction 仅服务播放、HP/动画与诊断，不覆盖 `PlayerResult`。Trade 与 League 校验改为 settlement-only/fail-closed；decoder 按 packet/envelope/shape/invariant 处理，无法证明的 numeric semantic raw-preserve。保留兼容 projection、Web/Android contract、Flyway 与生产处理入口不变。
- **PR G 首批可观测性看板**：新增 Production Overview、AI Review、Error Explorer 三张 Grafana 看板，覆盖 Backend health、HTTP error/P95、Replay active/queued、AI lifecycle/validation、CPU/JVM 与 Loki 错误关联检索。复用现有 Prometheus/Loki 采集链路，不引入新的 exporter，不改变生产业务、Web/Android contract、Flyway、RabbitMQ 或 COS。
- **Independent Control API acceptance slice**：从 async contracts 基线单独提供 `wotb-control` artifact；使用真实 PostgreSQL Testcontainers + `JdbcClient SELECT 1`，并以独立 management port 的真实 Spring Boot/Actuator security smoke 验证 health、metrics、admin probe 与 401/403 边界。无 Flyway、RabbitMQ、COS 或 Web/Android public contract 变更；Native POC 已完成并记录 JVM/Native 对比结果，生产部署仍延期。
- **Pre-Dual-Cloud contract foundation**：新增无 Spring/provider SDK 依赖的 `wotb-contracts` artifact，建立 metadata-only async ports 与分别面向 current processing-job/source contract 的显式 status adapters；RabbitMQ/COS/AI/Replay extension 保持延期，当前 Web/Android contract 不变。
- **Frontend TypeScript foundation and Replay API contracts**：引入 `vue-tsc` 独立类型检查与 CI step，建立 API 错误、Replay Job/Result、Workspace、AI capability、Playback 的共享类型和 runtime guards；Replay Processing/Export API、Replay/AI/Playback 核心纯函数迁移到 typed boundary，保留 JS/TS 共存与现有运行时协议不变。
- **PR194 blocker closure**：Processing READY 只提交 authoritative `resp`，由 `ReplayPage` 对 `resp` 做 immediate/idempotent `cols.initFromResponse` hydration；移除 Data presentation callback bridge，Processing 不再知道列展示。Battle Playback 测试按地图、控制、时间线、详情面板与编排责任拆分，保留完整集成回归；协议、HP truth、visibility、orientation 与事件顺序不变。
- **PR4 Battle Playback presentation decomposition**：将 `BattlePlayback.vue` 的地图、播放控制/时间线与车辆详情展示拆分为 `BattleMap.vue`、`PlaybackControls.vue`、`VehicleDetailsPanel.vue`；车辆状态投影及时钟推进提取为可测试纯函数。`BattlePlayback.vue` 继续作为编排层，canonical V2 数据、标记资产、交互与后端 API 行为不变。
- **PR3 Replay Workspace UI decomposition**：将 Workspace 标题/清空、能力 tabs、批次与当前回放 selector 拆为 `ReplayWorkspaceHeader`、`ReplayCapabilityTabs`、`ReplaySourcePanel` 展示单元；`ReplayWorkspace` 保留 session/Processing/auth/upload 编排，权威 selected battle 与 capability state 不变。无产品流程或 API 行为变化。
- **PR2 Replay Session state owner**：新增 `useReplaySession` 统一持有 selection、Processing/Result identity、Export state 与 Workspace view；Processing lifecycle 下沉至 `useProcessingJob`，Export lifecycle 下沉至 `useExportJob`，`useReplayWorkspace` 仅作 session facade。保持现有 API、sourceId、single-flight、stale-response 与 Android replay 行为不变。
- **Frontend instruction/docs cleanup（PR1）**：`frontend/AGENTS.md` 仅保留 toolchain、架构边界、状态 ownership、UI Profile、响应式、测试与禁止项；Replay Workspace、UI system 及回放/AI/Playback/资产事实分别引用对应 canonical 文档，避免目录指令与当前实现漂移。
- **Frontend application-shell routing foundation（PR1）**：引入 Vue Router 作为 SPA history/deep-link owner，保留 `?view=` 公开 URL、旧别名（leaderboard / extended / reconstruction）与 `/download/android[/]` 兼容；`App.vue` 收敛为最小路由根，应用壳、顶栏、用户菜单、全局错误弹窗与页面注册迁入 `src/app/`。新增前端架构约定、可复用 `frontend-architecture` skill 与架构文档，为后续 Replay 状态/Workspace/Playback 分步迁移建立边界；未改变后端契约或产品流程。

### Fixed
- **三环单张截图提交被误判为无效**：修复 `proofScreenshots` 仅包含一个 data URL 时，Spring 将其中的逗号按集合分隔符拆开，继而触发 `MARK3_INVALID_IMAGE_DATA` 的问题。Controller 现在直接读取 multipart 的原始重复参数值，保持既有 1–2 张 base64 `data:image/` API 契约；新增单图与双图 HTTP 参数绑定回归测试。
- **Showcase 背景素材版权风险收口**：替换主页、回放、名人堂、Rating、Profile、Boost、Admin、HoF Admin、版本与联系页的正式 PNG 背景，移除原背景中可识别的 WG / World of Tanks 品牌图形与文字；页面槽位、遮罩和响应式布局保持不变。
- **Android WebView 登录 Cookie / OAuth 链路修复**：Android WebView 现在显式启用认证所需的
  first-party/third-party Cookie；Keycloak → QQ/IdP → callback 认证事务保持在同一个 WebView
  cookie jar 中，不再因中间导航切入系统浏览器而分裂 session。provider 仍使用证据驱动的精确
  hostname allowlist，普通外链与 Native Bridge origin 边界不变。
- **Replay Workspace capability 切换状态同步/结果丢失（生产 hotfix）**：两个关联 bug——①在「战局回放」上传单 replay，READY 后 Map 不自动出现，需手动切一次 tab；②data/playback 间切换后赛果可能消失/进入空态。根因是 ReplayWorkspace 用两个碎片化 watcher（`[activeCapability, currentTargetFile]` prepare + `selectionRevision→reset`）驱动 capability dataset，`selectionRevision` reset 在 prepare 之后执行会自增 token，使 in-flight `requestDirectAction` 的 resolve 被 stale-guard 丢弃（datasetRef 永不设置），且 prepare 不看 READY（processingJobId/currentBattleId）变化，导致必须靠切 tab 重新触发。重构为**单一 reconcile watcher**：由 authoritative Workspace 源（`activeCapability + currentBattleId + currentProcessingJobId + currentTargetFile + selectionRevision + files`）驱动当前活跃 capability 的 dataset，`useCapabilityReplay.reconcile` 幂等 + 在途不重发；capability 切换只改 `activeWorkspaceTab` 与 capability-specific dataset，绝不 reset 基础 replay state（files/resp/currentBattleId/processingJob）。`App.vue` 三个 replay URL 映射同一 `ReplayWorkspace`（KeepAlive，无 `:key` 强制 remount），实例与状态共用，确认非 remount 根因。新增 Case1/Case2/跨 capability selection 回归。验证：frontend full test（81 files / 1381 passed）+ `npm run build`。

- **PR188 Known-Bugs 收尾：Replay Workspace 共享 selection + Battle Playback 反未来泄漏 + 战斗装载本地化**：
  - **Replay Workspace 单一事实源收敛（Plan §1–§13）**：`SUMMARY` 视图由「保留当前选中单场」改为「把 Workspace 当前回放归一第一场有效 battle」（`currentBattleId = parsedBattles[0].sourceId`）；单 replay（即使 aggregate 有数据）默认直接 `SINGLE` 单场视图，不再先停在汇总（14 名选手）；多场默认 `SUMMARY + 第一场`；`useCapabilityReplay` 加幂等 reconcile（同文件 + 已有 dataset 引用时不复位 / 不重请求 / 不闪断）。Data / AI / Playback 继续共享唯一 `currentBattleId` + `processingJobId + sourceId`，切换不重 parse。
  - **Battle Playback 反未来信息泄漏（Plan §14–§20）**：`positionAtV2` / `orientationAtV2` 增加硬性守卫——整个 segment `startSec > t` 对当前查询完全不可见；任何候选样本进入 `lastSeen` 前必须满足 `sample.timeSec <= t`；修复单样本段在 `t == 首样本时刻` 的漏返回。这使「t=00:23 显示敌方 03:06 位置 / last-known 时间」的未来泄漏彻底封死；marker 可见性、Inspector `last_spotted` 时间、方向冻结全部消费同一 anti-future-leak 查询（纯函数回归用例覆盖 future-only / past+future / future LAST_KNOWN / orientation）。
  - **战斗装载本地化（Plan §21–§23）**：后端只返回稳定 `logicalItemId` / `wireCode` / numeric `equipmentId`，用户可见文案统一由前端 `src/data/loadoutItems.js`（**zh/en 由 `frontend/scripts/generate-loadout-items.mjs` 读取 `common/wotb-item-catalog-json/` authoritative catalog 自动生成，ru 用脚本内 RU overlay**；不再手工复制第二份 zh/en 数据源）＋ i18n 提供。`V2VehicleInspector` 不再裸显 `MULTI_PURPOSE_RESTORATION_PACK` / `REPAIR_KIT` / `103` 等 raw 内部 id；consumable **runtime state**（`INITIALIZED` / `ACTIVATED` / `ACTIVE_ENDED_OR_COOLDOWN` / `TEARDOWN`）也经三语 `recon.map.playback.consumable_state.*` 本地化，不裸显 internal enum；未知 consumable/provision/equipment 走三语「未知消耗品/补给/装备（id）」fallback 并保留 raw id 仅诊断。
  - 验证：frontend full test（`battlePlaybackV2` / `ReplayWorkspace` / `useReplayWorkspace` / `ReplayPage` / `BattlePlayback` / `V2VehicleInspector` / `loadoutItems`）全绿（1375 passed）；`npm run build` 通过。

- **Classic / 简约主题深色残留闭环（Known UI bug）**：系统性扫描 Classic（`data-ui-profile="classic"`）下主要页面与通用组件，把「外圈 UI chrome」组件 scoped 里硬编码的深色面（`#0…`/`#1…`/`rgba(0,…)`）改为语义 token（`var(--bg-card)`/`var(--text)`/…），让 Classic 继承浅色 token，而不是继续在 classic-profile.css 堆 `!important` override。覆盖：App 列面板/列列表、Admin 搜索/表格/按钮、Boost 申请/分配/用户搜索、Profile 编辑输入/记录表、Markdown 表格/代码/引用、Rating Docs 文档卡、Player 导出评分卡、ReplayWorkspace `.workspace-tabs`、BattlePlaybackPanel `.panel`。Showcase（默认深色）不受影响（token 仍为深色）。新增 `frontend/src/styles/classic-theme-source-regression.test.js` source-level 回归（防新增/回退深色 hardcode）。验证：frontend full test（79 files, 1351 passed, 37 skipped）+ production build passed。

- **Error contract 收敛为单一错误 ID + Android 下载页生产 404 关闭**：
  - **Blocker（Android 下载页生产 404）**：`/download/android` 与 `/download/android/` 直接返回 nginx 404。根因是 `location /download/android/` 前缀把带尾斜杠的 SPA 页面路由按静态资源 `try_files $uri =404` 处理，永远到不了 SPA fallback。修正：`location = /download/android` 与 `location = /download/android/` 都 `try_files /index.html`（进 SPA 渲染 AndroidDownloadPage），`version.json` 保持 exact 静态 no-store，APK 前缀仍 `try_files $uri =404`（不存在返回真正 404，绝不 fallback index.html）。前端 `App.vue` 同时把 `/download/android/` 尾斜杠识别为 android view（否则 SPA 会落入默认 home/replay）。新增 `deploy/test-nginx-android-route.sh` 端到端回归（SPA/version.json/APK/404 四态）。
  - **Major（错误契约过度设计）**：并存 `code/messageKey/traceId/exceptionId/requestId`，且前端实际拿到的是请求级 `traceId` 而非异常实例 id。收敛为单一错误 id：canonical envelope 改为 `{id, errorCode, errorMsg, status, retryable, details, timestamp}`，删除响应级 `messageKey`/`traceId`/`code`；`id` 进入响应/日志/前端错误 UI（typed `ApiException` 返回异常实例 id，非 typed/security/legacy 返回请求关联 id），`errorMsg` 为可选安全诊断；前端 `errorCode -> i18n` 渲染，`id` 作诊断 ID（三语 `errors.diagnostic_id` 改用 `{id}`）。`GlobalExceptionHandler` 未新增任何 feature-specific `@ExceptionHandler`（Minor 维持）。后端/前端相关测试、production build、nginx 路由验证全绿。

- **统一 API Error Contract 并闭环 Battle Playback 403**：所有 Spring MVC handled error 与 Spring Security 401/403 统一返回 `code/status/messageKey/traceId/retryable/details/timestamp` JSON，`X-Request-ID` 与 body traceId 一致，5xx 日志可按 traceId 定位且不向客户端泄漏异常细节；新增 `ApiErrorCode` enum 与内部 `ApiException(id,errorCode,errorMsg)`。修复 `SecurityConfig` 遗漏 `/api/replay/battle-playback-v2` matcher 导致合法 user/admin 落入 denyAll 的生产权限 bug，并覆盖 anonymous 401、wrong-role 403、user/admin 访问回归。前端统一 canonical/legacy/empty/proxy/network/abort parser，Battle Playback 与 AI Review 按 auth/network/internal/unavailable 分流并用 `retryable` 控制重试，Processing/Export Job 移除手工错误码 if/else，三语展示诊断 ID。
- **Android 安装包公开（需登录）**：此前 Android 下载入口仅 `isAdmin` 可见、且 `/download/android` 无登录门禁。改为对**所有用户**开放入口（App 顶栏 / 用户菜单 / HomePage hero / quick panel 去掉 `isAdmin` 门控，仅保留 `!isAndroidApp()` App 内隐藏）与下载页；未登录访问 `/download/android` 自动跳 Keycloak（登录后回本页），登录后展示 manifest 与 APK 下载链接（APK 仍由 nginx 静态托管）。`AndroidDownloadPage` 增加 `authState`（checking/ready/required）门禁 + 手动登录兜底。新增未登录门禁回归测试。
- **Battle Playback PRIMARY 不被 MapOverview capability 锁死（canonical/decoder 不动）**：修正两处生产 blocker。① `ReplayProcessingJobService.buildBattlePlaybackV2` 移除 `catch(RuntimeException)→null` 静默吞掉——改为显式 `V2BuildOutcome`（AVAILABLE / UNAVAILABLE / ERROR），在调用层记录 `processing_job_v2_available/_unavailable/_error`，reason 区分 `NO_RECONSTRUCTION / RECORDER_MISSING / TIMELINE_NOT_USABLE / PROJECTION_EMPTY / TIMELINE_BUILD_ERROR / PROJECTOR_ERROR`（error 带 stacktrace，绝不记录 replay 内容/token）；V2 仍 fail-closed（不判 source FAILED，仅 IOException 判失败）。`BattlePlaybackDataset` 新增权威 `arenaBonusType`（前端标准/争霸事件过滤），由 projector 写入。② 前端 `BattlePlaybackPanel` PRIMARY 只以 `battle-playback-v2` 为权威（`playbackV2State FULL/PARTIAL`），不再要求 `mapOverview` 存在；MapOverview 缺失时由 V2 dataset 合成最小 authoritative overview（mapCode/friendlyTeam/recorderAccountId/arenaBonusType），MapOverview 仅作 secondary heatmap/routes。`BattlePlayback.vue` `overview` 改可空并以 V2 dataset 为核心输入（V2 缺失字段回退 overview）；6x6 网格改用显式强对比线（`gridStrokeStrong`，暗图 0.55 白 / 亮图 0.55 黑、`stroke-width:1`）保证每一列可见地隔开（热力图鸟瞰仍用弱 `gridStroke`）。未改 canonical battle-start decoder / sourceId / AI Review / Data / uploader 语义。新增回归：V2 FULL+mapOverview 204→PRIMARY 渲染、V2 PARTIAL+mapOverview 204→降级提示、`overview=null` V2-only 渲染、projector 抛异常→显式 ERROR+source READY、真实 fixture→V2 artifact+arenaBonusType、palette `gridStrokeStrong`。验证：frontend `npm test`（1311 green）+ `npm run build`；backend `wotb-web` targeted（ReplayProcessingJobService/BattlePlaybackDataset/Projector/controller/query/artifact）全绿。
- **AI 复盘 / Battle Playback 回归：无法锚定 battle-start（core）**：`EntityMethodDecoder` 的 method4 `RoundFinished` 解码此前强制 `entityClass==AVATAR`；真实 11.19.0_china_apple CW 回放中 round-finished 由**非录像者实体**发送，被 `METHOD4_CLASS_OR_SHAPE` 丢弃 → `recon.battleStartRawClockSec=null` → `BattleTimelineBuilder` `TIMELINE_CLOCK_UNRESOLVED` → AI Review `AI_TIMELINE_UNUSABLE` 且 Playback V2 dataset 为 null（只剩地图鸟瞰）。修正：2-byte `RoundFinished` 形状唯一且 version-verified（envelope 有效 + VERIFIED 关闭语义），按权威 shape 解码为 `RoundFinishedEvent`（不再要求 AVATAR）；16-byte Vehicle collision 仍要求 `VEHICLE` + 16B 双重验证。连带更新 `EntityMethodDecoderTest` 两条过严 guard。验证：`wotb-core` 全量测试绿；真实 34 场批量现 `usable=true`、battle-start 时钟正常解析。后续 `AiReviewCapability` 能力降级（`AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE`）与 Playback 完整性在独立 PR 跟进。
- **Battle Playback V2 整块 204 静默消失（生产 hotfix，hotfix PR）**：真实 34 场冠军赛回放沿完整链路探针发现主因是 `BattlePlaybackDataset$VehicleBattleLoadoutDto` 用 `List.copyOf` 拒绝 `null` 元素（loadout 事实允许 unknown raw-preserve：logicalItemId/wireCode/equipmentId 可为 null）→ `BattlePlaybackProjector.project` 抛 NPE → artifact 不写 → `POST /api/replay/battle-playback-v2` 返 204 → 前端 `loadPlaybackV2` 置 `null` → `MapOverview` 隐藏「战局回放」tab。修正：`VehicleBattleLoadoutDto` 改 null-tolerant 不可变拷贝（保留 null 语义，前端按 unknown 处理）。
- **Battle-start anchor：subtype48 wrapper=3 ARENA_PERIOD 的 root field3 实为嵌套消息（canonical）**：授权 corpus（34 场 chore，单 arenaUniqueId）探针显示 `EntityMethodDecoder.parseArenaPeriod` 只接受 field3 为「单个 Number」，而 Wargaming 11.19 china / china_apple 数据中 field3 是<b>嵌套 arena-period 消息</b>——其 field1 = periodRaw（1 WAITING / 2 PREBATTLE / 3 BATTLE / 4 AFTERBATTLE），field2 = timestamp bits，field3 = period length。旧 decoder 对嵌套形状误判「无 battle-start 权威」→ `TIMELINE_CLOCK_UNRESOLVED` → 34 场中 4 场（全部 11.19.0_china_apple）Playback V2 无法生成。修正：`parseArenaPeriod` 解码嵌套 field1 作为 periodRaw（保留 Number 直接值前向兼容；结构/值非法 fail-closed），`ArenaPeriodChangedEvent(BATTLE)` 成为权威 battle-start 锚点（优先于 RoundFinished-settlement fallback）。验证：**34/34 生成 V2 FULL**（含 4 场 `_china_apple`）；`wotb-core` 全量绿；新增 `EntityMethodDecoderArenaPeriodTest` + 更新 `TimelineRealFixtureProbeTest`。
- **Replay Workspace 共享 uploader：AI 复盘 / 战局回放能力下修正为单文件语义**：此前共享 `FileUploader` 后 AI / Playback 仍显示「支持多选和文件夹 / 选择文件夹」入口（错误业务语义）。修正：`ReplayWorkspace` 按 activeCapability 传 `allowFolder`——Data 允许多选+文件夹；AI / Playback 单文件（`multiple=false`、无 folder）。`FileUploader` 的 add 入口改为恒渲染（`:multiple=allowFolder`），folder 按钮仅 Data 显示；单文件模式新选文件 replace 整个 selection（不 merge 原 batch），drag/drop 多文件 reject（不静默取第一个、不改现有 selection）。已通过 Data/AI/Playback 各单一回归测试。
- **Replay Workspace source identity：以 `BattleDto.sourceId` 为唯一权威，禁止把 `rN` 当 `parsedBattles[N]` 下标**：`currentBattle` 改按 `battle.sourceId === currentBattleId` find、`currentBattleIndex` 用 `parsedBattles.findIndex`；failure/duplicate 会从 `resp.battles` 移除，`rN` 的 N 是文件 sourceIndex，与数组下标不等价。READY 初始化用 `resp.battles[0]?.sourceId`（禁止硬编码 `r0`）；Workspace current-battle selector 只列有效 parsed battles（failed/duplicate 不入列），label 由 `sourceId rN -> files[N]` 映射，Data/Header/AI/Playback 全部基于同一 sourceId。移除 `replay.activeTab` 旧渲染兼容 bridge。新增边界测试（r0 failed→r1/r2 valid、r1 duplicate→r0/r2、summary→AI/Playback 同 battle、selector 不列 failed/duplicate）。验证：frontend `npm test` 全绿 + `npm run build`。

### Changed
- **Replay Workspace 状态模型 / 数据视图收敛（Blocker #1/#2/#3）**：`currentBattleId` 从「null=summary」改为**恒代表当前单场**（`'r<i>'`，仅在无可用 battle 时为 null），新增独立 `dataViewMode = SUMMARY | SINGLE` 作为数据页视图轴。`ReplayPage` 删除横向「汇总 | battle1 | battle2 …」tabs（`v-for b` + `activeTab='b'+i`），只保留 `dataViewMode` 驱动的「汇总视图 / 单场视图」切换，单场选择统一由 Workspace header 的 current-battle selector 控制；删除 results toolbar 中重复的 `AI复盘 / 战局回放` 入口，Workspace 顶部三能力 tabs（data / AI / 回放）成为唯一 capability navigation，并清理 `openBattlePlayback / openAiReview / currentBattleRef / requireLoginForBattleAction` 死代码。`useColumns` 的 `colScope` 改由 `dataViewMode` 判定（`SUMMARY → agg/cw`，`SINGLE → player`）。`ReplayWorkspace` header 明确拆分「共 N 场」与「当前回放：xxx #N ▾」，SUMMARY 视图不再出现空名称 / #0。新增三语 `result.single_tab`。验证：frontend `npm test`（1290 green）+ `npm run build` 通过。注意：SUMMARY 的当前回放归一语义在 PR188 Known-Bugs 收尾中按 Plan §5 定为「归一到第一场有效 battle」（见本文件顶部 [Unreleased] Fixed）。
- **Replay Workspace 布局收敛 + Battle Playback 主功能化（hotfix PR）**：① header 瘦身——`当前回放` selector 与 top `解析/AI/回放` capability status flags（视觉像第二套按钮）移出 header；header 只留 title + clear + capability tabs，`共 N 场`/当前回放 selector 下沉到 Replay source/upload section（复用 `battleOptions/selectBattle/currentBattleId`）。② `BattlePlaybackPanel` 改为直接渲染 `BattlePlayback`（PRIMARY）——面板内 `[战斗回放][地图鸟瞰]` 两级，战局回放 tab 默认第一屏直接展示 play/seek/时间/速度/车辆状态。③ `MapOverview` 转纯 secondary（heatmap/routes），移除「战局回放」tab 与 `BattlePlayback` 挂载。④ `loadPlaybackV2` 显式状态机 LOADING/FULL/PARTIAL/UNAVAILABLE/ERROR + 确定性原因 + retry + 日志（processingJobId/sourceId/V2 status/capability/limitations/failure code，不记 token），204/error 不再静默吞掉整块。新增回归测试（V2 204→UNAVAILABLE、500→ERROR+retry、PARTIAL 降级提示、布局断言）。验证：frontend `npm test`（1296 green）+ `npm run build`。
- **AI / Playback capability 降级级**：`AnalyzeResponse` 新增 `capability`（`AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE`，在 `analyzeFacts` 按 `battleStartRawClockSec` 派生，与 `SingleReplayPromptPlanner` 判定一致；UNAVAILABLE 由 `AI_TIMELINE_UNUSABLE` 错误路径表达）；`BattlePlaybackDataset` 新增 `capability`（`FULL / PARTIAL / UNAVAILABLE`，由 `limitations` 派生，空=FULL/非空=PARTIAL；UNAVAILABLE 由 dataset==null 即 204 表达，兼容旧缓存 JSON）。前端 `BattlePlaybackPanel` / `AiReviewPanel` 据 capability 展示确定性降级提示（部分播放/受限时间轴），**绝不猜测未观测事实**；新增三语 `recon.map.capability_*` / `recon.capability_limited`。新增后端 capability 契约测试 + 前端 UI 测试。验证：frontend `npm test`（1295 green）+ `npm run build`；backend `wotb-core` 全量绿、`wotb-web` replay 相关测试绿。

### Added
- **Replay Workspace 统一重构（前端）**：把「回放解析 / AI 复盘 / 战局回放」三个彼此隔离的能力页收敛为单一 `ReplayWorkspace`——三个 URL（`?view=replay` / `ai-review` / `battle-playback`）共用同一个组件，仅通过 `initialCapability`（data / ai / playback）区分默认能力 tab，并由 pushState + popstate 形成可 Back/Forward 的 history（返回时 selection / Processing Job 不丢，只恢复 activeCapability）。三个 capability tab 始终可见（不因能力不可用而消失）；选择一次 replay、只创建一个 Processing Job，data / AI / Playback 共享同一 selection 与 `processingJobId + sourceId` Dataset 引用（绝不重传 / 重 parse）。Workspace 持有唯一 `useReplay` 并 `provide('replay')`，其内单一 FileUploader + Processing 面板；`ReplayPage` 作为 data 结果 tab 嵌入（`embedded` prop，隐藏自己的上传器/Processing），并向 Workspace 注册列初始化回调。AI 与 Playback 各持独立 `useCapabilityReplay`（Dataset 状态互不污染），Batch 汇总是 `activeReplay` 显式选择（手机端 batch selector 以 bottom-sheet 呈现）。登录门禁：**整个 Replay Workspace 全部要求登录**——未登录进入任意 replay capability（data / ai / playback）自动跳 Keycloak/OIDC，登录成功后按 redirectUri 回原 capability，不再有「data 匿名解析」；`awaitAuthGate` 先等 Keycloak init 完成再判断 authenticated（auth init race safe，SSO/session 用户不被无谓 `kc.login()` 打断），确认未登录时仅 login 一次。AI 与 Playback 完全业务解耦（仅共享 replay/source/processing dataset，不做 `AI@seek → Playback` 的时间点联动 / 跨 capability 状态 handoff）。Android 外部 replay 改为**完整自动解析**：Native `shouldInterceptRequest` 以 app-owned content:// 安全 URI serve 缓存文件字节 + Web `fetch(pending.uri)` 构造 `File` → 替换 selection → 自动 `startProcessingJob` exactly once（READY 后 data tab 展示结果，绝不自动启动 AI，失败走现有 Processing error/retry）；不再依赖 synthetic input.click()；`consumePendingWhenReady` 只在登录态就绪后消费，`getPendingReplay()==null` 不清零 eligible（warm resume 后 Native 新增 pending 仍可消费，exactly-once 针对单个 pending，不是 composable lifetime），Native `pendingReplayEligible` 保证 Native 端 exactly-once，`window.wotbtoolsOnReplay` 读实际登录态、不以 authenticated=true 默认绕过。删除旧 `ReplayCapabilityPage / AiReviewPage / BattlePlaybackPage` 路由组件及 `replayHandoff` 内存交接（原三套独立页面 / 各自上传器一并下线）。验证：frontend `npm test`（1289 green）+ `npm run build` 通过。

- **Android Launcher 正式品牌图标（前端资产）**：`ic_launcher_foreground` 由「下载箭头 placeholder」替换为 WotBTools 品牌 mark（tank + 柱状图），生成 adaptive-icon foreground（透明背景、content 落在 66% safe zone）与 legacy `ic_launcher` / `ic_launcher_round` 全密度 PNG（品牌深色背景 `#0D1117`，圆角裁切），不再出现白底方块。App 内（WebView）隐藏「下载 Android 版」CTA（App.vue 顶栏 / 用户菜单、HomePage hero / quick-panel，复用 `isAndroidApp()`）。
- **Android Release 一键发布入口（CI/CD）**：`android-release.yml` 从 committed
  `android/gradle.properties` 读取版本，保留 `workflow_dispatch`、main push 与
  `android-v*` tag push 入口，
  两条入口合并为同一套 `Resolve release metadata / fail-fast guards / 发布协议`。新增
  fail-closed + 幂等 guard：版本格式（每段 `0` 或非零开头整数，拒绝 `1.0.02`/`01.0.2`；
  `minor`/`patch` 0..999 且 versionCode 在 `1..2_100_000_000`）、发布源固定 `main` HEAD、
  preflight 幂等分类（生产最新 > 本次 → 回滚拒绝；== 且 metadata 一致 → 进入既有发布核验
  —— apkUrl 可达、APK 非空、实际 SHA == version.json.sha256、dispatch 下 tag 指向
  expected commit，全部一致才 already-published no-op 成功，缺失/不匹配/冲突一律 fail-closed；
  == 但不一致 → 拒绝；< 本次 → 发布）、`minSupportedVersionCode` 校验、
  `git ls-remote` 真实 ref 的 release tag 幂等（不存在 → 创建；指向本次 commit → 复用；
  指向其它 commit → 拒绝 repoint）、生产同版本 APK 幂等（不存在 → 上传；SHA 相同 → 复用；
  SHA 不同 → immutable 冲突拒绝）、`apksigner --print-certs` 签名证书 SHA-256 与
  `ANDROID_SIGNING_CERT_SHA256` Variable 固定比对、生产 APK HTTP 200 + 非空 + SHA 比对、
  生产 `version.json` jq 内容比对、`$GITHUB_STEP_SUMMARY` 汇总。
  权限 `contents: read` → `contents: write`（最小必要）。
  新增 `scripts/android-release/`（`resolve-version.sh` / `check-release-guards.sh` /
  `test-release.sh`，纯逻辑无 secret），并在 `ci.yml` 加 `android-release-helpers` job
  （`bash -n` + 版本/守卫单测，不跑真实 release、不用 production signing secret）。
  `version.json` schema、nginx 路由、compose bind-mount、Gradle 签名契约、发布目录
  `/opt/wotb/android-release`、`version.json` LAST 发布顺序均不变。验证：workflow YAML
  解析、helper 单测（合法/非法版本、versionCode 公式、monotonic/minSupported/tag/APK 守卫、
  bash -n）全部通过；真实 production signing/publish 由 merge 后首次 release 权威验证。

- **Android 在线纯客户端（Thin Client）初版**：新增 `android/` 最小 Kotlin 壳（Remote Web Architecture，WebView 加载 `https://wotbtools.com`）、网络/版本门禁（fail-closed）、APK 强制/可选更新、Replay 意图入口（ACTION_SEND/ACTION_VIEW → content URI → 现有 Web upload transport）、极薄 Native Bridge（能力探测 + pending replay 交接）、FileProvider 与未知来源授权。发布走 `.github/workflows/android-release.yml`（tag `android-v*`），APK + `version.json` 静态托管于 `/download/android/`（nginx location + compose bind-mount `/opt/wotb/android-release`）。前端新增 `?view=android` 下载页与「下载 Android 版」入口。Web 端只做 Web 之外的系统能力；回放业务展示（AI Review / 战局重建 / capability 状态）沿用现有 Vue，不在 Native 重写（待 V2 contract 定稿后共用同一套 capability/domain API）。验证：frontend `npm test` + `npm run build` 通过；Android 编译/签名/真机验证在 CI tag 与真机侧进行。

- **Battle Playback V2 — Canonical Replay Truth Convergence（后端 decoder → canonical facts → BattleTimeline → V2 稀疏投影）**：把战局重建从「decoder events → Playback/AI 各自重新解释 → frontend 再推理」收敛为「版本门禁解码 → canonical facts/lifecycles → BattleTimeline → thin projection」。本轮在已有 PR162 canonical Timeline 基础上新增：
  - **P0-1 Type5 combat loadout**：`VehicleBattleLoadout`（3 consumable + 3 provision + 9 equipment，byte=ID 编码），挂到 `MaterializationEvent.loadout`；unknown provision wireCode 保持 `logicalItemId=null`+raw，非 9-equipment family fail-closed；version/class 门禁（仅 `entityTypeId==2` + lifecycle-affirmed 版本）。
  - **P0-2 Type32 通用 auxiliary-blob envelope**：`EntityAuxiliaryBlobDecoder`（`entityId+flag+bodyLength+body`，校验 `bodyLength==payload.length-9`，malformed fail-closed + 诊断）＋ `ConsumableLifecycleEvent`（仅 `TYPE32_CONSUMABLE_LIFECYCLE VERIFIED` + VEHICLE + flag0 + 16B 组合才解码）；新增 `TYPE32_CONSUMABLE_LIFECYCLE` version capability（11.19 证明，11.18/future fail-closed）。
  - **Canonical facts 层**：`VehicleLoadoutFacts`（loadout 持久配置，离开 AoI 仍 KNOWN）／`ConsumableLifecycle`（runtime AoI scoped，hidden interval=UNKNOWN）／`VehicleModuleCrewLifecycle`（method16 recorder-visible provenance）。
  - **FrameHealth 简化**：统一 `currentHp` 权威；去掉 `baseHp/effectiveMaxHp` 业务语义；新增 `HealthKnowledge(CURRENT/LAST_KNOWN/UNKNOWN)` 与 presentation-only `displayCapacityHp`（anti-future-leak，只取 ≤t 观测）；`FrameOrientation` 新增 `OrientationKnowledge` + age（敌方离开 AoI → CURRENT→LAST_KNOWN）。
  - **V2 `BattlePlaybackDataset`**：稀疏 transition tracks（positionSegments/orientationSegments/healthTransitions/lifeTransitions/consumableTransitions/moduleCrewTransitions/loadout/shots/pointsSamples），每条带 knowledge/provenance/observation boundary；`BattlePlaybackProjector` 纯投影（不重扫 raw/不自构 HP/AoI/death/direction truth）。
  - **接入生产**：`battle-playback-v2.json` artifact（仅 timeline 可用时写出）＋ `/api/replay/battle-playback-v2` dataset endpoint（204=timeline 不可用）。
  - **前端守卫迁移**：`battlePlaybackV2.js` 查询工具（`inspectVehicleAt`/`healthAt`/`lifeAt`/`positionCoveredAtV2`/`orientationKnownAt`/`consumableRuntimeAt`/`moduleCrewAt`）＋ `V2VehicleInspector.vue`（AC-4/5/6/7）；`BattlePlaybackPanel`/`MapOverview`/`BattlePlayback` 透传 `playbackV2`，timeline 不可用时回退 legacy `MapOverview.Playback`（守卫期，短迁移 commit）。
  - 验证：wotb-core 全量 1318 green；wotb-web 相关单测 50 green；前端全量 1235 green + `npm run build` green。
### Changed
- **League Rating V5 雷达改为平均75 / 满分150分段映射**：V5 页面与 Rating Profile PNG 不再使用 V2 的 `2×平均=100 / 4×=125 / 8×=150` 对数相对标尺；每轴在 `0..average` 线性映射到 `0..75`，在 `average..max` 线性映射到 `75..150`，其中 `max` 继续取后端 `resp.league.columns[].max` 权威满分，100 对应 `average + (max-average)/3`。缺 player/reference/max、非有限值、`average<=0`、`average>=max` 或 player 超满分时 fail-closed，不回退旧公式。V2 保持原相对映射；V4.1/V5 Rating、Evidence Adjustment、权重、排序、API raw、Excel 与数据库均不变。
- **Deploy workflow 去重测试优化（CI/CD）**：将「代码质量验证」与「生产部署验证」彻底分离——`deploy.yml` 移除与 PR CI 完全重复的 `test-backend`（`mvn test`）与 `test-frontend`（`npm ci` / `npm test` / `npm run build`）job；`changes` job 收敛为仅计算 `sha-<short>` tag（删去只服务于测试门禁的路径过滤与 backend/frontend 输出），三镜像（backend/frontend/keycloak）仍于每次 main push 确定性构建并推送 GHCR。生产部署验证（compose 渲染校验、`require_env` secret 校验、`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100` 契约、health check / rollback / diagnostics）全部保留。PR CI 测试覆盖未削弱。验证：workflow `actionlint` 静态检查全绿。
- **Testing & CI Fast Feedback 重排（Agent 验证策略）**：把「Agent 每次提交/review 后跑 repository-level full test」改为「Fast Feedback First」分层验证——Agent 默认只跑 targeted / module / feature regression；仓库级 full validation 统一由 PR CI 执行（唯一 authoritative full-test gate）；新增 Full-test 例外清单（用户显式要求 / 改 Maven parent/dependencyManagement/plugin / Node-Vite-Vitest 全局配置 / 跨模块公共 contract / architecture rules / test infra / build infra 无法定位 / CI 不可用需高置信度或 affected scope 无法确定），并要求触发 full 前先声明 Affected scope / Selected validation / Why。同步 `docs/DEVELOPER_GUIDE.md` 与 `java/README.md`；Deploy 延用 PR173（不含测试套件）。PR CI 测试覆盖未削弱。验证：全仓 `rg` 复查无残留 full-test 默认触发、workflow YAML 解析通过。
- **Rating V2 / League V5 雷达分数明细与缩放基础**：两套雷达共用规则 75 参考环、0–150 坐标空间、顶点分数徽标、分数/原始值切换与 50%–150% 页面缩放；V2 桌面抽屉扩大至 560px，V5 Rating Profile PNG 与页面复用同一 geometry/score-label 定位且不消费缩放状态。两套 Radar 的业务映射由各自 scaler 决定（V2 相对标尺；V5 bounded 标尺见本节最新条目），V2/V4.1/V5 Rating 公式、API、排序与 Excel 均不变。
- **Rating V2 雷达改为右侧选手抽屉**：隐藏管理员灰度页不再把六轴雷达追加到长结果表底部；点击玩家昵称后通过 `Teleport` 打开固定右侧抽屉，桌面/平板保持非模态并可继续点击表格切换玩家，移动端使用遮罩面板。补齐 Esc 关闭、触发按钮焦点回收与 reduced-motion；V2 公式/API、共享雷达几何及 League V5 页面不变。
- **Battle Playback V2 UI 收尾（前端全 V2-only + 删除 Playback 影子层）**：前端 `BattlePlayback.vue` 的
  marker / HP HUD / Details Panel / team HP / 事件 feed 全部消费 canonical V2 事实（`healthAt` /
  `lifeAt` / `healthDisplayAt` / `teamHealthAt` / `positionAtV2` / `orientationAtV2`），不再回退 legacy
  `MapOverview.Playback`。backend 删除 Playback 影子层（`MapOverview.Playback/PlaybackVehicle/
  PlaybackEvent/HpSample/DirectionSample/PositionInterval/HpLoss/FinalStats` + `buildPlayback` +
  `BattlePlaybackAdapter` + `AoiPositionCoverage`）；`BattlePlaybackDataset` 增加 battle-level
  `events`（DAMAGE/KILL/DESTROYED/POSITION）。`FileUploader` 对 AI 复盘/战局重建禁 folder（单文件）。
  HP marker 百分比改用 canonical `displayCapacityHp`（presentation-only，anti-future-leak），
  UNKNOWN 不再冒充满血；`LAST_KNOWN` hidden interval 冻结、不跨 AoI 更新。队伍总血量仅在
  全队 denominator/current 均可证时显示真实分数（存在未知 / LAST_KNOWN 车辆降级为 PARTIAL，
  不再以 partial capacity 冒充全队总 HP）；Details Panel 合并为单一 canonical V2 面板，
  移除与 V2 检查器重复的 HP / State / 车型展示。

### Fixed
- **Android Release 首发签名失败（P0）**：修复 `app/build.gradle.kts` 中 `release` 签名 `keyAlias` 被外层同名局部变量遮蔽，导致 Gradle 报 `SigningConfig "release" is missing required property "keyAlias"` 的问题——外层变量更名 `signingKeyAlias`，`keyAlias = signingKeyAlias` 明确赋给 DSL property（签名参数协议 `wotbKeystorePath/wotbKeystoreStorePass/wotbKeyAlias/wotbKeyPass` 不变）；并在 `.github/workflows/android-release.yml` 的 Gradle build 前新增 signing fail-fast 校验（`ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD` 非空 → `printf '%s'` 解码 Base64 → 解码后 keystore 非空 → `keytool -list` 以配置 store password 命中配置 alias），全程不打印 secret。验证：workflow YAML 解析通过、校验步骤 bash 语法与分支逻辑正确（`bash -n`/`bash -x`）；Gradle 编译与真实签名由 merge 后 release CI 权威验证。仅限 Android release/signing 链路，不涉业务功能、不引入新 key、不透出 keystore/口令。
- **雷达缩放移动端宽度与七轴徽标碰撞修复**：移除缩放工具栏中冗余的可见标题（保留 group/input/button 完整 aria-label），避免约 375px 手机抽屉或俄文长标签把页面横向撑开；顶部徽标改由共享批量布局同时避让刻度与相邻两轴，覆盖七轴 `38 / 74` 混合分数回归。V2/V5 页面与 V5 Rating Profile PNG 继续共用同一徽标坐标，评分、缩放范围、明细与导出尺寸不变。
- **Rating V2 移动端雷达抽屉焦点约束**：移动端以 `aria-modal=true` 打开雷达遮罩时，Tab / Shift+Tab 现在在抽屉可聚焦元素内循环，无法落到遮罩后的结果表；Escape 关闭与触发昵称焦点回收保持不变。桌面/平板非模态抽屉仍允许正常离开侧栏继续操作表格。
- **回放解析预览按钮回归修复（P0）**：回放解析页选择文件后，「解析预览」按钮此前被 `showWorkspaceActions=false` 连带隐藏，导致无法启动解析任务（选完文件无任何操作入口）。现将解析按钮拆到独立的 `showPreview` 开关（默认开启），`showWorkspaceActions` 只控制 AI 复盘/战局回放快捷入口；`RatingV2AdminPage`/`ReplayCapabilityPage` 显式关闭预览以保持原有行为。
- **管理员 Rating V2 结果表字段对齐修复**：表头现在复用 API 列元数据的 `num` 标记，数值表头与数值单元格统一右对齐，玩家/战队等文本列保持左对齐；新增 DOM 回归测试锁定表头与数据行使用同一对齐分类。列顺序、排序、数据与评分公式不变。
- **Flyway 迁移不可变 + 部署失败诊断（Production Deploy Hotfix）**：修复 `main` 上已执行 Flyway V18 因文档注释漂移（`docs/current-plan.md` 误写回）导致的启动/健康检查失败风险。将 V18 恢复为 Git history 证明的 authoritative exact blob（`7e11d427` 的 `a7941f0d2…`，Flyway CRC32 `3353739529`），V1–V21 无其它 drift。
  - **永久 policy**：`java/AGENTS.md` 明确既有 `V*.sql` 为 immutable historical artifact——禁止修改/重命名/删除/格式化/改注释/改换行/编码；schema 只能新增更高版本 forward-only `V<N>__*.sql`；仅当 Git history 证明生产已执行且发生 checksum drift 时才允许恢复 exact deployed blob。
  - **CI guard**：新增 `deploy/check-flyway-immutability.sh`（`git diff --name-status --find-renames` 检测 M/D/R；既有 migration 一律失败，仅放行一次用户批准的 V18 blob-pair `212635eb…→a7941f0d…`；A 仅要求版本号高于 base 最大版本）。`deploy-smoke` 以 `fetch-depth:0` 传入 PR base SHA，并运行 `deploy/test-flyway-immutability.sh` fixture。
  - **部署失败诊断**：`deploy/deploy.sh` 新增 `report_health_status`（backend/frontend/keycloak 各 PASS/FAILED/SKIPPED），健康检查最终 timeout 先输出各服务状态，再于 rollback 前 `dump_logs`（`ps -a`、容器 inspect、三服务 logs）；所有诊断命令独立容错，不阻断 rollback。
  验证：`bash -n`、immutability fixture、deploy rollback smoke、CI workflow 静态检查。
- **Replay capability navigation refactor**：回放解析、AI 复盘与战局重建现在是三个独立入口；具体战斗通过内存 `processingJobId + sourceId` 复用同一解析数据集，避免按文件名或重复任务定位。旧 `?view=reconstruction` 书签兼容跳转到战局重建入口。
- **AI 复盘裸抛 DATASET_UNAVAILABLE 修复（Dataset 状态机 Hotfix，PR #164）——Dataset lifecycle 收敛为唯一事实源**：AI 复盘此前仅凭 `file != null` 就启用「AI 战术复盘」按钮，而 `processingJobId`/`sourceId`（authoritative Dataset 引用）由 `requestDirectAction` 异步补齐，准备期点击即被 `analyzeBody` 裸抛 `DATASET_UNAVAILABLE`。本轮收尾：
  - **Dataset 状态机**：`file && processingJobId && sourceId` 齐备才允许 Analyze（`datasetReady` 硬 guard）；未 READY 时显示「正在准备回放数据…」并禁用按钮；`PREPARING`/`FAILURE` 与 AI 模型错误明确区分；`runAnalyze`/`analyzeBody` 不再把 Dataset 未就绪当作最终用户错误。
  - **Dataset 过期恢复（exactly-once + generation-owned）**：`JOB_NOT_FOUND` 是唯一可自动恢复的过期信号（`isRecoverableDatasetCode` 收窄）。面板 emit `dataset-recover` → 页面失效引用并重建 p2；每个 selection / dataset generation 最多自动恢复一次，recovery in-flight 时重复事件合并/忽略；第二次 `JOB_NOT_FOUND` 经 `invalidateExpiredProcessingDataset` 做 authoritative 失效（清 `processingJobId`/`processingJob` snapshot、保留 `resp`）后结束为本地化 FAILURE；stale recovery `finally` 不清新 generation 的 recovery 状态。
  - **Dataset 双轨移除**：删除 legacy `?view=reconstruction`（`?view=replay` canonicalize）与 `ReconstructionPage`/`ReplayInputPanel`；AI Review / Battle Playback / Export 全部复用 `useReplay`/`requestDirectAction` 的同一 Dataset orchestration。
  - **共享 Dataset**：同一 replay selection 的 Parse / AI / 战局回放 / Export 共享同一 Processing Job（single-flight），绝无 multipart AI/Playback 回退。
  - **错误码本地化**：`DATASET_UNAVAILABLE`/`JOB_NOT_FOUND`/`SOURCE_NOT_READY`/`SOURCE_NOT_FOUND`/`DATASET_REFERENCE_REQUIRED` 全部经 `localizeAiError` 本地化，绝不裸展示。
  - **Backend**：`ReplayProcessingJobStore` 为 `@Component`（production 必注入；`AiReplayReviewService` 单构造器 mandatory 依赖，缺 bean 时 Spring fail-fast）；新增 `AiReplayReviewServiceWiringTest`；移除测试便利构造器与 unreachable `processingStore == null` 分支；删除无证明力的 `DefaultReplayProcessingFacade` mock/verify。验证：frontend full test suite / build / backend tests passed。
- **Replay 版本作用域 / 权威收敛 + 平行 parser 清除（PR162 deep review · P0/P1 全清）**：
  ① **method1 版本 provenance**：HP raw 分类改在 decoder/evidence 边界一次完成并随 `VehicleHealthStateEvent.rawState` 传播（0xFFFE 仅在 `verifiedFffeTerminalAllowed` 时成 VERIFIED_TERMINAL_FFFE），`ReplayHpTimeline`/`ReplayTerminalLifecycle`/`BattleStateReconstructor` 不再 `HpRawState.classify(raw,true)`；method1 cause 语义仅 current version family 证明（11.18 保留 raw causeFlag / semantic UNKNOWN）。
  ② **BattleStateReconstructor 收敛**：删除 `VehicleState` 由 `DamageEvent.raw` 累计的 `damageDealt/damageReceived` 及其 add/get/copy plumbing；PARTIAL `PositionChangedEvent` 不再把 `ObservationState` 升为 OBSERVED；AoI/terminal/HP 分别由 `ReplayAoiLifecycle`/`ReplayTerminalLifecycle`/`ReplayHpTimeline` 唯一 authority。
  ③ **EntityMethod 完整版本门禁**：subtype 8/47/48（damage/updateArena/updateArena2）对未知/未来版本 raw-preserve，绝不产出 current-version semantic event（DamageEvent/ParticipantMappingEvent/SupremacyPointsChangedEvent）。
  ④ **Type14 = stream close（非 battle end）**：`BattleEndDecoder` 恒产出 `ReplayStreamClosedEvent`（packet stream 关闭/停止 marker），不推导 winner / finish reason / battle start；battle-start clock 只用 raw framing 时间 + proven 结算 duration。
  ⑤ **清除 main-source 平行 parser**：`EventStreamReader`/`ReplayEventExtractors`/`ReplayPacketParser` 移入 test-probe 范围（研究/逆向工具），生产解析只经 `ReplayPacketStreamReader`(framing/header) + `ReplayPacketDecoderRegistry`(canonical decoder)；`ReplayParser` 仅内联读 header 的 clientVersion（避免 parse↔replay 包级循环）。
  ⑥ **Type33/Type4 shape 收紧**：仅精确命中已证明 shape（Type33=12B all-zero zeroTail；Type4=4B）才 EXACT，其余 raw-preserve。
  ⑦ **RatingV2 HP 分母**：恒为静态 tankopedia baseline（绝不切到 replay actual entryHp）。
  ⑧ **FormationDepthEvidence/RelativeDepthHpEvidence entity provenance**：改为 per-entity `PositionSample(entityId,t,x,z)`，被测 AoI segment 只消费同 entity 样本（多实体/重入生命周期不混坐标）。
  测试：`EntityMethodDecoderVersionGateTest`/`BattleEndDecoderRawPreserveTest`/`MaterializationDecoderTest`(shape)/`FormationDepthEvidenceTest`(re-entry)/`RatingV2CalculatorTest`；wotb-core 全量 1267 绿 + wotb-web 受影响测试绿（Mockito 需 CI javaagent）。
- **Replay AoI 唯一 authority + death provenance source-aware（PR162 deep review blockers）**：
  ① **AoI 唯一 authority**：`ReplayAoiLifecycle` 成为 AoI observed/hidden 唯一 authority——`BattleTimelineBuilder`（frame vehicle 用 `segmentAt(entityId, t)` 判 CURRENT/LAST_KNOWN，删除 `POSITION_GAP_SEC`/5s packet-age 推断）、`BattlePlaybackAdapter`/`MapOverviewBuilder`（共享 `AoiPositionCoverage`，区间 = AoI observed segment ∩ 实际位置存在 ∩ death/duration clamp，同一 open segment 内静止 >5s 无 Type10 不再产生 POSITION_STALE）、`FormationDepthEvidence`/`RelativeDepthHpEvidence`（`resolvePhasePosition` 先定位 phaseEnd 的 segment，只用该 segment ∩ phase 的样本计算 CURRENT 参考，禁止跨 UNKNOWN_AOI gap 混坐标；gap 内 fail-closed，不产出 CURRENT exact geometry）。
  ② **死亡 provenance source-aware**：`LeagueRatingConflictDetector` 改用 `DeathEvidence`（LIVE_EXACT > SETTLEMENT_SECOND > UNKNOWN），reconcile 不再跨 source `Math::min`（LIVE_EXACT 128.50 不被 settlement 128.00 覆盖）；`LeagueRatingValidator`/`BattlePhaseSummary` 改用 canonical `PlayerResultFormat.deathSec`；UNKNOWN source 的 residual `survivalTimeSec`/`deathTimeMillis` 永不成 KNOWN；`RatingV2Calculator.tradedDeath` 也用 canonical deathSec。
  ③ **Team AoI convergence**：`DefaultTeamBattleFeatureExtractor` 从 `ReplayAoiLifecycle` 获取 Type4 边界，不再从 raw `EntityRemovedEvent` 重建第二套事实推导。
  ④ **raw 字段保真**：reconcile 到 LIVE_EXACT 时保留结算原始证据 `field24 lifeTime`（`settlementLifeTimeSec`），
     不把 live-derived canonical fact 写回原始字段——11.19 corpus <b>无 #104</b>，`deathTimeMillis` 是派生兼容值。
  测试：`LeagueDeathProvenanceContractTest`（source-aware reconcile + 死亡时间保真）、`BattleTimelineBuilderTest`/`MapOverviewBuilderPositionIntervalsTest`（AoI 回归）、`FormationDepthEvidenceTest`（phase 跨 gap 不混坐标 + gap 不产出 CURRENT）、`RatingV2CalculatorTest`（UNKNOWN residual 不升级）；wotb-core 全量 + wotb-web replay/ai 受影响测试全绿。
- **Keycloak 登录主题 UX Hotfix（品牌收敛 / 主题切换图标 / 深色毛玻璃）**：`docker/keycloak/themes/wotbtools/login` 修改——① 左上角品牌 Logo 固定显示高度 desktop 36px、mobile(≤767)/tablet-portrait 28px（PNG 白底来自图片本身，保留 256px/37KB 优化版，不裁切、不换源、不加容器背景/padding）；② 右上角主题切换按钮由单色圆点改为 CSS 绘制的 Sun+Moon 双图标（当前主题态高亮、另一态置灰），补齐 light `:focus-visible`，aria/title 与持久化逻辑不变，mobile(≤767) 实际点击区域经 `::after` 扩至 ≥40px（视觉保持 44×26）；③ 深色 Battlefield 登录卡由透明 prism 改为局部毛玻璃：`rgba(8,12,16,0.34)` + `backdrop-filter: blur(10px) saturate(120%)`，仅 `html[data-theme="dark"] .wbtb-card`（token `--auth-card-*`），light 保持 prism 无 blur 零回归，深色 `.wbtb-shell__auth::before` veil 强度随之下调（0.20/0.09 → 0.12/0.05）避免双重黑化；同步移除无消费的 `--auth-prism-alpha` token。文档同步 `docs/auth/keycloak-login-theme.md` / `DEVELOPER_GUIDE.md`；仅重建 keycloak 镜像，不动 realm/OIDC/IdP/flow/主站前端。
- **Keycloak 登录主题 V8 生产润色（Hotfix）**：`docker/keycloak/themes/wotbtools/login` 三处小修——① topbar 品牌改为复用主站官方 Logo（`common/assets/wotbtoolslogo.png` 打包至 `resources/img/`，删除主题内临时橙色 CSS mark 与 `--auth-logo` token）；② 撤销登录页 i18n：删除 `registrationLayout` 内 locale 选择器与 `theme.js` locale 绑定、主题自创文案（theme toggle aria/tooltip）改中文硬编码、精简 `messages_*.properties` 仅保留 `identity-provider-login-label`；③ 深色（Battlefield）登录区新增局部可读性：`.wbtb-shell__auth::before` 软径向 dark veil（无 `backdrop-filter`/`filter: blur`、无硬矩形/左右分区）+ 提升 input/eye/IdP/divider 对比（dark-only token/选择器）。Light 零回归；仅重建 keycloak 镜像，不动 realm/OIDC/IdP。
- **回放结果页列选择器被表格遮挡修复**：`ReplayPage` 解析结果工具栏的列选择器（`.colpanel`，`position:fixed; z-index:260`）此前被 `.restoolbar` 的 `backdrop-filter` 层叠上下文锁住，其 z-index 只在 `.restoolbar` 内部生效；结果表容器 `.tablewrap` 同样因 `backdrop-filter` 成为 stacking context 且 DOM 中晚于工具栏，按同层 DOM 顺序后绘制规则盖住列选择器。已将 `ReplayPage.vue` 的 `<ColumnPicker>` 用 `<Teleport to="body">` 包裹，使其脱离 `.restoolbar` 层叠上下文/包含块，回归视口定位与 root stacking context，列选择器稳定浮于结果表之上（普通/League 模式、桌面/平板/移动端共用）；列勾选/全选/重置/拖拽排序与「完成」行为不变。`ReplayPage.test.js` / `ReplayPageReadyFlow.test.js` 回归，前端全量测试与构建通过。
- **Classic Profile 回放解析进度面板 / 任务卡 / 部分按钮残留深色表面修复**：`ReplayProcessingPanel`（`.rpp-*`）与 `ReplayTaskCard`（`.etc-*`）在 scoped `<style>` 写死 showcase 深色（面板底 `rgba(13,18,22,.94)`、进度条 track `#2b3439`、fill `#4c8dff`、按钮描边 `#465159`+浅字），`classic-profile.css` 无对应覆盖，导致 Classic 下进度面板/任务卡仍深色；另命中 `BoostPage .pager button`（`#151d21` 深底）、`ProfilePage .btn-ghost:hover/:disabled` 与通知行（`#172025` 深 hover）、`ContactPage .copy-btn`（`rgba(20,26,30,.9)` 深底）。已在 `styles/classic-profile.css` 补 `html[data-ui-profile="classic"]` namespace 覆盖：面板/任务卡落 `var(--bg-card)`+`var(--border)`、文字走 `var(--text-*)`/`var(--status-*)`、进度条 track `var(--border)`、fill 与主按钮用 `var(--accent)`、其余按钮浅底深字；Classic 下进度面板/任务卡/相关按钮全部落浅色，Showcase（默认）零回归。`classic-profile-css.test.js` 同步 selector→declaration 绑定回归。
- **雷达图恢复最外围 100% 边界线**：`PlayerRatingRadar` 最外围网格层引用 `--border-light-strong`，但该 token 从未定义（无效变量引用令 `stroke: none`，导致 100% 边界在 show/classic 等主题下均不可见）；已在 `tokens.css`/`showcase.css`/`classic-profile.css` 三处按主题补齐该 token（视觉强于内部 `--border-light` 网格、弱于玩家数据线），最外围 polygon 恢复完整闭合可见。
- **Classic Profile 名人堂公开页残留深色表面（PR #151 收尾）**：`styles/classic-profile.css` 补 `html[data-ui-profile="classic"] .lb-wrap` 的提交记录行、排行榜普通行基础背景/行分隔线、百场/三环 pending 状态卡、下载按钮、分页按钮与错误态覆盖（`var(--...)` + `!important`），清除 Classic 下 HoF 仍残留的 Showcase 深灰/黑块（如 `tbody` 深色行、提交记录区深底）；Showcase（默认）零回归；`classic-profile-css.test.js` 同步 selector→declaration 绑定回归（单场/百场/三环共用表面）。
- **名人堂管理（HoF Admin）Classic 浅色残留（Blocker 4）**：`showcase-rankings.css` 仍对 `.hof-admin .hof-admin-denied p`（无权限提示段落）与 `.hof-admin .hof-admin-login`（登录态）写死 `#9aa09c`、对 `.hof-admin-table td` 写死行分隔线 `#263136`；main 的 `classic-profile.css` 用 `.denied/.login` 选择器与真实类 `.hof-admin-denied/.hof-admin-login` 失配（未命中）。已补 `html[data-ui-profile="classic"]` 覆盖：把 `.denied/.login` 修正为真实类、`.hof-admin-denied p` 用 `var(--text-sub)`、`.hof-admin-table td` 用 `var(--border-light)`，修复 Classic 下无权限/登录态与行分隔线偏深/低对比；Showcase（默认）零回归。

### Added
- **管理员历史 Rating V2 雷达画像**：隐藏的 `?view=rating-v2` 结果表现在可选择玩家查看 V2 六轴雷达，
  复用 `PlayerRatingRadar` 的四层 25/50/75/100 网格、玩家实线与批次平均虚线；六轴固定为场均潜在伤害、
  KAST、Impact、场均协助、多伤率、场均击杀。`RatingV2Calculator` 将评分所用的封顶指数作为只读 `radar`
  投影追加到既有 admin 响应，前端不从圆整表格值或百分数字符串反算公式；V2 总分、权重、排序、READY dataset
  只读边界、公开接口、Excel、League V5 雷达均不变。新增 core/API/前端回归测试，文档同步
  `docs/features/rating-v2.md`。
- **Keycloak 登录页 V8 Unified Theme（全新统一主题）**：为 WotBTools Keycloak（26.6.4）新增自定义主题 `docker/keycloak/themes/wotbtools/login`，深色=Battlefield（全屏战火背景，`login-battlefield.webp`/`-mobile.webp` 本地打包）、浅色=Minimal；仅覆盖 `template.ftl` 统一 auth shell（全页背景/brand/右上 theme toggle/hero/透明棱镜登录卡/footer），其余认证页经 Keycloak 26 的 `registrationLayout` 宏共享，最小 FTL override；登录卡为 **clear transparent prism，无任何 blur**（CSS 无 `backdrop-filter`/`filter: blur`）；IdP 按 `social.providers` 动态渲染于账号密码下方；realm 设 `registrationAllowed:false` + `loginTheme:"wotbtools"`；`Dockerfile.keycloak` 将主题打包进镜像；资源全部本地打包（禁 GitHub raw/CDN）。生产 realm 为 Admin Console 手工配置，需手动同步 `registrationAllowed=false` 与 `loginTheme=wotbtools`（见 `docs/auth/keycloak-login-theme.md`）。
- **选手详情侧栏桌面端自由 resize**：`PlayerDetailDrawer` 在桌面(>=1200px)侧栏左缘新增 resize handle（视觉 2px 线、12px hit 区、`cursor: col-resize`），pointer capture 连续拖动；min 320px / 默认 380px / max ≈45% 视口动态钳制；宽度经 `localStorage["radarSidePanelWidth"]` 持久化，恢复时与窗口缩放时按当前视口重新 clamp（存过大值自适应）；键盘 ←/→ 每次 20px；tablet(<1200)/mobile 保持原有行为无 handle。
- **Classic Profile 真浅色主题（Theme 计划）**：`useUiProfile` 现在把 profile 唯一派生到 `data-theme`（showcase→dark, classic→light），首屏内联脚本同步设置 `data-ui-profile` + `data-theme`（无 FOUC）；`styles/classic-profile.css` 由「仅去 AI 背景」升级为「完整浅色语义 token + namespace 覆盖」（`html[data-ui-profile="classic"]` 提供浅色 bg/card/text/border/accent/status/rating/tactical/scroll/shadow + `color-scheme:light`；同步 `--showcase-tactical*`；覆盖 topbar/user-menu/表单/表格 sticky/管理表/restoolbar 等写死深色面）；Showcase（默认）零回归；`data-theme` 不另立主题状态/开关/第二 localStorage key（禁 `useTheme`）。
- **选手详情侧栏非模态修复**：`PlayerDetailDrawer` 桌面/平板 backdrop 改 `pointer-events:none`（click-through）并移除 `aria-modal="true"`，移动端(<768px)经 `pd-modal` 恢复 modal veil+点击关闭；Grid 行 `select-player` 直达 `selectedPlayerContext`，Drawer 内容切换/表格高亮/左右箭头与导出快照同步。
- **双 UI Profile（Classic/Showcase）运行时与 CSS 门控**（纯前端）:
  - 新增 `src/composables/useUiProfile.js`：唯一状态源（reactive ref + `localStorage["wotb-ui-profile"]` 持久化 + `<html data-ui-profile>` 投影），非法值统一回退 `showcase`；`setUiProfile`/`toggleUiProfile` O(1) 切换，不 reload/remount。
  - `frontend/index.html` 首屏防 FOUC：默认 `data-ui-profile="showcase"` + 内联脚本按存储恢复 `classic`（与 `data-theme="dark"` 并存）。
  - `App.vue` 用户菜单新增「界面风格」分段控件（简约/沉浸，`aria-pressed`），登录/未登录均可用。
  - 新增 `src/styles/classic-profile.css`（main.js 最后导入）：按 `[data-ui-profile="classic"]` namespace 关闭全屏 AI 路景背景（`::after`/`::before content:none`）与装饰性 hero/uploadcard surface；Showcase（默认）零回归，无 `!important` 泛滥、无 specificity 堆叠。
  - i18n：`feature-messages.json` 新增 zh/en/ru `uiProfile.*`。
  - 测试：`useUiProfile.test.js` + `classic-profile-css.test.js`（§43A/B/D CSS source contract）；前端全量测试与 build 通过。
  - 说明：Classic 只去 AI/装饰背景与视觉噪音（视觉皮肤），结构/密度/布局与 Showcase 完全一致；完整 `@layer` 三层重排留作后续低风险优化。
- **选手 Rating 画像新增「最常使用坦克」**（后端 + 前端 + 导出）：
  - Core：`PlayerLeagueSummary` 新增 `vehicleUsage`（`List<PlayerVehicleUsage>`，tankId + battles），
    `LeagueRatingBatchAggregator` 在 rated-only 循环中按 accountId 关联 `PlayerResult.tankId` 累计；
    新增不可变模型 `com.wotb.core.league.PlayerVehicleUsage`；Core 不复制 Tankopedia。
  - Web：`LeaguePlayerSummaryDto` 新增可空 `mostUsedVehicle`（`LeagueVehicleUsageDto`：tankId/tankName/battles）；
    `Mapper` 消费现有 `Tankopedia` 单一事实源选择最常使用坦克（场次降序 → 官方名忽略大小写升序 →
    tankId 升序；无可靠名称返回 null），`Mapper.selectMostUsedVehicle` 提炼为 package-private 纯函数。
  - 前端：`ReplayPage.drawerPlayer` 透传 `mostUsedVehicle`/`ratedBattles`（Summary）与
    `tankId`/`tankName`（Battle）；`PlayerDetailDrawer` 在 Rating 区与雷达之间渲染坦克展示区——
    Summary 显示最常使用（贴图/名称/场次/比例 `battles/ratedBattles`），Battle 显示本场坦克；贴图经
    `vehicle-portraits/runtime.js` 按 tankId 懒加载，token 防旧异步覆盖；缺图/非 Tier X 文字降级
    （不破图、不影响雷达）；导出画像 PNG 等待图片或确认失败后包含坦克区，缺图不阻塞。
  - i18n：zh/en/ru 新增 `league.drawer.most_used_vehicle` / `battle_vehicle` / `vehicle_battles` /
    `vehicle_usage_rate`。
  - 测试：`LeagueRatingBatchAggregatorTest`（rated-only 累计、ineligible 排除）、`ReplayMapperTest`
    （场次降序/名称忽略大小写/名称相同 tankId 升序/无名称 null）、`PlayerDetailDrawer.test.js`
    （Summary/Battle 显示、比例、无数据隐藏、缺图文字降级、token 防闪回）、`ReplayPage.test.js`
    （Summary 透传 mostUsedVehicle/ratedBattles、Battle 透传 tank_id/tank_name）。
  - 文档：`docs/features/league-rating.md` 新增「最常使用坦克」节；功能不参与 Rating / 七维 /
    MVP / Team Rating 计算，不改 Excel 列/宽表。
- **Player Detail Drawer Rating Profile 升级（纯前端，零后端改动）**：
  - Radar 只保留 League Rating 七维（移除 contribution/kast 作为 Radar 轴，归 Performance Metrics）；
    新增 Battle/Global Average 参考多边形（新 `frontend/src/utils/radarReference.js` 纯函数：selected
    玩家必含、accountId 去重等权、恒定 cohort 跨维（§25）、按 accountId 排序保证确定性、V5 隔离）。
  - 几何抽到 `frontend/src/utils/radarGeometry.js`（组件 + 导出共用，§48）；4 层网格 25/50/75/100 +
    单侧刻度（§17-18）；轴标签仅维度名、不印数值（§19）；三列 detail（Dimension/Player/avg，
    score/max 无百分比、无差值列，§20-21）。
  - 缺维契约（§24/§67）：player 缺任一所选维 → 整图 unavailable；reference cohort 不完整 →
    reference 不可用（不制造假闭合多边形）。
  - Header scope（§6/§7）：单场 = V4.1；批次 = V5 Rating + Observed Median + Rated Battles（次级）。
  - 导航（§28-32）：表格 `select-player` 提供当前可见顺序（order），ReplayPage prev/next 跟随表格
    排序、边界禁用、scope 不跨界；键盘 ←/→/Esc（避开输入控件）。
  - 动画（§34-40）：Drawer 关闭 slide-out（先出屏再卸载）、player 切换方向两段式、rapid-safe
    （Vue Transition 中断）、`prefers-reduced-motion` 关闭。
  - 导出（§41-48）：Drawer 内「导出画像 PNG」——专用 offscreen 卡片（非截 Drawer），复用
    radarGeometry，实色 token 规避 color-mix 在 html2canvas 的兼容问题；单场 V4.1 + Battle Avg、
    批次 V5 + Median + Battles + Global Avg。
  - 旧 Radar 偏好含 contribution/kast/impact 被静默过滤（§66），无迁移代码、无双路径；i18n
    zh/en/ru 新增 `radar_labels`/`radar_lbl` 与 `league.drawer.*` 文案。
  - 测试：`radarReference.test.js`（+`radarMetrics.test.js` 更新）、`PlayerRatingRadar.test.js`、
    `PlayerDetailDrawer.test.js`、`BattleTable.test.js`；`npm test`（1199）与 `npm run build` 通过。
- **League Rating V5 Batch Evidence Adjustment（后端 + 前端 + 导出）**：
  - 新增纯 domain `LeagueBatchPlayerRatingCalculator`（无 Spring/DB/IO）：`E(n)=1-exp(-n/6)`、
    Anchor=450、单边调整（raw≤450 完全不加分）、0–1000 clamp、`n<=0`/非有限 raw fail closed；
    常量 `V5_EVIDENCE_ANCHOR` / `EVIDENCE_TIME_CONSTANT` 单一事实源。
  - `LeagueRatingBatchAggregator` 保留 Raw Batch Median，主 Rating 走 Evidence Adjustment；
    七维 median/mean 与 Team Rating 硬边界不动。
  - API contract 迁移（一次性收口，无双语义）：`LeaguePlayerSummaryDto` 由 `ratingMedian`
    拆为 `ratingV5`（主 Rating）+ `ratingRawMedian`（Raw Observed Median）；列契约新增
    `league_rating_raw_median`（`LeagueColumns.RATING_RAW_MEDIAN`，默认可隐藏）。
  - Excel 批量选手汇总：主列「总Rating」= V5，新增「原始中位数」；单场明细仍 V4.1。
  - 前端：统一玩家表主 Rating=V5 + Observed Median 列（可隐藏）；Drawer summary 显示
    Observed Median；三语 i18n（zh/en/ru）。
  - 测试：纯函数（Evidence/Anchor/产品案例/低分不加分/clamp/数值安全）、聚合器
    （V5 主 Rating、Team/七维不动、轮换 n、顺序不变性、批次无关性）、Excel scope；
    全量 `mvn -s settings.xml test` + `npm test` + `npm run build` 通过。
- **League Rating V5 算法说明入口（前端）**：新增 `?view=rating-docs` 页面，构建期以
  `?raw` 将 `docs/WotBTools_League_Rating_V5.md`（canonical 单一事实源）纳入独立 chunk，
  复用 `MarkdownContent.vue` 渲染；ReplayPage 结果工具栏在 League 模式显示「算法说明」按钮，
  经 App.vue 注入的 `navigate` 跳转；ReplayPage 加入 KeepAlive，返回时保留解析结果与当前 tab。
  三语 i18n（zh/en/ru）走 `feature-messages.json`，无第二份人工正文副本。生产构建链路同步：
  `docker/Dockerfile.frontend` COPY 文档到镜像、`.dockerignore` 显式放行该 md、
  `deploy.yml` 变更过滤纳入 `docs/WotBTools_League_Rating_V5.md`（文档更新即触发前端重建）。
- **ArchUnit 架构测试 + 存量架构违规重构**：
  - `wotb-core` / `wotb-web` 引入 `com.tngtech.archunit:archunit-junit5`（test scope，版本 parent 统一管理），
    新增 `CoreArchitectureTest` / `WebArchitectureTest`，随 `mvn test` 自动执行（CI 零改动）。
  - core 消除 8 处顶层包循环：`model.PlayerResult.entryHpSource` 的 `EntryHpSource` 移入 `com.wotb.core.model`
    （model 不再反向依赖 replay）；`com.wotb.core.processing` 并入 `com.wotb.core.replay.processing`
    （统一门面与视角解析归属 replay 流水线）。
  - web 消除 3 处域循环：新增共享包 `com.wotb.web.replayfile`（`ReplayHashLock` /
    `HallOfFameReplayStorage` / `HallOfFameStorageException` / `ReplayDownload` / `ReplayFileNames.originalName`），
    跨域引用计数改为 DIP 接口（`HofReplayReferenceCounter` / `HundredReplayReferenceCounter`，
    HoF/Hundred 各数各域，删除时由 hof admin 汇总）；`KeycloakAdminUserService` 下沉 `config`；
    `GlobalExceptionHandler` 移入 `com.wotb.web.exceptionhandler`；`GET /api/users/profile/records`
    handler 移入 hof 域（路径与响应不变，前端零改动）。
  - 行为不变：以上均为包移动/依赖方向调整，全量测试回归兜底；文档同步
    `DEVELOPER_GUIDE.md` / `java/AGENTS.md` / `java/README.md`。
- **管理员历史 Rating V2 灰度核验**：恢复删除前最终 V2 公式（潜在伤害、KAST、Impact、贡献率、
  多伤率与综合 Rating），但隔离为 `RatingV2Calculator` 与 `POST /api/admin/rating-v2/processing-jobs/{jobId}`。
  只允许 `wotbtools-admin` 访问，页面仅有隐藏 `?view=rating-v2` 深链且异步拆包；计算只读现有 READY
  `ProcessedDataset`，不新建 full processing、不写回 `Battle` / `PlayerResult`，也不恢复公开 `/api/rating`、
  `/extended`、`rating.json`、评分列、Excel 或 League/Performance 算法；后续迭代以独立
  `docs/features/rating-v2.md` 算法规格为维护基线。
- **League Rating V4.1 算法迁移**：七维满分由 400/100/100/150/50/100/100 精确调整为
  365/110/110/180/50/75/110（总分 1000 不变）；射击效率由 pure Wilson 迁移为
  Soft Wilson（`0.9×Wilson95%下界 + 0.1×raw`，命中 30% / 击穿 70% 合成）；存活/互换 RC
  改为「胜方存活 75 / directional trade 50 / 其它 0」，彻底删除 `LOSER_TOP4`
  （`STATE_LOSER_TOP4`、loser top4 集合/排序/相关测试与文档）；`TradeFacts` 由 symmetric
  ±10s 迁移为 directional `[0, +5s]`（`TRADE_AFTER_DEATH_WINDOW_SEC = 5.0`，共享事实源
  自动同步 League RC / Performance KAST / traded_deaths）；败方存活恒 0（回归测试锁定，
  永久防止 LOSER_TOP4 回归）。DIM_WEIGHTS / Normalization / Exchange / Team Rating /
  batch median / winner ×1.05 保持不动。文档 `league-rating.md`、`performance.md` 同步。
- **Replay Processing Pipeline V2**：回放处理链重构为「一次上传 → 一次 full process →
  多消费者复用」：
  - 全局 `ReplayParseScheduler`（默认并发 2，`REPLAY_PARSE_MAX_CONCURRENT`；job-aware
    公平轮转 + queued cancellation + 有界 pending，满载 503 `PROCESSING_QUEUE_FULL`）；
  - source-level 模型：`sourceId/sourceIndex`、per-source 状态、`activeSources[]`、
    `parseCompleted/parseSucceeded/parseFailed` 真实进度与 `FINALIZING_BATCH` phase；
  - 内存重构：`ParsedEntry` 不再持有 `Source`/`byte[]`（batch 聚合阶段原始字节可 GC）；
  - Derived Artifacts：worker 内构建 `derived/{sourceId}/ai-facts.json` 与
    `map-overview.json`（临时文件 + atomic move，先写后 READY）；
  - AI 复盘 / 战局回放 Dataset 路径：`/api/replay/analyze` 与
    `/api/replay/map-overview` 新增 JSON 引用（`processingJobId + sourceId`），读取
    cached artifact，不再重新上传 / 重新 full process；支持
    `prioritySourceIndex` 直接进入能力（目标 replay 优先解析）；
  - Dataset Lease：`acquireForSource/release` 通用引用计数，读取期间 TTL 不清；
  - artifact executor 拆分：Excel/ZIP 构建并发独立配置
    `REPLAY_ARTIFACT_MAX_CONCURRENT`（默认 1）；
  - observability：`wotb_replay_parse_active` /
    `wotb_replay_parse_queue_depth` / `wotb_replay_processing_jobs_active` /
    `wotb_replay_processing_jobs_queued` / `wotb_replay_full_processing_total` /
    `wotb_replay_dataset_cache_hits|misses_total`（低基数）。
  - **scheduler 线程安全收口**：`ReplayParseScheduler` 全部调度状态（slot 预留 /
    jobs / per-job pending / ready 成员资格 / queuedSources / activeForJob / 派发 /
    cancellation）统一由单一协调锁串行化；每 job 在 round-robin 队列至多出现一次，
    executor 内不形成 scheduler 未知的第二层 backlog（reserved+running ≤
    `REPLAY_PARSE_MAX_CONCURRENT` 恒成立）；业务 runner / onStart / onComplete 均在锁外执行。
  - **parse 进度原子化**：`ReplayProcessingJob` 自持 parse outcome
    （`recordParseSuccess` / `recordParseFailure`），同一 synchronized transition 内推进
    completed/succeeded/failed，对外快照恒满足 `parseCompleted == parseSucceeded +
    parseFailed` 且三计数单调不减；service 不再用 `AtomicInteger[]` 拼 snapshot。
  - **失败必须产生 ParsedEntry**：任何已注册 source 处理失败（输入读取 / artifact
    写入 / 解析异常）都会写入 authoritative failed `ParsedEntry`；finalize 前校验非
    CANCELLED job 每个 sourceIndex 都有 terminal entry，缺失视为内部 invariant violation
    （FAILED + `PROCESSING_JOB_INTERNAL_INVARIANT`），绝不静默过滤 null。
  - **前端 upload preflight**：共享 `validateReplaySelection`（`.wotbreplay` /
    ≤100 文件 / 单文件 ≤20 MiB / 总量 ≤200 MiB），选择文件 / 文件夹 / add / drag-drop
    统一走同一 contract；非法候选不进入 active selection、不发起 Processing Job，
    一次展示全部 offending 文件与具体大小，chip 显示「文件名 · 大小」。
  - **multipart transport 错误码**：`MaxUploadSizeExceededException` 按结构化 cause
    chain 区分单 part（`FILE_TOO_LARGE`）与 request 总量（`TOTAL_REQUEST_TOO_LARGE`），
    无法结构区分时回退通用 `UPLOAD_TOO_LARGE`；HTTP 恒 413，不 parse exception message。
  - **PROCESSING 取消竞态修复**：`cancelQueued` 改为显式
    `CancellationResult`（NO_COMPLETION_PENDING / ACTIVE_COMPLETION_PENDING）；
    scheduler 明确不再触发 onComplete 时（QUEUED 或 PROCESSING），service 先把 job
    推进 CANCELLED 终态再记录 terminal observability——杜绝「PROCESSING 永久卡死」；
    新增确定性竞态回归测试（completion 记账后、pump 派发前 cancel）。
  - **legacy 同步 full-processing 端点关闭**：`/api/preview`、`/api/export`、
    `/api/replay/analyze` multipart、`/api/replay/map-overview` multipart、
    `/api/replay/reconstruct-batch`、`/api/replay/process` 一律稳定 410
    `REPLAY_LEGACY_DEPRECATED`；Export Job 强制 `processingJobId`（裸上传 410）。
    删除 ReplayService / AiReplayReviewService / MapOverviewQueryService /
    ReplayExportJobService 中的独立 full processing 死代码——ReplayParseScheduler
    是 Replay Processing 产品域唯一 CPU budget authority，ReplayCapacityLimiter
    仅保留给 HoF/Mark3/百场 submission 校验域。
  - **folder 选择先过滤 .wotbreplay**：FileUploader 的文件夹 / add-folder /
    drag-drop 先筛出回放再与现有 selection 合并（.DS_Store / png / txt 等辅助文件
    不计入 100 上限与 200 MiB 总量、不导致整批失败）；整次选择无回放时明确提示
    「未找到 .wotbreplay」；count/total 提示带实际值（当前 N 个 / 当前批次 X MB）。
  - **Workspace Dataset 竞态归属修复（第四轮）**：ReplayPage 的
    `ensureDatasetFor` 引入 workspace dataset generation + target fileKey 校验——
    A/B 快速切换时 A 的迟到 `requestDirectAction` 响应（成功或失败）一律丢弃，绝不把
    `datasetRef` 绑回已切走的回放（data correctness，不再依赖清空 watcher 阻止回写）。
    AiReviewPanel 的 request ownership 绑定 file + `processingJobId` + `sourceId`
    三者：Dataset identity 在途变化时旧分析 abort / 迟到 SSE 结果与错误不得写回、
    stale finally 不得覆盖新 generation 的 loading。BattlePlaybackPanel 改为单一
    effective identity（file + dataset）watcher：identity 变化真正 reset（abort +
    清空已加载 map + 解除 mapLoaded 阻塞）并自动加载新 Dataset，同时消除
    file/dataset 双 watcher 的重复请求。
  - **ReconstructionPage selection lifecycle + owned Job 取消（第四轮）**：引入
    selection generation（select/replace/remove/clear 自增）；createProcessingJob
    返回后校验 revision + fileKey，stale job 立即 best-effort cancel 且不绑定；
    poll 绑定 revision + jobId，迟到响应不写状态；remove/clear/teardown 对页面自己
    create 的非终态 Processing Job best-effort cancel（不影响 ReplayPage 共享 batch
    job）；确定性测试覆盖 A→B 乱序 / clear during create / remove active / 快速 A/B/C。
  - **Dataset Lease 与 TTL 清理原子化（第四轮）**：`ReplayProcessingJobStore` 的
    acquire（source/export）/ release / sweepExpired / removeAndCleanup 统一在同一
    `lifecycleLock` 上线性化——acquire 先成功则 sweeper 必然看见 lease 而跳过，
    sweep/remove 先移除注册则 acquire 必然失败；物理磁盘删除在锁外执行；引用计数
    更名 `datasetLeaseRefs`（AI/Playback/Export 共享语义）；新增确定性并发测试
    （acquire wins / sweep wins / 多 lease / underflow / 压力 invariant）。
  - **Processing create single-flight（第五轮）**：`useReplay` 引入
    `processingStart`（{revision, promise, controller, prioritySourceIndex,
    onColumnsInit}）作为当前 selection 的唯一 in-flight create owner——同一
    selectionRevision 下 startProcessingJob / 任意数量 Direct Action（AI/Playback/
    manual Parse）共享同一个 `api.createProcessingJob` Promise（backend 至多一个
    Processing Job），priority 由第一个发起者决定，绝不用「abort 旧 create + 新建」
    切换 priority（abort XHR ≠ 后端事务回滚）。selection 变化时 abort 并 null owner，
    stale create 迟到 resolve 一律 best-effort cancel 且不绑定 / 不 poll / 不写
    upload/loading/error；uploadState / poll interval 均经 owner 校验，一个 job 至多
    一个主 poll interval。
  - **AI analysis per-run context（第五轮）**：`AiReviewPanel` 每次 runAnalyze 创建
    独立 run context（revision / controller / correlationId / startedAt /
    timeoutTimer / cancelRequested / timedOut），`activeRun` 作为唯一 ownership——
    旧 A 的 finally 只清自己的 timer、timeout callback closure-capture A 的
    correlationId、SSE 事件按 `activeRun === run` 守卫写回；Dataset identity 切换只
    cancel oldRun，绝不可能清掉 B 的 timer 或 cancel B 的请求。
  - **Processing ownership lifecycle 完成（终审）**：UPLOADING 允许 abort（server 未
    接受，无 orphan）；REGISTERING（multipart 已上传完）禁止 abort 丢 jobId——标记
    cancelRequested 保留 create owner/request，202 返回后 best-effort
    cancelProcessingJob(created.jobId) 且不绑定 / 不 poll / 不暴露成 Dataset；
    REGISTERING cancel 后旧 create settle 前禁止新建 p2（single-flight 保持）。
    ReplayPage/unmount 时 owned QUEUED/PROCESSING job best-effort cancel、REGISTERING
    create 标记取消等 jobId（绝不 orphan）、READY dataset 不 cancel；source-ready
    poll 注册 timer+abort，selection change / cancel / teardown 全部终止。
  - **poll/result 完整 async ownership（终审）**：主 poll 捕获 jobId + selectionRevision，
    STALE RESPONSE = ZERO SHARED STATE WRITES（不再写 loading）；READY result 迟到
    resolve 同样 pure discard；startProcessingJob catch 校验 revision 后才写错误。
  - **authoritative Dataset reuse（终审）**：READY 后普通 Preview 复用现有
    result/dataset（不重新 create/upload/parse，api.createProcessingJob 计数不变）；
    Direct Action 的 GET processingJobId 只允许稳定 404/JOB_NOT_FOUND 时 invalidate +
    重建 replacement，transient（network/5xx/timeout/auth/malformed）一律传播且不
    重新 full-process。
  - **Dataset REST 4xx 契约（终审）**：AI/Map JSON Dataset reference 缺失/空 → 400
    `DATASET_REFERENCE_REQUIRED`、非法 sourceId → 400 `SOURCE_NOT_FOUND`、job 不存在/
    过期 → 404 `JOB_NOT_FOUND`、source 未 READY → 409 `SOURCE_NOT_READY`；null 引用
    不再进入 store 查找 NPE → 500（map-overview 同步 HTTP 全量落实；AI SSE 端点同码
    经 worker 稳定 error 事件传达）。
  - **scheduler cancel/complete 竞态测试语义修正（终审）**：`cancelAndCompletionRaceIsConsistent`
    补齐第三种交错（cancel 在 target 已完整执行后被移除后到达 → NO_COMPLETION_PENDING
    且 onComplete 已触发），断言与 scheduler「onComplete 未来不再触发」契约一致
    （CI #719 曾因此误判失败）。
  - **source poll cancellation exactly-once settle（终审收尾）**：
    `pollSourceReady` 全部 terminal path 收敛到 `resolveOnce`/`rejectOnce`
    （settled 标志 + timer/abort registry 同步释放）——GET pending 或 750ms
    timer 等待期间 abort（selection change / cancel / dismiss / teardown）立即以
    `SOURCE_POLL_CANCELLED` reject，迟到 response 一律 pure discard，绝不永久
    pending / 双 settle；`getProcessingJob` 不支持 AbortSignal，故不强制改 API
    client，取消语义由外层 Promise 自洽保证；ReplayPage `ensureDatasetFor` 把本地
    source poll 取消视为 AbortError 同级，不写入 processingError（不显示成用户
    业务错误）。
- **名人堂三环（Mark 3）人工审核排行榜**：新增独立 `mark3` domain、Flyway `V21` submission/evidence 表和 `/api/hof/mark3`、`/api/users/mark3`、`/api/admin/hof/mark3` API。仅限 Tier X，玩家提交三环所需场数、过程场均、过程胜率、1–2 张截图与恰好 5 个回放；无 Wargaming 自动认证链路。创建路径从五个 replay byte[] 读取、解析、hash 锁、落盘到事务全程复用全局 `ReplayCapacityLimiter`，容量满返回 503 `REPLAY_BUSY`。排行榜按已审核三环场数升序，场数相同使用 competition ranking；同用户同车的 CURRENT 唯一且不被后续申请替代，不使用 `SUPERSEDED`。REJECTED/CANCELLED/DELETED 可重提；管理员通过、拒绝或删除时均不能改写成绩，终态会清理截图和回放证据。

### Fixed
- **统一图片 data URL 上传链路**：新增无业务文案的前端 `ImageDataUploader`，替换百场、三环和陪练申请中重复的 `FileReader` 实现；统一校验图片 MIME、4 MiB 上限和最终 `data:image/` 值，读取失败或非图片 data URL 在浏览器侧拒绝，不再把无效值提交给后端。临时关闭百场/三环弹窗、在 MANUAL/WG 间切换或切换陪练页内部 Tab 时保留正在读取的截图，回到原表单后继续写入同一页草稿；仅用户重选、移除、清空草稿、成功提交 reset 或整页卸载会作废过期回调。三环的总图片数与已有图片去重在 FileReader 前门禁，超限时零读取；不改 API 或后端存储契约。
- **百场管理员审核摘要改用认证数值**：`GET /api/admin/hof/hundred/submissions` 只返回 `certifiedAverageDamage` 和 `certifiedBattleCount`；WG 官方认证映射冻结的官方快照，人工审核映射已通过数值。申报值继续仅在详情接口保留。
- **Replay「下载为 PNG」导出回归修复（html2canvas 无法解析 color(srgb)）**：真实根因是 Chrome 在 computed-value 阶段把 `color-mix()` 计算为 CSS Color 4 的 `color(...)` 函数，而 html2canvas 1.4.1 的 `SUPPORTED_COLOR_FUNCTIONS` 仅支持 hsl/hsla/rgb/rgba，导出克隆中表格单元格（战队行、sticky、selected）保留的 `color-mix()` 背景因此抛 "unsupported color function" 导致整张 PNG 失败。本次在 `.replay-export-root` 导出域内把战队行/表头/空态背景强制为实色 `var(--exp-*)`（`!important`），并新增 `prepareReplayExportClone()` 剔除 `.selected`、把 `.sticky-col` 置 static、禁用 `animation/transition/filter/backdrop-filter`，生成确定性静态快照；正常页面 CSS/视觉不变，仅导出克隆改变。新增 ReplayPage PNG DOM 回归测试（sticky/selected/export-safe CSS 覆盖）。

### Changed
- **League Rating：canonical 收口升级为 group-level all-pairs（上传顺序无关，UNKNOWN 不是 wildcard）**：
  - `LeagueRatingConflictDetector` 新增 `validateAndReconcile(List<Battle>)`：对同 arenaId 全部副本做
    **全对一致性**检查（不再以 first copy 作 anchor）——`[UNKNOWN, KNOWN100, KNOWN128]` 因
    KNOWN100 vs KNOWN128 超 1s 容差而必须 conflict，与上传顺序无关；全部一致才做确定性 canonical
    收口（UNKNOWN+KNOWN → KNOWN、KNOWN+KNOWN → 最小 KNOWN、全部 UNKNOWN → UNKNOWN(0)）。
  - **INVALID 死亡时间 fail-closed**：`survivalTimeSec < 0` / NaN / Infinity 与**任何**值（含
    UNKNOWN 0）都 conflict；canonicalizer 删除「无 KNOWN 就归零」分支——INVALID 绝不洗成 UNKNOWN。
  - **hard-conflict 字段扩展**：`settlementAccountsCoveredByRoster` /
    `settlementRosterTeamConsistent`（决定 ROSTER_INCOMPLETE）、`durationS`（影响死亡时间
    beyond-duration 判定）、`nHitsReceived` / `nPenetrationsReceived` / `nEnemiesDamaged`
    （validator 非法值检查）、`clan`（影响 team autoName / teamKey / batch summary identity）
    不一致即 conflict；代码注释明确 hard-conflict vs evidence-reconciliation 分类。
  - 回归测试：三副本 6 排列全部 conflict / 全部 not-conflict + canonical 一致；每个上传顺序测试
    使用全新 Battle 实例（canonicalization 原地 mutate，禁止复用已收口对象）。
- **互换击杀窗口迁移为 directional 0..+5s（V4.1，取代早期 ±10s symmetric 决策）**：
  `TradeFacts.TRADE_AFTER_DEATH_WINDOW_SEC = 5.0`，玩家死亡 ≤ 敌方死亡 ≤ 玩家死亡+5s
  （边界包含，敌方早于玩家死亡不计）；League Survival/Trade、Performance KAST、
  tradedDeaths 共享同一事实源自动同步。duplicate 死亡时间证据容差仍为 1s，两参数明确独立。
- **原始射击比例语义修正（UI 真实百分比）**：`hit_rate = hits/shots`、
  `pen_rate = penetrations/hits`（分母是命中次数，不是射击次数；单场 `Columns.STAT` 与跨场
  `Agg`/`AggregateColumns` 单一事实源同步）。denominator == 0 → null（API null / Excel 空单元格 /
  UI "--"，禁止 0/0 伪装 0%）；numerator == 0 且 denominator > 0 → 合法 0%。跨场基于总量
  sum(pens)/sum(hits)，不是各场平均。**UI raw rate ≠ Rating shooting**：League Rating 射击维度
  内部为 Soft Wilson（90% Wilson 95% 置信下界 + 10% raw rate，30% 命中 / 70% 击穿），
  未因 UI 显示真实百分比而改纯裸比例。
- **全局移除 Potential Damage / 潜在伤害指标**（用户正式决策，非仅 League）：
  - 删除 `PotentialDamage` 计算类、`PlayerResult.potentialDamage*` 字段、
    `Columns.PLAYER` / `AggregateColumns` / `Agg` / `PerformanceMetricsCalculator.Row`
    的 potential 系列（含 avg），`AggregateSheets` 不再输出 总潜在伤害/场均潜在伤害/
    场均补增伤害；
  - Preview / Processing Job / 同步与异步 Export（aggregate / each / single /
    from-result 全部路径）不再执行 `PotentialDamage.apply`——runtime enrichment = 0；
  - Standard / League 单场与汇总 XLSX、mode=each（含 Rating-ineligible Standard
    fallback）、API column metadata、前端三语 locale / tables / ColumnPicker 全部不再
    出现 potential_damage 系列；
  - 保留的独立职责：`killVictims` 击杀前伤害明细（killer attribution 证据链，
    AI 复盘「谁杀谁」消费）拆分为 `KillVictim` model，与已删除的潜在伤害指标无关；
  - schema absence regression 锁定旧字段不得重新进入 API/export。
- **Player Radar 数据语义收口（Summary mean / Battle 单场分离）**：
  - `PlayerLeagueSummary` 新增 `dimensionMeans`（七维算术平均，rated-only 分母；
    UNKNOWN death-time 场是合法 rated sample，Survival/Trade 真实 0 参与平均；
    Rating-ineligible 场不进入分母）；`dimensionMedians` 保留给 Table/Excel
    「典型比赛得分」契约，两者语义严格分离。
  - Summary Radar 七维正式 = `dimensionMeans`（当前批次平均能力画像）；
    Battle Radar 七维正式 = 本场 `dimensionScores`（当前单场 `league_*_score`），
    `ReplayPage` 不再用 `dimensionMedians` 命名承载单场数据。
  - `LeagueRatingBatchAggregator` 新增 `chunkMeans`（独立测试锁定七维交错 stride，
    残缺样本 fail fast——missing 不得冒充真实 0）。
  - 回归测试：158布丁 型稀疏 Assist（[0,0,0,0,100,100] → median 0 / mean 33.33）
    锁定 Radar 显示 mean；Summary/Battle scope 各自断言 raw/normalized。
- **League Rating：死亡时间 UNKNOWN 不再整场拒绝评分**：
  - `LeagueRatingValidator` 删除 battle-level `MISSING_DEATH_TIME` gate：阵亡玩家
    `survivalTimeSec == 0` 定义为合法 UNKNOWN（不产生 failure，整场照常评分）；
    `<0` / NaN / Infinity / 超过战斗时长+tolerance 仍为 `INVALID_STAT_FACTS`
    （beyond-duration 检查限定有限值，避免与 stat-facts 重复计数）。
  - `LeagueFailure.Code.MISSING_DEATH_TIME` 全链路删除（core 常量 / Excel 失败标签 /
    前端三语 i18n / 测试 / 文档）。
  - 新增非阻断 `ratingQuality.unknownDeathTimePlayers`（core `LeagueRatingBatch` →
    `LeagueRatingDto` → preview 响应）；该兼容槽不驱动前端 quality warning
    （可评分 X/X 不变、不计入「未生成 Rating」）。
  - 回归保护：`TradeFacts` 对 `survivalTimeSec <= 0` fail-closed 语义不变（新增
    `unknownDeathTimeDoesNotInferTrade` 等单测）；`DeathTimeReconciler` correctness
    contract（PR #100 IS-4 128.12s / later-alive-refutes-legacy / 0xFFFE 等）零改动、全绿。
  - 真实回放验证：3 个此前失败的 arena（`8963319361188400` / `1161438972003065843` /
    `1161440170298931846`）validator PASS + 生成 Rating，5 名 UNKNOWN 玩家
    `survivalState=NONE` / `survivalTradeScore=0`；本地 23 场批次 23/23 rated、0 failure。
- **League Rating：同 arenaId 多份回放的死亡时间确定性 canonical 收口**：
  - `LeagueRatingConflictDetector.sameDeathTime` 语义修正：`survivalTimeSec == 0` = UNKNOWN
    （evidence absence）与任何值兼容（UNKNOWN+UNKNOWN / UNKNOWN+KNOWN 都不是 conflict）；
    两个 KNOWN 超过 1s 容差 / 生死状态不同 / 负数/非有限死亡时间仍是冲突。
  - 新增 `reconcileDeathTimes`（与上传顺序无关）：UNKNOWN+KNOWN → KNOWN、
    KNOWN+KNOWN → 最小 KNOWN、全部 UNKNOWN → UNKNOWN(0)；`LeagueReplays` 在一致副本
    去重时对保留 battle 执行收口——进入 Validator/Calculator/汇总/`ratingQuality` 的是
    deterministic canonical battle，上传顺序不改变 Rating（`ratingQuality` 只统计
    canonical battle 中的 UNKNOWN 实例，不因 duplicates 重复计数）。
  - 新增回归：ConflictDetector 单测（UNKNOWN/UNKNOWN、UNKNOWN/KNOWN、KNOWN 容差内外、
    survived mismatch、非法值冲突、reconcile 单元）与 `LeagueReplays` 集成测试
    （UNKNOWN+KNOWN 双顺序 finalRating 一致、UNKNOWN+UNKNOWN quality=1、
    KNOWN+KNOWN 容差内 canonical min / 容差外 conflict）。
- **Replay Export Job：processingJobId reuse 不再 500（HTTP contract 收口）**：
  - 生产根因：`ReplayExportJobController.create` 强制 `consumes=multipart/form-data`，
    而 Processing result reuse 是合法 bodyless POST（`useReplay.startExportJob` 在
    无战队名称覆盖时 `body=null`）→ `HttpMediaTypeNotSupportedException` 落入 generic
    handler → `INTERNAL_ERROR` 500。修复：移除强制 consumes，POST 同时支持
    multipart 上传 / bodyless processingJobId reuse / multipart teamNames reuse，
    client contract == controller contract == service contract。
  - `GlobalExceptionHandler` 补 `HttpMediaTypeNotSupportedException → 415` 与
    `HttpRequestMethodNotSupportedException → 405`（framework client 错误不再是 500）。
  - `runJobFromResult` 失败日志补结构化上下文（mode / reuse / processing job status /
    parsed / rated / duplicates / league failures），异常保留 stack trace。
  - 新增 `ReplayExportJobControllerContractTest`（bodyless reuse 202 / multipart 202 /
    reuse+teamNames 202）、前端 `api-export-job.test.js` bodyless reuse 回归、
    `ReplayExportJobServiceTest` partial-rated / UNKNOWN-death / 0-rated League aggregate
    export 集成测试（全部 READY + XLSX 合法）。
- **CW Rating UI 架构与导出契约收口**：
  - **leagueMode 单一事实源**：前端页面级 CW 模式只消费 `resp.leagueMode === true`（后端
    显式标记），删除 `!!resp.league` 兼容回退与 `isLeagueColumns()` 列内容推断
    （helpers.js 删除 helper）；useColumns 显式接收 leagueMode ref；初始 tab 决策
    （chooseInitialResultTab）同步改用 leagueMode。
  - **Radar 满分单一来源**：删除 radarMetrics.js 硬编码的 `LEAGUE_DIM_MAXES`
    （400/100/...），League 维度归一化改为消费后端 `resp.league.columns`（key/max）
    metadata——缺失满分 → 该轴 "--"；新增 radarMetrics 单测（max=400 → max=500 自动跟随）。
  - **导出语义区分（XLSX 全量 / PNG 当前视图）**：PNG 不再强制导出全量列——改为所见即所得
    （当前 ColumnPicker 可见列 + 顺序 + 当前排序），删除旧「PNG 完整超宽表格」contract
    与 `utils/leagueExportTable.js`（含单测）；XLSX 保持完整数据、与前端偏好解耦。
  - **一级 Workspace 导航脱离 .tabs**：ReplayPage DOM 移除 `.workspace-tabs` 上的
    `.tabs` class，`.workspace-tabs` 成为独立按钮式一级能力导航（按钮自带 border/radius/
    背景，active 不改变尺寸）；AI Review 由 `.ai-review-panel` 成为唯一 width owner
    （Action/Error/Streaming/Result 同宽），`AnalysisResultPanel` 不再自行决定页面宽度，
    header 收口为单行 toolbar（`top: var(--topbar-h)`，移除 52px 硬编码与负 margin）。
  - **league-rating.md 与代码逐字对齐**：preliminary = 六个非存活维度之和（伤害/助攻/击杀/
    换血/阻挡/射击），base = preliminary + survival；混合批次各导出语义按真实代码描述；
    清理 "后续 Excel 导出" 等过期措辞与过期计划引用。
  - **死代码/过期 API/过期测试清理**：BattleTable 删除未使用 `round1`、未解构
