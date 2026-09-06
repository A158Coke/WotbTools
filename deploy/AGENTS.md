# deploy/ — 部署与生产指令

> 仓库级硬约定见 `.agents/AGENTS.md`；运维细节见 `docs/operations/observability.md` 与 `docs/auth/wargaming-asia-deployment.md`。

## 镜像与产物（经 deploy.yml / Dockerfile×3 核对）

- 三镜像推 GHCR（`ghcr.io/a158coke/wotbtools`）：`docker/Dockerfile.backend`（Maven→JRE，:8087）、`docker/Dockerfile.frontend`（Node→nginx，:80）、`docker/Dockerfile.keycloak`（含 `docker/keycloak/wotbtools-realm.json` realm 导入）。
- **统一构建**：生产部署（deploy.yml）每次运行都统一构建三个 SHA 镜像——`wotbtools-backend` / `wotbtools-frontend` / `wotbtools-keycloak`（GHCR 前缀 `ghcr.io/a158coke/`，tag = `sha-<short>` + `latest`）；代码质量验证由 PR CI（merge gate）承担，deploy 只做 production build / Docker 三镜像构建推送 / 部署与健康检查，**不再重复运行测试套件**。tag 基于 main 提交哈希确定性计算。改动此逻辑时同步 workflow 与 `deploy.sh` 契约校验。
- **PR 快速上线**：计划已明确且用户要求直接上线时，完成实现后直接提交、推送并开 PR，由 PR CI 验证；本地测试不是推送前阻塞条件。部署脚本仍必须保留静态配置校验、`verify-observability.sh` 数据链路 gate、失败诊断与可回滚路径。
- 生产编排 `deploy/docker-compose.prod.yml` + `deploy/deploy.sh`（fail-fast 校验，含 `AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC=1100` 等契约；改动后端超时/编排变量必须同步 `AiTimeoutChainContractTest`、仓库根 `.env.example` 与本文件）。
- 反向代理 `deploy/nginx/nginx.conf`：`/api/replay/analyze` 固定 `proxy_read/send_timeout 1120s` + `proxy_buffering off`（SSE 流式）；其余 120s。
- **SPA 缓存策略（frontend 部署即生效的关键）**：`location = /index.html` 固定 `Cache-Control: no-cache, no-store, must-revalidate`（禁止浏览器缓存入口页，新 bundle hash 部署后立即生效）；`location /assets/`（Vite 内容 hash 产物）固定 `Cache-Control: public, max-age=31536000, immutable`，且 404 不 fallback 到 index.html。改缓存头会影响用户能否看到新前端版本，改动需在 `?view=hof-admin` 等页验证。
- **Build identity（防猜版本）**：frontend 构建注入真实 git commit——deploy.yml build-frontend 传 `BUILD_COMMIT=${{ needs.changes.outputs.tag }}` build-arg，`vite.config.js` 据此生成 `dist/version.json` 并在启动 console 输出 `[build] commit=... time=...`（Docker 上下文无 `.git`，必须经 build-arg 注入，本地构建才 fallback `git rev-parse`）。生产页面异常时先核对实际 bundle 版本。
- 本地八服务开发环境在 `docker/online/docker-compose.yml`（postgres/keycloak/wotb-backend/wotb-frontend + prometheus/loki/alloy/grafana），**不是四容器**。

## 运维（安全）

- 备份：`postgres-backup.sh`/`postgres-restore.sh`/`postgres-backup-inspect.sh`（生产双库每日备份，7 天保留）；`init-db.sql` 为初始化。
- 观测：`deploy/observability/`（Alloy config + Grafana dashboards/provisioning）；指标名被 dashboards 引用，改名需同步 JSON。Prometheus 必须验证 backend、Keycloak、node-exporter、Prometheus、Loki、Grafana 六类 target 为 `up == 1`；Grafana 必须验证 health、Prometheus/Loki datasource health、全部 dashboard UID API 与 Production Overview 默认首页。生产上线后的 metrics endpoint、Prometheus target/query、Loki backend/Keycloak/frontend canary stream 由 `deploy/verify-observability.sh` 串行验证；CI 用 `deploy/test-observability-e2e.sh` 验证真实 Docker emitter → 生产 Alloy → Loki 的三条 ownership path，并用 `deploy/test-grafana-runtime.sh` 验证最小 runtime provisioning。
- 生产发布必须先由 Actions 上传到 `/opt/wotb/deploy.incoming`，在 incoming project root 中完成 compose config/pull，再以同文件系统目录 move promote 到 `/opt/wotb/deploy`；失败时恢复 `/opt/wotb/deploy.prev` 与 `docker-compose.prev.yml`，并 `--force-recreate` Prometheus/Loki/Alloy/Grafana 后重新跑完整 observability gate。禁止对 live `deploy/` 直接 SCP 覆盖，也禁止只发送 HUP 作为 Grafana/观测配置生效保证。
- 排障：SSH VPS `ssh -i "$env:USERPROFILE\.ssh\wotb_vps_deploy" -o IdentitiesOnly=yes root@45.136.14.101 -p 58361`，`docker logs wotb-wotb-backend-1 --tail 100`；常见根因：循环依赖、Flyway 冲突、PG volume 不兼容。
- secret 一律 GitHub Secrets / 运行时 env（仓库根 `.env.example` 只列变量名），禁止落库或写死；赞助/收款信息不硬编码进页面或仓库（运行时只读挂载）。
