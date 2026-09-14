# WotBTools 观测排障 Runbook

用于生产部署后快速区分 Backend、Keycloak、AI、Replay 与宿主机问题。默认 Grafana 时间范围为最近 15 分钟，刷新间隔 30 秒。

## 1. 先确认观测链路

```bash
cd /opt/wotb
docker compose -f /opt/wotb/docker-compose.yml ps
docker compose -f /opt/wotb/docker-compose.yml logs --tail=100 keycloak alloy prometheus
```

在 Prometheus 页面确认以下 observability target 为 `UP`：

- `wotb-backend` → `http://wotb-backend:8088/actuator/prometheus`
- `node-exporter` → `http://node-exporter:9100/metrics`

Keycloak 只验证应用 OIDC discovery；登录与 QQ callback 通过 Loki 日志排障：

```bash
docker compose exec -T wotb-backend wget -qO- http://keycloak:8080/realms/wotbtools/.well-known/openid-configuration
docker compose logs --tail=100 keycloak alloy
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

部署脚本在任何容器变更前会拒绝包含 HTTP 控制字符（包括 CR/LF）的 `AI_API_KEY`；不会 trim、打印或输出该 secret 的任何片段。若该校验失败，先在 secret 管理侧重新录入干净值，再重新部署。

```bash
docker compose -f /opt/wotb/docker-compose.yml ps -a
docker compose -f /opt/wotb/docker-compose.yml logs --tail=300 keycloak wotb-backend alloy prometheus
```

normal Deploy 失败不会自动恢复旧 application image。脚本会先输出 release SHA/tag、affected/image services、Compose 状态、容器日志和可读取的 Flyway schema，再停止确认失败的 affected service；随后由 operator 使用 `Ops Recovery` 选择单个应用 service。Prometheus/Loki/Alloy/Grafana 失败只记录 `OBSERVABILITY DEGRADED`，不改变已健康的应用服务。

```bash
docker compose -f /opt/wotb/docker-compose.yml ps -a
docker compose -f /opt/wotb/docker-compose.yml logs --tail=300 keycloak wotb-backend wotb-frontend alloy prometheus
stat -c '%a %n' /opt/wotb/production-release.json
```

`/opt/wotb/production-release.json` 只记录最近一次通过全局 core health gate 的应用 identity。它不是自动恢复引擎；缺失、损坏或 image 不存在时，Recovery 必须拒绝执行。

## 6. Ops Recovery 与数据库边界

在 Actions 中手工触发 `Ops Recovery`，明确选择 `backend`、`frontend` 或 `keycloak`，并选择 `current` metadata 或 `specific` full SHA。Recovery 只 pull/recreate 一个目标应用 service，不隐式选择 `all`，也不执行数据库 restore。

backend recovery 先比较目标 source SHA 的最大 Flyway migration version 与 live `flyway_schema_history`：目标版本低于 live、schema 无法读取、metadata 不完整或 immutable image 不存在时拒绝。数据库灾难恢复仍只通过人工确认的 `deploy/postgres-restore.sh` 执行，并与应用 Recovery 分离。

本仓库当前的 `database-backup.yml` 保持 VPS 本地双库备份边界。COS 上传、对象存在/大小验证和 retention 仍是后续独立 PR；本 runbook 不把本地归档描述为 COS 已完成。
