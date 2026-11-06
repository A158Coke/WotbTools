# deploy/ — 部署与生产指令

> 仓库级硬约定见 `.agents/AGENTS.md`。
> **何时必读本文件**：改动 `deploy/` 下任何 compose / 部署脚本 / nginx / tx 编排 /
> 校验脚本，或改动 `.github/workflows/` 中 production owner 时。
> 运维细节 canonical：`docs/operations/*`（逐节链接见下）、`docs/auth/wargaming-asia-deployment.md`。

## 镜像与产物（硬约束）

- 应用发布必须先冻结完整 source SHA，保留不可变 SHA/tag + registry digest 供
  provenance 与诊断；**Build checkout 必须核对完整 source SHA**。
- business-api 与 frontend 是 digest-pinned 车道：GitHub 只确定 release source/输入，
  Gitee 是国内源码传输，TX 从 exact SHA 本机构建并验证后发布 TCR；
  生产 Compose 必须消费 `repo@sha256:<digest>`
  （`TX_BUSINESS_API_IMAGE_REF` / `TX_FRONTEND_IMAGE_REF`），**禁止回退 `latest`**。
  细节见 [`docs/operations/ci-supply-chain.md`](../docs/operations/ci-supply-chain.md) §5
  与 [`docs/operations/agent-asset-origin.md`](../docs/operations/agent-asset-origin.md)。
- TX 镜像只用 TCR，Yecao 镜像只用 GHCR；TCR registry prefix 必须从
  `vars.TCR_REGISTRY/TCR_NAMESPACE` 传给 host，不可依赖默认 namespace。
- 尚未迁移到 digest pin 的 owner（Keycloak / AI service）沿用各自现有
  `latest`/freshness 契约，不受上述扩展。
- **独立发布闭环**：PR 的 `CI / Required Gate` 是唯一代码验证门禁；
  四个应用 owner（business-api / frontend / keycloak / ai-service）在每次 main push 运行，
  固定基础设施按各自路径触发，手动入口只作用于所属服务。
  **禁止**新增跨服务 planner、reusable Build/Deploy/Tofu DAG、`workflow_run` 链、
  deployment manifest 或 all selector。应用按当前 main 部署，持久状态校验 fail-closed，
  失败不自动回滚。
- **PR 快速上线**：计划已明确且用户要求直接上线时，完成实现后先做
  targeted/static validation 与 `review-with-docs` PASS（覆盖完整 candidate tree），
  再提交、推送并开 PR；Fast path 只跳过本地全量测试重复，不跳过 final gate。
- **TX host lock**：GitHub/脚本内部可继承 `WOTB_DEPLOY_LOCK_FD=9`，
  但 operator / Agent 给人的手工命令必须通过
  `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>` 获取锁；
  **禁止**交互式 SSH 直接 `exec 9>` + `flock`（FD 随 shell 存活，阻断后续部署）。
- Yecao 生产编排 `deploy/docker-compose.prod.yml` + `deploy/deploy.sh`（fail-fast 校验）：
  退役的业务应用（backend/frontend/Keycloak/business PostgreSQL）及
  parser-worker / MinIO / RabbitMQ 必须保持缺席
  （`deploy/test-deploy-contract.sh`、`deploy/test-yecao-wireguard-boundary.sh` 断言）；
  `health-probe` 客户端 Yecao 侧已删除、TX 侧保留为部署探针。
  TX 业务运行时定义在 `deploy/tx/business-api.compose.yml`（由 `deploy/tx/docker-compose.yml`
  汇总）：只承载业务 API，**服务器没有回放解析器**——没有 processing/export job、
  broker 或本地对象存储；app :8087 与 management :8088 绑定 WireGuard `10.20.0.1`。
- 本地完整 Docker Compose 开发环境已退役；Keycloak realm 集成验证仅使用
  `deploy/test-keycloak-tofu.sh` 的 disposable PostgreSQL、Keycloak 与 local OpenTofu state。
- **全业务运行时 E2E**：`deploy/tx/runtime-check.sh` 驱动真实链路并逐项输出
  PASS/FAIL token；任一 FAIL 即 `TX_RUNTIME_NOT_READY`。
  公网边缘只接受受信任 TLS（全程不使用 `-k`）；检查对基础设施与用户数据只读、
  不做付费 AI 调用。改 token、身份或输入必须同步
  `docs/auth/keycloak-tx-bootstrap.md`、`.env.example`、
  `deploy/test-tx-runtime-check.sh` 与 `deploy/test-tx-runtime-config.sh`。

## 边缘与缓存（硬约束）

- 线上边缘配置是 `deploy/tx/nginx/frontend.conf.template`（Caddy 终 TLS 后转
  `wotb-frontend:80`）；镜像内的 `deploy/nginx/nginx.conf` 只是烘焙副本，
  运行时被覆盖，**不得据它判断线上路由**。
- **SPA 缓存策略**：`/index.html` 固定 no-cache/no-store/must-revalidate；
  `/assets/` 与 `/wasm/<40位commit>/` 固定 immutable，且 assets 404 不 fallback 到
  index.html；只锁 40 位 commit 目录。改缓存头影响用户能否看到新前端版本/新引擎，
  改动需在 `?view=hof-admin` 等页验证。
  完整契约见 [`docs/operations/agent-asset-origin.md`](../docs/operations/agent-asset-origin.md)
  「前端边缘 nginx 与 SPA 缓存契约」。

## Komodo / Periphery（硬约束）

- Komodo Core/Mongo 的 bootstrap、升级与 break-glass recovery 归
  `.github/workflows/komodo-controller.yml`；Periphery agent 归 `komodo-periphery.yml`
  （`deploy/periphery/**`）；公网入口归 TX `caddy.yml`。
  细节见 [`docs/operations/komodo-periphery.md`](../docs/operations/komodo-periphery.md)、
  [`docs/operations/komodo-public-ingress.md`](../docs/operations/komodo-public-ingress.md)、
  [`docs/operations/komodo-resource-sync.md`](../docs/operations/komodo-resource-sync.md)。
- **Komodo 不得管理自己的 Core 生命周期**（两容器带 `komodo.skip`）；
  Core 只绑定 Yecao WireGuard `10.20.0.2:9120`，Mongo 不暴露宿主端口；
  **不迁移任何 workload**；**绝不新建独立 Periphery 锁**——lock root/lock 文件属宿主
  deploy owner，缺失即 fail closed。
- 一套 lifecycle + 每宿主一份已评审 profile（`deploy/periphery/targets/<target>/target.env`）；
  脚本内禁止硬编码宿主身份，禁止新增 `*yecao*`/`*tx1*`/`*tx2*` 生命周期脚本。
- Yecao 暂存根只经 `deploy/komodo/staging-root.sh prepare/cleanup` 写入与移除；
  workflow 内禁止内联 `mkdir -p /opt/...` 或未加保护的 `rm -rf`。
- onboarding 完成与否只由 `/etc/komodo/keys/onboarding-complete` 持久 marker 判定，
  **绝不能由 `periphery.key` 推断**；凭据只走
  `KOMODO_PERIPHERY_ONBOARDING_KEY`（临时 env，从不持久化）；
  bootstrap 失败必须删除临时凭据并停止服务。
- **Alibaba asset origin（`ali-sh-asset-01`）不在该自动化链内**：人工 bootstrap 与
  人工生命周期，本仓库不拥有其 systemd/binary/config 生命周期，
  没有 Alibaba SSH secret 或 reusable Periphery workflow；
  触发条件见 `deploy/assets/README.md`。
- asset origin 源固定 `branch = "asset-origin"`；GitHub `asset-origin.yml` 只做
  source transport（GitHub pointer branch → Gitee `asset-origin`），
  绝不触碰共享 Gitee `main`（由 `gitee-mirror.yml` 拥有）。
  见 [`docs/operations/agent-asset-origin.md`](../docs/operations/agent-asset-origin.md)。

## 运维（安全）

- **TX2 production worker（`deploy/production-worker/`）**：归
  `.github/workflows/production-worker.yml`，与 Periphery 生命周期完全分离。
  硬约束：reconcile 幂等，前后断言运行中容器集合不变，**绝不创建 workload**
  （不建 Stack、不改 K6B placement/Caddy/DNS/公网流量、不 prune、不删任何 Docker 对象）；
  复用 TX2 既有 `/opt/wotb-tx2/.deploy.lock`，禁止新建 worker 专用锁；
  产出 `TX2_PRODUCTION_WORKER_READY`（与 TX1 的 `TX_RUNTIME_READY` 不可互换）。
  TX2 Frontend replica 归独立 `frontend-replica.yml` owner。
  细节见 [`docs/operations/tx2-production-worker.md`](../docs/operations/tx2-production-worker.md)。
- **备份**：`.github/workflows/database-backup.yml` 运行 TX owner 的
  `business-postgres-backup.sh` / `keycloak-postgres-backup.sh`，随后备份 TX/Yecao/Komodo
  三个 root 的 local Tofu state（`deploy/tofu-local-state-backup.sh tx|yecao|komodo`）。
  硬约束：normal Deploy 不调用 backup，也不把本地备份描述为 COS；
  Business restore 只允许校验或恢复到 disposable 数据库，**禁止覆盖 authoritative `wotb`**；
  Keycloak 归档不得交给 Business restore 工具。
- **Gate 分层**：blocking production health 只有 Yecao `ai-service` readiness
  （`http://10.20.0.2:8089/actuator/health/readiness`）；业务 API、frontend 与 Keycloak 的
  HTTP/OIDC 探测属 TX deploy。观测栈（Prometheus/Loki/Alloy/Grafana/datasources/
  dashboards/metrics/log ingestion）是 **non-blocking**：Yecao 观测失败只输出
  `OBSERVABILITY DEGRADED`；`deploy/verify-observability.sh` 必须 fail-closed，
  禁止用 `|| true` 改写 verifier 语义。
  校验脚本契约与排障入口见
  [`docs/operations/observability-runbook.md`](../docs/operations/observability-runbook.md)。
- **安全日志 190 天留存是 fail-closed 的跨层契约**：普通 Loki `168h`，
  只有 `{compliance="security"}` 走 `4560h`；标签只由 TX Alloy 的
  `loki.process "compliance"` 产生。
  细节见 [`docs/operations/security-log-retention.md`](../docs/operations/security-log-retention.md)。
- **生产发布在 staged compose pull 后、live promote 前必须运行**
  `validate-alloy-config.sh` 与 `deploy/tx/validate-caddy-config.sh`（fail-closed）；
  校验失败必须在 live mutation 之前退出，禁止 `|| true` 或删除校验绕过。
- **服务 owner workflow 逐个 staging 并执行 readiness**；生产实际镜像必须通过容器
  inspect / artifact metadata 与冻结 source identity 核对。
- secret 一律 GitHub Secrets / Variables → SSH 运行时 env（根 `.env.example` 只列变量名）；
  TX 不维护本地 secret env 文件，禁止落库或写死。
  赞助/收款信息不硬编码进页面或仓库（pin 住的 Release 资产，见
  [`docs/operations/sponsor-runtime-content.md`](../docs/operations/sponsor-runtime-content.md)）。

## TX service-plane boundary（K6A / K6B）

- 公网 HTTP/HTTPS ingress **仅 Caddy**（80/443）；UFW inactive 不允许发布
  service-plane 通配端口。
- WG-only TCP（冻结 baseline）：`10.20.0.1:8081 → frontend:80`、
  `:8087 → business-api:8087`、`:8088 → business-api:8088`、`:8080 → keycloak:8080`、
  `:15432 → keycloak-postgres:5432`、`:25432 → business-postgres:5432`。
  host-local administration / OpenTofu 保留 `127.0.0.1:18080/15432/25432`；
  OpenTofu provider 仍仅使用 loopback。
- 端口不可互换：8081 Frontend、8080 Keycloak、8087 Business API、
  25432 Business PostgreSQL、15432 Keycloak PostgreSQL。
- `runtime-check-lib.sh:assert_tx_service_ports` 是 rendered Compose 精确绑定校验；
  K6B logical endpoint 只有一套 canonical validator（`deploy/tx/deploy.sh` 的
  `validate_http_endpoint` / `validate_database_endpoint` / `validate_caddy_upstream`），
  staged deploy、`deploy/dependency-readiness.sh` 与 runtime gate 共用，
  **禁止各自复制 allowlist 或放宽 rendered 断言**；
  `dependency-readiness.sh` 必须在任何携带 secret 的网络请求之前完成校验。
- runtime gate（`tx-logical-endpoints-declared` / `-active` / `wireguard-service-plane`）
  是**永久基础设施**，不是 migration-only code；只断言 rendered Compose 会产生假绿。
- `K6B_FINAL_PLACEMENT_MATRIX` 是**冻结的 placement baseline**：不要删除、不要弱化为
  contains 检查、不要用 repository variable 取代 reviewed value。
  Docker-local 值是 canonical allowlist 内的紧急 rollback；六条 consumer 回退手册
  （每步只回退一个 consumer，同步 `CURRENT_K6B_CUTOVERS` / `K6B_FINAL_PLACEMENT_MATRIX`
  与 gate 期望，只改一侧必然 FAIL）见
  [`docs/operations/tx-service-plane.md`](../docs/operations/tx-service-plane.md)。

## 排障入口

- Yecao 宿主：`ssh -i "$env:USERPROFILE\.ssh\wotb_vps_deploy" -o IdentitiesOnly=yes
  root@45.136.14.101 -p 58361`，`docker logs ai-service --tail 100`；
  业务后端日志在 TX。只读采集也可运行仅 `workflow_dispatch` 的
  `.github/workflows/prod-diagnostics.yml`。
