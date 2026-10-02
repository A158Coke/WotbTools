# WotBTools 观测排障 Runbook

用于生产部署后快速区分 Backend、Keycloak、AI、客户端回放（服务端无解析器）与宿主机问题。Grafana 时间范围**以各看板 provisioned 的 `time.from` 为准**：`WotBTools · 生产总览`、`JVM 与基础设施`、`HTTP 与事故诊断`、`回放与 AI 诊断` 为 `now-1h`，`使用统计与 Android` 为 `now-24h`，`Keycloak` 为 `now-15m`；刷新间隔统一 30 秒。在浏览器里临时改时间范围只影响当前会话，不改变 provisioned 默认值。

## 1. 先确认观测链路

生产有两个宿主，先确认你在哪一个（业务运行时在 TX，观测栈在 Yecao）：

```bash
# Yecao 宿主：观测栈 + ai-service
cd /opt/wotb
docker compose -f /opt/wotb/docker-compose.yml ps
docker compose -f /opt/wotb/docker-compose.yml logs --tail=100 alloy prometheus loki ai-service

# TX 宿主：business-api / wotb-frontend / keycloak / caddy / 两个 PostgreSQL / alloy-tx
cd /opt/wotb-tx
docker compose -f /opt/wotb-tx/docker-compose.yml ps
docker compose -f /opt/wotb-tx/docker-compose.yml logs --tail=100 keycloak business-api wotb-frontend
```

在 Prometheus 页面确认六类 target 为 `UP`：Yecao 本机 `ai-service`、`node-exporter`、`prometheus`、`loki`、`grafana`，以及跨 WireGuard 抓取的 TX 远端 job `wotb-backend`（目标 `10.20.0.1:8088/actuator/prometheus`）。这与 `deploy/verify-observability.sh` 的六类 target gate 一致。

> **当前抓取与日志拓扑**（`deploy/observability/prometheus/prometheus.yml`、`deploy/tx/alloy/config.alloy`）：
> Yecao Prometheus 既抓本机 target，也经 WireGuard 抓 TX business-api 的 management 端口
> `10.20.0.1:8088`（job 名保持 `wotb-backend`，dashboard PromQL 无需改动）；`ai-service` 走
> `wotb_internal` 网络的 `ai-service:8080/actuator/prometheus`。日志侧 TX `alloy-tx` 采集
> business-api / keycloak / wotb-frontend，标签归一化为 `wotb-backend` / `keycloak` /
> `wotb-frontend` 后经 WireGuard 推入 Yecao Loki，因此 Loki 里这三个 `container_name` 是真实 TX
> 业务流，可直接用于排障。Yecao 本地 Alloy（`deploy/observability/alloy/config.alloy`）的
> backend / keycloak 规则只服务 `deploy/verify-observability.sh` 的部署 canary——Yecao 上没有业务
> 容器，这些规则不承载生产日志。
>
> **已登记缺口（AI 日志）**：AI Review 生命周期事件由 Yecao `ai-service` 进程产出
> （`java/wotb-ai/.../AiReviewController` 与 `AiReviewEventLog`），但仓库里**没有任何 Alloy 规则
> 采集 ai-service 日志**，所以 AI 事件只能看容器日志（`docker compose -f
> /opt/wotb/docker-compose.yml logs ai-service`），不会出现在 Loki；Grafana「回放与 AI 诊断」的
> AI 日志面板因此无数据，AI 侧观测请先用 Prometheus 指标（`job="ai-service"`）。

Keycloak 已不在 Prometheus metrics contract（没有 `keycloak` job，也不启用或暴露 management health/metrics 端点），排障只用两条证据链：**应用 OIDC discovery**（blocking gate 的一部分）与 **Alloy → Loki 的 Keycloak 容器日志**：

```bash
# TX 宿主内（business-api 与 keycloak 同网络）
docker compose -f /opt/wotb-tx/docker-compose.yml exec -T business-api \
  wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration
docker compose -f /opt/wotb-tx/docker-compose.yml logs --tail=100 keycloak
```

同一批日志也已由 TX `alloy-tx` 归一化后推入 Yecao Loki，可直接在 Grafana Explore（选 Loki 数据源）查：

```logql
{container_name="keycloak"} |~ "(?i)LOGIN_ERROR|IDENTITY_PROVIDER_LOGIN_ERROR|user_not_found|failed|exception"
```

Keycloak 的应用 OIDC 与日志是生产排障依据，不应新增独立 management 端点或端口映射。

## 2. QQ / Keycloak callback 失败

1. 打开 `WotBTools · Keycloak`（纯 Loki 日志看板，四个面板：`登录与身份代理事件`、`QQ Callback 流程`、`登录错误与 IdP 故障`、`Keycloak WARN / ERROR`）；Keycloak 不在 Prometheus metrics contract，没有状态/HTTP 5xx/P95 指标，服务可达性看 OIDC discovery 与 TX `deploy/tx/runtime-check.sh` 的 `auth-token` 等 token。
2. 在 Loki 过滤 `container_name="keycloak"`（该标签由 TX `alloy-tx` 归一化写入），优先查看 `error`、`exception`、`failed`、`denied`、`broker`。
3. 记录同一时间窗口的 timestamp、logger/category、exception class、root cause 和 Keycloak component。
4. 将 Keycloak 日志与 Backend 的 `api_request_failed` / `api_request_rejected`、`traceId`、`id`、`errorCode` 对齐。
5. 如需复现，先确认已获准在生产执行，再重复一次 QQ callback；只根据日志证据判断是 provider、Keycloak broker、上游网络还是客户端回调链路，不根据单个 5xx 直接归因 Android Cookie。

## 3. Backend / AI / Replay

- HTTP 5xx 大于 0：在 `WotBTools · HTTP 与事故诊断` 查看 `HTTP 状态趋势`、`HTTP 延迟 P50 / P95 / P99`、`错误码分布 · Loki` 与 `近期事故（倒序）`。
- AI 等待队列饱和：结合 `wotb_ai_review_queue_depth`、`wotb_ai_review_in_flight`、`wotb_ai_review_queue_wait_seconds` 和 503 `AI_REVIEW_BUSY` 日志判断是否饱和。生产容量是 queue 2 + in-flight 2（`deploy/docker-compose.prod.yml` 的 `AI_REVIEW_WORKER_QUEUE_CAPACITY=2` / `AI_REVIEW_WORKER_MAX_CONCURRENT=2`；代码默认 4+4，见 `java/wotb-ai/src/main/java/com/wotb/web/replay/ai/AiReviewWorkerExecutor.java`），因此 `queue_depth` 持续接近 QUEUE_CAPACITY 或 `in_flight` 持续等于 MAX_CONCURRENT 即表示饱和。
- 回放解析异常：解析完全在浏览器客户端完成，服务器没有 parser，因此**没有任何服务端 Prometheus 回放解析指标**（没有 processing/export job，也没有 parse active/queue 或 Processing Job 终态可查）。服务端只能看 business-api 的 `http_server_requests_seconds_*`（上传/接口 4xx/5xx）与 TX 日志；解析失败本身在客户端排障：浏览器 DevTools 的 Console/Worker 报错（`frontend/src/replay-local/parse.worker.ts`、`parseReplays.ts`），再确认客户端计算与 2D 面板（`frontend/src/replay-local/compute/**`、`playback/**`）是否产出舰队与时间轴。
- Backend JVM 异常：查看堆内存、线程、GC、Hikari pending，以及主机 CPU/RAM/磁盘/负载。

## 4. 主机资源阈值

生产首页只做可视化阈值，不自动触发 Alertmanager：

| 资源 | Warning | Critical |
|---|---:|---:|
| CPU | 80% | 90% |
| RAM | 85% | 90% |
| Disk | 80% | 90% |

确认磁盘问题时同时查看 `docker system df -v`、Prometheus TSDB 和 Loki volume；禁止使用 `docker compose down -v`。

## 5. 证据采集与失败发布处理

Deploy 只把 GitHub Secrets 作为 SSH 运行时环境变量注入目标 service，不 trim、不打印、不输出 secret 片段；secret 不进仓库、不进 Compose 文件。若 `AI_API_KEY` 等值在 secret 管理侧被污染（例如带上换行/控制字符），先在 secret 管理侧重新录入干净值，再重新部署。

```bash
# TX 宿主：业务运行时
docker compose -f /opt/wotb-tx/docker-compose.yml ps -a
docker compose -f /opt/wotb-tx/docker-compose.yml logs --tail=300 keycloak business-api wotb-frontend

# Yecao 宿主：AI service + 观测栈
docker compose -f /opt/wotb/docker-compose.yml ps -a
docker compose -f /opt/wotb/docker-compose.yml logs --tail=300 ai-service alloy prometheus
```

应用部署失败不会自动恢复旧镜像。各 owner workflow 输出目标服务、Compose 状态、容器日志和可读取的 Flyway schema，再停止确认失败的目标服务；Prometheus/Loki/Alloy/Grafana 失败只记录 `OBSERVABILITY DEGRADED`，不改变已健康的应用服务。失败不回滚其它已成功服务。

应用镜像身份按 owner 的发布车道确定：TX `business-api` / `wotb-frontend` 是 digest-pinned，生产只消费 `TX_BUSINESS_API_IMAGE_REF` / `TX_FRONTEND_IMAGE_REF` 提供的 `repo@sha256:<digest>`（禁止回退 `latest`）；Yecao `ai-service` 等尚未迁移的 owner 仍以当前 main 构建并发布的 `latest` 为目标。排查实际运行版本时使用 `docker inspect` 查看
image digest、tag 与 `BUILD_COMMIT`。固定基础设施的 volume 和 OpenTofu state 独立核验。

## 6. 单目标恢复与数据库边界

事故恢复走单目标手动入口，没有 `Ops Recovery` 工作流，也没有 `all` / `target` 选择器：

1. 在 Actions 触发对应服务的 owner workflow（`workflow_dispatch`），且必须从当前 `main` HEAD 触发。
2. 镜像服务从当前 main 构建并发布该 owner 发布契约规定的镜像（TX business-api / wotb-frontend 为 immutable TCR digest，Yecao ai-service 等尚未迁移的 owner 仍为 `latest`），随后只部署所属服务。
3. 需要固定基础设施变更时，触发对应基础设施 owner workflow（例如 Keycloak PostgreSQL）；Keycloak 的应用 owner 保留自己的 Tofu chain（`infra/tofu/keycloak`），仓库里没有 MinIO root。

单目标部署只 pull/recreate 一个 service，不隐式选择其它服务，也不执行数据库 restore。schema 回退不是部署能力。Business PostgreSQL 归档验证及 disposable restore 见 `docs/operations/business-postgres.md`；该工具拒绝 authoritative `wotb` 数据库。Keycloak PostgreSQL 归档由独立备份脚本生成，不能用 Business restore 工具处理。

本仓库当前的 `database-backup.yml` 保持 VPS 本地双库备份边界。COS 上传、对象存在/大小验证和 retention 仍是后续独立 PR；本 runbook 不把本地归档描述为 COS 已完成。
