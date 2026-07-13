# HANDOVER — 项目交接 / AI 工具迁移指南

> 本文件是**工具无关**的总入口。无论用哪个 AI coding 工具（Cursor / Copilot / Windsurf / Claude Code / 其它）接手本仓库，先读这一份，再按需深入下面列出的文档。目标读者：接手维护的人或 AI。

---

## 1. 这是什么

从《坦克世界闪击战》(WoT Blitz) 的 `.wotbreplay` 回放里提取战斗结算数据，导出可分析的 Excel，并提供在线预览。一套 Java 核心逻辑，交付 Web 版：

- **Web 版**（Spring Boot + Vue，浏览器上传/预览/导出，已上线 https://wotbtools.com）

在线版支持 Keycloak 认证（游客 + 登录），排行榜，三语 i18n。

---

## 2. 先读这些（文档地图）

| 文档 | 作用 | 何时读 |
|---|---|---|---|
| **本文件 `HANDOVER.md`** | 总入口 + 运维坑 | 最先 |
| [`AGENTS.md`](AGENTS.md) | AI 硬性约定（RULES）| 动手前必读 |
| [`DEVELOPER_GUIDE.md`](DEVELOPER_GUIDE.md) | 架构、目录树、回放格式、字段表、i18n/评分、改动流程 | 改解析/导出/API 前 |
| [`.agents/wotb-sync.md`](.agents/wotb-sync.md) | 跨层改动检查单（配方 A–G）| 增删/改名数据列、改解析/导出/前端时 |
| [`docs/replay-data.md`](docs/replay-data.md) | data.wotreplay 事件流格式、protobuf 字段表、死亡时间推算 | 深入回放格式时 |
| [`docs/rating-system.md`](docs/rating-system.md) | 评分算法细节 | 碰评分时 |
| [`docs/rating-progress.md`](docs/rating-progress.md) | rating 扩展目标、已完成项、缺口与下一步 | 接手 rating 扩展时 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本历史（对外） | 了解发布历史 |
| [`README.md`](README.md) / [`java/README.md`](java/README.md) | 用户向 + 运行/接口/构建 | 跑起来时 |
| [`TODO.md`](TODO.md) | 待办（含已完成收尾记录与下一步）| 找下一步做什么 |

> 注：`AGENTS.md` / `wotb-sync.md` 本就是写给"任意 AI/人"的，不绑定特定工具。迁移到新工具时，把这几份指给它即可。

---

## 3. 架构速览

```
.wotbreplay (zip)
  ├─ meta.json            地图(内部英文名)、版本、时间、录像者…
  ├─ battle_results.dat   Python pickle → (arenaId, protobuf bytes)
  └─ data.wotreplay       BigWorld 事件流（存活时间推算）
        │
   wotb-core (纯 Java 库, 无 Spring)
   parse/ 解析+去重 → stats/ 评分+富化+汇总 → export/ POI 写 xlsx
   ref/ 车辆库+地图名查表 ; model/ 数据模型(record) ; Columns 列定义契约
        │
   wotb-web (Spring Boot)  controller(HTTP) → service(业务) → mapper(→DTO) → dto
        │
   frontend (Vue 3 + Vite, 单文件 App.vue, vue-i18n 三语, Keycloak 认证)
```

完整目录树见 `DEVELOPER_GUIDE.md`。核心包结构（`com.wotb.core`）：`parse / ref / stats / export / model` 子包 + 顶层 `Columns`。Web 侧按 `user / leaderboard / replay / boost / admin` 业务域分包，每个域内部再分 controller/service/entity/repository/dto。

---

## 4. 环境与工具链（关键坑）

- **JDK 21 必需，且系统默认 `java` 可能是 JDK 8。** 跑任何 Maven 命令前必须先设：
  - bash: `JAVA_HOME="/c/Users/<user>/.jdks/jdk-21.0.1"`（本机实测路径，**不是** `C:\Program Files\Java`）
  - cmd: `set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1`
- **Maven 必须带 `-s java/settings.xml`**（该文件已跟踪，使用 aliyun 镜像 + `java/.m2repo`，干净 clone 可直接运行）。容器内用 `java/settings-docker.xml`。
- **Node**：前端 `frontend`，开发端口 5173，构建用 `npm run build`。
- **Python 3 + Pillow**：仅用于 `common/python/update_tankopedia.py`（更新车辆库，需联网）和偶尔的图像处理。

---

## 5. 构建 / 运行 / 测试（确切命令）

```bash
# Java 全量测试
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test

# 前端测试 + 构建
cd frontend && npm test && npm run build

# 本地开发 — 四容器编译启动 (postgres + keycloak + backend + frontend)
cd docker/online && docker compose up -d --build   # 构建 Dockerfile.backend + Dockerfile.frontend, 8088
```

后端没有无数据库 profile。若要测试本地 Keycloak 管理员写操作，需在本地 realm 配置 `wotbtools-admin-api` 服务账号，并在启动 compose 前设置 `KEYCLOAK_ADMIN_CLIENT_SECRET`；普通回放解析可留空。

> **测试夹具**：真实回放断言读取 gitignored 的 `common/data/*.wotbreplay`；新克隆或 CI 无样本时只跳过对应样本测试，其余 parser、service、security、API 契约与 controller 测试仍执行。`WebApiTest` 的 PostgreSQL 集成路径在无 Docker 时条件跳过。

---

## 6. 硬性约定（详见 AGENTS.md，这里是要点）

- **改动即更新文档**（同一次提交）。影响界面/导出/数据/构建/用法的改动，必须同步 `DEVELOPER_GUIDE.md` + 相关 README。
- **API 纯英文**：DTO 只回 raw enum、稳定 `code`/`error` + 数据，**不放 `*Label` 或 `message`**；显示名/错误文案归前端三语 locale。
- **显示名分两类出口**（改列名要全改）：
  - 前端：`frontend/src/locales/{zh,en,ru}.json` 的 `player_labels` / `agg_labels`（**三语都改**）。
  - 导出：`Columns.java`（单场 xlsx）、`AggregateSheets.java`（汇总 xlsx，仅中文）。
- **单一数据源**：`common/tankopedia.json`（车辆库）、`common/rating.json`（评分参数）、`common/map_names.json`（地图三语名）。构建时由 `wotb-core/pom.xml` 复制到 classpath；**勿在模块内放副本**。
- **代码风格**：不可变模型用 `record`；可变模型用公有字段 POJO（**不引入 Lombok**）；局部变量/参数尽量 `final`。
- **分层**：controller 只做 HTTP；业务在 service；core 按功能分包。新 endpoint 的逻辑写进 service。

跨层联动改动（加列/改解析/改评分/改地图名…）务必按 `.agents/wotb-sync.md` 的配方走。

---

## 7. CI/CD 与部署（本会话踩坑最多，重点看）

**流水线**：`.github/workflows/deploy.yml` —— push 到 `main` 命中 `java/**`、`frontend/**`、`common/**`、Dockerfile、Keycloak 或 `deploy/**` 时触发，也支持手动 `workflow_dispatch`：
1. 用完整 push range 判断 backend/frontend/keycloak/deployment 哪些范围变化。
2. 后端 Maven 全测、前端 Vitest + Vite build 通过后，才按需构建三类镜像。
3. SSH 部署前备份 `wotb` 与 `keycloak`，再更新 `/opt/wotb` compose、`pull` + `up -d`。
4. 后端健康检查失败会输出日志并让 workflow 失败。

**必须配置的 GitHub Secrets**（迁移/换仓库时容易漏）：
- `VPS_HOST` / `VPS_USER` / `VPS_PORT` / `VPS_SSH_KEY` —— VPS SSH。
- `KC_ADMIN_PASSWORD` / `DB_PASSWORD` —— Keycloak 与 PostgreSQL 密码。
- `KEYCLOAK_ADMIN_CLIENT_SECRET` —— 后端 Keycloak Admin API 服务账号 secret。

**已知坑 & 现有对策**（改 workflow/Dockerfile 时别踩回去）：
- backend/frontend/keycloak 镜像各推 `sha-<SHA>` + `latest`；当前 VPS compose 使用 `latest`，需要回滚时手工改为对应 sha 标签。
- **VPS 上可能有遗留旧容器占端口** → 部署脚本会先 `docker rm -f wotb-backend wotb-frontend` 腾出 8088，`up -d` 带 `--remove-orphans`。
- **SSH 脚本必须 `set -e`** → 否则 `docker compose up` 失败仍退出 0，Actions「假绿」而站点不更新（本会话真实发生过）。
- **构建上下文是仓库根**（前端 `utils/helpers.js` 跨目录 `import ../../../common/map_names.json`，后端要 `common/*.json`）。仓库根 `.dockerignore` 排除 `**/node_modules`、`**/target`、`**/dist`、`common/data` 等。
- 镜像层用 GitHub Actions 缓存（`type=gha`）加速。
- deploy 与 database-backup 共用 `production-maintenance` concurrency，且 `cancel-in-progress: false`，避免部署与备份互相中断。

**数据库保护**：`.github/workflows/database-backup.yml` 每日香港时间 03:15 备份两库；归档在 `/opt/wotb/backups/{wotb,keycloak}/`，完整读取校验后分库保留 7 天。恢复只允许 SSH 手动执行 `deploy/postgres-restore.sh`，必须传对应目录文件和 `--confirm RESTORE-<database>`；脚本先做安全备份，失败时依赖服务保持停止。

**赞助运行时配置**：二维码不在仓库/镜像内。VPS 使用 `/opt/wotb/config/sponsor-config.json` 与 `/opt/wotb/config/sponsor/{alipay,wechat}.png`，前端容器只读挂载。部署只在配置不存在时写入 `deploy/sponsor-config.example.json` 的 disabled 默认值，绝不覆盖线上二维码；更新二维码无需重建镜像。

> 部署后验证：站点强刷（`Ctrl+Shift+R`，绕开旧 `index.html` 缓存）。若 Actions 绿但站点没变，多半是 VPS 容器/端口或上层缓存问题，去看 `Deploy via SSH` 步骤日志里的 `docker compose` 输出。

---

## 8. Git / 推送（个人项目，勿碰公司基建）

- **远程**：SSH remote `github-personal`，账号 **`A158Coke`**。推送：
  `GIT_SSH_COMMAND="ssh -o ConnectTimeout=15" git push github-personal main`
- **绝不**使用任何公司 token / 凭据。
- **提交信息**：中文，结尾带 `Co-Authored-By`（若工具支持）。
- ⚠️ **提交信息别用 `git commit -m @'...'`** —— 那是 PowerShell here-string，在 **bash** 里 `@` 会变成提交首行（历史里能看到一串以 `@` 开头的提交就是这么来的）。bash 里用普通双引号 `-m "..."` 或多个 `-m`。
- 行尾：仓库混用 LF/CRLF，`git add` 常报 `LF will be replaced by CRLF` 警告，无害。

---

## 9. 领域要点（速记，细节见各文档）

- **回放格式**：zip 包含 3 个文件 —— `meta.json`（战斗信息）+ `battle_results.dat`（pickle + protobuf 战绩）+ `data.wotreplay`（BigWorld 事件流，用于存活时间推算）。字段表见 `docs/replay-data.md`。**不要轻易重命名/删字段**，新字段先进「原始字段」表交叉验证。
- **存活时间**：3 层 fallback（#104 → Damage 伤害事件 → hybrid EntityLeave/Position），详见 `docs/replay-data.md`。
- **评分**：自包含、类 WN8，基准来自"一同计算的这批战斗"（相对分，非绝对天梯）。参数在 `common/rating.json`，前端「评分规则」弹窗 + `GET /api/rating` 实时展示。细节见 `docs/rating-system.md`。
- **数据库**：后端使用 PostgreSQL 18，单一配置始终启用 JPA/Flyway（`ddl-auto: validate`）；本地运行也必须提供数据库与 `POSTGRES_PASSWORD`。Flyway 自动配置依赖 `spring-boot-flyway`。
- **排行榜**：schema 由 Flyway 管理。只记录录像者本人在**随机战斗**（`arenaBonusType==1`）中的单场伤害，去重键 `arena_id+account_id`；由 `POST /api/leaderboard/upload` 显式写入，预览不隐式落库。
- **i18n**：vue-i18n 三语（zh/en/ru），`locales/*.json`；语言持久化在 `localStorage('wotb-lang')`。地图名共享字典 `common/map_names.json` 已接 `zh/en/ru`，网页按当前语言显示，导出仍固定中文。
- **API 端点**：`GET /api/health`、`GET/POST /api/rating`、`POST /api/preview`、`POST /api/export?mode=aggregate|each`；排行榜 `POST /api/leaderboard/upload`、`GET /api/leaderboard/top-damage?page=&size=`、`GET /api/leaderboard/tanks/{tankId}/top-damage?page=&size=`。
- **公开解析边界**：最多 100 个回放、单文件 20 MiB、总请求 200 MiB；单实例默认同时处理 2 个任务。ZIP/pickle/protobuf 还有独立预算，容量满返回 503 `REPLAY_BUSY`。

---

## 10. 给接手的 AI 工具的一句话

> 这是个单人维护的 WoT Blitz 回放分析工具（Java core + Spring Boot + Vue + Keycloak，Web 版）。动手前读 `AGENTS.md` 和 `DEVELOPER_GUIDE.md`；跨层改动按 `.agents/wotb-sync.md` 的配方；Maven 必须 `-s java/settings.xml` 且 `JAVA_HOME` 指向 JDK 21；改完跑 `mvn -s settings.xml test`、`npm test` 和 `npm run build`；提交用中文信息、推 `github-personal`(账号 A158Coke)，push main 即自动部署。
