# deploy/ — 部署与生产指令

> 仓库级硬约定见 `.agents/AGENTS.md`；运维细节见 `docs/observability.md` 与 `docs/auth/wargaming-asia-deployment.md`。

## 镜像与产物（经 deploy.yml / Dockerfile×3 核对）

- 三镜像推 GHCR（`ghcr.io/a158coke/wotbtools`）：`docker/Dockerfile.backend`（Maven→JRE，:8087）、`docker/Dockerfile.frontend`（Node→nginx，:80）、`docker/Dockerfile.keycloak`（含 `docker/keycloak/wotbtools-realm.json` realm 导入）。
- **统一构建**：生产部署（deploy.yml）每次运行都统一构建三个 SHA 镜像——`wotbtools-backend` / `wotbtools-frontend` / `wotbtools-keycloak`（GHCR 前缀 `ghcr.io/a158coke/`，tag = `sha-<short>` + `latest`）；路径检测（backend/frontend 变更标志）**只用于** test-backend/test-frontend 测试门禁与 tag 计算，**不用于**增量构建镜像（未变更时对应测试 job 为 skipped，构建仍执行）。改动此逻辑时同步 workflow 与 `deploy.sh` 契约校验。
- 生产编排 `deploy/docker-compose.prod.yml` + `deploy/deploy.sh`（fail-fast 校验，含 `AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100` 等契约；改动后端超时/编排变量必须同步 `AiTimeoutChainContractTest`、仓库根 `.env.example` 与本文件）。
- 反向代理 `deploy/nginx/nginx.conf`：`/api/replay/analyze` 固定 `proxy_read/send_timeout 1120s` + `proxy_buffering off`（SSE 流式）；其余 120s。
- 本地八服务开发环境在 `docker/online/docker-compose.yml`（postgres/keycloak/wotb-backend/wotb-frontend + prometheus/loki/alloy/grafana），**不是四容器**。

## 运维（安全）

- 备份：`postgres-backup.sh`/`postgres-restore.sh`/`postgres-backup-inspect.sh`（生产双库每日备份，7 天保留）；`init-db.sql` 为初始化。
- 观测：`deploy/observability/`（alloy config + grafana dashboards/provisioning）；指标名被 dashboards 引用，改名需同步 JSON。
- 排障：SSH VPS `ssh -i "$env:USERPROFILE\.ssh\wotb_vps_deploy" -o IdentitiesOnly=yes root@45.136.14.101 -p 58361`，`docker logs wotb-wotb-backend-1 --tail 100`；常见根因：循环依赖、Flyway 冲突、PG volume 不兼容。
- secret 一律 GitHub Secrets / 运行时 env（仓库根 `.env.example` 只列变量名），禁止落库或写死；赞助/收款信息不硬编码进页面或仓库（运行时只读挂载）。
