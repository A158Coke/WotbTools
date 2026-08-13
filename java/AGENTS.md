# java/ — 后端指令（Maven 聚合：wotb-core + wotb-web）

> 仓库级硬约定见 `.agents/AGENTS.md`；环境/命令/部署背景见 `docs/DEVELOPER_GUIDE.md`。

## 构建（全部经 ci.yml / settings.xml 核对）

- JDK 21（CI `java-version: "21"`）；Maven 必须 `-s java/settings.xml`（aliyun 镜像 + 独立 `java/.m2repo`；CI 等价 `-Dmaven.repo.local=.m2repo`）。容器构建用 `java/settings-docker.xml`。
- 全量测试：`cd java && mvn -s settings.xml test`（JAVA_HOME 指向 JDK 21）。

## 模块边界（真实职责）

- **wotb-core**：纯 Java 库，**无 Spring / 无 web 依赖**。包 `com.wotb.core`：`parse/`（解析）、`stats/`、`export/`（POI）、`ref/`（车辆库/地图名查表）、`model/`（record 模型）、`processing/`（统一门面 + 视角解析）、`replay/`（stream/decoder/event/reconstruction/feature/evidence/map）。确定性战斗语义只放这里。
- **wotb-web**：Spring Boot 4（入口 `WotbWebApplication`）。**domain 分包**：`user/ leaderboard/ replay/ boost/ admin/`，每域内 `controller/ service/ entity/ repository/ dto/`（+ `mapper/ enums/ exception/` 按需）；共享的 `config/ util/` 例外。禁止层分包。

## 分层与风格（硬性）

- Controller → Service → Repository：Controller 只调 Service；Service 只调自己域的 Repository 或其他域的 Service（禁止跨域调 Repository）。新 endpoint 逻辑写进 service。
- **Mapper 替代 toXxx**：禁止 Service/Entity 手写 `toDto()/toEntity()`；独立 Mapper 类（泛型接口 `Mapper<E,D>`）集中转换。
- Flyway：改表结构只新增迁移（`V<N>__*.sql`），不改已应用版本；实体列与迁移列逐列对齐。
- `@RequestParam(name="x")` 必须显式写 name；字符串判空统一 `org.springframework.util.StringUtils.hasText`；集合遍历优先 Stream；禁止 `import *`；局部变量/入参 `final`；DI 用构造器注入（禁止 `@Autowired` 字段注入）。
- 不可变模型用 `record`，可变模型用公有字段 POJO（不引入 Lombok）。

## AI Review 边界（wotb-web/.../replay/ai + wotb-core/.../replay）

- 单文件策略：`AiReplayBatchPolicy.MAX_FILES = 1`（仅 `/api/replay/analyze`；`/process`、`/reconstruct-batch` 不受限）。
- 编排归属：`AiReplayAnalysisService` 是**兼容 facade**（无真实编排）；随机战双 Call 在 `TacticalReviewHarness`，团队复盘在 `TeamReplayAnalysisService`，赛前基线 `PreBattleStrategicService`，Team Autopsy `TeamAutopsyService`。
- transport 唯一生产实现：`SpringAiChatGateway`（Spring AI OpenAI-compatible → api.deepseek.com）；业务只依赖 `AiChatGateway` 接口。Prompt 文本单一来源 `wotb-web/src/main/resources/prompts/{player,prebattle,team}/*.zh.md`（`AiPromptLibrary.zh("player/tactical" 等 key)` 按 `classpath:/prompts/<key>.zh.md` 加载，如 `player/fallback`、`player/single`、`player/tactical`、`prebattle/system`、`prebattle/user-header`、`prebattle/confidence-legend`、`team/single`、`team/autopsy`；md 内 ZH 规则片段与 Java 常量逐字一致，否则 EN/RU 替换失效）。
- 超时链：worker 整体 1100s（`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）→ 单次 AI call 315s；SSE `SseEmitter` 1120s 对齐 nginx；改任何一层都要同步 `AiTimeoutChainContractTest` 与 deploy 校验。
- 回放证据语义：位置流（type-10）≠ 点亮（`POSITION_REPORTED/POSITION_STALE` 只是位置覆盖）；炮塔方向 `type-7 propId=2 = u16*360/65536-180` 已证明，勿改编码常量；证据与解码结论见 `docs/replay-reverse-engineering.md` 与 `docs/turret-direction-evidence-notes.md`。
- 探针测试（`*ProbeTest`）可重复运行、无样本自动跳过；本地特殊样本放 `common/data/` 子目录（不进 ParityTest）。
