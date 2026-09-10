# 名人堂（Hall of Fame / Зал славы）

> MVP 只记录录像者本人单场伤害成绩；schema 由 Flyway 管理。实现见 `wotb-web/.../hof/`。

名人堂只接受**随机战斗（RANDOM）**与**评级战斗（RATING）**回放；训练房 / 联赛 / 锦标赛 / 娱乐 / 未知模式一律拒绝（上传 → HTTP 400 `UNSUPPORTED_BATTLE_TYPE`，零持久化）。Replay 文件是 authoritative source：`.wotbreplay` → `ReplayParser` → authoritative battle facts → battle-type policy → 名人堂；**禁止人工修改 replay-derived authoritative facts**（admin 是 governance，不是数据编辑器）。

- **数据库配置**：`application.yml` 始终启用 DataSource/JPA/Flyway，`ddl-auto: validate`；本地开发需提供 PostgreSQL 与 `POSTGRES_PASSWORD`。
- **Schema 来源**：Flyway 迁移 `V1__init_leaderboard.sql` → `V15__add_leaderboard_replay_file.sql`（历史 immutable），`V16__rename_leaderboard_to_hall_of_fame.sql`（表/约束/索引 rename-in-place + battle_type/arena_bonus_type + backfill），`V17__create_hall_of_fame_admin_log.sql`（admin 审计表），`V18`–`V20`（百场申请、回放证据、WG 审核快照）、`V21__create_mark3_submission.sql`（三环申请与回放证据）以及 `V22__hof_ownership_by_wotb_account.sql`（百场/三环 ownership 由 Keycloak 身份切换为 **WotB 游戏账号 + 区服**：`game_account_id_snapshot` → `wotb_account_id`、新增 `wotb_server` 快照列、删除 `user_keycloak_id`、唯一索引与查询索引改按 `(wotb_server, wotb_account_id)`；迁移内含 fail-fast preflight，不做任何自动消解，详见下文「V22 迁移契约」）。**改表结构必须新增迁移**，不要改已应用的版本；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
- **战斗模式数据模型**：`hall_of_fame_record` 同时保存 `battle_type varchar(16) NOT NULL`（业务归一值 `RANDOM`/`RATING`，CHECK 约束，非 PG ENUM）与 `arena_bonus_type integer NOT NULL`（replay 解析出的 authoritative raw integer，protocol provenance / 调试 / 未来扩展）。历史数据 backfill 为 `RANDOM/1`（旧系统 PR #97 前只允许 Random；PR #97 起允许 Rating，历史行无法逐行推导，统一按 `RANDOM/1`，带 replay_hash 的行未来可重解析修正）。
- **支持的战斗模式**：判断集中在 `HallOfFameBattleTypePolicy`（`HallOfFameBattleType` 单一事实源，禁止散落两处漂移）。证据等级明确区分「本项目真实回放证据」与「外部 replay tooling 证据」：

  | 模式 | raw arenaBonusType | 归一值 | 证据 | 名人堂 |
  |---|---|---|---|---|
  | 随机战（Random） | 1 | RANDOM | WotBTools 真实回放（`common/fixtures/replays/random-battle-example.wotbreplay`，meta.json arenaBonusType=1 实解）+ 外部映射 | ✅ |
  | 评级战（Rating） | 7 | RATING | Jylpah/blitz-tools `analyze_wotb_replays.py` `BattleCategorizationList._battle_modes`（established external tooling evidence，`"Rating": 7` 无不确定性注释，与 1/2/4/8 真实样本映射一致） | ✅ |
  | 训练房 | 2 | UNSUPPORTED | WotBTools 真实夹具（`common/fixtures/hall-of-fame/training-room-example.wotbreplay` 等） | ❌ |
  | 联赛/锦标赛 supremacy | 4 | UNSUPPORTED | WotBTools 真实样本（`common/data` 20260808 Maus 等） | ❌ |
  | Mad Games | 8 | UNSUPPORTED | 外部映射 | ❌ |
  | 未知/其他 | — | UNSUPPORTED | policy 测试 | ❌ |

  **fixture gap**：仓内暂无真实 Rating 回放 —— Rating=7 目前由已入库文档 + 外部 tooling 证据支撑（生产已随 PR #97 生效）；未来拿到真实当前版本 Rating replay 后补 parser → RATING → upload success 的真实 fixture integration 验证（follow-up，不阻塞）。
- **录像者识别**：`meta.json` 无录像者 `accountId`，`ReplayParser` 仅给出 `Battle.recorder`（昵称）。`HallOfFameService` 按 `nickname.equals(battle.recorder)` 在 `players` 中匹配；匹配不到则跳过（不猜）。成绩归**录像者（Player B）**；`uploadedBy` 只表示谁上传了回放，不覆盖成绩所有权。
- **去重与 replay 状态机（DB 原子）**：唯一键 `(arena_id, account_id)`（不含 battle_type —— 同一场+同一玩家即一条真实 battle result；mode conflict 视为数据不一致，不允许双记录）。`recordRecorder` 返回 `RecordOutcome`：新建 → `SAVED`；已存在且 `replay_hash` NULL → 原子 conditional UPDATE → `ATTACHED`，败者 re-read winner 后分类；已存在且同 hash → `IDEMPOTENT`；已存在且异 hash → `SKIPPED_HASH_CONFLICT`（保留已有 hash，绝不覆盖）；insert unique 竞态 → re-read winner 重新分类。并发由 DB 行锁保证（多实例安全）。
- **归属维度（已知遗留）**：单场 `hall_of_fame_record` 只按 `account_id` 归属，**没有区服维度**，`GET /api/users/profile/records` 同样只按账号 ID 返回个人成绩；跨服同号（`(CN, 123456)` 与 `(EU, 123456)`）在单场域仍可能被视作同一人。详见下文「单场 HoF 的区服限制（已知遗留 / follow-up debt）」。
- **回放文件存储（V15 → hof）**：`HallOfFameReplayStorage` 内容寻址存储到 `{HOF_REPLAY_DIR:data/replays}/{sha256}.wotbreplay`（生产挂 `replay_data` volume → `/data/replays`）。流程：校验（复用 `ReplayUploadValidator`，类型+.wotbreplay+20MB）→ 登录（`JwtUtil.requireUserId`）→ 解析（失败 400 `INVALID_REPLAY_FILE`）→ **battle-type policy（不支持模式 → 400 `UNSUPPORTED_BATTLE_TYPE`，在 SHA-256 / preflight / storage / DB 任何持久化之前拒绝，DB=0 / metadata=0 / 文件=0）** → SHA-256 → 临时文件 `.tmp/` → `ATOMIC_MOVE` 原子发布 → 记录入库。上传的「落盘 + 入库」与 admin delete 的「删除事务 + 文件清理」由 `ReplayHashLock`（PostgreSQL advisory lock，session 级，hash 前 16 hex 为 key）串行化，保证不变量：**任何记录引用 hash H → 物理 H.wotbreplay 必须存在**（delete/upload 同 hash 并发见 WebApiTest）。磁盘保护：`usable - incoming < HOF_REPLAY_MIN_FREE_BYTES`（默认 512MiB）→ 507 `REPLAY_STORAGE_FULL`；文件系统失败 → 500 `REPLAY_STORAGE_ERROR`。`replay_hash/file_name/size/uploaded_by` 四列可空（老记录 NULL → 无下载按钮，tolerance）。
- **下载**：`GET /api/hof/{id}/replay`（需登录，任意已登录用户可下载任何带 replay 的记录；不要求 uploadedBy==current user 或 recorder==current user）。无 hash / 文件丢失（best-effort 语义）→ 404 `REPLAY_FILE_NOT_FOUND`；原始文件名仅进 `Content-Disposition`（UTF-8 安全编码，绝不参与路径）。前端用 authenticated fetch → blob → `createObjectURL` 触发下载（禁止裸 `<a href>`）。
- **统一公开查询**：`GET /api/hof?battleType=RANDOM|RATING&nation=&vehicleType=&tier=&tankId=&nickname=&page=&size=`（匿名可访问；`battleType` 未知值 → 400 `INVALID_BATTLE_TYPE_FILTER`）。`nation` / `vehicleType` / `tier` 任一项无需先选车辆即可直接过滤榜单，多个非空车辆条件与 `tankId` 取交集。排序 deterministic：`damage_dealt DESC` → **battle type 优先 RATING > RANDOM** → `battle_time ASC NULLS LAST` → `created_at ASC` → `id ASC`（后三者仅 deterministic pagination tie-breaker）。rank 为完整 filter 交集上下文的位置排名（`(page-1)*size+i+1`，不落库、无 shared rank）。公开字段边界：**不暴露** accountId / arenaId / replayHash / uploadedBy / admin audit data；显示 rank/nickname/tank/damage/battleType/map/version/battleTime/uploadTime/replayAvailable。旧 `/api/leaderboard/top-damage`、`/api/leaderboard/tanks/{tankId}/top-damage` 已移除（HomePage 最高伤害改读 `/api/hof?page=1&size=1`）。
- **数据列**（V2 新增 `version`/`battle_time`）：`version` 来自 `meta.json#version`，`battle_time` 来自 `meta.json#battleStartTime` epoch ms，`created_at` 为上传时间。
- **集成点**：`POST /api/hof/upload`（需登录）→ `HallOfFameUploadService`（校验 → `ReplayCapacityLimiter` → `ReplayParser` → eligibility 不支持模式 400 → SHA-256 → preflight → `ReplayHashLock` 内 [`HallOfFameReplayStorage.store` → `HallOfFameService.recordRecorder`]）。
- **API**：
  - `GET /api/hof`（统一公开查询，匿名）
  - `GET /api/hof/vehicle-options`（匿名；当前名人堂实际存在车辆的名称、国家/系别、车种、等级与内部 `tankId`）
  - `POST /api/hof/upload`（上传回放，需登录）
  - `GET /api/hof/{id}/replay`（下载回放，需登录）
  - `GET /api/admin/hof`（admin 列表：nickname/accountId/uploadedBy/battleType/nation/vehicleType/tier/tankId/replayAvailable/sort=damage|battle_time|upload_time/分页 20/50/100；车辆分类可独立筛选且取交集；不返回 `arenaId` 或原始 `arenaBonusType`）
  - `GET /api/admin/hof/vehicle-options`（当前名人堂已有车辆的 `tankId`、名称、国家/系别、车种、等级；国家/车种为稳定英文枚举）
  - `GET /api/admin/hof/audit`（admin 操作日志，只读）
  - `GET /api/admin/hof/{id}/replay`（admin 下载，复用统一机制）
  - `DELETE /api/admin/hof/{id}`（hard delete，需二次确认）
  - `POST /api/admin/hof/records/bulk-delete`（批量 hard delete，body `{ids}`，**无 reason**——单场删除本就是 hard delete 且没有 reason 语义；逐条复用单条语义）
  - 旧 `/api/leaderboard/**` 全部移除；前端 `?view=leaderboard` → canonicalize 为 `?view=hof`。
- **Admin 安全**：`/api/admin/hof/**` 要求 `HoF-admin` 或 `wotbtools-admin`（`SecurityConfig` 中置于 `ADMIN_PATTERN` 之前；HoF-admin 只管理名人堂，不能访问 `/api/admin/users/**`、`/api/admin/boost/**` 等其他 admin 域）。角色由 Keycloak Admin Console 授予（本仓库仅 realm JSON provision，无授予 UI）。wotbtools-admin 自动拥有全部 HoF admin 权限。
- **单场车辆筛选**：`arena_id` 与 raw `arena_bonus_type` 继续保留在记录和审计快照中，供去重与追溯，但不作为业务页面的展示或筛选项。管理页与公开页共用当前名人堂实际车辆选项；国家/系别、车种、等级是三个无序可选条件，所有非空条件既对车辆名称候选取交集，也作为真实榜单查询条件独立生效；选中具体车辆时再与 `tankId` 继续取交集。
- **Admin hard delete**：真实 hard delete（无 soft delete / tombstone / blocklist）。**audit + record delete 单事务**（`BEGIN → validate → audit snapshot(DELETE_ENTRY) → delete record → COMMIT`；audit 失败 → 记录不删；删除失败 → 无假审计）。commit 后：`replay_hash` 非空且无其他记录引用 → 删除 `{sha256}.wotbreplay`；仍有引用 → 保留；清理失败 → 仅 WARN（orphan 保留，不回滚已 commit 的删除）。删除后同一回放未来可重新上传（正常校验后重新 SAVED）。审计快照保存 timestamp / admin sub+username / action / recordId / arenaId / accountId / nickname / tankId / tankName / damage / battleType / arenaBonusType / replayHash（record 删除后原记录已不存在，不能只存 record_id FK）。第一版无 audit retention / cleanup scheduler。批量删除（`POST /api/admin/hof/records/bulk-delete`）**逐条复用同一语义**：每条独立事务（`TransactionTemplate`）+ commit 后跨域引用计数清理物理文件，允许 partial success；不存在的 id 以 `HOF_ENTRY_NOT_FOUND` 逐条失败，其余继续；单批去重后上限 100，超出整批 400 `BULK_LIMIT_EXCEEDED`。
- **备份决策**：回放文件为 **best-effort 可丢数据**——数据库备份（`postgres-backup.sh`）只备份 metadata，不备份文件；VPS 损坏/迁移后可能出现下载 404（tolerance 设计）。
- **解析边界**：最多 100 个回放、单文件 20 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务。容量满返回 503 `REPLAY_BUSY`。


---

# 百场（Hundred Battles）排行榜

> 每辆 Tier X 车辆独立的生涯场均伤害排行榜。所有用户统一使用“截图 + 正好 5 个回放”的人工审核链路；Wargaming ASIA/EU/NA 仅作为登录与 Profile 同步身份入口。实现见 `wotb-web/.../hundred/`。

## 业务模型

- **单表生命周期**：`hundred_battle_submission` 承载完整生命周期（PENDING / CURRENT / SUPERSEDED / REJECTED / CANCELLED / DELETED，VARCHAR+CHECK）。一条 submission 审核通过即成为 CURRENT；被更高纪录替代 → SUPERSEDED；管理员删除 → DELETED。
- **数据库不变量**（Flyway `V18__create_hundred_battle_submission.sql` 建立、`V22` 改界，partial unique index）：**区服 + WotB 账号 + vehicle** 最多一个 active PENDING（`uk_hundred_battle_pending_account_vehicle`，`(wotb_server, wotb_account_id, vehicle_id) where status='PENDING'`）、最多一个 CURRENT（`uk_hundred_battle_current_account_vehicle`，`(wotb_server, wotb_account_id, vehicle_id) where status='CURRENT'`）；查询索引 `idx_hundred_battle_submission_account (wotb_server, wotb_account_id, status, submitted_at desc)`；rank 永不落库。两个唯一索引是**独立的 partial index**，因此同账号同车允许同时存在一条 PENDING 与一条 CURRENT。
- **ownership（V22 起）**：百场 submission 的 canonical owner 是创建瞬间绑定的 **`(wotb_server, wotb_account_id)`**，不是 Keycloak 用户身份，也不是单独的账号 ID。区服是业务身份的一部分而非可省略的展示字段：`(CN, 123456)` 与 `(EU, 123456)` 是两个不同账号，只按账号 ID 归属会造成跨服 ownership / authorization 串号；该组合与 `user_profile` 的 `UNIQUE (wotb_server, wotb_account_id)` 完全一致。归属解析的唯一入口是 `UserProfileService.currentWotbIdentity(keycloakUserId)` → `Optional<WotbAccountIdentity(server, accountId)>`；`cancelSubmission` 同时比较**区服与账号**，任一不符或未绑定账号 → 403 `HUNDRED_FORBIDDEN`。`GET /api/users/hundred/status` 同样按 `(区服, 账号)` 查询，未绑定账号时三个列表均为空。记录创建后用户改绑到别的区服或账号时，记录仍属于原 `(区服, 账号)`，因此不可再取消。
- **快照冻结**：创建瞬间冻结 canonical owner `(wotb_server, wotb_account_id)` 与 `nickname_snapshot`（`wotb_server` 为 V22 新增的 `varchar(16) NOT NULL` 快照列，取值 `CN|ASIA|EU|NA`，CHECK 约束 `ck_hundred_wotb_server`；`wotb_account_id` 在 V22 前列名为 `game_account_id_snapshot`；Profile 后续修改 gameId/nickname/区服不影响历史 submission）；排行榜只读取审核通过的 `approvedAverageDamage` / `approvedBattleCount`。APPROVE 不接收成绩，只使用创建时冻结的 MANUAL `claimed*`，管理员不能改写成绩。
- **gameId 唯一**：复用 `user_profile` 已有 `uk_user_profile_wotb_account (wotb_server, wotb_account_id)`，不新建约束。HoF 归属同样以 `(区服, 账号)` 为界，与 `user_profile` 的唯一槽位口径一致。

## 人工审核链路硬门禁（创建失败整单拒绝，不进入 PENDING）

1. 需登录且 Profile 已配置 gameId + nickname（`HUNDRED_PROFILE_GAME_ID_REQUIRED` / `HUNDRED_PROFILE_NICKNAME_REQUIRED`）。
2. 车辆必须为 authoritative Tier X（`Tankopedia.info(vehicleId).tier()==10`，`HUNDRED_NON_TIER_X`）。
3. 固定 1 张成绩截图（base64 data URL，复用 Boost Apply 校验模式：`data:image/` 前缀 + 550 万字符上限）。
4. 正好 5 个 `.wotbreplay`（复用 `ReplayUploadValidator` 大小/类型校验 + `HUNDRED_REPLAY_COUNT`）。
5. 5 个回放**全部解析成功**，且每个回放内存在 accountId == 冻结的 `wotb_account_id` 的玩家（`HUNDRED_REPLAY_GAME_ID_MISMATCH`）、其 tankId == 所选 vehicleId（`HUNDRED_REPLAY_VEHICLE_MISMATCH`）、5 个 `arenaId` 互不相同（`HUNDRED_REPLAY_DUPLICATE_BATTLE`）。不校验 server/region。
6. 新成绩必须严格高于当前 CURRENT（`HUNDRED_NOT_HIGHER`）；无 CURRENT 时历史 SUPERSEDED/DELETED 不限制重新提交。

## WG 登录与百场边界

Wargaming ASIA/EU/NA 登录、可信 claims 与 Profile 同步继续支持；Hundred 不再调用 WG stats API，也不提供 WG 自动认证提交端点。所有用户（包括 WG 登录用户）统一使用截图 + 5 个回放的 MANUAL 流程。

V20 中用于识别历史 WG 申请的 source/snapshot 列保持 immutable schema residue，应用不再映射。发布删除 WG 代码的版本前，运维须先备份数据库并在旧版本/schema 上运行 `tools/cleanup-hundred-wargaming-api.py`：默认 dry-run，只有 `--apply --confirm REMOVE-HUNDRED-WG-DATA` 才会删除 WG 来源；工具按 MANUAL 与单场 HoF 的共享引用保护回放文件。

## 审核与并发（数据库一致性优先，无分布式锁）

- `findByIdForUpdate`（PESSIMISTIC_WRITE 行锁）使 APPROVE / REJECT / CANCEL 从 PENDING → terminal **只成功一次**；败者得 `HUNDRED_SUBMISSION_NOT_PENDING`（409）。
- APPROVE 事务内重新读取 CURRENT（行锁），以 MANUAL 的冻结申报场均比较（`HUNDRED_APPROVE_STALE`，409）；旧 CURRENT → SUPERSEDED，新 submission → CURRENT。审批端点没有成绩请求体。
- REJECT / 删除 CURRENT 原因强制（分类 + OTHER 必填文本）。
- **proof 生命周期**：截图以 base64 存 DB，5 个原始 replay 由 `hundred_battle_replay_evidence`（Flyway V19）**内容寻址持久化**（复用 `HallOfFameReplayStorage`，`{HOF_REPLAY_DIR}/{sha256}.wotbreplay`，幂等/原子/防路径穿越）。文件证据仅服务 PENDING；APPROVE / REJECT / CANCEL / DELETE 终态事务内清空截图、删除 evidence 行，commit 后按跨表引用计数 best-effort 清理无引用物理文件。

## 回放审核证据（admin-only）

- **存储**：与名人堂单场回放共享同一内容寻址存储目录（`HOF_REPLAY_DIR`，生产 `/data/replays` volume）；`original_filename` 仅用于展示 / Content-Disposition（basename + 限长，绝不参与路径）；`sha256` 即存储 key（服务端生成）。一个 submission 恰好 5 行 evidence（`submission_id + slot` 唯一，service 单事务保证），任意文件存储失败 → 整单失败 + 已存文件 best-effort 清理，绝不产生部分 evidence 的合法 PENDING。
- **访问边界**：`/api/admin/hof/hundred/**` 要求 `HoF-admin` 或 `wotbtools-admin`（`SecurityConfig` `HOF_ADMIN_PATTERN`）。普通登录用户与匿名用户均无法读取审核证据（猜 ID 不可下载；下载端点校验 replayId 必须属于 submissionId）。
- **Legacy 数据**：证据持久化上线前的旧 PENDING 无 evidence → 提示拒绝并要求重提；终态按正常生命周期不再提供证据下载。
- **审核证据**：保留 4 项机器验证（Parsed / GameID match / Vehicle match / Distinct battles），管理员以原始截图 + 5 个 replay 为准；后端 approve 强制完整证据。

## API

| 端点 | 权限 | 说明 |
|---|---|---|
| `GET /api/hof/hundred?nation=&vehicleType=&vehicleId=&page=&size=` | 匿名 | 三项取交集：全空为全站 CURRENT Top 10；仅分类时为分类交集 Top 10；选择车辆后为该车独立分页排行，competition rank 始终基于相同筛选上下文 |
| `POST /api/hof/hundred/submissions` | 登录 | multipart 提交（vehicleId/averageDamage/battleCount/screenshot/replays×5） |
| `POST /api/hof/hundred/submissions/{id}/cancel` | 登录（本人账号） | 撤销 PENDING；归属按当前绑定的 `(区服, WotB 账号)` 判定，区服或账号任一不符、或未绑定账号 → 403 `HUNDRED_FORBIDDEN` |
| `GET /api/users/hundred/status` | 登录 | 个人中心：CURRENT / PENDING / 最近拒绝；按当前绑定的 `(区服, WotB 账号)` 查询，未绑定账号时三个列表均为空 |
| `GET /api/admin/hof/hundred/submissions?status=&nation=&vehicleType=&vehicleId=&page=&size=` | HoF-admin/wotbtools-admin | 审核列表；状态、国家/系别、车种、车辆均可独立使用并取交集 |
| `GET /api/admin/hof/hundred/submissions/{id}` | 同上 | 所有状态详情；PENDING 可返回 MANUAL proof，终态保留结果/原因文字 |
| `GET /api/admin/hof/hundred/submissions/{id}/replays` | 同上 | PENDING 回放证据 metadata；终态或旧记录为空 |
| `GET /api/admin/hof/hundred/submissions/{submissionId}/replays/{replayId}` | 同上 | 下载单个原始 .wotbreplay（ownership 校验 + UTF-8 filename） |
| `POST /api/admin/hof/hundred/submissions/{id}/approve` | 同上 | 通过；无请求体，使用原申报值 |
| `POST /api/admin/hof/hundred/submissions/{id}/reject` | 同上 | 拒绝（原因强制） |
| `POST /api/admin/hof/hundred/submissions/{id}/delete` | 同上 | 删除 CURRENT（原因强制，不恢复 SUPERSEDED） |
| `POST /api/admin/hof/hundred/submissions/bulk-delete` | 同上 | 批量删除 CURRENT（body `{ids, reason, reasonText}`）；逐条复用单条删除语义、每条独立事务，单批去重后上限 100（超出 400 `BULK_LIMIT_EXCEEDED`），非 CURRENT / 不存在逐条以 `HUNDRED_NOT_CURRENT` / `HUNDRED_SUBMISSION_NOT_FOUND` 失败且不阻塞其他记录 |

百场 admin 列表与详情 DTO（`HundredAdminListItemDto` / `HundredAdminDetailDto`）在 V22 后都带 `wotbServer`，与 `wotbAccountId` 一起构成本域的业务身份；管理页在列表与详情共 4 处（百场 2 处、三环 2 处）渲染为 `{{ wotbServer }}·{{ wotbAccountId }}`，避免只显示账号 ID 时把跨服同号看成同一个账号。

## 页面交互约定

- 公开「百场」页默认不选分类/车辆，标签为“默认”，展示全站当前最高 10 条并显示车辆名。国家/系别与车种任一非空时，立即展示分类交集 Top 10，并同时收窄可见的 Tier X 车辆下拉；选择具体车辆后进入该车独立分页排行。百场仅支持 Tier X，因此不另设等级筛选。
- 百场提交弹窗只提供人工审核：沿用**当前页面会话草稿**，关闭弹窗、点击遮罩或切换 Tab 均不清空截图和已选回放；回放可分批追加到 5 个并逐项移除。提交失败保留草稿，成功或用户确认清空后重置。WG 登录用户也使用同一表单。
- 管理后台列表可按国家/系别、车种、具体车辆和状态独立筛选（百场仅 Tier X，不另设等级）；摘要只显示通过后的场均和场次，用户申报值仅在详情中查看。对 PENDING / CURRENT / REJECTED / SUPERSEDED / CANCELLED / DELETED 一律只提供“详情”入口。通过、拒绝、删除只能在详情内触发，管理员不提供成绩编辑控件；截图、回放列表与下载按钮只在 PENDING 详情展示，终态详情只保留审核结果、拒绝/删除原因等文字信息。

---

# 三环（Mark 3）排行榜

> 每辆 Tier X 车辆独立的「最少场次获得三环」排行榜。仅人工审核，不调用 Wargaming API、不提供官方自动认证链路。实现见 `wotb-web/.../mark3/`。

## 业务模型

- **状态机**：`mark3_submission` 只使用 PENDING / CURRENT / REJECTED / CANCELLED / DELETED（VARCHAR + CHECK）；**没有 SUPERSEDED**。通过申请成为 CURRENT 后，即为同一 `(区服, WotB 账号)` 同一车辆唯一且不可替换的三环记录。
- **数据库不变量**：Flyway `V21__create_mark3_submission.sql` 的 partial unique index 保证同 **`(区服, WotB 账号)`** 同车最多一条 active PENDING/CURRENT（`uk_mark3_submission_active_account_vehicle`，`(wotb_server, wotb_account_id, vehicle_id) where status in ('PENDING','CURRENT')`——**单个组合索引跨两个状态**；V21 建立、`V22` 由 Keycloak 身份改界为 `(区服, 账号)`，查询索引 `idx_mark3_submission_account (wotb_server, wotb_account_id, status, submitted_at desc)`）；服务层在已有 CURRENT 时拒绝新提交，并在 APPROVE 时再次检查，绝不替代 CURRENT。REJECTED / CANCELLED / DELETED 后允许重新提交。
- **ownership（V22 起）**：与百场同构——canonical owner 是创建瞬间绑定的 **`(wotb_server, wotb_account_id)`**，不是 Keycloak 用户身份，也不是单独的账号 ID。`cancelSubmission` 通过 `UserProfileService.currentWotbIdentity(keycloakUserId)` 解析当前绑定身份，同时比较**区服与账号**，任一不符或未绑定账号 → 403 `MARK3_FORBIDDEN`。`GET /api/users/mark3/status` 同样按 `(区服, 账号)` 查询，未绑定账号时三个列表均为空。记录创建后用户改绑到别的区服或账号时，记录仍属于原 `(区服, 账号)`，因此不可再取消。
- **冻结值**：提交时冻结 Profile 的 **WotB 账号 ID**（`wotb_account_id`，V22 前列名为 `game_account_id_snapshot`）与其 **区服快照** `wotb_server`（`varchar(16) NOT NULL`，CHECK `ck_mark3_wotb_server`，取值 `CN|ASIA|EU|NA`），二者共同构成 canonical owner；同时冻结昵称快照。审核通过后冻结申报的 `battleCount`、`averageDamage`、`winRate` 为 approved 值。管理员审批不接收也不能改写任何成绩数据。
- **排名**：只读取 CURRENT，按 `approvedBattleCount ASC` 排序；相同三环场数为 competition ranking（名次跳号），`approvedAt ASC, id ASC` 只用于稳定展示，不以场均或胜率打破并列。
- **筛选**：公开榜和管理列表都使用与百场相同的国家/系别、车种、车辆交集筛选；全空或仅分类时显示 CURRENT Top 10，选择具体车辆后为该车独立分页。当前只允许 Tier X，不另设等级筛选。

## 人工审核链路硬门禁（创建失败整单拒绝，不进入 PENDING）

1. 需登录且 Profile 已配置 gameId + nickname。
2. 车辆必须是 authoritative Tier X。
3. 需提交 `battleCount`、`averageDamage` 与 `winRate`；`winRate` 为 0–100 的百分数，最多两位小数。
4. 截图只能为 1–2 张有效图片，单张不超过 4 MiB。新车从 0 场开始打三环可以只提供一张；其余申请应提供记录开始与结束的 0% 和 95% 截图。后端只校验数量与图片格式，证据内容由管理员人工判断。
5. 正好 5 个 `.wotbreplay`；全部解析成功，均匹配提交时的账号和车辆，且 5 个 `arenaId` 互不相同。
6. 同一 `(区服, WotB 账号)` 同一车辆已有 CURRENT 时永远不能再创建或通过新申请；PENDING 已存在时也不能重复提交。

## 审核、证据与并发

- 创建时的 replay 校验、读入五个 byte[]、解析、hash 锁、落盘和事务共用全局 `ReplayCapacityLimiter`；容量已满时在解析前返回 503 `REPLAY_BUSY`，任何 success、校验失败、解析失败、存储失败或 DB 失败都会释放许可。
- `findByIdForUpdate`（PESSIMISTIC_WRITE）使 APPROVE / REJECT / CANCEL 从 PENDING 到终态只成功一次；APPROVE 事务内重查该 `(区服, WotB 账号)` 该车的 CURRENT，存在即拒绝，绝不产生替代记录。
- 管理员只能在详情中通过、拒绝或删除：通过无请求体，直接冻结原申报数值；拒绝与删除均要求原因。没有任何修改场数、场均或胜率的接口或控件。
- 1–2 张截图和 5 个 replay evidence 只在 PENDING 期间对 HoF-admin / wotbtools-admin 可见。回放以 SHA-256 内容寻址保存在隔离的 `${wotb.hof.replay-dir}/mark3` 子目录（默认 `data/replays/mark3`），沿用 ownership 校验但不与单场/百场共用 hash 引用计数；APPROVE / REJECT / CANCEL / DELETE 到终态后清空截图、删除 evidence，随后 best-effort 清理该目录中无引用的物理文件。

## API

| 端点 | 权限 | 说明 |
|---|---|---|
| `GET /api/hof/mark3?nation=&vehicleType=&vehicleId=&page=&size=` | 匿名 | Tier X 三环公开榜；国家/系别、车种和车辆取交集，按三环场数升序 competition rank |
| `POST /api/hof/mark3/submissions` | 登录 | multipart 提交：vehicleId、battleCount、averageDamage、winRate、1–2 张 base64 `data:image/` proofScreenshots、5 个 replays；全局 replay 容量满时 503 `REPLAY_BUSY` |
| `POST /api/hof/mark3/submissions/{id}/cancel` | 登录（本人账号） | 撤销自己的 PENDING；归属按当前绑定的 `(区服, WotB 账号)` 判定，区服或账号任一不符、或未绑定账号 → 403 `MARK3_FORBIDDEN` |
| `GET /api/users/mark3/status` | 登录 | 个人中心：CURRENT / PENDING / 最近拒绝；按当前绑定的 `(区服, WotB 账号)` 查询，未绑定账号时三个列表均为空 |
| `GET /api/admin/hof/mark3/submissions?status=&nation=&vehicleType=&vehicleId=&page=&size=` | HoF-admin/wotbtools-admin | 审核列表；状态、国家/系别、车种、车辆独立筛选并取交集 |
| `GET /api/admin/hof/mark3/submissions/{id}` | 同上 | 所有状态详情；PENDING 返回 proof，终态保留结果与原因文字 |
| `GET /api/admin/hof/mark3/submissions/{id}/replays` | 同上 | PENDING 回放证据 metadata |
| `GET /api/admin/hof/mark3/submissions/{submissionId}/replays/{replayId}` | 同上 | 下载单个原始 `.wotbreplay`（ownership 校验 + UTF-8 filename） |
| `POST /api/admin/hof/mark3/submissions/{id}/approve` | 同上 | 通过；无请求体，冻结原申报值，不能替代 CURRENT |
| `POST /api/admin/hof/mark3/submissions/{id}/reject` | 同上 | 拒绝（原因强制） |
| `POST /api/admin/hof/mark3/submissions/{id}/delete` | 同上 | 删除 CURRENT（原因强制） |
| `POST /api/admin/hof/mark3/submissions/bulk-delete` | 同上 | 批量删除 CURRENT（body `{ids, reason, reasonText}`）；逐条复用单条删除语义、每条独立事务，单批去重后上限 100（超出 400 `BULK_LIMIT_EXCEEDED`），非 CURRENT / 不存在逐条以 `MARK3_NOT_CURRENT` / `MARK3_SUBMISSION_NOT_FOUND` 失败且不阻塞其他记录 |

三环 admin 列表与详情 DTO（`Mark3AdminListItemDto` / `Mark3AdminDetailDto`）同样新增 `wotbServer`，管理页渲染口径与百场一致（`{{ wotbServer }}·{{ wotbAccountId }}`）。

## 页面交互约定

- 公开「三环」页复用百场的筛选与分页体验，展示三环场数、过程场均、过程胜率；三环场数越少越靠前。
- 提交弹窗只提供人工审核，要求填写三环场数、过程场均、过程胜率、1–2 张截图与 5 个回放；明确显示 0 场新车可只传一张、其余应提供 0% 和 95% 截图的提示。
- 管理后台提供三环审核 tab；列表和详情不显示成绩编辑输入。PENDING 详情可查看截图和下载 5 个回放，终态仅保留审核结果及原因文字。

---

# 删除语义与 IAM / HoF 不变量（跨单场 / 百场 / 三环）

## 三个域的权威删除语义

| 域 | 语义 | 结果 | 请求体 | 证据 / 物理文件处理 |
|---|---|---|---|---|
| 单场 `hall_of_fame_record` | **hard delete**（真删行，无 tombstone / blocklist） | 行消失，同一回放日后可重新上传 | 无 reason | 单事务 audit snapshot(`DELETE_ENTRY`) + 删行；commit 后**跨域引用计数为 0** 才删 `{sha256}.wotbreplay`，清理失败仅 WARN（orphan 保留） |
| 百场 `hundred_battle_submission` | **soft delete**，仅 CURRENT 可删 | `CURRENT` → `DELETED` | `reason` 强制，`OTHER` 必填 `reasonText` | 终态事务内清空 proof 截图、删除 replay evidence 行；commit 后 best-effort 清理无引用物理文件 |
| 三环 `mark3_submission` | **soft delete**，仅 CURRENT 可删 | `CURRENT` → `DELETED` | 同上 | 同上（三环 evidence 在独立命名空间，不与单场/百场共用引用计数） |

**bulk delete == 逐条重复权威单条删除语义**，没有第二套删除规则、状态机或 tombstone：

| 端点 | 请求体 | 单批上限 |
|---|---|---|
| `POST /api/admin/hof/records/bulk-delete` | `{ids}`（单场**没有** reason，因为它本来就是 hard delete 且无 reason 语义） | 去重后 100 |
| `POST /api/admin/hof/hundred/submissions/bulk-delete` | `{ids, reason, reasonText}` | 去重后 100 |
| `POST /api/admin/hof/mark3/submissions/bulk-delete` | `{ids, reason, reasonText}` | 去重后 100 |

共同契约：每条目标跑在**独立事务**中（`TransactionTemplate`，避免 `@Transactional` 自调用被 Spring 代理绕过），因此允许 **partial success**——某个 id 失败不回滚其他 id 已完成的删除；响应为 `{requested, deleted, failed, results:[{id, deleted, errorCode}]}`。去重后超过 100 个 id → 整批 400 `BULK_LIMIT_EXCEEDED`。百场/三环的 reason 是**批次级参数**，先整体校验一次（参数错误整批 400，不表现为「每条都失败」）；非 CURRENT 的记录逐条失败于既有错误码（`HUNDRED_NOT_CURRENT` / `MARK3_NOT_CURRENT`）而不阻塞其他记录。单场批量中不存在的 id 以 `HOF_ENTRY_NOT_FOUND` 逐条失败，其余继续。

## IAM ≠ HoF 不变量

```text
删除 Keycloak 用户  ≠  删除 HoF 业务记录
```

- HoF 数据属于 **WotB 游戏账号**，不属于 Keycloak 用户：V22 后百场/三环的 canonical owner 是 `(wotb_server, wotb_account_id)`，单场 `hall_of_fame_record` 从一开始就按 `account_id` 归属（**无区服维度**，见下文「单场 HoF 的区服限制」）。
- 仓库中**没有任何 FK 指向 `user_profile`**；全仓唯一的 `on delete cascade` 在 `V3__create_boosting_tables.sql`（boost 域内部）。因此删除 Keycloak 用户不会连带删除任何 HoF 行。
- **删除用户必须走 WotBTools admin API**：`AdminUserService` 会先删本地 profile 再删 Keycloak 用户。绕过它直连 Keycloak 删除会留下**孤儿 profile**并阻塞后续重绑（`(wotb_server, wotb_account_id)` 唯一槽位仍被占用）；此时用 Admin Users 的 `segment=local` 找到这些孤儿绑定（行上 `keycloakUserMissing=true`）并删除以释放槽位。
- 用户以全新 Keycloak 身份（例如旧 Juhe QQ 用户被删除后改用 Official QQ 重建）重新绑定**同一个 `(区服, WotB 账号)`** 后，其百场/三环数据自然重新关联，不需要任何数据修复；单场 `hall_of_fame_record` 只认账号 ID，因此换服同号会被误关联（见下节）。

## V22 迁移契约（fail-fast preflight，不做任何自动消解）

V22 的执行顺序（`V22__hof_ownership_by_wotb_account.sql`，百场与三环各一遍，字段名对应各自表）：

```text
1) 新增 wotb_server（先可空）
2) 从 user_profile 回填：仅当旧 user_keycloak_id 对应的 profile 当前仍绑定同一账号时取其所服
3) PREFLIGHT（fail fast，不做任何自动消解）：
     a. 存在无法解析区服的历史行 → 抛错并给出可操作诊断（列出样例 id 与检查 SQL）
     b. 新 ownership 键下存在重复 active 记录 → 抛错并列出冲突键
4) 收紧 wotb_server NOT NULL + 区服 CHECK
5) 重建唯一性与查询索引为 (wotb_server, wotb_account_id, vehicle_id)
6) 删除 user_keycloak_id
```

**迁移明确不做的事**（契约，不是实现细节）：

- 不自动选择 winner、不修改任何 `status`、不删除任何 replay evidence、不清空任何截图（尤其不把重复行转成 `SUPERSEDED` / `DELETED`）。
- 不为无法解析区服的历史行**猜**一个区服（尤其不默认 `CN`）。
- 不触碰文件系统：物理回放文件的清理仍只由 admin 删除路径的跨域引用计数负责。

**事务语义**：Flyway 在 PostgreSQL 上把每个迁移包在单一事务里，因此 preflight 失败时 V22 的全部 DDL/DML 一起回滚，数据库停留在 **V21**。不会出现「列已改名但唯一索引没建起来」的中间态。

**历史行区服的唯一权威来源**：旧 Keycloak 身份**当前仍绑定同一账号**的 `user_profile`。用户已改绑到别的账号、或 profile 已被删除的行无法推导区服 → 迁移失败并给出诊断，而不是猜值。

**冲突判定口径（百场与三环不同，因为新唯一索引形态不同）**：

| 域 | 新唯一索引形态 | 冲突判定 |
|---|---|---|
| 百场 | PENDING / CURRENT **两个独立的** partial index | 按 `(区服, 账号, 车辆, 状态)`：同账号同车同时有一条 PENDING 与一条 CURRENT **不是**冲突 |
| 三环 | **单个组合** partial index（`status in ('PENDING','CURRENT')`） | 按 `(区服, 账号, 车辆)` **跨状态**：同账号同车同时存在 CURRENT 与 PENDING **同样是**冲突 |

冲突的来源是旧唯一性 `(user_keycloak_id, vehicle_id)` 不蕴含新的 `(wotb_server, wotb_account_id, vehicle_id)`：同一 WotB 账号被两个 Keycloak 身份先后绑定过、各自提交过同车 active 记录时，旧约束允许、新约束不允许。

### 迁移失败后的管理员 runbook

```text
1) 读 Flyway 报错的 message / detail / hint：detail 已直接列出前 20 个样例 id 或全部冲突键
2) 区服无法解析时自查：
     百场 select id, user_keycloak_id, wotb_account_id, status
            from hundred_battle_submission where wotb_server is null;
     三环 select id, user_keycloak_id, wotb_account_id, status
            from mark3_submission where wotb_server is null;
   → 要么恢复 / 重新绑定该行所属的 profile（让回填能取到区服），要么有意删除这些行
3) ownership 冲突时按上表口径人工比对（approved_average_damage / submitted_at 等），
   由人决定保留哪一条——迁移不替你选 winner
4) 用 Admin bulk-delete（或单条 delete）清理其余记录：
     POST /api/admin/hof/hundred/submissions/bulk-delete
     POST /api/admin/hof/mark3/submissions/bulk-delete
5) 重跑迁移（Flyway 会重新执行 V22）
```

> **待确认（既有缺口，需要本轮 review 决定）**：百场/三环的单条 delete 与 bulk-delete 都**只接受 CURRENT**（非 CURRENT 逐条以 `HUNDRED_NOT_CURRENT` / `MARK3_NOT_CURRENT` 失败），而无法解析区服或参与冲突的行有可能是 `PENDING`。也就是说存在「preflight 报错点名了某条 PENDING，但 admin API 删不掉它」的组合。上面的 runbook 对这类行目前没有受支持的处置路径，需要人工 DB 操作或补充产品决策。

## 单场 HoF 的区服限制（已知遗留 / follow-up debt）

**`hall_of_fame_record` 仍然只按 `account_id` 归属，没有任何区服维度。** 这是本轮变更范围之外的既有设计：

- 表结构：V1/V16 至今只有 `account_id`，去重唯一键是 `(arena_id, account_id)`，没有 `wotb_server` 列。
- 个人中心：`GET /api/users/profile/records` → `HallOfFameService.recordsByAccountId(profile.wotbAccountId(), 50)`，**只按账号 ID 匹配**，不看当前绑定的区服。
- 因此跨服同号（例如 `(CN, 123456)` 与 `(EU, 123456)`）在单场域**仍可能被当作同一个人**：个人中心可能展示到另一个区服同号账号的成绩，`(arena_id, account_id)` 去重也可能把两个区服的同号玩家判为同一条记录。

**不要据此认为三个 HoF 域都已区服安全**：只有百场与三环在 V22 后是 `(区服, 账号)` 归属，单场仍是 account-only。这是**已声明的遗留问题**，不是本 PR（#287）的修复范围；把它纳入需要 `hall_of_fame_record` 加区服列 + 历史行区服回填 + 去重键改界，属于独立的 follow-up 工作项。
