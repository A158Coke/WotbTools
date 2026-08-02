# WotBTools 观测系统（Observability）运维文档

> 第一阶段最小可观测系统：**Backend 结构化日志 + requestId、HTTP/AI/Replay 指标、Prometheus + Loki + Grafana + Alloy**。
> 适用版本：`add-monitor` 分支（第一阶段）。

---

## 1. 架构总览

```
                        ┌────────────────────────────────────────────┐
                        │            Host Caddy / Nginx              │
                        │   (TLS 终止, 仓库外由管理员维护)             │
                        └───────┬──────────────┬─────────────────────┘
                                │              │
              monitor.wotbtools.com    wotbtools.com / auth.wotbtools.com
                                │              │
                                ▼              ▼
                     ┌──────────────────┐  ┌──────────────────────┐
                     │   wotb-frontend  │  │   wotb-frontend      │
                     │  (nginx 容器)     │  │   (nginx 容器)        │
                     │  server_name     │  │   /api → backend:8087 │
                     │  monitor.* →     │  └──────────────────────┘
                     │  grafana:3000    │
                     └────────┬─────────┘
                              │ Docker 内部网络（compose 默认网络）
        ┌─────────────────────┼───────────────────────┐
        │                     │                       │
        ▼                     ▼                       ▼
┌──────────────┐    ┌──────────────┐         ┌──────────────┐
│   Prometheus │    │     Loki     │         │    Grafana   │
│    :9090     │    │    :3100     │         │    :3000     │
│ 指标抓取     │    │ 日志存储     │         │ 看板/查询    │
└──────┬───────┘    └──────▲───────┘         └──────────────┘
       │                   │                       ▲
       │ 抓取 :8088        │ 推送日志               │ Datasource (provisioning)
       │  /actuator/       │                       │
       ▼  prometheus       │                       │
┌──────────────────┐       │          ┌────────────┐
│   wotb-backend   │◄──────┼──────────┤    Alloy   │
│  :8087 业务       │       │          │    :12345  │
│  :8088 管理端口   │       └──────────┘ 采集 docker │
└──────────────────┘                  sock 容器日志  │
                                                      │
                                                      ▼
                                              Loki (7 天保留)
```

**组件职责**

| 组件 | 版本（固定） | 职责 |
|---|---|---|
| `wotb-backend` Actuator | Spring Boot 4.1.0 自带 | 独立管理端口 `8088`，暴露 `/actuator/prometheus`、`/actuator/health` |
| Prometheus | `prom/prometheus:v2.55.1` | 每 15s 抓取 backend 指标，TSDB 保留 7 天 / 上限 2GiB |
| Loki | `grafana/loki:3.3.2` | 接收 Alloy 推送的 backend 容器日志，保留 7 天 |
| Alloy | `grafana/alloy:v1.4.2` | 通过 docker.sock 只采集 `wotb-backend` 容器 stdout/stderr → Loki |
| Grafana | `grafana/grafana:11.4.0` | 可视化，provisioning 自动配置 Datasource + Dashboard |

**关键安全边界**

- Grafana `3000`、Prometheus `9090`、Loki `3100`、Alloy `12345`、Backend 管理端口 `8088` **均不映射到宿主机端口**，只在 Docker 内部网络可达。
- 公网只能通过 `monitor.wotbtools.com`（host 层 TLS 反代 → frontend nginx → `grafana:3000`）访问 Grafana，且 Grafana 禁止匿名访问。
- `/actuator/**` 不通过公网域名暴露（nginx 只代理 `/api/` 与 `monitor.*` 到 Grafana）。

---

## 2. `monitor.wotbtools.com`：DNS、HTTPS、反向代理

仓库内已完成的部分：

- `deploy/nginx/nginx.conf`：新增 `server_name monitor.wotbtools.com` 的 server 块，将请求反代到 Docker 网络内的 `grafana:3000`，并透传 `X-Forwarded-*`、支持 WebSocket（Grafana Live）。
- Grafana 环境变量 `GF_SERVER_ROOT_URL=https://monitor.wotbtools.com`（`GRAFANA_ROOT_URL`，见 `.env.example` / `docker-compose`）。

**仍需管理员在生产服务器手动完成**（仓库外）：

1. **DNS**：添加 `monitor.wotbtools.com` A/AAAA 记录指向生产服务器公网 IP（与 `wotbtools.com` 相同）。
2. **TLS 终止**：生产 VPS 的 host 级 Caddy/Nginx 已为 `wotbtools.com`、`auth.wotbtools.com` 配置 HTTPS；为 `monitor.wotbtools.com` 增加同款 server（443），反代到 `http://127.0.0.1:8088`（frontend 容器 80 端口映射）。Caddy 示例：

   ```caddy
   monitor.wotbtools.com {
       reverse_proxy 127.0.0.1:8088
   }
   ```

   或 Nginx host 级示例：

   ```nginx
   server {
       listen 443 ssl;
       server_name monitor.wotbtools.com;
       # ssl_certificate / ssl_certificate_key ...（同 wotbtools.com）
       location / {
           proxy_pass http://127.0.0.1:8088;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

3. **GitHub Secrets**（生产部署 CI 使用）：在仓库 Settings → Secrets and variables → Actions 配置：
   - `GRAFANA_ADMIN_USER`：Grafana 管理员用户名（如 `admin`）
   - `GRAFANA_ADMIN_PASSWORD`：强密码
   - 生成密码示例：`openssl rand -base64 24`（部署脚本在密码为空时会中断，见 `deploy.yml`）

---

## 3. 环境变量

新增观测相关变量（`.env.example` 已更新，未覆盖原有变量）：

| 变量 | 必填 | 说明 |
|---|---|---|
| `GRAFANA_ADMIN_USER` | 是（compose required 语法） | Grafana 管理员用户名 |
| `GRAFANA_ADMIN_PASSWORD` | 是（compose required 语法） | Grafana 管理员密码；**不得提交到 Git** |
| `GRAFANA_ROOT_URL` | 否，默认 `https://monitor.wotbtools.com` | Grafana 对外根地址 |
| `OBSERVABILITY_ENVIRONMENT` | 否，默认 `production` | 环境标记 |

本地启动观测栈时在 `docker/online/.env`（或环境变量）提供前两项；否则 `docker compose up` 会因 required 语法直接报错（符合"必填 Secret 用 required 语法"要求）。密码通过环境变量注入 Grafana 容器，**不出现在命令行参数**中。

---

## 4. 启动 / 停止

### 本地（docker/online）

```powershell
# 先设置必填变量（或用 docker/online/.env）
$env:GRAFANA_ADMIN_USER="admin"
$env:GRAFANA_ADMIN_PASSWORD="<强密码>"

# 启动（含观测栈）
cd docker/online
docker compose up -d --build

# 校验渲染后的配置
docker compose config --quiet

# 单独查看观测栈状态
docker compose ps prometheus loki alloy grafana
```

### 生产（CI 自动）

合并到 `main` 触发 `deploy.yml`：SSH 到 `/opt/wotb` 重新生成 `docker-compose.yml`（含观测服务）、`docker compose pull` + `up -d --remove-orphans`。观测配置随 `deploy/` 一起 scp 到 `/opt/wotb/deploy/observability/`。

### 停止观测系统（不影响主业务）

```bash
cd /opt/wotb   # 或本地 docker/online
docker compose stop prometheus loki alloy grafana
```

主业务（postgres/keycloak/wotb-backend/wotb-frontend）保持运行。重新启动：

```bash
docker compose start prometheus loki alloy grafana
```

> **禁止**使用 `docker compose down -v` 作为普通停止/回滚命令——它会删除所有 volume（含 PostgreSQL 数据）。

---

## 5. 验证方法

```bash
# compose 语法
docker compose config --quiet

# Prometheus 配置检查（容器内 promtool）
docker run --rm -v /opt/wotb/deploy/observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro prom/prometheus:v2.55.1 promtool check config /etc/prometheus/prometheus.yml

# Loki 配置检查
docker run --rm -v /opt/wotb/deploy/observability/loki/loki-config.yml:/etc/loki/loki-config.yml:ro grafana/loki:3.3.2 -config.file=/etc/loki/loki-config.yml -verify-config

# Alloy 配置检查（River 语法）
docker run --rm -v /opt/wotb/deploy/observability/alloy/config.alloy:/etc/alloy/config.alloy:ro grafana/alloy:v1.4.2 run --dry-run /etc/alloy/config.alloy
# 或: alloy 容器内执行 alloy fmt --check /etc/alloy/config.alloy
```

---

## 6. Grafana 登录与 Dashboard

1. 浏览器访问 `https://monitor.wotbtools.com`（或本地 `http://localhost:3000`，需临时 `docker run -p 3000:3000` 映射）。
2. 使用 `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` 登录（匿名访问已禁用：`GF_AUTH_ANONYMOUS_ENABLED=false`）。
3. 首次启动后，provisioning 自动创建：
   - Datasource：`Prometheus`（uid `prometheus`，`http://prometheus:9090`）、`Loki`（uid `loki`，`http://loki:3100`）
   - Dashboard：**WotBTools Backend Overview**（uid `wotbtools-backend-overview`，位于 "Dashboards → Manage"）

**Dashboard 面板清单**

1. Backend Up（`up{job="wotb-backend"}`）
2. 每分钟请求量（`sum(rate(http_server_requests_seconds_count[1m]))*60`）
3. 4xx / 5xx 比例
4. 请求量趋势
5. 状态码分布（2xx/3xx/4xx/5xx）
6. HTTP P50 / P95 / P99（`histogram_quantile`）
7. 最常访问接口 Top10（按规范化 URI）
8. 最慢接口（P95 响应时间表）
9. JVM 内存 Heap/Non-Heap
10. CPU 使用率（process/system）
11. GC 暂停时间
12. JVM 线程
13. HikariCP 连接池
14. AI Review 请求量（按 mode）
15. AI Review 成功/失败/拒绝
16. AI Review 耗时与并发（P95 + in-flight）
17. Replay 解析耗时 P95（按操作）
18. 最近 Backend ERROR 日志（Loki）

> 面板全部基于真实指标，无空面板。Dashboard JSON 提交在 `deploy/observability/grafana/dashboards/`，volume 丢失后随 provisioning 自动重建。

---

## 7. 日志查询与 requestId 排查

Backend 日志为**结构化 JSON**（`logging.structured.format.console: logstash`），每行包含 `mdc.requestId` 字段。

### 查询 Backend ERROR

Grafana → Explore → 选 Loki：

```logql
{container_name="wotb-backend"} |= "ERROR"
```

或按级别过滤（结构化日志 `level` 字段）：

```logql
{container_name="wotb-backend"} | json | level="ERROR"
```

### 按 requestId 排查单个请求

1. 请求响应头 `X-Request-ID` 会带回一个 UUID（或沿用请求头传入值）。
2. Loki 查询：

```logql
{container_name="wotb-backend"} | json | mdc.requestId="<requestId>"
```

3. 也可用 Dashboard 顶部 `requestId` 变量 + Loki 面板联动。

### 查询 AI Review 错误

Loki：

```logql
{container_name="wotb-backend"} | json | message=~"AI provider failure.*"
```

Prometheus（错误分类计数，固定枚举）：

```promql
sum by (type) (rate(wotb_ai_review_errors_total[5m]))
```

错误类型枚举（低基数，与代码 `classifyHttpError/classifyClientFailure` 一致）：
`AI_TIMEOUT`、`AI_UPSTREAM_UNAVAILABLE`、`AI_INVALID_REQUEST`、`AI_AUTHENTICATION_ERROR`、`AI_RATE_LIMITED`、`AI_CONTEXT_TOO_LARGE`、`AI_RESPONSE_INVALID`、`AI_EMPTY_RESPONSE`。

---

## 8. 数据保留与资源限制

| 组件 | 保留 | 磁盘上限 | 内存限制（mem_limit） |
|---|---|---|---|
| Prometheus | 7 天（`--storage.tsdb.retention.time=168h`） | 2GiB（`--storage.tsdb.retention.size=2GB`） | 384m |
| Loki | 7 天（`retention_period: 168h` + compactor） | 无显式上限（受宿主磁盘） | 256m |
| Grafana | 独立 volume `grafana_data` | 无 | 256m |
| Alloy | —（仅转发） | — | 128m |
| Docker 原始日志 | json-file 轮转：单文件 20MB × 3 | — | — |

**持久化**：全部使用独立命名 volume（`prometheus_data` / `loki_data` / `grafana_data`），与 `postgres_data` 分离；不写入 PostgreSQL。容器重启后 7 天数据仍在。

### 查看磁盘和内存占用

```bash
# 观测栈内存
docker stats prometheus loki alloy grafana

# 数据卷占用
docker system df -v | grep -E "prometheus_data|loki_data|grafana_data"

# Prometheus 自身 TSDB 大小
docker exec prometheus du -sh /prometheus

# Loki 块大小
docker exec loki du -sh /loki/chunks
```

### 调整保留时间 / 资源限制

- Prometheus 保留：改 `docker-compose.yml` 中 `--storage.tsdb.retention.time`（compose 与 `deploy.yml` heredoc 两处）。
- Loki 保留：改 `deploy/observability/loki/loki-config.yml` 的 `limits_config.retention_period`（如 `336h` = 14 天）后 `docker compose up -d loki`（Loki 需要 compactor 周期生效）。
- 内存限制：改各服务 `mem_limit`。

---

## 9. 回滚 / 完全移除观测系统（不影响主业务）

```bash
# 停止（数据保留，可随时 start 恢复）
docker compose stop prometheus loki alloy grafana

# 完全移除容器但保留 volume（回滚到无观测栈）
docker compose rm -sf prometheus loki alloy grafana

# 如需彻底删除观测数据（谨慎，不可恢复）
docker volume rm <project>_prometheus_data <project>_loki_data <project>_grafana_data
```

主业务四容器（postgres / keycloak / wotb-backend / wotb-frontend）不受影响；`postgres_data` volume 永不触碰。

---

## 10. 指标清单（Backend）

- **HTTP**：`http_server_requests_seconds_*`（Micrometer 自动，URI 已模板化，低基数；2xx/3xx/4xx/5xx 分布、P50/P95/P99 直方图）
- **JVM**：`jvm_memory_used_bytes`、`process_cpu_usage`、`system_cpu_usage`、`jvm_gc_pause_seconds_*`、`jvm_threads_*`
- **HikariCP**：`hikaricp_connections_active/idle/pending`
- **AI Review**（自定义，`AiReplayAnalysisService`）：
  - `wotb_ai_review_requests_total{mode}` — 请求量
  - `wotb_ai_review_results_total{result=success|failure|rejected}` — 结果
  - `wotb_ai_review_errors_total{type=<枚举>}` — 错误分类
  - `wotb_ai_review_duration_seconds` / `wotb_ai_upstream_duration_seconds` — 总耗时 / 上游耗时（Timer，成功与异常都结束）
  - `wotb_ai_review_in_flight` — 并发处理数（Gauge）
- **Replay 解析**：`wotb_replay_parse_duration_seconds{operation=preview|rating|export}`（`ReplayService`，Timer）

**Label 约束**：不使用用户 ID、Replay ID、文件名、IP、Prompt、异常文本、动态 URL 作为 label；URI 一律为 Spring MVC 模板（如 `/api/preview`）。不统计 Token Usage（DeepSeek 平台已提供）。

---

## 11. 日志安全

结构化日志**不会**包含：Authorization Header、Token、API Key、密码、Replay 文件内容、解析后的完整战斗数据、完整 Prompt/AI 响应、请求体、用户个人信息。AI 上游错误体被 `[PROVIDER_BODY_REDACTED]` 脱敏；`X-Request-ID` 限制 128 字符防注入。
