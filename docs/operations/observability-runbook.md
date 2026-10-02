# WotBTools 观测排障 Runbook

用于生产部署后快速区分 Backend、Keycloak、AI、Replay 与宿主机问题。默认 Grafana 时间范围为最近 15 分钟，刷新间隔 30 秒。

## 1. 先确认观测链路

生产有两个宿主，先确认你在哪一个（业务运行时在 TX，观测栈在 Yecao）：

```bash
# Yecao 宿主：观测栈 + ai-service
cd /opt/wotb
docker compose -f /opt/wotb/docker-compose.yml ps
docker compose -f /opt/wotb/docker-compose.yml logs --tail=100 alloy prometheus loki ai-service

# TX 宿主：business-api / wotb-frontend / keycloak / caddy / 两个 PostgreSQL / rabbitmq
cd /opt/wotb-tx
docker compose -f /opt/wotb-tx/docker-compose.yml ps
docker compose -f /opt/wotb-tx/docker-compose.yml logs --tail=100 keycloak business-api wotb-frontend
```

在 Prometheus 页面确认 Yecao 本地 target（`node-exporter`、`prometheus`、`loki`、`grafana`）为 `UP`。

> **已知缺口（已登记，由 observability realignment PR 处理）**：TX 业务运行时迁走后，
> Prometheus 的 `wotb-backend` target 与 Alloy 的 `wotb-backend` / `keycloak` 采集规则仍指向
> Yecao 上不存在的容器，Loki 因而没有 TX 侧业务/Keycloak 日志流。在那之前不要用该 target
> 或 Loki 里的 `container_name="wotb-backend"` 判断业务健康——TX 业务健康看第 3 节与
> `deploy/tx/runtime-check.sh`，Keycloak 看下面的 OIDC discovery。Yecao 部署也会持续输出
> `OBSERVABILITY DEGRADED`（非阻塞）。

Keycloak 只验证应用 OIDC discovery；登录与 QQ callback 通过 Keycloak 容器日志排障：

```bash
# TX 宿主内（business-api 与 keycloak 同网络）
docker compose -f /opt/wotb-tx/docker-compose.yml exec -T business-api \
  wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration
docker compose -f /opt/wotb-tx/docker-compose.yml logs --tail=100 keycloak
```

Keycloak 的应用 OIDC 与日志是生产排障依据，不应新增独立 management 端点或端口映射。

## 2. QQ / Keycloak callback 失败

1. 打开 `WotBTools · Keycloak`，先看 Keycloak 状态、HTTP 5xx、HTTP P95 和最近异常。
2. 在 Loki 过滤 `container_name="keycloak"`，优先查看 `error`、`exception`、`failed`、`denied`、`broker`。
3. 记录同一时间窗口的 timestamp、logger/category、exception class、root cause 和 Keycloak component。
4. 将 Keycloak 日志与 Backend 的 `api_request_failed` / `api_request_rejected`、`traceId`、`id`、`errorCode` 对齐。
5. 如需复现，先确认已获准在生产执行，再重复一次 QQ callback；只根据日志证据判断是 provider、Keycloak broker、上游网络还是客户端回调链路，不根据单个 5xx 直接归因 Android Cookie。

## 3. Backend / AI / Replay

- HTTP 5xx 大于 0：查看 `HTTP 请求与错误趋势`、延迟 P95/P99 和后端最近错误。
- AI 等待队列持续接近 4：结合 `wotb_ai_review_queue_depth`、`wotb_ai_review_in_flight`、`wotb_ai_review_queue_wait_seconds` 和 503 `AI_REVIEW_BUSY` 日志判断是否饱和。
- Replay 队列持续增长：查看 parse active/queue、Processing Job 终态和 `wotb_replay_processing_file_duration_seconds`；Job `ready/failed` 不等价于逐文件 parse success/failure。
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

应用镜像以当前 main 的 `latest` 为目标；排查实际运行版本时使用 `docker inspect` 查看
image digest、tag 与 `BUILD_COMMIT`。固定基础设施的 volume 和 OpenTofu state 独立核验。

## 6. 单目标恢复与数据库边界

事故恢复走单目标手动入口，没有 `Ops Recovery` 工作流，也没有 `all` / `target` 选择器：

1. 在 Actions 触发对应服务的 owner workflow（`workflow_dispatch`），且必须从当前 `main` HEAD 触发。
2. 镜像服务从当前 main 构建并发布 `latest`，随后只部署所属服务。
3. 需要固定基础设施变更时，触发对应基础设施 owner workflow（例如 Keycloak PostgreSQL）；Keycloak 与 MinIO 的应用 owner 各自保留 Tofu chain。

单目标部署只 pull/recreate 一个 service，不隐式选择其它服务，也不执行数据库 restore。schema 回退不是部署能力。Business PostgreSQL 归档验证及 disposable restore 见 `docs/operations/business-postgres.md`；该工具拒绝 authoritative `wotb` 数据库。Keycloak PostgreSQL 归档由独立备份脚本生成，不能用 Business restore 工具处理。

本仓库当前的 `database-backup.yml` 保持 VPS 本地双库备份边界。COS 上传、对象存在/大小验证和 retention 仍是后续独立 PR；本 runbook 不把本地归档描述为 COS 已完成。
