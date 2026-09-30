# Yecao AI Service（预部署阶段）

`ai-service` 是 `java/wotb-ai` 构建的独立 Spring Boot 进程，镜像为 `ghcr.io/a158coke/ai-service`。本阶段只在 Yecao 部署与验证服务；TX 网关没有 `/api/ai/**` 路由，前端 AI Review 继续显示“维护中”，不接收公开流量。当前直接请求路径仅支持个人随机战复盘，团队模式明确拒绝；完整事实投影与语义 parity 尚未完成。旧 TX AI 运行链暂留，待完整流量切换阶段再移除。

## 发布与边界

- `.github/workflows/ai-service.yml` 在自身输入变化的 `main` push 上构建 GHCR 的 `sha-<commit>`，确认当前 main 后发布 `latest`，再用 `deploy/deploy.sh` 的 `ai-service` 选择器部署。镜像内保留 `BUILD_COMMIT`。
- `deploy/docker-compose.prod.yml` 仅将容器 `8080` 映射到 Yecao WireGuard 地址 `10.20.0.2:8089`。不添加公网映射、TX 反代或 Business Backend 代理。资源上限为 1.5 CPU、1536 MiB；并发和队列默认各 2，后续用负载数据调节。
- Yecao 运行时注入 `AI_API_KEY`；`AI_BASE_URL`、`AI_MODEL`、`KEYCLOAK_ISSUER_URI` 等非秘密项经 GitHub Variables/Compose 默认值配置。不得把 JWT、prompt、completion 或密钥写入仓库及日志。AI 服务不持有 PostgreSQL、RabbitMQ、MinIO 或 replay job 凭据。
- `deploy/deploy.sh` 在 staging 阶段校验 Compose，部署后从宿主访问 `http://10.20.0.2:8089/actuator/health/readiness`。失败时停止该服务并报告，不更改其它 Yecao 服务。

## 验收与回滚

PR CI 校验 Maven、Docker/Compose 配置及部署脚本。合并并发布后，在 Yecao 确认容器的 `BUILD_COMMIT`、readiness 和 liveness、仅 WireGuard 绑定及无数据库/存储依赖。此阶段的健康通过只证明独立运行，**不代表 AI Review 可对用户开放**。若启动或健康失败，停止 `ai-service`，保留 TX 现有前端维护状态与其它服务；修复后按该服务 owner workflow 重发。
