# deploy/ — 部署与生产指令

> 仓库级硬约定见 `.agents/AGENTS.md`；运维细节见 `docs/operations/observability.md` 与 `docs/auth/wargaming-asia-deployment.md`。

## 镜像与产物（经 deploy.yml / Dockerfile×3 核对）

- 三镜像推 GHCR（`ghcr.io/a158coke/wotbtools`）：`docker/Dockerfile.backend`（Maven→JRE，:8087）、`docker/Dockerfile.frontend`（Node→nginx，:80）、`docker/Dockerfile.keycloak`（含 `docker/keycloak/wotbtools-realm.json` realm 导入）。
- **Build / Deploy 分离**：`.github/workflows/build.yml` 在 main 的应用或运行时 observability 变更后构建 SHA 镜像，也支持 `workflow_dispatch` 单独构建 `backend` / `frontend` / `keycloak` / `all`；纯 `deploy/observability/grafana/dashboards/**` 由 Grafana OpenTofu 管理，不触发应用 Build。`.github/workflows/deploy.yml` 只通过 `workflow_dispatch` 选择任意 production compose service 做 targeted deploy，不自动串接 Build。应用服务/all 必须使用独立 Build 产出的 immutable `sha-<short>` tag；运行时 observability service 可不填 image tag。代码质量验证由 PR CI（merge gate）承担，Build/Deploy 不重复运行测试套件。targeted deploy 只重建并启动所选 service，保留其它应用镜像 tag，且不提升 LKG；完整 `all` 发布才更新 LKG。
- **PR 快速上线**：计划已明确且用户要求直接上线时，完成实现后直接提交、推送并开 PR，由 PR CI 验证；本地测试不是推送前阻塞条件。部署脚本仍必须保留静态配置校验、`verify-observability.sh` 数据链路 gate、失败诊断与可回滚路径。
- 生产编排 `deploy/docker-compose.prod.yml` + `deploy/deploy.sh`（fail-fast 校验，含 `AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100` 等契约；改动后端超时/编排变量必须同步 `AiTimeoutChainContractTest`、仓库根 `.env.example` 与本文件）。
- 反向代理 `deploy/nginx/nginx.conf`：`/api/replay/analyze` 固定 `proxy_read/send_timeout 1120s` + `proxy_buffering off`（SSE 流式）；其余 120s。
- **SPA 缓存策略（frontend 部署即生效的关键）**：`location = /index.html` 固定 `Cache-Control: no-cache, no-store, must-revalidate`（禁止浏览器缓存入口页，新 bundle hash 部署后立即生效）；`location /assets/`（Vite 内容 hash 产物）固定 `Cache-Control: public, max-age=31536000, immutable`，且 404 不 fallback 到 index.html。改缓存头会影响用户能否看到新前端版本，改动需在 `?view=hof-admin` 等页验证。
- **Build identity（防猜版本）**：frontend 构建注入真实 git commit——build.yml 的 frontend job 传 `BUILD_COMMIT=${{ needs.changes.outputs.tag }}` build-arg，`vite.config.js` 据此生成 `dist/version.json` 并在启动 console 输出 `[build] commit=... time=...`（Docker 上下文无 `.git`，必须经 build-arg 注入，本地构建才 fallback `git rev-parse`）。生产页面异常时先核对实际 bundle 版本。
- 本地八服务开发环境在 `docker/online/docker-compose.yml`（postgres/keycloak/wotb-backend/wotb-frontend + prometheus/loki/alloy/grafana），**不是四容器**。

## 运维（安全）

- 备份：`postgres-backup.sh`/`postgres-restore.sh`/`postgres-backup-inspect.sh`（生产双库每日备份，7 天保留）；`init-db.sql` 为初始化。
- 观测：`deploy/observability/`（Alloy config + Grafana dashboards/provisioning）；指标名被 dashboards 引用，改名需同步 JSON。Grafana dashboard API ownership 由 `infra/tofu/grafana` 管理，PR plan 后 main merge 自动 apply，Prometheus/Loki datasource 仍由 file provisioning 管理。Prometheus 必须验证 backend、node-exporter、Prometheus、Loki、Grafana 五类 target 为 `up == 1`；Grafana 必须验证 health、Prometheus/Loki datasource health、全部 dashboard UID API 与 Production Overview 默认首页。Keycloak 不再进入 Prometheus metrics contract，登录/IdP/callback 通过 Alloy → Loki 日志验证。生产上线后的 metrics endpoint、Prometheus target/query、Loki backend/Keycloak/frontend canary stream 由 `deploy/verify-observability.sh` 串行验证；CI 用 `deploy/test-observability-e2e.sh` 验证真实 Docker emitter → 生产 Alloy → Loki 的三条 ownership path，并用 `deploy/test-grafana-runtime.sh` 验证 datasource provisioning 与 dashboard API adoption。
- 生产发布必须先由 Actions 上传到 `/opt/wotb/deploy.incoming`，在 incoming project root 中完成 compose config/pull，再以同文件系统目录 move promote 到 `/opt/wotb/deploy`；成功部署后将通过 application availability gate 的部署树、compose 与 SHA 提升为 `/opt/wotb/deploy.lkg`、`docker-compose.lkg.yml`、`DEPLOYED_SHA.lkg`。失败时只允许恢复经校验的 LKG；`/opt/wotb/deploy.prev` 与 `docker-compose.prev.yml` 仅是取证快照。LKG 缺失/损坏时必须 fail-closed；若存在健康 live deployment，正常流程验证并 seed LKG；不存在健康 live deployment 时不得 bootstrap candidate。应用可用性与观测可用性是两个故障域；Prometheus/Loki/Alloy/Grafana 失败只能输出 `OBSERVABILITY DEGRADED`，不得触发健康应用回滚。Grafana OpenTofu apply 与 production deploy 共用 GitHub Actions `production-maintenance` concurrency，但该组不是服务器端 distributed lock。禁止对 live `deploy/` 直接 SCP 覆盖，也禁止只发送 HUP 作为 Grafana/观测配置生效保证。
- 生产发布在 staged compose pull 后、live promote 前必须运行 `validate-alloy-config.sh`；Alloy Android 下载 `stage.match` selector 使用 LogQL 安全的 `[.]`，禁止回退到会触发 `invalid char escape` 的 `\\.` 写法。
- Grafana 生产 API 校验必须复用 `deploy/grafana-api-request.sh` 这条生产 backend Alpine 运行时可用的 BusyBox `wget` 路径：调用方只传 `/api/...`，helper 在 backend 容器内唯一拼接 Grafana hostname 并生成 `Authorization: Basic` header（不得把密码放 URL、命令输出或日志），datasource health 的唯一成功值是 JSON `status=OK`。CI runtime smoke 还必须在 Alpine 3.22 中验证正确凭据通过、错误凭据失败，以防回退到 GNU-only `wget` 参数或 double URL prefix。
- Loki canary 校验在 emitter 启动前固定 `start`，重试时只推进 `end`；响应必须是 `status=success`、至少一个 result stream、至少一个 values 样本并包含 marker。Keycloak canary 是加入 `wotb_internal` 网络的独立 Alpine emitter，只用于验证 Alloy 的 ownership 采集路径，不得把 Keycloak 镜像当 shell 执行。
- Keycloak 运行时契约由 `deploy/test-keycloak-runtime.sh` 独立验证：自定义镜像必须以 `start --optimized` 启动，保留 PostgreSQL 与应用 OIDC discovery；不再启用或暴露 management health/metrics 端口，且不得出现启动时 Quarkus augmentation。`.github/workflows/ci.yml` 的 `keycloak-runtime` 是该契约的真实 Docker gate。

## Gate boundary

- Blocking production health：backend `/api/health`、frontend/nginx `Host: wotbtools.com` `/api/health`、Keycloak OIDC discovery。
- Non-blocking observability：Prometheus、Loki、Alloy、Grafana、datasources、dashboards、metrics 与 log ingestion。
- `verify-observability.sh` 必须保持 fail-closed；deploy orchestration 负责把失败记录为 degraded，而不是用 `|| true` 改写 verifier 语义。
- 排障：SSH VPS `ssh -i "$env:USERPROFILE\.ssh\wotb_vps_deploy" -o IdentitiesOnly=yes root@45.136.14.101 -p 58361`，`docker logs wotb-wotb-backend-1 --tail 100`；常见根因：循环依赖、Flyway 冲突、PG volume 不兼容。
- secret 一律 GitHub Secrets / 运行时 env（仓库根 `.env.example` 只列变量名），禁止落库或写死；赞助/收款信息不硬编码进页面或仓库（运行时只读挂载）。
