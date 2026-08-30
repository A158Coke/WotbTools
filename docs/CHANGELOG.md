# 技术版本历史

技术架构、基础设施、CI/CD、重构、代码质量变更。产品功能见 `CHANGELOG-PRODUCT.md`。

## [Unreleased]

### Added
- **Replay Workspace 统一重构（前端）**：把「回放解析 / AI 复盘 / 战局回放」三个彼此隔离的能力页收敛为单一 `ReplayWorkspace`——三个 URL（`?view=replay` / `ai-review` / `battle-playback`）共用同一个组件，仅通过 `initialCapability`（data / ai / playback）区分默认能力 tab，并由 pushState + popstate 形成可 Back/Forward 的 history（返回时 selection / Processing Job 不丢，只恢复 activeCapability）。三个 capability tab 始终可见（不因能力不可用而消失）；选择一次 replay、只创建一个 Processing Job，data / AI / Playback 共享同一 selection 与 `processingJobId + sourceId` Dataset 引用（绝不重传 / 重 parse）。Workspace 持有唯一 `useReplay` 并 `provide('replay')`，其内单一 FileUploader + Processing 面板；`ReplayPage` 作为 data 结果 tab 嵌入（`embedded` prop，隐藏自己的上传器/Processing），并向 Workspace 注册列初始化回调。AI 与 Playback 各持独立 `useCapabilityReplay`（Dataset 状态互不污染），Batch 汇总是 `activeReplay` 显式选择（手机端 batch selector 以 bottom-sheet 呈现）。登录门禁：**整个 Replay Workspace 全部要求登录**——未登录进入任意 replay capability（data / ai / playback）自动跳 Keycloak/OIDC，登录成功后按 redirectUri 回原 capability，不再有「data 匿名解析」；`awaitAuthGate` 先等 Keycloak init 完成再判断 authenticated（auth init race safe，SSO/session 用户不被无谓 `kc.login()` 打断），确认未登录时仅 login 一次。AI 与 Playback 完全业务解耦（仅共享 replay/source/processing dataset，不做 `AI@seek → Playback` 的时间点联动 / 跨 capability 状态 handoff）。Android 外部 replay 改为**完整自动解析**：Native `shouldInterceptRequest` 以 app-owned content:// 安全 URI serve 缓存文件字节 + Web `fetch(pending.uri)` 构造 `File` → 替换 selection → 自动 `startProcessingJob` exactly once（READY 后 data tab 展示结果，绝不自动启动 AI，失败走现有 Processing error/retry）；不再依赖 synthetic input.click()；`consumePendingWhenReady` 只在登录态就绪后消费，`getPendingReplay()==null` 不清零 eligible（warm resume 后 Native 新增 pending 仍可消费，exactly-once 针对单个 pending，不是 composable lifetime），Native `pendingReplayEligible` 保证 Native 端 exactly-once，`window.wotbtoolsOnReplay` 读实际登录态、不以 authenticated=true 默认绕过。删除旧 `ReplayCapabilityPage / AiReviewPage / BattlePlaybackPage` 路由组件及 `replayHandoff` 内存交接（原三套独立页面 / 各自上传器一并下线）。验证：frontend `npm test`（1289 green）+ `npm run build` 通过。

- **Android Launcher 正式品牌图标（前端资产）**：`ic_launcher_foreground` 由「下载箭头 placeholder」替换为 WotBTools 品牌 mark（tank + 柱状图），生成 adaptive-icon foreground（透明背景、content 落在 66% safe zone）与 legacy `ic_launcher` / `ic_launcher_round` 全密度 PNG（品牌深色背景 `#0D1117`，圆角裁切），不再出现白底方块。App 内（WebView）隐藏「下载 Android 版」CTA（App.vue 顶栏 / 用户菜单、HomePage hero / quick-panel，复用 `isAndroidApp()`）。
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
- **Deploy workflow 去重测试优化（CI/CD）**：将「代码质量验证」与「生产部署验证」彻底分离——`deploy.yml` 移除与 PR CI 完全重复的 `test-backend`（`mvn test`）与 `test-frontend`（`npm ci` / `npm test` / `npm run build`）job；`changes` job 收敛为仅计算 `sha-<short>` tag（删去只服务于测试门禁的路径过滤与 backend/frontend 输出），三镜像（backend/frontend/keycloak）仍于每次 main push 确定性构建并推送 GHCR。生产部署验证（compose 渲染校验、`require_env` secret 校验、`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100` 契约、health check / rollback / diagnostics）全部保留。PR CI 测试覆盖未削弱。验证：workflow `actionlint` 静态检查全绿。
- **Testing & CI Fast Feedback 重排（Agent 验证策略）**：把「Agent 每次提交/review 后跑 repository-level full test」改为「Fast Feedback First」分层验证——Agent 默认只跑 targeted / module / feature regression；仓库级 full validation 统一由 PR CI 执行（唯一 authoritative full-test gate）；新增 Full-test 例外清单（用户显式要求 / 改 Maven parent/dependencyManagement/plugin / Node-Vite-Vitest 全局配置 / 跨模块公共 contract / architecture rules / test infra / build infra 无法定位 / CI 不可用需高置信度或 affected scope 无法确定），并要求触发 full 前先声明 Affected scope / Selected validation / Why。同步 `docs/DEVELOPER_GUIDE.md` 与 `java/README.md`；Deploy 延用 PR173（不含测试套件）。PR CI 测试覆盖未削弱。验证：全仓 `rg` 复查无残留 full-test 默认触发、workflow YAML 解析通过。
- **Rating V2 / League V5 雷达统一相对表现标尺、分数明细与缩放**：两套雷达不再把互不等价的评分理论上限直接当作视觉满格；玩家每轴相对当前 Batch/Battle/Global Average 映射，平均固定为规则 75 环，2×平均为 100 强势线，4×为 125，8×以上在不可见 150 上限截断。可见 SVG 只保留 25/50/100 网格与 75 虚线平均环，玩家可进入 100 外侧留白；每个玩家顶点常驻标注对应 0–150 视觉分，明细默认显示玩家/平均分数并可切换回原始玩家值与真实平均。共享组件支持 50%–150% 缩放（10% 步进，只缩放图形，窄屏在雷达区域滚动），V2 桌面抽屉扩大至 560px；顶部接近 150 分时轴名进一步外移，避免与徽标重叠。V2/V4.1/V5 公式、API、排序、Excel 均不变。V5 Rating Profile PNG 与页面复用同一 scale/geometry/score-label 定位并默认输出分数明细，交互缩放不改变固定 PNG 尺寸；League column max 仅控制 raw 模式的 `score / max` 解释，缺失时降级为 raw score，不阻断 raw/reference 完整轴的相对几何。
- **Rating V2 雷达改为右侧选手抽屉**：隐藏管理员灰度页不再把六轴雷达追加到长结果表底部；点击玩家昵称后通过 `Teleport` 打开固定右侧抽屉，桌面/平板保持非模态并可继续点击表格切换玩家，移动端使用遮罩面板。补齐 Esc 关闭、触发按钮焦点回收与 reduced-motion；V2 公式/API、共享雷达几何及 League V5 页面不变。
- **Battle Playback V2 UI 收尾（前端全 V2-only + 删除 Playback 影子层）**：前端 `BattlePlayback.vue` 的
  marker / HP HUD / Details Panel / team HP / 事件 feed 全部消费 canonical V2 事实（`healthAt` /
  `lifeAt` / `positionAtV2` / `orientationAtV2` / `v2VehicleView`），不再回退 legacy
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
