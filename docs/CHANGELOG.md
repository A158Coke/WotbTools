# 技术版本历史

技术架构、基础设施、CI/CD、重构、代码质量变更。产品功能见 `CHANGELOG-PRODUCT.md`。

## [Unreleased]

### Added
- **Classic Profile 真浅色主题（Theme 计划）**：`useUiProfile` 现在把 profile 唯一派生到 `data-theme`（showcase→dark, classic→light），首屏内联脚本同步设置 `data-ui-profile` + `data-theme`（无 FOUC）；`styles/classic-profile.css` 由「仅去 AI 背景」升级为「完整浅色语义 token + namespace 覆盖」（`html[data-ui-profile="classic"]` 提供浅色 bg/card/text/border/accent/status/rating/tactical/scroll/shadow + `color-scheme:light`；同步 `--showcase-tactical*`；覆盖 topbar/user-menu/表单/表格 sticky/管理表/restoolbar 等写死深色面）；Showcase（默认）零回归；`data-theme` 不另立主题状态/开关/第二 localStorage key（禁 `useTheme`）。
- **选手详情侧栏非模态修复**：`PlayerDetailDrawer` 桌面/平板 backdrop 改 `pointer-events:none`（click-through）并移除 `aria-modal="true"`，移动端(<768px)经 `pd-modal` 恢复 modal veil+点击关闭；Grid 行 `select-player` 直达 `selectedPlayerContext`，Drawer 内容切换/表格高亮/左右箭头与导出快照同步。
- **双 UI Profile（Classic/Showcase）运行时与 CSS 门控**（纯前端）:
  - 新增 `src/composables/useUiProfile.js`：唯一状态源（reactive ref + `localStorage["wotb-ui-profile"]` 持久化 + `<html data-ui-profile>` 投影），非法值统一回退 `showcase`；`setUiProfile`/`toggleUiProfile` O(1) 切换，不 reload/remount。
  - `frontend/index.html` 首屏防 FOUC：默认 `data-ui-profile="showcase"` + 内联脚本按存储恢复 `classic`（与 `data-theme="dark"` 并存）。
  - `App.vue` 用户菜单新增「界面风格」分段控件（简约/沉浸，`aria-pressed`），登录/未登录均可用。
  - 新增 `src/styles/classic-profile.css`（main.js 最后导入）：按 `[data-ui-profile="classic"]` namespace 关闭全屏 AI 路景背景（`::after`/`::before content:none`）与装饰性 hero/uploadcard surface；Showcase（默认）零回归，无 `!important` 泛滥、无 specificity 堆叠。
  - i18n：`feature-messages.json` 新增 zh/en/ru `uiProfile.*`。
  - 测试：`useUiProfile.test.js` + `classic-profile-css.test.js`（§43A/B/D CSS source contract）；前端全量测试与 build 通过。
  - 说明：Classic 只去 AI/装饰背景与视觉噪音（视觉皮肤），结构/密度/布局与 Showcase 完全一致（见 docs/current-plan.md D1）；完整 `@layer` 三层重排留作后续低风险优化。
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
    `LeagueRatingDto` → preview 响应）；前端在存在 UNKNOWN 玩家时显示 quality warning
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
    `stickyLeft`、行 key 改 `account_id`；CwPlayerSummaryTable 删除未解构
    `stickyLeft`；LeagueSummaryTable 删除 stale `type` prop（ReplayPage 与测试同步）；
    测试 fixture 七维严格 7 值（含 invariant 断言）；Rating 格式统一到 helpers.js
    `ratingCellText` / `ratingTotalText` / `leagueMaxByKey`（单场表/CW 表/战队汇总/Drawer/导出共用，
    删除各组件重复的 ratingText/teamRatingText/ratingLine 分支与 LeagueSummaryTable 本地 DIM_KEYS 副本）。
  - **Radar 死 API 清理**：PlayerRatingRadar 删除假 `size` prop（viewBox 固定 300×300，geometry
    CENTER=150/RADIUS=120 不再伪装可配置）与未使用的 availableCount；测试断言固定 viewBox。
  - **统一玩家表与 league envelope 解耦**：unifiedRows/unifiedAllCols 存在性由 leagueMode 决定
    （不再 `leagueData ? ... : []`）——league envelope 存在但 0 评分的 CW 批次仍完整展示
    Replay Aggregate 玩家（Rating/七维补 "--"）；生产契约用例改为 leagueMode=true + envelope 存在
    + playerSummaries=[] + battle.league=null（不再把 leagueMode=true + league=null 当合法 fixture）。
  - **Drawer 定位 token 化**：.player-drawer `top: 56px` 硬编码 → `calc(var(--topbar-h) + 8px)`，
    ≤1080px 回退 `top: 8px`（topbar sticky + auto-height 无法固定对齐，CSS contract 优先）。
  - **注释与文档收尾**：变更范围内 production code/tests/docs 的过期注释与计划引用
    改写为领域语义（测试名改为行为描述）；
    删除仅服务单次人工验收的清单 `docs/verification/cw-rating-ui-acceptance.md`（浏览器人工验收
    不是合并门槛，长期回归由自动化测试与 CI 承担）。
- **Replay CW Rating UI 收口**：
  - **Rating 八维 → 七维**：`LeagueRatingCalculator` / `PlayerLeagueRating` 删除争霸占点评分
    维度（`MAX_OBJECTIVE` / `objectiveScore` / earned/seized index 全链路移除），射击效率满分
    50 → 100 补位，总分保持 1000；`LeagueColumns.DIM_KEYS/DIM_MAX` 同步为七维；
    `victoryPointsEarned/Seized` 降级为客观统计（不参与 Rating），新增
    points-independence 回归测试（争霸点数改变不影响 Rating）。
  - **获取点数事实化**：Replay Aggregate 新增 `earned` 累计（Agg.earned），汇总列新增
    `earned_total` / `earned_avg`（「获取点数总计」「获取点数/场」）；单场仍展示
    `victory_points_earned`（「获取点数」）；`victory_points_seized` 保留 backend fact、
    CW Rating 主 UI 不再展示（UI 列定义移除）。
  - **CW 玩家统一表**：新增 `utils/playerSummaryMerge.js`
    （accountId join，缺失 League 补 "--"）与 `CwPlayerSummaryTable.vue`；League 模式
    汇总页不再出现「基础 Aggregate 玩家表 + League 玩家表」两张平级表，统一玩家主表 +
    独立战队表。
  - **选手详情 Side Drawer**：新增 `PlayerDetailDrawer.vue`（右侧 overlay、
    backdrop/×/Escape 关闭、aria dialog、按 accountId 选择）与 `PlayerRatingRadar.vue`
    （原生 SVG 七轴、score/max 归一化 0–100%、detail 原始分/满分/百分比）；单场与汇总
    玩家行点击打开，Tab/selection 变化自动关闭。
  - **全列 ASC/DESC**：新增 `utils/tableSort.js`
    （normalizeMissing/compareValues/stableSortRows：numeric、自然字符串序、
    missing-last 与方向无关、raw sort、稳定）；BattleTable / AggregateTable /
    CwPlayerSummaryTable / LeagueSummaryTable 全部接入，team_name 按最终显示名排序。
  - **sticky 生命周期修复**：BattleTable 新增 `active` prop（父组件传
    activeTab 可见性），hidden→visible 后 nextTick + rAF 重测、ResizeObserver 监听
    nickname 列宽、width<=0 不覆盖有效 offset（禁止 0 width 污染）；ReplayPage 传
    `:active="activeTab === 'b' + i"`。
  - **文档**：league-rating.md 七维公式/占点不评分/统一表/Drawer/排序、versions.json
    v2.12.27（zh/en/ru）。
- **CW Rating UI 行为收口（Performance / 列契约 / 模式分离 / Radar / 导出 / 单场事实）**：
  - **Performance Metrics 保留在 CW**：league 列定义 / 单场 cells / Processing Job 与导出全链
    恢复 contribution/kast/impact（null → "--"），统一玩家表与 Drawer 表现指标区展示；不参与
    七维 Rating。
  - **CW 列契约**：统一玩家表只有 nickname + league_rating 固定（sticky 核心对），其余列
    （七维/MVP/表现指标/facts）经 useColumns cw scope（独立 storage，复用同一
    ColumnPicker/拖拽/持久化）控制可见性与顺序；sticky 核心对抽取 utils/stickyColumns.js
    （nickname=0 / rating=实测昵称宽，reorder/排序后重测）。
  - **CW 模式与 Rating 结果分离**：PreviewResponse 新增 leagueMode 显式字段；CW UI
    （Drawer/sticky/概览/Rating 列）由 leagueMode 决定，league 只决定本场 Rating 结果；
    Rating-ineligible 场 league=null 仍显示 "--"、点击玩家仍打开 Drawer，不伪造 MVP/战队 Rating。
  - **Drawer scope 语义 + 选中行 highlight**：Summary（批次中位数）与 Battle（本场表现）分区；
    表现指标为独立区域（不是 Rating）；Drawer 打开时当前玩家行按 accountId（Battle 加 arenaId）
    高亮（禁止 row index，排序后跟随同一账号），关闭 / Tab 切换 / selection 变化自动清除。
  - **样本语义**：统一表 cells.battles（解析场次）+ cells.rated_battles（评分场次）分开显示。
  - **总 Rating 只显示整数**：BattleTable（单元格 + 战队概览）、CwPlayerSummaryTable、
    LeagueSummaryTable、PlayerDetailDrawer、PNG 统一只显示整数（927）；七维「342 / 400 · 85.5%」；
    排序/MVP/中位数仍用未取整 raw。
  - **rated_battles 进入生产 Column contract**：leaguePlayerSummaryColumns 新增 rated_battles
    ColumnDef；前端 mergeCwPlayerColumns 的 LEAGUE_ONLY_KEYS 纳入；完整链 ColumnDef → Preview →
    merge → useColumns cw scope → ColumnPicker → 统一表 → Drawer。
  - **自定义 Radar**：utils/radarMetrics.js Radar Metric Registry（league 七维 score/max 来自
    后端 metadata、KAST/Contribution /100 稳定参考值，display-only）；Drawer「设置指标」面板
    （勾选 + ↑/↓，min 3 / max 8），偏好独立 localStorage（wotb-radar-metric-order），
    Summary/Battle 共用；axis 缺失 "--"，partial availability 提示，不影响 Rating。Impact 无稳定
    normalization 不入 Radar，仍完整保留在表格 / Drawer 表现指标区 / 排序 / 导出。
  - **League PNG 导出契约（最终：当前视图）**：PNG 克隆当前 DOM（当前可见列 + 顺序 + 排序 +
    战队名覆盖，所见即所得）；XLSX 保持完整数据、不受前端 ColumnPicker 偏好影响；Rating-ineligible
    场次 Rating/七维导出 "--"（只有真实 raw 0 才显示 0）。此前「PNG 全量列 + leagueExportTable.js」
    方案已撤销（见上方 closeout 条目）。
  - **单场 CW Unified Summary 事实**：Mapper.toPreviewResponse 改为
    shouldAggregate = battles.size() > 1 || league != null——CW/League 单场也生成基础 Replay
    Aggregate row（damage_avg/assisted_avg/kills_avg/earned_avg 由 Replay Core 权威事实得出，
    不伪装 unavailable）；Standard 单场保持旧语义（aggregate 空）。新增 ReplayServiceLeagueTest
    单场 rated/ineligible/standard 三用例，修正 merge 单测。
  - **一级 Workspace tabs 与 restoolbar 样式隔离**：battle 分栏规则作用域收窄到
    .restoolbar .tabs，.workspace-tabs 独立成紧凑单行导航（不再被 .tabs 通用规则误伤）。
  - **LeagueSummaryTable 排序修复**：战队汇总行按 ratingMedian/dimensionMedians 字段映射排序
    （raw 中位数排序生效）。
- **Replay Core / League Rating 业务边界加固（docs/current-plan.md）**：
  - **前端不再把 League Rating 校验失败显示成红色「文件解析失败」**：训练赛/联赛回放无法生成
    Rating 时，结果区改为琥珀色 warning 汇总（League Rating · 可评分 X / N · N 场未生成 Rating
    + [查看详情] 按稳定错误码分组、再展开具体文件与 arenaId，不默认铺满超长文件名）；真正解析
    失败仍显示红色错误（不降级）。三语 locale 新增 league.rated_count / unrated_count /
    failure_view / failure_hide。
  - **混合批次不再整体拒绝**：普通 + 训练赛/联赛混传时 League Rating 不聚合
    （league=null），全部可解析回放按普通回放语义成功返回——Processing Job READY、Preview 与
    标准导出可用；响应新增 leagueUnavailableCode=MIXED_LEAGUE_AND_STANDARD_REPLAYS，前端显示
    琥珀色提示。preview / Processing Job result / 同步与异步导出四条链统一。
  - **领域边界守卫**：新增 LeagueDomainBoundaryGuardTest——LeagueFailure ≠
    ReplayFailure、Battle ↔ Rating 按 arenaId identity 绑定（禁止数组位置）、混合批次不污染
    Parser；前端 Test 1–7 + mixed 用例落地。
- **战斗分析页改为单页 Workspace，AI 复盘 / 战局回放原地切换且不丢数据（docs/current-plan.md）**：
  - **ReplayPage 下半部分改造为可动态切换的 Battle Workspace**：新增「解析结果 / AI 复盘 / 战局回放」三个一级能力 tab（复用全局 .tabs 视觉），v-show 保持各面板挂载——切走再切回时解析结果、AI 复盘进度/结果、地图与战局回放播放器状态全部保留；顶部「回放数据提取 / 文件选择 / 解析控制」区域不变。
  - **入口全部改原地切换**：上传区的「战局回放 / AI 复盘」快捷按钮与结果 toolbar 的 battle-level 动作不再 navigate('reconstruction') 跨视图跳转，改为原地切到对应 Workspace 面板；目标文件直接复用当前 selection 内存文件（不重新上传、不重复解析、不跨视图交接）。多文件仍需显式选择目标 replay（禁止 fallback 第一场）；AI 复盘仍不自动消耗额度（进面板后手动发起）。
  - **逻辑拆分单一事实源**：从 ReconstructionPage 抽出 AiReviewPanel（SSE 分析流 call1/evidence/call2/autopsy + 流式进度 + AnalysisResultPanel）与 BattlePlaybackPanel（/api/replay/map-overview 地图区块 + MapOverview + AI seek 联动），ReconstructionPage 改为组合两者并保留独立深链入口（?view=reconstruction 与登录回跳不变）；独立页的「AI 战术复盘」发起按钮随拆分移入 AiReviewPanel，ReplayInputPanel 精简为纯文件选择面板。面板的登录兜底走 loginView prop（Workspace=replay / 独立页=reconstruction）。
  - **移除跨视图文件交接**：utils/replayTransfer.js（setPending/take/peek）已无调用方，删除；ReconstructionPage 移除 adoptPendingReplay / onActivated 接管逻辑。
  - **AI 报告时间链接**：原地切到战局回放面板并自动加载/展开地图后 seek（未加载先拉取、折叠自动展开、MapOverview 不被重建），独立页行为不变（滚动定位到地图区块）。
  - **三语 locale**：新增 workspace.tab_results / results_hint / ai_empty / playback_empty（zh/en/ru 同步）。
  - **测试**：ReplayPage 新增 Workspace 用例（tab 默认值 / 直接入口切换 / 切走切回状态保持 / 解析预览切回结果），v-show 可见性按 element.style.display 断言（happy-dom 的 getComputedStyle 不反映 inline style，与项目既有 v-show 测试一致）；FileUploader 直接入口改断言 workspace-action emit；ReconstructionPage 删除跨视图接管用例（特性移除）。


- **百场名人堂 WG 官方 API 自动认证链路**：保留原截图 + 5 回放人工审核端点，新增仅限 `wotb_verified` ASIA/EU/NA 身份的 JSON 提交链路。后端以固定白名单 host 调用 WG `account/info` + `tanks/stats`，冻结账号总场次、单车总伤害/场次与计算场均；账号总场次至少 5000、目标 Tier X 至少 100 场，MANUAL 使用原申报成绩、WARGAMING_API 使用官方快照。官方精确场均 `<=3900` 原子写入 CURRENT，`>3900` 自动创建无文件 PENDING 供管理员审核；审批端点不接收成绩数据，管理员只能通过、拒绝或删除，不能改写任何排名值。WG key 只从运行时 `WG_APPLICATION_ID` 注入 backend，端点受登录与 nginx 限流保护，失败零落库并引导原人工链路。
- **review-with-docs 集成 Alibaba OpenCodeReview（OCR）delegate mode（docs/current-plan.md）**：
  `review-with-docs` 重构为三层审查引擎——Layer A（Requirement/Plan Auditor，主代理自审 plan/requirements/acceptance criteria 完成度，OCR 无 finding 不代表性完成）、Layer B（OpenCodeReview Code Auditor，`ocr delegate preview/rule` 确定性文件筛选+规则解析，推理由主代理 DeepSeek 完成，不维护第二套 LLM 配置）、Layer C（Review Reconciler，去重/验证/重定级，BLOCKER/MAJOR/MINOR + Blocker count=0 完成条件不变）。外部调用方式不变（仍 `review-with-docs`）、current-plan 流程不变、blocker=0 语义不变；新增 `.opencodereview/rule.json`（WotBTools-aware 首版少量规则：Java/Spring、Vue 前端 + replay invariant、Keycloak SPI、CI/deploy）；验证 Case 1–6 并明确 deterministic/agent-level 边界（scripts/ocr-verify/）：deterministic tests（verify-ocr.ps1，可重复、无 LLM）覆盖 merge-base 多 commit 范围（Case 5）、项目规则命中（Case 1 确定性部分）、no-diff reviewable=0（Case 6）、OCR 失败非零退出码（Case 4 确定性部分）；agent-level scenarios（主代理按 skill 执行并记录）覆盖 NPE bug 完整检出闭环（Case 1）、requirement 遗漏 MISSING/BLOCKER（Case 2）、OCR false positive 拒绝/降级（Case 3）、OCR failure 的 plan audit 继续 + review incomplete 处理（Case 4）。OCR 固定版本 `@alibaba-group/open-code-review@1.9.10`（Apache-2.0）。未新增 GitHub OCR Action、未增加用户人工步骤。
- **Replay 解析预览改为 Replay Processing Job（回放处理升级为 Job，Preview/Export 共享解析结果）**：
  - **后端**：新增 `POST /api/replay/processing-jobs`（202 返回 jobId；HTTP request 不等待解析；创建时校验并持久化上传输入，绝不在异步 worker 持有 `MultipartFile`）、`GET /api/replay/processing-jobs/{jobId}`（真实 `processed/total` + `valid/duplicates/failures` + `currentFile` + 终态 `errorCode`）、`DELETE .../{jobId}`（QUEUED 立即终态并释放 executor queue slot / PROCESSING 协作取消）、`GET .../{jobId}/result`（READY 后返回 Preview 数据，**不再重新 process replay**）。状态机 QUEUED→PROCESSING→READY/FAILED/CANCELLED 终态 exactly once；Phase 仅 PROCESSING_REPLAYS（有真实进度，不为无观察价值的阶段造假 phase）；0 场有效 → FAILED `NO_VALID_REPLAYS`。
  - **共享 ProcessedDataset（Strategy A 内存缓存）**：worker 完成后 enrich 一次（PotentialDamage + populateBattle）并缓存已处理的 authoritative Battle（仅结算战绩，不携带 reconstruction 事件流；34/50 场 heap 成本可接受），TTL 30 分钟（`REPLAY_PROCESSING_JOB_TTL_MINUTES`，默认与 Export 一致）；Preview result / Export 直接复用，**同一批 34 个回放 Preview+Export 的 processFull 总调用数 = 34（不再 ×2）**。
  - **Export 复用 result（引用计数生命周期）**：`POST /api/replay/export-jobs?processingJobId=...` 创建 Export Job 时引用 Processing Job result（不重新上传 replay、不 processFull，直接生成 XLSX/ZIP）；Export 创建时对 result `acquire` 引用计数、终态 `release`（活跃 Export 期间 Processing result 不被 TTL 清理，不出现「Export 进行到一半 result 消失 FAILED」）；404 `PROCESSING_JOB_NOT_FOUND` / 409 `PROCESSING_JOB_NOT_READY`。
  - **复用既有 Job 基础设施，不复制两套**：抽取通用 `ReplayJobState`（状态机）/ `ReplayJobStorage`（目录+TTL sweeper+孤儿清理）/ `ReplayJobFiles`（输入顺序/惰性 Source），ExportJob/ExportJobStore 组合重构（公共 API 与行为不变，18 个既有测试零改动通过）；Processing Job 与 Export Job **共用同一有界 worker 池**（2/4，满载 503 `PROCESSING_QUEUE_FULL`），worker 仍获取全局 `ReplayCapacityLimiter` 许可（`max-concurrent-jobs=2` 不提高）；batch 内 replay 保持上传顺序串行（N__ 前缀整数排序）。
  - **指标与日志**：`wotb_replay_processing_job_created_total` / `files_total` / `queue_wait_seconds` / `duration_seconds` / `result_total{result=ready|failed|cancelled}` / `processing_file_duration_seconds`（低基数，无 jobId/filename/username/arenaId tag）；生命周期日志 `processing_job_created/started/ready/failed/cancelled/cleaned`（progress 仅 DEBUG，终态 exactly once）。
  - **前端**：解析预览改走 Processing Job——`useReplay` 新增 startProcessingJob/cancelProcessingJob/dismissProcessingJob（创建→1.5s 轮询真实进度→READY 自动拉取 result 展示）；统一 `ReplayTaskCard`（Processing/Export 同一视觉体系）替换旧 ExportTaskCard；READY 后点导出自动传 `processingJobId`（不再重新上传 34 个文件）；上传区文件列表默认折叠（34/50 文件显示「N 个文件 · 总大小」+ 查看文件列表，内部 scroll，长 filename 截断 + title）。三语 locale 新增 `replay.processing_job.*` / `upload.files_size` / `upload.view_list` / `upload.hide_list`。
  - **测试**：后端新增 `ReplayProcessingJobServiceTest` 13 项（lifecycle/progress/34 场上传顺序/exactly-once processFull/result 不二次解析/QUEUED+PROCESSING 取消/NO_VALID_REPLAYS/TTL 引用计数）+ `ReplayExportJobServiceTest` 新增 4 项 from-result 复用（facade processFull 零调用验证）；前端 useReplay/ReplayPage/ReplayTaskCard 测试同步（Processing 真实 18/34、READY 自动展示、export 传 jobId 不重新上传）。
  - **文档**：java/README.md 新增 Replay Processing Job API 段；CHANGELOG-PRODUCT 记录用户可见变更；旧同步 `POST /api/preview` 保留（向后兼容，deprecated）。
- **Frontend V2 UI/UX 重构（docs/current-plan.md Phase 1–6）**：建立 Design Tokens 单一事实源（src/styles/tokens.css，原 App.vue 内联变量迁移 + 新增 Layout/Spacing/Radius/Z-index/Typography/Tactical 阵营色 token，删除未引用 theme.css）；新增四类 Layout Primitives（layout-content / layout-wide / layout-data-workspace / layout-full-workspace）；App Shell 导航重排——「回放解析」与「AI 复盘」合并为「战局分析」一级入口，utility 收进右上角 user menu（useAuth 接入 App.vue，provide navigate 供子页跨视图跳转）；ReplayPage 结果区改近全宽，Battle context 新增「战局回放 / AI 复盘」高权重动作，文件经 utils/replayTransfer.js 单例跨视图传给 ReconstructionPage（take 语义接管，playback 模式自动加载地图）；HoFPage 改 Wide Layout（1600px）+ 上传收敛为「提交记录」Modal；ProfilePage 改 Content Layout（1280px）+ Hero 移除 Logout；ReconstructionPage 外层改近全宽 + AnalysisResultPanel 阅读限宽。三语 locale 同步新增 action.battle_playback/ai_review、home.uploadReplay/analysisTitle/analysisDesc、hof.submit_entry。测试同步（HoFPage 上传用例改 modal 路径、App.test useAuth mock 补全）。

- **PR #119 评审闭环修复**：①用户菜单改 Teleport 到 body + fixed 定位（脱离 .topbar overflow 裁切，桌面/平板/手机完整显示，外部点击/Escape 关闭）；②ReplayPage Battle actions 增加登录门控——未登录点击「战局回放 / AI 复盘」先在当前页明确提示（登录后需重新选择回放），不再静默跳转丢 File；已登录 SPA 内跨视图交接不变（playback 自动加载地图、ai 只接管文件，不写 localStorage）；③导航入口三语改「战局分析 / Battle Analysis / Анализ боя」（新增 app.analysis_tab，保留 replay_tab 不动）；④页面级 warn/error 提示改独立 .warn/.error 类（不再依赖 .wrap 容器，亮/暗主题 token 生效）。新增测试：App 用户菜单 6 项（桌面/834px/375px/外部点击/Escape/开关）、ReplayPage Battle 登录门控 6 项、ReconstructionPage 接管 5 项（已登录 playback 自动地图/ai 只接管/KeepAlive 返回/连续接管/未登录不消费）。


- **Replay 批量导出改为 Export Job（长任务 UX 架构）**：新增 `POST /api/replay/export-jobs`（202 返回 jobId；创建时即校验并把上传输入持久化到 job 临时目录，绝不在异步 worker 持有 `MultipartFile`）、`GET /api/replay/export-jobs/{jobId}`（真实 `processed/total` + `phase` + `duplicates/failures` + 终态 `errorCode`）、`DELETE /api/replay/export-jobs/{jobId}`（QUEUED 立即终态 / PROCESSING 协作取消，安全 checkpoint 后终态）、`GET /api/replay/export-jobs/{jobId}/download`（`FileSystemResource` streaming，不再 `ByteArrayOutputStream` + 大 `byte[]` 全量驻留）。`Replays.collect` 新增可选逐文件进度回调（4 参重载，3 参/2 参旧调用不变；每个输入恰好回调一次，成功/重复/失败都推进 processed）。内存态 `ExportJobStore`（单实例部署，TTL 30 分钟清理终态 job 与临时目录，启动清理孤儿目录）+ 有界 worker 池（2 并发 / 4 排队，满载 503 `EXPORT_QUEUE_FULL`）；worker 执行前仍获取全局 `ReplayCapacityLimiter` 许可（`max-concurrent-jobs=2` 不变，job 化不绕过全局容量）；batch 内 replay 仍串行（不引入 parallelStream/VirtualThread）。0 场有效 → FAILED `NO_VALID_REPLAYS`（不生成空 Excel）。单场 XLSX sheet 顺序改为 玩家数据/战斗信息/原始字段 且默认打开「玩家数据」。指标 `wotb_replay_export_job_duration_seconds` / `queue_wait_seconds` / `result_total`（低基数，无 jobId/文件名 tag）。旧同步 `POST /api/export` 保留（向后兼容，未删除）。 **PR #118 两处 blocker 修复**：① QUEUED 取消不再只改业务状态——`ReplayExportWorkerExecutor` 保存 jobId→Runnable 句柄，`cancel` 经 `ThreadPoolExecutor.remove(Runnable)` 把尚未执行的任务从有界队列移除（立即释放 queue slot，新 job 不再误报 `EXPORT_QUEUE_FULL`；已 dequeue/运行中的任务 remove 返回 false，由协作取消在 checkpoint 终态，绝不再执行已取消任务）；② `mode=each` 改为逐场流式：每场 `processFull → enrich → metrics → writeSingle 写入 ZIP entry → 释放 Battle`，working set O(1)（不再全批次保留 `List<Battle>`），全程 phase=`BUILDING_ARCHIVE`（UI 不显示假的「全部解析完才开始生成」）；FAILED/CANCELLED 终态删除 partial artifact（不暴露半包）。

- **百场提交会话草稿与回放累计选择**：`HoFPage` 不再在打开/关闭提交弹窗时重置表单，车辆、数值、截图 base64 与 `File[]` 在当前组件生命周期内保留；回放选择按 `name + size + lastModified` 去重并分批追加至 5 个，非法/重复/超限批次不会清空既有文件，支持截图/回放逐项移除与显式确认清空。FileReader 使用 generation 防止过期回调覆盖新截图；提交失败保留草稿，成功后统一 reset。未新增浏览器持久化、服务器预上传或 API 变更。
- **Contribution / KAST / Impact 正式并入回放解析结果**：单场玩家表直接新增「贡献度 / KAST / Impact」三列（来自 `PerformanceMetricsCalculator.battleMetrics`，与跨场聚合共用同一公式与同一 `Battle`/`PlayerResult` facts，绝不二次解析/二次计算）；删除独立「战斗表现」tab 与 `PerformanceTable` 组件、`PreviewResponse.performance`/`performanceColumns` 字段、`PerformanceRow` DTO 与 `Mapper.toPerformance`；跨场聚合（汇总）新增 contribution/kast/impact/multi_damage_rate/traded_deaths 五列（`Mapper.toAggregate` 按 accountId 合并 `PerformanceMetricsCalculator.compute` 结果）。`impact` 契约由带 `%` 的字符串统一为数值（前端负责格式化 `%`），排序保持 numeric。HP UNKNOWN 时单场/汇总的 contribution/kast/多伤率输出 null（UI 显示 `--`，不再冒充 0）；`Row.hpEligible` 标记是否存在 HP 已知场次。Excel 单场「玩家数据」/汇总「汇总」同步新增对应列（`Columns.STAT` + `AggregateSheets`）；**preview / export / mode=each 三条链统一走 `Replays.collect(..., processFull, ...)`（同一 authoritative full processing：reconstruction + ObservedMaxHp + DeathTimeReconciler），再 `populateBattle`，保证 Excel 与网页 Contribution/KAST/Impact 同源**。三语 locale 同步（player_labels/agg_labels 新增键，删除 performance_labels/performance_tab）。
- **统一 Replay Authoritative Facts，移除 Rating V2 综合评分**：回放事实（HP / 潜在伤害 / trade / 场均 HP）全部收敛到 replay 管线（新增 `replay/facts/BattleHpFacts` + `TradeFacts`，复用 `ObservedMaxHp`/权威 `survivalTimeSec`）；`RatingAnalyzer` 重命名为 `PerformanceMetricsCalculator`（纯派生计算、只读，删除 `finalRating`/权重/`estimatedHp`/2400 fallback）。旧 WN8 式 `Rating`/`RatingConfig`/`PlayerResult.rating`/`rating_avg`/`common/rating.json`/`GET /api/rating` 与 Excel「评分」列全部删除；`POST /api/rating` → `POST /api/performance`，返回贡献度 / KAST / Impact / 潜在伤害 / 协助 / 击杀 / 多伤率 / 存活率 / 互换击杀。前端删除 RatingModal / 评分 badge / 最高评分统计，扩展页重构为「战斗表现」。
- **战斗表现并入回放解析，HP unknown fail-closed**：删除独立 `POST /api/performance` 端点与 `/extended` 页面/路由/导航；`/api/preview` 统一完整处理链一次产出基础战绩 + 汇总 + 战斗表现，前端 ReplayPage 新增「战斗表现」tab，`?view=extended` 旧深链 canonical redirect 到 `?view=replay`。`BattleHpFacts.averageHp` 改为返回 provenance-aware `BattleAverageHp(value, complete)`：存在 HP UNKNOWN 时场均 HP unavailable（禁止按 0 参与），依赖 HP 的衍生指标（贡献度击杀项/KAST/多伤率/场均 HP）按 HP 已知场次 fail-closed，原始权威数据照常。
- **BattleHpFacts 要求完整 14 名参战玩家才 complete**：场均 HP 的 `complete=true` 仅当有效参战玩家（team 1/2）数量 == 14 且全部 HP known；不足 14 人（如 4 人/13 人）一律 unavailable，禁止部分玩家 total/14 冒充权威均值。测试 fixture 全部改为完整 14 人（新增 13/14、4/14、0 玩家、null battle 用例）。
- **名人堂单场管理筛选可读化**：`GET /api/admin/hof` 移除 Arena ID 筛选并不再返回 `arenaId`/原始 `arenaBonusType`；新增受 HoF-admin 保护的 `GET /api/admin/hof/vehicle-options`，从当前名人堂已有车辆生成名称、国家/系别、车种、等级的稳定英文枚举选项。国家/系别、车种、等级可按任意顺序独立真实筛榜，并共同收窄车辆名称；选择车辆后再与 `tankId` 取交集。车辆库无法识别的旧记录保留其原始名称并归为 `OTHER`，不会丢失筛选入口。
- **战局回放 Details Panel 增加 Tier X 车型图**：从 BlitzKit 公开 CDN 确定性下载 Tankopedia
  全部 84 辆十级车的透明 WebP 车型图并随前端发布；选中车辆时按 tankId 懒加载，非十级车、
  缺图或加载失败静默降级，production 不访问 BlitzKit。新增 Tier X 100% 图片覆盖测试与
  `blitzkit-references.mjs --emit-portraits` 可重复生成入口。

### Fixed

- **CW / Training Replay Rating 名册完整性收口（PR #132 追加，真实 0/N 根因修复）**：
  - **根因**：LeagueRatingValidator 直接引用全局 Battle.rosterComplete（#201 全集合 == #301 全集合）
    作为准入门槛；真实训练赛/联赛名册 #201 可含不属于 #301 的 non-combatant 记录
    （probe：20260725_1535 训练房 #201=15 / #301=14，extra 账号 3117047709 无 #301 settlement）——
    #201=15 / #301=14 的合法训练房被误判 LEAGUE_ROSTER_INCOMPLETE，整批 0/N Rating。
  - **修正（最终方案：League 专属证据，不弱化全局契约）**：
    - <b>全局 Battle.rosterComplete 保持严格 fail-closed 语义不变</b>（#201 全集合 == #301 全集合 +
      队伍一致）——它是 SURVIVOR_SETTLEMENT / annihilationSuffix / pointsEndReason 等 AI 完整结算
      推断的前提，名册存在无法证明为 spectator 的 extra（如 #201=4/#301=3）时不得视为完整；
    - 新增 <b>League 专属证据</b>：Battle.settlementAccountsCoveredByRoster（#301 每个结算账号都
      在名册 #201 中，无幽灵结算）+ Battle.settlementRosterTeamConsistent（名册队伍与结算队伍一致，
      存在时），由 LeagueRatingValidator 判断——标准 7v7 且 #301 完整 14 人时 extra 不导致
      ROSTER_INCOMPLETE；其余门槛（14 人 7v7 / unique 账号 / tankId / 明确胜方 / 死亡时间 / 数值
      关系）不变，ROSTER_INCOMPLETE 只留给真实 mismatch（幽灵结算、队伍冲突）。
  - **真实 probe 证据**（RosterCompletenessProbeTest，common/data 本地样本自动跳过）：
    random×1 / tournament×4 / 11.19 Maus 均 #201=#301=Type0=14；20260725_1535 训练房
    #201=15 / #301=14 / Type0=15（extra=3117047709 无 #301 settlement）。修复后该训练房全局
    rosterComplete=false（严格）、League 专属证据完整 → Validator PASS（修复前
    LEAGUE_ROSTER_INCOMPLETE），其余样本零回归。
  - **测试**：ReplayParserTest（extra→全局严格 false + League 专属 true、幽灵结算→双 false、
    队伍冲突→双 false、全等→双 true）、LeagueReplaysTest（#201=15/#301=14 rated、多场合法 CW
    playerSummaries/teamSummaries 非空）、LeagueRosterCompletenessTest（<b>真实 CW fixture 入库
    common/fixtures/replays/（15/14 训练房 + 14/14 tournament），CI 无条件全链路</b>：14 个 Player
    Rating、七维度 0-max、Team 1/2 Rating、MVP、两队最佳、#201>#301 断言、真实双份 collect →
    summaries 非空）+ AI fail-closed 回归（CW 15/14 全局 rosterComplete=false → 不推导点数/存活
    结束方式、无全歼推断，PR #73 boundary 不放松）。
  - **文档**：protocol.md / replay-data.md / replay-parsed-fields.md / league-rating.md 同步——
    全局 rosterComplete 严格契约保持，「任何 #201 extra 都是观战者」不表述为 universal rule，
    仅记录证据边界（标准 7v7 且 #301 完整 14 人时 extra 不属于 14 名 settled combatants）。
- **Replay 汇总空数据 + 超宽表格重叠修复**：
  - **League 模式恢复基础 Replay Aggregate**：Mapper.toPreviewResponse 在 League 模式下不再输出空
    aggregate——多场时按标准路径计算并输出基础跨场汇总（Aggregator.aggregate +
    PerformanceMetricsCalculator.compute，同一 Replay Core 数据），League Rating Summary 是附加
    分析而非替代品（resp.aggregate 有数据时 League 模式不再隐藏 AggregateTable）；aggregateColumns
    用 League 变体（保留跨场 contribution/kast/impact）。
  - **汇总人数语义修复**：replayAggregatePlayerCount 一律取 resp.aggregate.length（Replay Core
    基础汇总人数），不再在 League 模式改用 league.playerSummaries.length——0 场可评分 ≠ Replay
    没数据，「汇总（0 名选手）」误导消失。
  - **汇总 Tab 双区块**：ReplayPage 汇总 Tab 拆为「基础战斗汇总（AggregateTable）」+「League Rating
    汇总（LeagueSummaryTable player/team）」两个独立区块（League 模式下并存，非二选一）；summaries
    全空时 League 区块显示明确 neutral 空态「暂无可评分场次」，LeagueSummaryTable 空行不再只显示
    '--'。
  - **超宽表格横向滚动 / sticky 列重叠修复**：.tablewrap 显式成为 scroll container
    （position:relative + overflow-x:auto + max-width:100%）；sticky 第一列禁用 background: inherit
    （行背景半透明 rgba(13,19,22,.82) 导致横滚时后方列从 sticky 列下方穿透），改为与 t1/t2 行背景
    同表达式的 opaque color-mix + hover 不透明背景；League 表 sticky 层级修正（scoped
    .league-table th.sticky-col z-index 3 → 7，不再低于普通表头 5——普通表头横滚时不再覆盖固定
    玩家/Rating 列）；排序箭头改变表头宽度后重新测量 Rating sticky 左偏移。
  - **Toolbar 响应式**：.restoolbar 由 grid minmax(0,1fr) auto 改为 flex 自然换行（空间不足时
    actions 整行换到 tabs 下方，不再把 tabs 挤压到 0 宽）；sticky toolbar 背景不透明度 82% → 96%。
  - **三语 locale**：新增 result.base_summary_title / league.summary.section_title /
    league.summary.no_rateable（feature-messages.json，zh/en/ru 同步）。
  - **测试**：backend ReplayServiceLeagueTest.leaguePreviewCarriesBaseReplayAggregateAlongsideLeagueSummary
    （League 模式基础汇总与 League 汇总并存 + 列边界不变）；frontend replayView / ReplayPage /
    ReplayPageReadyFlow / LeagueSummaryTable / BattleTable 回归（Case A 0/30、Case C partial 双区块
    并存、tab 人数来自 aggregate、League 空态、sticky 结构契约）。
- **生产「名人堂管理」页顶部三 Tab（记录 / 操作日志 / 百场审核）不可见——真正根因是 CSS cascade，不是浏览器缓存**：
  - 真正根因：`frontend/src/styles/showcase-regressions.css` 在 `main.js` 中最后加载，把
    `.hof-admin-tabs` 从 canonical（`showcase-rankings.css`）的 `position: sticky; top: 66px; z-index: 22`
    覆盖为 `position: relative; z-index: 5`，但 rankings.css 的 `top: 66px` 偏移残留——Tab 被下移
    恰好落入 `.hof-admin-filters`（同为 relative + z-index 5）区域，后绘制的 filters 把 Tab 盖住；
    移动端 `position: static` 同样被该 override 破坏。DOM 测试全绿但生产 UI 不可见即由此而来。
  - 修复：从 `showcase-regressions.css` 的 override 中彻底移除 `.hof-admin-tabs`（只保留
    `.hof-admin-filters`），让 Tab 恢复 canonical 的 sticky 布局——Desktop sticky top 66px /
    Tablet sticky top 64px / Mobile static；不新增第二套 Tab 定义、不加 `!important` 堆叠。
  - 回归测试：新增 `frontend/src/styles/hof-admin-tabs-css.test.js` CSS source-contract 测试——
    断言 rankings.css 保持 canonical sticky/偏移规则、regressions.css（最后加载）不再引用 tab
    strip、main.js 加载顺序不变；DOM 测试（三 Tab 存在且可点击）原样保留。
  - 勘误：此前 PR #130 将本问题归因于浏览器缓存并加 nginx Cache-Control 与 build identity——
    缓存策略与构建版本标识本身仍保留（属基础设施加固），但本问题的根因是上述 CSS cascade，
    并非缓存。部署新版本后 Tab 不可见的现象系样式覆盖所致，与旧 bundle 缓存无关。
- **生产「名人堂管理」页顶部三 Tab 缓存根因修复（PR #130，见上勘误：非本问题真正根因）**：
  - 根因（原记录，已勘误）：`deploy/nginx/nginx.conf` 的 `location /` 未设置任何 Cache-Control——浏览器把旧 index.html 及其引用的旧 hash bundle 当作可缓存资源，部署新镜像后仍加载旧 JS，导致 `?view=hof-admin` 显示旧版页面（无 `.hof-admin-tabs`），百场审核入口丢失；构建/部署产物经实证无问题（生产运行 `sha-305d7ac3` = 含百场审核源码的 main HEAD）。

  - 修复：SPA 缓存策略——`location = /index.html` 加 `Cache-Control: no-cache, no-store, must-revalidate`（每次重新验证，新 bundle hash 部署后立即生效）；`location /assets/`（Vite 内容 hash 产物）加 `Cache-Control: public, max-age=31536000, immutable`；静态资源 404 不再 fallback 到 index.html（`try_files $uri =404`）。
  - **Build identity（防再猜版本）**：`vite.config.js` 注入 `__BUILD_COMMIT__` / `__BUILD_TIME__`（git rev-parse --short + ISO time，无 git 时降级 unknown），build 时生成 `dist/version.json`，`main.js` 启动 console 输出 `[build] commit=... time=...`——生产页面异常时可立即核对实际 bundle 版本。
  - **回归测试**：`HoFAdminPage.test.js` 新增显式断言——authorized 用户必须渲染三 Tab（`hofAdmin.recordsTab / hofAdmin.auditTab / hundredAdmin.tab` 顺序固定），防未来 UI refactor 再次丢失审核入口。
  - **P0：League Rating 校验失败不再删除成功解析的回放（Replay parsing validity ≠ League Rating eligibility）**：
  - 根因：`LeagueReplays.collectLeague` 把「仅 Rating eligible 的场次」当作结果集 battles 返回（Rating 校验失败经 `continue` 从最终集合消失），`ReplayProcessingJobService` 以 `c.battles().isEmpty()` 判定 `NO_VALID_REPLAYS`——全部 replay 成功解析但全部 Rating 不合格时，Processing Job 错误 FAILED 并提示「没有可用的回放文件」。
  - 领域分离：`LeagueCollectResult.battles` 恢复为「去重/冲突后全部成功解析的 Battle」（可进 Preview/Export 基础数据）；Rating 只对通过 `LeagueRatingValidator` 的场次计算（`LeagueRatingBatch.battleResults` 与批次汇总只含 eligible）；校验失败以 `LeagueFailure` 稳定错误码（`LEAGUE_*`）返回，不再触发 `NO_VALID_REPLAYS`（该错误码仅保留给「所有 replay 真正解析失败」）。
  - 稳定 identity：`LeagueRatingResult` 新增 `arenaId`；`LeagueRatingBatch.resultFor(arenaId)` 按 identity 绑定 Battle ↔ Rating，消除 `Mapper.toPreviewResponse` / `ReplayService` 导出 / `ReplayExportJobService` / `LeagueAggregateSheets` 的数组 index 绑定（battles.size() 可大于 battleResults.size()，禁止 index 错位/IndexOutOfBounds）。
  - 进度语义：Rating-ineligible 但已解析的文件 progress 报 `SUCCESS`（可预览），不再计入解析失败；job `valid` = 成功解析并可进入 Preview 的 replay 数。
  - 导出：单场 league 未通过校验回退普通单场工作簿（基础数据仍可导出，不 NPE）；each 模式跳过未评分场次；汇总 Excel「每场明细」只含 eligible，「战斗列表」列出全部 battle 且 ineligible 场显示真实 failure 文案（不重复行）。
  - 测试：新增 core `LeagueReplaysTest`（Case A 全 eligible / Case B 部分不合格保留 / Case C 全不合格仍 READY / progress SUCCESS 语义）、`ReplayProcessingJobServiceTest`（全部 League 不合格 Job READY、partial ratings）、`ReplayServiceLeagueTest`（partial Preview identity 绑定、单场不合格导出回退）、`LeagueExcelExportTest`（partial 汇总导出不崩溃不错位）；修正 `invalidSevenVsSevenReportedAsFailureOthersContinue` 旧断言（battles 保留 bad 场）。
- **WG 首次登录可直接提交百场认证**：`HundredWargamingSubmissionService` 先验证可信 JWT，再复用 `UserProfileService.syncFromLogin` 原子创建或刷新 WARGAMING Profile，随后仍执行 JWT 与数据库 Profile 的完整交叉校验后才查询 WG stats。同步冲突或失败保持 fail-closed，绝不调用外部 stats 或创建 submission。
- **Replay Processing Job review 闭环修复（PR #121 correctness/concurrency 3 项 blocker）**：
  - **文件集合变化立即失效旧解析结果（Blocker 1）**：前端新增统一 `updateFiles` 入口（FileUploader 任意 add / folder-add / remove / clear / replace 事件都走它），任何 files 变化立即置空 `processingJobId` 与已展示的 `resp`（防止「UI 显示 dataset A、files 是 dataset B、Export 复用 A」）；正在处理的旧 Job 停止轮询并后台协作取消（释放 queue slot / 容量）；`pollProcessingJob` 以 `processingPollJobId` 作 request token + `selectionRevision` 作 revision，丢弃迟到/过期的 READY 响应（P1 处理中 files 改变 → P1 随后 READY 不得覆盖当前 selection）；Export 复用仅当 `resultMatchesSelection`（processingJobId 与 resp 成对存在），否则走 legacy 上传当前 files，绝不静默导出旧 dataset。
  - **from-result each 的 valid 语义修复（Blocker 2）**：`processEachFromResult` 的 NO_VALID_REPLAYS 判定由 `processed - failures <= 0` 改为 `ds.validCount() <= 0`——`ds.battles()` 本身就是 Processing 阶段排除 duplicates/failures 后的有效场，failures 不得再与其相减（否则 1 valid + 1 failure 会被误判为 NO_VALID_REPLAYS）；duplicates/failures 只用于进度与终态统计。新增测试：1v1f / 1v2f / 2v5f / 0v（each + aggregate）全路径。
  - **ProcessedDataset READY 后消费者只读（Blocker 3）**：移除 from-result Export path 的重复 `enrichFacts`（PotentialDamage.apply + populateBattle）——共享 Battle 不再被 Preview/Export 消费者二次 mutate（并发 GET result / aggregate Export / each Export 同一 Battle 不再有 shared mutable write）；`ProcessedDataset` record 构造器加 `List.copyOf` 防御性拷贝（collection structure 不可变，Battle 本体仍 mutable，不重写整个 model）；facts 层 enrich 只由数据集创建方保证（`ReplayProcessingJobService.processJob` 与同步 preview 的 `ReplayService.previewWithinPermit`），`Mapper.toPreviewResponse` 改为只读消费。新增无-mutation 回归测试（未 enrich dataset 导出后 potentialDamage/contribution 仍为初始值）。
  - **stale P1 error 不停止新 P2 polling（Blocker 4）**：`pollProcessingJob` 的 catch 与 success path 一样加 `processingPollJobId !== pollJobId` token guard——旧 job 的迟到失败（网络 reject / 404 / timeout）不再无条件 `stopProcessingPolling()` 清掉新 job 的 timer/token（此前 P1 request 在途 → files 改变 → P2 建立 polling → P1 迟到 reject 会把 P2 polling 永久停掉，P2 后端继续跑但前端永远不显示 READY）。旧 job 的任何 success / READY / FAILED / reject / 404 / timeout 都不影响更新后的 Processing Job。新增 deterministic 测试（controlled pending Promise + fake timers：P1 迟到 reject 后 P2 仍能 PROCESSING 更新 + READY 加载 result，processingError 不被覆盖）。
  - **Processing result 引用所有权生命周期（Blocker 5）**：`ReplayExportJobService.createJob` 重构为「acquire → try prepare（job 目录 / register / submit）→ ownershipTransferred=true → finally 未接手则 release」——acquire 成功后任何在 worker 正式接手前的失败（Export job 目录创建 IOException / submit rejection）都 release 引用，不再泄漏 refcount（否则 `ReplayProcessingJobStore` TTL sweeper 永远跳过该 dataset，一次失败就让整个 ProcessedDataset 永久驻留 heap）；worker 终态 / QUEUED remove 取消的 release 语义保持 exactly once，不 double-release。新增 lifecycle balance 回归测试 4 项（storage failure / successful / queued cancel / submit rejected → 均 release → TTL 可清理）。
- **Replay 批量导出：34+ 回放保持上传顺序、ZIP 写失败不再产出损坏包（PR #118 correctness）**：
  - **输入顺序修复（Blocker 1）**：createJob 把上传持久化为 `N__name`，原 `Files.list().sorted()`
    是整名字符串字典序，10+ 时顺序变成 `0,1,10,11,…,19,2,20…`；现改为按 `__` 前数字前缀整数
    排序（`listInputsInOrder`/`inputOrder`），严格保持 `MultipartFile[]` 上传顺序——aggregate 的
    battleSourceNames / 战斗列表「文件名」列与 mode=each 的 ZIP entry 顺序均与上传顺序一致；无法
    解析前缀的文件排最后（防御性，不插入有效顺序中间）。
  - **mode=each 异常边界拆分（Blocker 2）**：原单个 `catch(Exception)` 同时吞掉「该场 replay 无效」
    （processFull/reconstruction/NO_BATTLE_DATA → failures++ 跳过继续）与「artifact/ZIP 写失败」
    （应整个 job FAILED）；现拆为两个边界——只有 replay processing/enrichment 失败才转为
    failures++；Battle 成功后 zip entry / POI / filesystem / OutputStream 任何失败 → 整个 job
    FAILED，partial ZIP 由 finishTerminal 删除、绝不 READY。新增 `writeSingleExcel` 最小测试
    seam（测试注入写失败，不引入大型抽象）。
  - **QUEUED 取消 terminal observability exactly once**：被 `removeQueued` 移除的任务 Runnable
    永不执行，worker 不会走到 finishTerminal → cancel 现于请求线程直接记录 `export_job_cancelled`
    日志、`result_total{cancelled}` 与按「创建 → 取消」的 terminal duration；PROCESSING 协作取消
    仍由 worker 记录，互不重复。`ExportJob` 恢复 `createdAtMillis`（duration 计算用）。
  - 回归：34 replay each ZIP 顺序、12 replay aggregate 顺序（含战斗列表文件名列）、
    valid/invalid/valid 剩余有效场顺序保持、ZIP 写失败 → FAILED + partial 删除 + 不可下载、
    queued 取消 metrics exactly once（18 tests 全绿）。
- **ReconstructionControllerLifecycleLogTest 并发稳定性修复（CI deploy test-backend flaky）**：
  ListAppender.list 默认是普通 ArrayList（append 无同步），runAnalysis 在 AiReviewWorkerExecutor worker 线程并发写日志而测试线程
awaitLogContaining() 轮询 stream() 时抛 ConcurrentModificationException。改为 CopyOnWriteArrayList（写入量小、轮询读多，适合 COW），
并把 awaitLogContaining 的等待条件收紧为「marker 与 correlationId 必须同一行」——消除 c1 的 ai_review_finished SUCCESS 行抢先满足
c2 等待导致的 countFinished(c2)==0 偶发失败。仅改测试基础设施，不改 lifecycle 语义、不吞异常、不加 sleep。
- **AI Review Grounding Validation 502 修复（P0 production bug，PR #105 回归）**：真实生产复现
  （neptune+SPHT 团队 replay + 真实 DeepSeek）确认「3 次 attempt 全部失败 → AI_REVIEW_GROUNDING_FAILED
  (502)」的根因是 structured envelope 内部 metadata 问题被 validator 当作整次 review 致命错误：
  claims 漏 claimType 字段、evidence binding 类型过严（over-binding）、引用错快照时间，而
  reviewMarkdown 正文事实全部正确。修复：
  - **Validator severity 分级（HARD_FACT / STRUCTURED_METADATA / FORMAT）**：只有用户可见事实错误
    （阵亡时间/存活变化/位置数量/knowledge/身份/unsupported hard fact）才阻止输出；structured
    metadata 冲突（binding 类型/时间细节、coverage 缺失、非关键 machine 字段）直接放行输出，
    不再把内部 envelope 小问题变成整次 review 502。
  - **Parser 容错（claimType 推断）**：claimType 缺失/未知变体按机器字段 deterministic 推断
    （knowledge→ENEMY_POSITION / region+count+side→POSITION_REGION / value→ALIVE_TRANSITION /
    subject+timeSec→DEATH / 纯文本→TACTICAL）；显式禁止类型（LOS/SPOTTING/VISION）仍 fail-close。
  - **Retry 策略重构**：只有 HARD_FACT 冲突才触发 LLM 重写（targeted → full → fail-safe）；
    metadata-only 冲突 0 次额外 LLM 调用直接输出——消除「3 次 140k prompt 全量重写」的 token
    浪费与不可用（单次成功 attempt 从 ~420k 累计 token 降到 ~134k）。
  - **Evidence binding 放宽（ALIVE_TRANSITION 链式支撑）**：claim value 可由引用证据链覆盖
    （首尾一致），全局存在该变化时降 metadata。
  - **Prompt 负担（FOCUS WINDOWS 段裁剪）**：窗口事件渲染设上限（高信息事件优先 + 其余折叠），
    该段从 13.4k 字符（约 16.8k tokens）降到 1.8k（约 2.3k tokens，-86%）。
  - **前端错误码**：LOCALIZED_ERROR_CODES 增加 AI_REVIEW_GROUNDING_FAILED 及 zh/en/ru 三语文案
    （不再裸显 HTTP 502）。
  - **可观测性**：validation 日志增加 hardConflictCount/severity；新增
    team_review_metadata_passed 事件与 wotb_ai_team_review_grounding_conflict_total
    （check/severity）指标。
  - **修复 TeamEngagementExtractor NPE**：未归因掉血（attacker=null）不再触发
    MemberIdentity.matches(null) NPE（另一类 502 候选）。
  - 回归测试：metadata-only 冲突 1 次调用放行（旧行为 3 次重写后 502）、HARD 冲突仍 retry/fail-safe、
    claimType 推断契约。
  - 验证：全量 Maven 1088 tests、前端 727 tests + build、真实 E2E（修复前 3×420k→502；
    修复后 1×133.7k→PASS_METADATA 成功输出）、批量 5 replay 真实 E2E usable 80%
    （1 个 replay 因真实阵亡时间错误被 HARD 正确拦截）。
- **名人堂百场审核与默认榜修复**：百场审核列表所有状态统一只显示“详情”，待审核申请只能在详情内通过/拒绝，CURRENT 只能在详情内删除；REJECTED 详情现在展示拒绝原因、补充说明与时间，CANCELLED/DELETED 终态也可查看。公开 `GET /api/hof/hundred` 的 `vehicleId` 改为可选，未传时固定返回全站 CURRENT 最高 10 条；前端国家/系别、车种筛选仅收窄 Tier X 车辆候选，不强制选择。- **名人堂筛选交集与百场证据清理**：单场公开/管理查询新增稳定码 `nation`/`vehicleType`/`tier`，国家、车种、等级无需先选具体车辆即可独立真实筛榜，多个非空条件与 `tankId` 取交集；新增匿名 `GET /api/hof/vehicle-options` 供两页复用实际已有车辆。公开百场分类 Top 10 与 competition rank 使用同一 vehicleId 集合，管理员百场列表也支持 status/nation/vehicleType/vehicleId 独立交集筛选。百场证据维持 PENDING 临时审核资产语义：APPROVE/REJECT/CANCEL/DELETE 后清空截图、删除 evidence 行，并在 commit 后清理无引用物理文件。
- **名人堂百场审核与默认榜修复**：百场审核列表所有状态统一只显示“详情”，待审核申请只能在详情内通过/拒绝，CURRENT 只能在详情内删除；REJECTED 详情现在展示拒绝原因、补充说明与时间，CANCELLED/DELETED 终态也可查看。公开 `GET /api/hof/hundred` 的 `vehicleId` 改为可选，全部条件为空时固定返回全站 CURRENT 最高 10 条；国家/系别、车种无需选择具体车辆即可直接筛选对应分类榜。

- **战局回放（Battle Playback）当前状态面板与伤害/碰撞语义修复（docs/current-plan.md 1-28）**：
  - Details Panel 收敛为 current-state 面板：删除「最大 HP」「HP %」「协助伤害」「最终战绩」分区。
  - 车辆类型 fallback：replay tankType → tankopedia class（英文）→ 空串。
  - 伤害语义：核心推导 PlaybackCombatReconstruction（Type-7 HP sample 权威掉血 + attribution）；
    playback DAMAGE 字段 damage 更名 rawProtocolValue，新增 observedHpLoss；飘字/记录/统计改用权威掉血；
    「造成伤害」改为「已记录伤害」。
  - DESTROYED/KILL 事件恢复（type-7 alive=false 推导击毁 + 同炮 DAMAGE 支撑击杀）。
  - Marker 碰撞几何：真实 screen-space footprint（core + HP HUD + 标签盒），优先级 marker > selected > HP > tank > player。
  - **PR #107 审查修复（Blocker 1/2/3）**：
    - Blocker 1：Type-8 rawProtocolValue 不再作为任何生产消费者的真实伤害——热力图、
      掉血窗口聚类（DamageWindowClusterer）、玩家对炮/逐次伤害/击杀归因（PlayerEvidenceFormatter）、
      占点窗口承受伤害（PointsSituationEvidence）、Player/Team 特征抽取与 ObservedMaxHp 全部改走
      §12/§13 权威 HP loss；剩余 raw 用法逐项审计合法（parse-layer 结算、DTO labeled raw 字段）。
    - Blocker 2：marker 碰撞 footprint 不再假设固定 36×28——BattlePlayback 实测
      `.pb-vehicle` offsetWidth 作为 coreSize（MARKER_CORE_PX fallback），labelLayout 支持
      hpBoxW/hpBoxH 真实渲染尺寸参数。
    - Blocker 3：attacker/killer 归属措辞收敛为「有支持证据的归属」，不再声称权威；
      probe 输出 attribution 措辞同步。
    - **HP provenance 状态机（PR #107 附加：己方开局不再黑条）**：新增
      `RULE_DERIVED_FULL_AT_SPAWN`（本方存活无采样且无战前掉血 → 开局相对满血，
      前端 100% 阵营色完整血条、数字 —、不伪造具体数字，tankopedia base 永不冒充
      本局 max/current/entry）、`CURRENT_HP_EXACT_MAX_UNKNOWN`（有真实 Type-7 current
      采样但进场 max 未证明 → 真实 current + 观测容量分母 + 阵营色 indeterminate、
      tooltip「当前 HP 已观测，进场最大 HP 未知」）、`OBSERVED_EXACT`（精确
      current/max/pct）；敌方信息边界不变（无采样恒 UNKNOWN，不因己方 fallback 泄漏）。
      InitialHpProtocolProbeTest（非 CI）对 7 真实样本完成进场 HP 调查：结论 NOT_PROVEN
      （Type-7 无开局满血广播、propId 0/4/9 排除为 HP）；循环门禁经真实数据确认存在且不得放宽。


  - **PR #107 第二轮审查修复（Blocker 1-5：详情面板/总血量条/HP 字段拆分/碰撞 footprint/killer fail-closed）**：
    - Blocker 1（Details Panel 显示规则）：己方开局无实际证据时（RULE_DERIVED_FULL_AT_SPAWN）当前 HP
      显示「100%」——这是「开局相对满血状态」的 UI 投影，不是具体 HP 数值、也不证明 actual max HP，
      绝不写入 currentHp 数值字段；首个可信 sample 出现后改为显示精确 HP 数字，backward seek 恢复 100%，
      敌方无可信观测继续 —，阵亡显示 0。
    - Blocker 2（底部己方总血量条）：teamHp 输出确定性 aggregate state（FULL_RELATIVE / EXACT /
      PARTIAL / UNKNOWN）——本方全部存活车无采样 → FULL_RELATIVE：填充固定 100% 阵营色实心条、
      数值区显示「100%」（相对状态）绝不显示 0；有真实已知剩余但无已证明分母 → PARTIAL（100% 斜纹，
      不伪造分母）；禁止 totalMax=0、knownRemaining>0 却仍 0% 的空条与虚假「0 / 0」；
      Tankopedia base 相加不得冒充总 HP；阵亡是权威事实（HP=0），dead 车容量不进未知灰段。
    - Blocker 3（HP 字段拆分）：MapOverview.PlaybackVehicle 删除语义混合的 maxHp，拆为
      baseHp（Tankopedia 静态参考，仅 metadata）+ observedCapacityHp（回放观测容量，仅观测分母参考）+
      entryHp（已证明进场满血）；CURRENT_HP_EXACT_MAX_UNKNOWN 的 maxHp/pct 恒为 null——
      绝不使用 baseHp/observedCapacityHp 计算真实百分比（禁止 2500/3000 类结果）；
      OBSERVED_EXACT 才允许 pct = current/entryHp。
    - Blocker 4（碰撞 footprint 按 DOM 实际渲染）：labelLayout 改用 hpRendered + hpDisplayText——
      fullState（current=null）与 UNKNOWN（数字 —）都渲染 HP HUD、必须有盒；关闭「显示血量」
      （hpRendered=false）才无盒；盒宽按每车实际文本估算取 max（不单靠第一辆车测量复用）；
      保留 coreSize×view.scale 与 selected/destroyed/recorder 独立盒。
    - Blocker 5（killer attribution fail-closed）：type-8 结构合法但语义未解码的伤害方法变体
      （火灾/撞击等）由 EntityMethodDecoder 产出 canonical UnsupportedDamageEvent 证据事件
      （保留 time + victim/attacker eid + variant，无精确伤害数字）；PlaybackCombatReconstruction 的
      killer 致死窗口优先绑定权威致死 HP-loss 窗口（HP 掉到 0 的最后一档，无前序样本回退 0.25s），
      窗口内存在任何无法排除的 unsupported 变体 → killer=null（不得把窗口内无关 direct DAMAGE
      错判为击杀者）；destroyed 事实保留并去重，不因 killer 未知删除 HP=0/击毁。
  - **PR #107 第三轮审查修复（Blocker 1-4：混合 provenance 不冒充 EXACT / unsupported 阻止 HP-loss attribution / observedCapacityHp 纯观测 / 文档收口）**：
    - Blocker 1（teamHp 混合 provenance 不得冒充 EXACT）：EXACT 仅在该队**所有参战车辆的实际
      entryHp 都已证明**（含已阵亡、含无采样）时成立；部分证明/混合 provenance
      （OBSERVED_EXACT + RULE_DERIVED_FULL_AT_SPAWN / + CURRENT_HP_EXACT_MAX_UNKNOWN / + UNKNOWN、
      已阵亡但 entryHp 未证明）一律 PARTIAL/MIXED——totalMax 归零，只显示真实已知剩余数字或明确
      相对状态，绝不显示 knownRemaining / partialTotalMax 分数、不伪造分母；已证明车辆 current
      钳制 ≤ entryHp，EXACT 状态 knownRemaining 永不大于 totalMax；全队无采样 → FULL_RELATIVE
      100% 实心条保留；Tankopedia base 相加仍禁止。
    - Blocker 2（unsupported 变体同时阻止 HP-loss attribution）：PlaybackCombatReconstruction 对
      每个掉血窗口 (prevT, curT] 同时扫描 direct DAMAGE 与 UnsupportedDamageEvent——窗口内存在
      该受害者的 unsupported 变体、或 victim 无法解析的 unsupported 证据 → 掉血数值事实保留、
      attackerAccountId=null、attackerReliable=false；observedHpLossAt 要求 attackerReliable
      （direct+unsupported 冲突窗口返回 null，不把掉血挂到单条 direct）；cumulative dealt / 伤害日志 /
      事件级掉血均不得归给窗口内 direct DAMAGE；killer 现有 fail-closed 行为保留并扩展（victim 无法
      解析的 unsupported 证据也阻止 killer）。EntityMethodDecoder 对 unsupported 变体在 victim eid
      缺失（≤0）时用可靠 outer entityId（方法调用目标实体 = 受击者）作 victim 证据——无法解析 victim
      的 unsupported 证据不得静默丢弃；结构不足的变体仍只产生 warning。
    - Blocker 3（observedCapacityHp 纯回放观测）：Playback DTO 的 observedCapacityHp 不再使用
      ObservedMaxHp.resolve()（max(观测, tankopedia base) 钳制/fallback）——改为从真实可信
      Type-7 positive HP 采样（各 builder 自己的 hpSamples）独立取最大值
      （MapOverview.observedCapacityHpOf），无可信 sample 为 null；baseHp 只来自 Tankopedia；
      entryHp 仅 OBSERVED_EXACT 时存在；legacy player.observedMaxHp（resolve 语义）保留供 AI 证据
      消费；前端仍不得用 baseHp/observedCapacityHp 计算实际百分比。
    - Blocker 4（文档收口）：protocol.md 更新为「direct → DamageEvent（raw 非权威）；结构足够的
      非 direct 变体 → UnsupportedDamageEvent（无精确伤害数字，使 HP-loss 与 killer attribution
      fail-closed；身份字段按真实证据等级标记，未证明字段不写 PROVEN）；结构不足仍只 warning」；
      battle-playback.md 同步（observedCapacityHp 纯观测语义、EXACT 全队证明门槛、PARTIAL/MIXED、
      unsupported 阻止掉血归属）。
  - **PR #107 第五轮审查修复（Blocker 1-3：全部无法排除的 damage-method 变体参与 attribution fail-closed / 己方开局视觉规则严格化 / 矛盾 HP 证据 fail-closed）**：
    - Blocker 1（短体与 zero-raw damage-method 变体参与 fail-closed）：EntityMethodDecoder 只要包头确认
      damage-method 调用（payload ≥ 8 且 subtype == 8）就必产出带时间戳的冲突证据事件，warning 只作诊断、
      不再是唯一输出——结构不足短体（body<18，SHORT_DAMAGE_VARIANT：victim 用可靠 outer entityId、
      attacker 未知、无伤害数字）、非 direct 变体（DAMAGE_METHOD_VARIANT）、direct raw=0
      （ZERO_RAW_DAMAGE：raw 不是权威 HP delta，不得仅凭 0 判定「无伤害」，身份可解析则填写、
      victim 缺失回退 outer entityId）→ 全部进入 PlaybackCombatReconstruction 的 unsupported 冲突路径，
      使对应 HP-loss attribution 与 killer attribution fail-closed（掉血事实保留、attacker=null、
      attackerReliable=false、observedHpLoss=null、致死窗口 killer=null；victim 仍无法解析的进
      unresolved 全局 fail-closed 列表）；confidence 恒 PARTIAL（不标 EXACT/PROVEN）；真正截断
      （payload<8）仍是 MALFORMED。新增解码器 2 项与重建 E2E 5 项测试（含窗口左右边界确定性）。
    - Blocker 2（己方开局视觉规则：满血实心条、禁止条纹 fallback）：hpDisplay 新增
      OPENING_RELATIVE_FULL 状态——己方存活 + 有可信 current 采样但进场 max 未证明 + 当前时间之前
      无权威 hpLoss / 无 destroyed 证据（含 0 采样）→ 100% 阵营色实心条（fullState=true、无
      pb-hp-fill-unknown 斜纹），真实 current 仍供 Details/数字展示；RULE_DERIVED_FULL_AT_SPAWN
      （无采样）保持；teamHp 的 FULL_RELATIVE 改为「全部存活车辆（无阵亡）均开局相对满血」——
      即使部分车辆已有 current sample、但全队 entry/max 尚未全部证明，开局总条也不显示斜纹；
      首次权威掉血/阵亡后才切到精确或不确定状态；backward seek 回首次掉血前自动恢复 100% 实心条；
      敌方不套用（无采样仍 UNKNOWN）。改 4 处既有测试 + 新增单车 marker / 队伍总条 / Details /
      seek-backward / 镜像 perspectiveTeam=2 组件测试。
    - Blocker 3（矛盾 HP 证据 fail-closed，禁止 Math.min 改写真实采样）：teamHp 删除
      Math.min(cur, entryHp) 钳制——current 超过 entryHp 的矛盾证据保留原值；EXACT 除全队 entryHp
      已证明外还要求所有当前证据与 entryHp 一致（每个 ≤t 可信采样都在 [0, entryHp]，hpEvidenceConsistent
      检查）；矛盾 → 整队降级 PARTIAL（totalMax=0，不做精确比例分母）；hpDisplay 的 OBSERVED_EXACT
      分支在矛盾时返回新 INCONSISTENT 状态（真实 current、maxHp=null、pct=null，渲染 indeterminate
      斜纹、不显示伪造比例）；Details 与队伍聚合同一事实口径。重写原「5000 钳制 3000」测试为
      「5000 保留、非 EXACT、无 6000/6000、无 NaN/负宽/>100% CSS」。
  - **PR #107 第六轮审查修复（Blocker 1-2：direct victim 缺失不再 attribution fail-open / HP 证据一致性含阵亡车辆与单调性）**：
    - Blocker 1（direct raw>0 且 victimEid 缺失 → fail-open）：EntityMethodDecoder 对 direct raw>0 但
      body 内 victim eid 缺失/无效（≤0）的变体不再产出 victim=0 的 EXACT DamageEvent——降级为
      UnsupportedDamageEvent（PARTIAL，DIRECT_VICTIM_UNKNOWN：victim 用可靠 outer entityId、无精确
      伤害数字），保证完整 direct identity 才产 DamageEvent；PlaybackCombatReconstruction 对 victim
      无法映射（victimEid=0 / 映射缺失）的 DAMAGE 通知从「静默 continue」改为进入 unresolved conflict
      （任何掉血/致死窗口内存在它即 fail-closed，另一条 direct DAMAGE 不得被错判为攻击者/击杀者）。
      审计全部 DamageEvent 消费者（playback 双 builder / FormationDepthEvidence / RelativeDepthHpEvidence）：
      victim≤0 一律跳过，不创建 phantom vehicle、不绕过 coverage/fail-closed。新增解码器 1 项 + 重建
      E2E 3 项（victimEid=0 阻断归属、victim 映射缺失阻断归属、致死窗口 killer null）；正常 direct
      有效 victim 既有路径不回归。
    - Blocker 2（HP 证据一致性跳过阵亡车辆、缺单调性）：teamHp 的一致性检查移到 entryProven 块——
      **含已阵亡车辆**（destroyed continue 不再跳过历史矛盾，阵亡事实仍显示 current=0）；hpEvidenceConsistent
      重写为完整一致性：所有 ≤t 可信采样在 [0, entryHp] + 按 battle-relative time 单调非增（HP 不得
      先降后升）+ 0 之后不得再次 positive + sentinel 不参与也不改写；未来 sample 不参与当前判断
      （seek/backward 确定性：矛盾前不降级、跨过后降级、回退恢复）。任一矛盾 → 单车 INCONSISTENT
      （保留真实 current、pct/maxHp 不作精确值）、队伍不得 EXACT/FULL_RELATIVE、totalMax=0。新增
      util 测试 4 项（已阵亡历史矛盾、先降后升、0 后回正、未来矛盾 seek 确定性）+ 组件测试 1 项
      （矛盾状态不显示虚假比例、无 NaN/负宽/>100% CSS）；正常单调下降/阵亡/开局 100%/敌方 UNKNOWN 不回归。
### Changed
- **AI 模型切回 deepseek-v4-flash（官方稳定别名）**：`AI_MODEL` 默认值从
  `deepseek-v4-pro` 统一切回 `deepseek-v4-flash`——官方稳定别名直接调用最新 Flash 版本，
  调用方式不变，不使用带日期的显示名（`application.yml` / `.env.example` /
  `docker-compose.prod.yml` / `docker/online/docker-compose.yml` / `deploy.yml` workflow /
  `docs/architecture/ai-review.md` / gateway 测试字面量同步）；已显式设置 `AI_MODEL` 的
  环境以环境值为准（GitHub Repository Variable 优先级最高，若仍为 `deepseek-v4-pro` 需人工
  改为 `deepseek-v4-flash` 或删除该 Variable，代码无法覆盖）。

### Added
- **Team AI Review 启用 DeepSeek 官方 JSON Output（Team Call #2）**：
  ① **输出格式契约**——`AiChatRequest` 新增 `AiResponseFormat`（TEXT/JSON_OBJECT，默认 TEXT，
  兼容构造器回退 TEXT）；`SpringAiChatGateway.buildPrompt` 在 per-request `OpenAiChatOptions` 上
  映射 `response_format=json_object`（Spring AI 2.0.0 原生 `responseFormat` API），TEXT 不发送该参数，
  绝不写入连接级/全局 model options。
  ② **仅 Team Call #2 启用**——`TeamReplayAnalysisService.callRaw` 显式传 JSON_OBJECT（输出格式
  属于 request contract，不由 analysisMode 隐式推断）；Player / Pre-battle / Harness / Autopsy 保持 TEXT，
  存量请求行为等价。
  ③ **职责三层不变**——provider JSON mode = syntax guarantee；`TeamReviewEnvelopeParser` = business
  schema guarantee（合法 JSON 但 schema 违反仍 fail-close）；`TeamFactualConsistencyValidator` = truth
  guarantee（V1–V6/BINDING 全部保留，不因 JSON mode 放宽）。
  ④ **Parser 可诊断化**——新增 `parseDetailed()` 返回 `ParseResult`（envelope + 稳定 `ParseFailureReason`
  枚举：EMPTY_OUTPUT/INVALID_JSON/MISSING_PRIMARY_DIAGNOSIS/MISSING_REVIEW_MARKDOWN/INVALID_CLAIMS/
  UNKNOWN_CLAIM_TYPE/INVALID_MACHINE_FIELD_TYPE/MISSING_REQUIRED_MACHINE_FIELD/TOO_MANY_CLAIMS/
  TOO_MANY_EVIDENCE_IDS）；`parse()` 保持兼容委托。
  ⑤ **Validator reasonCode**——`FactConflict` 新增 `reasonCode`（UNKNOWN_EVIDENCE/EVIDENCE_TYPE_MISMATCH/
  SUBJECT_MISMATCH/TIME_MISMATCH/REGION_MISMATCH/KNOWLEDGE_MISMATCH/COUNT_MISMATCH/UNSUPPORTED_HARD_FACT/
  TEMPORAL_OWNERSHIP/IDENTITY_AMBIGUITY 等，2 参构造按 checkId 推断），production 可直接判断 validator 为什么失败。
  ⑥ **全链路结构化日志**——统一 `event=... correlationId=...` 事件日志（ai_review_started/finished/failed/
  cancelled、ai_upstream_call_started/completed/failed、ai_transport_retry、ai_prompt_budget、
  team_review_grounding_ready、team_review_validation_attempt_completed、team_review_parse_result、
  team_review_validation（conflictCount/checks）、team_review_validation_conflict（DEBUG，check/reasonCode）、
  ai_validation_retry、team_review_completed、ai_review_sse_opened/completed）；一次请求可用单个
  correlationId 在 Loki 重建完整时间线；敏感数据（API key/prompt/completion/回放内容）严禁入日志，
  新增回归测试断言。
  ⑦ **指标**——新增 `wotb_ai_team_review_validation_attempt_total{result=pass|parser_invalid|validation_failed}`
  （低基数，仅 result tag）；请求/错误/耗时沿用现有 `wotb_ai_review_*` / `wotb_ai_upstream_*`，不重复造指标。
  ⑧ **测试**——HTTP boundary（JSON_OBJECT 请求体含 `response_format={"type":"json_object"}`、TEXT 不含）、
  Team Call #2 契约（SINGLE_TEAM_BATTLE=JSON_OBJECT、PRE_BATTLE=TEXT）、parser fail-close + 失败原因分类、
  validator reasonCode、日志敏感数据回归、retry 契约保持。
  ⑨ **文档**——`docs/architecture/ai-review.md`（JSON Output 小节 + 三层职责）、`docs/features/team-ai-review.md`、
  `docs/operations/observability.md`（按 correlationId 追一单 + 事件清单 + 错误码排障）、`docs/CHANGELOG-PRODUCT.md`。

### Fixed
- **PR #106 review——parser 失败分类三态化 + AI Review 终态 exactly once + 日志字段语义修正**：
  ① **Parser 字符串数组字段三态**——`TeamReviewEnvelopeParser` 不再用空 List 同时表达 evidenceIds /
  supportingEvidenceIds 的「缺失 / 类型非法 / 合法空数组」：新增 `StringListField`（MISSING / INVALID / VALID），
  malformed（`"E101"` 字符串整体、`[{}]`、`[null]`、number/boolean 元素）→ `INVALID_MACHINE_FIELD_TYPE`
  （不再误报 `MISSING_REQUIRED_MACHINE_FIELD`，也不静默 PASS）；`primaryDiagnosis.supportingEvidenceIds`
  存在但非法时 fail-close；合法 `[]` 仍是合法空数组，factual claim 要求非空时才进入
  `MISSING_REQUIRED_MACHINE_FIELD`。
  ② **终态 exactly once**——`ReconstructionController.runAnalysis` 每个真正开始执行的 worker 请求
  恰好记录一次 `event=ai_review_finished`，result ∈ {SUCCESS, FAILED, CANCELLED}（FAILED 带稳定
  errorCode、CANCELLED 带稳定 source），覆盖 success / RuntimeException / SSE disconnect / queued
  cancellation 四路径（三分支互斥 + writer.error 二次失败兜底，杜绝重复或缺失终态）；新增 controller
  生命周期日志测试用 ListAppender 计数断言 exactly once，而非仅断言某条日志存在。
  ③ **transport retry 字段语义**——`ai_transport_retry` 的 `transportAttempt` 改为无歧义的
  `retryNumber`（1 基重试序号：retryNumber=1 → 下一次上游调用 attempt=2）。
  ④ **completed 事件去伪字段**——`ai_upstream_call_completed` 不再记录硬编码 `providerStatus=200`
  （成功响应无真实 transport status metadata，属伪 observation；真实 status 只在失败事件从异常提取）。
  ⑤ **回归保证**——Team Call #2=JSON_OBJECT / 其余=TEXT / `response_format` 仅存在于 JSON_OBJECT 请求
  / 不碰全局 model options / parser 与 validator 继续 fail-close / validation failure 仍触发 LLM 返工
  / 敏感数据（API key、prompt、completion、reviewMarkdown、replay 原始内容）不入日志 / correlationId
  贯穿 Controller → Team service → Gateway / metric tag 保持低基数；全量 1052 tests 通过。
- **PR #105 Final Blocker——Evidence Binding（claim 必须与其 evidenceIds 真正绑定）**：
  ① **绑定契约**——`TeamFactualConsistencyValidator` 新增 `checkStructuredEvidenceBinding`：
  `requiredEvidenceType(claimType)` 统一映射 DEATH→PLAYER_DESTROYED / ALIVE_TRANSITION→
  ALIVE_COUNT_TRANSITION·FOCUS_WINDOW（窗口级聚合明确允许）/ POSITION_REGION→POSITION_REGION /
  ENEMY_POSITION→ENEMY_POSITION_KNOWN；每个引用必须存在且属于允许类型（借用无关编号 / 类型不匹配
  → BINDING FAIL），且至少一个引用 evidence 必须完整支撑该 claim：DEATH=身份+时间容差（subject 在
  后端无阵亡事实 → FAIL，GhostPlayer 不再静默 PASS）、ALIVE_TRANSITION=value 与引用证据 before/after
  一致（不能因全局恰好存在该变化而 PASS）、POSITION_REGION=引用证据的 side 感知快照校验
  region/count/countSemantics（证据无该区域数据 → FAIL）、ENEMY_POSITION=身份+时间+区域+knowledge
  全部一致（只因为 CURRENT==CURRENT 就 PASS 是漏洞）。
  ② **稳定身份**——Claim 新增可选 `subjectAccountId`（parser 类型错误 fail-close）；重复坦克名
  （如两辆 IS-7）时仅凭 tankName 无法唯一绑定 → BINDING 歧义 FAIL，必须用 subjectAccountId 或昵称。
  ③ **primary source 语义**——有 evidenceIds 时引用证据是 primary source，nearest-snapshot / 全局
  存活变化列表只作为无直接 evidence mapping 的 defense-in-depth。
  ④ prompt（md + TeamPromptLocalizer ZH/EN/RU）——evidence binding 规则 + subjectAccountId 身份字段说明。
  ⑤ 测试——DEATH（正确 PASS / GhostPlayer FAIL / wrong entity FAIL / 无关类型 FAIL）、ALIVE_TRANSITION
  （正确 PASS / 无关证据 FAIL / 错误值 FAIL）、POSITION_REGION（正确 PASS / 区域缺失 FAIL / 数量不符
  FAIL / ENEMY side FAIL）、ENEMY_POSITION（同身份+时间+区域+knowledge PASS / CURRENT FAIL / GRID3 FAIL /
  different vehicle FAIL / 无关证据 FAIL / 重复坦克名需 accountId）、三语 machine 结果一致性。

- **PR #105 Final Blocker——Structured Factual Claims fail-close 契约**：
  ① **claimType schema**——TeamReviewEnvelopeParser 强制 claimType ∈ {DEATH / ALIVE_TRANSITION /
  POSITION_REGION / ENEMY_POSITION / TACTICAL}（LOS/SPOTTING/VISION/LINE_OF_SIGHT 及未知类型 → reject/rewrite）；
  每种 factual claimType 的 required machine 字段强制（DEATH=subject+timeSec+evidenceIds；
  ALIVE_TRANSITION=value 机器格式+evidenceIds；POSITION_REGION=timeSec+region+count+side+countSemantics
  +evidenceIds；ENEMY_POSITION=subject+timeSec+region+knowledge+evidenceIds；TACTICAL 无机器字段要求）；
  机器字段类型错误（region="six"、timeSec="112"）→ reject/rewrite，不再静默 null。
  ② **机器校验补全**——V2m（DEATH subject+timeSec）、V3m（ALIVE_TRANSITION value）、V4m（POSITION_REGION
  side 感知 friendlyCounts/enemyCurrentCounts，ENEMY 不拿 friendly 数比较；countSemantics EXACT/AT_LEAST/SUBSET
  机器语义，不再依赖自然语言标记词）、V5m（ENEMY_POSITION knowledge CURRENT/LAST_KNOWN 与后端 exact 校验）、
  V6m（LOS/SPOTTING claimType 一律 FAIL）。
  ③ **claims coverage 最低契约**——Grounding Facts 非空且主判断引用证据编号或正文含可验证事实锚点
  （时间范围/存活变化/位置数量/玩家阵亡+时间）时，claims 不允许无条件为空（CONTRACT 冲突）。
  ④ prompt（md + TeamPromptLocalizer ZH/EN/RU）——claims 是 factual assertions 的 machine projection
  非可选装饰；每 claimType required fields；countSemantics/side/knowledge 机器字段；数字字段必须是 JSON number。
  ⑤ 测试——Parser fail-close 8 项（DEATH 缺 timeSec/subject、POSITION_REGION 缺 region、count 字符串、
  ENEMY_POSITION 缺 knowledge、未知/LOS claimType、缺 claimType、timeSec 字符串）；V4 countSemantics 全套
  （EXACT 3 FAIL/5 PASS、AT_LEAST 3 PASS/6 FAIL、SUBSET 3 PASS/6 FAIL）+ ENEMY side；V5m CURRENT/LAST_KNOWN；
  claims coverage 3 项（诊断引用证据 FAIL / 正文事实锚点 FAIL / 纯战术 PASS）；NaturalCoach 三语 schema 契约。

### Added
- **PR #105 Review Blocker 修复——Natural Coach / Factual Consistency Guard（Review B1-1 / B1-2 / B2-1 / B2-2）**：
  ① **B1-1 authoritative response source**——`TeamReplayAnalysisService.callRaw()` 删除无意义的
  `collected` 缓冲，明确以 `AiChatResponse.completionText()` 为唯一权威完整响应（Gateway 契约：
  callback 是流式 progress、正常结束 completionText 为聚合完整文本、失败一律抛 AiUpstreamException
  绝不返回 partial）；新增 StreamingGateway 契约测试（多 chunk envelope / 垃圾 callback 不污染 /
  upstream error 不产出部分结果 / retry 每轮独立响应无 buffer 串扰）。
  ② **B1-2 三语 factual guard**——TeamReviewEnvelope.Claim 扩展机器可校验字段
  （claimType / timeSec / region / count / subject / value），validator 优先做语言无关的
  structured 校验（V2m 阵亡时间、V3m 存活变化 value、V4m 位置精确数量、V6m claimType=LOS/SPOTTING
  一律 FAIL）；正文兜底文本解析与短语列表三语覆盖（ZH/EN/RU）：时间格式支持
  `X分Y秒 / 1:49 / 109s / 1m49s / 1 мин 49 сек / 109 seconds / 109 секунд`，位置/LAST_KNOWN/LOS
  短语列表三语；structured claims 要求机器时间格式（timeSec battle-relative 秒）与存活变化
  机器格式（`7v7 -> 4v6`）；prompt（md + TeamPromptLocalizer ZH/EN/RU）同步。
  ③ **B2-1 死亡时刻时钟契约**——`TeamGroundingFacts.build` 增加显式 battleStartRawClockSec 入口，
  compat 路径（无 timeline）用 `reconstruction.battleStartRawClockSec()` 按
  `raw > startRaw → raw − startRaw` 转 battle-relative（`deathTimeMillis`/legacy 估算为原始时钟域，
  `survivalTimeSec` 校准后为 battle-relative）；补测试 + 注释明确契约。
  ④ **B2-2 V4 精确语义**——structured region+count 默认 exact（claim == actual，少报同样 FAIL），
  at-least/subset 标记（至少/at least/не менее；其中/of them/среди）放行下界/子集陈述；
  正文自然语言无法区分时只防 over-count（不假装能判断）。
  ⑤ 测试——TeamFactualConsistencyValidatorTest 新增 EN/RU 回归（V2/V3/V4/V5/V6 + 合法战术观点
  三语 PASS）+ 机器字段用例 + B2-2 exact/subset/at-least；TeamGroundingFactsTest 新增死亡时钟
  契约；TeamReviewEnvelopeParserTest 新增机器字段解析；TeamReviewRetryContractTest 新增 B1-1
  gateway stream 契约；TeamReviewNaturalCoachContractTest 新增三语机器字段契约。

### Added
- **Team AI Review Natural Coach Mode + Factual Consistency Guard（PR #103 之上）**：
  ① **Natural Coach Mode 输出契约**——团队复盘主正文改为【自由组织的自然复盘】：
  以「## 团队复盘」为主标题、3-5 个自然段（简单局 2-3 段、复杂局约 5 段），
  删除「核心结论 / 关键决策窗口 / 可确认的团队问题 / 训练建议」固定章节模板与固定数量要求；
  先判断整场最值得讲的 1-2 件事，只有一个决定性问题就只讲一个；
  TEAM REVIEW FOCUS WINDOWS 改为内部 attention 提示（「这里最值得集中分析」），不要求逐窗口输出标题；
  新增「主判断（Primary Diagnosis）」契约：必须选出且只选出一个 PRIMARY DIAGNOSIS，
  禁止「无法判断/可能性枚举」，多个解释时选最符合全部证据且最有训练价值的那一个；
  新增「教练不是司法鉴定员」原则：事实必须准确，战术判断不要求数学证明；
  中文默认长度 400–1200 字（简单 300–700、复杂 ≤1500）。
  ② **GROUNDING FACTS + structured envelope**——Team Call #2 输出改为 JSON envelope
  （primaryDiagnosis / reviewMarkdown / claims），输入注入确定性 GROUNDING FACTS 段
  （每条带稳定证据编号 E1xx：PLAYER_DESTROYED / ALIVE_COUNT_TRANSITION / FOCUS_WINDOW /
  POSITION_REGION / ENEMY_POSITION_KNOWN(CURRENT|LAST_KNOWN)）；evidenceIds 只进 structured 字段，
  绝不进用户正文（validator 拦截泄漏）；Backend 不拼接复盘主体，reviewMarkdown 由 LLM 自由写出。
  ③ **TeamFactualConsistencyValidator（确定性，wotb-core）**——只检查「LLM 有没有改写 Backend 事实」，
  绝不判断战术观点：V1 temporal ownership（声称窗口必须包含其引用事件）、V2 玩家阵亡时间（容差 2s）、
  V3 存活变化（7v7→4v6 不得写成 3v5）、V4 位置时间归属（某时刻「7辆全部在6区」不得超出区域快照）、
  V5 CURRENT/LAST_KNOWN（敌方 LAST_KNOWN 不得写成「此时就在这里」）、V6 无 LOS/spotting 证据的
  硬事实化表达（「进入所有炮线/具备完整LOS/被掩体卡住/已经点亮」等除非降级为「更可能/从交换结果看」级别）、
  引用不存在证据编号 / 空输出 / 证据编号泄漏进正文。
  ④ **校验失败 → LLM 自修循环（Backend 绝不代改句子）**——Draft → validate；FAIL → targeted rewrite；
  FAIL → full rewrite；仍 FAIL → fail-safe 业务错误 AI_REVIEW_GROUNDING_FAILED（最多 3 次尝试）；
  校验通过后才把 reviewMarkdown 流式转给前端（不暴露待改写草稿）。
  ⑤ **Golden 回归**——TeamFactualConsistencyValidatorTest（G1–G5 / V1–V6 / 战术观点放行 /
  BackendEvidenceBoundary）、TeamGroundingFactsTest（证据编号确定性 + 渲染）、TeamReviewEnvelopeParserTest、
  TeamReviewRetryContractTest（retry / 耗尽 fail-safe / parse 失败重写）、TeamReviewNaturalCoachContractTest
  （三语契约）、TeamReviewRealReplayProbeTest 增加真实 canonical facts 上的 validator golden 断言。

### Fixed
- **PR #103 第七轮——ActualCombatant 边界进入 Canonical BattleTimeline + FormationDepth partial CURRENT 完整 fail-close（最终 review）**：
  ① **ActualCombatantEntitySet（Canonical BattleTimeline universe 源头）**——TeamEntityMapping 新增
  actualCombatantEntityIds(#301 账号集)：只允许可靠映射到 battle.players（battle_results #301 actual
  combatant，accountId > 0）账号的实体进入 tactical FrameVehicle 集合；BattleTimelineBuilder 帧循环
  knownEntityIdsAt(t) ∩ actualCombatantEntityIds 才构造 FrameVehicle。
  non-#301 spectator/camera/observer/静态实体即使被 broad roster / ParticipantMapping 赋予完整身份
  （accountId/team/nickname/坦克元数据）也绝不进入 timeline——不再产生假的 FIRST_KNOWN / ENEMY_LOST /
  ENEMY_REACQUIRED / POSITION_CHANGE / REGION_CHANGE / DESTROYED delta（team=null 不再被
  BattleDeltaEngine 的 isEnemy = !friendly() 当成敌方）；WorldSummary 保持 #301 roster（2v2 不被观战撑成 3v2）；
  raw timeline.events 保留原始事件供协议用途；无任何实体映射到 #301 时 fail-close TIMELINE_MAPPING_INSUFFICIENT。
  WorldSummary / BattleDeltaEngine / EpisodeDetector / TimelineFocusWindowSelector / Team+PersonalAiContextCompiler
  全部只消费过滤后的 universe（检查确认无其它 raw-event 泄漏路径）。
  ② **FormationDepth partial CURRENT 完整 fail-close**——GEOMETRIC_*（enemy centroid / 三分位轴）与
  ownWeightedCoverageScore / enemyWeightedCoverageScore / ratio 改为在任何 exact geometry 计算前先判定
  ownRefComplete && enemyRefComplete，只有双方 CURRENT 完整才输出；partial CURRENT（如 enemyRef=1/2）
  只输出 POSITION_COVERAGE_INSUFFICIENT + CURRENT presence + coverage counts + ENEMY_LAST_KNOWN_POSITION_REFERENCES
  ——不再用 1 辆敌方 CURRENT 建立 whole-team geometric axis（与覆盖段 INSUFFICIENT 自相矛盾）。
  RelativeDepthHp 的 enemyRefComplete fail-close 保持不变（未重设计）。
  ③ **测试**——canonicalTimelineExcludesNonCombatantPositionEntity（无身份 spectator：连续位置流 + >5s gap
  + region teleport + 阵亡，FrameVehicle/delta/WorldSummary 三层断言）/
  nonCombatantWithUsableBroadRosterIdentityStillExcluded（participants 提供 accountId/team/nickname/坦克元数据，
  仍被 #301 排除）/ compilersNeverRenderNonCombatantEntity（Team+Personal AI 输出不含 车辆#99 / 账号 9999）/
  partialEnemyCurrentDoesNotProduceGeometricTerciles（enemyRef=1/2 → 无 GEOMETRIC_*/无 exact 分数）/
  completeEnemyCurrentStillProducesGeometricTerciles（完整场景不 regression）。
  文档：protocol.md / team-ai-review.md / current-plan.md 同步。
- **PR #103 第六轮——Evidence 层知识状态契约：enemy LAST_KNOWN 永不升级为 CURRENT exact geometry（2026-08）**：
  ① **FormationDepthEvidence / RelativeDepthHpEvidence 引入带 provenance 的 PhasePositionReference
  （accountId/team/x/z/knowledge/observedAtSec/ageSec，knowledge 复用 canonical PositionKnowledge）**——
  「无 provenance 的 meanByAccount 同时表示 friendly CURRENT / enemy CURRENT / enemy LAST_KNOWN」结构删除；
  exact 阵型/覆盖/距离数学只消费 CURRENT 参考：friendly actual combatant carry-forward
  （last position + 无 EntityLeave + 未阵亡）→ CURRENT（canonical 同口径）；enemy 最后观测
  age ≤ canonical 当前阈值（BattleTimelineBuilder.POSITION_GAP_SEC=5s，本条目改为 public 供证据层复用）
  → CURRENT，否则 LAST_KNOWN。
  ② **FormationDepth fail-close**——enemy LAST_KNOWN 不得满足 current-position completeness、不得作为
  当前 enemy centroid / enemyPositionPresence / enemyWeightedCoverageScore 坐标；CURRENT 不完整时只输出
  POSITION_COVERAGE_INSUFFICIENT + CURRENT presence + 新增独立信息段 ENEMY_LAST_KNOWN_POSITION_REFERENCES
  （account + region + observedAtSec + ageSec + knowledge=LAST_KNOWN，独立信息不伪装 current，不 future-leak）；
  GEOMETRIC_* 三分位轴只消费 CURRENT enemy refs。
  ③ **RelativeDepthHp 更严格 fail-close**——enemy 只有 LAST_KNOWN 时该 phase 不生成
  memberDist/referenceDist/relativeDepthM exact 距离测量（禁止「LAST_KNOWN → 当前精确距离」）。
  ④ **Region presence 统一为 resolved 车辆位置 state**——ownPositionPresence/enemyPositionPresence 从
  「位置包数量」改为「每辆 CURRENT 车辆 +1」（同一车辆 phase 内 100 个包 presence 仍 1），
  与 coverageCompleteness 同一套 resolved position state。
  ⑤ **Actual Combatant 边界加固**——证据层 tracks 增加 #301（battle.players）成员过滤：
  spectator/observer/camera/静态实体位置绝不进入战术位置覆盖；TEAM_MEMBER_ENTITY_UNMAPPED 与
  TEAM_MEMBER_POSITION_UNAVAILABLE 改为互斥（完全 unmapped → 只报 mapping failure，P2 cleanup）。
  ⑥ **Prompt 三语 FORMATION_DEPTH_RULE 同步**——presence=基于 resolved 状态的车辆数（非包数）、
  CURRENT/LAST_KNOWN 语义、ENEMY_LAST_KNOWN_POSITION_REFERENCES 不得当作当前精确位置。
  ⑦ **测试**——friendlyStationaryCarryForwardRemainsCurrent / enemyStalePositionRemainsLastKnown
  （knowledge=LAST_KNOWN + observedAtSec/ageSec 断言）/ staleEnemyDoesNotProduceExactRelativeDepthDistance /
  carriedFriendlyCountsInRegionPresence / regionPresenceCountsVehiclesNotPositionPackets /
  spectatorDoesNotAffectCoverage / mapped 零位置 → 仅 TEAM_MEMBER_POSITION_UNAVAILABLE（P2）；
  回归 fixture 更新为真实连续位置流语义（enemy phase 末保持 CURRENT）。
  文档：protocol.md 证据层知识契约；team-ai-review.md CURRENT-only exact math + LAST_KNOWN 独立信息段。
- **PR #103 第五轮——Actual Combatant / Spectator 边界 + 己方位置 state 语义（2026-08-19）**：
  基于 6 个真实 replay 的协议调查（`ActualCombatantPositionProbeTest`，见 `docs/research/replay/protocol.md`
  SPECTATOR/NON-COMBATANT 节）：
  ① **`UNATTRIBUTED_POSITION_EVENTS_PRESENT` 重分类**——`DefaultTeamBattleFeatureExtractor.auditPositionEvidence`
  按 #301 成员资格区分 A（#301 实际参战实体无法归因 → 保留该 limitation）与 B（non-#301 实体：
  观战玩家/镜头/场景对象 → 只记 `coverage.nonCombatantPositionEventCount`，不进 AI prompt）。
  真实样本证明该 limitation 此前 6/6 场 100% 由 non-#301 实体触发（观战玩家 结城凛音 1611 位置、
  观战镜头 13185652、场景静态物 12558633/34/49/59/60/78 等）。
  ② **`TEAM_MEMBER_MOVEMENT_UNAVAILABLE` 改名 `TEAM_MEMBER_POSITION_UNAVAILABLE`**——语义收敛为
  「#301 成员 mapped 但整个可分析期无任何 usable position state」，不再暗示 movement 缺失=位置缺失。
  ③ **己方位置 carry-forward（`BattleTimelineBuilder.frameVehicle`）**——己方 actual combatant 在
  last position + 无 EntityLeave + 未 destroyed 时保持 `POSITION_STREAM_ACTIVE/CURRENT`，
  不因 age > `POSITION_GAP_SEC=5` 降级 LAST_KNOWN（真实样本：存活己方开局静止 10.8s 同坐标无新位置）；
  敌方保持 UNKNOWN/LAST_KNOWN anti-future-leak。
  ④ **FormationDepthEvidence / RelativeDepthHpEvidence carry-forward 参考**——phase 内无新样本但
  phase 前有最后位置（存活、无 EntityLeave）的车辆计入 position reference/几何（friendly=authoritative；
  enemy=LAST_KNOWN），不再用 phase-local event existence 当 position coverage 代理，消除静止车辆造成的
  `POSITION_COVERAGE_INSUFFICIENT` 误报。
  ⑤ **回归测试**——R1（spectator 不产生 team limitation）、R2（friendly stationary carry-forward）、
  R3（#301 成员零映射 → `TEAM_MEMBER_ENTITY_UNMAPPED`）、R4（mapped 零位置 →
  `TEAM_MEMBER_POSITION_UNAVAILABLE`）、R7（friendly >5s 静止不 unknown）＋ A 类（#301 实体冲突无法归因
  仍触发 limitation）；既有 enemy anti-future-leak 测试保持通过。
  文档：protocol.md 新增 SPECTATOR/NON-COMBATANT ENTITY + PositionChanged change-driven 验证；
  battle-timeline.md knowledge-world 分层补己方 carry-forward；team-ai-review.md limitation 清单改名。
  测试：wotb-core 84 + wotb-web targeted 全绿（11.19 两个样本缺失时 probe 自动跳过，放入 common/data/ 自动回归）。
- **PR #103 Backend Evidence Boundary 第四轮——GPT review 剩余 3 个 Blocker + PR scope 收口（2026-08）**：① **Team EN Points 规则语义对齐**——`TeamPromptLocalizer.CAPTURE_RULE_EN` 8.b 移除旧 deterministic Rule Engine 措辞（"it needs to attack and capture" / "can more comfortably defend with crossfire"），与 ZH/RU/Player 一致：击杀换分项净劣势/优势只提示「点数压力方向」，是否抢点/防守拉交叉由 LLM 综合推断，禁止固定映射。② **FormationDepthEvidence 拆分几何 vs 战术角色**——删除 `lineupStructure=frontlineCapable/backlineCapable/neutralOnly`、`noFrontlineVehicle/noBacklineVehicle`、`isFrontlineCapable/isBacklineCapable`（HEAVY⇒前线、TD/LIGHT⇒后排的确定性分类）与 fireWeight 的前线加成；frontLine/midLine/backLine 改名为中性 `GEOMETRIC_FORWARD/GEOMETRIC_MIDDLE/GEOMETRIC_REAR`（沿本队质心→敌方质心轴的纯几何深度三分位，恒输出，不引用 tank profile 分类）；tank profile 只作为成员静态事实附注，该车位于该纵深是否合理由 LLM 判断；清理「地图控制区域（实际控制）」stale comment。③ **BehindLineHpEvidence → RelativeDepthHpEvidence 中性化**——段名 `BEHIND_LINE_HP_ADVANTAGE` → `RELATIVE_DEPTH_HP_MEASUREMENT`、`HP_ADVANTAGE_UNKNOWN` → `HP_RATIO_UNKNOWN`；reference 由纯几何算法选择（本阶段距观测敌方最近的存活本方成员，不再要求「可扛线 HEAVY/高装甲」），输出 member/reference accountId + 静态 profile 事实 + hpRatio/hpRatio差 + memberDist/referenceDist/relativeDepthM + observedAttackEvents + coverage；opening 最靠后三分位几何事实不再按坦克类型排除；保留 partial coverage fail-closed（observedAttackEvents=0 ≠ 无输出/避战）。④ **ai-lessons 全量迁移**——`cw-delay-hold-01.md` 重写为 Backend expected evidence vs LLM interpretation expectation 分离结构；清除其余 lesson 的「Step 2 SEPARATION_EVIDENCE_RULE（拖延=行为模式+队友获利）」等 stale 公式。⑤ **PR scope 收口**——revert 4530a8e5/722afe3f 两个「format imports」commit 带来的 644 个文件非 AI-Review 改动（恢复 601dc427 内容）：其中 17 个 Flyway migration 被重排导致已应用迁移 checksum 漂移（validate-on-migrate 默认开启，生产启动校验风险）、V14 E'\n' 语法被改坏；prompt 逐字契约文件此前已由 a24b30e6 恢复；revert 后 PR diff 只含 AI Review 语义改动。⑥ **Boundary regression tests**——BackendEvidenceBoundaryTest 新增 R14（Team EN points 三语一致）、R15（Formation 无 tactical-role 标签）、R16（RelativeDepthHp prompt 中性 + partial fail-closed 保留）、R17（docs lesson 不再把 Backend verdict 公式当 expectation）；RelativeDepthHpEvidenceTest 重写（纯几何 reference、TD/LT 纳入测量、中性命名断言）；PromptRuleContractTest 三语逐字契约同步。
- **PR #103 Backend Evidence Boundary 第三轮——剩余 3 个 Blocker（2026-08）**：① **BehindLineHpEvidence 中性化**——吸血/避战/利用队友输出/利用队友扛伤/「前线型车辆未上前线」/degree 轻中重 全部移除，改为确定性测量（phase、血量比率、血量比、距敌距离差、observedAttackEvents、coverage=COMPLETE/PARTIAL、HP_ADVANTAGE_UNKNOWN、opening 后排分位几何事实、跨阶段出现次数=中性 salience）；×1.2 阈值保留为 salience/filter heuristic，不再解释为「满足 ⇒ 吸血/避战」；prompt 三语（Player/Team BEHIND_LINE_RULE + player/team/autopsy md）同步为中性测量指导。② **FormationDepthEvidence 去权威控制权**——删除 controlRegions own/contested/enemy 标签（含 (presence)/(firepower)、noArmorNote），改为 REGION_COVERAGE_MEASUREMENTS 每区输出 ownPositionPresence/enemyPositionPresence、ownWeightedCoverageScore/enemyWeightedCoverageScore、ratio、coverageCompleteness（位置参考不完整时只输出 ownPositionPresence，不输出分数对比）；prompt 三语 FORMATION_DEPTH_RULE 同步（不再有「前排抗线/中排输出/后排支援」战术角色断言）。③ **Points Prompt 去 Rule Engine + PUSH_WINDOWS 清零**——全局统一 CONTROL_REGION_ENTRY_WINDOWS（player×3 md、team/single md、TeamPromptLocalizer ZH/EN/RU、PlayerPromptRules ZH/EN/RU、Java 注释全清）；删除「必须指出防守方失误」evidence→verdict 固定映射与「净劣势 ⇒ 需要进攻抢点」固定结论，改为「LLM 综合击杀换分信号/区域位置存在/局部人数/战局时间/伤害/阵亡/后续移动自行形成 supported tactical inference」。④ **PlayerSeparation 0/0 bug 修复**——`PlayerSeparationEvidenceSkill` 先构建最终 numbers map（inWindowDealt/inWindowDamage），summary 与 AiEvidence.numbers 同一数据源生成，不再从 RouteSkill 原 window.numbers() 读 damageDealtDuringSpan（恒 0）；新增 regression（player-detach-push-01：dealt=300/received=1800 时 numbers 与 summary 一致）。⑤ **BackendEvidenceBoundaryTest 扩展**——R9 BehindLine 无战术 verdict、R10 Formation 无 controlRegions 权威标签、R11 Prompt 无 PUSH_WINDOWS、R12 无 evidence→mandatory mistake 固定映射、R13 Player separation numeric consistency；R8 fake assertTrue(true) 删除（真实 Golden 由 TeamReviewRealReplayProbeTest 负责）。⑥ **ai-lessons 清理**——cw-benefit-partial-overlap/cw-cap-defense/cw-damage-partial-benefit/player-no-growth 全部改写为 Backend expected evidence（distance/stationary ratio/damage/local numbers/activity/coverage）vs LLM interpretation expectation（脱节/拖延/合理分兵）分离表述，teammateBenefit/SOLO_DELAY/SOLO_DETACHED/FAVORABLE 作为 Backend tactical label 清零。⑦ 修复 `TeamAiPromptBuilder` behindLine 段误嵌套在 formationDepth if 块内的结构问题。测试：全量 Java 通过；frontend tests/build + git diff --check 验证；CI 全绿。
清除 feature 层残留的「交换是否值得」旁路判断——删除 `EngagementOutcome` 枚举（`FAVORABLE/UNFAVORABLE/EVEN`，原 `dealt > received * 1.25 → 有利/不利/均势` 判定）及其在 `EngagementSummary`/`TeamEngagementSummary` 的 `outcome` 字段；`DefaultPlayerBattleFeatureExtractor`/`TeamEngagementExtractor` 不再计算 outcome（删除 `ENGAGEMENT_OUTCOME_RATIO` 常量），只保留确定性数字（damageDealt/damageReceived/存活变化/局部人数/HP swing/集火目标/目标切换）；`PlayerAnalysisTerms.outcomeLabel`（有利/不利/均势）删除，三个渲染点（`PlayerEvidenceFormatter` 交火段「结果:」、`TacticalReviewPromptBuilder` 对炮明细「| 结果:」、`TeamEvidenceFormatter` TEAM_ENGAGEMENTS 段「outcome=」）不再输出交换好坏标签——「交换是否值得」与拖延/脱节/图控一样归 LLM 综合多事实判断（Backend MUST NOT encode tactical benefit）。测试：删除 `DefaultTeamBattleFeatureExtractorTest.engagementOutcomeUsesOnePointTwoFiveAsAnExclusiveBoundary`（被测旁路逻辑已移除），全部 EngagementSummary/TeamEngagementSummary 构造适配，PlayerAnalysisTermsAndEnemyEvidenceTest 移除 outcomeLabel 断言；全量 1888 tests / 0 failures / 0 errors 通过；golden cases 与前端 API 契约均不依赖 outcome 标签（已核验零引用）。
① **Autopsy 不再逐人作文**——`TeamAutopsyPromptBuilder.renderSection` 删除「团队剖析」header、重复胜负、`逐人贡献` 全部 P1~P7 分类表与 `P1（"nickname / tank"）` 式 playerKey 暴露；`mvps` 与 `biggestLiabilities` 均为空（无 standout，合法结果）时整段返回空串（UI/主复盘已知胜负，不重复）；有 standout 时只渲染 `## 重点复查` / `## 高贡献者` 两块，每行 `nickname / tank：reason`（playerKey 仅作内部 lookup，绝不进入用户正文；evidence 保持 structured contract 内部）；`renderSection` 签名简化为 `(result, roster)`，删除不再使用的 `contributionLabel/confidenceLabel` 死代码。② **彻底统一 UNKNOWN selective**——删除局部规则重新强制披露：Opening Spread 不再写「统一视为 UNKNOWN（写『无法确认其实际视野收益』）」、Solo 规则不再「信号不足或矛盾时明确写『无法从当前回放数据确定』」、争霸赛点数 8e 不再「信号不足或矛盾时写『无法从当前回放数据确定』」；三语（ZH/EN/RU）统一改为「证据不足 → 保持内部 UNKNOWN；仅当符合全局选择性 UNKNOWN 条件时才自然说明」；single.zh.md 同步。测试：TeamAutopsyPromptBuilderTest 重写（空 standout / liability-only / MVP-only / both）、AiReplayAnalysisServiceTest 生产装配输出断言（无逐人贡献/P1（/置信度/PARTIAL）、TeamReviewStyleContractTest 新增防回归（局部规则不得重新强制 UNKNOWN，ZH/EN/RU 同步）。
- **PR #103 Backend Evidence Boundary 架构收口（2026-08）**：确立「Backend 只负责事实与确定性派生证据，战术判断归 LLM」原则。① 删除战术 verdict——`EvidenceType.SOLO_INTENT` → `SPATIAL_SEPARATION`；`TeamSoloIntentSkill` → `TeamSeparationEvidenceSkill`、`SoloPlayIntentSkill` → `PlayerSeparationEvidenceSkill`（git mv 保留历史），只输出中性空间分离结构事实（`kind=OPENING_SPREAD/SEPARATION_WINDOW` + distance/distanceGrowth/stationaryRatio/movementState/observedEnemyNearby/damageReceived/Dealt/death/mainClusterDisplacement/otherFriendly*）；删除 `SOLO_DELAY`/`SOLO_DETACHED`/`teammateBenefit`/`EngagementOutcome.FAVORABLE→获利→拖延` 链路（`EngagementTradeSkill` 输出数据的正确模式保留）。② 词汇中性化——`RouteSkill`：detachmentWindows→separationWindows、enemyMajorityEntries→localObservedNumbersEntries（只报「观察到附近友军 N/敌军至少 M」）；`PointsSituationSkill`：PushWindow→ControlRegionEntryWindow、pushWindows→controlRegionEntryWindows（不声称进攻/抢点/防守）；`PointsSituationEvidence` 生产段 PUSH_WINDOWS→CONTROL_REGION_ENTRY_WINDOWS。③ Prompt 三语（Team/Player + md）`SOLO_INTENT_RULE`→`SEPARATION_EVIDENCE_RULE`：声明 SPATIAL_SEPARATION_EVIDENCE 是 OBSERVATIONS/DERIVED MEASUREMENTS 不是 tactical verdict，拖延/脱节/图控等判断由 LLM 综合多事实得出 supported tactical inference（原则+证据边界，不做规则引擎）。④ 测试——TeamSeparationEvidenceSkillTest/PlayerSeparationEvidenceSkillTest 重写为中性契约（旧 SOLO_DELAY/SOLO_DETACHED 场景只输出事实）、RouteSkillTest/PointsSituationSkillTest/PointsSituationEvidenceTest 适配、golden cases 重构（backend 事实断言 + 战术标签 omits）、新增 BackendEvidenceBoundaryTest（R1–R8：Team/Player 生产链路无 verdict、OPENING_SPREAD 中性、partial coverage 不硬判、prompt 三语声明、Golden 3:1 不回归）。⑤ 文档——docs/architecture/ai-review.md 新增「Backend Evidence Boundary」三层架构章节（Canonical Facts / Deterministic Derived Evidence / Tactical Interpretation + 判断标准）；ai-lessons 全量迁移到中性词汇。
- **PR #103 对方关键威胁 optional contract 统一（2026-08）**：修复 Team Prompt 直接冲突——输出结构「5. 对方关键威胁（可选）」与团队复盘规则「分析对方阵容并指出对方主要威胁车辆（最多 3 辆）；对方数据缺失时明确说明」互相矛盾。统一为单条规则：对方关键威胁是【可选】内容，只有对核心结论、关键决策窗口、已确认团队问题或对应训练建议确有价值时才指出 1-3 辆；没有明显关键威胁或对核心复盘没有帮助时直接省略，不得为了结构完整强行选一个；删除「对方数据缺失时明确说明」无条件披露，改为「对方数据不足时不得猜测，缺失本身保持内部 UNKNOWN——只有该缺失直接影响核心判断、因果判断或训练建议时，才按全局选择性 UNKNOWN 规则自然说明」。ZH/EN/RU 三语同步（`TeamPromptLocalizer.TEAM_ANALYSIS_RULE` + `single.zh.md`）。测试：TeamReviewQualityGateContractTest 新增 4 项（optional threat / 无 mandatory contradiction / 无强制缺失 disclaimer / 三语 parity），更新 TeamOpposingLineupEvidenceTest 与 PlayerAnalysisTermsAndEnemyEvidenceTest 断言。
- **PR #103 Final Quality Gate（2026-08）**：① Team 用户可见名称——`TeamPerspectiveLabelResolver` 拆分 `resolveDisplayLabel`（唯一 dominant 且严格多数 → clan tag 最常见 casing；否则空串，绝不返回 `队伍-XXXX`）与 `resolveStableKey`（internal-only）；web 层 `TeamRosterResolver.resolveDisplayLabel/resolveOpponentDisplayLabel` 独立解析双方，TeamAiPromptBuilder header 输出 `teamDisplayLabel/opponentDisplayLabel`（无可靠 clan → `(none)`），PreBattleSectionRenderer 无 clan 只显示「我方画像/对方画像」，Team Autopsy 渲染侧 fallback「本方」；prompt 移除「主要军团」proper noun（禁止自创「X 对阵 Y」标题）。② 真人教练风格——新增「内部证据与用户正文的关系」规则（AUTHORITATIVE_*/OBSERVED_*/FACT/UNKNOWN/canonical 等是内部推理材料，正文不复述/不解释证据体系）；删除 blanket UNKNOWN 输出要求，改 selective（4 条件）；Focus 五项改为内部思考框架、正文自然 1-3 段不机械输出小标题；中文默认 600–1200 字（简单 400–700、复杂 ≤1500）；数字只保留支撑核心判断的。③ Team Call #2 独立输出上限 `wotb.ai.team-review-max-output-tokens`（默认 4096，effective = min(global, team)，同时用于 AiPromptBudgetGuard 与 AiChatRequest；Player 保持 global）。④ Team Autopsy 用户可见渲染隐藏 confidence/PARTIAL/UNKNOWN/settlement-only/规则候选/provenance；`mvps`/`biggestLiabilities` 允许为空（javadoc 同步）。⑤ Opening Spread battle-specific inference——「敌方主力确认后本方没有及时合流」是本场具体结论，需「重新集中推断规则」4 证据门；known=4/unknown=3 只能说「至少观察到 4 辆，其余 3 辆位置不明确」，禁止「7 辆主力已集中在这一侧」；anti-future-leak。⑥ 真实回放 Golden probe 硬断言（样本存在时 friendlyDeaths==3、enemyDeaths==1、BEFORE 7v7、AFTER 4v6、core 109–128s ±8s），删除 print-only matchesNarrative。
- **AI Review V2 PR #102 第三轮 review 修复（B1）——Team AI Canonical Timeline hard gate**：`TeamReplayAnalysisService.analyzeTeamGroups`（Team AI 唯一 production 编排入口）在**任何 LLM 调用之前**（Call #1 prior / Call #2 / Team Autopsy）为每个 context 构建并验证 canonical `BattleTimeline`（一次 build、一次 validation）：reconstruction 缺失 / timeline 不可用 / timeline 为 null → 立即抛 `AiTimelineUnusableException`（AI Gateway requests = 0，禁止 settlement-only fallback）；验证通过后同一 validated timeline 下传 `TeamAiPromptBuilder`（新增带 `BattleTimeline` 的 `single(...)` 重载）渲染 TACTICAL TIMELINE 段——PromptBuilder 不再内部 build / 不再 `catch (RuntimeException) { return "" }` 静默降级，validated timeline 渲染为空 → fail loud；`analyzeSingleTeamContext` / `analyzePlayerContext` 明确标注为兼容/测试入口（非 production AI Review entrypoint，避免 hard-gate bypass）；TacticalReviewHarness javadoc 修正为 hard reject 语义；测试：TeamReplayAnalysisServiceTimelineGateTest（timeline invalid → zero LLM calls、reconstruction==null → zero calls、valid timeline → Call #2 必含 TACTICAL TIMELINE、PromptBuilder 不引用 BattleTimelineBuilder 结构断言）。
- **AI Review V2 PR #102 第二轮 review 修复**：
  ① `AiTimelineUnusableException` SSE error 契约——`ReconstructionController.errorCodeOf` 对任何该异常只输出稳定码 `AI_TIMELINE_UNUSABLE`（validation detail `TIMELINE_*` / `NO_RECONSTRUCTION` 仅留后端日志，绝不进入 SSE error 事件/客户端协议）；异常新增单一来源 `STABLE_ERROR_CODE` 常量（与同步 HTTP 冒号前缀提取契约一致）；`AiReplayReviewService` 错误类型指标按稳定码记录 `AI_TIMELINE_UNUSABLE`（低基数，不带 detail）；frontend `LOCALIZED_ERROR_CODES` + zh/en/ru 三语文案「缺少足够的战局时间线数据」；新增真实 SSE/controller boundary 测试（非 Mockito：真实 emitter 捕获 error 事件，断言 code 严格等于稳定码、无 `:`、无 `TIMELINE_*`）。
  ② Episode BEFORE/EVENTS/AFTER 因果修复——`BattleFrame(second=N)` 已消费 ≤N 事件，新 Episode 起始秒 delta 属于本段，BEFORE 改为 `frameWorld(max(0, seg[0]−1))`（首段钳制 0），不再提前包含同秒阵亡/点数变化效果；半开段 delta ownership 不变（flatten 仍恰好一次）；新增 DESTROYED 与 POINTS_CHANGE 两类 boundary 回归测试。

### Added
- **战局回放 Vehicle HP & Combat Feedback（feat/playback-hp-combat-feedback）**：
  ① 后端 `MapOverview.PlaybackVehicle` 新增 `tankType` / `entryHpSource` / `entryHp` / `finalStats`（整场结算字段集），
  `MapOverviewBuilder` 与 `BattlePlaybackAdapter` 双构建器同源填充；`entryHp` 仅在
  `ObservedMaxHp` 判定 `OBSERVED_EXACT`（受击覆盖完整 + 严格早于首次受击的 positive 样本 >= tankopedia base）
  时输出——前端「开局满血回退」只允许该 provenance，tankopedia base 永不冒充进场满血（docs/current-plan.md §5.1）。
  ② 前端 `battlePlayback.js` 新增纯函数：`hpDisplay`（样本优先 → 击毁 0 → 本方已证明进场满血回退 → UNKNOWN，
  maxHp 缺失不伪造百分比）、`cumulativeStatsAt`（当前时间点 dealt/received/kills 确定性重建）、
  `eventsCrossed`（严格左开事件 cursor，seek/pause/resume 不重复触发）、`transientsActive` / `pushFeed`
  （wall-clock transient 生命周期 + kill feed 队列）、`victimFeedbackAllowed`（失察期间受击不跳伤害，§7.2）。
  ③ `VehicleMarker` 新增 HP HUD（数字 + 定宽 bar + lost-HP ghost + hit flash；last-known 弱化、destroyed 归零、
  UNKNOWN 显示 —；screen-space 恒定；开关由 `wotb.pb.hp-prefs` 持久化）。
  ④ `BattlePlayback` 新增：floating damage / destruction burst / kill feed（victim-only，§15.2 未证明全局击杀
  广播不伪造攻击者）、detail sidebar（当前状态面板 + 最终战绩分区 + 伤害记录，攻击者未点亮显示「来源未知」）、
  event cursor 驱动的 transient feedback（seek 清空、pause 自然完成、prefers-reduced-motion 降动画）、
  宽屏右侧/窄屏下方响应式布局。
  ⑤ 真实 fixture QA（BattlePlaybackAdapterParityTest 扩展）：finalStats 与权威结算逐字段一致、entryHp provenance
  契约、阵亡车辆必有 0 采样、每条 KILL 由同炮 DAMAGE 支撑（KILL broadcast provenance 验证）。

- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- **AI Review V2.1 追加修复（PR #103 review B1/B2）**：① 开局分散语义收敛——OPENING_MAP_CONTROL 重命名为 OPENING_SPREAD（TeamSoloIntentSkill / SoloPlayIntentSkill + summary 中性化，TeamEvidenceFormatter 输出 intent=OPENING_SPREAD，不再向 LLM 暴露「图控/拿视野」标签）；Team/Player Prompt 同步：开局分散定义为「地图信息覆盖 ↔ 局部兵力集中度」的战术交换（允许 general tactical interpretation，禁止无专门 visibility evidence 的具体点亮/侦察归因），CAPTURE_RULE「失去高视野」改为「减少分散的地图覆盖（是否实际损失需 evidence）」；新增生产链路集成测试（TeamEvidenceFormatter→TeamAiPromptBuilder user content / player TacticalReviewPromptBuilder 均无拿视野/点亮/侦察收益、无 OPENING_MAP_CONTROL）。② Focus Window 改 bounded core window：阵亡子窗口 ≤20s 有界（sliding），窗口外阵亡不污染核心事实（真实回放验证 collapse core = 109–128s，本方 3 死对方 1 死，BEFORE 7v7 → AFTER 4v6）；评分改为 swing 优先（|fd−ed|×800 + 总死亡×200 + 支撑信号），单边 collapse 不被 balanced massacre 靠总死亡压掉；新增 112/121/128/132/136 回归（136s 对方阵亡不得把 3:1 改成 3:2）与 balanced-vs-collapse 排序测试；TeamReviewRealReplayProbeTest 更新为 bounded-core 断言（真实样本验证 3:1 core，无样本 CI 自动跳过）。③ Team Autopsy 允许 mvps / biggestLiabilities 为空（结算级无数据支持异常时不强行挑人/评选）。
- **AI Review V2 — Canonical BattleTimeline（ai-review-v2-canonical-timeline）**：wotb-core 新增 `com.wotb.core.replay.timeline` 唯一权威时间线域——`BattleTimelineBuilder`（1 秒 `BattleFrame`，battle-relative 时钟硬门禁：IDENTIFIED / ESTIMATED（`BattleEnded.raw − duration`）/ UNRESOLVED→拒绝；`frameAt(t)` 确定性查询；精确事件按 (N-1, N] 保留不丢失）；`FrameVehicle`（identity + lifeState + `FrameHealth`（currentHp 与 baseHp/effectiveMaxHp 严格分开，tankopedia base 不冒充本场 maxHp）+ `FramePosition`（CURRENT/LAST_KNOWN + age + source）+ orientation + `FrameMapState`（九宫格/区域/语义标签，复用 map-semantics）+ `VehicleKnowledgeState`（POSITION_STREAM_ACTIVE/LAST_KNOWN/UNKNOWN/DESTROYED_KNOWN 保守语义，Type-5 未证明不声称点亮）+ 累计伤害 + destroyedKnownAtSec）；anti-future-leak invariant（帧状态只用 ≤t 事件；battle_results 最终状态不反写历史；重亮后仅 bounded retrospective HP_GAP_DELTA）；`BattleTimelineValidation` 错误码（TIMELINE_*，§4）——无法构建 → 拒绝 AI Review，**移除 settlement-only fallback（§3，`AI_TIMELINE_UNUSABLE` 业务错误，不调用 LLM）**；`BattleDeltaEngine`（帧间确定性 delta：FIRST_KNOWN/ENEMY_LOST/ENEMY_REACQUIRED/HP_CHANGE/HP_GAP_DELTA/DESTROYED/ALIVE_COUNT_CHANGE/LOCAL_FORCE_CHANGE/POINTS_CHANGE/ENGAGEMENT_ACTIVITY）；`EpisodeDetector`（确定性章节：强信号优先、首选 15–45s、硬最小 8s、覆盖整场无重叠，禁止固定 30s 切块）；`TimelineMapEnricher`（gridRegion/areaId/semanticTags/elevation，禁止 exact LOS 断言）。wotb-web：`PersonalAiContextCompiler` + `TeamAiContextCompiler`（Episode 化 compact 上下文：BEFORE/EVENTS/AFTER/TACTICAL_CHANGE + 双方世界状态 + 敌方已知/未知分布），Call #2 prompt 注入 `TACTICAL TIMELINE` 段（SNAPSHOT→PRIOR→TIMELINE→CRITICAL WINDOWS→TASK，§33）；`TacticalReviewHarness` 在录像者解析后立即构建 timeline、无效即拒绝；`PlayerReplayAnalysisService.analyzePlayerOrFallback` 无重建/录像者未解析即拒绝（不再 settlement-only）；团队 prompt 注入双方对称 timeline 段；`BattlePlaybackAdapter` 从 timeline 派生 `MapOverview.Playback`（parity 测试证明与 MapOverviewBuilder 同一事实，battle-relative 时钟修正了 legacy raw-clock 隐含 start=0 的开战前偏移）；Context 可观测性 `wotb_ai_review_context_section_tokens{section}`（低基数，§38）。测试：timeline builder/validation/anti-future-leak/episode/structural-eval（事件无丢失无重复、deterministic、Episode 覆盖完整）+ 真实夹具端到端（random-bat... (line truncated to 2000 chars)
- **百场回放审核证据持久化（hundred-replay-evidence）**：新增 Flyway `V19__create_hundred_battle_replay_evidence.sql`（`hundred_battle_replay_evidence`：submission_id FK RESTRICT + slot(1..5) + original_filename + sha256 + file_size + arena_id + created_at，`unique(submission_id, slot)`）；`createSubmission` 在全部硬门禁通过后把 5 个原始 `.wotbreplay` 内容寻址落盘（复用 `HallOfFameReplayStorage`，同 `HOF_REPLAY_DIR`，幂等/原子/防路径穿越）→ 单事务写 submission + 恰好 5 行 evidence，文件存储失败 / DB 失败 → 整单失败 + 已存文件 best-effort 清理（引用计数保护），不再出现「校验后即丢弃、管理员无证据」；新增 `HundredReplayEvidenceService`（storeAll/attach/discardForSubmission/adminListEvidence/downloadEvidence，跨表引用计数：hall_of_fame_record + 本表均无引用才删物理文件，失败仅 WARN 保留 orphan）；终态（APPROVE/REJECT/CANCEL）同事务删 evidence 行 + commit 后清理物理文件；新增 admin-only 端点 `GET /api/admin/hof/hundred/submissions/{id}/replays`（metadata 列表）与 `GET .../submissions/{submissionId}/replays/{replayId}`（原始字节下载，ownership 校验 + UTF-8 filename + octet-stream + 明确 404），SecurityConfig 零改动（`HOF_ADMIN_PATTERN` 已覆盖）；前端 `HoFAdminPage.vue` 审核弹窗新增 Evidence 区（截图点击放大 + 下载截图 + 5 replay 逐个下载 + legacy 空态提示「原始回放不可用」）；旧 PENDING（无 evidence 行）replay 列表返回空数组、不报错、不伪造 replayAvailable。
- **名人堂「百场」排行榜（hundred-battle）**：新增后端域 `com.wotb.web.hundred`（`HundredBattleSubmission` 单表承载完整生命周期 PENDING/CURRENT/SUPERSEDED/REJECTED/CANCELLED/DELETED；Flyway `V18__create_hundred_battle_submission.sql`，partial unique index 在 DB 层保证 user+vehicle 最多一个 PENDING / 最多一个 CURRENT）；公开 `GET /api/hof/hundred?vehicleId=&page=&size=`（单车辆独立排行，competition ranking 1,2,2,4 由分组计数前缀和 query-time 派生、不落库，跨页并列全局正确，只输出 approved* 快照）；提交 `POST /api/hof/hundred/submissions`（登录 + Profile gameId/nickname 前置校验、后端 Tier X authoritative 校验、固定 1 张 base64 截图（复用 Boost data:image 校验模式）、正好 5 个 replay 硬门禁：全部解析成功 + gameId/vehicleId 匹配 + 5 场不同 battle，任一失败整单拒绝不进入 PENDING）；用户取消 `POST /api/hof/hundred/submissions/{id}/cancel`；个人中心 `GET /api/users/hundred/status`（CURRENT/PENDING/最近拒绝）；管理后台 `/api/admin/hof/hundred/**`（列表/详情/approve/reject/delete，`@Lock(PESSIMISTIC_WRITE)` 行锁 + 状态复核使终态迁移仅 PENDING→terminal 一次成功；approve 事务内重新读取 CURRENT 并按管理员 approvedAverageDamage 严格比较，旧 CURRENT→SUPERSEDED；reject/delete 原因强制）；SecurityConfig 为 `/api/hof/hundred/submissions/**` 增加登录门禁（置于 HOF_PATTERN permitAll 之前）；proof 截图在审核终态事务内清空（不永久保存）。
- **排行榜 → 名人堂（Hall of Fame）全技术域迁移**：后端包 `com.wotb.web.leaderboard` → `com.wotb.web.hof`（`HallOfFameController/Service/UploadService/Record/Repository/Mapper/ReplayStorage/StorageException`）；旧 REST `/api/leaderboard/**` 全部移除，新 API `/api/hof/**`（统一公开查询 `GET /api/hof?battleType=&tankId=&nickname=&page=&size=`，排序 damage DESC → RATING 优先 RANDOM → battleTime ASC NULLS LAST → createdAt → id，rank = 当前 filter 上下文位置排名）；前端 `?view=hof`（`HoFPage.vue`），旧书签 `?view=leaderboard` canonicalize 到 `?view=hof`；三语文案 排行榜→名人堂（`hof.*` / `hofAdmin.*`）。
- **战斗模式数据模型**：`hall_of_fame_record` 新增 `battle_type`（VARCHAR+CHECK：RANDOM/RATING）与 `arena_bonus_type`（raw integer）；`HallOfFameBattleTypePolicy` 集中 raw → 归一映射（1=RANDOM、7=RATING，训练房/联赛/娱乐/未知 → UNSUPPORTED，上传 400 `UNSUPPORTED_BATTLE_TYPE` 零持久化）；Flyway `V16__rename_leaderboard_to_hall_of_fame.sql`（rename-in-place + backfill RANDOM/1）与 `V17__create_hall_of_fame_admin_log.sql`（admin 审计表）。
- **名人堂管理后台**：`GET/DELETE /api/admin/hof/**`（需 `HoF-admin` 或 `wotbtools-admin`；HoF-admin 只管理名人堂，不可访问其他 admin 域）；搜索 nickname/accountId/arenaId/uploadedBy/battleType/tankId/replayAvailable，排序 damage/battle_time/upload_time，分页 20/50/100；hard delete（audit+record delete 单事务，失败回滚；commit 后最后引用清理物理文件，失败仅 WARN；删除后同一回放可重新上传）；操作审计（DELETE_ENTRY 完整快照，只读）；前端 `?view=hof-admin`（`HoFAdminPage.vue`，角色门禁 + 删除二次确认 + 记录/日志双 tab）。
- **并发安全**：`ReplayHashLock`（PostgreSQL advisory lock，hash 前 16 hex 为 key）串行化「upload：store+recordRecorder」与「admin delete：事务+引用计数+文件清理」，保证不变量「DB 引用 H ⇒ H.wotbreplay 存在」（多实例安全）；WebApiTest 真实 PG+FS 并发测试覆盖。
- **配置迁移**：`LEADERBOARD_REPLAY_DIR` / `LEADERBOARD_REPLAY_MIN_FREE_BYTES` → `HOF_REPLAY_DIR` / `HOF_REPLAY_MIN_FREE_BYTES`（application.yml / prod+online compose / .env.example 同步，无旧变量 fallback）；Keycloak realm 增加 `HoF-admin` 角色（provision，无授予 UI）。
- **测试**：WebApiTest 新增公开查询/排名/过滤器、安全矩阵（anonymous/wotbtools-user/HoF-admin/wotbtools-admin）、admin delete 全矩阵（audit/共享 hash/最后引用/404/hash null/文件缺失）、delete+upload 并发 invariant；新增 `HallOfFameMigrationTest`（V1..V15 旧 schema → V16/V17 迁移验证 rename/backfill/数据保留）、`HallOfFameBattleTypePolicyTest`、`HallOfFameAdminServiceTest`；SecurityConfigTest 补 HoF-admin 角色矩阵。

- **排行榜回放文件存储与下载**：/api/leaderboard/upload 改为需登录（JwtUtil.requireUserId，
  未登录 401 AUTHENTICATION_REQUIRED）；上传流程接入 ReplayUploadValidator（类型+20MB，复用既有
  错误码）+ ReplayParser.parse 失败 → 400 INVALID_REPLAY_FILE（原 500）；新增
  LeaderboardReplayStorage（SHA-256 内容寻址，临时文件 .tmp/ + 同目录原子 move 幂等落盘，
  FileAlreadyExistsException 并发复用，不覆盖已有文件；磁盘 reserve 计入 incoming 大小
  usable - incoming < minFreeBytes → 507 REPLAY_STORAGE_FULL；文件系统失败 → 500 REPLAY_STORAGE_ERROR）；
  DB 更新失败不删除已入存储文件（保留安全 orphan，同 hash 未来上传复用；孤儿清理由未来 maintenance job 处理）；
  LeaderboardService.recordRecorder 状态机 SAVED/ATTACHED/IDEMPOTENT/SKIPPED_*（历史记录 hash NULL →
  ATTACHED 补写；同 hash → IDEMPOTENT；异 hash → SKIPPED_HASH_CONFLICT 绝不覆盖）；新端点
  GET /api/leaderboard/{id}/replay（需登录，任意已登录用户可下载；无文件/文件丢失 → 404
  REPLAY_FILE_NOT_FOUND；ContentDisposition UTF-8 安全编码原始文件名，不参与路径）；Flyway
  V15__add_leaderboard_replay_file.sql（replay_hash/file_name/size/uploaded_by 可空，不 backfill）；
  DTO 新增 replayAvailable（由 metadata 推导）；前端下载走 authenticated fetch → blob →
  createObjectURL（禁止裸 href）；生产/本地 compose 挂 replay_data volume（/data/replays）。
  配置：LEADERBOARD_REPLAY_DIR（默认 data/replays）、LEADERBOARD_REPLAY_MIN_FREE_BYTES（默认 512MiB）。
  Replay 为 best-effort 可丢数据（不纳入 DB 备份；文件丢失下载 404 容错）。

- **PR4 — Player/Tank Labels & Collision UX（§26–§37 + QA 场景）**：
  - **显示开关（§26）**：Battle Playback 控制栏新增「显示玩家名 / 显示坦克名」checkbox
    （默认 玩家名关 / 坦克名开），localStorage 持久化（`wotb.pb.label-prefs`），刷新/再次进入保留。
  - **两行共享背景 label 块（§27/§28/§29）**：PlayerName + TankName 共用一个半透明深色背景
    （自适应宽度、小圆角、细边框、轻阴影）；只显示一行时背景自动收缩；文字色跟随 team token
    （friendly green|blue / enemy red，`--pb-team-text`/`--pb-enemy-text`）；
    destroyed/last-known 只弱化文字、background 保持正常。
  - **PlayerName 截断 + tooltip（§30）**：按实际像素宽度截断（max-width + ellipsis，非字符数），
    只有截断才显示完整名 tooltip；被碰撞隐藏时 tooltip 随行一起消失。
  - **标签碰撞（§32/§33/§34/§35）**：新增纯函数 `utils/labelLayout.js`——viewport 内
    marker 才参与（越界裁剪）；TankName 冲突 → 上方标签**从下往上** greedy 轻量上移（下方先
    finalized、上限一行，接受剩余 overlap，3+ 连锁不重新产生 overlap，禁止复杂 solver）；
    PlayerName 与任一 TankName 冲突 → 隐藏候选，经**时间稳定阈值**（hide 250ms / show 300ms，
    `performance.now` **UI wall clock**——播放由 frame 刷新、暂停由轻量 RAF 继续推进，
    不依赖播放状态）后 hide/show，恢复带 ~120ms opacity fade-in（类保持完整生命周期不被
    下一次 resolve 取消）；PlayerName 盒从 final TankName 盒推导（与共享 label 块整体位移
    一致）；zoom 由 computed 依赖 view.scale 天然在缩放结束重算。
  - **hull hitbox + 重叠选中（§36/§37）**：点击命中从整盒改为车体视觉范围 + 小 padding
    （dedicated 90%、generic 58%×90%，随 marker 缩放；不含 gun overflow/label/三角/菱形/✕，
    destroyed/last-known 仍可点）；多个 hitbox 重叠 → 取指针距离最近车辆，距离几乎一致且已有
    selected → 保持，否则 render order tie-break。
  - **倍速与循环**：倍速循环加入 0.5×（0.5→1→2→4，§49 QA 场景需要）；BattlePlayback 新增
    `loop` prop（时间线到末尾自动回绕，QA 场景用）。
  - **隐藏 QA 页 `?view=playback-qa`（§48/§49）**：仅 wotbtools-admin；固定 14 车移动场景
    （双密集簇碰撞压力 + 阵亡/失察/录像者状态混合），直接复用生产 BattlePlayback
    （loop + Play/Pause/Reset + 0.5×–4×），不引入第二套渲染。
  - **全屏模式（原生 Fullscreen API）**：控制栏「⛶ 全屏 / 退出全屏」按钮（zh/en/ru 三语）；
    全屏对象 = 整个 Battle Playback 容器（地图 + 全部 controls + 标注），不含页面 header/nav；
    状态事实源 = `document.fullscreenElement` + `fullscreenchange`（ESC/浏览器 UI 退出立即同步，
    不维护手工翻转）；不支持 Fullscreen API 的浏览器隐藏按钮不抛错；进入/退出不 reset
    currentTime / playing / speed / selected / zoom / pan / filters / label 偏好 / annotations。
    尺寸响应：新增 ResizeObserver 驱动的 `mapSize` reactive（无 RO 环境回退 clientWidth），
    markerScreen / labelLayout / selectAt / textInput / annotation 换算全部改用新尺寸——
    fullscreen enter/exit 后 collision / hitbox / 标注坐标立即按真实容器尺寸重算（无 magic delay）；
    zoom/pan 保持不 reset（无 auto-fit，Reset View 由用户使用）。
  - **hysteresis 时钟接管（Review Blocker 1）**：播放中若有未决 hide/show/fade transition，
    Pause 或播放自然结束时由轻量 hysteresis RAF 接管 wall clock（无 pending 不启动轮询）；
    play() 作废残留 hystRAF（frame 驱动接管），避免 pause 时误判已有时钟。
- **PR3 — Tactical Marker State Visual Redesign（§19–§25）**：
  - **Team Color System（§19/§20）**：新增 frontend/src/data/mapTeamColors.js——28 张地图
    全部显式配置 friendly tone（green|blue，与地图主基色避免混淆；初值可视觉 QA 调整）；
    enemy 固定 red；semantic tokens（TEAM_TOKENS：green/blue/red × text/outline/glow，
    Battle Playback 局部 CSS vars --pb-team-*/--pb-enemy-*，根元素按 mapCode 注入）；
    **新增完整性测试（CI 门禁）：mapImages 每 key 必须显式配置 tone，值域合法，
    无多余 key——新增地图未配置 → CI FAIL，禁止默认色 silent fallback**。
  - **整车 team outline + glow（§21）**：VehicleMarker .pb-graphics 容器双层 drop-shadow
    （近扩散 outline + 远扩散 glow），generic 与 dedicated 同构；PR2 B3 过渡色
    （暖橙/冷青，仅 dedicated）被正式 team token 取代（friendly green|blue / enemy red）。
  - **Selected 红色倒三角（§22）**：生产 marker 旧白色圆环 → label 上方红色倒三角
    （#e5484d，永远朝下、screen-space 恒定经 overlayInverseScale 反缩放、轻微上下浮动
    1.6s 循环、深色阴影对比边）；prefers-reduced-motion 停止浮动。
  - **Recorder 空心菱形（§23）**：黄色圆环 → tank 下方居中空心菱形（地图 friendly 色
    var(--pb-team-outline)、静态、screen-space 恒定）。
  - **Destroyed（§24）**：极端透明 0.35 → 中度变暗 0.55 + grayscale；team outline 弱化保留
    （drop-shadow 在 grayscale 后绘制不灰化）；一次性 transition 0.45s（reduced-motion 直达
    终态）；红色 ✕（PR2 用户要求通过项）保持完整强度（容器外）。
  - **Last-known（§25）**：root opacity 0.3（会连带淡化 ✕/label）→ .pb-graphics 容器淡化
    0.35 + 仅弱 outline（无 glow）；label 仅文字弱化（background 保持正常）；
    Selected/Recorder 不受影响（容器外、正常强度）。
  - **QA 页**：新增阵营预览切换（friendly-green / friendly-blue / enemy-red，i18n 三语 +
    测试），canvas 注入 team CSS vars + team class，hull/turret outline/glow 与生产同构；
    destroyed 预览同步 PR3 语义（0.55 + grayscale + 弱 outline）。
  - **车辆视觉尺寸上调（PR3 增补，人工 QA 全局地图视角辨识度不足）**：marker box
    desktop 28 → 36px、mobile 22 → 28px（约 +28%）；generic img scale 131% → **134%**
    （重新校准：generic 素材车体长边占 65.6%、dedicated hull.webp 占 88.1%，
    134% = 0.881/0.656 使 generic 车体长边视觉与 dedicated 对齐，36px 下均 ≈31.7px；
    不保持历史 131% 而引入比例差）；zoom 契约不变（viewport 整体 scale，车辆随地图缩放，
    name/✕/selected/recorder 继续 inverse-scale 屏幕恒定）；Selected 三角 bottom +15 → +19px
    （避免与 name label 3px 重叠）；halo 固定 px 不随模型放大（不过度扩散）。
  - **阵亡主状态 + 炮线短生命周期（PR3 增补 2，人工 QA 阵亡/炮线 UX）**：
    - destroyed ✕ 22 → **30px** 并从名字旁移到**车体中心**（top/left 50% + translate(-50%,-50%)，
      覆盖车辆主体、高对比、不随 .pb-graphics grayscale/opacity 变淡、overlayInverseScale
      screen-space 恒定）——第一眼看出"这辆车死了"，不再像名字旁的状态角标；
    - destroyed + selected 时 selected 红色倒三角切换**克制变体**（线性缩小 67% + 透明度 0.55，
      destroyed > selected，仍可辨认被选中；存活 selected 保持完整强度）；
    - 炮线由"挂地图整秒"改为**短 shot effect**：可见窗口 1.0 → **0.4s 真实时间**
      （1×/2×/4× 一致，`TRACER_BASE_SEC=0.4`），保持期 0.4 → 0.15s 后快速线性淡出；
      命中端闪光改**峰值曲线**（`flashOpacity`：0 → 0.1s 达峰值 0.9 → 0.35s 归零，
      `TRACER_FLASH_PEAK_REAL_SEC=0.1`），闪光结束不再渲染圆点（不残留孤立端点）；
    - 炮线端点仍为**事件时刻可信位置**（trustedPositionAt），绝不绑定车辆后来的位置——
      历史射击几何不变，移动目标不再出现"炮线穿过坦克"的假象。
  - **overlay 屏幕间距恒定（PR3 增补 2 Review B2）**：selected 倒三角 / recorder 菱形的
    layout offset（bottom/top calc）此前处于 viewport 整体 scale 空间——1×/2×/4× 下间距
    按 19/38/76px、5/10/20px 增长；现按 `overlayInverse`（=1/view.scale，BattlePlayback
    view model 新增数值字段）反缩放：recorder→vehicle 恒 5px；selected bottom 按
    X = 4.5 + 14.5×inv px 推导使三角底边跟随 name 顶边、selected→name 屏幕 gap 恒 3px
    （1× 仍 19px 车辆契约）；浮动幅度 calc(2px * var(--pb-overlay-inv)) 恒 ≈2px；
    name/✕ 既有语义与 zoom/pan 算法未动。
- **Tier X 专属俯视车型系统（PR1：ASSET_GENERATION_READY）**：新增 frontend/src/vehicle-models/ 集中静态 mapping（common/tankopedia-tier10.json 84 辆 Tier X → 81 个 baseModelKey，skin/特殊版本复用基础模型：sheridan / kpz-70 / type-5-heavy 三组合并）与 discriminated union 类型契约（turreted 必配 turret + turretPivot，turretless 禁止）；统一 SVG viewBox 320×320 技术契约 + metadata.json schema（8 键）；validator（validate.js，CI 与 CLI 共用）与 Tier X 100% 覆盖门禁（coverage.test.js：新增 Tier X 无 mapping → CI FAIL、mapping 孤儿/未知引用/半成品资产目录均 FAIL）；契约样例资产 assets/sample/；BlitzKit 辅助脚本（frontend/scripts/blitzkit-references.mjs，参考图 URL 已验证并缓存 84 张，gitignored）与 CLI 自检（validate-vehicle-models.mjs）；隐藏 admin QA 页 ?view=vehicle-models（仅 wotbtools-admin，车体/炮塔旋转 + pivot + 状态叠加预览，复用生产 BattlePlayback 渲染方式）；文档 docs/assets/tier-x-models/（README 交接清单 + 全局 SVG 生成规范 + 生成的 84 辆 inventory）。正式车型 SVG 由 ChatGPT 按规范生成，到达 ASSET_GENERATION_READY Gate 后暂停（本 PR 不含正式车型资产）。

### Fixed
- **战局回放死亡时刻校准（`DeathTimeReconciler`）**：死亡时刻优先级链改为「结算 `deathTimeMillis`
  （游戏权威）> 重建事件流 EXACT `alive=false`（HP=0，同实体→账号映射，取最后一条=最终阵亡）>
  legacy 启发式（damage-threshold / EntityLeave / Position 停止，且不得早于最后一条 EXACT
  `alive=true`——被 alive 证据证伪的 legacy 置 UNKNOWN=0，不保留也不伪造新时刻）」。实体身份
  只复用 `TeamEntityMapper` 的权威 `TeamEntityMapping`（冲突/低置信实体证据拒绝，nickname
  fallback 复用）。修复结算缺失死亡时刻（如 11.19 回放 proto #104=0）时 legacy damage-threshold
  启发式只看累计伤害越阈、无视同实体 EXACT HP 观测，把「残血仍存活」提前误判为阵亡的问题——
  真实样本 IS-4 在 96.9s 被误标（实际 HP=102 alive），校准后死亡时刻 128.12s。
  `DefaultReplayProcessingFacade` 重建成功后对非存活且结算无死亡时刻的玩家校准 `survivalTimeSec`；
  **覆盖范围为重建路径（playback 与 AI 复盘，`full()`）**，`summaryOnly()` 预览/导出路径无重建
  事件源保留 legacy。前端死亡 ✕ 仍只消费 `deathSec` 单源，无前端改动。

### Removed
- **隐藏 admin QA 页 `?view=vehicle-models`（车型预览）**：删除 VehicleModelPreviewPage.vue 及其测试、
  App.vue 的异步入口/视图注册/注释、仅其使用的 i18n `adminPreview.*` 文案（`loading`/`denied` 保留，
  PlaybackQaPage 共用）；`?view=vehicle-models` 不再是合法视图，输入该 query 回退默认视图。
  正式 Tier X WebP 资产 / mapping / types / pivot / validator / coverage / texture-bake / extractor /
  baker / runtime loader（Battle Playback 生产路径）全部保留；`check-bundle-separation.mjs` 门禁改为
  以生产 runtime.js 动态 import chunk 为资产分离判据（主入口不得含车型资产标记）。

### Changed
- **PR1 资产生成路线切换：BlitzKit 确定性提取（替代 AI 手绘）**：
  - 新增 `frontend/scripts/extract-tier-x-model.mjs`（extractor）+ `extractor-lib.mjs`（纯函数库）+
    `protos/models.proto`（BlitzKit 官方 schema，字段号一致）：tankId → model.glb + models.pb +
    tanks.pb → 节点分组（复刻 TankModel.tsx 契约：`hull`/chassis_track_*/turret_{id:02d}/
    gun_{id:02d}(+_mask)，排除 *_hide_elements*）→ 俯视投影 → 分组凸包 silhouette → 统一 fit
    320×320 → hull.svg/turret.svg/metadata.json；turretPivot 由 turret_origin 经 correctZYTuple
    自动投影（同一 fit 变换）；网络仅存在于 developer CLI（缓存 gitignored，失败显式报错不 fallback）。
  - **坐标语义（源码+实测确认）**：GLB 顶点 = 模型坐标（x宽/y长 forward=+y/z高）；models.pb origin =
    引擎坐标（x宽/y高/z长）；correctZYTuple(x,y,z)=(x,z,y)；默认配置 = turrets/tracks/guns 数组最后
    （BlitzKit tankToDuelMember）。差异报告：collision.glb 是装甲碰撞网格（{part}_armor_{N}），
    分层车型模型是 model.glb（Maus 实测 77 节点）。
  - **metadata schema 切换 geometry-source**：顶层 5 键 modelKey/kind/source/turretPivot/generation；
    正式资产强制 source.provider=blitzkit + generation.method=blitzkit-model-topdown-extraction
    （validator 强制）；sample 更新为新 schema。
  - **extractor 2D geometry 修复（Blocker 1-4，Maus 真实 silhouette）**：
    - Blocker 1：禁用全局 convex hull（会把 Maus 压成矩形）；改为 projected triangle polygon union
      （polygon-clipping）——POSITION+INDEX 读取、节点/世界矩阵应用、top-down 投影、退化三角形过滤、
      精确 union（保留全部凹轮廓与洞）、轻量共线简化、evenodd SVG path；Maus hull 轮廓 64 顶点
      （含履带裙板阶梯与首上装甲细节，非矩形）。
    - Blocker 2：collectTriangles 递归过滤 *_hide_elements*（此前 turret_01_hide_elements 细长条
      被错误并入炮塔）；方向自洽证据：炮盾（gun_01_mask）在座圈前方 → 车头=+y，炮管从炮塔前端伸出；
      turret 证据输出（raw bbox/center/origin/final SVG 顶点数）。
    - Blocker 3：gun_{id}_mask（mantlet 炮盾）归入 turret 层（TankModel.tsx 源码确认 mask 与 gun 同层
      渲染，但静态 0° 它是炮塔正面轮廓）——gun 层仅炮管（Maus gun tris 70，silhouette 细管不扩大）。
    - Blocker 4：generation.method 更名 blitzkit-model-topdown-extraction（schema/validator/sample/docs/tests 同步）。
- **extractor 视觉信息密度（Layer B 结构细节，Maus Visual Detail）**：
  - 在真实 silhouette（Layer A）之上新增 deterministic 结构细节：top-facing major surfaces
    （三角形法线 z>0.35 + 高度层聚类 zTolerance=0.5 → 区域色块：主甲板/屋顶/裙板层）与
    major structural edges（surface-edge 平台边缘 / height 高度差 / normal 辅助；
    minEdgeLenM=1.5 + 屏幕空间过滤 minDetailPx=0.8 ≈ 1px@28px）。
  - Maus hull.svg：履带独立深色区域、主甲板层（含真实炮塔座圈凹口）、前装甲带、车尾结构孔洞、
    28 条结构边（≥1.5m，非 wireframe）；turret.svg：屋顶层色块、炮盾（mantlet）独立区域、8 条结构边、
    细炮管——320px 一眼可辨 Maus（宽履带/宽车体/座圈位置），28px 主色块可读不糊噪。
  - extractor-lib 新增：triangleNormal / extractTopSurfaces / extractMajorEdges（含 multi-owner 边修复）
    / minSvgUnits / surfacesToSvgPaths / edgesToSvgPath；svgDocument 支持 stroke/strokeWidth/fill-rule。
  - metadata.generation 增加 detailMethod=top-surface-and-major-edge-extraction + detailThresholds；
    debug artifacts（silhouette/top-surfaces/major-edges/final/extraction-report）输出到 gitignored 缓存。
  - 新增 14 用例（top-facing 判定/高度层聚类/碎片过滤/平台边缘/共享边去重/短边过滤/格栅过滤/
    确定性/分层正确性/wireframe 上限/pivot 稳定）。
  - **Layer B V2「少而强」修复（2026-08-18，Maus Visual Gate 第二轮）**：
    - simplifyRing 退化修复：polygon-clipping 的 ring 含相邻/闭合重复点，重复点使叉积退化 → 真实角点
      被误删（Maus glacis 全宽带塌成细条、turret 环带塌成发丝线）——先按坐标去重再简化，bbox 不变；
      屏幕空间过滤改用简化后的 ring（与实际渲染一致），发丝状退化 polygon 正确剔除。
    - 凸起显著性过滤（bumpSignificanceRatio=0.1）：层内凸起面积占比过低的碎块 = 粗糙网格面片伪影
      （Maus turret 屋顶 16 个 0.6m 面片块 + 2 条退化长条）→ 丢弃；只保留有语义的大特征
      （hatch / cupola / 甲板条带）——turret 凸起从 20 个噪块收敛为 4 个真实特征。
    - 结构边聚类去重（clusterEdges）：角度差 ≤5° 且中点距离 ≤0.5m 视为同一条结构线只留最长一条
      （Maus 前甲板 4 条交叉斜线 X 形噪纹 → 1 条）；先聚类再按投影长度截断（hull ≤8 / turret ≤6）。
    - hull 绘制顺序调整：主面 → 履带（深色侧带覆盖在主面之上可见）→ 凸起 → 结构边。
    - Maus 资产更新：glacis 带恢复全宽 109×60px、turret 环带 20×133px、履带侧带可见；
    - Maus 资产更新：glacis 带恢复全宽 109×60px、turret 环带 20×133px、履带侧带可见；
      新增 8 用例（simplifyRing 去重回归/bbox 不变、bump 显著性、clusterEdges 聚类/保留）。
  - **HIGH-FIDELITY ASSET 方向调整（2026-08-18，PR1 资产生成最终策略）**：
    - 目标从"为 20-30px marker 主动简化"改为"高保真俯视资产 + 未来 runtime LOD"：
      asset 保存真实比例与可见结构（retention target ≥ 90%），小尺寸显示交给后续 runtime LOD；
      本 PR 不实现 runtime LOD，但 SVG 已按 detail-level grouping 输出结构准备。
    - **删除 aggressive 过滤**：bumpSignificanceRatio（相对占比过滤）、edges 数量上限
      （hull ≤8 / turret ≤6）、按 28px marker 的 minDetailPx 过滤——全部移除；
      保留 clusterEdges（duplicate/overlapping 去重，收紧 angleDeg 5°/maxDistM 0.2m）与 simplifyRing 修复。
    - **凸起判据改为局部不连续**（bumpHeightDeltaM=0.06）：层内凸起面经共享边连通成分量，
      分量与外界无共享边（隔离：cupola/hatch 隔垂直壁）或共享边高度差显著（台阶带）→ 保留；
      连续斜面面片（tessellation）剔除。真实 hatch 即使只占屋顶 3-5% 也保留
      （Maus 甲板 2 个侧舱盖 + 中央舱盖 + turret cupola 全部恢复）。
    - **feature edge 判据收紧**：normalDeltaCos 0.92 → 0.995（~5.7°，剔除同一平滑曲面内
      tessellation 对角线）；surface-edge 要求显著壁高（> heightDeltaM，用壁面顶点 z 跨度而非重心）；
      minEdgeLenM 1.5 → 1.0（保留 hatch/panel 级边缘）；无数量上限
      （Maus hull 18-20 条、turret 6-7 条全为真实结构边）。
    - **detail-level grouping**：SVG 输出 <g class="vehicle-primary / vehicle-secondary /
      vehicle-micro-detail">（classifyDetail：silhouette/tracks/mantlet/gun/大型 deck-roof → primary；
      hatch/cupola/vents/engine deck plates/≥3m 边界 → secondary；小 hatch/小屋顶结构 → micro）。
    - **asset-space 微噪声过滤**：minDetailUnits=0.3（320 viewBox units）+ sliver 判定
      （宽高比 >12 且窄边 <0.15m 的退化狭长 polygon 剔除，如 turret 68×2.5 units 细条）。
    - **fidelity 契约**：metadata.generation 增加 fidelity='high' / geometryScale='faithful' /
      visibleDetailRetentionTarget=0.9（contract target，非测量值）；validator 对正式资产强制。
    - **debug evidence 扩展**：all-visible-surfaces / retained-surfaces / removed-tiny-details /
      feature-edges / final-high-fidelity + extraction-report 统计
      （visible/retained/removed regions、edges、primary/secondary/micro path 数）。
    - Maus 资产：hull.svg 11.1KB 82 paths（primary 48 / secondary 33 / micro 1）、
      turret.svg 4.8KB 35 paths（primary 10 / secondary 24 / micro 1）；
      甲板/glacis/后带/裙板 + 舱盖×3 + 前带 + 后带 + 履带 + 20 结构边；
      turret 主体/环带/台阶带/cupola/16 屋顶面片块（真实模型凸起，归 secondary/micro）/mantlet/gun + 6 边。
    - 测试：删除 edges 上限 / bump 显著性 / minDetailPx 相关用例，新增 tessellation 边剔除、
      surface-edge 壁高、bump 分量判据、classifyDetail 分级、faithful scale（gun 宽度无夸大）、
      fidelity 契约等 14 类用例——extractor 59 用例，全套 447 全绿。
    - 32 行 spec 重写为 "Asset fidelity first. Runtime readability handled later."。
  - **视觉表面合并 + 遮挡过滤（2026-08-18，Maus High-Fidelity Gate Blocker 1/2/4）**：
    - mergeVisualSurfaces：model.glb 的 triangle tessellation / low-poly topology 按共享 3D 边 +
      法线差 ≤20° + 高度差 ≤0.4m 合并为视觉连续表面——连续 roof/deck/环带斜面是一个/少量
      polygon，绝不输出三角马赛克（Maus turret ring 61→6 表面、roof 297→34、deck 205→79）；
      真实结构分离（height step / vertical wall / gap / strong normal break / isolated feature）
      保持独立表面——hatch/cupola/台阶带/面板自然成为独立表面，删除 zMean 切斜面机制；
    - filterOccludedSurfaces：俯视可见性顶层优先，被高处表面完全覆盖的 hidden geometry
      （甲板下方的裙板固定件等）剔除（Maus hull 122→31 表面、turret 22→19）；
    - Maus 资产：hull.svg 6.4KB 36 paths（primary 6 / secondary 6 / micro 24）、
      turret.svg 7.2KB 24 paths（primary 7 / secondary 9 / micro 8）——
      turret 屋顶单一连续区域（无面片块马赛克）、环带合并为两条、甲板/glacis/后带/舱盖/
      cupola/侧裙板条等真实结构保留；
    - extraction-report 增加 merge 统计（rawProjectedRegions / mergedVisualSurfaces /
      tessellationRegionsMerged / retainedRegions / removedTinyRegions）；
      小凸起保留/遮挡过滤/确定性/无旧 bump 色）——extractor 61 用例，全套 449 全绿。
  - **fidelity correctness audit（2026-08-18，Blocker 1/2/3/4）**：
    - turret 比例审计：models.pb turret bounding_box（引擎坐标 ±1.534 / -2.374..2.149 / -0.034..1.497）
      与 turret_01 mesh bbox（模型坐标 ±1.534 / -3.519..1.004 / 2.106..3.638）长度一致（4.523m），
      差 = turretOrigin；最终 SVG turret 主体 bbox 比例 1.469 vs source 1.474（误差 0.4%）——
      纵向长度真实，无异常拉长（新增 bbox projection fidelity 测试锁定）；
    - over-merge 审计：merge 边连续性统计（每 large surface 的合并边 maxDz/maxAng、
      dz>0.15/ang>10° 计数）——Maus 主甲板平坦（z 2.12 恒定）、前/后带与环带均为连续斜面，
      无跨真实结构边界合并（真实台阶隔垂直壁 → 顶面不共享边 → 天然分离）；
    - feature-fidelity-report.json（developer-only）：按 z 带/相对位置/面积自动分类
      top-view 结构类别（upper-deck/glacis/engine-deck/hatch/roof/ring 等），每类标记
      detected/retained/面积/mergedInto/sourceBBox——glacis 7→3、engine 4→3、roof 1→1、
      ring 6→3（被 roof 遮挡的面片块正确剔除），无大结构消失；
    - source-vs-output debug：source-top-projection.svg（raw top-facing triangle projection，无 merge/无过滤——显示 source 三角化结构）/
      merged-surfaces.svg / final-hull.svg / final-turret.svg；
    - 新增测试：独立组件不合并、低噪声高度差合并、真实 deck step 不合并、
      bbox projection fidelity、feature report 确定性——extractor 66 用例，全套 454 全绿。
  - **fidelity audit 循环论证 / 硬编码修复（2026-08-18，Review Blocker 1/2）**：
    - source-top-projection.svg 改为真正的 raw ground truth：每个 top-facing 三角形独立投影
      （projectTopFacingPolygons，无 merge / 无遮挡 / 无过滤——显示 source 三角化结构，
      Maus 808 个三角形 path）；旧实现误用 mergeVisualSurfaces 输出（循环论证）已修正；
    - feature-fidelity-report 移除 Maus 专属硬编码 bounds：hull/turret bounds 由真实投影
      计算（bounds2D(polyPoints)）传入；buildFeatureAudit fallback 从 source 几何推断
      （无车型专属数值）；
    - 新增 projectTopFacingPolygons 测试（top-facing 过滤/每三角形一 polygon/确定性）——
      extractor 68 用例，全套 456 全绿。
  - **Information-Loss Audit（2026-08-19，VISUAL_DETAIL_FIDELITY_INSUFFICIENT 取证）**：
    - 从实际缓存 GLB（6929.glb）解析：37 mesh / 2 材质 / **8 张内嵌 WEBP 纹理**
      （Maus_mtr：baseColor 2048² + normal 1024² + metallicRoughness 2048² + occlusion 2048²；
      Maus_track_mtr：256²×4，baseColor 带 alpha）；全部 primitive 有 TEXCOORD_0/1、无顶点色；
      整车 6,513 三角（BlitzKit 渲染 5,835；mask_01 为 mantlet 重复 mesh 且不在渲染层）；
    - **几何 vs 纹理分辨率**：实测 texel 密度 hull 5.6mm / turret 3.7mm / tracks 1.8mm，
      几何顶面中位 5-8cm（hull 最大单面 12.46 m²）——纹理携带 ~15-40× 更细信息；
      grille/vent/panel line/engine-deck pattern/roof 刻线/机械件阴影 = 纹理独有；
    - **真值渲染**：从 GLB 重建 320px 正交俯视（z-buffer + baseColor×AO×normal 着色）——
      silhouette 宽高比 0.418 vs 真实 0.412；正上方可见 = hull 19.44 m² + turret 13.07 m² +
      hull hide 0.24 m²（1.2%）+ turret hide 0.06 m²；**tracks 可见面积 0（完全被甲板遮挡）**；
    - **320px 结构分解**：gt 边缘 3,041 px = silhouette 303（SVG 命中 71%）+ 部件色界 532（46.1%）+
      内部细节 2,377（41.8%）；stage recall：raw 18.7% → merged 18.7% → occlusion 后 30.8%
      → final 42.2%；纹理独有边缘占 69.2%（几何驱动仅 30.8%）；
    - **可恢复几何损失定位**：① hide_elements 被收集阶段跳过（BlitzKit TankModel.tsx 源码确认
      渲染整个子树，无 hide 过滤）——但贡献仅 1.7% 边缘；② tiny/sliver 过滤删除 41+ 条
      真实长条（110.87×2.77 units ≈ 3.5m×8.7cm 甲板缘条，占车辆面积 13%，内含 15.5% gt 边缘）
      ——最大可恢复项；③ 2D union 过绘（履带条顶视不可见、mantlet 区域 recall 0%）；
    - **结论 GEOMETRY_ONLY_FIDELITY_LIMIT_REACHED**：几何-only 现实上限 ≈55-65%
      （当前 42.2% + 全部可恢复项），无法达到 90% 目标；按指令不再用 geometry heuristics
      假装恢复纹理信息，本轮不改 pipeline/不调 threshold；审计文档
      docs/assets/tier-x-models/information-loss-audit.md + debug 渲染产物
      （_textured-topview-320.png / _svg-raster-320.png / _audit-composite.png 供视觉复核）。
  - **Phase A — geometry correctness cleanup（2026-08-19，A1/A2/A3）**：
    - **A1 hide_elements 纳入**：collectTriangles 不再跳过 *_hide_elements* 子树（BlitzKit
      TankModel.tsx 渲染整个子树）——collectNodeTriangles/groupRenderNodes 移入 extractor-lib
      （可测试）；mask_01 等无关顶层节点仍由顶层名匹配天然排除（无名字黑名单）；
      Maus hull 原始 top-facing 450→571、turret 358→383；
    - **A2 sliver 规则替换为几何退化判定**：filterDegeneratePolys（自交 ring / near-zero 面积 /
      bbox 窄边 <5mm 数值 sliver / 完全重合重复）——3.5m×8.7cm 真实甲板缘条保留
      （旧规则按纵横比误删，审计 15.5% gt 边缘所在）；removedTinyRegions 0；
    - **A3 视觉层改真实 z-buffer 可见性**：rasterVisibility（逐像素 z-buffer + 面内 z 插值 +
      surface 级分组累计赢家像素）；tracks 顶视可见 0 → 不再画 2D union 深色条；mantlet/gun
      只画顶视可见表面（mantlet 区域 recall 0%→40.9%）；结构边按沿线多点采样可见比例过滤；
      silhouette 契约仍由完整几何 union 提供（metadata bounds 不变，pivot 不变）；
    - **recall 重新评估**：旧 42.2% 含水分（track 条 +6.2pp + 过绘小件碰巧命中 ~9pp）——
      无水分真实几何 recall ≈26.6% = 几何驱动 gt 边缘（937）的 86% 覆盖；旧值 42.2% 中
      的过绘区域在 gt 中确认为被遮挡结构（z-buffer 赢家均为 hullMain/turretMain）；
    - 测试：collectNodeTriangles/groupRenderNodes（hide 采集/mask 排除）、filterDegeneratePolys
      （长条保留/数值 sliver/自交/重复/面积）、rasterVisibility（完全遮挡/部分可见/对齐/
      groups/确定性）——extractor 82 用例，全套 470 全绿；Maus 资产重生成（hull.svg 78 paths
      无 track 色、turret.svg 40 paths）。
  - **Phase B — Maus-only texture-baked prototype（2026-08-19，Texture-Baked High-Fidelity）**：
    - **texture-bake-lib.mjs**（新，纯函数）：bakeTopView（1280² 确定性正交俯视 z-buffer +
      barycentric UV + wrap bilinear 采样 + MASK alpha test + baseColor×occlusion×normal-z
      起伏 + 0.75 中性化）+ encodePng（手写 PNG，zlib）；无 dynamic light/shadow/gloss/
      outline——所有视觉信息来自 GLB 真实几何+材质+纹理；
    - **bake-tier-x-topview.mjs**（新 CLI）+ decode-webp.py（PIL 解码 WEBP，developer-only）：
      GLB → 分组（含 hide）→ 6 张内嵌纹理 → hull/turret 独立 bake（640×640 physical /
      320×320 logical，fit 与 extractor 严格一致 scale=31.1729 → turretPivot 不变）→
      RGBA WebP + bake-report.json + debug 通道图（source-color/normal/ao）；
    - **结果**：hull 30KB / turret 14KB（640² WebP，q90）；**bake recall 81.0%@thr18 /
      93.7%@thr12 vs geometry-only 26.6%**（同阈值同 gt）——明显突破 geometry ceiling；
      区域：hull 86.2% / turret 64.8% / mantlet 80.3%；
    - **装饰检查 STRUCTURAL_TEXTURE**：Maus baseColor 中性基础贴图（饱和度 mean 0.071、
      >0.25 像素仅 0.4%、无迷彩/徽章/文字）——可直接使用，bake 仍 0.75 去色双保险；
    - **prototypes/maus/**（入库小文件）：hull-high-fidelity.webp / turret-high-fidelity.webp /
      reference-topview.webp / bake-report.json（含 recall/装饰分析/资产大小）；
    - **QA 页对比区**：admin preview 增加 A(geometry SVG) / B(texture bake) / C(reference)
      三列对比 + 320/128/64/28/24/20 尺寸档（仅 maus 显示；主包不受影响）；
    - 测试：UV 插值/采样确定性/alpha cutoff/z-buffer topmost/hull-turret 分离/pivot 不变/
      透明背景/稳定 hash/纹理缺失受控/无网络——texture-bake 13 用例，全套 483 全绿；
    - **Gate 判据待 ChatGPT review**：fidelity 81-94% 达 >=85% 目标区间，但 turret 区域
      （64.8%）与 precision（65-68%）仍需视觉复核；prototype 未冻结为正式资产契约。
  - **bake pipeline 泛化 + 正式契约迁移（2026-08-19，TEXTURE_BAKE_PIPELINE_NOT_GENERALIZED）**：
    - **产品契约更新**：正式定义为 "Source-faithful PBR top-view asset"——geometry proportions
      faithful、geometry detail 上限 = BlitzKit/WoTB LOD0 source、visual fidelity 由 source PBR
      （baseColor/normal/occlusion/alpha）恢复；删除"恢复高精度 geometry / ≥90% geometric
      retention"等误导表述（90% 仅作 visual comparison QA，不再描述为 geometric detail retention）；
    - **泛化 bake CLI**：移除 hardcoded root/节点推断——数据驱动（tanks.pb + models.pb +
      mapping.js）：selectDefaultModules（turrets/tracks/guns 数组最后，BlitzKit tankToDuelMember
      语义，不假设 turret_01/gun_01）、resolveBakeScenes（turreted/turretless contract）；
      decodePb/mapGet/proto 共享到 extractor-lib（extractor CLI 与 bake CLI 复用）；
    - **turreted contract**：hull.webp（hull+tracks）+ turret.webp（selected turret+mantlet+gun）
      独立 z-buffer/bake；turretPivot 由 models.pb turretOrigin 投影（与 extractor 同公式）；
    - **turretless contract**：ho-ri 单 hull.webp（casemate，gun 全部 bake 进 hull），无 turret
      layer/pivot；grille-15 为 limited-traverse 炮塔 TD（BlitzKit models.pb turret yaw ±65°
      权威数据）→ turreted visual layer（同 minotauro/xm66f ±45°）；kind 判定以 BlitzKit 数据
      为 source of truth（yaw 无限制/null=全旋转、±45°~±65°=limited turret、±7°=casemate）；
    - **PBR 检查**：metallic/roughness 纹理存在但顶视中性 bake 无 specular → 报告后不加入（§5）；
      输出保持 0.75 去色 + 保留纹理结构（grille/panel/vent/AO/relief）；
    - **正式资产契约迁移**：assets/<modelKey>/{hull,turret}.webp + metadata.json + bake-report.json
      （640×640 physical / 320×320 logical）；types/validator/preview/tests 全部同步；旧 SVG 仅
      debug（extractor CLI 默认输出 gitignored 缓存）；sample/prototypes 目录删除；
    - **representative batch（8 辆）**：Maus/Leopard 1/Grille 15/Ho-Ri/Minotauro/XM66F/FV4005/
      Sheridan 全部生成并通过 validator——turretless 无 turret.webp/pivot；pivot 各异（含非中心
      160.28,163.22）；hull 15-35KB / turret 11-25KB；全部 6 张纹理采样；
    - 测试：selectDefaultModules（数组最后/缺 model_id 报错）、resolveBakeScenes（alternate
      模块排除/turretless gun 进 hull/无 display name 依赖）、webp 契约、turretBounds 排除
      mantlet——全套 487 全绿；build/分离/validator ALL PASS。
  - **contract cleanup + bulk generation（2026-08-19，TEXTURE_BAKE_PIPELINE_GENERALIZED = PASS 后）**：
    - **source 字段语义修正**：`source.collisionModel` → `source.modelGlb`（该 URL 是视觉
      model.glb，非 collision.glb）——schema/types/validator/baker/tests/docs 全部同步；
      不保留 compatibility alias（PR 未发布）；
    - **过时 wording 清理**：types.js / validator / README / spec 中 "geometry-source schema"、
      "所有正式车型 SVG" 等已过时描述修正为 Source-faithful PBR top-view WebP asset 契约；
      `visibleDetailRetentionTarget=0.9` 保留但明确为 visual QA target（非
      geometric-detail-retention guarantee——几何上限 = BlitzKit/WoTB LOD0 source）；
    - **bulk generation**：全部非 confirmPending baseModelKey（78 辆）确定性生成正式资产
      （data-driven：tanks.pb + models.pb + mapping.js → selected modules → model_id → GLB nodes）；
      失败逐辆记录（modelKey/tankId/modules/nodes/stage），修通用 pipeline 不跳过；
    - **pending 保留**：spht / ac-teichos / nc-70-blyskawica 维持 confirmPending=true 不生成。
  - **raster overflow contract（2026-08-19，RASTER_GUN_CLIPPING 修复）**：
    - 根因：baker 沿用 SVG 时代 "fit = hull + turret body、gun allowed overflow"——SVG 可
      overflow visible，但 WebP/raster 不存在 overflow，长炮管超出固定 640×640 后被永久裁切；
    - 实测（representative 8 辆）：gun 超出 logical canvas——maus top+19.6u（39px）、
      leopard-1 +75.5u（151px）、grille-15 +211.9u（424px）、minotauro +129.6u、xm66f +199.3u、
      fv4005 +48.7u（sheridan 无 clip；ho-ri turretless 单 hull fit 已含 gun）；
    - **修复**：hull.webp 固定 640×640（320 logical）；turret.webp 画布 = turret+mantlet+完整
      gun 的 logical bounds（同一 fit.scale，主体不缩放；透明 canvas 向 320 画布外扩展）；
      metadata 新增 `turretRaster`（logicalMinX/Y、logicalMaxX/Y、pixelWidth/Height、
      pivotX/pivotY——pivot 相对 turret.webp 原点的逻辑坐标）；types/validator/preview 同步
      （turret 层按 raster 原点定位 + raster 内 pivot 旋转）；
    - 验证：grille-15 turret.webp 160×1010（原 640 裁掉 424px 炮管）、xm66f 325×846、
      minotauro 230×757——全部含完整炮管；hull 保持 640×640；validator/tests/build PASS。
  - **turretRaster schema 去重（2026-08-19，PR2 runtime contract）**：
    - 删除 `generation.turretRaster`（重复内容）——authoritative runtime geometry contract
      只保留顶层 `metadata.turretRaster`（PR2 用顶层做 asset positioning / transform-origin；
      generation 只保存生成审计数据）；baker/types/validator/69 辆 turreted metadata/tests/docs
      全部同步（deterministic regeneration）；
    - validator 新增：generation 内出现 turretRaster → FAIL（防 schema 漂移）；
      turretRaster.pixelWidth/pixelHeight 与实际 turret.webp 尺寸一致（解析 WebP 头）；
      pivotX/pivotY 落在 image-local raster bounds 内；turretPivot 与 raster 数学映射一致
      （pivot = logicalMin + image-local pivot，容差 0.11）；
    - 验证：69 turreted 全部迁移成功（top-level turretRaster=69、generation 残留=0）、
      9 turretless 未受影响；validator ALL PASS；490 tests PASS（+3 schema 漂移用例）；
      build + bundle separation PASS；CI（7047ebd）6/6 PASS。
  - **review-with-docs 清理（2026-08-19）**：
    - 删除真死代码：extractor-lib `bumpsToSvgPaths` / `minSvgUnits`（bump 概念删除后残留、
      全仓零引用）、types.js `GENERATION_METHOD_EXTRACTION`（lib 硬编码字符串，常量零引用）；
      保留假死项：convexHull2D / hullToPath / filterOccludedSurfaces / toSvg（extractor.test 锁定语义）；
    - preview QA 区 A 列 hull 旋转 origin 修正为画布中心（原误用 turret pivot）；
    - i18n：adminPreview 补 `protoSize` 三语、删除死 key `sample`/`sampleNote`、hint 更新为
      Source-faithful PBR WebP 描述（zh/en/ru 同步）；
    - DEVELOPER_GUIDE：QA 页描述与文档索引更新（SVG 全局规范 → 车型资产全局规范）；
    - current-plan 状态更新为 PR1_NON_PENDING_ASSET_MILESTONE_READY。
  - **kind 全量核验**：遍历全部 81 baseModelKey，不采用 BlitzKit TURRET module / turretRotationSpeed（casemate 也有 turret module 且转速非零，不可判）；以官方 tankopedia 描述 / fandom wiki / 结构知识逐组核验并修正 3 项——minotauro → turreted（fandom：有炮塔约 45° 限位）、foch-155 → turretless（fandom specs turret=no）、xm66f → turreted（官方：non-fully-rotating turret 前置炮塔）；无法可靠确认的 3 辆（spht / ac-teichos / nc-70-blyskawica）标记 confirmPending（contract 未冻结，第一批不生成）；tier-x-inventory.md 增加全量 kind 核验依据列与修正记录。
  - **turretPivot 旋转数学修正**：预览页不再用 translate 平移近似（旧实现旋转轴实际在 pivot 的镜像点 2C−P）；新增 frontend/src/vehicle-models/pivot.js——img 与 320×320 viewBox 1:1 对齐，transform-origin 直接用 pivot × renderScale，rotate 以 origin 为不动点；pivot.test.js 数学断言非中心 pivot 在 0°/90°/180°/270° 下不动（7 用例）；sample 改非中心 pivot (160,150) 证明实现支持任意 pivot；pivot debug marker 与旋转轴同源坐标。
  - **admin preview 懒加载**：App.vue 静态 import 改为 defineAsyncComponent 动态 import → preview 与全部车型 QA 资产（import.meta.glob）进入独立 chunk，普通用户主 bundle 不含车型资产；新增 scripts/check-bundle-separation.mjs 构建后检查（主入口无 vehicle-models/assets 标记 + 存在独立 preview chunk）。
  - **预览溢出 QA**：.vmp-canvas overflow:hidden → visible（长炮管可超出统一 viewBox 可见；仅视觉显示，不影响后续 collision/hitbox contract）。

### Changed
- **战局回放地图标注（纯前端临时标注）**：新增 `frontend/src/utils/annotation.js` 纯函数模块
  （8 色色板/粗细范围常量、`screenToSemantic` 屏幕→语义坐标、`rectFromCorners`/`circleFromCorners`/
  `arrowHeadPoints`/`polylinePoints` 几何归一与渲染换算、`applyEraser` 橡皮擦点擦（pen 删点拆段、
  形状/文字整件擦）、`commit/undo/redo` 全量快照 undo/redo（`UNDO_LIMIT=100`））；`mapView.js`
  `createMapView` 新增 `fromX/fromY` 逆映射；`BattlePlayback.vue` 新增标注工具栏与 SVG 标注层
  （语义坐标锚定，随 viewport transform 缩放/平移），绘制走 `onPointerDown/Move/Up` 门控
  （选工具时单指绘制、未选工具保持原浏览交互；绘制中车标 pointer-events 关闭、双指捏合保留），
  文字标注用临时输入框（Enter/blur 提交、Esc 取消、committed 幂等）；切文件 `watch(overview)`
  重置、切视图 v-if 卸载清空。新增 `utils/mapView.test.js`（往返映射）、
  `utils/annotation.test.js`（20 用例）与 `components/BattlePlayback.annot.test.js`
  （8 用例，真实 vue-i18n 三语）。三语文案 `recon.map.playback.annot.*`。
- **AI 复盘复制按钮随视角固定 + 复制内容带网站宣传**：`AnalysisResultPanel` 面板头部 `position: sticky` 吸顶（滚动页面时复制按钮保持在右上角可视区）；复制内容末尾追加一行 `recon.copy_footer`（三语，默认「由 WotBTools 生成 · https://wotbtools.com」）。
- **AI 复盘提示词去重与契约（prompts 重构）**：AiPromptLibrary 支持 {{key}} 占位包含（递归展开、循环包含 fail loud），player×3 + team/single 中逐字重复的五块公共规则抽到 prompts/common/{tank-noun,language,damage-semantics,hp-loss,evidence-logic}.zh.md 复用，展开后提示词与重构前字节一致；修复两处 md 与 Java 常量漂移（COMMON_EVIDENCE_LOGIC_RULE 机器标签清单缺「簇/候选/规则候选」、team 身后输出规则 **禁止** vs <b>禁止</b>）——此前 EN/RU .replace 锚点静默失效，EN/RU 复盘会残留中文规则段；新增 PromptRuleContractTest 强制「展开后 ZH 片段与常量逐字一致 + EN/RU 无中文残留」契约。
- **AI 复盘血量口径：进场满血 provenance + fail closed**：真实回放 probe（EntryHpProbeTest，7 样本）证伪「整场 max current HP = 初始满血」——绝大多数车辆首个 positive 样本与首次受击同刻且低于 tankopedia base。新增 EntryHpSource（OBSERVED_EXACT / BASE_FALLBACK / UNKNOWN）与 PlayerResult.entryHp/entryHpSource：仅「严格早于首次受击且 ≥ base 的样本」证明进场满血；掉血窗口分母 damageVsEntryMaxHpPct 只允许已证明进场满血或 tankopedia base（BASE baseline），短窗高额伤害窗口判定 fail closed（base baseline 不判 critical，避免 1900 / 观测2500 / 真实2600 误报）；Call #1 赛前血量同样只输出已证明进场满血或 base（战斗中观测的 currentHp 不得冒充赛前进场满血）；HP_LOSS_TIME_RULE（ZH/EN/RU）与 prompts/common/hp-loss.zh.md 措辞同步；observedMaxHp 保留为「观测最大 current（下界 base）」供总血量条/血量优势证据。
- **文档信息架构归一化重构（docs IA）**：docs/ 从平铺 16 个 md 重构为 architecture / features / research / operations / reference 分层；新建 `docs/README.md` 索引与 `docs/ROADMAP.md`，删除 TODO.md / rating-progress.md（完成项归 CHANGELOG，未完成工程项转 GitHub Issues #78–#81，产品方向转 ROADMAP）；DEVELOPER_GUIDE 拆分为开发入口 + 专题文档（AI 复盘 / 回放重建 / 地图鸟瞰 / 评分 / 排行榜）；research/replay 逆向文档 verdict 置顶、状态词统一 PROVEN/PARTIAL/UNKNOWN/SUPERSEDED/DEPRECATED；全仓库旧路径链接与代码注释同步修正。纯文档变更，不影响代码与构建。
- **Agent 指令体系分层（AGENTS.md hierarchy）**：新增根 `AGENTS.md`（自动发现入口）与 8 个按作用域
  继承的目录级 `AGENTS.md`（java/frontend/common/deploy/.github/两个 keycloak provider/map-semanticizer），
  内容全部经真实代码/构建/CI 核对；`.agents/AGENTS.md` 收敛为 repository-wide 硬约定（115→39 行），
  修正与代码漂移的条目（tankopedia tier 四文件、八服务开发环境、AiReplayAnalysisService 为兼容 facade、
  remote 命名等）；`.agents/wotb-sync.md` 收敛为指向 `skills/wotb-sync/SKILL.md` 的指针（单一事实源）；
  DEVELOPER_GUIDE 文档地图补充层级说明。纯文档变更，不影响代码与构建。

### Fixed
- **turretPivot 独立验证 matrix traversal 修复（PR92 Review B1 第三轮）**：
  verify-pivot-independent.mjs 曾各自实现一套 collectVerts，且**漏乘 node 自身 TRS**
  （mesh 只应用 parent matrix；nodeMatrix 只乘给 children）——与
  extractor-lib.mjs::collectNodeTriangles 语义不一致（真实 GLB 节点 TRS 全为 identity，
  未暴露，但语义错误）。修复：**extractor-lib.mjs 新增 collectNodeVerts**（与
  collectNodeTriangles **同一 hierarchy 语义**：worldMatrix = parentMatrix · nodeLocalMatrix，
  node 自身 TRS 乘入后作用于自己的 mesh，children 递归传 worldMatrix），verify 脚本改用
  单源函数，删除本地两套 traversal；新增 **synthetic 非 identity TRS 测试**（4 用例）：
  parent T(1,2,3)·Rz90°·S(2,1,1) 自带 mesh 单点 [1,0,0] → 期望 (1,4,3)（自身 TRS 作用于
  自己 mesh）；child 再乘 T(0.5,0,0)·S(1,2,1) → (0.5,2,0)→(-1,3,3)（parent+child 合成）；
  三级嵌套 P·C·G → (-1,7,4)；与 collectNodeTriangles 同树顶点一致。
  **bottom turret-ring anchor 落地（方案 A）**：verifier 新增可复现输出——turret_01 子树
  底部带（z∈[minZ, minZ+0.2]）顶视质心 vs pivot 模型坐标距离（68/72 台可计算；grille-15/
  nc-70 战斗室底部顶点不足、e-50-m/felice 同理为 n/a）：median 0.217m（t57-heavy 0.019m /
  m-vi-yoh 0.010m / fv215b-183 0.004m / ac-teichos 0.073m / minotauro 0.075m / xm66f 0.079m），
  个别大偏差（bzt-70 1.27m / carro-45t 1.07m）由底部带含 *_hide_elements_switch* 替代网格
  （nc/skin 网格位于车尾，属渲染子树的一部分）拉偏——ring anchor 仅作几何佐证不作为判据，
  pivot 正确性由 scene-graph 反推（err≤0.0002m）+ turret_origin.y ≈ GLB 炮塔底部 z 保证。
  6 台代表车重新执行：全 PASS（TRS 全 identity；yaw 0/90、grille 0/65、nc-70 0/10、
  minotauro 0/45 含 initial pitch=3° err=0.0291m）。
- **turretPivot 参考系反推验证（PR92 Review B1 第一轮，真实几何证据）**：新增
  frontend/scripts/verify-turret-pivot.mjs（developer-only，CI 不执行）——对每个 turreted 车型
  用 GLB 真实旋转层几何（= bake 的 turret 场景：turret + mantlet + gun，这才是 marker 里实际绕
  turretPivot 旋转的视觉层）复刻 BlitzKit useTankTransform 运行时公式，构造 yaw=0°/90° 两个姿态，
  垂直平分线最小二乘反求唯一 2D rotation center，与 metadata.turretPivot 比对：
  **全 72 turreted 车型 err=0.0000m**（含 3 辆 confirmPending 新确认车；minotauro 含
  initial_turret_rotation pitch=3° 完整复刻 err=0.0249m < 0.1m 阈值）。
  ⚠️ 评审指出该验证是数学 tautology：待验证的 c 被用作生成 yaw 样本的旋转中心，反推必然
  得 c——只能证明 transform 自洽，不能证明 pivot 正确；且"偏后"被归因于测量脚本轴映射 bug
  而未复现视觉差异。**第一轮脚本已删除，由第二轮独立验证取代（见下条）**。
- **turretPivot 独立几何验证（PR92 Review B1 第二轮，修复循环证明）**：新增
  frontend/scripts/verify-pivot-independent.mjs——**待验证的 metadata.turretPivot /
  computeTurretModelPivot 结果不参与生成 yaw 样本**；数据流为：GLB 原始旋转层顶点（模型坐标，
  yaw=0 装配姿态）→ 逐行复刻 BlitzKit useTankTransform.ts scene graph（turretContainer.position =
  R_z(yaw)(-(hullOrigin+turretOrigin)) [+initial axis-angle] + hullOrigin+turretOrigin；
  rotation = Euler(initialPitch, initialRoll, yaw+initialYaw)，XYZ 序；origins 直接取自
  models.pb 原始数据）→ 构造 yaw=0° 与 yaw=限位内角度两批 world positions → 只根据
  world positions 垂直平分线最小二乘反推 rotation center → 最后才经 bake-report.fit 反投影
  与 metadata.turretPivot 比对：**全 72 turreted 车型 err≤0.0002m**（grille-15 用 0°/65°、
  nc-70 0°/10°、fv215b-183/xm66f/minotauro 0°/45°——yaw 限位自动读取）；**minotauro 真实包含
  initial_turret_rotation（pitch=3°）完整复刻，err=0.0291m 原值报告**（pitch 使顶视投影非纯
  2D 旋转，属物理效应非 pivot 偏差，不放宽阈值）。
  **B1 视觉"偏后"根因（独立证据链）**：① pivot 数值正确——scene-graph 独立反推 err≤0.0002m，
  且 GLB 炮塔底部环带中心与 pivot 吻合（bottom turret-ring anchor 已由 verifier 实现并输出，
  见第三轮条目；Maus 0.218m / fv4005 0.110m / t57-heavy 0.019m / m-vi-yoh 0.010m）；② 视觉偏差来自
  **turret.webp 的 raster
  overflow contract**：图像包含完整炮管（Grille 15 炮管占图像上部 60%+），turret.webp 非透明
  像素质心被炮管拉前，而座圈（红圈）在炮管根部、位于图像中下部（Maus 74.2% / Grille 15 85.6%）——
  **红圈相对炮塔图像视觉质心偏"下"（后方）0.3m（Maus）~ 2.4m（Grille 15）**，炮管越长的车越
  明显，"有些车没问题"（t57-heavy 0.02m / fv4005 0.04m / nc-70 图像仅炮盾+炮管、座圈居中）——
  与人工 QA 反馈完全吻合；③ **QA 页 proto cell 真 bug**：bakeHullLayerStyle 的 transform-origin
  写死 160px 未随 protoSize 缩放（protoSize≠320 时 hull 绕盒外点旋转，车体视觉漂移被误读为
  pivot 偏后）——已修复（随 protoSize 缩放，与 turret assembly 同构）；④ QA 页新增"炮塔视觉
  质心"青色参照标记（checkbox 开关，i18n 三语），人工 QA 对照红圈即可确认座圈落在炮塔主体上
  = 正确，偏后量 ≈ 炮管占比效应。
  **结论：pivot 数值不变（独立验证证明正确），修复 QA 页 proto cell 旋转中心 bug + 增加视觉
  质心参照；全部 81 资产无需重新生成。**
- **AC Teichos / NC 70 Błyskawica kind 确认 + 解除 confirmPending（PR92 Review B2）**：
  经 BlitzKit 真实模型数据逐车确认 turreted——AC Teichos（22129）：GLB turret_01（631+1540
  顶点）+ gun_01 + gun_01_mask、models.pb turret 模块无 yaw 限位；NC 70 Błyskawica（19585）：
  GLB turret_01 为 1-triangle stub（casemate 主体在 hull_nc_01，属 hull 层；旋转层实际 =
  gun_01 + gun_01_mask）、models.pb turret 模块 yaw ±10° limited-traverse（同 grille-15 处理）。
  mapping 移除 confirmPending → **81/81 正式资产齐备（confirmPending=0）**；两车已 bake 并
  通过 pivot 反推（err=0.0000m）；inventory/README/runtime 测试同步（runtime 不再有
  confirmPending 分支）。
- **dedicated 车型阵营视觉（PR92 Review B3）**：VehicleMarker 增加稳定 team token——
  dedicated 渲染时 .pb-graphics 容器加 pb-graphics-dedicated 类，配合 marker 级
  pb-friendly / pb-enemy 状态类输出友军暖橙（rgba(255,166,77)）/敌军冷青（rgba(64,192,255)）
  双层 drop-shadow halo；纯 CSS 视觉层——不改纹理/不增第二资产集，不影响旋转、阵亡灰阶、
  红 ✕、selected、recorder 与 generic 路径；新增 4 个组件测试（友/敌类名 + halo filter + generic
  无 halo）。
- **turretPivot source-of-truth（PR92 Review，BlitzKit useTankTransform 契约）**：baker 此前只用
  tankModelDefinition.turret_origin 计算 pivot；官方运行时（packages/website/src/hooks/useTankTransform.ts，
  已核对源码）的炮塔 yaw 旋转中心 = correctZYTuple(trackModelDefinition.origin) +
  correctZYTuple(tankModelDefinition.turret_origin)。修复：selectDefaultModules 同时取得选中
  track 的 origin（hullOrigin），baker 用 computeTurretModelPivot（向量和）计算 pivot；
  bake-report 记录 pivotSource（engine origins + modelPivot）供不变量测试与审计。当前 BlitzKit
  数据中 81 组 track origin 均为空（已与 live API 核对），hullOrigin=0 → 数值不变，但契约已
  显式建模并有测试守护（B21：Maus/Grille 15/Leopard 1/FV4005/前置炮塔 type-71/后置炮塔 fv215b
  + 全量 turreted 回归：metadata.turretPivot === fit(project(hullOrigin+turretOrigin))）。
  initial_turret_rotation（仅 minotauro pitch=3 度）只影响初始朝向角与小幅修正，
  不影响顶视 pivot——单测证明公式不消费该字段。
- **SPHT（29985）kind 确认 + 解除 confirmPending**：经 BlitzKit 数据确认 turreted（GLB
  turret_01 + gun_01 + gun_01_mask；models.pb turret 模块无 yaw 限位、turret_origin 存在）→
  mapping 移除 confirmPending、生成正式资产（第 79 个）、inventory/README 同步；
  runtime 测试更新（spht resolve 出正式资产；confirmPending 仅剩 ac-teichos / nc-70-blyskawica）。
- **PR #92 Review 修复（2026-08-19）**：
  - **marker transform-origin 坐标系修正（Blocker 1）**：markerTurretImageTransform 此前把
    turretRaster.pivotX/pivotY（image-local pivot）错误除以 VIEWBOX=320 当 marker-global
    坐标；改为相对 turret image 自身盒（origin% = pivot / (pixelWidth/2|pixelHeight/2)），
    与 PR91 QA 页 px 数学同构；新增数学不变量测试（Maus + Grille 15 × H=0/90/180/270 ×
    T≠H：复合位置 = turretRingPosition）。
  - **runtime module-lifetime cache（Blocker 2）**：preloadBattleModels 增加 modelKey 级
    cache（成功复用 / 失败页面生命周期内不重试 / 并发共享 in-flight Promise / 异常按失败
    缓存）；测试重构为 vi.resetModules 隔离 + cache 1–8 用例。
  - **阵亡 ✕ 视觉（追加需求 A）**：pb-death 白色 16px → 红色 #ff4d4f 22px/800、z-index 6、
    多层描边——深/亮背景可读，与 last-known（淡化无 ✕）区分明显；三渲染路径一致。
  - **QA 页 selected 指示器（追加需求 B）**：白色圆环绕画布边缘 → 红色 #e5484d 倒三角
    （车辆正上方、z-index 6、drop-shadow），任意背景/车型/旋转角可见，不被图层遮挡。
- **PR2 — Dedicated Tier X Models in Battle Playback（2026-08-19）**：
  - **VehicleMarker 正式组件**（frontend/src/components/VehicleMarker.vue，计划 §17）：从
    BattlePlayback.vue 抽出正式单车 marker（generic / dedicated turreted / dedicated turretless
    三条渲染路径）；dedicated turreted = hull 满盒绕中心旋转 + turret assembly 嵌套 transform
    （父层 rotate(H) around 盒中心、子层按 turretRaster 百分比定位绕 image-local pivot 旋转
    T-H，数学统一在 pivot.js marker*Transform，含单测）；generic 保持原双层 PNG 行为不变；
    marker 内部样式随组件迁移（父组件 scoped 不作用于子元素）。
  - **生产 runtime 资产解析**（frontend/src/vehicle-models/runtime.js，计划 §12/§13/§18）：
    tankId → modelKey → 正式资产（Vite 静态 URL + metadata）；战局级 preload——只预加载本场
    实际出现的 Tier X（dedupe 同 modelKey 一次），3s 超时/失败 → 单车 generic fallback
    （confirmPending/未知 tankId 直接 generic）；current-page cache（模块生命周期）；
    动态 import 保持主 bundle 分离（check-bundle-separation 门禁通过）。
  - **BattlePlayback 集成**（计划 §14/§15/§16）：view model 扩展（model/markerStyle/ariaLabel）；
    preload 完成前不渲染车辆（禁止 generic 闪现后替换）；turretless 无 fake turret layer；
    方向/阵亡冻结/最后已知沿用现有可信数据与插值（不伪造朝向）；非 Tier X 继续 generic。
  - **i18n/版本**：versions.json v2.11.18 + CHANGELOG-PRODUCT（用户可见：Tier X 专属模型）。
- **Tier X 车型资产 PR91 Review 修复（2026-08-18，5 blockers + 1 engineering gate）**：
  - **RASTER_Y_AXIS_CONTRACT（raster 方向契约）**：`texture-bake-lib.mjs::bakeTopView` 投影
    此前用 `pixelY = (modelY - minY) * scale`（model +Y → 图片下方），与 logical 契约
    （`logicalY = -modelY * scale + ty`，model +Y → screen up）不一致；turretRaster.pivotY
    指向的像素与 WebP 内真实座圈行镜像偏差（Grille 15：metadata pivot 像素 alpha=0 为空，
    真实座圈行有覆盖）。修复：raster projection 层做 Y flip（`pixelY = (bounds.maxY - modelY) * scale`）
    ——正式 WebP 与 logical 坐标同一坐标系，hull/turret 同一 orientation，0° = 车头/炮管朝 12 点，
    turretRaster.pivotX/pivotY 指向 WebP 内真实座圈像素；bake-report 新增 `rasterOrientation`
    指纹（topModelY/topRowCovered/topWidthMean 等，从实际 baked rgba 计算）；新增方向测试
    （非对称三角形 +Y 在上方、Grille 15 炮口 +8.04 贴 turret.webp top、Maus/Leopard/Grille/FV4005
    orientation regression、全部资产 hull top = forward 端）；新增 developer 工具
    `scripts/check-webp-orientation.mjs`（PIL 解码真实 WebP 与 bake 指纹逐项比对 + pivot 像素覆盖）；
    78 个正式 WebP + metadata/bake-report 全部确定性重新生成（禁止人工 patch 单车）。
  - **OFF_CENTER_TURRET_HULL_COMPOSITION（偏心炮塔合成）**：`pivot.js` / QA 页此前把 turretPivot
    当作 hull 旋转后固定不动的 screen point（仅 transform-origin 单层旋转），非中心炮塔
    （Grille 15 P=(160.1,220.36) 等）hull 旋转时座圈脱离车体。修复：嵌套 transform——turret
    assembly 父层 `rotate(hullWorldDeg)` around 车辆中心 C（座圈 P' = C + rotate(P-C, H)），
    turret image 子层 `rotate(turretWorldDeg - hullWorldDeg)` around image-local pivot
    （raster.pivotX/pivotY），最终 world yaw = authoritative turretWorldDeg；QA 页红色 pivot
    marker 显示旋转后真实座圈位置；pivot.test.js 重写（H/T = 0/0、90/0、90/90、180/45、270/10
    × Grille 15/Maus/FV4005/Leopard-1：座圈移动 + world yaw 合成断言）。
  - **desaturate 参数语义反向（Blocker 3）**：`neutralize` 文档声称 amount=去色强度（0=原色，1=纯灰）
    但实现为 `luma*(1-amount) + rgb*amount`（amount=1 反而保留全部原色）。修复：公式改为
    `rgb*(1-amount) + luma*amount`，`DESATURATE` 0.75 → 0.25——视觉数学等价
    （仍是 75% 原色 + 25% luma，像素不变），字段名与文档不再撒谎；tests/metadata/bake-report/docs 同步。
  - **authoritative docs 收敛（Blocker 4）**：`docs/assets/tier-x-models/README.md` 与
    `svg-generation-spec.md` 正式契约只描述 WebP asset（hull.webp/turret.webp/metadata.json/
    bake-report.json，顶层键 modelKey/kind/source/turretPivot/turretRaster/generation，
    method=blitzkit-model-topdown-texture-bake）；旧 hull.svg/turret.svg/extraction method/
    SVG detail grouping/顶层 5 键/_hide_elements 排除 等旧说法全部移入「Legacy/debug extractor」
    章节，不再称为正式资产契约。
  - **bundle separation 进 CI（Engineering Gate 5）**：`ci.yml` frontend job 在 `npm run build`
    后新增 `node scripts/check-bundle-separation.mjs`（主入口不含 vehicle assets + QA 资产在
    独立 async chunk）。
- **PR91 review-with-docs 闭环（2026-08-19）**：隐藏 QA 页 QA 对比区全部文案 i18n 化
  （adminPreview.qaTitle/qaLabelA-C/qaDevOnly/qaReport，三语同步 28 keys）；validate.js 头部
  设计注释更新为正式 WebP 资产契约（旧 hull.svg 说法移除）；docs/README 索引措辞改为
  WebP bake；current-plan 执行状态更新为两轮 Review 闭环；check-webp-orientation 临时文件
  清理 + decode-webp.py usage 修正；bake 指纹 alpha 阈值注释。纯代码质量/文档层变更，
  无用户可见行为变化（versions.json 不新增条目）。
- **AI 回复「簇」字确定性兜底全链路（权威 proper noun 保护）**：复盘正文（analysis）此前没有字符级兜底，LLM 输出「簇」会原样透传；新增 wotb-core `ClusterTermSanitizer`（簇拥→聚集、簇状→集群状、一簇→一批、同簇/成簇→集群、分簇→分散、主力簇→主力集群、多簇→多股、剩余「簇」→「群」，复用 `PreBattleSectionRenderer` 原有替换表），`AiReplayReviewService` 在 `correctTankNames` 后对 analysis + preBattleSection 两段统一应用，并保护权威 proper noun（roster 昵称 / 权威坦克名）原样保留（合法昵称如「星簇」不会被改写成「星群」）；赛前预测渲染路径同步改调共享 helper；新增 `ClusterTermSanitizerTest` + 服务层集成测试。契约：AI 生成的内部术语「簇」确定性转换，权威玩家昵称/车辆名称保持原样。
- **战局回放敌方车标「位置流中断后重新上报不恢复」根因修复（后端区间生产）**：MapOverviewBuilder.positionIntervals 把 EntityLeave(type-4) 当作单个硬截断点导致漏洞——同一实体位置流中断后重新上报（gap ≤ 5s）会被 gap 聚类吞掉、整个 run 被 leave 截断，前端 positionCoveredAt 永假、车标一直淡化；改为「每次 EntityLeave 都是 coverage 的 hard segment boundary」——leave 强制关段、leave 后第一条 position 无论 gap 大小都开启新 interval，deathSec 最后 clamp。新增 MapOverviewBuilderPositionIntervalsTest（2s/10s 重新上报、多次 leave 周期、leave 早于首点、无 leave gap 分段、deathSec 前/后重新上报共 7 用例）+ 前端「两段区间重新上报恢复不透明」回归；此前 2.11.11（positionAt 精确采样点）/ 2.11.12（lastKnown=!covered）均为前端修复，本修复补齐后端。
- **AI 复盘坦克名幻觉（Kranvagn 被写成「埃米尔1951」）**：生成侧 LLM 幻觉把玩家坦克名写成
  中文译名/相似车（EMIL 1951 与 Kranvagn 共用原型底盘）且保持全文；证据/结算层无 bug（tankId →
  tankopedia 权威映射未变）。修复：① wotb-core 新增确定性后校验 TankNameCorrector——R1 昵称
  锚定纠正（坦克名（昵称）/ 昵称（坦克名）/ 「的」所属式，与 roster 权威名不一致即替换）、
  R1+ package 级两阶段传播（同一 AI Review 的 analysis 与 preBattleSection 视为一个
  correction package，Pass 1 跨全部段收集昵称锚点已证明的「错名 → roster 车」唯一共享映射，
  Pass 2 逐段传播到同一 canonical 的 standalone 提及——含别名/英文原文，与出现顺序无关，
  任一段锚点证明可传播到其它段；跨段映射冲突或 source 本身在 roster 时 fail closed 不传播、
  不猜测）、R2 别名与大小写归一化（新增单一来源
  common/tank-name-aliases.json，KRV/克朗瓦根/埃米尔1951 → 权威名）、R3 无锚定/有歧义的非 roster
  车名只记 DETECTED 日志不改写；AiReplayReviewService 在 done.analysis 前对正文与
  preBattleSection 应用；② prompt 硬约束升级（禁止中文翻译/原型·后续·同级相似车替代），
  PlayerPromptRules.COMMON_TANK_PROPER_NOUN_RULE 与 4 个 prompts/*.zh.md 逐字一致、
  prebattle/system.zh.md 第 4 条同步（并修复 text block 一处缩进不一致）；③ 零容忍回归
  TankNameCorrectorTest（含生产案例、段内/跨段传播、锚点前/后 standalone 传播、无锚点
  fail-closed、source-in-roster、映射冲突、null 段场景）+ 服务级 fallback/team 两条链路 +
  5 个 package 跨段传播用例 + TankNameProperNounTest/AllowedLanguagePromptTest 三语契约断言。
- **地图鸟瞰换文件竞态**：loadMapOverview 为每次请求建立唯一 generation（递增序号 + AbortController）；选择/删除/清空文件（resetMap）与组件真正卸载时递增序号并 abort 旧请求；响应在成功/失败/finally 写状态前校验 generation——旧请求不得覆盖新文件的 mapOverview/mapError/mapLoaded/mapLoading、其 finally 不得提前解除新请求的 loading；KeepAlive deactivate 不触发卸载钩子，有效状态不受影响。新增 4 个 deferred-promise 竞态测试（A 后到不显示 / 任意返回顺序只显示 B / 旧 finally 不解除 B loading / 真实卸载 abort）。
- **战局回放选中 last-known/已击毁车辆后整图消失**：三语 locale `recon.map.playback.last_known`
  文案末尾裸 `@` 被 Vue I18n 11 当作 linked-message 语法，首次渲染该文案（选中位置中断/已击毁
  车辆时）抛 SyntaxError 导致 BattlePlayback 子树整体卸载；改为冒号文案，并新增真实
  `createI18n` 三语回归测试 `BattlePlayback.i18n.test.js`（不 mock `$t`，zh/en/ru 选车路径）。
- **战局回放 review 修复（4 项）**：① 炮塔方向证据文档 source-of-truth 统一为受控旋转实验定案
  PROVEN（历史 NOT_PROVEN 标 SUPERSEDED）；② `directionSamples` 只接受落在该车同一可信
  position-interval 内的 prop2 样本、hull yaw 仅从同区间位置配对（跨 gap 不取对侧、段末样本恒保留
  保证冻结）；③ playback 时长三优先级（`battle.durationS` → `BattleEndedEvent` → 位置流最后时刻）
  并对全部 event/interval/direction/deathSec 施加 `[0,durationSec]` 契约；④ 前端同一 AI 时间戳重复
  点击可再次 seek、单点 last-known 时间保持真实采样时间。
- **战局回放坦克名权威解析**：MapOverviewBuilder.buildPlayback 的 PlaybackVehicle.tankName 由空串改为 ReplayDisplayNames.tankName(tankId, tankName) 权威解析（与 AI 证据路径同源，如 29985 → "SPHT"），前端不再回退显示纯数字 tankId；新增 MapOverviewBuilderTest 坦克名非空/非数字断言。
- **positionAt 重新上报首点边界修复**：修复 t 恰为采样点（gap > 5s 后的重新上报首点）被误判为「gap 内」返回 null 的问题——该点应直接返回，否则 vehicleState.lastKnown=true 使敌方图标残留「最后已知位置」淡化；新增 battlePlayback.test.js 回归用例。
- **敌方位置流覆盖中仍半透明（lastKnown 语义）**：vehicleState.lastKnown 由 `!live || !covered` 改为 `!covered`——route 采样间隔（max(2s, duration/200)，长局可 >5s）导致 live=null 不代表位置中断；只有位置流未覆盖（最后已知位置）才淡化。**语义修正**：covered 只是「服务器位置流覆盖」，不等于录像者客户端点亮/失察（无 authoritative spotting signal），注释/docs/UI 一律用「位置流覆盖/位置中断/最后已知位置」诚实表述，不声称「已点亮」。原「gap 淡化」测试改为覆盖=false 场景，新增「covered=true 且采样 gap>5s 不淡化」回归。
- **propId=3 血量 sentinel 修复（0xFFFD/-3、0xFFFF/-1）**：propId=3 改 signed i16 语义——正数=真实 HP；0xFFFD(-3)=与击毁 ±40 点同刻的死亡 sentinel（11/11）→ 归一化为死亡 HP=0；0xFFFF(-1) 及其它 ≤0 高位值 = UNKNOWN sentinel（不臆测、不当作 65535）。`HealthChangedEvent.isPlausibleHp`（>0 且 <0xFF00）兜底：sentinel 永不进入 `ObservedMaxHp`/`hpSamples`/AI HP facts/team HP bar。新增 decoder/ObservedMaxHp 回归测试。
- **AI 事实血量改用回放实测值**：新增 wotb-core `ObservedMaxHp`（type-7 propId=3 当前血量含装备/物资加成 → 每账号观测最大 hp，`max(观测, tankopedia base)` 兜底），`DefaultReplayProcessingFacade` 回填 `PlayerResult.observedMaxHp`；`EntityIdentityResolver.appendStructuredTankFacts` / `PlayerEvidenceFormatter` / `TeamEvidenceFormatter`（阵容行、TEAM_MEMBERS、对方阵容）血量事实改用实测值（null 回退 tankopedia）；Call #1 赛前基线（roster-only）不变。

### Added
- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- **AI 复盘三板块折叠 + 时间链接跳回地图**：AnalysisResultPanel 复盘正文（call2）与 ReconstructionPage 地图区块新增独立折叠开关（默认展开，复用通用 recon.collapse/expand 三语）；点击 AI 报告时间链接（onAiSeek）改为 async，seek 后 scrollIntoView 回滚到地图区块。
- **双方总血量条 + 争霸赛实时点数（playback）**：`MapOverviewBuilder.buildPlayback` 消费 HealthChangedEvent（propId=3 **signed i16**，0xFFFD/-3 死亡 sentinel 归一化为 0、0xFFFF/-1 等 UNKNOWN sentinel 置 null）→ `PlaybackVehicle.maxHp`（`ObservedMaxHp` 解析，sentinel 永不进入）+ `hpSamples`（battle-relative 秒升序）；`MapOverview.Playback` 增 `pointsSamples`（type-8 subtype48 root field12 实时点数，PROVEN；删除原 `friendlyPoints/enemyPoints`=ΣvictoryPointsEarned 的结算口径）；前端 `teamHp` 拆 `{totalMax, knownRemaining, unknownMax}`（灰段=未观测容量，不冒充满血）、`teamPointsAt` 随 currentTime 取最近广播；locale `recon.map.playback.points/hp_unknown` 三语。

- **战局回放总血量条本方满血回退（敌方保持 UNKNOWN）**：`battlePlayback.vehicleHpAt(vehicle, t, assumeFullWhenUnobserved)`——本方路径（`BattlePlayback.vue` friendlyHp 传 true）在存活车辆尚无血量变化采样时按 `maxHp` 回退（开局满血）；**敌方路径不传该开关**：无 ≤t 可信采样时恒为 UNKNOWN 灰段，禁止把理论 maxHp（可能回退 tankopedia）当作敌方已知当前血量。阵亡且无采样双方均 UNKNOWN。前端测试覆盖：本方/敌方无采样差异、敌方首采样后转已知、阵亡无采样灰段、sentinel 忽略、perspectiveTeam=2 镜像（不写死 team1=本方）。
- **战局回放坦克随地图缩放**：markerTransform 去掉 `1/view.scale` 反缩放（坦克随 viewport 同比放大）；坦克名/阵亡 ✕ 叠加层单独 `scale(1/view.scale)` 保持屏幕恒定；更新过时测试（reset/缩放/标签断言）。
- **团队 AI 阵型深度与地图控制区域（FormationDepthEvidence）**：wotb-web 新增确定性证据（按 opening/mid/late 阶段：本队成员沿「本队质心→敌方质心」轴深度三分位 → frontLine/midLine/backLine；九宫格驻留计数优势 → controlledRegions own/contested/enemy），接入 `TeamAiPromptBuilder.buildOptionalBlock`；`team/single.zh.md` 与 `TeamPromptLocalizer.FORMATION_DEPTH_RULE`（ZH/EN/RU）同步规则；新增 `FormationDepthEvidenceTest`（前后排/控制区域/无敌方观测降级）。
- **AI 阵型前后排 profile-aware + 地图控制权（controlRegions）**：FormationDepthEvidence 前后排感知 tank profile——`isFrontlineCapable`（HEAVY/高装甲）与 `isBacklineCapable`（TD/LT）判定阵容结构：无前排型车辆 → `noFrontlineVehicle`（不产出 frontLine 名单，只给几何参考）；无后排型车辆 → `noBacklineVehicle`（几何靠后成员仍为前线型车辆）；全 MEDIUM → 无明确结构；frontLine/backLine 名单附 profile 标注（account:xxxx(HEAVY,armor=HIGH)）。九宫格驻留计数 `dwellRegions` 升级为**地图控制权 `controlRegions`**：双方距离加权火力覆盖分（F=Σ 火力权重/(1+d/100)，HEAVY/TD=2、MEDIUM=1.5、LIGHT=1 + profile 火力修正），1.2 倍阈值判 own/contested/enemy；(presence)=区域内有本方位置样本（位置存在）、(firepower)=无位置样本但火力覆盖占优；无重甲阵容输出 noArmorNote（控制权依赖火力投射）。prompt 规则三语同步（不得断言真实占领/点亮）。
- **AI 身后输出/血量优势甄别（吸血/避战候选，BehindLineHpEvidence）**：团队+个人双路径确定性证据——判据：可扛线（profile）+ 血量比率 ≥ 扛线队友 × 1.2 + 距敌比扛线队友更远；有输出（阶段内攻击 damage ≥ 1）→「有输出（利用队友输出）」、无输出 →「无输出（避战）」；**吸血程度分级（轻/中/重）**：血量差幅度 + 持续阶段数 + 躲后距离差三因子合成；opening 附加「前线型车辆未上前线」（后排分位）；血量数据不足降级为仅位置+输出事实。团队路径遍历本队全体（负面语境由 prompt 规则给出）；个人路径仅录像者自己、中性措辞（不评价队友）。接入 `TeamAiPromptBuilder`（团队）与 `PlayerSummaryBuilder`（个人）。
- **Team Autopsy 战犯/MVP 纳入吸血程度**：`TeamAutopsyPromptBuilder.buildUserContent` 注入 BEHIND_LINE_HP_ADVANTAGE 段（`TeamAutopsyService.analyze` 增加 recon 参数）；`prompts/team/autopsy.zh.md` 规则更新：输出高但吸血程度重 → 团队贡献打折（高输出不能全额抵销），输出非常非常高（显著高于本队均值）才可部分抵消。
- **地图鸟瞰独立端点 /api/replay/map-overview（不调 AI）**：ReconstructionController 新增同步端点（与 analyze 同角色/校验/稳定错误码，ReplayUsageMetrics.OP_MAP_OVERVIEW 计费）；新 MapOverviewQueryService 只解析回放并复用 MapOverviewBuilder 确定性聚合，地图不可构建返回 204（前端显示不可用提示）；analyze SSE done.mapOverview 字段保留兼容、前端不再消费。AI 复盘页新增独立「地图鸟瞰」区块（热力/路线/战局回放三视图，ReconstructionPage 手动按钮加载；AnalysisResultPanel 移除地图折叠块并把 AI 报告时间链接 seek 事件上抛给页面加载/跳转）；locale 新增 recon.map.{load,loading,unavailable} 三语。
- **战局回放视觉调整**：回放视图移除车辆路线渲染（pb-routes/routeSegments/.pb-route 删除，路线数据仍供位置插值与炮线端点复用；「路线」视图不受影响）；坦克图标上方常显坦克型号名标签（PlaybackVehicle.tankName 回退 tankId，位于反缩放按钮内 → 任意缩放下可见、字号恒定，不再限 ≥2× 且从下方移到上方）；炮线可见窗口 TRACER_BASE_SEC 0.5 → 1.0（1×/2×/4× 各约 1s 真实时间）。
- **AI 用词「簇 → 自然中文」确定性兜底**：prebattle/system.zh.md 强制规则新增禁「簇」条款（兵力/阵型集中一律「集群」）；PreBattleSectionRenderer.display() 对 LLM 自由文本做三层卫生——① 特殊自然表达（簇拥→聚集、簇状→集群状）→ ② 短语级替换（一簇→一批 / 同簇→集群 / 成簇→集群 / 分簇→分散 / 主力簇→主力集群 / 多簇→多股）→ ③ 剩余「簇」字符兜底为「群」（单字替换，不会把已替换出的「集群」二次污染），保证全部用户可见自由文本字段（队伍画像/对阵/胜机/假设）最终不含该字；team/single.zh.md 与 TeamPromptLocalizer.CAPTURE_RULE「多车同簇推进」→「多车集群推进」（md 与常量逐字一致）。
- **炮线激光化视觉**：tracerLines 输出扩展（纯函数，无定时器）——opacity 改「先亮后淡」（TRACER_HOLD_REAL_SEC=0.4，保持期后线性淡出到窗口结束）、新增 flashProgress（TRACER_FLASH_REAL_SEC=0.35，命中闪光进度）；BattlePlayback 每炮线渲染三层（外层阵营色光晕 6/view.scale×0.35 透明度 + 内芯亮白 1.75/view.scale + 命中端扩散淡出圆点），线宽从组级移到逐元素（屏幕宽度恒定语义不变）；1×/2×/4× 真实时长与保持期一致。
- **Grafana 使用统计 Dashboard 新增 AI 平均 Token 面板**：`wotbtools-usage` 新增「AI 平均每次调用 Token」stat 面板（`wotb_ai_upstream_tokens_total{token_type="total"}` 增量 ÷ `wotb_ai_upstream_requests_total` 增量，分母含失败调用、失败计 0 token）与「按模式平均每次调用 Token」timeseries 面板（按 `mode` 分维，分母 `clamp_min(...,1)` 避免无流量 mode 显示 NaN，可区分单机复盘 `PRE_BATTLE_STRATEGIC_PRIOR`+`TACTICAL_REVIEW_HARNESS` 与团队复盘 `SINGLE_TEAM_BATTLE`+`TEAM_AUTOPSY`）；`docs/operations/observability.md` 同步面板清单与统计口径。
- **AI 复盘点数局势证据与规则（PointsSituationSkill）**：wotb-core 新增纯函数 `PointsSituationSkill`
  （击杀夺分时间线——±40/击杀业务规则按双方阵亡时刻对齐、叙述口径非实时比分、只表达击杀换分项净差值而非整体点数；占领点区域位置存在——
  服务器位置流在 CONTAINS_CONTROL_POINT 九宫格的存在、位置存在≠占点产分；进攻推进窗口——车辆从
  非占领点区域移动进入占领点区域，同队窗口按 8s 合并）与 `PointsSituationSkillTest`（9 例）；
  wotb-web 新增 `PointsSituationEvidence`（复用 TeamEntityMapper 从重建事件流采集双方位置轨迹，
  推进窗口与 `DamageWindowClusterer` 掉血窗口联接成「推进方窗口内承受伤害=防守方过路费」，
  OBSERVED_DAMAGE_IS_PARTIAL 时抑制伤害数字）并接入团队复盘（`TeamEvidenceFormatter.appendPointsSituation`，
  P3 optional 预算内）与随机战个人复盘（Harness Call #2 裁剪阶梯 + fallback/full/fullNoRecon 三条旧路径）；
  prompt 三语规则同步：team/single.zh.md 占点规则 8 + `TeamPromptLocalizer` zh/en/ru 常量（逐字契约）、
  player/tactical/single/fallback.zh.md + `PlayerPromptRules` POINTS_SITUATION_RULE zh/en/ru 替换链、
  team/autopsy.zh.md 结算级点数规则（禁止编造比分与窗口级判断）；契约测试 `TeamPromptLocalizerTest`/
  `PlayerPointsSituationRuleTest`/`TeamAutopsyPromptBuilderTest`/`PointsSituationEvidenceTest` 扩展。
  数据边界不变：终局前绝对比分未解码，所有信号禁止冒充实时比分（PointsEvidenceProbeTest 结论继续有效）。
- **战局回放标记有效尺寸与固定屏幕线宽**：`BattlePlayback.vue` 标记 hull/turret 素材放大到按钮
  131% 并以共同 pivot 居中旋转（`translate(-50%,-50%) rotate(...)`；素材 512×512 有效车体 bbox
  实测 ≈210×336 → 桌面 28px 容器下有效车体 ≈15×24px，不随缩放变小）；路线 `<g>` 绑定
  `stroke-width=2/view.scale`、炮线 `1.5/view.scale`（屏幕宽度恒定，长度随地图坐标）；缩放 ≥2×
  时标记显示车名小标签（反缩放按钮内，字号恒定）；CSS 移除 `.pb-route/.pb-tracer` 的静态
  stroke-width（否则覆盖属性绑定）；组件测试新增固定线宽/居中旋转/车名标签 3 例（npm 288 全绿）。
- **战局回放炮线动画 + 地图缩放平移 + 敌我阵亡统一**：DAMAGE/KILL 已知射击的炮线
  （`utils/battlePlayback.js` 新增 `trustedPositionAt` 严格事件时刻可信位置——末点后/gap 内/
  首点前/非有限坐标拒绝，不用最后已知位置伪造射击位置；`tracerLines` 纯函数按 now/speed 推导 →
  seek 与 1×/2×/4× 天然正确、无一次性定时器；同刻 DAMAGE+KILL 去重为一条；未命中/盲射/弹道/
  瞄准线无数据依据不渲染）；`.pb-viewport` 单层 transform 缩放平移（滚轮/双指捏合 1×–4× 锚点
  缩放、>5px 阈值拖动平移、拖动后吞 click 防误选车、重置按钮、全图层严格对齐、卸载清理监听）；
  `pb-destroyed` 显式阵亡状态（敌我同款 opacity .35 + grayscale(1) 双层 + ✕，方向冻结最后可信
  样本，无样本以素材默认 0° 渲染，不并入 `pb-last-known`）。
- **AI 复盘点数口径与掉血窗口口径**：`FriendlyEnemyResult` 新增 `teamKills`/`teamDeaths`
  （原始结算事实）与 `standardSupremacyRules`/`provableEarlyPointsWin`（420s/1000 为
  **项目所有者确认的业务规则**，arenaBonusType 只证明战斗类别、不解码出 420s/1000；仅类别未知
  fail closed）；**撤回 `knownPointsSubtotal`/`killPointsDelta` 公式**（victoryPointsEarned 是否
  含击杀夺分未经证明，现有样本双方击杀净值为 0 无法区分）；结束方式只按「标准规则+时长+双方
  存活」判定，不使用任何点数公式；无权威胜方时不按占点分推断胜方（POINTS_INFERENCE 停止产出）；
  `TeamEvidenceFormatter` 只输出原始结算字段（victoryPointsEarned/Seized、kills、deaths），
  终局比分除业务规则可证明的胜方=1000 上限（1000 分上限业务约定）外一律 UNKNOWN；
  REACHED_1000 是结束原因（某一方达到 1000 分导致提前结束）而非胜方：winnerTeam 缺失时只写
  「某一方达到 1000 分导致提前结束、具体胜方未知」，双方终局比分一律 UNKNOWN；每据点每 tick 产分
  与 tick 间隔均未解码（无任何已验证的 tick 产分规则），不写入口径；
  `DamageWindowClusterer.DamageWindow` 新增 `damageVsBaseMaxHpPct`（累计伤害/基础满血量，
  tankopedia 基础值，只是计算基准不是实际掉血比例）/ `criticalWindow`（跨度 ≤10s 且伤害 ≥75%
  基础满血量）；不产出无法证明的「被秒杀」判定；type 8/sub 8 非直接伤害结果与 type 5 Spotting
  均为未解码候选（`ShotSpottingStreamProbeTest`/`PointsEvidenceProbeTest` 探针记录，不进入
  生产时间线）；prompt 规则三语同步（player×3 + team/single + PlayerPromptRules/
  TeamPromptLocalizer：短窗高额伤害窗口强制定性 + 禁止任何公式结果冒充终局比分 +
  禁止阵亡掉血 100% 废话）；`PointsVictoryProbeTest` 本地样本探针（CI 无样本自动跳过）。
- **战局回放炮塔方向契约与双层坦克标记（门禁 B 破解）**：type-7 propId=2 定案为
  炮塔相对车体偏航（u16 LE：`raw*360/65536-180` 度，完整 360° 且 ±180 回绕）——车体静止
  炮塔转一圈的旋转实验回放证明满圈 + wrap；开火命中锚点拟合（41 锚点残差 9.5°）+
  独立受击集交叉验证（34 锚点残差 2.3°）证明 `炮口世界方向 = normalize(hullYaw + turretRelativeYaw)`；
  新增 `TurretDirectionChangedEvent`（`EntityPropertyDecoder` propId=2）与
  `MapOverview.PlaybackVehicle.directionSamples`（`{timeSec, hullYawDeg, turretRelativeYawDeg}`，
  约 1s 降采样 + ≥10° 变化保点、finite、≤deathSec、时间升序）；`ReplayEvent` permits 扩展。
  前端 `BattlePlayback.vue` 圆点标记替换为 PR #72 四张运行时 PNG 的 HTML overlay 双层标记
  （hull 按 `hullYawDeg`、turret 按 `turretWorldYawDeg=normalize(hull+rel)` 独立旋转，
  共同 pivot，炮管不脱离炮塔；约 28px/移动端 22px；阵营色只来自素材；录像者 halo/选中 ring/
  最后已知淡化/阵亡 ✕ 为独立 overlay）；`utils/battlePlayback.js` 新增 `normalizeDeg`/
  `shortestArcDeg`/`interpolateDirection`（最短圆弧插值、跨 gap 冻结）/`screenRotation`
  （地图 yaw→屏幕 rotate，0=朝上/90=朝右/180=朝下/270=朝左）与四基准方向单测。
  `TurretDirectionProbeTest` 新增检查项 12（旋转实验时序 dump）与检查项 11（炮口模型拟合+
  交叉验证）；证据笔记与逆向文档同步。
- **AI 复盘结果页「地图鸟瞰」新增「战局回放」第三视图**：后端 `MapOverview` 扩展 `playback`
  （`durationSec` / `vehicles`（含 `positionIntervals` 位置上报区间与 `deathSec`）/ `events`：
  `DAMAGE` / `DESTROYED` / `KILL` / `POSITION_REPORTED` / `POSITION_STALE`，身份经
  `TeamEntityMapper` 实体映射解析，无法可靠解析不输出；`POSITION_REPORTED/STALE` 只表达
  服务器位置流覆盖变化——type-10 是服务器完整实体流、与点亮无关，敌方静止时不上报位置，
  故不得把位置中断当「失察」）；前端新增 `BattlePlayback.vue` 与 `utils/battlePlayback.js`
  （RAF 播放、仅在同一可信连续点 gap≤5s 间插值、gap 内淡化最后已知位置而不消失、从未上报
  位置不显示、阵亡切换 ✕、进度条事件按秒聚合标记、播放/暂停/±5s/上一/下一事件/1×2×4×/
  拖动 seek（拖动即暂停）、随机战默认录像者相关事件过滤、`formatClock` 先取整杜绝 00:60）；
  `MarkdownContent` 把 AI 报告中的明确时间文本（`03:20` / `3分20秒` / `3m 20s` /
  `3 мин 20 с`，不识别普通数字/比分）转成 `#seek=` 链接，点击后展开鸟瞰、自动切换战局回放
  并 seek 暂停；三语 locale 与文档同步。

### Changed
- **Rating V2 平均血量改为本局总血量均分**：`POST /api/rating` 走完整回放处理，优先汇总本局
  14 名有效参战车辆中已证明的进场满血（`OBSERVED_EXACT`），其余使用 Tankopedia 基础 HP 后除以 14；
  所有玩家使用同一个本局平均值，不再按敌队人数或固定平均值计算。车辆库缺少 HP 时，仅该单车以 2400 兜底。
- **打手最高等级显示名调整**：保留数据库/API 内部兼容值 `AVERAGE_GOD`，仅把界面中文名改为“殿堂级”、英文名改为 `Mythic`，俄文同步对应译名；管理员编辑授予、普通申请禁用及每服最多一名的规则不变。
- **AI 复盘胜负来源证据层级与全歼双向语义（battle result 权威）**：`CAPTURE_RULE`（ZH/EN/RU）
  不再宣称所有 result 行都来自权威 winnerTeam，改为按 `resultSource` 三级证据描述——
  BATTLE_RESULTS（battle_results#winnerTeam 权威，最高优先级，LLM 不得用事件流/存活数/点数
  覆盖胜方）/ SURVIVOR_SETTLEMENT（结算存活状态推导，非权威不得伪装）/ POINTS_INFERENCE
  （双方存活时占点分推断，非权威规则候选）；`TeamAiPromptBuilder` mandatory header 同时输出
  `result` 与 `resultSource`（不再只放在可能被 token 预算裁掉的 CAPTURE_AND_POINTS）。
  全歼语义双向：本方获胜且对方 survivors=0 → 「全歼敌方获胜」；本方落败且本方 survivors=0 →
  「被敌方全歼落败」；双方均有存活才进入点数结束方式（≥1000 提前获胜 / 双方 <1000 时间耗尽
  点数判定，pointsEndReason 前置条件=双方均未全员阵亡）；`autopsy` 提示词规则 9 同步。
  `annihilationSuffix` fail-closed 升级为**结算阵容完整前提**（`Battle.rosterComplete`）：
  ReplayParser 解析名册 `#201→#2→#3`（名册来源队伍）并与战绩 `#301` 对比——账号集合完全一致且
  每个账号队伍一致才标记完整；非法 perspectiveTeam、players 缺失/为空、阵容不完整或任一方队伍
  不在 roster 时一律不输出全歼后缀，winnerTeam 缺失时也不得推导 SURVIVOR_SETTLEMENT 胜方，
  不得把未知当成零存活；不写死每队 7 人，完整名册的非 7v7 训练房同样生效。新增
  `TeamResultSourceBoundaryTest` 覆盖部分缺失敌方/本方、winnerTeam 存在与缺失、主 result 行与
  Autopsy 结果行、完整 7v7 与合法非 7v7 场景。
  **点数推断同步 fail-closed**：`resolveTeamBattle` 的 POINTS_INFERENCE 仅在 rosterComplete=true
  时可用（winnerTeam 缺失 + 阵容不完整 → DRAW_OR_UNKNOWN/UNKNOWN，残缺点数不推断胜方）；
  winnerTeam 存在时胜方仍为 BATTLE_RESULTS，但 rosterComplete!=true 时 pointsEndReason 降级
  UNKNOWN，result 只写通用「点数判定」，不得写「时间耗尽/达到 1000 分」；
  `CAPTURE_AND_POINTS` 在阵容不完整时输出 `SETTLEMENT_ROSTER_INCOMPLETE=true` /
  `pointsTotalsUnavailable=true` 并抑制逐人/双方占点分总量（写 UNKNOWN），与 mandatory header
  和 `CAPTURE_RULE`（ZH/EN/RU 新增 2d 条）口径一致。新增 ReplayParser 解析级负向测试
  （#201/#301 账号不一致、队伍不一致 → rosterComplete=false）。
  新增 golden case `cw-annihilation-win-01` / `cw-annihilation-loss-01` + fixtures + lessons；
  `cw-cap-win-01` / `cw-cap-points-decided-01` 断言 mandatory header `resultSource=POINTS_INFERENCE`
  且不出现 BATTLE_RESULTS；`AiEvalHarnessTest` 断言 ZH 规则含全歼双向语义与三级证据、
   EN/RU 本地化后不残留中文规则。
- **AI 复盘结果一键复制正文**：`AnalysisResultPanel` 面板头部（右上角）新增「复制」按钮，一键复制
  `result.analysis`（最终复盘正文，可能包含团队剖析与免责声明；不含独立的
  preBattleSection/mapOverview）。Clipboard 降级链：`navigator.clipboard.writeText` 优先，
  writeText 缺失或 reject 时降级 `execCommand('copy')`（textarea 经 try/finally 保证移除；
  execCommand 返回 false 或抛异常时不显示「已复制」）；复制后按钮显示「已复制」1.5s 后复位，
  组件卸载清理定时器。新增三语 locale `recon.copy` / `recon.copied` 与组件测试
  （仅复制最终正文、排除赛前预测/地图鸟瞰、Clipboard 成功/缺失/reject、execCommand false/抛异常、
  textarea 清理、卸载清理定时器）。
- **战局回放坦克标记素材定稿（PR #72）**：最终方案为通用半立体 MT 双层模型；新增车体与炮塔同图生成的
  authoritative master，并由该单一基材拆出友军暖金/敌军青蓝四张 `512×512` RGBA 运行时素材；
  两阵营共用完全一致的 alpha 蒙版，敌军色为确定性换色，不依赖运行时 CSS filter。重新生成可正常解码的
  状态规范表和运行时验收板，覆盖双层叠加、0°/90°/180°/270° 旋转、28px 深浅背景、录像者/选中/
  最后已知/阵亡 overlay；删除早期废弃的四车型 SVG 与两张非同源旧 PNG。素材 README 与
  `.agents/AGENTS.md` 固化 `(256,256)` 旋转中心、`hullYaw` / `turretRelativeYaw` /
  `turretWorldYaw = hullYaw + turretRelativeYaw`、轨迹≠朝向及未来播放器接入边界（PR #71 不变）。
- **技能更名：grill-with-docs → plan-designer（开发方案设计）**：开发前方案 grill 技能更名为
  `plan-designer`，调用时**自动前置 grill-me**（需求澄清：复述理解 → 逐层提问 ≤3 个/轮 →
  输出《需求确认单》），需求已明确时跳过并注明；随后进入方案设计流程（可落地性核对 →
  影响面扫描 → 分步方案 → 风险与默认决策 → 输出《开发方案单》→ 交给 Plan）。
  全仓交叉引用同步：`AGENTS.md`（Feature 流程 / Phase 1）、`grill-me`（交接）、`plan-executer`
  （输入与互补）、`review-with-docs`（current-plan 检查项）、`finish-task`（current-plan 头部模板）、
  `DEVELOPER_GUIDE`（技能库注释）。流程职责与《开发方案单》输出契约不变。
- **Player fallback killVictims 事件流伤害数字纳入 partial 门禁**：`buildPlayerContextSummary`
  在构建基础 summary 时即读取 `hasObservedDamagePartial(ctx)`——partial 下
  `DAMAGE_EXCHANGE_AGGREGATED_OBSERVED` 输出 `UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)`，
  `KILL_ATTRIBUTION` 仅保留「你击杀了谁 / 谁击杀了你」身份信息、抑制
  `累计直接伤害/击穿/致死前累计 N 点伤害`；权威结算（YOU_AUTHORITATIVE/阵容/总伤害）不受影响；
  complete coverage 保持逐目标累计伤害与击杀归因明细。清理
  `TacticalEvidenceFormatter` 零调用的 `renderEvidenceSections(EvidenceSkillResult)` 重载。
- **AI 复盘 partial 事件流伤害证据全链路抑制（Player Harness/fallback + Team）**：
  `EvidenceSkillEngine` 在 `OBSERVED_DAMAGE_IS_PARTIAL` 时跳过 `EngagementTradeSkill`，
  `CriticalWindowSkill` 基于过滤后的 HP 动量/阵亡/支援/路线/单走证据重新聚合窗口；
  `TacticalReviewPromptBuilder` 在 Prompt 边界再防御性剔除 ENGAGEMENT_TRADE 与携带
  recorderDamage* 的窗口；`TeamAiPromptBuilder` 把合并后的 limitations 传入
  `appendOptionalDetails`/`appendHighPriorityFacts`，partial 时
  `TEAM_ENGAGEMENTS_OBSERVED_SUBSET` 与 `OBSERVED_EVENT_SUBSET` 均不输出事件流伤害数字。
  覆盖完整时换血/团队交火证据保持不变。
- **AI 复盘整体超时预算 400s → 1100s（切页后台跑完不中断）**：`AiReviewWorkerExecutor` 默认
  overall-deadline、`application.yml`、前端 `AI_ANALYZE_TIMEOUT_MS`（`ReconstructionPage.vue`）、
  nginx `proxy_read/send_timeout`、`SseEmitter` 超时与部署 env（`deploy.yml` / `.env.example` /
  `docker-compose.prod.yml`）统一对齐 1100s / 1120s——团队复盘 3 次 AI 调用
  （Call #1 + Call #2 + Team Autopsy，各 ≤315s）的最坏耗时不再被旧 400s 硬杀；
  `TacticalReviewHarness.ENDPOINT_DEADLINE_SEC` 同步更新；新增 `AiTimeoutChainContractTest`
  配置契约测试（application / compose / workflow / frontend / nginx / SseEmitter 防漂移），
  deploy.yml 固定使用 1100 并在 `deploy.sh` fail-fast 校验，杜绝旧 400 静默生效。
  前端新增 KeepAlive 切页回归测试（开始复盘 → 切「回放解析」→ 预览 → 切回：
  不 abort、不调 cancel、结果可见）。
- **争霸赛点数胜负结束方式（pointsEndReason）**：`FriendlyEnemyResult` 新增 `PointsEndReason`
  派生（`REACHED_1000` / `TIME_EXPIRED` / `UNKNOWN` / `NOT_APPLICABLE`）并纳入
  `TeamBattleWinner`；`CAPTURE_AND_POINTS` 输出 `pointsEndReason`；`CAPTURE_RULE`（ZH/EN/RU）
  写明结束条件三分法——点数胜负叙述必须体现「时间耗尽」或「达到 1000 分提前获胜」，
  禁止把 <1000 的中间比分当作获胜理由；团队剖析胜负标签与 `resolveTeamResult` 按结束方式输出。
- **掉血时间范围（规则 + 窗口证据）**：新增三语 `HP_LOSS_TIME_RULE`（player/team 提示词共用）——
  凡提及掉血必须给时间范围与掉血量；小窗口大量掉血先描述为「短时间集中掉血/高压掉血窗口」，
  仅当窗口总跨度 ≤15 秒、解析出 ≥2 个不同攻击者且无未解析攻击者时才可写「被多车集火」，
  攻击者无法解析、只有 1 个攻击者或窗口总跨度超阈值（含 ≤10s 间隔链式聚类形成的大跨度窗口）时不得断言集火。
  新增 `DamageWindowClusterer`（≤10s 间隙聚类掉血窗口，含不同攻击者数）：真实 decoder 的
  `DamageEvent` 账号字段恒为 null，窗口沿 `ParticipantMappingEvent` 的 entityId→accountId 映射
  （复用 `TeamEntityMapper`）解析攻击者/受击者；不再依赖生产中恒为 false 的 `lethal()`，
  删除不可达的「致死」宣称。player 路径输出 `RECORDER_DAMAGE_RECEIVED_WINDOWS`（fallback 与
  Tactical Harness 主路径同格式/同口径），团队路径输出 `MEMBER_DAMAGE_RECEIVED_WINDOWS`
  （均受 `OBSERVED_DAMAGE_IS_PARTIAL` 覆盖率抑制，覆盖不全时输出 UNAVAILABLE 不给数字）。
  新增真实回放集成回归测试 `ReplayDamageWindowIntegrationTest`
  （common/fixtures 的 rift 随机战夹具：真实 decoder 账号字段为 null、经 entity 映射生成窗口、
  battle-relative 时间、partial 抑制、Harness/fallback/团队三路径、单一攻击者不标集火）。
  同根因修复：逐次伤害段 `PER_HIT_DAMAGE_EVENTS` 与逐对手对炮段 `DAMAGE_EXCHANGE_BY_OPPONENT`
  一并改用同一 entity 映射解析（真实回放不再显示 UNAVAILABLE/空段）。
- **AI 复盘维持分析 + 地图可视化改进**：`App.vue` 视图渲染改为 `<component :is>` +
  `<KeepAlive :include="['ReconstructionPage']">`——切走「AI 复盘」视图不再卸载/取消，SSE 流继续，
  返回时进度/结果直接可见（关标签/刷新仍由 `beforeunload` 取消）；`ReconstructionPage` 移除卸载时
  取消，超时改为「setTimeout 兜底 + 流内墙钟 deadline」双保险，后台标签定时器节流不再影响 1100s 语义；
  `MapOverview` 新增 `arenaBonusType` / `recorderAccountId`（`MapOverviewBuilder` 从
  `Battle.arenaBonusType` / `Battle.recorderResult()` 填充），随机战路线视图新增「仅玩家」筛选；
  前端新增 `utils/mapPalette.js` 自适应配色——底图平均相对亮度（阈值 0.45）分暗/亮两套色板，
  地图鸟瞰网格/九宫格/出生点/路线/热力颜色随底图明暗切换并为路线加对比描边；canvas 不可用时回退默认色板。
  新增 `mapPalette` 单测与 `MapOverview`/`ReconstructionPage` 回归测试（仅玩家筛选、深浅色板、
  卸载不取消、流内墙钟超时）。
- **单走/图控否定判断加伤害覆盖门禁（OBSERVED_DAMAGE_IS_PARTIAL）**：事件流观测伤害与权威结算不一致时，`teammateBenefit` 判定为 UNKNOWN（不得把“没观察到队友获利”当确定无获利）、开局图控不得用“未观察到交火”证明未接火（Team/Player 两路径一致）；正向观测到的交火/承伤仍可作为证据；SOLO_DELAY 必须 TRUE、SOLO_DETACHED 必须 FALSE、UNKNOWN 均不生成。新增生产契约回归测试与 2 个 golden false-positive cases（`cw-damage-partial-benefit-unknown-01` / `player-damage-partial-opening-01`），golden 27/27。
- **十级车战术 profile 数据修正（0de5719c）**：`common/tank_tactical_profiles.json` 调整多辆十级车的 mobility/strengths/weaknesses/roles/burstPotential/sustainedDpm/hullDownAbility（350+/281-），为手工数据修正；数据基线来自 BlitzKit 车辆库（alpha/hp/机动数值）驱动的车型基线 + 手工战术微调，LOW/MEDIUM/HIGH 与 strengths/weaknesses 沿用既有受控词表；`TankTacticalProfileRegistryTest` 7/7（含全部 Tier X 覆盖断言）通过。
- **AI 模型切换为 deepseek-v4-pro（官方稳定别名）**：`AI_MODEL` 默认值从 `deepseek-v4-flash` 切换为 `deepseek-v4-pro`——官方稳定别名直接调用最新 Pro 版本（当前对应 DeepSeek-V4-Pro-0813），调用方式不变，不使用带日期的显示名（`application.yml` / `.env.example` / `docker-compose.prod.yml` / `docker/online/docker-compose.yml` / `deploy.yml` workflow / `DEVELOPER_GUIDE` / gateway 测试字面量同步）；已显式设置 `AI_MODEL` 的环境以环境值为准。
- **地图语义全部完成人工核验（33 张 verified=true）**：`common/map-semantics/*.semantic.json` 全部置 `verified=true`——用户已逐图人工核对区域名称/类型/边界/favors/risks/relationships/spawnSemantics（含 Desert Sands 的坐标、建筑位置与 Z/坡度算法校验）；自动测试、结构一致性校验与 Z 校验仅作为辅助，不替代人工核验。Call #1 渲染为「人工地图核验: 已完成」；同步更新 `MapTacticalSemanticsRegistryTest` / `PreBattlePromptBuilderTest` 断言与 `map-semanticizer/README.md`、`docs/DEVELOPER_GUIDE.md`。4 张新图（rudniki/grossberg/moon/iceworld）仍缺 `mapCodes`（未登记显示名，既有已知项，不影响核验状态）。
- **AI 复盘单走候选修复（时间口径 + 主力簇识别 + 用词去技术化）**：`TeamSoloIntentSkill` 改为每个 15s 窗口先确定全局主力簇（平票不判、主力簇成员不产生候选、非主力簇需人数差 ≥2 且距离 ≥150m）；`teammateBenefit` 只使用窗口内证据（主力质心位移 / 窗口内队友有利交火），删除整场击杀/占点分与 `team==1` 硬编码；开局图控与脱节判定改用窗口内接火/承伤/阵亡证据，battlePhases 缺失时不把整场当开局；`SoloPlayIntentSkill` 的 `stationaryRatio==null` 不再等价于 MOVING、region/语义未知不再等价于远离目标点、SOLO_DETACHED 必须有窗口内距离增长证据（从 checkpoints 计算）、后期掉血/阵亡不污染早期窗口。单走证据摘要改自然中文（「主力簇」→「主力」、去掉「候选」等内部词），三语规则新增禁用「簇/质心/候选/规则候选/PARTIAL」等内部术语。新增回归测试（主力 5+2 分簇、Team2 不读 Team1 占点、窗口外击杀/占点/承伤/阵亡不影响、后期阵亡不判脱节、未知移动≠MOVING、未知目标点≠远离、无增长不判脱节、后期掉血不抑制开局图控、阶段缺失不判开局）+ 3 个 golden false-positive cases（`cw-main-cluster-no-solo-01` / `player-no-growth-01` / `player-unknown-stationary-01`），评估 harness 18/18。全量 `mvn -s settings.xml test` 全绿。
- **AI 复盘单走/占点证据（图控 · 拖延 vs 脱节 · 争霸赛占点）**：新增 `TeamSoloIntentSkill`（wotb-core）从阵型簇/移动段/交火/占点分推导单走行为候选（`OPENING_MAP_CONTROL` / `SOLO_DELAY` / `SOLO_DETACHED`，PARTIAL 规则候选）——开局散开标图控并抑制脱节；单走判拖延以「队友是否获利」为条件（B1 口径，只给时序关联不声称因果）；`TeamEvidenceFormatter` 新增 `SOLO_INTENT_CANDIDATES` 与 `CAPTURE_AND_POINTS` 段（P3 optional，争霸赛占点分/点数胜负/占领点区域）；`TeamPromptLocalizer` 新增三语 `SOLO_INTENT_RULE` / `CAPTURE_RULE` 并微调「不得推断玩家心理意图（可判可观测行为模式）」条款；player 路径新增 `SoloPlayIntentSkill`（复用 `RouteSkill` 脱节窗口，同口径，个人复盘无队友获利维度）并在 `EvidenceSkillEngine` 注册，player prompt（fallback/single/tactical）追加三语规则；评估 harness golden cases 扩至 15 个（新增 cw-cap-* 占点 4 个 + player 路径 3 个，探针按 mode 分流走真实证据链）+ 7 篇 lessons + 生产反馈登记模板 `docs/ai-eval/feedback-checklist.md`；Type 31/7 占点时间线探测（`CaptureTimelineProbeTest`，默认排除；`docs/replay-capture-probe.md`）结论：事件流无占点时间线结构，CAPTURE_TIMELINE 不升级，维持结算级 + 静态语义。全量 `mvn -s settings.xml test` 全绿。
- **移除多文件 AI 复盘死代码（单文件策略确认）**：删除 `MULTI_SYSTEM_PROMPT` / `MULTI_TEAM_PROMPT`（含 md 资源）、`analyzeMulti`（Player/Team 三入口）、`MULTI_PLAYER_BATTLE` / `MULTI_TEAM_BATTLE` AI 分支、团队多视角分区合并（`TeamPartitionBuilder` / `TeamContextBuilder.buildMultiTeamContext` / `TeamAiPromptBuilder.multi` / `MultiTeamBattleAnalysisContext` / `TeamBattleAnalysisSummary` / `TeamRosterResolver` 多场 roster 阈值辅助）；`analyzeTeamGroups` 简化为逐 context 单队调用；`BatchAnalyzer` / `ReplayAnalysisMode` 保留（非 AI 批量端点仍支持多文件）。同步清理约 30 个多场/分区测试，全量 `mvn -s settings.xml test` 全绿。
- **AI 提示词拆分 md（行为不变）**：AI 提示词正文从 Java 文本块常量迁移到 `java/wotb-web/src/main/resources/prompts/*.zh.md`（单一事实源），新增 `AiPromptLibrary` 惰性加载/缓存（`classpath:/prompts/<key>.zh.md`，CRLF 归一化）；8 个 prompt 模板（player fallback/single/tactical、team single/autopsy、prebattle system/user-header/confidence-legend）字节级不变，EN/RU 本地化替换链不变；新增 `AiPromptLibraryTest` 回归门禁（全部 key 可加载 + tactical=fallback+harness 不变量 + 无文本块残留）。全量 `mvn -s settings.xml test` 全绿。
- **地图资源整理（统一命名 + 单一权威）**：`assets/maps/*.png` 全部按英文展示名小写中划线命名（15 个改名：`Normandy→normandy`、`Middleburg→middleburg`、`malinov→winter-malinovka`、`newbay→new-bay` 等；`alpen→horrorstadt` 补齐 lumber/山麓角逐 素材，28/29 图有素材，仅 `holmeisk`(Wasteland) 待补）；删除后端 `MapImageCatalog`（`MapOverview.image` 恒 null），`frontend/src/data/mapImages.js` 成为唯一素材权威；新增 `docs/map-catalog.md` 存档内部 code↔展示名(zh/en/ru)↔语义 mapId↔素材 映射与新增素材流程；DEVELOPER_GUIDE 素材约定同步；无素材样例改用 `holmeisk`。
- **地图鸟瞰标题三语化**：`MapOverview` 新增 `displayNames{zh,en,ru}`（`MapNames.localized`，来自 map_names.json，未收录时三语同 code），前端按 vue-i18n 当前 locale 显示标题（中文界面显示「黄沙荒漠」等中文名，缺失回退英文 `displayName`）；`map-catalog.md` 注明语义 JSON 手工调整后勿重跑语义化器（会整份覆盖）。

### Added
- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- **AI 复盘结果页「地图鸟瞰」（热力 + 路线，双阵营）**：后端 SSE `done` 载荷新增可空 `mapOverview`（`AnalyzeResponse` 第三字段，向后兼容 null）——`MapGridRegistry` 从 `map-semantics/*.semantic.json` 读取 `playableBoundsMeters` / `analysisGrid.cells`(6x6) / `sceneEvidence.battlePoints`(出生点)；`MapOverviewBuilder` 聚合：路线（双方 14 车，2s 均匀采样 ≤200 点 + `firstObservedSec/lastObservedSec` 观测区间 + 阵亡时刻，坐标与 playableBounds 同系 x=回放x、y=回放z）、六张热力（本方/敌方 × 驻留/伤害/阵亡，36 格；伤害按受击方位置落格、驻留/阵亡为事件计数，前端归一化）、阶段切片（开局/中期/残局，残局=战斗末 15s 窗口）、出生点；未知地图/无观测/无名册/视角未解析 → null。随机战（SINGLE_PLAYER）与团队战（SINGLE/MULTI_TEAM）路径均接入；`MapImageCatalog` 登记 17 张已提供素材的图片元信息（前端 mapImages.js 为渲染门控）。新增 `MapOverviewBuilderTest`（真实 rift 夹具完整输出 + 降级 null），后端全量 621 测试全绿。
- **前端「地图鸟瞰」区块**：`MapOverview.vue` 纯 SVG 渲染——底图拉伸铺满 playableBounds + 6x6 网格 + 九宫格线/编号 + 出生点；热力视图（阵营 Tab 本方/敌方 × 类型 Tab 驻留/伤害/阵亡，36 格半透明着色 + legend）；路线视图（阵营 Tab 本方/敌方/全部 × 阶段 Tab 全部/开局/中期/残局，本方暖色系/敌方冷色系各 7 色、起点圆点、阵亡 ✕、gap>5s 断线、悬停 tooltip、迟观测「位置观测自 X 秒起」提示）；`AnalysisResultPanel` 在 `done.mapOverview` 非 null 且 `mapImages` 有该地图素材时渲染可展开/收起区块（无素材整块跳过）。`frontend/src/assets/maps/` 入库 18 张素材（17 张已映射，alpen 待对应地图语义）。i18n 三语 key；vitest 169 全绿、vite build 通过。

### Changed
- **DI 注入方式收敛为构造器注入**：消除后端 9 处 `@Autowired` 字段注入（`MeterRegistry` / `ReplayUsageMetrics` 可选依赖），统一改造为构造器参数注入（参数级 `@Autowired(required = false)`）。改造范围：`AiReplayReviewService` / `AiReviewWorkerExecutor` / `PreBattleStrategicService` / `TacticalReviewHarness` / `TeamAutopsyService` / `TeamReplayAnalysisService` / `ReconstructionController` / `ReplayService`；`AiReplayAnalysisService` 测试包级构造器连动传 `null`。所有改造依赖字段升级为 `final`，便于单测直接 `new XxxService(mockDep)` 构造无需反射；行为零变更，`mvn -s settings.xml -pl wotb-web -am test` 618 用例全绿。`review-with-docs` skill 同步新增 DI 注入检查单（方法级 + 参数级 `@Autowired(required = false)` 改造优先级、不可变性、测试可构造等 5 项 sub-checks）。

### Fixed
- **AI 复盘切页后不再被 400s 预算中途掐断**：KeepAlive（v2.11.0）已保证切页不取消，但长复盘
  （团队 3 次 AI 调用）会撞整体 400s deadline 被 `AI_TIMEOUT` 杀掉；本次把全链路预算提到 1100s
  并对齐前端 / nginx / SseEmitter / 部署 env，切页做其他操作期间复盘可继续跑完并保留结果。
- **地图鸟瞰体积与九宫格标注调整**：`MapOverview.vue` 鸟瞰 SVG 宽度由 scoped CSS 控制——
  桌面/平板为容器 66.7%（约 2/3）并居中，`max-width: 768px`（手机端）恢复 100%；移除九宫格
  数字标注（region-label 文本、`--map-region-label` 与 mapPalette `regionLabel` 死代码一并清理），
  保留 region-line 分区框与 6×6 网格；新增「无 region-label、region-line=9、SVG 无内联宽度绑定」
  回归断言；versions 2.11.2。
- **地图鸟瞰渲染边界修正（图片坐标 vs 分析边界分离）**：`frontend/src/data/mapImages.js` 为全部
  28 张已登记地图增加 `coordinateBounds`（来源：对应 `map-semantics/*.semantic.json` 的
  `coordinateSystem.worldBounds`，当前均为 -300..300，逐图可校准）；`MapOverview.vue` 渲染统一改用
  `renderBounds = coordinateBounds ?? playableBounds` 换算路线/起点/阵亡标记/热力/分析网格，
  `playableBounds` 继续承担 6×6 分析网格、热力分桶与可玩区域判断——修复越靠近地图边缘偏移越大的问题
  （如 Molendijk `Spawn_1_02` 由 (110.6, 741.7) 校正至 (152.4, 693.7)）。新增 Molendijk 真实坐标
  校准、中心映射、右上出生点、无 coordinateBounds 兼容回退与路线/出生点/阵亡/网格同变换回归测试。
- **打手管理编辑回归与等级规则**：打手新增/编辑改为 `Teleport` 模态框，支持遮罩/Esc 关闭与焦点约束；编辑已有打手时关联用户只读且不再显示/提交 Keycloak UUID，PATCH 仅发送等级、资格状态、接单状态、联系方式、擅长及实际变更过的人工备注。资格申请审批不再把 `application_id`、账号 ID、档期、微信、自评等系统字段拼入 `booster_profile.description`；Flyway V14 只清理与旧自动模板精确相等的历史备注，保留人工修改内容。申请等级由四档扩为五档（新增 `MASTER`/大师级）；兼容内部值 `AVERAGE_GOD` 的“殿堂级”（英文 `Mythic`）仅允许管理员编辑已有打手时授予。`booster_profile` 新增由绑定资料/审批申请回填的 `wotb_server`，等级 CHECK + 应用预检 + 数据库部分唯一索引共同保证合法等级及每个区服最多一名殿堂级打手，`BoosterDto` 同步返回区服。
- **客户陪练需求支持四服**：客户需求 `BoostRegion` 现在接受 `CN / ASIA / EU / NA`，提交页从动态选项展示四服，客户/管理员/打手订单视图均显示需求区服。`BoostAssignmentDto` 新增 `region` 透传给打手工作台；参数化回归测试覆盖四服、大小写/空白规范化与未知区服拒绝，API 契约测试锁定四个选项值。`boost_request.region` 原本就是无 CN-only CHECK 的 `varchar`，无需数据库迁移。
- **打手资格申请支持四服**：`BoosterApplicationService` 现在接受并规范化 `CN / ASIA / EU / NA`，申请记录保存用户资料中的真实区服，不再拒绝 Wargaming 亚洲、欧洲、北美服玩家或把其区服误写为 `CN`；参数化回归测试覆盖四服与未知区服拒绝。
- **真实回放夹具进 CI（随机战斗样例）**：提交 `common/fixtures/replays/random-battle-example.wotbreplay`（rift 随机战，按用户指示原样提交、不脱敏）；`ParityTest` / `WebApiTest` 无条件加载提交夹具（gitignored `common/data` 仅本地扩展），新增 `ReplayParserFixtureTest` 断言名册/胜负/输出总量/幸存数等解析值；`.gitignore` 放开 `common/fixtures/replays/*.wotbreplay`。
- **定点重构（行为不变）**：R1 Replay archive 读取统一为 `ReplayArchiveReader`（`ReplayParser` / `ReplayReconstructionService` 复用，大小限制语义逐字节一致）；R2 时间格式规则复用 `ZH_TIME_RULE` 常量（消除 4 处内联字面量）；R3 观测伤害覆盖判定抽 `ObservedDamageCoverage`（Team / Player 共用）；R4 Team 分析 single/multi 的 evidence 限制与 first-result 记录收敛。
- **README / 首页叙事升级**：README（zh/en）重写——项目定位、mermaid 架构图、AI 证据链、8 条核心工程取舍；首页 hero 副标题三语更新。
- **AI 复盘 Call #2 流式修复（thinking 关闭 + 阶段事件 + 分块兜底）**：① Call #2 自由文本复盘默认关闭 thinking——新增独立配置 `AI_THINKING_ENABLED_CALL2`（`wotb.ai.call2-thinking-enabled`，默认 `false`），player/team/harness 三处 Call #2 请求统一使用（`AiReplayAnalysisConfig` 的 `thinkingEnabled` 更名为 `call2ThinkingEnabled`；`AI_THINKING_ENABLED` 保留为 legacy 键）；DeepSeek 推理模式下 content 末尾一次性到达、破坏 SSE 流式的问题由此修复；② 团队路径在 Call #2 前补发 `evidence_done` 阶段事件（`TeamReplayAnalysisService.analyzeTeamGroups`，与随机战 harness 对齐），前端阶段指示不再卡在「证据分析中…」；③ `SpringAiChatGateway` 新增超大 delta 分块兜底——单块 >512 字符时按句子边界切成 ≤128 字符片段、每片间隔 ~20ms 转发（上限 512 片，超长自动放大单片段），保证即使上游仍粗粒度也逐段出字；正常 token 流不引入延迟。新增回归测试：Call #2 默认 thinking=false / 开启时透传、团队 evidence_done 发射、`splitChunks` 边界与片数上限、大 delta 分片转发。
- **AI 复盘未知阵亡时间不再渲染成 `0分00秒`（PR #56 修复）**：`PlayerAnalysisTerms` 新增 `knownDeathClock`（deathSec<=0 → 「未知」），`survivalDisplay` 复用；团队 DEATH_TIMELINE、随机战死亡时间线、Autopsy 死亡时间线、opposing lineup、member facts、团队聚合首/末阵亡与随机战 KeyEvent 死亡标签统一语义——未知时刻输出「未知 … 阵亡（时刻未知）」，且未知玩家排序到已知时间之后（不再因 deathSec=0 被排到最前）。`BattlePhaseSummary.deathSourceLabel` 修正为真实语义：全部 deathTimeMillis>0 → 权威结算；结算缺失但事件流估出（deathSec>0）→ 事件流估算；存在 deathSec<=0 → 未知。新增回归测试（`TeamAiPromptBuilderTest` / `BattlePhaseSurvivalTest` / `PlayerSecondPersonAndPerHitDamageTest` / `TeamAutopsyPromptBuilderTest`）。
- **PreBattle AREA 三语泄漏修复（PR #56 修复）**：`PreBattleSectionRenderer.mapAreaNames` 接入 `AllowedLanguage`——ZH 保留 semantic 中文 label（东侧高地区域（3/5/6/9区））；EN/RU 不再泄漏中文 label 与 raw AREA ID，输出通用区域名 + 九宫格编号（`Regions 3/5/6/9` / `Области 3/5/6/9`），无编号时用 `Area` / `Область`。新增 EN/RU 回归测试。
- **AI 复盘/赛前预测质量收敛（反馈 13 项闭环）**：① 阶段时间线行明确「至阶段末」存活人数并输出 `DEATH_SOURCE`（权威结算 vs 事件流估算，`BattlePhaseSummary.deathSourceLabel`），prompt 注入双方逐车阵亡时间线（`DEATH_TIMELINE`，团队 + 随机战），system prompt 禁止把阶段末人数误读为「某时刻前全灭」；② 团队 prompt 证据数据不再输出裸秒（`deathTimeSec=`/`averageDeathTimeSec=` 等改为 `X分XX秒`），对方阵容逐车补充阵亡时刻；③ 事件流观测子集在覆盖未达 100% 时抑制数字（`OBSERVED_DAMAGE_IS_PARTIAL` 改为条件触发：观测=权威时自动消失），随机战交火段同步抑制「观测输出子集 + 百分比」，强制以权威结算为唯一可信口径；④ 赛前预测用户可见渲染覆盖 TEAM 变体（A队/B队/A 队/队伍1 等）、AREA ID → 中文名 + 九宫格编号（复用 `map-semantics` 语义库）、composition 键值三语翻译；⑤ 团队剖析段「主要战犯/MVP」标题与玩家名 ** 加粗、移除用户可见「限制:」段；⑥ `AnalyzeResponse.analysis` 统一追加三语免责结尾（AI复盘仅供参考）；⑦ 新增公共证据逻辑规则 `COMMON_EVIDENCE_LOGIC_RULE`（ZH/EN/RU）：禁止「被击毁=承受满血伤害=集火彻底」同义反复、禁止机器标签直出（CLAMPED/VALID/离散度/质心等）、标题必须 `## ` 带空格独占一行；⑧ 前端 `MarkdownContent` 标题归一化（`^(#{1,6})(?!#|\s)` 补空格，跳过围栏代码块，抽离 `utils/markdownHeadingNormalize.js`），修复 `##一、` 字面输出。
- **SSE worker 生产化加固（12 项 hardening）**：`/api/replay/analyze` 的 SSE 异步执行（`AiReviewWorkerExecutor`）由无界同步派发收敛为**有界 worker 池**——默认 4 concurrent workers + 4 queued（最多 8 active/pending），第 9 个请求被立即拒绝并返回 `503 AI_REVIEW_BUSY`（新增稳定错误码 `AiReviewBusyException` → `@ExceptionHandler`），不再阻塞 servlet request 线程排队。容量经环境变量 `AI_REVIEW_WORKER_MAX_CONCURRENT` / `AI_REVIEW_WORKER_QUEUE_CAPACITY` 可调（无需 rebuild）。拒绝策略固定为 `ThreadPoolExecutor.AbortPolicy`——绝不使用 `CallerRunsPolicy`（会让 request 线程同步执行整段 AI 复盘，重新引入 SSE blocking bug）。**HTTP request-envelope 校验前置**：`files` 为空 / 文件超 `MAX_FILES` / 类型/大小非法等请求在提交 worker 前就抛 `IllegalArgumentException` / `ReplayFileCountExceededException` → `@ExceptionHandler` 映射 **HTTP 400 结构化错误码**，不再进入 SSE 流后再以 `error` 事件传达。**queued cancellation 检查**：任务在队列中等待期间被取消（客户端断开 / cancel 端点）后获取 worker 时直接 `complete()` 并清理，不调回放解析、不调 AI Gateway、不向已断开的连接写入。**emitter 生命周期回调**：`onTimeout` / `onError`（客户端断开）只翻 cancellation token、不主动 complete（连接错误由 Servlet async lifecycle 终止 emitter，worker `finally` 清理 `AiRequestContext` 与 registry），与显式 cancel 端点幂等（token 为 CAS 一次性翻转，重复触发无副作用），避免为无人等待的请求继续计费。**随机战 team label 修复**：`PreBattleSectionRenderer.renderRandomBattle` 不再把录像者 nickname 附加为「友军（Player123）画像」——只显示「友军画像/敌军画像」；团队复盘继续保留真实 clan/team label（走 `render(...)` 路径）。新增饱和回归测试 `AiReviewWorkerSaturationTest`（workers+queue 满 → 503 / 不在 caller 线程执行 / registry 不泄漏；queued cancellation 不调 `analyzeStreaming`）。
- **AI 复盘伤害语义区分（损失血量 vs 格挡伤害）**：AI 提示词把 damageReceived 统一改称「损失血量」（不再叫「承伤」），并新增共用伤害语义规则（`COMMON_DAMAGE_SEMANTICS_RULE`，ZH/EN/RU 三语）：格挡伤害（damageBlocked）越高越好；损失血量本身中性，好坏取决于车型职责与场景——重坦/装甲车抗线掉血可接受，薄皮输出车无价值掉血或过早阵亡前大量掉血才是问题；评价玩家不得仅因损失血量高判定表现差。覆盖个人复盘（fallback/harness/多场）、团队复盘与 Team Autopsy（战犯证据类别同步改写为「损失血量明显偏高且与车型职责/存活时长/输出不匹配」）；数据行、事件流摘要与换血证据标签统一为「损失血量」。
- **AI 结构化 JSON 调用空响应修复（thinking 关闭）**：生产实测 `PRE_BATTLE_STRATEGIC_PRIOR`（Call #1）与 `TEAM_AUTOPSY` 在 `AI_THINKING_ENABLED=true` + `AI_REASONING_EFFORT=max` 下全部返回空正文（`AI_EMPTY_RESPONSE`）——DeepSeek 把整个输出预算（Call #1 4096 / Autopsy 2048）消耗在 reasoning 上，`finish_reason=length` 且 content 为空；导致随机战 Call #1 一直静默降级旧路径、训练房/联赛判负不输出战犯名单。修复：两个结构化 JSON 调用在 `AiChatRequest` 层强制 `thinkingEnabled=false`（`reasoningEffort=null`）；线上复现验证关闭后 `finish_reason=stop` 直接输出契约 JSON（Autopsy 实测 1421 字符、568 completion tokens）。新增断言测试：TEAM_AUTOPSY 与 Call #1 请求均关闭 thinking。
- **WG 登录后 Profile 同步链修复**：`PUT /api/users/wotb-account/from-login` 在 Profile 不存在时原子创建 WARGAMING Profile、空 Profile 升级为 WARGAMING、已绑定 MANUAL 返回 409 冲突；`PATCH/DELETE` 在 JWT 明确为 WG 身份时即使数据库仍未同步也返回 `WARGAMING_PROFILE_READONLY`（杜绝同步异常窗口内手动绑定）；`wotb_verified` 兼容 boolean 与字符串 `"true"`；后端对 WoTB 账号拒绝类错误码输出安全 WARN 诊断（仅错误码）。前端：WG 登录按 JWT claims 判定只读（`isWargamingLogin`），同步失败不再静默——显示「同步失败 + 重试」且绝不显示手动设置/编辑/解绑入口。
- **Wargaming 登录回调失败修复（prolongate payload 兼容 + 安全 stage 诊断）**：prolongate 成功响应兼容 `data` payload 与旧根节点 payload（优先 `data`），修复生产环境登录成功但回调被拒的问题；`WargamingEndpoint` 失败日志升级为 WARN 并包含安全 `stage`（prolongate / account-info / callback-* / identity-callback），仍不记录 token、application_id、state 或完整响应。
- **Wargaming 登录生产故障修复（认证 Host 分离）**：认证接口（login/prolongate/logout）改用 `api.worldoftanks.{asia|eu|com}/wot/auth/`（生产实测 `api.wotblitz.*` 不提供 `/wot/auth/*`，真实返回 `METHOD_NOT_FOUND`）；WoT Blitz 账号接口（account/info）仍走 `api.wotblitz.{asia|eu|com}/wotb/account/`。登录成功响应改为从 `data.location` 读取；WG `status=error` 时抛安全错误信息（code/message/field，不含 error.value / token / 完整响应），`performLogin` 捕获初始化异常返回安全错误响应，不再让用户只看到 generic unexpected error。三个 IdP 实例无需删除重建，仅重新构建 Keycloak 镜像。

### Refactored
- **工程健康度收敛（A/B 纯拆分，行为不变；C/D/E 为生产加固，见下方 Added）**：A1 `PlayerReplayPromptBuilder`（1400 行 → 门面 + 3 协作类）拆分出 `PlayerPromptRules`（规则/多语言/system prompt）、`PlayerEvidenceFormatter`（证据渲染）、`PlayerSummaryBuilder`（prepare* 编排与摘要）；A2 `DefaultTeamBattleFeatureExtractor` 拆分出 `TeamAggregateExtractor` / `TeamEngagementExtractor` / `TeamFormationExtractor` / `TeamKeyEventsExtractor`；A3 `TeamReplayAnalysisService` 拆分出 `TeamRosterResolver` / `TeamPartitionBuilder` / `TeamPromptLocalizer` / `TeamContextBuilder`；A4 `deploy.yml`（611→316 行）拆分出 `deploy/docker-compose.prod.yml`（GitHub 表达式→compose 环境变量插值）与 `deploy/deploy.sh`（secrets/vars 由 workflow `envs` 透传，等价命令，需一次生产部署验证）；B1 `TeamAiPromptBuilder` 拆分出 `TeamEvidenceFormatter`（含 BudgetWriter）；B2 `SingleReplayPromptPlanner` 拆分出 `PlannerLevelEvidence`（LEVEL 2~5 证据生成）；B3 `EventStreamReader` 拆分出 `ReplayPacketParser` / `ReplayEventExtractors` / `DeathTimeEstimator`；B4 抽取共享 `ReplayUploadValidator`（Controller 三个端点与 `AiReplayReviewService` 复用，错误码一致）。各拆分点原类保留编排入口/测试 forwarder；新增契约与单测覆盖，后端全量回归 + 前端 162 测试 + build 全绿。
- **AI 复盘 analyze 端点改为 SSE 流式（breaking change）**：`POST /api/replay/analyze` 由同步 JSON 响应改为 `text/event-stream`（旧同步端点不保留），阶段事件 + 主复盘 token 逐段实时到达。SSE 协议（自定 JSON event，`data` 为 JSON）：`call1_start` / `call1_done`（Call #1 赛前战略基线开始/结束，真实发起调用时必发，无论成败）、`evidence_done`（后端证据分析完成）、`call2_token`（主复盘 token 增量，`{"delta":"..."}`）、`autopsy_start` / `autopsy_done`（Team Autopsy 开始/结束）、`done`（全部完成，`{"analysis":"...","preBattleSection":"..."}` 双字段载荷）、`error`（流中途失败，`{"code":"AI_..."}` 稳定错误码）。异常传达规则：request-envelope 校验（locale/文件数/类型/大小/总量）与 worker 池饱和在返回 `SseEmitter` 前由 `@ExceptionHandler` 映射 HTTP 400 / 503；worker 启动后的失败经 `error` 事件传达。`AiChatGateway` 新增 `stream(request, consumer)`（Spring AI `ChatModel.stream`，单次尝试不流内重试，总预算 watchdog 与 `correlationId` cancel 语义保留——`AI_TIMEOUT`/`AI_CANCELLED` 与同步路径一致）；`ReplaySseWriter` 负责事件序列化，SSE 超时对齐 nginx 420s；同步路径委托流式实现（NOOP listener），校验/指标/异常语义不变。前端 `ReconstructionPage` 改用 fetch `ReadableStream` 解析 SSE（阶段状态 + token 滚动预览），`AnalysisResultPanel` 保持消费 `done` 载荷。nginx `/api/replay/analyze` location 新增 `proxy_buffering off` + `X-Accel-Buffering: no` + HTTP/1.1 + 清空 `Connection` 头（chunked 流式反代必需），`proxy_read/send_timeout` 420s 保留。
- **团队复盘输出质量收敛（AI 复盘 7 条反馈）**：① Call #1 输入新增双方总血量（tankopedia maxHp 求和）与单车血量，`preferredPlans` 契约要求分阶段（开局/中期/残局）输出；② Call #2 改为"战局类型识别（常规/一波流/蹲坑等）+ 预期 vs 实际对照"，移除逐条 CONFIRMED/NOT_OBSERVABLE 强制判定（TEAM_PRIOR_RULE 三语同步）；③ 后端新增"阵亡时刻与主力质心距离"特征（`TeamMemberFeatureSet.DeathProximity`，OBSERVED 位置 + 观测时间差 + 置信度，无 OBSERVED 不硬算），Prompt 强制用 canonical 距离判断脱节、禁止用九宫格编号差推断距离（TEAM_REGION_RULE 三语）；④ 输出删除"数据限制"章节，开局分路改为从首次显著分路（约 30s 后）描述、出生点同区不得当结论；⑤ 胜负用实际队名（TeamPerspectiveLabelResolver，如 CHRD）替代 TEAM_A/B 机器标签，Team Autopsy 枚举渲染中文化（HIGH→高、PARTIAL→部分等，MVP 保留英文），JSON 契约保持英文枚举不变。
- **每张地图独立坐标 profile（九宫格校准）**：`MapCoordinateProfile` 新增 `centerX/centerZ` 中心偏移；新增 `MapCoordinateProfileRegistry` 从 `map-semantics/*.semantic.json` 的 `playableBoundsMeters` 推导每图 profile（外接可玩区半边长 + 中心偏移，未知地图回退默认 ±250），替换统一 ±250 假设——himmelsdorf、karieri、forgecity 等不对称地图不再裁掉边角。`MapRegionResolver` 新增按 mapCode 的重载（`resolve/resolveRegionFromRaw/canonicalDistanceMeters`），全部消费方（Player/Team feature extractor、RouteSkill、NearbySupportCounter、SingleReplayPromptPlanner、Player/Team prompt builders）接入。九宫格切分与语义化器 `analysisGrid.cells.nineGridRegion` 全量自洽（新增 `MapCoordinateProfileRegistryTest`：33 张图 profile 覆盖可玩区 + 全部 analysisGrid cell region 一致 + area.gridRegions 与 cells 一致）。
- **地图语义数据修正（回放验证发现）**：新增手动校准探针 `MapCoordinateCalibrationProbeTest`（`-Dprobe.replays=` 批量，不进 CI）——用回放开局位置对照 semantic spawnpoint 验证坐标轴映射与边界。修正 neptune `spawnpoint` 的 team 标签 1↔2（回放实证与 malinovka 相反）；修正 himmelsdorf `analysisGrid` 第 5 列 6 个 cell 的 `nineGridRegion`（8→9、5→6、2→3）并同步 area `gridRegions`。
- **回放解析覆盖率可观测**：AI 复盘入口（`AiReplayReviewService`）对每个回放输出 `Replay event-stream parsed` 日志（file / map / packets / decoded / partial / unknown / failed / decodedRatio），可在 Loki 按回放查看事件流解码覆盖率。真实样本实测 `decodedRatio ≈ 0.31–0.35`（完全解码），`unknown ≈ 37–40%`：type 39（1.6–2.7 万包）、type 31（1800–5300）、type 35（1400–2300）、type 7（1.5–2.4 万属性包，propId→血量映射待逆向）为主要缺口桶，后续逆向按此清单推进。
- **AI 复盘可观测性（Call #1 覆盖日志）**：新增结构化日志——`Pre-battle Call #1 input`（地图名、地图语义 found/UNKNOWN、verified、areas/relationships/spawnSemantics 数量、source、displayName、双方人数、curated/fallback 车辆战术 Profile 覆盖）、`Pre-battle Call #1 success`（hypotheses/matchups/winConditions/双方 strengths·plans 数量）、`Harness prior obtained`（确认 prior 注入 Call #2）、`Harness fell back to old path: <reason>`、`Team autopsy success`（liabilities/mvps 数量）；新增指标 `wotb_ai_review_map_semantics_total{status=found|unknown}`。生产实测（thinking 修复部署后）`PRE_BATTLE_STRATEGIC_PRIOR` 已正常执行（reasoning_tokens=0、completion 正常），现在可按 requestId 在 Loki 逐请求验证地图语义与车辆语义是否进入 Call #1 并注入 Call #2。
- **PR #54 第三轮 review 修复（3 项 Evidence correctness）**：① Call #2 Prompt 不再输出 raw momentumSeries（逐采样点可观察 HP 差的观察集合可能不同，unspot 会伪装成 HP momentum），只输出 `HpMomentumSkill.detect()` 安全比较后的 HP_MOMENTUM 证据；② HP before/after/swing/coverage/commonEntityCount 必须来自同一 comparison cohort——HpMomentum 合并窗口取 hpSwing 最大的单个代表候选，CriticalWindow 取 hpSwing 最大的代表 HP signal，禁止跨 cohort 拼接（新增 cross-cohort 回归测试，杜绝 5000 swing 假信号）；③ RouteSkill 敌方人数优势要求友军侧完整覆盖（observedEnemy 作为真实敌军下界，observedEnemy ≥ 精确友军 + 2 才能断言），友军 partial 时禁止生成 enemy-majority 证据。
- **PR #54 第二轮 review 修复（3 项）**：① Call #2 user prompt 顺序修正——TASK 移到 Prompt 最尾部（BATTLE SNAPSHOT → PRE-BATTLE STRATEGIC PRIOR → TOP PIVOTAL WINDOWS → BATTLE PHASE SUMMARY → TACTICAL EVIDENCE → CRITICAL DECISION WINDOWS → TASK），任意预算下 TASK 都是最后一个业务 section，Snapshot / Prior / TASK 永不被裁剪；② HpMomentumSkill 支持 confirmed DESTROYED 的 lethal HP loss——`LifeState.DESTROYED` 按 0 HP 计入（可靠终态），普通 unspot / STALE / 非 confirmed REMOVED 仍不当作 damage，共同实体改为交集口径（消失实体不贡献、不跳过整窗）；③ NearbySupportCounter denominator 改为当前时刻存活名单（复用 `PlayerResultFormat.deathSec`），阵亡车辆不再永久污染 observation coverage，存活敌军全部被观察时可重新得到 `enemyFullyObserved=true` / EXACT。
- **Tactical Profile 十级全覆盖**：`common/tank_tactical_profiles.json` 由 24 辆扩展到全部 84 辆十级车（车种基线 + alpha/hp 数据驱动微调 + 手工微调，保留 Blitz 语义、无 PC WoT/SPG 标签）；新增回归测试断言 tankopedia-tier10 每辆车都有 curated profile。
- **AI Review Harness V1 blocker 修复（PR #54 review）**：新增 Map Tactical Semantics 层（`MapTacticalSemanticsRegistry` + `common/map_tactical_semantics.json` 空语义库；V1 所有地图明确 UNKNOWN、禁止编造区域语义，待真实数据源填充）；双 Call End-to-End 预算（`AiChatRequest.callTimeoutSec` stage budget：Call #1 45s、Call #2 用剩余预算并留安全余量、Call #1 失败后剩余不足时不启动旧路径 fallback，总 deadline = `AI_CALL_TIMEOUT_SEC`）；HpMomentum 改为共同观察实体口径（unspot/STALE 不伪造 HP swing，Prompt 区分观察子集与权威结算）；NearbySupportCounter observed 语义（两侧完整覆盖才 EXACT、敌军数量表达为"至少观察到 N"、隐藏/点亮不制造 local flip）；tank_tactical_profiles.json 清洗 PC WoT/SPG 标签（artillery_magnet / gold_dependent / hull_down_immunity / absolute_frontline）；CriticalWindow HP 聚合取最早 before / 最晚 after。
- **计划文件统一（`docs/current-plan.md`）**：`docs/current-plan.md` 成为当前开发计划唯一载体（本地文件，不入库）；`grill-me` 的需求确认单与 `grill-with-docs` 的开发方案单均写入该文件（与 k3-planner 计划格式兼容）；`review-with-docs` 文档检查清单新增「current-plan 计划文件同步」项；`.agents/AGENTS.md` 的 Phase 1 输出 plan 与 Phase 4 报告均要求更新该文件；本地 `.opencode/agents` 工作流配置（不入库）路径引用统一为 `docs/current-plan.md`。
- **审查技能改名 + 需求 grill 技能新增**：`grill-fix` → `review-fix`、`grill-with-docs` → `review-with-docs`（职责不变：代码变更后审查闭环、文档同步 + 死代码清理）；新增 `grill-me`（开发前需求澄清：目标/范围/非目标/验收标准/假设，逐层提问每轮 ≤3 个，输出《需求确认单》）与 `grill-with-docs`（开发前结合文档与代码的实现角度 grill：可落地性/影响面/分步方案/验收路径，输出《开发方案单》）；`.agents/AGENTS.md` 改动流程新增 Phase 1 需求 grill 步骤并同步全部交叉引用。
- **环境配置清理（第六轮 / 收尾扫描）**：`application.yml` 全部 30 个环境变量确认有消费者（0 未用）；`theme.css` 71 个 CSS 变量 0 未用。`common/assets/goldenShit.jpg` 曾因运行时零引用被误删，实为评分「倒数」金便便标记 `frontend/src/assets/poop.png` 的源图（`296edf3` 去黑底派生），已恢复保留。
- **后端 AI 死代码清理（第五轮 / 收尾扫描）**：删除 `AiPromptBudgetGuard.enforceMessages`（零调用公有方法）及未用 import；扩展私有方法零引用扫描至 Keycloak provider 模块（0 命中）；实体 getter / `@Scheduled` / 事务回调经框架引用确认保留。
- **前端 i18n 死 key 清理**：删除三语 locale 中全仓（含测试）零引用的 34 个静态孤儿 key（`admin.unknownError`、`app.back/homepage/logout/unknownUser`、`home.apiDesc/apiTitle/planned/statsCard*`、`leaderboard.back/upload_failed`、`profile.*` 23 个残留 key）；动态家族（`api_errors.*`、`player_labels.*`、`recon.errors.*`、`boost.*`、`contact.*`、`version.*` 等）经逐一确认保留。前端 141 测试 + build 通过。
- **后端 AI 死代码清理（第四轮 / 死接口删除）**：删除全仓零引用的单实现接口 `ReplayProcessingService`、`PlayerBattleFeatureExtractor`、`TeamBattleFeatureExtractor`（除声明与自身 `implements` 外无任何类型引用），Default 实现直接作为类使用并去掉 `@Override`；`AiChatGateway`/`AiTokenEstimator` 因有多个测试替身实现保留（合法测试性抽象）。`docs/replay-data.md` 目录树同步。
- **后端 AI 死代码清理（第三轮 / AnalyzeResponse 收窄）**：`/api/replay/analyze` 响应由 16 字段收窄为仅 `{ analysis }`——前端只消费 `analysis`，其余统计/诊断字段（计数、`files`、`analyses`、`keyEvents`、`limitations`）全仓零读取，属提前性载荷。级联删除：`AnalyzeResult`/`TeamAnalyzeResult`/`PreparedAiPrompt` 的未读字段、`AiReplayReviewService` 的文件状态/统计机制（`buildFileStatuses`/`countFailed`/`ReplayUploadResult`）、`TeamReplayAnalysisService` 的 per-unit 结果/限制簿记（`buildTeamAnalysisUnits` 等）、`AnalysisUnitAssembler.buildAnalysisUnits`；保留 prompt 构建内部的限制/截断逻辑（`TeamAiPromptBuilderTest` 覆盖）；连带删除 13 个只测响应单元的测试与前端 fixtures/i18n 相关清理，文档同步。
- **后端 AI 死代码清理（第二轮）**：删除 `TeamAiPromptBuilder.estimateTokens`（全仓零引用私有方法）；深度扫描确认 fallow 无真实前端死代码（仅平台 optionalDependencies 误报）、AI facade 公有方法/api-boost 导出/其余私有方法均无死代码。
- **后端 AI 死代码清理（按 grill-with-docs 第 7 项执行）**：删除 `AiChatRequest`/`AiChatResponse` 的 `metadata` 字段（生产构造恒为 `null`、全仓零读取，仅一处测试断言 correlationId 透传）与 `AttemptBudgetContext()` 无参构造（零引用），连带清理对应测试断言与未用 import；行为无变化，全量后端测试通过。
- **grill-with-docs 增加 AI 死代码清理**：`grill-with-docs` 技能在 grill-fix 与文档同步之间新增第 7 项「AI 死代码/提前性代码清理」——针对 AI 生成代码的单实现抽象、从不覆盖的字段/参数、占位空壳等提前性死代码，执行「识别 → 全仓零引用证明 → 三分类（真死/假死/待定）→ 安全删除 → 全量验证」闭环；假死代码安全边界（API 契约/反射/metrics/i18n/DB）写入检查单，品味判断引用 `code-smell` 技能。
- **API URL 常量化**：新增 `ApiPaths` 常量类（`wotb-web/.../config/ApiPaths.java`）作为 API 路径单一来源，`SecurityConfig` 的全部请求匹配器与各 Controller 的映射注解共用；端点路径字面量不再在两处硬编码，URL 变更只需改一处。纯重构，对外 API 与行为不变。
- **前端依赖安装统一为 `npm ci`**：deploy workflow 与 `java/README` 由 `npm install` 改为 `npm ci`（按 `package-lock.json` 精确安装、先清空 node_modules），与 CI（`ci.yml`）和 `Dockerfile.frontend` 保持一致。
- **主 README 精简为 brief 文档索引**：README.md / README.en-US.md 收敛为项目简介 + 文档入口 + 快速开始指针；运行/构建、备份、目录结构与数据格式细节统一指向 `DEVELOPER_GUIDE`、`java/README`、`replay-data`、`observability` 等文档，不再在 README 重复。
- **OkHttp watchdog 生命周期修复（AI_CALL_TIMEOUT_SEC 覆盖响应体读取/解析）**：attempt 级 `AttemptBudgetContext` 收敛 Call 引用与过期标记；okhttp interceptor 不再提前清除 Call，看门狗可覆盖连接→请求发送→等待响应→响应体读取→SDK JSON 反序列化→Spring AI response 创建全过程；处理 watchdog 先于 interceptor 触发（设置 Call 后复检并立即取消）；成功返回前再次检查总 deadline，超时后绝不返回 success、不记录 success/token 指标，统一返回稳定 `AI_TIMEOUT`。watchdog executor 使用 `ScheduledThreadPoolExecutor.setRemoveOnCancelPolicy(true)` + daemon + `@PreDestroy` 关闭。新增真实 HTTP 慢响应取消测试（原生 ServerSocket drip，模型 read timeout 60s、gateway 总预算 5s，仅看门狗能停）、watchdog 先于 interceptor 竞态测试（hook 确定性触发）、fake-clock 响应完成但 deadline 已过测试。
- **AI 总调用超时边界（AI_CALL_TIMEOUT_SEC 语义修正）**：`AI_CALL_TIMEOUT_SEC` 现在覆盖一次 `AiChatGateway.chat()` 的整个生命周期（首次请求 + 全部 retry + 全部 backoff + 响应解析），不再只是单次 HTTP request 的 timeout。实现：单调时钟（`System.nanoTime`）计算总 deadline；每轮尝试前检查剩余预算，不足时不再发起请求并返回稳定 `AI_TIMEOUT`；backoff 受剩余预算限制；in-flight 请求在预算耗尽时通过 okhttp interceptor + 看门狗中止（单轮实际上限 = `min(AI_TIMEOUT_SEC, 剩余预算)`）。retry 语义不变（429/网络/部分 5xx 可重试；认证/权限/invalid request/model not found/context too large/空或无效 completion 不重试）。新增 `SpringAiChatGatewayDeadlineTest`（fake clock/sleeper，8 个测试覆盖 Review 要求的 10 个检查点）。
- **Timeout / Retry / 脱敏 / AI Observability 加固（Spring AI 迁移阶段四）**：timeout 与 retry 收敛为单一配置来源（`wotb.ai.*` 环境变量）。显式四段超时：`AI_CONNECT_TIMEOUT_SEC`（connect）、`AI_TIMEOUT_SEC`（read/response，默认 300 不变）、`AI_CALL_TIMEOUT_SEC`（单次调用总边界，默认 315，必须 ≥ connect+read）、write 显式取 read 值；经官方 `OpenAiHttpClientBuilderCustomizer` 写入 SDK `Timeout`，不再依赖框架默认值。单层 retry：`AI_RETRY_MAX_ATTEMPTS`（默认 3）、`AI_RETRY_INITIAL_BACKOFF_MS`（1000）、`AI_RETRY_MAX_BACKOFF_MS`（8000）、`AI_RETRY_BACKOFF_MULTIPLIER`（2.0）；SDK `maxRetries` 固定 0，杜绝 retry×retry。可重试：429 / 连接失败与超时 / 500/502/503/504；不重试：认证、权限、invalid request、model not found、context too large、空/无效 completion（避免重复付费）。集中脱敏 `AiSecretRedactor`（Authorization/Bearer、api-key/api_key/apiKey/apikey、token/secret/password/client_secret、query parameter、嵌套 JSON、异常消息，大小写不敏感）接入 gateway 日志路径。Observability 保留原 `wotb_ai_upstream_*` 三个指标（requests 按 attempt、errors 按最终失败、duration 含重试），新增低基数指标：`success_total`、`retries_total`、`retry_outcome_total{mode,outcome}`、`tokens_total{mode,token_type}`；禁止高基数 tag（昵称/account/file/correlation ID/Prompt/Completion/错误正文）；Spring AI Observation 使用 NOOP，Prompt/Completion 默认不记录。
- **Spring AI Provider transport 迁移（Spring AI 迁移阶段三）**：删除临时 `DeepSeekRestAiChatGateway`、手写 `RestClient`、Provider 请求 map / 响应 DTO 与手工 HTTP 解析；生产路径唯一 adapter 为 `SpringAiChatGateway`（Spring AI 2.0.0 + 官方 OpenAI-compatible adapter，连接 `https://api.deepseek.com`）。模型/温度/max tokens 使用一等 options；`thinking:{type}` 与 `reasoning_effort` 通过官方 `extraBody` 机制原样传递（2.0.0 DeepSeek Starter 的 `DeepSeekChatOptions` 无这两个字段，已逐字节核对 jar）。异常映射（认证/限流/超时/连接/4xx/5xx/context too large/空响应/无效响应/未知错误）、`wotb_ai_upstream_*` 指标、`AI_NOT_CONFIGURED` 无 key 启动语义与前端错误码契约不变。`AiGatewayConfig` 自建 `OpenAiChatModel`（无 key 时不建 client）；application.yml 排除 OpenAI auto-config 保证无 key 启动。测试替换为 mock `ChatModel` 的 `SpringAiChatGatewayTest`/`SpringAiChatGatewayMetricsTest`，禁止真实 DeepSeek 调用。Spring AI BOM 2.0.0 引入父 POM dependencyManagement，`wotb-web` 仅增加 `spring-ai-starter-model-openai`。
- **拆分 Player/Team 业务编排（Spring AI 迁移阶段二）**：`AiReplayAnalysisService` 由 2000+ 行压缩为约 120 行薄兼容 facade，仅注入并委托 `PlayerReplayAnalysisService`/`TeamReplayAnalysisService`，不再构建 Prompt、不发送 HTTP、不处理 Provider DTO。Player 单场/fallback/multi 编排、Prompt Builder 调用与 `AnalyzeResult` 组装进入 `PlayerReplayAnalysisService`；single/multi team 分区（complete-link）、perspective 隔离、roster 一致性、team limitations 与每个 analysis unit 的处理进入 `TeamReplayAnalysisService`。Token/上下文预算收敛为唯一实现 `AiPromptBudgetGuard`（`PlayerReplayPromptBuilder` 内部重复判断已删除并统一委托）；`analysisUnitId` 映射、`AnalysisUnitResult` 计数与 `findRecorder` 收敛为 `AnalysisUnitAssembler`；Player/Team 共享预算与模型选项由 `AiReplayAnalysisConfig` 装配。Controller/API、请求响应结构、异常语义、Prompt 文案与错误码不变；新增 `AiReplayAnalysisServiceFacadeTest` 校验纯委托行为。
- **AI Provider 调用边界隔离（Spring AI 迁移阶段一）**：新增项目内部 `AiChatGateway` 接口、供应商无关 `AiChatRequest`/`AiChatResponse` 模型与临时 `DeepSeekRestAiChatGateway` 适配器。`AiReplayAnalysisService` 不再持有 `RestClient`、不再处理 Authorization、不再定义 Provider 响应 DTO、不再构建 DeepSeek 请求体；生产环境唯一 AI HTTP 入口收敛到 Gateway。HTTP 错误分类、`safeProviderSummary` 脱敏、token usage、上游调用耗时/成功/失败指标、`correlationId` 生成全部移入 Gateway；稳定错误码与 `AiUpstreamException` 语义、前端 HTTP 契约不变。`AiUpstreamException` 新增 cause 构造器以保留 stack trace。
- **提取 Player Replay Prompt 与证据构建**：新增 `PlayerReplayPromptBuilder` 与 `PreparedAiPrompt` 记录，承接 Player system prompt、common/player 规则常量、单回放完整特征与 fallback user content、多场趋势摘要、对炮/击杀归因/死亡时间线/区域时间线/交火/阶段/关键事件/限制拼装，并内部完成 token 预算密度裁剪（`SingleReplayPromptPlanner`）。`AiReplayAnalysisService` 仅保留业务编排：接收上下文 → 调用 Builder → 在 `call()` 中做 token budget 检查 → 调 `AiChatGateway` → 返回 `AnalyzeResult`。Prompt 文案、friendly/enemy 解析、`你` 第二人称契约、时间格式、注入边界与证据语义全部不变。
- **AI Replay 测试重构**：`AiReplayAnalysisServiceTest` 由本地 HttpServer 切换为 `FakeAiChatGateway` 契约断言；HTTP/脱敏/metrics 测试移入 `gateway` 子包新增的 `DeepSeekRestAiChatGatewayTest`/`DeepSeekRestAiChatGatewayMetricsTest`；新增 `PlayerGatewayPromptContractTest` 捕获 `AiChatRequest` 的 system/user/model/analysisMode。

### Added
- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- **公开回放接口 nginx 限流（C）**：`/api/preview` `/api/export` `/api/rating` 应用 `limit_req`（单 IP 1r/s + burst 10 nodelay）与 `limit_conn`（单 IP 并发 5），超频 429 / 超并发 503；仅 nginx 层，后端 100 文件/20MiB/200MiB 额度契约不变（`nginx -t` 校验通过）。
- **AI 取消 correlationId 加固（D）**：`AiCancellationRegistry` 仅接受 canonical UUID（格式+长度），重复活跃 id 拒绝（不复用 token），`unregister(id, token)` 改为 compare-and-remove；analyze 与 cancel 端点校验客户端 correlationId 为 UUID，非法/重复返回 400。
- **AI Review 整体 deadline 对齐（E）**：请求提交时刻计算 `now + overall-deadline-sec`（`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`，默认 400s，对齐前端 400s / nginx 420s），经 `AiRequestContext` 暴露给 worker；团队与随机战预算起点回溯到提交时刻（排队计入预算），启动时预算耗尽直接干净失败 `AI_TIMEOUT`；排队等待记日志与 Micrometer timer（`wotb_ai_review_queue_wait`）。
- **敌方最后已知位置特征（AI 复盘"敌方走位"）**：新增 `EnemyLastKnownPositionResolver`（core）聚合敌方逐车最后已知位置——输入最终战场状态快照 + 权威名册 + perspective 队伍，只统计 `OBSERVED` 且有位置的车辆，输出每辆敌车的最后已知位置（九宫格区域 / 距你方（perspective 方）OBSERVED 有位置车辆质心的 canonical 距离 / battle-relative 最后观察时间）；无 OBSERVED 记录输出显式 UNKNOWN 行，绝不把观测子集伪装成全知。置信度口径沿用 `NearbySupportCounter`（全部敌方有 OBSERVED → EXACT，覆盖不全 → PARTIAL，名册无敌方 → UNKNOWN）。`EnemyLastKnownPositionsSection`（web）渲染 prompt 段，随机战行「敌方 昵称 坦克: 最后已知位置: N区 距你方主力质心: Xm 最后观察时间: X分XX秒」、团队行沿用 OPPOSING_TEAM_LINEUP 的 opponent 机器键；段头标注「观测子集」，时间一律 X分XX秒。随机战 harness / fallback / 完整特征与团队复盘（single）全路径注入，团队路径与其它 optional 证据同级、超预算整体被裁剪。
- **阶段时间线 + 双方存活人数特征**：`BattlePhaseSummary` 新增 `buildRelativePhasesWithSurvival`——与既有 `buildRelativePhases` 完全相同的阶段边界，附加每阶段结束时的双方存活人数与密集击杀段标记（`denseKills`，15 秒窗口内双方合计阵亡 ≥3 启发式）。人数只来自 `SurvivalTimeline.fromBattleResults`（battle_results 权威死亡时刻，`PlayerResultFormat.deathSec`）；某侧人数不可算（无名册/视角未知/存在未知死亡时刻）时为 null，渲染为「未知」/ UNKNOWN，绝不猜测。随机战（harness / fallback / 完整特征）与团队复盘 prompt 统一经 `BattlePhaseTimelineSection` 渲染：随机战行「X分XX秒 阶段名 | 我方存活 N 敌方存活 M（密集击杀）」，团队行输出 friendlyAlive/enemyAlive/denseKills/confidence 机器键，段头附权威口径说明。
- **赛前预测区块（preBattleSection）**：`AnalyzeResponse` 由单字段扩展为 `{ analysis, preBattleSection? }`（`TeamAnalyzeResult` 同步扩展）。`PreBattleSectionRenderer` 将 Call #1 prior 渲染为用户可见中文 Markdown（去除机器段头，`TEAM_A`/`TEAM_B` 替换为可读标签；随机战 harness 用中性「队伍1/队伍2」，团队复盘按视角队伍交换为「我方/对方」），含队伍画像 / 关键对阵 / 战略胜机 / 战略假设四个小节。Call #1 失败 / 降级 / 非中文时 `preBattleSection` 为 null。前端 `AnalysisResultPanel` 新增可折叠「赛前预测」区块（默认展开，`recon.prebattle.*` 三语文案），`v-if` 空值不渲染。
- **Team Autopsy 仅用于 team perspective（结算级 TEAM_AUTOPSY）**：随机战斗个人复盘不评判 MVP/战犯（`TacticalReviewHarness` 为双 Call，不输出团队剖析段）；战犯/MVP 只应用于训练房/联赛团队复盘——`TeamReplayAnalysisService` 单团队单元成功后追加结算级独立 TEAM_AUTOPSY 调用，输入只有权威逐人结算（本链路无 Call #1 Strategic Prior / Critical Window / Route 证据，使用结算级 system prompt）。**完整七人 roster 门禁**：仅当 recorderTeam 恰好存在 7 名有效本方玩家时才生成 P1..P7 并调用 Gateway，0～6 人或超过 7 人时不调用并记录 roster_incomplete（保留团队主复盘）。**settlement-only 置信度边界**：LLM 生成的 contribution / MVP / 战犯判断不是权威结算事实，confidence 只能为 PARTIAL/UNKNOWN，Parser 拒绝出现 EXACT/INFERRED 的整个响应，System Prompt 契约同步为 PARTIAL|UNKNOWN。玩家身份改用无业务推断的 `playerKey`（按本方 roster 稳定编号，同队同名坦克可区分）：Parser 要求 players 的 playerKey 集合与 roster **完全相等**（不缺失/不额外/不重复，超长不得截断）、contribution 仅 HIGH/MEDIUM/LOW/UNKNOWN、MVP/战犯各自最多 3 人（超限拒绝）、每条 verdict 引用有效 playerKey 且列表内不重复、reason 非空、evidence 至少一条、判胜至少一个 MVP / 判负至少一个战犯、空结果拒绝，任何契约不成立整段返回 null；最终渲染按 playerKey 回查后端权威昵称/坦克名。`TeamAutopsyStatsBuilder` 只构建 recorderTeam 本方玩家，weakOutput 均值只使用本方队伍（敌方伤害不影响）；权威结算与派生 flag 置信度分离（earlyDeath/weakOutput 为规则候选、deathInCriticalWindow 继承窗口 confidence 且结算级代理不得 EXACT）；死亡时间线仅含本方。TEAM_AUTOPSY 预算按整体剩余时间裁剪（min(30s, 剩余 - margin)，不足安全余量不启动并记录 budget_exhausted），`AI_CANCELLED` 重新抛出不被吞掉。
- **地图关系语义无损保留**：`MapTacticalSemantics` 的 `relationships` 由有损分组结构（controls/connects/enablesPressureAgainst/higherThan/containsPoints）改为 `List<TacticalRelationship>`，与 semantic.json 原始语义一致（from/type/to/reason/confidence 全部原样保留）；ADJACENT_TO 不再改名为 connects，CONTAINS_CONTROL_POINT 与 CONTAINS_STRATEGIC_POINT 不再合并。Call #1 Prompt 按原始类型渲染（如 `ELEVATED_TERRAIN_02 ADJACENT_TO VEGETATED_TERRAIN_02` + reason/confidence），系统提示明确 ADJACENT_TO 仅表示确定性分析网格相邻，不代表可通行路线/视线/交叉火力，不得据此声称 CONTROLS 或 ENABLES_PRESSURE_AGAINST。
- **地图显示名一致性（map_names.json）**：`map-semanticizer` 批量生成时自动用 `map_names.json` 的 en 名填充 `displayName`（未收录的新图回退 mapId），语义数据不再全是内部代码；`MapTacticalSemantics`/Registry 保留并消费 `displayName`，Call #1 Prompt 语义段渲染「地图: "Desert Sands"（内部 code: "desert_train"）」可读标识。新增 Python 测试（displayName 与 map_names en 一致 / 未收录回退 mapId）。
- **地图语义可信度边界保留 + Semanticizer 自动验证测试**：`MapTacticalSemantics`/`MapTacticalSemanticsRegistry` 保留并消费 `verified`、`source` 与区域 `confidence`（geometry/objectPositions/objectCategories/areaBoundary/favorsAndRisks）；Call #1 Prompt 新增可信度图例（EXACT_CLIENT_DATA/EXACT_SCENE_DATA=客户端直接事实、NAME_HEURISTIC=对象位置精确但类别由资源名推断、GRID_RULE_DERIVED=区域名称/边界/合并是规则候选、RULE_DERIVED_CANDIDATE=favors/risks 是假设候选），`verified=false` 明确渲染"尚未完成人工地图核验"，与全局置信度不一致的区域单独标注差异。新增 `map-semanticizer/tests/test_map_semanticizer.py`（15 项：heightmap 16×16 分块还原、variant auto 与无标签图、mapCodes token 边界、区域置信度保留、关系引用有效、禁止关系类型、全部语义文件可解析、生产 map code 恰好单覆盖、gridRegions 1–9、Z 校验 P90 规则），由仓库维护者手动运行（不接入 CI）；`24_milibase_mlb` 的 Z 校验 MAE=1.45m 但 P90=0.08m，说明为少量高架出生点所致，验证规则以 P90 为准不判 heightmap 失败。
- **地图语义九宫格对齐（GRID_REGION_1~9）**：`map-semanticizer` 每个语义网格 cell 输出 `nineGridRegion`、每个 AREA 汇总 `gridRegions`，与后端 `MapRegionResolver` 使用同一坐标约定（回放 raw ±250 m → 500×500 canonical → 3×3：北/上 1|2|3、中 4|5|6、南/下 7|8|9，列自西向东）；`MapTacticalSemantics.TacticalArea` 新增 `gridRegions`，Call #1 Prompt 为每个语义 AREA 标注 `九宫格=GRID_REGION_N`，系统提示明确 GRID_REGION 与 AREA 对应关系（无语义数据时仍只是位置编号）；33 张地图语义数据已随脚本重新生成。若部署端调整 `REPLAY_COORDINATE_HALF_EXTENT`，需同步 `NINE_GRID_HALF_EXTENT` 并重新生成。
- **地图语义化真实数据接入（PR #54 地图语义 V1）**：新增 `map-semanticizer`（Python，读 Wot Blitz 客户端 `.sc2` + `.heightmap` 解码生成 `<mapId>.semantic.json`，含 `areas` / `relationships` / `spawnSemantics` / `mapCodes`，无第三方依赖）；`common/map-semantics/` 首批 33 张战斗地图语义数据进入构建资源（`wotb-core/pom.xml` + `Dockerfile.backend` 复制目录），脚本支持 `--variant auto`（按 SC2 标签选主变体，夜战/无标签图按精确场景数据解析出生点）与 `--map-names-file`（批处理按 token 边界推导 `mapCodes`，`milibase`→`milbase` 登记在 `MAP_ID_CODE_ALIASES`）。`MapTacticalSemantics` 扩展出生点语义与关系类型（`higherThan` / `containsPoints`）；`MapTacticalSemanticsRegistry` 改为加载 `classpath:/map-semantics/*.semantic.json` 并按 `mapCodes` / `mapId` / token 边界别名查询（删除旧的空 `common/map_tactical_semantics.json`）；Call #1 对已收录地图渲染真实区域/关系/出生点语义，favors/risks 标注规则候选，CONTROLS / ENABLES_PRESSURE_AGAINST 未提供时禁止声称；未收录地图保持 UNKNOWN。
- **AI Review Harness V1（双 Call 战术复盘）**：新增赛前战略基线 Call #1（`PreBattleStrategicService` + `PreBattlePromptBuilder` + `PreBattleStrategicParser`，roster-only 输入、严格剥离战绩字段、结构化 JSON 输出 ≤4k tokens）；新增 6 个确定性 Backend Evidence Skill（`HpMomentumSkill` / `EngagementTradeSkill` / `LocalSupportSkill` / `DeathCascadeSkill` / `RouteSkill` / `CriticalWindowSkill`，统一 `AiEvidence` 含 confidence / provenance / priority）；新增 Call #2 Priority Bookends Prompt（`TacticalReviewPromptBuilder`，相关性预算裁剪 + Controlled Redundancy）；`TacticalReviewHarness` 编排并定义降级阶梯（非 ZH / 无重建 / 录像者未解析 / 特征不可用 / Call #1 失败 / 无证据 → 旧单 Call 路径）。地图语义 V1 不可用：区域统一九宫格 `GRID_REGION_1~9`，禁止 LLM 编造点位/区域名；TEAM_A/B ↔ 队伍 1/2 固定映射。新增 `common/tank_tactical_profiles.json`（Tank Tactical Profile 语义层，精选 + 车型 fallback）。对外 API 与响应结构不变；EN/RU 保持旧路径。
- **Tankopedia 同步流程顺序修复（业务范围过滤先于完整性门禁）**：`main()` 改为 `parse_tanks → filter_to_business_tiers(tier 7-10) → apply items/equipment → merge_extra_info → validate_integrity → write 4 tier files`；真实 blitzkit 全量 `tanks.pb` 中的 1–6 级车辆不再触发 `TANKOPEDIA_TIER_OUT_OF_RANGE`，`Update Tankopedia` workflow 可正常生成 tier 7–10 四个文件。新增 tier 5/8/10 混合回归测试（tier 5 不进入任何 JSON、T-34-2 仍为 400、extraInfo 保留）。
- **Team AI prompt 补齐结构化车辆事实**：`TEAM_MEMBERS` 与 `OPPOSING_TEAM_LINEUP_AUTHORITATIVE` 两条路径新增 `alphaDamage` / `hp` / `extraInfo`（仅 Tankopedia 提供时输出；10 级多炮车无权威 alphaDamage 时省略，不猜测；`extraInfo` 按不可信数据 JSON 引用/转义）。新增 SPHT/Kranvagn/E 100 与 extraInfo 转义的 Team prompt 测试。
- **Tankopedia 更新完整性门禁**：`update_tankopedia.py` 在写入前校验——解析为空、总车辆数或单 tier 数量相对已有数据下降超 20%（允许少量真实删除）、tank ID 重复、tier 不在 7–10、车辆缺 id/name/hp/gun 均失败，失败不写文件、不提交。新增 8 个 Python 完整性测试。
- **Python 测试进入 CI**：`ci.yml` 新增 `python` job，运行 `python3 -m unittest discover -s common/python/tests -p 'test_*.py'`。
- **Tankopedia 权威炮伤语义修正（alphaDamage 不再按数组顺序猜）**：`guns[].isDefault` 与 vehicle 级 `alphaDamage` 改为基于炮等级（`GunDefinition.tier`）——7–9 级默认炮 = 顶配炮（最高 tier，同 tier 取最高 alpha，T-34-2 由错误的 200 修正为 400，已用 origin/main 全量 454/457 验证）；10 级多终局炮车（E 100 / B-C 25 t 等 9 辆）保留完整 `guns[]` 但**不标默认、不输出 vehicle 级 alphaDamage**（回放无可靠实际炮，AI structured facts 省略炮伤，不再把数组第一把炮伪装成本场实际炮伤）；10 级单炮车（SPHT=400 等）正常输出。Java `Tankopedia` 只读 vehicle 级 `alphaDamage`，删除 `defaultGunInt` 的 `guns[0]` 兜底。新增 T-34-2 / E 100 / SPHT 回归测试。
- **车辆库按等级拆分为 4 个文件**：`common/tankopedia.json` 拆分为 `common/tankopedia-tier{7,8,9,10}.json`（meta 新增 `tier`，`count` = 该级车辆数）；`update_tankopedia.py` 参数改为 `--existing-dir`/`--output-dir`，只输出 7–10 级四个文件；Java `Tankopedia.load()` 依次加载 4 个 classpath 资源合并查询，`wotb-core/pom.xml` 与 `Dockerfile.backend` 同步复制 4 个文件；`Update Tankopedia` workflow 改为同步并提交 4 个文件。
- **车辆库全面切换 blitzkit + 新格式（vehicles 数组，全英文）**：`update_tankopedia.py` 数据源由 WG 百科切换为 blitzkit（`assets.blitzkit.app/definitions/tanks.pb` + `consumables.pb` + `provisions.pb` + `equipment.pb`，游戏客户端直出，含 WG 未收录的新车如 SPHT / AC Atlas）；输出改为 `meta` + `vehicles` 对象数组，每辆车一条记录，**全部字段与值均为英文/数字**：`name/id/tier/class/nation/hp/forwardSpeed/reverseSpeed/turretRotationSpeed/hullRotationSpeed/powerToWeightRatio/guns/alphaDamage/allowedProvision/allowedConsumables/allowedEquipment/extraInfo`。10 级顶配炮塔多炮车不再拆记录，改用 `guns` 数组按炮区分（`gunId`/`isDefault`/`alphaDamage`/`shells`，默认炮语义见上一条修正）；每发弹输出 `shells`（type/damage/penetration，type 归一化 ap/apcr/heat/he）；`allowedProvision`/`allowedConsumables` 由 blitzkit include/exclude 过滤器（tier/ids/clip/nations）判定并映射 `common/wotb-item-catalog-json` 的逻辑 id/code；`allowedEquipment` 由车辆 equipment_preset 槽位装备映射为 catalog 装备 code（含 VK 72.01 / Type 71 俯角、履带齿等专属装备）；`extraKnowledge` 更名为 `extraInfo` 按 tank_id 保留合并。Java 端 `Tankopedia` 适配新格式，车种/国家返回英文值，AI 复盘正文语言由前端 `lang` 参数控制，`VehicleCodes`/`Rating` 兼容英文输入。`Update Tankopedia` workflow 同步简化：blitzkit 为公开 CDN，runner 直接同步提交，不再需要 `WG_APPLICATION_ID` / `VPS_*` secrets 与 IP 白名单。
- **WG 官方车辆百科 + 每车知识点注入 AI prompt（本 PR 中间方案，已被上一条 blitzkit 全面切换取代）**：`update_tankopedia.py` 数据源由 blitzkit 切换为 Wargaming 官方 WoT Blitz 百科（`WG_APPLICATION_ID`，默认只保留 7–10 级），WG 百科未收录的新车（如 11.19 的 SPHT 等）由 `common/python/blitzkit_fallback.json` 兜底（`--fallback`：WG 优先、缺车才补，meta 记录 `fallback_count`）；新增手动触发的 GitHub Actions **`Update Tankopedia`**——因 WG application_id 有 IP 白名单（上限 10、runner IP 动态不可加），workflow 改为 SSH 到 VPS（IP 已白名单）执行同步并把 `tankopedia.json` 拉回提交到 main；`tankopedia.json` 新增 `hp` 与手工维护的 `extraKnowledge` 字段（刷新脚本按 tank_id 保留合并，不覆盖个人知识点）；同步脚本加固：`--existing`/`--output` 路径分离（输入输出互不覆盖）、仍存在车辆的知识点保留失败即中止、分页防死循环（上限 100 页 + 无进展检测）、`alphaDamage` 取 `default_profile.shells` 第一发（标准弹，已用真实响应验证，不使用 max）、日志不含 application_id、新增 Python 单元测试；实体标签注入 炮伤/血量/知识（`EntityIdentityResolver.appendStructuredTankFacts`），prompt 规则白名单放行新结构化字段；`TankInfo.alphaDamage` 从死数据变为 prompt 实际消费。
- **Wargaming.net ASIA / EU / NA 三服登录完整闭环**：新增 Keycloak 自定义 Identity Provider `keycloak-wargaming-provider`（Provider ID `wargaming`，一个类型、ASIA/EU/NA 三个实例），走 WoT Blitz 官方认证/账号接口（ASIA→`api.wotblitz.asia`、EU→`api.wotblitz.eu`、NA→`api.wotblitz.com`，实测 `application_id` 按 Blitz 游戏注册、跨区通用，三服共用一个 `WG_APPLICATION_ID`）；WG 登录创建独立账号（**username = `wg_{region}_{account_id}` 区服隔离**、broker = `wg:{region}:{account_id}`），重复登录自动刷新昵称与展示名；**登录身份安全绑定**：`POST /wot/auth/prolongate/` 服务端响应返回 token 所属 `account_id`（官方契约字段），broker/username/wotb.account_id 全部取自该可信值，浏览器回调的 account_id/nickname/expires_at 仅作一致性检查，杜绝「有效 token + 篡改回调 account_id 登录成他人账号」；JWT 新增 `wotb_region` / `wotb_account_id` / `wotb_nickname` / `wotb_verified(boolean)` claims；后端 `user_profile` 新增 `wotb_account_source` / `wotb_account_verified_at`（V12），V13 `CHECK (wotb_server IN ('CN','ASIA','EU','NA'))`，创建/同步/只读逻辑按 JWT `wotb_region` 参数化，`PUT /api/users/wotb-account/from-login` 幂等同步；登录入口为 Keycloak 托管登录页（未登录直接跳转，页面列出 QQ + 三个 WG IdP，前端无自定义登录页），个人中心按 `wotbAccountSource=WARGAMING` 判定只读并展示中国/亚洲/欧洲/北美四个服务器标签。存量用户已补 `region=CN`（138/138）。
- **联系页**：新增 `ContactPage.vue`（`?view=contact`），展示 QQ（1582536892）、微信（a1582536892）、Discord（a158coke）三个渠道，支持一键复制并带「已复制」反馈；顶栏新增「联系我」入口（`contact.*` 三语文案）。
- **版本历史独立页面**：版本历史从首页拆出为 `VersionPage.vue`（`?view=version`），顶栏新增「更新历史」入口（`version.btn`）；首页不再内嵌版本列表。
- **顶栏反馈入口**：`App.vue` 顶栏新增 `app.feedback` 三语按钮（zh 反馈 / en Feedback / ru Обратная связь），`target="_blank" rel="noopener"` 直达 `https://github.com/A158Coke/WotbTools/issues/new`，无需登录。
- **AI 复盘输出语言跟随界面语言**：`/api/replay/analyze` 的 multipart 表单字段 `lang`（必填，白名单 zh/en/ru）控制 AI 复盘输出语言；缺失时返回 400，空白或未知值返回 400 `UNKNOWN_LOCALE`。语言经 ReviewService/facade/Player/Team Service 传入 Prompt Builder：ZH system prompt 字节级不变；EN/RU 在中文基座上替换互斥的中文输出强制句（输出语言、称谓、车种、时间格式、未知字段与无法确定措辞），保留不编造、坦克专有名词原样、perspective/friendly-enemy、权威结算与观测子集、注入防护、数据限制等业务约束。en 时间格式统一为 `Xm Xs`（如 `1m 15s`、`3m 0s`、`3m 12s`），ru 为 `X мин X с`（如 `1 мин 15 с`、`3 мин 0 с`、`3 мин 12 с`）。覆盖 Player full/fallback/multi 与 Team single/multi 全部路径；地图/坦克/clan/昵称等专有名词不翻译。前端按 vue-i18n 当前 locale 携带 `lang`。
- **Grafana MCP server（生产）**：VPS 新增 `grafana/mcp-grafana` 容器（StreamableHTTP，`GRAFANA_URL=http://grafana:3000`，SA Token 认证，仅绑 `127.0.0.1:8000`），Caddy 按 `/mcp*` 路径分流到 `https://monitor.wotbtools.com/mcp`；opencode 等 AI 客户端可直接远程连接，无需本地中转容器。本地 `docker/online/docker-compose.yml` 同步增加 `mcp-grafana` 服务（需 `GRAFANA_MCP_TOKEN_FILE`）；生产 `deploy.yml` heredoc 同步增加该服务（需 GitHub Secret `GRAFANA_MCP_TOKEN`，CI 部署时写入 `.env` 并自动拉起，同时清理手动部署的旧容器避免端口冲突）。
- **使用统计 Dashboard（WotBTools 使用统计）**：新增 `wotbtools-usage` 面板，展示前端使用情况——回放解析使用次数与 AI Review 使用次数（按 HTTP 请求计数，含累计/区间/按操作分布/趋势），非全链路内部调用统计。
- **AI Review 单文件上传限制**：`AiReplayBatchPolicy.MAX_FILES` 从 16 改为 1；前端移除 `multiple` 属性、替换（非追加）文件选择逻辑；多文件相关的测试已适配为单文件语义。
- **AI Review 单文件上传限制**：每次只能上传一个 `.wotbreplay`；每次只解析一场战斗；每次 DeepSeek API 调用都是独立请求。
- **DeepSeek 百万上下文支持**：新增 `AiModelProperties` 统一配置（`contextWindowTokens`/`singleReplayMaxInputTokens`/`maxOutputTokens`/`promptSafetyMarginTokens`/`thinkingEnabled`/`reasoningEffort`），环境变量注入，Spring Boot 启动时用 `long` 算术校验 budget 合法性。
- **Token 估算器**：新增 `AiTokenEstimator` 接口与 `ConservativeDeepSeekTokenEstimator` 实现。
- **API usage 追踪**：`ChatCompletionResponse` 新增 `Usage`/`CompletionTokensDetails` record，`call()` 成功后记录 `prompt_tokens`/`completion_tokens`/`reasoning_tokens`/`cache_hit`/`cache_miss` 到日志。
- **思考模式/推理力度配置化**：`thinkingEnabled`、`reasoningEffort` 通过环境变量控制，请求统一使用配置值而非硬编码。
- **可观测系统（第一阶段）**：
  - Backend 接入 Spring Boot Actuator + Micrometer + Prometheus（独立管理端口 `8088`，仅 Docker 内部网络可达，不映射公网）。
  - 结构化 JSON 日志（logstash 格式）；新增 `RequestIdFilter`：请求头继承或生成 `X-Request-ID`、写入 MDC，响应头回写，日志可按 `requestId` 关联。
  - `AiReplayAnalysisService` 由 `System.Logger`（JUL）迁移到 SLF4J，AI 失败日志可带 `requestId`；新增 AI Review 指标（请求量/成功失败拒绝/耗时/并发/错误分类）。
  - 新增 Replay 解析使用指标 `wotb_replay_*`（请求量、文件数、成功失败、耗时、并发），覆盖 preview/export/rating/process/reconstruct。
  - 观测栈容器：Prometheus（7 天/2GiB）、Loki（7 天）、Alloy（采集 backend 日志）、Grafana（provisioning 自动配置 Datasource 与两个 Dashboard：`WotBTools Backend Overview`、`WotBTools Replay Parser`）；固定镜像版本、内存上限合计约 1GB。
  - 所有服务 Docker 日志轮转（json-file 20MB × 3）；观测数据独立 volume，不写入 PostgreSQL。
  - `monitor.wotbtools.com` 子域反代配置（host 级 DNS/TLS 需管理员完成）；`.env.example` 新增 `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD`/`GRAFANA_ROOT_URL`/`OBSERVABILITY_ENVIRONMENT`。
  - 运维文档：`docs/observability.md`。

### Removed
- **生产 Grafana MCP server（P0 安全下线）**：`mcp-grafana` 公网 `/mcp` 存在匿名访问漏洞——SA Token 只是访问 Grafana 的后端凭据、并非调用者认证，未设置 `MCP_GRAFANA_SERVER_TOKEN`/`--server-auth-token` 时匿名 MCP initialize 返回 200 并建立 session。因使用频率低选择彻底下线：生产与本地 compose 移除 `mcp-grafana`；部署链路（`deploy.yml` / `deploy.sh` / `.env`）停止传递 `GRAFANA_MCP_TOKEN`；CI deploy-smoke 新增「生产 compose 不得含 MCP 服务 / 8000 端口」回归断言。生产侧已同步执行（2026-08-11）：移除 `wotb-mcp-grafana-1` 容器、关闭 8000 端口、宿主 Caddy `/mcp*` 改为 `respond 404` 并热重载；Grafana MCP Service Account/Token 与 GitHub Secret 清理为人工步骤（见 `docs/observability.md`）。
- **`/api/replay/reconstruct` 与 `/api/replay/state-at` 端点**：前端简化后已无调用方，一并移除 `ReconstructSummary`/`StateAtResponse` DTO、`ReplayReconstructionService.stateAt()` 与 `SecurityConfig` 对应 matcher。重建能力保留在 core（`BattleStateReconstructor.stateAt(...)` 仍是公共 API），由 `/api/replay/analyze` 内部调用。
- **AI 复盘页重建 UI**：删除 `ReplayReconstructionActions.vue`、`ReconstructionSummaryPanel.vue`、`BattleStatePanel.vue`；`ReplayInputPanel` props 8 → 3、emits 8 → 4；`AnalysisResultPanel` 去掉 `close` 事件与关闭按钮；三语各删 33 个不再引用的 `recon.*` key（29 个因本次简化失效，4 个为历史遗留）。

### Changed
- **随机战 Call #2 走位数据接入 + 团队成员区域序列**：个人路径 Harness 快照新增 `RECORDER_REGION_TIMELINE_BACKEND_COMPUTED`（区域时间线 + 压缩区域序列 1-9 区）与「移动段（压缩）」（时间区间/移动类型/距离/速度/起止区域）——此前 fallback 路径有而 Harness 完全缺失（快照只写了"位置时间线可用"却不展开）；团队路径 `MEMBER_MOVEMENTS` 每个成员新增 `regionSequence`（整场路线压缩序列），复用 `MapRegionResolver` 九宫格约定。走位渲染抽为 `PlayerReplayPromptBuilder.appendRecorderMovementEvidence` 供 Harness 与 fallback 共用。
- **随机战 Call #2 数据增量 + 口语化**：`TacticalReviewPromptBuilder` 关键窗口上限 3→8（TOP PIVOTAL WINDOWS 索引与 CRITICAL DECISION WINDOWS 完整证据同步放宽），新增「对炮明细（ENGAGEMENTS·后端确定性）」段——逐次交火的时间区间、对方昵称（按 battle players 回查）、你输出/损失、结果与置信度；三语语言规则新增语气约束（像资深教练当面复盘：自然口语化、避免模板化套话与机械罗列、数据充分时直接下判断、不处处免责）。940k input 预算下随机战 Call #2 实际 prompt 用量从 ~4.5k tokens 明显提升；仍由 effectiveLimit 兜底裁剪。
- **团队复盘应用 Call #1（赛前战略基线）**：训练房/联赛团队复盘与随机战一样先执行 `PreBattleStrategicService`（地图 + 双方阵容先验，含开局/分路假设），按视角队伍把 prior 重标为 TEAM_A=你的队伍（teamLabel）/ TEAM_B=对方队伍 后注入团队 Prompt（视角队伍为 2 时交换 Call #1 的 TEAM_A/TEAM_B 标签），系统 prompt 新增战略假设逐条判定规则（CONFIRMED / VIOLATED / NOT_OBSERVABLE / IRRELEVANT_AFTER_STATE_CHANGE，ZH/EN/RU）；单队与多队（per-perspective）路径都覆盖。Call #1 失败不阻断团队复盘（仅缺 prior 段）；Team Autopsy 保持结算级（无 prior）。预算沿用整体 deadline（Call #1 45s + 团队复盘剩余预算 + Autopsy min(30s, 剩余-margin)）。
- **Grafana 升级 11.4.0 → 11.6.16**：生产与本地 compose、`docs/observability.md` 组件表同步镜像版本；升级前已备份 `grafana_data` 卷（`/opt/wotb/backups/grafana/`）。11.6 无影响本项目的 breaking changes（未使用 API key；provisioning/dashboard schema 兼容）。
- **AI Review 未成功次数零值回退修复（PR #44）**：`wotbtools-usage` Dashboard「未成功次数」面板改为两个独立 Target （failure / rejected，各带 `or vector(0)` 与固定 legend），修复原 `sum by (result) ... or vector(0)` 因标签集合不匹配 在无数据时产生无标签 0 序列的问题；无数据时明确显示 failure 0 / rejected 0，两类结果保持独立。
- **使用统计 Dashboard 统计口径修正（enhance-monitor）**：移除误导性「累计」字段（Counter 在 Backend 重启后归零，非历史累计）；全部次数改为所选时间范围估算增量（`increase()` + `round()` + `or vector(0)`，整数显示、无数据显 0）；回放预览次数仅统计 `operation="preview"`；新增「AI Review 成功次数」与「未成功次数」（failure/rejected 独立标签）；文档补充统计口径与 7 天保留说明。
- **AI 战术复盘按钮样式**：`ReplayAnalysisAction` 主按钮补充 scoped CSS，与 `btn-primary` 主题一致（accent 强调色、双主题变量、hover/active/disabled 状态），修复按钮缺样式问题。
- **AI Review 指标移到服务边界（PR #43）**：指标从 `AiReplayAnalysisService.call()`（按上游调用）移到 `AiReplayReviewService.analyze()`（一次 HTTP = 一次 Review）；`call()` 仅保留 upstream 请求量/耗时/错误分类。新增 `wotb_ai_review_requests_total`/`results_total{result=success|failure|rejected}`/`errors_total{type=固定枚举}`/`duration_seconds`/`in_flight`。
- **自定义 Timer 启用直方图（PR #43）**：`wotb_ai_review_duration_seconds`/`wotb_ai_upstream_duration_seconds`/`wotb_replay_parse_duration_seconds` 启用 `publishPercentileHistogram()`，Dashboard P50/P95/P99 有真实 `_bucket` 数据；新增 `CustomTimerPrometheusTest` 验证。
- **AI Review 的 Replay 解析计入 Replay 指标（PR #43）**：`/api/replay/analyze` 的 processing 以 `operation=ai_review` 记入 `wotb_replay_*`，不双重统计。
- **RequestIdFilter 显式早于 Security（PR #43）**：加 `@Order(Ordered.HIGHEST_PRECEDENCE)`，401/403 响应也带 `X-Request-ID`；新增 `RequestIdFilterTest`（8 用例）。
- **Loki requestId 顶层字段（PR #43）**：MDC 的 `requestId` 在 logstash JSON 为顶层字段（非 `mdc.requestId`），Dashboard/文档 LogQL 改为 `requestId=~"${requestId:.*}"`；新增 `LogstashMdcTopLevelTest` 实证。
- **Dashboard 补齐（PR #43）**：新增 HTTP Method 分布、2xx/4xx/5xx 分布、AI 成功率/失败率/拒绝率、AI 完整耗时 P50/P95/P99 面板。
- **生产 Grafana Secret 安全化（PR #43）**：CI 将 `GRAFANA_ADMIN_USER/PASSWORD` 写入 `/opt/wotb/.env`（`chmod 600`），compose 用 required-variable 语法引用，密码不落入 compose 文件。
- **CI 增加观测配置验证 job（PR #43）**：`observability-config` 校验 compose/promtool/Loki/Alloy（`fmt -t`）/provisioning YAML/Dashboard JSON/端口映射。
- **CI 端口检查按服务断言（PR #43 跟进）**：prometheus/loki/alloy/grafana/wotb-backend 不得有任何宿主端口映射（直接断言 ports 为空，防 `18088:8088` target 绕过）；frontend `8088:80` 为合法对外入口不在此列。
- **AI upstream 指标语义修正（PR #43 跟进）**：`checkTokenBudget()` 先于指标统计执行；只有检查通过、准备执行 `restClient.post()` 才 +1 `wotb_ai_upstream_requests_total` 并启动 duration Timer；token budget rejection 不产生 request/error/duration。新增 `AiReplayAnalysisServiceUpstreamMetricsTest`（3 用例）。
- **删除误导性 `wotb_replay_results_total`（PR #43 跟进）**：解析失败以 `ReplayProcessingResult.status=FAILED` 返回而非抛异常，异常判定不可靠，删除该指标及 Replay Parser Dashboard「解析失败率」「成功/失败」面板；保留 requests/files/duration/in-flight。AI Review 自己的 results_total 不受影响。
- **Dashboard 变量修正（PR #43 跟进）**：两个 Dashboard 的 Loki 查询 `requestId=~"${requestId:.*}"` → `${requestId:raw}`（textbox 默认仍 `.*`）；删除未被任何查询使用的 `operation` 变量。
- **文档验证边界诚实化（PR #43 跟进）**：删除 `alloy run --dry-run` 与 `fmt --check`（v1.4.2 实际用 `fmt -t`）；明确 CI 仅验证本地 compose 与配置文件语法/结构，不验证生产 heredoc 渲染、不验证指标名真实存在；完整 Alloy/指标验证标注为生产部署后手动项。
- **AI Review 长耗时 Broken pipe 修复**：`deploy/nginx/nginx.conf` 为 `/api/replay/analyze` 增加专用 location（`^~` 前缀优先），`proxy_read_timeout`/`proxy_send_timeout` 提升到 300s，其他 `/api/` 保持 120s 不变；`GlobalExceptionHandler` 新增 cause-chain 断连识别（`ClientAbortException`/`HttpMessageNotWritableException`/`AsyncRequestNotUsableException` 及消息含 "broken pipe"/"connection reset"/"forcibly closed" 的 IOException），断连仅记 WARN、不写错误 JSON、不产生 Unhandled exception ERROR 堆栈；新增 `GlobalExceptionHandlerTest`（12 用例）。
- **AI Review 入口去角色门控**：`App.vue` 移除 `canUseAiReview` 对导航按钮、`allowedViews` 和组件渲染的门控，视图列表改为静态常量（连带移除随之失效的异步鉴权 `watch` 与 `userNavigated`）；登录检查下移到 `ReconstructionPage.onMounted`，未登录调用 `login('reconstruction')`。
- **`useAuth.login(view)` 支持指定回跳视图**：默认仍为 `profile`，个人中心与陪练行为不变。
- **`ReconstructionController` 构造器 3 → 2 参数**：不再注入 `ReplayReconstructionService`；类 Javadoc 修正 —— 原文声称「开发和验证用 / 需 wotbtools-admin」，与 `SecurityConfig` 实际的 `wotbtools-user` 或 `wotbtools-admin` 不符。
- **AI Review prompt 三层预算和精度契约**：actual-size mandatory/high-priority block planning；high-priority block 原子写入；`AiPromptBudgetExceededException` 本地 400 映射；`includedUnitIds`/`omittedUnitIds`/`truncatedUnitIds` 三位 struct；global/per-unit limitation 分离；`AnalyzeResponse` 四类计数（analyzed/omitted/unavailable/total）；multi-partition `PERSPECTIVES_OMITTED_COUNT_<TOTAL>` 聚合；provider body 不落日志（`[PROVIDER_BODY_REDACTED]`）；三语 omission locale。
- **Controller → AiReplayReviewService 分层**：Controller `analyze()` 精简为 `service.analyze(files)`；AiReplayReviewService 接管 validate/process/BatchAnalyzer/AI orchestration；16 → 1 文件 Service boundary。
- **响应 body 安全**：provider error 日志仅含 provider/model/status/code/requestChars/mode/correlationId；provider body 原文不进入日志（统一替换为 `[PROVIDER_BODY_REDACTED]`）；不可信 textual value 不进入日志/异常/API。

### Changed
- **删除 Player/Team 固定 30,000 字符限制**：移除 `MAX_SINGLE_PLAYER_PROMPT_CHARS`/`MAX_INPUT_CHARS`，所有 `MAX_*` 固定 N 条截断（`MAX_MEMBERS`/`MAX_ENGAGEMENTS`/`MAX_MOVEMENTS`/`MAX_KEY_EVENTS`/`MAX_PERSPECTIVES` 等）一并移除。
- **TeamAiPromptBuilder 重构**：`BudgetWriter` 改为 token 估算（`finish()` 接受 `AiTokenEstimator`+`maxInputTokens`），删除字符预算逻辑。
- **全量事件写入**：`appendEventStreamEvidence` 不再有 `movementBudget`/`engagementBudget` 字符预算，所有 movement/engagement/phase/key events 全部写入 Prompt。
- **checkTokenBudget 双层检查**：先检查 `singleReplayMaxInputTokens`（输入预算），再检查 `contextWindowTokens - safetyMargin - maxOutput`（总上下文）。
- **DeepSeek request body 标准化**：所有入口统一使用 `max_tokens`/`thinking`/`reasoning_effort`，值从 `AiModelProperties` 获取。
- **配置字段重命名**：`singlePlayerMaxInputTokens` → `singleReplayMaxInputTokens` 更准确地表示单回放而非单玩家。

### Changed / Fixed
- **AI 复盘时间域/坐标域/证据边界正确性修复（PR #39）**：
  - `buildRelativePhases()` 边界修复：`battleEndRelative` 要求 finite 且 `>=0`（否则返回稳定空 fallback，不再抛异常或生成非法 phase）；引入 `UNKNOWN_FIRST_CONTACT=-1` 语义，`firstContact==0` 视为合法接敌；`openingEnd` 裁剪进 battle end；FIRST_CONTACT 仅在 first contact `finite && >=0 && <=battleEnd` 时创建（消除 `[40,30]` 与 `[0,45]`>battleEnd 场景）。`BattlePhaseSummary` compact constructor 兜底 finite/`>=0`/`start<=end`。
  - Team damage 排除 pre-battle：新增统一 `isPreBattle(event, battleStartRes)` 分类器，准备阶段伤害不再进入 attributed/unattributed、observed aggregate、engagement、first contact、focus fire、key event。
  - Team battle-end 与 fallback clock 转 battle-relative：`findBattleEndEvidence(...)`/`lastObservedClock(...)` 接收并使用 `BattleStartResolution`，replay raw clock 经 `battleRelative(...)` 转换，`battle.durationS` 直接使用不再二次减 start；raw absolute clock 不再泄漏进 phase/key event。
  - `auditPositionEvidence(...)` 真正使用 `BattleStartResolution` 排除 pre-battle 与无效时间戳；`observedPositionEventCount`/`clampedPositionEventCount` 由同一分析集合派生，`TeamFeatureCoverage` 增加 `0<=clamped<=observed` 不变量。
  - 坐标域：`TeamFormationPhase.centroid` 由裸 `Vector3` 改为强类型 `CanonicalMapPosition`；`TeamAiPromptBuilder` 用 `formatCanonicalPosition(...)`（含 region，不再 raw 二次映射），raw 坐标格式化方法重命名 `formatPositionInfo`→`formatRawPosition`；cluster centroid 改为「先对每个成员 resolve/clamp 到 canonical 再求平均」。
  - movement distance/speed 改为 canonical 米：新增共享 `MapRegionResolver.canonicalDistanceMeters(...)`，Player 与 Team member movement 共用；stationary 阈值改名 `STATIONARY_THRESHOLD_METERS`（canonical 米）；无效/倒序/零时间差不再产生 Infinity/NaN 速度；无效时间戳与 INVALID 坐标的位置不参与 movement。
  - 死代码清理：删除 `DefaultTeamBattleFeatureExtractor.rawToCanonical()`/`toCanonicalOrNull()`（合并进共享 helper）、`DefaultPlayerBattleFeatureExtractor` 遗留同包冗余 import。
  - Team damage/position 时间证据统一走单一 `classifyTime()` 分类器（USABLE/INVALID_TIMESTAMP/PRE_BATTLE），供 damage 循环、`teamPositionsByEntity`、`auditPositionEvidence`、phase guard 复用；invalid-timestamp damage 只计 invalid coverage、不再计 unattributed；`timedEvents` 列表改为轻量 `hasUsableTimedEvent` 判定。
  - `MovementSegment` 增加 compact-constructor 不变量（有限/非负/`start<=end`/非空）；坐标字段重命名 `startPosition`/`endPosition` → `rawStartPosition`/`rawEndPosition` 明确 raw 坐标域。
  - 新增回归测试覆盖上述契约（phase 边界、pre-battle 精确伤害 200/first contact 2s、relative battle-end 180/fallback 90、clamped<=observed、敌方位置不计入、canonical cluster centroid 456.2375+CLAMPED status、canonical 距离 100m/速度 20m/s、MovementSegment 非法值拒绝），均能让旧实现失败；`replayBattleEndKeepsItsSourceAndConfidence` 改用非零 battle start，`invalidEventTimestampsAreIgnoredAndReported` 更正为 unattributed=0。
- **AI 能力模型修复**：`ReplayProcessingCapabilities` 改为 scope-independent 事实字段（`summaryAvailable`/`recorderResultAvailable`/`reconstructionAvailable`/`recorderParticipantResolved`/`recorderEntityMapped`/`perspectiveTeamResolved`/`playerFeatureExtractionPossible`/`teamFeatureExtractionPossible`）。`aiAnalyzable` 和 `fullFeatureAnalysisAvailable` 移除，scope 可分析规则位于 `BatchAnalyzer.isAiAnalyzable()`。`recorderEntityMapped` 需匹配 `ParticipantMappingEvent` 的 entityId。
- **AI Prompt 权威 vs 事件流对账**：`buildPlayerContextSummary` 新增权威结算与事件流观测伤害子集的对比输出；交火段数值标记为"观测子集"而非权威总伤害；每个 engagement 输出置信度；Prompt 末尾追加 `limitations` 章节。
- **Duplicate 响应修复**：`ExactReplayDuplicate` 独立记录（含构造期不变量校验），`ExactReplayDuplicateDetector` 独立于 scope 检测精确重复。`duplicateOf` 指向保留的原始文件而非自身。`ReplayFileAnalysisStatus.duplicate()` 保留文件原始 `SUCCESS` 状态不再标记为 `FAILED`。`ReconstructionController` 中 `perspectiveTeam` 使用 `gp.key().perspectiveTeam()` 而非硬编码 0；`failedFileCount` 只统计 `INDEPENDENT_BATTLE + FAILED + error != null`。个人分析入口继续在 recorder 或完整特征不可用时走权威结算 fallback。
- **AI 上游错误与前端本地化**：将 400/401/403/408/413/422/429/5xx、读超时、空响应、畸形 JSON 和非法响应映射为稳定英文错误码；日志只记录模型、状态、请求字符数、模式、关联 ID；provider body 原文不进入日志（统一替换为 `[PROVIDER_BODY_REDACTED]`），不记录 API Key、Authorization 或完整 Prompt。前端 zh/en/ru 只展示本地化错误码，未知后端文本不会直接暴露给普通用户。
- **Team 证据边界修复**：团队位置过滤非法时间戳与明显越界坐标，movement 继承最低位置置信度；未归因 damage/position 分开计数。多场 roster 趋势同时要求至少 75% 有效 accountId 覆盖和 Jaccard `>= 0.60`。不可信文件名、昵称、地图名和证据文本改为 JSON 字符串边界，并在 system prompt 中声明仅为数据。
- **PR CI + streamComplete 诚实化 + 补测试**：新增 `.github/workflows/ci.yml`（仅 `pull_request→main` 触发，已与文档一致），跑后端 `mvn -s settings.xml test` + 前端 `npm ci/test/build`——补上 PR 缺失的自动检查（deploy.yml 仅在 push main 时跑）。`ReplayStreamDiagnostics.streamComplete()` 由恒真算术式改为显式 `reachedPhysicalEnd`（扫描到达物理末尾；超包数/重同步硬上限时读取器直接抛异常，不会返回半截诊断）。补充测试：`stateAt` 时钟回退、`DefaultReplayProcessingFacade`（mode=NONE/能力/去重）、`PositionDecoder`（49B=EXACT、45–48B=PARTIAL、<45=MALFORMED）。（批处理为顺序 for 循环且单文件 ≤ 20 MiB、请求合计 ≤ 200 MiB，无 `parallelStream`，内存/并发风险已受控。）
- **AI 分析支持多文件 + 能力模型 + DI**：`POST /api/replay/analyze` 改为接收 `files[]`（1..N），经统一门面逐文件处理；模式按去重和 perspective 分组后真正可分析的**分析单元数量**判断——0→`NO_BATTLE_DATA`、1→单场深度复盘、≥2→多场趋势复盘（每个单元独立取结算摘要，**不拼接原始事件流**）。`ReplayProcessingCapabilities` 改为 scope-independent 事实字段（`summaryAvailable`/`recorderResultAvailable`/`reconstructionAvailable`/`recorderParticipantResolved`/`recorderEntityMapped`/`perspectiveTeamResolved`/`playerFeatureExtractionPossible`/`teamFeatureExtractionPossible`）。scope 可分析由 `BatchAnalyzer.isAiAnalyzable(result, scope)` 统一计算。`ReplayProcessingResult` 增加 `capabilities` 与 `reconstructionError`。`ReconstructionController` 改为构造器注入。
- **全项目统一 Jackson 3**（`tools.jackson.*`）：`wotb-core` 依赖改为 `tools.jackson.core:jackson-databind`（版本由 Spring Boot 4.1 BOM 托管），`ObjectMapper` 统一 `JsonMapper.builder().build()`，适配 `fields()/fieldNames()→properties()`、`TextNode→StringNode` 等改名；注解包 `com.fasterxml.jackson.annotation` 保持不变。
- **回放代码审查修复**：前端 `/api/replay/*` 统一携带 Keycloak Bearer Token（含 401/403 处理）；`stateAt` 修正时钟回退下漏事件的问题（不再遇首个超时事件即 break）；`PositionDecoder` 截断（<49B）位置包降级为 PARTIAL；`PositionDecoder`/`ProtobufDecoder`/`EntityMethodDecoder` 修正越界与 varint 边界；`EntityPropertyDecoder` 改为解析已确认的 Type 7 结构（entity/prop/valueLen/value），**不臆断血量语义**（逐帧血量为已知限制，见 `docs/replay-data.md`）。

- **完整回放重建处理流水线**：新增 `com.wotb.core.processing` 包（统一单/多文件处理门面），将现有 `ReplayParser` 战绩解析与 `ReplayReconstructionService` 完整重建整合为 `ReplayProcessingResult`；新增 `ReplayProcessingOptions` 控制是否执行重建，普通 preview 不承担额外成本；新增 `ReplayAnalysisMode`（`NONE`/`SINGLE_PLAYER_BATTLE`/`MULTI_PLAYER_BATTLE`/`SINGLE_TEAM_BATTLE`/`MULTI_TEAM_BATTLE`）由后端根据去重后的可分析 perspective 单元数量自动确定。新增 `POST /api/replay/reconstruct-batch`（批量重建）和 `POST /api/replay/process?reconstruct=`（可选重建）端点，需 `wotbtools-user` 或 `wotbtools-admin` 角色（后续统一为与 `/api/replay/analyze` 相同的角色要求）。`com.wotb.core.replay.feature` 已提供玩家与团队两套生产特征模型和 Single/Multi AI context。
- **陪练订单完成确认**：新增 Flyway V11 的完成提交/自动确认时间字段、客户确认接口 `PATCH /api/boost/requests/my/{id}/confirm-completion`、72 小时默认自动确认调度与悲观锁幂等完结路径；客户、管理员和定时任务统一将需求置为 `CLOSED`、分配置为 `COMPLETED` 并释放打手。相关写操作统一锁顺序并重检需求/分配状态，管理员使用显式转换矩阵且不能重开终态，自动确认按订单使用独立事务隔离失败。
- **回放解析资源预算**：ZIP 仅接受标准条目并限制压缩/解压大小；pickle、protobuf 增加长度、栈、opcode、字段数与 varint 边界；单回放名册/战绩最多 64 人，事件流最多 200000 包与 1000000 次扫描（高于已观测约 112K 合法样本）；公开解析任务增加文件数、请求总量与单实例并发限制。
- **生产双库备份恢复**：新增 `wotb`/`keycloak` 部署前备份、每日香港时间 03:15 定时备份、7 日保留、完整归档校验及带显式确认的手动恢复脚本。
- **前端回归测试**：新增 Vitest，覆盖 API 错误码、本地化显示与异步搜索仅接收最新响应。
- **打手自助接单开关**：新增 `PATCH /api/boost/boosters/my/availability`，打手可在个人中心直接暂停或恢复接收新订单；接口返回最新 `BoosterDto`，前端即时刷新当前接单状态。
- **打手历史订单视图**：`GET /api/booster/assignments` 新增可选参数 `includeHistory=true`，个人中心可查看打手的进行中订单和历史订单；默认不带参数仍只返回活跃订单，保持工作台行为不变。
- **生产诊断 Workflow**：新增手动/路径触发的 `prod-diagnostics.yml`，可通过 GitHub Actions 读取线上 compose 状态与后端/前端日志，用于排查 502。
- **站内通知基础版**：新增 `user_notification` 表（Flyway V10）与 `/api/users/notifications` 系列接口，陪练页展示未读通知、列表和一键已读；打手分配、订单状态变化、资格申请通过/拒绝会写入站内通知。
- **陪练订单状态细化**：新增 `ACCEPTED`、`IN_PROGRESS`、`PENDING_CONFIRM`、`EXCEPTION` 订单状态；打手工作台支持接单、开始、提交完成和拒单动作。
- **打手资格申请链路**：新增 `booster_application` 申请表（Flyway V9）、玩家申请 API、管理员资格审批 API；审批通过由 `BoosterService` 编排 `booster_profile` 与 Keycloak `booster` role。
- **潜在场均链路**：`data.wotreplay` 的 direct HP damage 事件会推断击杀目标并填充 `killVictims`，用于 `/extended` 实时 rating 的 `potential_damage_avg`。
- **通用错误码系统**：`ErrorCode` 枚举（`util/ErrorCode.java`），取代 JSON 加载的 `ErrorCodes` 工具类。
- AGENTS.md 规则 19（StringUtils.hasText）、20（优先 Stream）、21（禁止 import \*）、22（Mapper 替代 toXxx）、23（子代理确认 + 完成通知）。
- **Java 后端包重构**：按 domain 分包（`user/` `leaderboard/` `replay/` `boost/` `admin/`），删除旧层分包（`service/` `entity/` `repository/` `mapper/`）。
- **displayName JWT 映射**：`wotbtools-web` client 新增 `display-name-mapper` protocol mapper。
- **打手关联用户**：`booster_profile` 新增 `keycloak_user_id`（Flyway V8）。
- **QQ username 生成**：`{清洗后昵称}-{sha8(socialUid)}` 确保唯一。
- **异常响应契约**：`GlobalExceptionHandler` 统一只返回 `error` + `timestamp`，可读文案由前端三语字典渲染。
- **Keycloak/数据库一致性**：打手创建、换绑、删除与资格审批先 flush 数据库约束，再修改 realm role；事务回滚自动执行反向补偿。管理员删除用户同样先 flush 本地删除，再调用 Keycloak。
- **部署 Workflow 拆分**：`deploy.yml` 改为 3 个独立 build job（按变更路径条件并行构建）。
- **测试包修复**：`src/test/test/` → `src/test/java/`，修正包声明。
- **打手工作台**：新增 `MyAssignmentController` + `GET /api/booster/assignments`，打手查看自己的活跃分配、联系方式、需求状态与分配备注。

### Changed
- **消息通知移至个人主页**：站内通知面板从陪练页（`BoostPage.vue`）迁移至个人中心（`ProfilePage.vue`），右侧栏顶部展示未读小红点，点击展开最近 30 条通知列表，支持单条和全部已读。所有登录用户均可查看通知，不限于打手。
- **资格审批图片按需加载**：玩家与管理员申请列表改用 `BoosterApplicationSummaryDto` 的 JPA 构造投影，查询不再读取两列 Base64 原图；审核状态变更也只返回摘要。管理员点击详情后才调用单条详情接口获取完整资料与截图，缩略图启用浏览器原生延迟解码。
- **Boost API 去本地化**：移除 `*Label`、`message`、`warning`，统一返回 raw enum、`code`/`error` 与 `warningCode`；排行榜跳过原因改为 `reasonCode`。
- **回放 API 值去本地化**：车型、国家、潜在伤害解析状态、存活状态和评分车型系数统一返回稳定英文码，中文仅由前端三语词典与导出层生成。
- **赞助配置外置**：恢复首页赞助入口和三语赞助页面；支付二维码不再进入仓库或镜像，改由 VPS `sponsor-config.json` 与只读静态资源目录在运行时提供。
- **Maven 配置可复现**：跟踪可移植的 `java/settings.xml`，以 `${user.dir}/.m2repo` 隔离依赖，删除失效的桌面构建模板生成流程。
- **安全默认拒绝**：未显式匹配的 `/api/**` 一律拒绝；`boost-manager` 仅能访问 `/api/admin/boost/**`，其他管理员接口只允许 `wotbtools-admin`。
- **CI/CD 门禁与增量检测**：后端测试、前端测试和构建通过后才构建镜像；变更检测改用完整 push range，并覆盖评分、地图、公共资源和部署脚本。
- **测试依赖统一**：Testcontainers 模块统一到 2.0.5 命名与版本，移除 `spring-boot-starter-test` 已包含的重复依赖。
- **地图名三语映射**：`common/map_names.json` 改为 `zh/en/ru` 结构，前端 `mapLabel()` 按当前 locale 渲染，导出层 `MapNames.cn()` 继续固定中文。
- **回放预览列选择持久化**：`useColumns.js` 现在分别记忆单场/汇总列的可见性与顺序，并在响应列集合变化时自动补齐新增列，避免旧缓存导致新列消失。
- **wotb-web 单测执行**：显式启用 Surefire 3.5.0，让 JUnit5 Web/boost 单测实际执行；`WebApiTest` 在无 Docker 环境自动跳过，避免本地测试硬依赖 Testcontainers。
- **扩展 Rating V2 入口**：主 Vue SPA 新增 `?view=extended` 路由，复用独立 `/extended` 的实时 rating 页面，并在首页与顶栏暴露入口。
- **Keycloak 自助注册**：realm 导入配置开启 `registrationAllowed`，注册入口仍由 Keycloak 托管。
- Keycloak 从 26.6.3 升级至 26.6.4。
- **前端视觉系统**：统一 Vue SPA 全局色板、按钮、表格、上传区、顶栏和深浅色变量，改为 Blitz 工具站风格。
- **前端页面打磨**：统一回放解析、排行榜、个人中心、陪练、管理员和扩展页的卡片、表格、按钮、状态徽章和移动端间距。
- **首页最高伤害记录**：首屏伤害 tag 改为读取 `/api/leaderboard/top-damage?page=1&size=1` 的当前最高单场伤害。
- **打手调度体验**：分配弹窗按资格状态、接单状态、活跃订单数、等级和擅长内容推荐打手；打手已有活跃订单时自动显示为忙碌，不再允许继续分配新单。
- 删除未被入口引用的旧 `VersionPage.vue`，版本历史继续由首页 `versions.json` 渲染。

### Fixed
- **资格审批截图查看**：管理员点击战绩截图后改用站内大图层展示，支持遮罩、关闭按钮和 `Esc` 退出；资格申请列表默认筛选按创建时间倒序的待审批记录。
- **打手删除因申请审批记录被误拦截**：`BoosterService.deleteById` 锁定打手后仅以任意订单分配历史阻止硬删除；`booster_application.approved_booster_id` 会先解除引用，审批记录保持 `APPROVED` 状态。
- **管理员删除用户联动打手档案**：删除用户前先锁定本地用户资料并清理其无订单分配历史的打手档案；打手创建/换绑复用同一用户行锁，避免并发产生孤立档案。若存在分配历史则返回 `BOOSTER_HAS_DEPENDENCIES`；其他打手清理异常会先记录 `FAILED_LOCAL_DELETE` 审计再返回同名错误码，均不会继续删除本地资料或 Keycloak 用户。
- **资格审核通知**：进入 `REVIEWING` 不再误发拒绝通知，只有真实拒绝才发送 `BOOSTER_APPLICATION_REJECTED`。
- **管理员搜索竞态**：忽略已过期的用户搜索响应，选择用户或离开页面时取消待处理结果。
- **后台分页契约与竞态**：Boost 管理页按 Spring `Page.number` 读取当前页，连续筛选/翻页只接受最新响应，避免页码失效或旧结果覆盖。
- **用户删除约束处理**：本地删除显式 flush，数据库依赖冲突不会再发生在 Keycloak 用户已删除之后；Keycloak 删除响应会关闭并校验 HTTP 状态，避免 4xx/5xx 被误判成功。
- **部署拉取失败门禁**：`docker compose pull` 三次重试全部失败后立即终止部署，不再继续使用旧镜像并误报成功。
- **中俄文案修复**：修复损坏为 `????` 的 locale 文案，并补齐 API 错误码、状态与枚举三语映射。
- **打手接单状态空值保护**：`BoosterService.setAvailability(...)` 现在会拒绝 `available=null` 并返回明确的 `BOOSTER_AVAILABILITY_REQUIRED`，避免自助/管理员切换接单状态时把空值写入 `booster_profile`。
- **空白字符串归一化**：`wotb-core` 与排行榜入库统一用 `StringUtils.hasText(...)` 处理录像者、昵称、版本号、地图映射与时间戳，空白字符串不再污染昵称回退、版本入库或触发时间解析异常。
- **线上 502 热修**：站内通知改用 Jackson 3 `tools.jackson` 本地 mapper，避免 Spring Boot 4 不再注入旧 `com.fasterxml.jackson.databind.ObjectMapper` 导致后端启动失败。
- **部署健康检查**：`deploy.yml` 改为等待后端 `/api/health` 真正可访问，失败时输出后端/前端日志，避免容器刚 Started 就误判部署成功。
- **打手状态文案去歧义**：打手管理页把 `booster_profile.status` 明确显示为"资格状态"，把 `available + activeAssignmentCount` 明确显示为"可接单/忙碌/暂停接单"，避免出现"正常 + 不可用"的误读。
- 个人中心补齐陪练身份卡片的三语 i18n key，避免直接显示 `profile.booster*` 原始 key。
- 车辆库更新脚本补全 `alphaDamage`：从 BlitzKit `tanks.pb` 炮/弹模块解析最高等级炮的首发弹伤害，并修正脚本输出路径，避免潜在伤害补增因炮伤为空恒为 0。
- CI/CD 部署：`docker compose pull` 添加 3 次重试。
- 前端 nginx 增加 UTF-8 charset。
- Keycloak `check-sso` 配置 `silentCheckSsoRedirectUri`，避免公共首页本地预览被静默登录流程整页跳转。
- 回放解析评分徽章：最低评分为 `0` 时也正确显示金 shit，且全员同分时不误发最高/最低标记。
- 评分等级颜色：补齐前端 `r-elite` / `r-great` / `r-good` / `r-mid` / `r-poor` 样式，避免评分徽章只显示默认底色。
- 评分规则弹窗：区间符号改为 ASCII，避免终端或浏览器编码异常时出现乱码。
- `/extended` 独立入口补充主题变量，避免扩展分析页脱离主入口时丢失深浅色样式。

### Removed
- 删除已被 `ErrorCode` 枚举取代的 `common/error-codes.json`。
- `MAX_SINGLE_PLAYER_PROMPT_CHARS` 30,000 字符人工限制
- `TeamAiPromptBuilder` 的 `MAX_MEMBERS`/`MAX_ENGAGEMENTS`/`MAX_KEY_EVENTS`/`MAX_FORMATION_PHASES`/`MAX_BATTLE_PHASES`/`MAX_PERSPECTIVES`/`MAX_MOVEMENTS_PER_MEMBER`/`MAX_INPUT_CHARS` 固定截断常量
- Player 和 Team 内旧的字符预算裁剪逻辑（`movementBudget`/`engagementBudget`/`scored` 排序）
- 硬编码的 `thinking=enabled` 和 `reasoning_effort=high`

### Fixed
- **排行榜上传：不支持战斗模式改为 HTTP 400 UNSUPPORTED_BATTLE_TYPE**：原先
  arenaBonusType 不属于 `LeaderboardService.SUPPORTED_BATTLE_TYPES` 的回放以 200 skipped 响应（前端显示"已跳过"），现改为在 SHA-256 / preflight /
  storage / DB 任何持久化之前直接拒绝 → 400 `UNSUPPORTED_BATTLE_TYPE`（复用 GlobalExceptionHandler 统一
  错误格式 `{error, timestamp}`），不落盘、不入库、不产生 orphan 文件；仅无录像者 / 已确定 hash 冲突
  保持 skipped（200）。战斗模式判断收敛为单一事实源 `isLeaderboardSupportedBattleType`（eligibility 与
  recordRecorder 共用），支持 RANDOM(1) + RATING(7)（Rating=7 依据 Jylpah/blitz-tools 外部 replay tooling
  证据 `analyze_wotb_replays.py` `BattleCategorizationList._battle_modes`，`"Rating": 7`；与 1/2/4 真实样本映射一致）。前端 `leaderboardUpload()` 修复 `requireOk(r).json()` Promise bug（先 await
  再读 body，否则 Promise 无 .json 抛 TypeError，被误显示为"网络连接失败"）；新增
  `api_errors.UNSUPPORTED_BATTLE_TYPE` 三语文案（zh/en/ru）。测试：service 层真实 parser + 真实训练房夹具
  （400、storage/DB 零写入）、controller 400 映射、WebApiTest 集成（400 + DB 行数不变 + 无
  .wotbreplay 文件生成）、前端 api.js 回归（200 解析 / UNSUPPORTED_BATTLE_TYPE / 401 上传+下载）与
  LeaderboardPage UX（业务错误文案、uploadOk=false、失败不刷新排行榜；未登录点上传按钮先登录再开文件选择器）。
  生产/本地 compose 显式传入 LEADERBOARD_REPLAY_DIR / LEADERBOARD_REPLAY_MIN_FREE_BYTES（默认保持 /data/replays 与 512MiB）。
- **顶栏响应式修复**：`App.vue` 顶栏增加横向滚动兜底，并在 ≤1080px 时切换为 sticky + flex-wrap（导航换行第二行），屏幕不够宽时不再丢失右侧按钮。
- **赞助页返回入口**：`frontend/homepage/sponsor.html` 顶栏新增「返回」按钮（`history.back()`，无历史时回首页），三语 `back` 文案随页面 i18n 切换。

### Changed
- **修复增量构建与 SHA 镜像不匹配导致的部署阻断**：生产部署从「按路径增量构建」改为**每次统一构建 backend/frontend/keycloak 三个 `sha-<SHA>` 镜像**（避免 compose 引用未构建镜像导致 `docker compose pull` 失败）；新 compose 先写入 `docker-compose.next.yml`，`pull` 成功后才备份 `docker-compose.prev.yml` 并替换正式文件，`pull`/`up`/健康检查失败时恢复上一版，回滚成功保留 `DEPLOYED_SHA` 旧值——pull 失败不再污染正式 compose 与回滚目标。
- **生产部署钉住 Commit SHA + 失败自动回滚**：`deploy.yml` 生产 compose 三个 wotb 镜像由 `latest` 改为钉住 `sha-<SHA>`（short SHA）；部署前把当前 compose 备份为 `docker-compose.prev.yml` 并记录 `DEPLOYED_SHA`；部署后三端健康检查（后端 `/api/health`、前端经 nginx E2E、Keycloak realm 可用性）失败时自动回滚到上一版本并复检，回滚成功同样更新标记，回滚失败保留现场、输出日志并人工介入；`docker image prune -af` 移到健康检查通过/回滚成功之后，失败时不再提前清掉旧镜像；deploy 与备份的 concurrency 统一 `cancel-in-progress: false`，避免回滚中途被新 push 取消；`cleanup-images` 每周清理补充 keycloak 镜像。
- **AI 全链路超时对齐 + 客户端取消**：前端 analyze 请求增加 400s 安全超时与取消按钮（`AbortController` + `correlationId`），超时/取消/页面离开经 `POST /api/replay/analyze/cancel` 通知后端；后端 `AiCancellationRegistry` 中断 in-flight 上游调用并停止重试（稳定错误码 `AI_CANCELLED`），避免为无人等待的响应继续计费；`AiRetryPolicy` 不再重试 `AI_TIMEOUT`（上游可能已计费，重试会重复扣费）；容器 nginx `/api/replay/analyze` 代理超时 360s → 420s 对齐链路（前端 400s < 代理 420s，减少 504）；`AI_CANCELLED` 计入 `wotb_ai_review_errors_total` 可观测。

## [2.0.0] - 2026-06-29

### Changed
- Keycloak 从 26.1 升级至 26.6.3。
- Spring Security 启用 OAuth2 Resource Server JWT 认证，自定义嵌套 claim 提取（realm_access.roles）。
- 移除离线/桌面模式：删除 DesktopLifecycle、--desktop 启动参数、/api/shutdown 端点。
- 合并 @Profile("postgres") 为单一配置，移除双 profile 架构。
- 顶栏响应式优化（768/480px 断点）。

### Fixed
- JWT 角色提取：JwtGrantedAuthoritiesConverter 不支持嵌套 claim，改为手动解析。
- api.js 死代码清理（shutdown/getMe/getWotbAccount/getMyRecords）。
- PostgreSQL 18 volume 挂载路径适配。

## [1.9.0] - 2026-06-28

### Changed
- CI/CD 镜像从 DockerHub 迁移至 GHCR。
- `cleanup-images` workflow 改为清理 GHCR 旧版本（`actions/delete-package-versions@v5`）。
- PostgreSQL 18 volume 挂载点适配。
- 文档（README、java/README、HANDOVER、DEVELOPER_GUIDE）同步镜像路径。

## [1.8.0] - 2026-06-27

### Added
- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- nginx 单 server block，wotbtools.com/replay 合并

### Changed
- 移除 offline 版本。

## [1.7.0] - 2026-06-27

### Added
- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- `common/assets/` 单一来源（logo + favicon）。
- AGENTS.md 新增规则：三语 i18n、数据库迁移、安全、Java final。
- Java 全量 final 审计：局部变量、方法入参一律 `final`。

### Changed
- homepage 目录归入 `frontend/homepage/`。
- AGENTS.md 精简并增强（12 条规则 + 6 条禁止）。

## [1.6.0] - 2026-06-26

### Changed
- 后端删除未使用的 `/api/columns` 和 `/api/leaderboard/records/{id}` 端点（`/api/columns` 后续因列选择器需求恢复，当前仍存在）。

## [1.5.0] - 2026-06-26

### Added
- **AI Review V2.1 — Team Review Quality Gate（ai-review-v2.1-team-quality-gate）**：Team AI 复盘推理质量重构（FACT → TACTICAL INFERENCE → RECOMMENDATION 契约收敛），根因来自真实失败回放（20260817 WildCat SPHT，见 docs/ai-lessons/team-review-causal-overreach-01.md）：
  ① Team Prompt 重构（prompts/team/single.zh.md + TeamPromptLocalizer 三语常量）——删除强制 10 章节与「开局散开=图控/拿视野」危险规则（改为中性行为，证据不足 UNKNOWN）；新增「团队复盘输出结构」（核心结论 / 关键决策窗口 1-3 / 可确认问题 1-3 / 训练建议 1-3 且必须对应可确认问题 / 对方关键威胁可选）与「证据契约」（FACT / SUPPORTED INFERENCE / UNKNOWN / FORBIDDEN：禁止 unsupported 掩体/射界/视野/位置感/必然性/结算→时间线因果/自创精确阈值/残局万能规则/自创车辆角色；禁止硬写「做得好的行为」与凑数量）。
  ② TimelineFocusWindowSelector（wotb-core timeline 域）——从已验证 canonical BattleTimeline 选出 1-3 个信息密度最高的 Focus Window：短时间连续减员（≤20s 合并、>40s 长链按最大间隔拆分）优先，HP swing/点数/首次接敌/交火/存活变化兜底；每个窗口确定性输出 BEFORE/EVENTS/AFTER/OBSERVED FACTS/EVIDENCE LIMITATIONS，不重复 delta、不 future leak；TeamAiContextCompiler.renderFocusWindowsSection 注入 TEAM REVIEW FOCUS WINDOWS 段（与 TACTICAL TIMELINE 同一已验证 timeline）。
  ③ Team Autopsy 归因降级——结算级输出标签「主要战犯/MVP」→「重点复查对象/高贡献者」（prompt + renderSection），新增归因降级规则：仅凭结算与死亡时间不得写成确定战术过错（earlyDeath/weakOutput 只是规则候选）。
  ④ 车辆角色统一来自 backend——prompt 禁止自创「薄皮输出型/前排/肉盾/狙击车」等角色；tankName/vehicleClass/tier 三路径（主复盘/Autopsy/赛前）同源 ReplayDisplayNames，角色语义唯一来源 TankTacticalProfileRegistry。
  ⑤ 测试与回归——TimelineFocusWindowSelectorTest（连续减员窗口/BEFORE-AFTER/正常交火/稀疏证据/确定性/不重叠）、TeamReviewQualityGateContractTest（§13-A 全项 + 三语一致）、TeamFocusWindowsRenderTest、TeamTankRoleConsistencyTest（§13-F）、TeamAutopsyPromptBuilderTest 更新（重点复查对象/高贡献者/归因降级）、AiEvalHarnessTest 新增证据契约断言、golden case team-review-causal-overreach-01.json、真实回放 probe TeamReviewRealReplayProbeTest（common/data 样本自动回归，CI 无样本跳过）；真实回放验证 collapse 窗口 3:1（109–128s，本方 3 死对方 1 死）被选中为 Top Window。
- PostgreSQL 数据库：`postgres:18-alpine`，Flyway 管理 schema 迁移。
- `GlobalExceptionHandler`：统一异常 → JSON 错误响应。
- 部署健康检查：workflow 容器状态轮询。
- 离线版 Docker 分发：`offline/start.bat` + `offline/start.sh`。

### Changed
- 容器拆分：单镜像 → 三服务（postgres + backend + frontend）。
- 项目重构：`offline/` `frontend/` `online/` 移至仓库根。
- 前端重构：抽取 composables + utils，App.vue 缩减 68%。
- 离线版方案：jpackage exe → Docker 镜像分发。
- 数据库 schema 管理：`ddl-auto: update` → Flyway 版本化 migration。
- Hibernate 方言移除：`PostgreSQLDialect` 由 Spring Boot 自动检测。

### Removed
- 旧版 jpackage 离线 exe。
- 旧版单镜像 `Dockerfile`。
- ReplayService 与 LeaderboardService 耦合桥接。
