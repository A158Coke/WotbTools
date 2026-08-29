# java/ — 后端指令（Maven 聚合：wotb-core + wotb-web）

> 仓库级硬约定见 `.agents/AGENTS.md`；环境/命令/部署背景见 `docs/DEVELOPER_GUIDE.md`。

## 构建（全部经 ci.yml / settings.xml 核对）

- JDK 21（CI `java-version: "21"`）；Maven 必须 `-s java/settings.xml`（aliyun 镜像 + 独立 `java/.m2repo`；CI 等价 `-Dmaven.repo.local=.m2repo`）。容器构建用 `java/settings-docker.xml`。
- 全量测试：`cd java && mvn -s settings.xml test`（JAVA_HOME 指向 JDK 21）——**CI authoritative validation**，
  不是每次提交前必跑（见下「测试策略」）。

## 测试策略（Agent 即时验证，Fast Feedback First）

开发过程中禁止无理由重复运行 repository-level full test；按改动层级选择最合适的验证：

- **Targeted**：`mvn -pl <module> -Dtest=<TestClass> test`
  （改单个 class/function/组件，只跑直接相关测试类）。
- **Module**：`mvn -pl wotb-core test` 或 `mvn -pl wotb-web -am test`
  （单模块改动、或一个 feature 的多文件改动，验证该模块/feature 回归）。
- **Full**：`cd java && mvn -s settings.xml test`
  （**CI authoritative validation**，由 PR CI 统一执行；Agent 仅在 Full-test 例外情形运行，例外清单见 `.agents/AGENTS.md`）。

改动时须先声明：`Affected scope`（改了什么/影响哪些模块）→ `Selected validation`（选择哪档）→
`Why`（为什么这一档足够）。禁止无脑执行 full suite。

测试失败处理：先修复失败测试并重跑该测试，禁止每次失败后升级到 full suite；修复完成后跑相关
regression tests 即可，PR CI 负责最终发现遗漏影响。同一任务内若测试已通过且对应代码、依赖代码、
测试配置均未变化，则不得重复运行同一测试。

## 模块边界（真实职责）

- **wotb-core**：纯 Java 库，**无 Spring Web/Boot 与容器注解依赖**（`spring-core` 工具类
  `StringUtils`/`Resource` 允许）。包 `com.wotb.core`：`parse/`（解析）、`stats/`、`export/`（POI）、
  `ref/`（车辆库/地图名查表）、`model/`（record 模型；不得反向依赖上层包）、`replay/`
  （stream/decoder/event/reconstruction/feature/evidence/map/**processing**——统一门面与视角解析
  已并入 replay）。确定性战斗语义只放这里。
- **wotb-web**：Spring Boot 4（入口 `WotbWebApplication`）。**domain 分包**：`user/ hof/ replay/ boost/ admin/`
  （+ `hundred/ mark3/`），每域内 `controller/ service/ entity/ repository/ dto/`
  （+ `mapper/ enums/ exception/` 按需）；共享例外包：`config/`（含 KeycloakAdminUserService）、
  `util/`、`exceptionhandler/`（GlobalExceptionHandler）、`replayfile/`（跨域回放文件存储/锁/DTO）。
  禁止层分包。
- **架构测试（ArchUnit）**：`wotb-core/src/test/java/com/wotb/core/architecture/CoreArchitectureTest.java`
  与 `wotb-web/src/test/java/com/wotb/web/architecture/WebArchitectureTest.java` 随 `mvn test` 自动执行，
  守护上两条边界（依赖方向、domain 分包、禁字段注入/Lombok、顶层包无循环）；改动包结构/跨域依赖时
  必须先保证架构测试全绿。`import *` 不在 ArchUnit 能力内（imports 不进 class 依赖），需另用源码扫描。

## 分层与风格（硬性）

- Controller → Service → Repository：Controller 只调 Service；Service 只调自己域的 Repository 或其他域的 Service（禁止跨域调 Repository）。新 endpoint 逻辑写进 service。
- **Mapper 替代 toXxx**：禁止 Service/Entity 手写 `toDto()/toEntity()`；独立 Mapper 类（泛型接口 `Mapper<E,D>`）集中转换。
- Flyway migration immutability：`src/main/resources/db/migration/V*.sql` 中已经存在于
  base branch 的 versioned migration 是 immutable historical artifact，禁止修改、重命名、删除、
  格式化、更新注释、转换换行或编码；schema 变化只能新增更高版本的 forward-only `V<N>__*.sql`。
  只有在 Git history 证明生产已执行且当前文件发生 checksum drift 时，才允许恢复到 exact deployed blob。
  实体列与迁移列逐列对齐。
- `@RequestParam(name="x")` 必须显式写 name；字符串判空统一 `org.springframework.util.StringUtils.hasText`；集合遍历优先 Stream；禁止 `import *`；局部变量/入参 `final`；DI 用构造器注入（禁止 `@Autowired` 字段注入）。
- 不可变模型用 `record`，可变模型用公有字段 POJO（不引入 Lombok）。

## AI Review 边界（wotb-web/.../replay/ai + wotb-core/.../replay）

- 单文件策略：`AiReplayBatchPolicy.MAX_FILES = 1`（仅 AI 复盘；多文件批量端点 `/process`、`/reconstruct-batch` 已 410，批量分析模式 `MULTI_*` 已删除）。
- 编排归属：`AiReplayAnalysisService` 是**兼容 facade**（无真实编排）；随机战双 Call 在 `TacticalReviewHarness`，团队复盘在 `TeamReplayAnalysisService`，赛前基线 `PreBattleStrategicService`，Team Autopsy `TeamAutopsyService`。
- transport 唯一生产实现：`SpringAiChatGateway`（Spring AI OpenAI-compatible → api.deepseek.com）；业务只依赖 `AiChatGateway` 接口。Prompt 文本单一来源 `wotb-web/src/main/resources/prompts/{player,prebattle,team}/*.zh.md`（`AiPromptLibrary.zh("player/tactical" 等 key)` 按 `classpath:/prompts/<key>.zh.md` 加载，如 `player/fallback`、`player/single`、`player/tactical`、`prebattle/system`、`prebattle/user-header`、`prebattle/confidence-legend`、`team/single`、`team/autopsy`；md 支持 `{{key}}` 占位包含（`AiPromptLibrary` 加载时递归展开，公共规则块在 `prompts/common/*.zh.md` 复用，循环包含 fail loud）；展开后 md 内 ZH 规则片段与 Java 常量必须逐字一致（`PromptRuleContractTest` 强制），否则 EN/RU `.replace` 锚点静默失效、残留中文规则段）。
- 超时链：worker 整体 1100s（`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）→ 单次 AI call 315s；SSE `SseEmitter` 1120s 对齐 nginx；改任何一层都要同步 `AiTimeoutChainContractTest` 与 deploy 校验。
- 回放证据语义：位置流（type-10）≠ 点亮（`POSITION_REPORTED/POSITION_STALE` 只是位置覆盖）；炮塔方向 `type-7 propId=2 = u16*360/65536-180` 已证明，勿改编码常量；证据与解码结论见 `docs/research/replay/protocol.md` 与 `docs/research/replay/turret-direction.md`。
- 探针测试（`*ProbeTest`）可重复运行、无样本自动跳过；本地特殊样本放 `common/data/` 子目录（不进 ParityTest）。
