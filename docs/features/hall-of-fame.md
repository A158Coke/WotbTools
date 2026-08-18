# 名人堂（Hall of Fame / Зал славы）

> MVP 只记录录像者本人单场伤害成绩；schema 由 Flyway 管理。实现见 `wotb-web/.../hof/`。

名人堂只接受**随机战斗（RANDOM）**与**评级战斗（RATING）**回放；训练房 / 联赛 / 锦标赛 / 娱乐 / 未知模式一律拒绝（上传 → HTTP 400 `UNSUPPORTED_BATTLE_TYPE`，零持久化）。Replay 文件是 authoritative source：`.wotbreplay` → `ReplayParser` → authoritative battle facts → battle-type policy → 名人堂；**禁止人工修改 replay-derived authoritative facts**（admin 是 governance，不是数据编辑器）。

- **数据库配置**：`application.yml` 始终启用 DataSource/JPA/Flyway，`ddl-auto: validate`；本地开发需提供 PostgreSQL 与 `POSTGRES_PASSWORD`。
- **Schema 来源**：Flyway 迁移 `V1__init_leaderboard.sql` → `V15__add_leaderboard_replay_file.sql`（历史 immutable），`V16__rename_leaderboard_to_hall_of_fame.sql`（表/约束/索引 rename-in-place + battle_type/arena_bonus_type + backfill），`V17__create_hall_of_fame_admin_log.sql`（admin 审计表）。**改表结构必须新增迁移**，不要改已应用的版本；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
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
- **回放文件存储（V15 → hof）**：`HallOfFameReplayStorage` 内容寻址存储到 `{HOF_REPLAY_DIR:data/replays}/{sha256}.wotbreplay`（生产挂 `replay_data` volume → `/data/replays`）。流程：校验（复用 `ReplayUploadValidator`，类型+.wotbreplay+20MB）→ 登录（`JwtUtil.requireUserId`）→ 解析（失败 400 `INVALID_REPLAY_FILE`）→ **battle-type policy（不支持模式 → 400 `UNSUPPORTED_BATTLE_TYPE`，在 SHA-256 / preflight / storage / DB 任何持久化之前拒绝，DB=0 / metadata=0 / 文件=0）** → SHA-256 → 临时文件 `.tmp/` → `ATOMIC_MOVE` 原子发布 → 记录入库。上传的「落盘 + 入库」与 admin delete 的「删除事务 + 文件清理」由 `ReplayHashLock`（PostgreSQL advisory lock，session 级，hash 前 16 hex 为 key）串行化，保证不变量：**任何记录引用 hash H → 物理 H.wotbreplay 必须存在**（delete/upload 同 hash 并发见 WebApiTest）。磁盘保护：`usable - incoming < HOF_REPLAY_MIN_FREE_BYTES`（默认 512MiB）→ 507 `REPLAY_STORAGE_FULL`；文件系统失败 → 500 `REPLAY_STORAGE_ERROR`。`replay_hash/file_name/size/uploaded_by` 四列可空（老记录 NULL → 无下载按钮，tolerance）。
- **下载**：`GET /api/hof/{id}/replay`（需登录，任意已登录用户可下载任何带 replay 的记录；不要求 uploadedBy==current user 或 recorder==current user）。无 hash / 文件丢失（best-effort 语义）→ 404 `REPLAY_FILE_NOT_FOUND`；原始文件名仅进 `Content-Disposition`（UTF-8 安全编码，绝不参与路径）。前端用 authenticated fetch → blob → `createObjectURL` 触发下载（禁止裸 `<a href>`）。
- **统一公开查询**：`GET /api/hof?battleType=RANDOM|RATING&tankId=&nickname=&page=&size=`（匿名可访问；`battleType` 未知值 → 400 `INVALID_BATTLE_TYPE_FILTER`）。排序 deterministic：`damage_dealt DESC` → **battle type 优先 RATING > RANDOM** → `battle_time ASC NULLS LAST` → `created_at ASC` → `id ASC`（后三者仅 deterministic pagination tie-breaker）。rank 为当前 filter 上下文位置排名（`(page-1)*size+i+1`，不落库、无 shared rank）。公开字段边界：**不暴露** accountId / arenaId / replayHash / uploadedBy / admin audit data；显示 rank/nickname/tank/damage/battleType/map/version/battleTime/uploadTime/replayAvailable。旧 `/api/leaderboard/top-damage`、`/api/leaderboard/tanks/{tankId}/top-damage` 已移除（HomePage 最高伤害改读 `/api/hof?page=1&size=1`）。
- **数据列**（V2 新增 `version`/`battle_time`）：`version` 来自 `meta.json#version`，`battle_time` 来自 `meta.json#battleStartTime` epoch ms，`created_at` 为上传时间。
- **集成点**：`POST /api/hof/upload`（需登录）→ `HallOfFameUploadService`（校验 → `ReplayCapacityLimiter` → `ReplayParser` → eligibility 不支持模式 400 → SHA-256 → preflight → `ReplayHashLock` 内 [`HallOfFameReplayStorage.store` → `HallOfFameService.recordRecorder`]）。
- **API**：
  - `GET /api/hof`（统一公开查询，匿名）
  - `POST /api/hof/upload`（上传回放，需登录）
  - `GET /api/hof/{id}/replay`（下载回放，需登录）
  - `GET /api/admin/hof`（admin 列表：nickname/accountId/arenaId/uploadedBy/battleType/tankId/replayAvailable/sort=damage|battle_time|upload_time/分页 20/50/100）
  - `GET /api/admin/hof/audit`（admin 操作日志，只读）
  - `GET /api/admin/hof/{id}/replay`（admin 下载，复用统一机制）
  - `DELETE /api/admin/hof/{id}`（hard delete，需二次确认）
  - 旧 `/api/leaderboard/**` 全部移除；前端 `?view=leaderboard` → canonicalize 为 `?view=hof`。
- **Admin 安全**：`/api/admin/hof/**` 要求 `HoF-admin` 或 `wotbtools-admin`（`SecurityConfig` 中置于 `ADMIN_PATTERN` 之前；HoF-admin 只管理名人堂，不能访问 `/api/admin/users/**`、`/api/admin/boost/**` 等其他 admin 域）。角色由 Keycloak Admin Console 授予（本仓库仅 realm JSON provision，无授予 UI）。wotbtools-admin 自动拥有全部 HoF admin 权限。
- **Admin hard delete**：真实 hard delete（无 soft delete / tombstone / blocklist）。**audit + record delete 单事务**（`BEGIN → validate → audit snapshot(DELETE_ENTRY) → delete record → COMMIT`；audit 失败 → 记录不删；删除失败 → 无假审计）。commit 后：`replay_hash` 非空且无其他记录引用 → 删除 `{sha256}.wotbreplay`；仍有引用 → 保留；清理失败 → 仅 WARN（orphan 保留，不回滚已 commit 的删除）。删除后同一回放未来可重新上传（正常校验后重新 SAVED）。审计快照保存 timestamp / admin sub+username / action / recordId / arenaId / accountId / nickname / tankId / tankName / damage / battleType / arenaBonusType / replayHash（record 删除后原记录已不存在，不能只存 record_id FK）。第一版无 audit retention / cleanup scheduler。
- **备份决策**：回放文件为 **best-effort 可丢数据**——数据库备份（`postgres-backup.sh`）只备份 metadata，不备份文件；VPS 损坏/迁移后可能出现下载 404（tolerance 设计）。
- **解析边界**：最多 100 个回放、单文件 5 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务。容量满返回 503 `REPLAY_BUSY`。


---

# 百场（Hundred Battles）排行榜

> 国服名人堂「百场」：每辆 Tier X 车辆独立的生涯场均伤害排行榜，成绩需提交 1 张截图 + 正好 5 个回放并由管理员人工审核认证。实现见 `wotb-web/.../hundred/`。

## 业务模型

- **单表生命周期**：`hundred_battle_submission` 承载完整生命周期（PENDING / CURRENT / SUPERSEDED / REJECTED / CANCELLED / DELETED，VARCHAR+CHECK）。一条 submission 审核通过即成为 CURRENT；被更高纪录替代 → SUPERSEDED；管理员删除 → DELETED。
- **数据库不变量**（Flyway `V18__create_hundred_battle_submission.sql`，partial unique index）：user+vehicle **最多一个 active PENDING**、**最多一个 CURRENT**；rank 永不落库。
- **快照冻结**：创建瞬间冻结 `game_account_id_snapshot` / `nickname_snapshot`（Profile 后续修改 gameId/nickname 不影响历史 submission）；排行榜只读取审核通过的 `approvedAverageDamage` / `approvedBattleCount`，`claimed*` 仅作审计。
- **gameId 唯一**：复用 `user_profile` 已有 `uk_user_profile_wotb_account (wotb_server, wotb_account_id)`，不新建约束。

## 提交硬门禁（创建失败整单拒绝，不进入 PENDING）

1. 需登录且 Profile 已配置 gameId + nickname（`HUNDRED_PROFILE_GAME_ID_REQUIRED` / `HUNDRED_PROFILE_NICKNAME_REQUIRED`）。
2. 车辆必须为 authoritative Tier X（`Tankopedia.info(vehicleId).tier()==10`，`HUNDRED_NON_TIER_X`）。
3. 固定 1 张成绩截图（base64 data URL，复用 Boost Apply 校验模式：`data:image/` 前缀 + 550 万字符上限）。
4. 正好 5 个 `.wotbreplay`（复用 `ReplayUploadValidator` 大小/类型校验 + `HUNDRED_REPLAY_COUNT`）。
5. 5 个回放**全部解析成功**，且每个回放内存在 accountId == snapshot gameId 的玩家（`HUNDRED_REPLAY_GAME_ID_MISMATCH`）、其 tankId == 所选 vehicleId（`HUNDRED_REPLAY_VEHICLE_MISMATCH`）、5 个 `arenaId` 互不相同（`HUNDRED_REPLAY_DUPLICATE_BATTLE`）。不校验 server/region。
6. 新成绩必须严格高于当前 CURRENT（`HUNDRED_NOT_HIGHER`）；无 CURRENT 时历史 SUPERSEDED/DELETED 不限制重新提交。

## 审核与并发（数据库一致性优先，无分布式锁）

- `findByIdForUpdate`（PESSIMISTIC_WRITE 行锁）使 APPROVE / REJECT / CANCEL 从 PENDING → terminal **只成功一次**；败者得 `HUNDRED_SUBMISSION_NOT_PENDING`（409）。
- APPROVE 事务内重新读取 CURRENT（行锁）并按管理员最终 `approvedAverageDamage > current.approvedAverageDamage` 比较（`HUNDRED_APPROVE_STALE`，409）；旧 CURRENT → SUPERSEDED，新 submission → CURRENT。
- REJECT / 删除 CURRENT 原因强制（分类 + OTHER 必填文本）。
- **proof 生命周期**：截图以 base64 存 DB（临时私有审核资产），审核终态事务内清空（不永久保存）；5 个原始 replay 由 `hundred_battle_replay_evidence`（Flyway V19）**内容寻址持久化**（复用 `HallOfFameReplayStorage`，`{HOF_REPLAY_DIR}/{sha256}.wotbreplay`，幂等/原子/防路径穿越），PENDING 全程可审核；审核终态（APPROVE/REJECT/CANCEL）同事务删除 evidence 行并在 commit 后 best-effort 清理物理文件（**跨表引用计数**：hall_of_fame_record 与本表均无引用才删，失败仅 WARN 保留 orphan，不回滚业务状态）。proof 绝不进入公开 replay 下载体系：公开榜只输出审核后快照。

## 回放审核证据（admin-only）

- **存储**：与名人堂单场回放共享同一内容寻址存储目录（`HOF_REPLAY_DIR`，生产 `/data/replays` volume）；`original_filename` 仅用于展示 / Content-Disposition（basename + 限长，绝不参与路径）；`sha256` 即存储 key（服务端生成）。一个 submission 恰好 5 行 evidence（`submission_id + slot` 唯一，service 单事务保证），任意文件存储失败 → 整单失败 + 已存文件 best-effort 清理，绝不产生部分 evidence 的合法 PENDING。
- **访问边界**：`/api/admin/hof/hundred/**` 要求 `HoF-admin` 或 `wotbtools-admin`（`SecurityConfig` `HOF_ADMIN_PATTERN`）。普通登录用户与匿名用户均无法读取审核证据（猜 ID 不可下载；下载端点校验 replayId 必须属于 submissionId）。
- **Legacy PENDING**：证据持久化功能上线前创建的旧 PENDING 无 evidence 行 → replay 列表返回空数组，审核 UI 显示明确提示「原始回放不可用，请拒绝并要求用户重新提交」；不伪造 replayAvailable、不报错。
- **机器验证与原始证据的关系**：现有 4 项机器验证（Parsed / GameID match / Vehicle match / Distinct battles）保留展示，但只是初审结果；管理员以原始截图 + 5 个原始 replay 为准做最终人工判断。

## API

| 端点 | 权限 | 说明 |
|---|---|---|
| `GET /api/hof/hundred?vehicleId=&page=&size=` | 匿名 | 单车辆独立排行榜（competition ranking 1,2,2,4，query-time 派生） |
| `POST /api/hof/hundred/submissions` | 登录 | multipart 提交（vehicleId/averageDamage/battleCount/screenshot/replays×5） |
| `POST /api/hof/hundred/submissions/{id}/cancel` | 登录（本人） | 用户撤销 PENDING |
| `GET /api/users/hundred/status` | 登录 | 个人中心：CURRENT / PENDING / 最近拒绝 |
| `GET /api/admin/hof/hundred/submissions` | HoF-admin/wotbtools-admin | 审核列表（status 过滤） |
| `GET /api/admin/hof/hundred/submissions/{id}` | 同上 | 审核详情（proofScreenshot 仅 PENDING 返回） |
| `GET /api/admin/hof/hundred/submissions/{id}/replays` | 同上 | 回放审核证据 metadata 列表（旧 PENDING → 空） |
| `GET /api/admin/hof/hundred/submissions/{submissionId}/replays/{replayId}` | 同上 | 下载单个原始 .wotbreplay（ownership 校验 + UTF-8 filename） |
| `POST /api/admin/hof/hundred/submissions/{id}/approve` | 同上 | 通过（approved 值可修正） |
| `POST /api/admin/hof/hundred/submissions/{id}/reject` | 同上 | 拒绝（原因强制） |
| `POST /api/admin/hof/hundred/submissions/{id}/delete` | 同上 | 删除 CURRENT（原因强制，不恢复 SUPERSEDED） |
