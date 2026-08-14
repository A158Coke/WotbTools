# 排行榜（Leaderboard）

> MVP 只记录录像者本人单场伤害成绩；schema 由 Flyway 管理。实现见 `wotb-web/.../leaderboard/`。

MVP 只记录**录像者本人**在某场战斗中用某辆车打出的**单场伤害成绩**，不存全场 14 人，不存 replay 原文件。当前后端为单一在线配置，启动依赖 PostgreSQL。

- **数据库配置**：`application.yml` 始终启用 DataSource/JPA/Flyway，`ddl-auto: validate`；本地开发需提供 PostgreSQL 与 `POSTGRES_PASSWORD`。
- **Schema 来源**：Flyway 迁移 `wotb-web/.../resources/db/migration/V1__init_leaderboard.sql` → `V14__booster_server_level_and_description_cleanup.sql`。**改表结构必须新增迁移**（下一版 `V15__...`），不要改已应用的 V1–V14；实体列与迁移列**逐列对齐**，否则 `validate` 启动即失败。
- **陪练需求与打手资格区服/等级**：`boost_request.region`、`booster_application.wotb_server` 与 `booster_profile.wotb_server` 都使用 `CN / ASIA / EU / NA` 四个规范值。客户需求由 `BoostRegion` 校验；打手申请从已绑定用户资料优先取得区服并保存真实值，审批或管理员创建时区服再固化到打手档案。玩家申请等级为 `CASUAL / SKILLED / ELITE / PRO / MASTER` 五档；内部兼容值 `AVERAGE_GOD` 在界面显示为“殿堂级”（英文 `Mythic`），仅允许管理员通过编辑已有打手授予。V14 等级 CHECK 锁定六个存储值，部分唯一索引保证每服最多一名殿堂级打手。`booster_application` 还保存两张截图、申请等级、QQ/微信、可接单频率、日在线时间和审核状态；这些申请元数据不得复制到 `booster_profile.description`。同一 Keycloak 用户只允许存在一个 `NEW`/`REVIEWING` 申请。审批通过由 `BoosterService` 先 flush `booster_profile`，再授予 Keycloak `booster` role；外层事务回滚会撤销新增 role。
- **打手资料双状态**：`booster_profile.status` 控制资格是否有效；`booster_profile.available` 控制是否手动暂停接单；`boost_request_assignment` 活跃记录数控制是否忙碌。分配打手时必须同时满足 `ACTIVE`、`available=true`、活跃订单数为 0。`GET /api/booster/assignments` 默认返回打手工作台所需的活跃订单详情（需求状态、联系方式、可安排时间、备注）；`GET /api/booster/assignments?includeHistory=true` 供个人中心回看活跃 + 历史订单，服务端会把仍未释放的订单排在前面；`PATCH /api/boost/boosters/my/availability` 允许打手本人切换是否接收新订单；`PATCH /api/booster/assignments/{id}/accept|start|complete|decline` 只允许当前打手操作自己的活跃订单。
- **仅随机战斗**：只有 `meta.json#arenaBonusType == 1`（随机）的战斗计入；训练房（==2）/娱乐/联赛等其他模式、以及模式未知（null）一律拒绝。`ReplayParser` 解析到 `Battle.arenaBonusType`，策略判断在 `LeaderboardService`。取值经真实样本核实（1=随机、2=训练房）。
- **录像者识别**：`meta.json` 无录像者 `accountId`，`ReplayParser` 仅给出 `Battle.recorder`（昵称）。`LeaderboardService` 按 `nickname.equals(battle.recorder)` 在 `players` 中匹配；匹配不到则跳过（不猜）。
- **去重**：唯一键 `(arena_id, account_id)` —— 同一场+同一玩家唯一；不同玩家/不同场各自成行。保存前 `findByArenaIdAndAccountId` 查重，并发冲突兜底捕获 `DataIntegrityViolationException`。
- **数据列**（V2 新增 `version`/`battle_time`）：`version` 来自 `meta.json#version`（游戏版本号如 `"11.18.0"`），`battle_time` 来自 `meta.json#battleStartTime` epoch ms（战斗实际发生时间），`created_at` 为上传时间。两新列均可 NULL（兼容旧数据）。
- **集成点**：`POST /api/leaderboard/upload` → `LeaderboardUploadService` → `ReplayCapacityLimiter` → `ReplayParser` → `LeaderboardService.saveIfEligible`。预览不落库、不触发上传限流。
- **API**：`POST /api/leaderboard/upload`（上传回放，限流），`GET /api/leaderboard/top-damage?page=&size=`（全局伤害榜），`GET /api/leaderboard/tanks/{tankId}/top-damage?page=&size=`（按车）。
- **解析边界**：最多 100 个回放、单文件 20 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务。ZIP/pickle/protobuf 还有独立预算，容量满返回 503 `REPLAY_BUSY`。
