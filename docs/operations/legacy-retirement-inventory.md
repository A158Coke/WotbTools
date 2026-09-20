# 遗留生产资产清理清单（PR J / J1 — inventory only）

> **本文件只做盘点，不做删除。** 由 `docs/current-plan.md` §5 PR J（Legacy Dependency Zero Check）拆出的
> 第一步（J1）。基线：`main` = `9881cfb4`（PR #332 已合并）。
>
> 判定基线来自逐文件核对 + repo-wide 静态扫描（`grep`），不是猜测；
> 每条都给出真实路径与「当前是否仍被引用」的证据。
>
> ⚠️ 扫描口径提醒：从仓库根做内容扫描会跳过 `.github/`（隐藏目录），
> `.github` 必须单独扫 —— 否则会漏掉 `deploy.yml` / `ops-recovery.yml` / `prod-diagnostics.yml` / `ci.yml`
> 里的遗留引用。

---

## 1. 本 PR（J1）的范围与非目标

**范围**：建立分类清单（KEEP / DELETE / ARCHIVE / HUMAN），标注文件路径、当前引用面、
删除风险、以及应归属的后续阶段。

**非目标（本 PR 明确不做）**：

- 不删除任何代码、配置、脚本、测试或文档；
- 不改 runtime 行为，不改 `deploy/tx` 的 cutover 行为；
- 不改 RabbitMQ provider mirror 与其 provisioning gate；
- 不改 PR #332 引入的 E2E 门禁逻辑与 token；
- 不改 DNS / Caddy / Keycloak；
- 不停止、重启或删除任何服务器容器；
- 不触碰任何 volume，不执行 `docker compose down -v`，不改生产数据；
- 不提前执行任何 server cleanup（服务器动作全部由 operator 手工执行）。

**本 PR 的物理改动面**：仅 `docs/`（本文件 + `docs/README.md` 索引 + `docs/CHANGELOG.md` 条目）。
因此 CI 为 docs-only（不触发 validation jobs），对今晚 critical path（PR #332 → RabbitMQ mirror →
rabbitmq/business-api deploy → HoF/Keycloak/E2E → DNS cutover）零影响。

---

## 2. 分类与阶段定义

### 2.1 分类

| 分类 | 含义 |
|---|---|
| **KEEP** | 仍在生产/CI/回滚路径中承担职责，或属计划明确保留物；不动 |
| **DELETE** | 退役后应删除，且删除后无任何路径依赖（或依赖可在同阶段一并移除） |
| **ARCHIVE** | 退役后不再进 runtime，但承担历史/证据/一次性迁移价值；移出主路径或保留存档，不直接删 |
| **HUMAN** | 只能由 operator 决策/执行（服务器动作、破坏性数据动作、凭据轮换、DNS） |

### 2.2 引用面代号

| 代号 | 含义 |
|---|---|
| `RT` | 生产 runtime 路径（部署脚本、compose、镜像构建输入、运行时配置） |
| `CI` | CI / 契约测试 / workflow 断言 |
| `RB` | 回滚路径（`docs/current-plan.md` §10.4 的回滚可行性约束） |
| `OP` | operator 操作单（`docs/current-plan.md` §10） |
| `—` | 当前无引用（扫描零命中） |

### 2.3 建议阶段（**本清单的提案，待你确认**）

`docs/current-plan.md` 的 PR J 只有一个「归零检查」条目，没有 J2–J7 的划分。下表是本清单提出的
**按风险与顺序**拆分；如与你的预期不同，改这一节即可，不影响清单正文。

| 阶段 | 名称 | 性质 | 出口条件 |
|---|---|---|---|
| **J1** | Inventory（本 PR） | repo，docs-only | 清单与本阶段划分获批 |
| **J2** | 门禁解耦 + 归零检查落地 | repo，可在切 DNS 前完成 | `yecao-backend-wireguard-bind` 不再要求退役服务存在；机械归零断言（负向）常驻且能通过 |
| **J3** | Observability 解耦 | repo，**必须早于** Yecao backend 容器停止 | Yecao backend 停掉后 `verify-observability.sh` 仍能 PASS（或明确降级为已批准状态） |
| **J4** | Yecao 应用栈 repo 侧退役 | repo，**必须晚于** DNS + post-cutover 全绿 + 真实用户 smoke | compose/部署脚本/release plan/workflow/测试/文档不再包含遗留应用服务；删后无回滚依赖 |
| **J5** | 容器与卷退役 | **HUMAN**（仓库外，`docs/current-plan.md` §10.3） | 停 → 验证 → 删容器；**卷保留**，卷的处置需单独批准 |
| **J6** | 文档 / 别名 / 命名收口 | repo，docs-first | 运维文档与新拓扑一致；`control-api`/`control_api`/`spring.application.name` 等退役别名有明确结论 |
| **J7** | 归零检查常驻化 + PR J 收口 | repo | 归零检查进入稳定 Required Gate；遗留 token 命中数 = 0 |

**顺序约束（由证据推出，不是偏好）**：

```text
J2 ──┐
     ├─► (operator: 停容器, J5 第一步) ──► (operator: DNS + smoke, PR K) ──► J4 ──► J6 ──► J7
J3 ──┘                                                                        └─► J5 卷处置（单独批准）
```

- **J2 必须早于 J4**：`deploy/tx/deploy.sh` 的门禁 **主动要求** Yecao `wotb-backend` 的
  `10.20.0.2:8087:8087` bind 存在（见 §4.F1）。J4 一旦从 compose 移除该服务，门禁会 FAIL。
- **J3 必须早于 Yecao backend 容器停止**：`deploy/verify-observability.sh` 的 Grafana API helper 与
  Loki canary **跑在 `wotb-backend` 容器内**（见 §4.F2）。容器停掉，观测验证链路就断了。

---

## 3. Inventory 总览

### A. Yecao 遗留应用栈（runtime）

| # | 项 | 路径 | 分类 | 引用面 | 删除风险 | 阶段 |
|---|---|---|---|---|---|---|
| A1 | Yecao `wotb-backend` 服务（含 `10.20.0.2:8087:8087` bind、`replay_data` 卷、全套 `AI_*`/`REPLAY_*`/`HOF_*` env） | `deploy/docker-compose.prod.yml:42-97` | DELETE（窗口内 KEEP） | `RT` `RB` `OP` | **高**：退役期唯一回滚应用；删除即失去 §10.4 回滚能力 | J4（停止在 J5） |
| A2 | Yecao `wotb-frontend` 服务（`127.0.0.1:8088:80`、sponsor/android/assetlinks 只读挂载） | `deploy/docker-compose.prod.yml:124-137` | DELETE（窗口内 KEEP） | `RT` `RB` | **高**：同上 | J4 |
| A3 | Yecao `keycloak` + `postgres`（旧 realm/旧业务库宿主） | `deploy/docker-compose.prod.yml:12-41` | DELETE（窗口内 KEEP） | `RT` `RB` `OP` | **高**：旧业务数据与旧身份的唯一宿主 | J4（容器停止在 J5） |
| A4 | `postgres_data`（旧业务库）/ 旧 Keycloak PG 卷（服务器侧） | 服务器卷，非仓库文件 | HUMAN | `RB` `OP` | **极高**：回滚数据本体；**不得删除** | J5（卷处置单独批准） |
| A5 | Yecao `parser-worker` | `deploy/docker-compose.prod.yml:98-123` | KEEP | `RT` `CI` | — 执行面保留 | — |
| A6 | Yecao MinIO runtime + OpenTofu root | `deploy/docker-compose.minio.yml`、`deploy/minio-deploy.sh`、`infra/tofu/minio/**` | KEEP | `RT` `CI` | — 临时作业对象存储保留 | — |
| A7 | Yecao observability（node-exporter/prometheus/loki/alloy/grafana） | `deploy/docker-compose.prod.yml:138-209`、`deploy/observability/**` | KEEP（内容需改，见 L） | `RT` `CI` | — 栈保留，采集目标要改 | J3 |
| A8 | Yecao 内部网络 `wotb_internal` `172.28.0.0/16` | `deploy/docker-compose.prod.yml:216-222` | KEEP | `RT` `CI` | — | — |

### B. 旧 backend 部署路径 / 旧 WireGuard backend 路由

| # | 项 | 路径 | 分类 | 引用面 | 删除风险 | 阶段 |
|---|---|---|---|---|---|---|
| B1 | Yecao 反向代理配置（5 处 `proxy_pass http://wotb-backend:8087`） | `deploy/nginx/nginx.conf:130,149,160,171,178` | DELETE | `RT` `CI` | **中**：它被 **bake 进 frontend 镜像**（`docker/Dockerfile.frontend:23`），且是 `release_plan.py` 的 `FRONTEND_PATTERNS` 输入 —— 删它要同步镜像构建语义 | J4 |
| B2 | Yecao frontend 的 assetlinks 静态资源（仅被退役的 `wotb-frontend` 挂载；TX 侧有独立副本 `deploy/tx/assets/auth/.well-known/assetlinks.json`） | `deploy/nginx/assets/auth/.well-known/assetlinks.json` | DELETE（随 A2） | `RT` `CI` | 低：android 路由测试引用它，需与 F3 同阶段收敛 | J4 |
| B3 | 部署期「Yecao bind 契约」标记文件 | `deploy/tx/yecao-backend-contract.json:1-4`（`{"service":"wotb-backend","ports":["10.20.0.2:8087:8087"]}`） | **DELETE（但必须先解耦）** | `RT` `CI` | **高**：它同时承担「这是 promoted TX 布局」的探测（`deploy/tx/pre-cutover-check.sh:46-50`）与退役 bind 断言（`deploy/tx/deploy.sh:1635-1651`）；直接删会让门禁判定逻辑一起坏 | J2（解耦）→ J4（删） |
| B4 | TX 门禁 token `yecao-backend-wireguard-bind` | `deploy/tx/deploy.sh:1616-1651` | DELETE | `RT` | **高**：见 §4.F1 | J2 |
| B5 | 旧 WireGuard backend 路由断言（正例） | `deploy/test-yecao-wireguard-backend.sh:7,22,27` | DELETE | `CI` | 低：纯测试 | J4 |
| B6 | TX upstream 负向断言（禁止 Yecao 地址） | `deploy/test-tx-runtime-config.sh:49,79,226,468`、`deploy/test-pre-cutover-check.sh:378,385` | **KEEP** | `CI` | — 这是「TX 永不路由到 Yecao」的机械证明，退役后仍必须保留 | J7 常驻 |
| B7 | Yecao deploy 选择器与 health/metadata 中的 backend 路径 | `deploy/deploy.sh:128,135,233,256,297,381,487-506,569,585-618,652` | DELETE | `RT` `CI` `RB` | **高**：与 A1/A2/A3 同生共死；`all` 服务集必须同阶段收敛 | J4 |

### C. 已退役 service alias

| # | 项 | 路径 | 分类 | 引用面 | 删除风险 | 阶段 |
|---|---|---|---|---|---|---|
| C1 | 服务别名 `wotb-backend` → 镜像 `wotbtools-backend`（现发布为 `business-api`） | `deploy/release_plan.py:20-29,39,61,74-83`、`.github/workflows/deploy.yml:185,223`、`scripts/ci/test-path-filters.py:137`（负向） | DELETE | `RT` `CI` | **中**：`release_plan.py` 的 `wotb-backend` 是显式 rollback selector；删它须与 A1 同阶段 | J4 |
| C2 | RabbitMQ 身份 `control-api`（控制面已并入 `business-api`，该容器/服务**不再存在**；`deploy/test-tx-runtime-config.sh:704` 甚至把 `http://control-api:8087` 断言为必须拒绝的 foreign host） | `deploy/tx/docker-compose.yml:187`、`infra/tofu/rabbitmq/rabbitmq.tf`、`deploy/test-rabbitmq-tofu.sh:145,273` | KEEP（改名 = HUMAN 决策） | `RT` `CI` | **高**：改名 = Tofu 资源替换 + 口令/ACL 重发 = 凭据轮换；收益仅为命名 | J6（结论进入文档）/ HUMAN |
| C3 | MinIO 身份 `control_api` + business PG 应用角色 `control_api` | `infra/tofu/minio/**`、`infra/tofu/postgres-business/**`、`deploy/tx/docker-compose.yml:171-172` | KEEP（同上） | `RT` `CI` | **高**：同上（Tofu `prevent_destroy` + 密码轮换） | J6 / HUMAN |
| C4 | Spring 应用名 `wotb-backend`（同时是 metrics label 来源） | `java/wotb-web/src/main/resources/application.yml:60` | KEEP（改名须与 dashboard 同步） | `RT` `CI` | **中**：改它会影响 Prometheus/Grafana 的 label 与 CI 断言 | J3/J6 |
| C5 | 模块名 `wotb-web` vs runtime 名 `business-api` | `java/wotb-web/**` | KEEP | `RT` `CI` | — 模块名是代码层 SSOT，不随部署名改 | — |
| C6 | 容器名 `wotb-wotb-backend-1`（compose 项目名 + 服务名派生） | `.github/workflows/prod-diagnostics.yml:33`、`deploy/AGENTS.md`（排障段） | DELETE | `CI` `OP` | 低 | J4 |

### D. Legacy compose entry（逐条）

| # | 服务 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| D1 | `postgres`（旧业务库 + `init-db.sql` 挂载） | `deploy/docker-compose.prod.yml:12-24` | DELETE | `RT` `RB` | 高 | J4 |
| D2 | `keycloak`（旧 realm） | `deploy/docker-compose.prod.yml:25-41` | DELETE | `RT` `RB` | 高 | J4 |
| D3 | `wotb-backend` | `deploy/docker-compose.prod.yml:42-97` | DELETE | `RT` `RB` | 高 | J4 |
| D4 | `wotb-frontend` | `deploy/docker-compose.prod.yml:124-137` | DELETE | `RT` `RB` | 高 | J4 |
| D5 | `health-probe` | `deploy/docker-compose.prod.yml:7-11` | KEEP | `RT` | — TX 有同名独立服务；Yecao 侧观测/验证仍可能需要 | J3 复核 |
| D6 | `parser-worker` / observability 五服务 | `deploy/docker-compose.prod.yml:98-209` | KEEP | `RT` | — | — |
| D7 | 卷声明 `postgres_data` / `replay_data` | `deploy/docker-compose.prod.yml:210-215` | KEEP（声明）| `RB` | **声明可留，卷本体不得删** | J5 |

### E. 旧部署 / 运维脚本

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| E1 | Yecao Ops Recovery（按 `backend`/`frontend`/`keycloak` 回退旧镜像，`backend) compose_service=wotb-backend`） | `deploy/ops-recovery.sh:21,30-32`、`.github/workflows/ops-recovery.yml:12-14,114,150` | KEEP（窗口内）→ DELETE | `RB` `CI` | **高**：这是回滚主线；退役窗口关闭前不得动。TX 侧目前**没有**对应 selector（属计划外/待定） | J4 |
| E2 | Yecao PG 备份/恢复/巡检（`--database wotb`、`--database keycloak`） | `deploy/postgres-backup.sh`、`postgres-restore.sh`、`postgres-backup-inspect.sh`、`.github/workflows/database-backup.yml:30,43-47` | ARCHIVE → DELETE | `RT` `CI` `OP` | **高**：`wotb` 库是旧业务数据快照来源；卷退役前必须保留可恢复性 | J4（脚本）/ J5（卷） |
| E3 | `deploy/init-db.sql` | `deploy/init-db.sql`、被 `deploy/docker-compose.prod.yml:22` 挂载 | ARCHIVE | `RT` | 低（内容为初始化，可留档） | J4 |
| E4 | TX Business PostgreSQL 备份/恢复 | `deploy/tx/business-postgres-backup.sh`、`deploy/tx/business-postgres-restore.sh` | KEEP | `RT` `CI` | — TX 权威库 | — |
| E5 | Grafana API helper（**在 `wotb-backend` 容器内执行**） | `deploy/grafana-api-request.sh`、`deploy/verify-observability.sh:23,35` | KEEP（宿主必须换） | `RT` `CI` | **高**：见 §4.F2 | J3 |
| E6 | `deploy/verify-observability.sh`（含 `wotb-backend` canary 容器、required job 列表） | `deploy/verify-observability.sh:23,35,163,166,173,202-234` | KEEP（内容重写） | `RT` `CI` | **高**：见 §4.F2 | J3 |
| E7 | `deploy/validate-alloy-config.sh`、`deploy/check-flyway-immutability.sh` | 同名文件 | KEEP | `RT` `CI` | — | — |
| E8 | wotb-control POC 资产 | `java/wotb-control/**`、`docker/Dockerfile.control-jvm`、`docker/Dockerfile.control-native`、`tools/control-native-benchmark.sh`、`docs/architecture/control-api.md`、`docs/architecture/control-api-native-benchmark.md` | **KEEP** | `CI` | — 计划 §4.3 约束 5 明确保留为独立可部署物（非生产容器） | — |
| E9 | `deploy/minio-deploy.sh`、`deploy/minio/tofurc`、`deploy/tx/*.tofurc` | 同名文件 | KEEP | `RT` `CI` | — provider mirror 属受保护路径（本 PR 明确不改） | — |

### F. 过期测试 / 契约断言

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| F1 | Yecao 部署契约测试（22 处 `wotb-backend`，含 health probe、204/异常、`all` 集合） | `deploy/test-deploy-contract.sh:12-13,41,123-216,236,270` | DELETE（随 A/B 收敛） | `CI` | **中**：删测试不能先于被测代码删；否则 CI 立刻红 | J4 |
| F2 | WireGuard backend 契约测试 | `deploy/test-yecao-wireguard-backend.sh` | DELETE | `CI` | 低 | J4 |
| F3 | Yecao nginx 测试（限流 / android 路由 / grafana recreate） | `deploy/test-nginx-ratelimit.sh`、`test-nginx-android-route.sh`、`test-nginx-grafana-recreate.sh` | DELETE 或 merge | `CI` | **中**：android 路由的 `assetlinks` 断言仍有价值 → 建议 merge 进 TX 侧断言而非直接删 | J4 |
| F4 | Ops recovery 契约测试 | `deploy/test-ops-recovery.sh` | DELETE（随 E1） | `CI` | 低 | J4 |
| F5 | Observability 契约测试 | `deploy/test-observability-e2e.sh`、`deploy/test-alloy-config.sh`、`deploy/test-grafana-runtime.sh` | KEEP（内容随 J3 改） | `CI` | **中**：canary 依赖 `wotb-backend` 容器 | J3 |
| F6 | Release plan 契约测试 | `deploy/test-release-plan.sh`（17 处 `wotb-frontend`、2 处 `wotb-backend`） | KEEP（断言随映射改） | `CI` | **中**：`wotb-backend` 的 yecao target 断言要同阶段消掉 | J4 |
| F7 | CI observability job 内的静态断言（`up{job="wotb-backend"}` 被写成必然条件） | `.github/workflows/ci.yml:443-530`（`:448`、`:526-529`） | KEEP（内容重写） | `CI` | **高**：它把「Yecao backend 一直在被抓取」固化成不变量 | J3 |
| F8 | CI MinIO 端口断言（`10.20.0.2` + `9000`） | `.github/workflows/ci.yml:627` | **KEEP** | `CI` | — 这是**保留**的 MinIO，不是遗留 | — |
| F9 | `ObservabilityDashboardContractTest` | `java/wotb-web/src/test/java/com/wotb/web/config/ObservabilityDashboardContractTest.java:292` | KEEP（内容随 J3 改） | `CI` | 中：backend 测试面，改 dashboard 必须同步 | J3 |
| F10 | path-filter 契约（负向：配置变更不得选中 `wotb-backend`） | `scripts/ci/test-path-filters.py:137` | **KEEP** | `CI` | — 负向证明，退役后仍要保留 | J7 |
| F11 | build workflow 契约（MinIO 双身份导出） | `deploy/test-build-workflow.sh:226-227` | KEEP | `CI` | — | — |
| F12 | TX 运行时静态契约 | `deploy/test-tx-runtime-config.sh`（13 处 `8087`、7 处 Yecao 地址） | KEEP | `CI` | — 全部为**负向**断言：`yecao-wireguard`（`:701`）、`public-host`、`wrong-port`、`foreign-host`（`control-api`）、`trailing-slash` 都必须被拒绝；退役后仍是「永不回退」的机械证明 | — |

### G. 过期文档

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| G1 | 观测总文档（把 Yecao 描述成生产 backend 宿主：21 处遗留引用，含拓扑图、端口安全表、Loki 查询样例、`docker compose logs wotb-backend`） | `docs/operations/observability.md` | KEEP（**必须重写**） | `OP` | **中**：排障时按它操作会指向已退役服务 | J3/J6 |
| G2 | 观测 runbook（`wotb-backend:8088/actuator/prometheus`、`/opt/wotb` 下 `logs keycloak wotb-backend`） | `docs/operations/observability-runbook.md:15,21,60,67` | KEEP（重写） | `OP` | 中 | J6 |
| G3 | Java 模块 README（描述已退役的「九服务」本地/legacy 栈、`部署等待 wotb-backend`） | `java/README.md:16,44,48,70,272` | KEEP（重写） | `—` | 低：误导性文档 | J6 |
| G4 | 开发者指南中的 Yecao backend 段落 | `docs/DEVELOPER_GUIDE.md:620-627,716` | KEEP（重写） | `OP` | 低 | J6 |
| G5 | deploy 目录指令中的退役窗口说明 | `deploy/AGENTS.md`（§镜像与产物、Gate boundary、排障段） | KEEP（重写） | `OP` | 低：当前是**准确**的（描述退役窗口） | J6 |
| G6 | 技术 CHANGELOG 历史条目 | `docs/CHANGELOG.md` | **KEEP** | `—` | — 历史不改写 | — |
| G7 | 前端本地联调文档（`/api` → `localhost:8087` 仅本地 dev proxy） | `docs/frontend/local-production-dev.md:23` | **KEEP** | `—` | — 与生产拓扑无关 | — |
| G8 | 被取代的 League Rating V5 长文（索引只列 V6；V5 仅出现在 CHANGELOG 历史里） | `docs/WotBTools_League_Rating_V5.md` | ARCHIVE | `—` | 低：**与本退役无关**，属文档卫生 | 独立 PR（非 J） |
| G9 | 性能 / benchmark 记录 | `docs/development/replay-performance-results.md`、`docs/development/ai-virtual-thread-benchmark.md` | KEEP | `—` | — | — |
| G10 | 逆向研究文档树 | `docs/research/**` | KEEP | `—` | — | — |

### H. 仅回滚用途的资产

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| H1 | 回滚顺序与可行性约束 | `docs/current-plan.md` §10.3/§10.4 | KEEP | `OP` | — gitignored 计划文件 | — |
| H2 | Yecao 遗留应用服务（显式选择，不再被推断选中） | `deploy/release_plan.py:20-29,74-83` 注释与映射 | KEEP（窗口内） | `RT` `RB` | 高 | J4 |
| H3 | 退役期显式 selector 说明 | `deploy/AGENTS.md`、`docs/DEVELOPER_GUIDE.md:620` | KEEP（窗口内） | `OP` | 低 | J4/J6 |
| H4 | Ops Recovery workflow 的 legacy service 分支 | `.github/workflows/ops-recovery.yml:14,116` | KEEP（窗口内） | `RB` | 高 | J4 |
| H5 | Yecao `wotb-backend` 上的 `replay_data` 卷挂载（HoF 回放原件回滚副本） | `deploy/docker-compose.prod.yml:95` | HUMAN | `RB` | **极高**：卷本体不得删 | J5 |

### I. 一次性迁移 / bootstrap 脚本

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| I1 | 一次性数据清理工具（hundred/wargaming API） | `tools/cleanup-hundred-wargaming-api.py`、`tools/tests/test_cleanup_hundred_wargaming_api.py` | ARCHIVE | `—` | 低：无 runtime 引用 | J6 或独立 PR |
| I2 | 用户资料影响审计 SQL（**仍在用**，§14.4 的只读 gate 资产） | `deploy/sql/user-profile-reset-audit.sql`、`deploy/test-user-profile-reset-audit.sh` | KEEP | `CI` `OP` | — 受控资产 | — |
| I3 | 地图语义化一次性工具（覆盖式生成） | `map-semanticizer/**` | KEEP | `CI` | — 有 AGENTS 说明 | — |
| I4 | Provider mirror 文件 | `deploy/minio/tofurc`、`deploy/tx/business-postgres.tofurc`、`deploy/tx/rabbitmq.tofurc` | KEEP | `RT` | — | — |
| I5 | Keycloak PG OpenTofu root（TX） | `infra/tofu/postgres-keycloak/**` | KEEP | `CI` | — | — |
| I6 | 本地 AI/OCR 工具夹具 | `scripts/ocr-verify/**`、`docs/ai-lessons/**`、`docs/ai-eval/**` | KEEP | `—` | — | — |

### J. 旧 env / secret 引用

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| J1 | Yecao compose 的运行时 env（`DB_PASSWORD`、`KC_ADMIN_PASSWORD`、`WG_APPLICATION_ID`、`POSTGRES_*`、`KEYCLOAK_ADMIN_*`、`BOOST_*`、`AI_*`、`REPLAY_*`、`HOF_REPLAY_*`） | `deploy/docker-compose.prod.yml:16-93` | DELETE（随 A1） | `RT` `RB` | 高：与回滚栈同生共死 | J4 |
| J2 | `VPS_HOST` / `VPS_USER` / `VPS_PORT` / `VPS_SSH_KEY`（5 个 workflow 共用） | `.github/workflows/{deploy,ops-recovery,database-backup,prod-diagnostics,android-release}.yml` | **KEEP** | `RT` `CI` | — Yecao 仍有 parser-worker/MinIO/observability 与 TX 部署需要 SSH | — |
| J3 | Ops Recovery 的 legacy env 列表 | `.github/workflows/ops-recovery.yml:150` | KEEP（窗口内） | `RB` | 高 | J4 |
| J4 | TX 与 worker 的运行时候选 env（`TX_BUSINESS_*`、`TX_RABBITMQ_*`、`YECAO_MINIO_*`、`PARSER_WORKER_*`、`KEYCLOAK_E2E_*`） | `deploy/tx/docker-compose.yml`、`deploy/docker-compose.prod.yml`、`.env.example` | KEEP | `RT` `CI` | — | — |
| J5 | `YECAO_*` 前缀命名（指向仍在 Yecao 的 MinIO） | `.env.example`、`deploy/tx/docker-compose.yml:169-174` | KEEP | `RT` | — 命名与归属一致，不改 | — |
| J6 | `.env.example` 变量名清单 | `.env.example` | KEEP（随各阶段同步） | `OP` | 低 | J4/J6 |

### K. 过期 health probe

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| K1 | Yecao 部署 gate 的 backend/frontend/keycloak/PG 探测 | `deploy/deploy.sh:487,500-506` | DELETE（随 A） | `RT` `CI` | 高 | J4 |
| K2 | `wait_for_probe backend http://wotb-backend:8088/actuator/health` 契约 | `deploy/test-deploy-contract.sh:12,127,152` | DELETE | `CI` | 中 | J4 |
| K3 | 生产诊断 workflow 的容器 inspect / compose logs | `.github/workflows/prod-diagnostics.yml:29-37` | DELETE 或改指 TX | `OP` `CI` | 低（人工触发） | J4 |
| K4 | TX blocking health（已迁 `business-api`） | `deploy/tx/deploy.sh`（`business-api` probe） | **KEEP** | `RT` | — 已正确 | — |
| K5 | `health-probe` 服务（两侧） | `deploy/docker-compose.prod.yml:7-11`、`deploy/tx/docker-compose.yml:10-14` | KEEP | `RT` | — | — |

### L. 过期 monitoring / observability 引用

| # | 项 | 路径 | 分类 | 引用面 | 风险 | 阶段 |
|---|---|---|---|---|---|---|
| L1 | Prometheus job `wotb-backend` → `wotb-backend:8088` | `deploy/observability/prometheus/prometheus.yml:9-15` | DELETE（或在 J3 换源） | `RT` `CI` | **高**：见 §4.F3 | J3 |
| L2 | Alloy stage.match / relabel `.*wotb-backend.*` | `deploy/observability/alloy/config.alloy:2,17,20-24` | DELETE / 换源 | `RT` `CI` | 高 | J3 |
| L3 | Alloy `wotb-frontend` 采集与 Android APK 过滤 | `deploy/observability/alloy/config.alloy:74,80,87,104` | DELETE / 换源 | `RT` `CI` | 中：Android 下载日志指标仍在用 → 需换到 TX 前端 | J3 |
| L4 | Grafana Production Overview（`up{job="wotb-backend"}` 与 required five jobs） | `deploy/observability/grafana/dashboards/wotbtools-production-overview.json:11,18,54,61,68` | 重写 | `RT` `CI` `OP` | **高**：默认首页；删掉 backend 面板 = 观测能力收缩（设计决策） | J3 |
| L5 | Grafana Error Explorer（默认 service 变量 `wotb-backend`、Loki `{container_name="wotb-backend"}`） | `deploy/observability/grafana/dashboards/wotbtools-error-explorer.json:13,19` | 重写 | `RT` `CI` `OP` | 高 | J3 |
| L6 | Grafana Backend Overview / AI Review / Usage 面板 | `wotbtools-backend-overview.json`、`wotbtools-ai-review.json:24-25`、`wotbtools-usage.json` | 重写 | `RT` `CI` `OP` | 中 | J3 |
| L7 | Grafana Keycloak dashboard（Keycloak 已迁 TX，Yecao Loki 采不到 TX Keycloak 日志） | `deploy/observability/grafana/dashboards/wotbtools-keycloak.json` | 重写 / 重新归属 | `RT` `CI` | 中 | J3 |
| L8 | `verify-observability.sh` 的 required job / Loki canary / backend 容器内 helper | `deploy/verify-observability.sh:23,35,163,166,173,202-234` | 重写 | `RT` `CI` | **高**：见 §4.F2 | J3 |
| L9 | Grafana dashboard API ownership（OpenTofu） | `infra/tofu/grafana/**`、`.github/workflows/grafana-tofu-{plan,apply}.yml` | KEEP（内容随 L4-L7 同步 apply） | `RT` `CI` | 中：dashboard JSON 改完必须走 plan→apply | J3 |

---

## 4. 关键发现（决定阶段顺序的硬约束）

### F1 — TX 只读门禁**主动要求** Yecao legacy bind 存在（`RT`，最高优先级）

`deploy/tx/deploy.sh:1616-1651` 在 `pre_cutover_check` 里：

```text
若 $source_root/deploy/docker-compose.prod.yml 存在 →
    断言 wotb-backend 服务的 ports == ["10.20.0.2:8087:8087"]，否则 yecao-backend-wireguard-bind: FAIL
否则若 $LIVE_DEPLOY_DIR/yecao-backend-contract.json 存在 →
    断言其内容逐字等于 {"service":"wotb-backend","ports":["10.20.0.2:8087:8087"]}，否则 FAIL
否则 FAIL（"Yecao compose or deployed contract is unavailable"）
```

含义：**今天 `PRE_CUTOVER_READY` 的正确性依赖于「退役目标仍然存在」**。这是 PR J「归零检查」的核心悖论：
在门禁解耦之前，任何形式的 Yecao backend 退役都会让门禁 FAIL。
`deploy/tx/yecao-backend-contract.json` 还兼任「promoted TX 布局探测」
（`deploy/tx/pre-cutover-check.sh:46-50`），所以不能简单删除 —— 必须先拆开这两个职责。
→ **J2**。

### F2 — 观测验证链路**运行在** `wotb-backend` 容器内（`RT`）

- `deploy/verify-observability.sh:23` `compose_exec() { docker compose exec -T wotb-backend wget -qO- "$1"; }`
- `:35` 在 `wotb-backend` 内执行 `deploy/grafana-api-request.sh`
- `:202-234` Loki canary 以 `wotb-backend` 起一次性容器并断言 `{container_name="wotb-backend"}` 有日志

含义：Yecao `wotb-backend` 容器一停，**观测验证与 Grafana API 校验同时失效**（非阻塞但会持续
`OBSERVABILITY DEGRADED`）。
→ **J3 必须早于容器停止**（J5 的第一步）。

### F3 — 观测契约把「Yecao backend 一直被抓取」写成不变量（`CI`）

`.github/workflows/ci.yml:448` 断言 Production Overview 面板必须含 `up{job="wotb-backend"}`；
`:526-529` 断言 `required_jobs = "wotb-backend|node-exporter|prometheus|loki|grafana"` 且
`count(...) == 5`；`java/.../ObservabilityDashboardContractTest.java:292` 进一步断言 dashboard 中
**不得**出现 `{container_name="wotb-backend"} | json`。

含义：CI 会在「正确退役」的改动上直接判红。这是**预期的**——它正是 PR J 需要翻转的契约。
**但翻转前需要你做一个设计决策**：TX 上没有 Prometheus/Loki/Alloy（观测栈全在 Yecao），
Yecao 侧退役 backend 后 `wotb-backend` 指标**无处可采**。可选路径：
(a) 从契约中移除此 job（接受 TX 后端无 metrics）；
(b) 在 TX 增开一个被 Yecao 抓取的 metrics 出口（涉及网络面变更，超出计划范围）；
(c) 保留 `wotb-backend` 目标名但指向仍在 Yecao 的等价物（无等价物）。
→ 建议 **(a)**，但这是 `HUMAN` 决策，需你确认后才进 J3。

### F4 — `deploy/nginx/nginx.conf` 不是纯死文件（`RT`）

`docker/Dockerfile.frontend:23` 把它 `COPY` 成镜像内 `/etc/nginx/conf.d/default.conf`，
且 `release_plan.py` 的 `FRONTEND_PATTERNS` 含 `deploy/nginx/**`。
TX runtime 通过挂载 `deploy/tx/nginx/frontend.conf.template` + nginx 模板 entrypoint
**覆盖**它，所以它在 TX 里是惰性的 —— 但删除它仍会改变镜像构建输入。
→ 删除必须与 `FRONTEND_PATTERNS`、`test-build-workflow.sh` 同步；**风险中**，归 **J4**。

### F5 — `control-api` / `control_api` 是「已退役服务的别名」，不是遗留服务

控制面已并入 `business-api`（单运行时），但三处身份仍叫 `control-api`/`control_api`：

- RabbitMQ vhost 身份 `control-api`（`infra/tofu/rabbitmq/rabbitmq.tf`、`deploy/tx/docker-compose.yml:187`）
- MinIO 身份 `control_api`（`infra/tofu/minio/**`）
- business PG 应用角色 `control_api`（`infra/tofu/postgres-business/**`）

改名 = Tofu 资源替换 + 口令轮换 + ACL 重发，收益仅命名。→ 建议 **KEEP**，只在 **J6** 文档中记录
「这是 TX 单运行时的历史命名」。若要改名，属 `HUMAN` 决策的独立凭据轮换任务。

### F6 — `all` 服务集仍包含遗留应用，且 `parser-worker` 被**故意排除**

`deploy/deploy.sh:376-385`：`all` = `postgres keycloak wotb-backend wotb-frontend node-exporter
prometheus loki alloy grafana`（注释明确写「until the legacy Yecao application stack is retired (PR J)」）。
→ J4 必须同时重定义 `all`（并决定 `parser-worker` 是否纳入），否则「全栈部署」会尝试拉起已删服务。

### F7 — 归零检查**已经为零**的那部分（好消息）

以下面已 **0 命中**，说明 PR I/PR H 的收敛是干净的，J7 可以直接把它们固化为常驻断言：

| 面 | 命中 |
|---|---|
| `frontend/src/**` 中的 Yecao host/IP/`wotb-backend` | **0** |
| `android/**` | **0** |
| `contracts/**`（含 `android-native-bridge.json`） | **0** |
| `infra/tofu/**` 中的 `wotb-backend` / `8087` / `/opt/wotb` | **0**（仅 MinIO 端点 `10.20.0.2:9000` 与 Keycloak redirect URI 属保留项） |
| `.github/workflows/**` 中的 `10.20.0.2:8087` / `45.136.14.101` | **0** |
| `deploy/tx/nginx/frontend.conf.template` 中的 Yecao 地址 | **0**（upstream 已固定 `http://business-api:8087`） |
| `deploy/tx/Caddyfile` 中的 Yecao 地址 | **0** |
| `deploy/tx/docker-compose.yml` 中的 8087 发布 | **0**（`tx-internal-api-route` token 已断言） |

**仍非零的只剩三类**：① Yecao 应用栈本体（A/B/D/E/K）；② 观测契约（L/F7/F9）；③ 门禁对 legacy bind 的依赖（F1）。

---

## 5. 风险分级

| 级别 | 含义 | 代表项 |
|---|---|---|
| **极高** | 涉及生产数据/卷，误操作不可逆 | A4（旧 PG 卷）、H5（`replay_data` 回滚副本） |
| **高** | 杀掉回滚路径，或让门禁/观测在生产上失效 | A1-A3、B3/B4/B7、E1/E2、F1/F2/F3、K1 |
| **中** | 需要跨文件同步改动，漏一处即 CI 红或镜像构建变化 | B1、C1、F5、F6、F8、L1-L9 |
| **低** | 纯文本/测试/文档，无 runtime 影响 | B5、C6、F2、G1-G4、I1、K2/K3 |

---

## 6. 当前零依赖证明矩阵（PR J 归零检查的输入）

计划 §5 PR J 列的 8 条检查，逐条落到现在 main（`9881cfb4`）的真实状态：

| 计划里的检查 | 现状 | 命中位置 | 归属阶段 |
|---|---|---|---|
| 无 nginx/Caddy upstream 指向旧 Yecao | ✅ 已零（TX 侧）；❌ 未零（Yecao `deploy/nginx/nginx.conf` 仍指向 `wotb-backend:8087`） | `deploy/nginx/nginx.conf:130,149,160,171,178` | J2 断言 / J4 删除 |
| 无公开 DNS 指向 Yecao | ✅ 仓库不做 DNS 变更；`infra/tofu/environments/prod/lighthouse.tf` 未被本计划修改 | `:1-6,:22-52`（只读快照） | J2 断言常驻；`dig` 属 `HUMAN` |
| 无前端端点依赖 Yecao | ✅ **0 命中** | — | J7 固化 |
| 无 Android 端点依赖 Yecao | ✅ **0 命中** | — | J7 固化 |
| 无定时 workflow 调旧后端 | ✅ `8087` / Yecao host **0 命中**；⚠️ `prod-diagnostics.yml` 仍 `logs wotb-backend` / inspect 旧容器名 | `.github/workflows/prod-diagnostics.yml:33,35` | J2 断言 / J4 改 |
| 无 webhook/callback 指向旧后端 | ✅ `infra/tofu/**` **0 命中**（仅 Keycloak redirect URI，属保留） | — | J7 固化 |
| 无 Keycloak callback 指向旧 Yecao Keycloak | ✅ 未发现（`infra/tofu/keycloak/client.tf:29` 的 redirect URI 指向公开域名，随 DNS 切 TX） | `infra/tofu/keycloak/client.tf:29` | J7 固化 + `HUMAN` 复核 |
| 无 Grafana datasource/alert 依赖被移除服务 | ❌ **未零**：Prometheus job / Alloy stream / 6 个 dashboard / verify 脚本 / CI 断言全部依赖 `wotb-backend` | L1-L9、F7、F9 | **J3** |
| （§14.6 追加）生产部署选中 `jdbc` | ✅ `deploy/tx/docker-compose.yml:166` + 门禁 `distributed-execution-plane` | — | 已在 PR H/I 完成 |
| （§14.6 追加）生产部署选中 RabbitMQ 派发 | ✅ 同上（`WOTB_REPLAY_EXECUTION_MODE=distributed`） | — | 已完成 |
| （§14.6 追加）本地解析显式关闭 | ✅ `application.yml` 正向枚举 + 未知值 fail-fast | — | 已完成 |

> 结论：**8 条里 6 条已经为零**（可直接固化为常驻断言），**2 条未零**正是 F1（门禁依赖）与 F3（观测契约）。

---

## 7. 建议的后续阶段范围

### J2 — 门禁解耦 + 归零检查落地（repo-only，可在切 DNS 前做）

- 拆开 `deploy/tx/yecao-backend-contract.json` 的双重职责：保留「promoted TX 布局探测」，
  把「退役 bind 断言」改为**退役窗口内的条件式记录**（不再要求服务存在；
  且当文件/服务缺失时输出明确 token 而不是 FAIL）。
- 保留并补强所有**负向断言**（`! grep 10.20.0.2:8087` 等），它们是「永不回退」的机械证明。
- 落地计划 §5 PR J 的静态归零检查（复用现有入口：`deploy/test-tx-runtime-config.sh` +
  `scripts/ci/test-workflow-contract.sh`，不新增 standalone 脚本）。
- 出口：门禁在「Yecao `wotb-backend` 从 compose 移除」的 fixture 下仍能 PASS。

### J3 — Observability 解耦（repo-only，**必须早于**容器停止）

- 按 §4.F3 的决策（建议 (a)）重写：`prometheus.yml`、`alloy/config.alloy`、
  `wotbtools-{production-overview,error-explorer,backend-overview,ai-review,usage,keycloak}.json`、
  `verify-observability.sh`（helper 宿主从 `wotb-backend` 换到保留服务）、
  `ci.yml:443-530`、`ObservabilityDashboardContractTest`。
- 经 `grafana-tofu-plan` → `apply` 使 dashboard API 与文件一致。
- 出口：Yecao backend 容器停止后，`verify-observability.sh` 不因缺容器而失败。

### J4 — Yecao 应用栈 repo 侧退役（**必须晚于** DNS + post-cutover 全绿 + 真实用户 smoke）

- 一次性收敛 A1-A3、B1/B3/B5/B7、C1/C6、D1-D4、E1/E2/E3、F1-F4/F6、K1-K3、J1/J3。
- 重定义 `all`（`deploy.sh:376-385`）并同步 `release_plan.py` / `deploy.yml` / `test-*.sh`。
- **前置不可省略**：operator 已完成 §10.3 第 5-7 步（停止→验证→确认健康）。
- 出口：`git grep` 在仓库内对 `wotb-backend` 的**正向**引用为 0（负向断言除外）。

### J5 — 容器与卷退役（HUMAN，仓库外）

- 停容器 → 验证生产健康 → 删容器 → **保留卷** → 卷处置单独批准。
- 涉及：`postgres_data`、旧 Keycloak PG 卷、Yecao `replay_data`（HoF 回放原件回滚副本）。
- 仓库侧不产出脚本（`docs/current-plan.md` D3 约束）。

### J6 — 文档 / 别名 / 命名收口

- 重写 G1-G4 与 `deploy/AGENTS.md`；`docs/README.md` 索引同步。
- 记录 C2-C4 的结论（保留历史命名 + 理由），避免后续误改造成凭据轮换。
- ARCHIVE：G8（League Rating V5）、I1（一次性清理工具）、E3（`init-db.sql`）。

### J7 — 归零检查常驻化 + PR J 收口

- 把 J2 的归零检查并入稳定 Required Gate，断言「遗留 token 命中 = 0」。
- 复跑 §6 的 8 条矩阵作为验收证据；更新 `docs/current-plan.md` 进度表。

---

## 8. 尚未确认 / 需 operator 决策

1. **§4.F3 的观测归属**：TX 无 Prometheus/Loki/Alloy。Yecao backend 退役后 `wotb-backend` metrics
   无处采集。建议从契约移除（接受 TX 后端无 metrics），但这是生产可观测能力收缩，需你确认。
2. **`control-api` / `control_api` 是否改名**（§4.F5）：涉及 Tofu 资源替换与凭据轮换。
3. **`parser-worker` 是否纳入 `all` 服务集**（§4.F6）：目前故意排除，退役后是否恢复为「全栈」。
4. **旧 `postgres_data` / 旧 Keycloak PG 卷 / Yecao `replay_data` 的最终处置时间**：本清单只记录
   「保留」，不提出删除时点。
5. **J2–J7 划分是否符合你的预期**（§2.3 是本清单的提案）。

---

## 9. 附：本清单的扫描口径

- 基线 commit：`9881cfb4`（`main`，PR #332 已合并）。
- 内容扫描：`grep` 覆盖 `deploy/**`、`.github/**`（单独扫）、`docs/**`、`frontend/**`、
  `android/**`、`contracts/**`、`infra/**`、`java/**`、`scripts/**`、`tools/**`、根级配置文件。
- 关键词：`10.20.0.2`、`10.20.0.1`、`45.136.14.101`、`wotb-backend`、`wotb-frontend`、`8087`、
  `8088`、`wotb_internal`、`wotb-wotb-backend`、`yecao-backend-contract`、`TX_BACKEND_UPSTREAM`、
  `control-api` / `control_api`、`/opt/wotb`、`VPS_*`、`prevent_destroy`。
- 逐文件核对（读到行级证据）：`deploy/docker-compose.prod.yml`、`deploy/tx/docker-compose.yml`、
  `deploy/deploy.sh`、`deploy/tx/deploy.sh`、`deploy/tx/pre-cutover-check.sh`、
  `deploy/tx/yecao-backend-contract.json`、`deploy/release_plan.py`、`deploy/nginx/nginx.conf`、
  `deploy/verify-observability.sh`、`deploy/observability/**`、`.github/workflows/{deploy,ci,
  ops-recovery,database-backup,prod-diagnostics}.yml`、`.env.example`、`docs/operations/observability*.md`、
  `java/README.md`、`docker/Dockerfile.frontend`、`docker/Dockerfile.keycloak`。
- 未验证（仓库外）：服务器上的实际容器状态、卷占用、DNS 记录、腾讯云防火墙规则 —— 属 operator 面。
