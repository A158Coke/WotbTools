# WotBTools 观测排障 Runbook

用于生产部署后快速区分 Backend、Keycloak、AI、Replay 与宿主机问题。默认 Grafana 时间范围为最近 15 分钟，刷新间隔 30 秒。

## 1. 先确认观测链路

```bash
cd /opt/wotb
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 keycloak alloy prometheus
```

在 Prometheus 页面确认以下 target 为 `UP`：

- `wotb-backend` → `http://wotb-backend:8088/actuator/prometheus`
- `keycloak` → `http://keycloak:9000/metrics`
- `node-exporter` → `http://node-exporter:9100/metrics`

管理端点只应在 Docker 内部网络可达，不应新增宿主机或公网端口映射。

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

## 5. 证据采集与回滚

```bash
docker compose -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.prod.yml logs --tail=300 keycloak wotb-backend alloy prometheus
```

若部署健康检查失败，先保留上述输出和 Grafana 时间窗口，再按部署脚本的 rollback 流程恢复上一版 compose。回滚不应删除 PostgreSQL、Prometheus、Loki 或 Grafana volume。
