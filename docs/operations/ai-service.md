# Yecao AI Service（预部署阶段）

`ai-service` 是 `java/wotb-ai` 构建的独立 Spring Boot 进程，镜像为 `ghcr.io/a158coke/ai-service`。服务只在 Yecao 部署与验证，TX 网关已有更具体的 `/api/ai/**` 反代路由指向它的 WireGuard 端点（不重写 path，SSE 1120s）；前端 AI Review 已解除「维护中」（提交 `83884790`，前端无维护门），个人随机战与训练房/联赛团队复盘都走正式生产链（`TacticalReviewHarness` / `TeamReplayAnalysisService`），输入为客户端 canonical AI projection，语义 parity 由 `ClientAiProjectionParityTest` 守护。AI provider 配置与 secret 只属于本服务的 Yecao 运行时（`deploy/docker-compose.prod.yml`）：TX 业务编排（`deploy/tx/business-api.compose.yml`、`deploy/tx/deploy.sh`、`business-api.yml`）已不再携带任何 `AI_*` 变量或 key，只保留 `/api/ai/**` 到本服务 WireGuard 端点的 ingress 路由。

## 发布与边界

积分赛截图识别同样由本服务承载：`POST /api/ai/tournament-groups/recognize` 仅允许管理员，
先验证 Business API 针对图片签发的短期许可，再通过已有 provider gateway 识别军团与名次。
沿用 `AI_API_KEY` / `AI_BASE_URL`，`TOURNAMENT_RECOGNITION_MODEL` 默认 `deepseek-flash`；
`TOURNAMENT_RECOGNITION_SIGNING_KEY` 是 Business/AI 共享的内部随机签名 Secret，须至少 32 字节。
本服务仍无数据库或 Business Backend 网络依赖，积分计算、草稿和发布由 Business API 持有。
缺少签名配置只关闭积分识别，既有 AI 复盘不受影响。运行时由各 owner workflow 注入同一 Secret；
上传/并发限制与管理员操作见 [`积分赛功能契约`](../features/tournament-points.md)。

- `.github/workflows/ai-service.yml` 在自身输入变化的 `main` push 上构建 GHCR 的 `sha-<commit>`，确认当前 main 后发布 `latest`，再用 `deploy/deploy.sh` 的 `ai-service` 选择器部署。镜像内保留 `BUILD_COMMIT`。
- `deploy/docker-compose.prod.yml` 仅将容器 `8080` 映射到 Yecao WireGuard 地址 `10.20.0.2:8089`。不添加公网映射，也不代理到 Business Backend；TX 侧唯一的反向代理是 `deploy/tx/nginx/frontend.conf.template` 里更具体的 `location ^~ /api/ai/`，upstream 为 `${AI_UPSTREAM}`（`TX_AI_UPSTREAM`，默认 `http://10.20.0.2:8089`，在 `deploy/tx/deploy.sh` fail-closed），不重写 path，`proxy_read/send_timeout 1120s`。资源上限为 1.5 CPU、1536 MiB；并发和队列默认各 2，后续用负载数据调节。
- Yecao 运行时注入 `AI_API_KEY`；`AI_BASE_URL`、`AI_MODEL`、`KEYCLOAK_ISSUER_URI` 等非秘密项经 GitHub Variables/Compose 默认值配置。不得把 JWT、prompt、completion 或密钥写入仓库及日志。AI 服务不持有 PostgreSQL、RabbitMQ、MinIO 或 replay job 凭据。
- `deploy/deploy.sh` 在 staging 阶段校验 Compose，部署后从宿主访问 `http://10.20.0.2:8089/actuator/health/readiness`。失败时停止该服务并报告，不更改其它 Yecao 服务。
- **AI 请求只在 `/api/ai/**` 路由上离开 TX**：`/api/ai/` 由 `location ^~ /api/ai/` 反代到 WireGuard 的 `10.20.0.2:8089`，其余 `/api/` 一律终结在 TX-internal `business-api`。因此「AI 复盘不可用」既可能是本服务故障，也可能是**请求根本没离开浏览器**——排障必须先确认本服务有没有收到请求，不要先假定上游挂了。

## 排障：AI 复盘在生产不可用时

先按层取证，再决定改哪一层。两侧日志都可用只读的 `.github/workflows/prod-diagnostics.yml`（`workflow_dispatch`）采集。

```text
Yecao（ai-service 宿主，ssh -i <wotb_vps_deploy> root@<VPS_HOST> -p <VPS_PORT>）：
  docker inspect -f '{{.State.Status}} {{.State.StartedAt}}' ai-service
  docker exec ai-service printenv BUILD_COMMIT
  curl -s http://10.20.0.2:8089/actuator/health/readiness
  docker logs ai-service --tail 200      # event=ai_upstream_call_started / _completed / AI usage
```

判读边界（2026-10 实测有效）：

| 观测 | 含义 |
|---|---|
| 本服务日志里**没有任何** `ai_upstream_call_started` | 请求没有离开浏览器：先查前端 bundle 是否与新部署一致（`version.json:buildCommit` 与 `[build] commit=` 必须与线上 `/assets/` 里的入口文件匹配）。懒加载 chunk 404 会打空工作台，此时改 ai-service 没有意义 |
| 匿名 `POST https://wotbtools.com/api/ai/reviews` 返回 401 且响应头带 `X-Accel-Buffering: no` | TX ingress + ai-service 安全链正常 |
| 该端点返回 403 | JWT 有效但 realm role 不含 `wotbtools-user` / `wotbtools-admin`：查 Keycloak realm 默认角色与 `roles` client scope |
| 有 `ai_upstream_call_started` 但没有 `ai_upstream_call_completed`（或伴随 `ai_upstream_call_failed`） | provider 侧问题：查 `AI_BASE_URL` / `AI_MODEL` / key 有效性 |

**不做的事**：不用「关闭 AI tab」「加 maintenance gate」「mock 响应」或「服务端回放解析 fallback」掩盖故障——AI Review 是正式开放能力，输入边界是客户端 canonical projection（服务器没有 parser，也不接收原始回放）。

## 验收与回滚

PR CI 校验 Maven、Docker/Compose 配置及部署脚本。合并并发布后，在 Yecao 确认容器的 `BUILD_COMMIT`、readiness 和 liveness、仅 WireGuard 绑定及无数据库/存储依赖。健康通过只证明服务独立运行正常，不代表 AI 复盘质量，也不代表端到端可用：**readiness=UP 不是验收标准**——端到端验收必须由真实登录用户（realm role `wotbtools-user`）用真实 `.wotbreplay` 完成一次 AI 复盘。若启动或健康失败，停止 `ai-service`（TX 侧 `/api/ai/**` 会得到上游不可用错误），其它服务不受影响；修复后按该服务 owner workflow 重发。

