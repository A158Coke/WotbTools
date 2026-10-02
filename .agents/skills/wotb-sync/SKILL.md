---
name: wotb-sync
description: >
  改回放解析（含上游 WASM pin）、数据列、前端交互、排行榜 schema、auth、i18n 时使用。
  同步检查单：客户端解析/计算 → 列 key → locale JSON → 导出标签 → 测试 → 文档。
  Trigger: 新增列、改解析语义/上游 pin、改表结构、改 i18n、改 Flyway、改 Keycloak。
---

# wotb-sync — 跨层改动检查单（工具无关，单一事实源）

> 本文件是**工具无关**的改动 playbook，供任意 AI coder / 人类贡献者使用，
> 也是本技能的唯一维护点（内容只增删于此）。
> 背景与数据格式见 `docs/DEVELOPER_GUIDE.md`，硬性约定见 `.agents/AGENTS.md`；
> 数据目录单一来源清单见 `common/AGENTS.md`。
>
> **前提**：服务器没有回放解析器（2026-10-02 退役）。解析 = 上游 Rust Core WASM，
> 列/汇总/评分/导出 = 浏览器内 `frontend/src/replay-local/`。

本项目同一份数据要经过**多层多语言**呈现，所以一处改动常需多处同步。下面按"改什么"给出最小步骤。

---

## 黄金法则

- **API 纯英文**：后端 DTO / wire body 只回 `key`(snake_case) + 数据，绝不放中文。
- **显示名分散在两类出口**，改名要全改：
  - 前端（三语 i18n）：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels`（单场）与 `agg_labels`（汇总），**三语都改**。
  - 导出（客户端）：标签在 `frontend/src/replay-local/export/sheets.ts` 的
    `PLAYER_PRESENTATION` / `SUMMARY_PRESENTATION` / `DIMENSION_TITLES`（导出仅中文）。
- **列 `key`（snake_case）单一来源**：`frontend/src/replay-local/compute/columns.ts`；导出表头、
  locale label、Excel 输出都按该 key 对齐，不另起别名。
- **Web 分层**：按 `java/AGENTS.md` 的 domain 分包，域内 `controller → service → repository`；
  controller 只做 HTTP 映射、只调自己域 service，业务逻辑写进 service。新增 endpoint 的业务逻辑
  写进 service。**回放解析 / 汇总 / 导出 / 评分全在客户端**（浏览器 + `frontend/src/replay-local/`），
  `ReplayController` 目前只剩 `/api/health`。
- **改完必过分层验证 + 更新文档**（见末尾）。

---

## 配方 A：给某列改显示名（不动数据）

`key` 不变，只改显示文案。**改这几处，保持一致**：

1. `frontend/src/locales/{zh,en,ru}.json` → `player_labels` 和/或 `agg_labels` 中该 `key` 的值（**三语都改**）。
2. `frontend/src/replay-local/export/sheets.ts` → `PLAYER_PRESENTATION`（单场）或
   `SUMMARY_PRESENTATION`（汇总）中该 `key` 的表头（导出仅中文）。
3. 验证 + 文档。

> 命名约定：辅助伤害=「协助伤害」、承受伤害=「损失血量」、抵挡伤害=「格挡」、击伤敌数=「击伤」；汇总「总X / 场均X」。

## 配方 B：新增一个玩家/汇总数据列（**前端单层**）

1. **列定义**：`frontend/src/replay-local/compute/columns.ts` —— 单场加进 `PLAYER_COLUMNS`，
   汇总加进 `AGGREGATE_CORE_COLUMNS`（联赛维度加进 `compute/league-rating.ts` 的 `LEAGUE_DIM_KEYS`）；
   每条 `{ key(snake_case), num, get }`，数组顺序即展示/API 列顺序。
2. **字段形状与聚合**：输入事实形状在 `frontend/src/replay-local/compute/model.ts`
   （`PlayerResult` / `Battle`）；汇总累计与派生指标（`Agg`、`aggAvg` / `aggHitRate` /
   `aggVehicleUsage`、`computePerformance`、`PerformanceRow`）在 `compute/performance.ts`。
3. **导出表头/标签**：`frontend/src/replay-local/export/sheets.ts` 的 `PLAYER_PRESENTATION` /
   `SUMMARY_PRESENTATION` 各加一条（表头 + Excel 列宽）。漏加会在模块加载期 fail fast
   （`player column presentation missing: <key>`）。样式/写入原语在 `export/spec.ts`，
   值格式化在 `export/format.ts`。
4. **前端三语**：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels`
   补该 key 的三语文案。
5. **默认可见集/分组**：`frontend/src/utils/helpers.js` 的 `DEFAULT_VISIBLE` /
   `AGG_DEFAULT_VISIBLE` / `EXTENDED_ONLY_PLAYER_KEYS` / `COL_GROUP_CAT`（由
   `frontend/src/composables/useColumns.js` 消费）。
6. **golden**：跑 `frontend/src/replay-local/compute/compute.golden.test.ts` 与
   `frontend/src/replay-local/export/export.golden.test.ts`；基线更新流程见
   `frontend/src/replay-local/__golden__/README.md`。
7. 验证 + 文档（含 `docs/DEVELOPER_GUIDE.md` 字段表、`docs/reference/replay-data.md`）。

## 配方 C：改解析逻辑（字段含义/protobuf 字段号）

解析器**不在本仓库**：当前真相是上游 Rust Core WASM，由客户端消费。

1. 改解析/字段语义 → 到**上游** `WoT-Blitz-Agent`（`deploy/agent/source.json:repo`）
   改 Rust Core 并**发版**。
2. 升级 pin：`deploy/agent/source.json` 的 `ref` / `artifact.release` / `artifact.sha256`
   （`scripts/fetch-agent-wasm.sh` 按该文件拉取并校验 sha256）。
3. 客户端按新 facts 形状适配：`frontend/src/replay-local/canonical/facts.ts` 与
   `frontend/src/replay-local/battleFacts.ts`。
4. 更新 golden：`frontend/src/replay-local/__golden__/`（`wasm-results.json` 等）与全部
   `replay-local` golden 测试；流程见 `frontend/src/replay-local/__golden__/README.md`。
5. 验证 + 更新 `docs/reference/replay-parsed-fields.md` / `docs/reference/replay-data.md`。

## 配方 D：纯前端交互/样式

只动前端组件/样式（必要时 `deploy/nginx/nginx.conf`）。不碰后端/导出。改完跑相关
`npx vitest run <related-test-files>`（触到路由/依赖/资产管线再 `npm run build`），并在文档记一句。

## 配方 E：调评分（权重/系数/阈值）

只改 `frontend/src/replay-local/compute/league-rating.ts`：`MAX_DAMAGE` / `MAX_ASSIST` /
`MAX_KILL` / `MAX_EXCHANGE` / `MAX_BLOCKED` / `MAX_SURVIVAL_TRADE` / `MAX_SHOOTING` / `MAX_FINAL`
与内部 `DIM_WEIGHTS`。改完跑 `frontend/src/replay-local/compute/` 的相关测试（最终分仍应 ≤ `MAX_FINAL`）。
> 评分算法说明正文的单一来源是 `docs/WotBTools_League_Rating_V6.md`，由
> `frontend/src/components/RatingDocsPage.vue` 渲染；界面文案在 locale 的 `league.docs_*`
> （`frontend/src/locales/feature-messages.json`，三语）。只有改了**算法说明文字**才需要动这两处。

## 配方 F：增改地图显示名

地图显示名**单一来源**在 `common/map_names.json`，结构为 `内部名(小写) -> { zh, en, ru }`。只改这一个文件即可两端生效：

1. 编辑 `common/map_names.json`（key 用 `meta.json` 里的原始 `mapName`，全小写；值同步补齐 `zh/en/ru`）。
2. 无需改代码：导出层 `frontend/src/replay-local/export/format.ts` 的 `mapNameCn()`（固定中文）与前端
   `frontend/src/utils/helpers.js` 的 `mapLabel()`（按当前 locale）**同源读同一份 JSON**。
3. **docker 部署**：`docker/Dockerfile.business-api`、`docker/Dockerfile.ai-service`、
   `docker/Dockerfile.frontend` 已各自 `COPY common/map_names.json`（注意是 `docker/Dockerfile.*`，
   不是 `deploy/Dockerfile.*`）。若以后前端再 import 新 `common/*.json`，在对应 Dockerfile 加 `COPY`。
4. 验证（改前端要 `npm run build`；改 docker 用 `docker compose up --build` 重建）+ 文档。

> 未匹配的地图名原样显示（英文内部名），不会报错。API 始终回原始英文 `mapName`；前端按 locale 渲染，导出固定中文。
> `java/wotb-core/pom.xml` 的 `<includes>` 仍含 `map_names.json`（服务端 `MapNames` 查表用，与客户端导出无关），不要删。

## 配方 G：更新车辆库

更新走 `.github/workflows/update-tankopedia.yml`（手动触发，blitzkit 数据源，自动提交 4 个文件）或本地 `cd common/python && python update_tankopedia.py`（需联网）。产物为 `common/tankopedia-tier{7,8,9,10}.json`（**不是** `tankopedia.json`）；写入前有完整性门禁。Java 构建会自动复制到 classpath，无需手动同步。详见 `common/AGENTS.md`。

---

## 配方 H：名人堂（Hall of Fame）改动（Schema/端点/上传/Admin）

1. **Flyway**：改表结构必须新增**更高序号**的 Flyway 迁移（当前最高 `V27__drop_replay_processing_job.sql`，
   命名 `V<N>__xxx.sql` 且 `<N>` 更大），不改已应用版本。
2. **列对齐**：JPA Entity、DTO、Repository 列与迁移逐列对齐，否则 `ddl-auto: validate` 启动失败。
3. **分层**（真实调用链）：查询端点 `HallOfFameController` → `HallOfFameService` → `HallOfFameRecordRepository`；上传端点 `HallOfFameController` → `HallOfFameUploadService` → `HallOfFameService` → `HallOfFameRecordRepository`（Service 只调自己域的 Repository）；admin 域 `HallOfFameAdminController` → `HallOfFameAdminService`（audit + delete 单事务，ReplayHashLock 串行化文件清理）。
4. **API 纯英文稳定 key**（snake_case）；前端三语 label 在 `locales/*.json` 的 `hof` 与 `hofAdmin` 块。
5. **前端上传/调用**：`api.hofUpload(file)` → `POST /api/hof/upload`；统一查询 `api.hofList(params)` → `GET /api/hof`；新增端点同步前端 API 调用函数。
6. **测试 + 文档**：改了 Java 才跑 `mvn -pl wotb-web -Dtest=WebApiTest test`（`WebApiTest` 保留，只覆盖需要真实 PostgreSQL/回放的集成路径）；前端改则跑相关 Vitest；并更新文档。

## 配方 I：新增跨站点状态（主题/语言/偏好）

1. Cookie 写入 `domain=.wotbtools.com`（主页 + 子域名共享），key 命名 `wotbtools-xxx`。
2. 读写函数命名 `readXxx()` / `saveXxx()`，localStorage 作为本地开发回退。
3. 前端三语文案同步更新 `locales/*.json`。

## 配方 J：Extended 扩展页（已退役）

`ExtendedApp.vue` / `frontend/extended.html` / `/extended` 路由与它依赖的服务端端点
（`/api/preview`、`/api/rating` 等）已随服务端解析器一并删除，**不存在可执行步骤**；
不要按旧记忆重建这些入口。

## 配方 K：Auth 改动

1. Keycloak：`auth.wotbtools.com` 独立容器，realm `wotbtools`，client `wotbtools-web`。
2. 前端：`useAuth.js` composable（Keycloak adapter check-sso 游客模式）。
3. 后端：Spring Security Resource Server + `application.yml` JWT 验证。
4. 新表（user/binding）：Flyway migration，`ddl-auto: validate` 验证。
5. 验证 + 文档（WG 登录见 `docs/auth/wargaming-asia-login.md` 与 `keycloak-wargaming-provider/AGENTS.md`）。

## 配方 L：FE ↔ BE HTTP contract

1. 先编辑 `contracts/http/openapi.yaml`，明确 endpoint、status、required/nullable、enum 与 `$ref`；不要把 domain model 或 internal exception 名称直接当 wire authority。
2. 在 `frontend/` 运行 `npm run api:lint`、`npm run api:generate`、`npm run api:check`、`npm run api:fixture`；`src/api/generated/` 产物不手改。
3. 后端用实际 Jackson serialization/MockMvc 测试锁定 wire shape；domain enum 到 wire enum 只通过显式 mapper。旧 persisted artifact 的兼容逻辑只能位于读取边界。
4. 运行受影响的前端 runtime/parser/UI tests 与后端 targeted tests；确认 `204 capability unavailable` 不被当成 `200 schema violation`。

## 验证（改完必跑，分层）

```bash
# 前端（列 / 导出 / 评分 / 组件改动）
cd frontend && npx vitest run <related-test-files>
cd frontend && npm run build        # 仅当触及路由/依赖/Vite/动态 import/资产管线

# Java（只有真的改了 java/ 才需要）
cd java && JAVA_HOME=<JDK 25> mvn -pl wotb-web -am -Dtest=WebApiTest test
```

> 分层验证口径见 `java/AGENTS.md`（Targeted → Module → Full）与 `frontend/AGENTS.md`
> （targeted → feature suite → build）；repository full validation 由 PR CI 的 `CI / Required Gate` 负责。
> JDK 版本是 **25**（不是 21）；系统默认 `java` 可能不是 JDK 25，跑 mvn 必须先把 `JAVA_HOME` 指向 JDK 25。
> 本环境/沙箱可能无法真正监听端口，用 MockMvc 测试（`WebApiTest`）即可，不必起服务。

## 收尾

1. **更新文档**：`docs/DEVELOPER_GUIDE.md` + 相关 `README.md` / `java/README.md`（任何影响界面/导出/数据/构建/用法的改动）。
2. 提交：中文信息，结尾 `Co-Authored-By`。
3. 推送：执行前先 `git remote -v` 确认实际 remote（个人仓库；本机 remote 名/SSH 别名以本机配置为准，不写死）。
