# WotBTools 观测系统（Observability）运维文档

> 可观测系统：**Backend 结构化日志 + requestId、HTTP/AI/Replay 指标、Prometheus + Loki + Grafana + Alloy**。
> 当前实现包含七个 Dashboard（Production Overview / JVM-Infrastructure / HTTP-Errors / Replay Parser / 使用统计 / AI Review / Error Explorer）、AI 指标在服务边界统计、日志安全与保留策略。

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
| Grafana | `grafana/grafana:11.6.16` | 可视化，provisioning 自动配置 Datasource + Dashboard |
| Grafana MCP server（已下线） | 已移除 | 2026-08-11 因公网匿名访问风险（MCP 缺少调用者认证）且使用频率低，已从生产与本地 compose 移除；宿主 Caddy `/mcp*` 路由与 Grafana MCP Service Account 由人工清理 |

**关键安全边界**

- Grafana `3000`、Prometheus `9090`、Loki `3100`、Alloy `12345`、Backend 管理端口 `8088` **均不映射到宿主机端口**，只在 Docker 内部网络可达。
- 公网只能通过 `monitor.wotbtools.com`（host 层 TLS 反代 → frontend nginx → `grafana:3000`）访问 Grafana，且 Grafana 禁止匿名访问。
- `/actuator/**` 不通过公网域名暴露（nginx 只代理 `/api/` 与 `monitor.*` 到 Grafana）。

**Grafana MCP 下线记录（2026-08-11，P0）**

生产 `mcp-grafana` 曾把 Grafana Service Account Token 当作调用者认证使用，实际该 Token 仅是访问 Grafana 的后端凭据：未设置 `MCP_GRAFANA_SERVER_TOKEN`/`--server-auth-token` 时，公网 `/mcp` 的匿名 MCP initialize 返回 200 并建立 session。因使用频率低，选择**彻底下线**而非加固：

- 仓库侧（已完成）：生产与本地 compose 移除 `mcp-grafana`；部署链路不再传递 `GRAFANA_MCP_TOKEN`；CI 增加「生产 compose 不得含 MCP 服务 / 8000 端口」回归断言。
- 生产侧（已完成，2026-08-11）：`docker rm -f wotb-mcp-grafana-1` 移除容器、8000 端口关闭；宿主 Caddy（`wotb-caddy` 容器，配置 `/opt/caddy/Caddyfile`）将 `/mcp*` 从反代改为 `respond 404` 并热重载，外部验证 `https://monitor.wotbtools.com/mcp` → 404。
- 剩余人工步骤（Grafana / GitHub，仓库外）：
  1. Grafana：删除或禁用 MCP 专用 Service Account（若保留则降为 Viewer 只读），并吊销/删除其 Token。
  2. GitHub 仓库 Settings → Secrets：删除 `GRAFANA_MCP_TOKEN`（代码已停止引用）。
  3. 轮换 Grafana admin 密码（2026-08-11 排障时一次命令参数错误曾将 `GRAFANA_ADMIN_PASSWORD` 输出到终端日志）。

**生产 Caddy 运维注意（2026-08-11 实战教训）**

- `wotb-caddy` 由 `/opt/caddy/docker-compose.yml` 管理（`caddy:2`，host 网络），`/opt/caddy/Caddyfile` 以 bind mount 挂载到容器 `/etc/caddy/Caddyfile`。
- **禁止用 `sed -i` 编辑挂载文件**：`sed -i` 通过重命名替换文件，会破坏 bind mount 的 inode 关联，容器内会继续读到旧内容（`docker cp` 也会因 unlink busy 失败）。必须原地写入（`vi` / `tee` / `cp`）。
- 改完热重载：`docker exec wotb-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`（先 `caddy fmt --overwrite` 可消除格式告警）。

如需恢复 MCP，必须：固定 release + digest、设置 `MCP_GRAFANA_SERVER_TOKEN`/`--server-auth-token`（匿名 401）、启用 `--disable-write` 只读、Service Account 仅 Viewer 权限。

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
   - 生成密码示例：`openssl rand -base64 24`
   - 部署时 CI 将凭据写入生产服务器 `/opt/wotb/.env`（`chmod 600`），compose 使用 `required` 语法引用，**Grafana 密码不落入 compose 文件本身**；密码为空时部署脚本中断（见 `deploy.yml`）。

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

合并到 `main` 触发 `deploy.yml`：SSH 到 `/opt/wotb` 先写入 `docker-compose.next.yml`（含观测服务，三个 wotb 镜像钉住 `sha-<SHA>`）、`docker compose -f docker-compose.next.yml pull`；`pull` 成功后才备份 `docker-compose.prev.yml` 并替换正式 compose，再 `up -d --remove-orphans`。观测配置随 `deploy/` 一起 scp 到 `/opt/wotb/deploy/observability/`。部署后三端健康检查（backend `/api/health`、frontend 经 nginx E2E、Keycloak realm）失败会自动回滚到上一份 compose 并复检；pull 失败不触碰正式 compose 与回滚目标。回滚事件可从 Actions 日志与 Loki 中的容器日志追溯。

> **新版本失败诊断（Health check 超时回滚前）**：健康检查最终失败时，`deploy.sh` 会先输出各服务状态（`report_health_status`：backend/frontend/keycloak 各 `PASS/FAILED/SKIPPED`），再 `dump_logs` 保留新版本 `docker compose ps -a`、容器 `docker inspect` 与 backend/frontend/keycloak 三服务 logs，最后才进入回滚。因此新版本启动异常不会再被 rollback 覆盖，可在 Actions 日志与 Loki 中定位。诊断命令均独立容错，若采集失败也不会阻断回滚。

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

> **应用回滚**由 `deploy.yml` 自动处理（恢复 `docker-compose.prev.yml`），不会触碰 `postgres_data` 等 volume；数据库 schema 迁移随新版本启动执行，回滚策略见 `DEVELOPER_GUIDE.md`「CI/CD 与部署」。

---

## 5. 验证方法

### CI 实际验证项（PR 时自动执行，见 `.github/workflows/ci.yml` `observability-config` job）

> **CI 验证边界**：仅验证「本地」`docker/online/docker-compose.yml` 与各组件**配置文件语法/结构**。
> 不验证生产 `deploy.yml` heredoc 渲染结果，不验证指标名真实存在（只有生产实际采集后才知道），
> 不运行任何完整组件。

| 验证项 | 命令 | 说明 |
|---|---|---|
| 本地 compose 语法 | `docker compose config --quiet` | 仅本地 compose，不含生产 heredoc |
| Prometheus 配置 | `promtool check config` | 配置语法 |
| Loki 配置 | `loki --verify-config` | 配置语法 |
| Alloy 配置 | `alloy fmt -t` | **仅格式/语法检查**，非完整组件运行验证 |
| Grafana provisioning + Dashboard JSON | `python` 解析全部 YAML/JSON | 结构校验 |
| 端口安全 | `docker compose config --format json` 校验 prometheus/loki/alloy/grafana/wotb-backend 无宿主端口映射 | frontend 8088:80 合法 |
| Backend 测试 | `mvn test`（含 `RequestIdFilterTest`、`CustomTimerPrometheusTest`、`LogstashMdcTopLevelTest`、`AiReplayAnalysisServiceUpstreamMetricsTest`） | 单元/集成测试 |

### 手动验证命令（生产部署后执行）

```bash
# compose 语法
docker compose config --quiet

# Prometheus 配置检查（容器内 promtool）
docker run --rm -v /opt/wotb/deploy/observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro prom/prometheus:v2.55.1 promtool check config /etc/prometheus/prometheus.yml

# Loki 配置检查
docker run --rm -v /opt/wotb/deploy/observability/loki/loki-config.yml:/etc/loki/loki-config.yml:ro grafana/loki:3.3.2 -config.file=/etc/loki/loki-config.yml -verify-config

# Alloy 配置格式/语法检查（与 CI 相同命令）
docker run --rm -v /opt/wotb/deploy/observability/alloy/config.alloy:/etc/alloy/config.alloy:ro grafana/alloy:v1.4.2 fmt -t /etc/alloy/config.alloy
```

> `alloy fmt -t` 只是格式/语法检查，**不代表 Alloy 能正常运行**。
> 完整 Alloy 验证（docker.sock 采集 → Loki 收到日志）需在生产容器启动后，通过
> `docker logs alloy` 与 Loki 查询实际日志确认。

### 需生产环境手动验证（CI 无法覆盖）

- 完整整栈启动（业务 + 观测 8 容器，含生产 `deploy.yml` heredoc 生成的 compose）
- Alloy 实际采集 backend 日志并推送到 Loki、`requestId` 可过滤
- `/actuator/prometheus` 实际输出（**指标名真实存在**，与 Dashboard 面板匹配——CI 只检查配置结构，无法验证指标）
- Volume 重启后数据持久化（7 天保留）
- `docker stats` 实际资源占用（空闲约 1GB 目标）
- 公网无法访问 8088/9090/3100/3000/12345

---

## 6. Grafana 登录与 Dashboard

1. 浏览器访问 `https://monitor.wotbtools.com`（或本地 `http://localhost:3000`，需临时 `docker run -p 3000:3000` 映射）。
2. 使用 `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` 登录（匿名访问已禁用：`GF_AUTH_ANONYMOUS_ENABLED=false`）。
3. 首次启动后，provisioning 自动创建：
   - Datasource：`Prometheus`（uid `prometheus`，`http://prometheus:9090`）、`Loki`（uid `loki`，`http://loki:3100`）
   - Dashboard：
     - **WotBTools JVM / Infrastructure**（uid `wotbtools-backend-overview`）— process/system CPU、heap、memory pool、GC、线程、Hikari、磁盘与诊断日志；保留原 UID 兼容已有链接
     - **WotBTools HTTP / Errors**（uid `wotbtools-http-errors`）— 请求/状态码次数、URI Top 10、过滤低样本慢 URI 的 P95、P50/P95/P99 趋势与 Loki errorCode 分布
     - **WotBTools Replay Parser**（uid `wotbtools-replay-parser`）— 回放解析功能使用情况
     - **WotBTools 使用统计**（uid `wotbtools-usage`）— Replay Processing Job/files/success/failure 与 AI Review started/success/failure/rejected（均按 Grafana 所选时间范围估算增量，非永久累计）
     - **WotBTools Production Overview**（uid `wotbtools-production-overview`）— 首屏按当前 Grafana 时间范围展示请求/4xx/5xx、HTTP P50/P95/P99、Replay/AI 次数与当前并发；下方保留精简趋势、资源摘要和 Deferred Metrics Gaps
     - **WotBTools AI Review**（uid `wotbtools-ai-review`）— AI started/completed/failed/rejected、duration P50/P95/P99、queue/upstream P95、validation/error 与 SSE lifecycle 日志
     - **WotBTools Error Explorer**（uid `wotbtools-error-explorer`）— 按 service、diagnostic id、errorCode、traceId、jobId 检索 Loki 错误日志；同时覆盖 canonical `api_request_failed` ERROR 与 `api_request_rejected` INFO

所有看板只使用现有 Prometheus/Loki 数据源和 Backend 已导出的指标，不新增 node exporter、cAdvisor 或其他采集基础设施。Production Overview 只保留 Backend process/system CPU、JVM heap、GC 摘要；其余实现细节迁移到 JVM / Infrastructure。RabbitMQ/worker queue、oldest queued age、worker health 与 host-level 指标暂为 Deferred Metrics Gaps。

Error Explorer 的 `service` 变量映射 Loki 的 `container_name` 标签；`id` 是 canonical error 的主诊断 ID，其余变量作为日志内容中的 regex token 搜索，用于关联结构化日志里的 `errorCode`、`traceId` 与 `jobId`。当前没有 authoritative deployment/build version 字段，因此不提供 `version` filter。

Spring Security 的 401/403（`AUTH_UNAUTHENTICATED` / `AUTH_FORBIDDEN`）也会以 INFO 级 `api_request_rejected` 写入同一组 `traceId`、`id`、`errorCode`、`status`、`method`、`path` 字段，因此可直接用 response body 的 `id` 在 Error Explorer 定位。

Production Overview 的 Replay 统计使用线上实际暴露的 `wotb_replay_processing_job_total`、`wotb_replay_full_processing_total`、`wotb_replay_processing_job_result_total` 与 `wotb_replay_processing_file_duration_seconds_*`；不使用当前线上无样本的 legacy `wotb_replay_requests_total` / `wotb_replay_parse_duration_seconds_*` 作为 V2 Processing Job 信号。

**统计口径说明（WotBTools 使用统计 / Replay Parser）**

- Prometheus Counter 会在 Backend 重启或重新部署后归零，Dashboard 中的"次数"均为 **Grafana 所选时间范围内的估算增量**（`increase()` + `round()`），不是历史累计。
- **Replay jobs / files**：当前 V2 使用 `wotb_replay_processing_job_total`、`wotb_replay_processing_job_files_total` 与 `wotb_replay_full_processing_total`；它们描述 Processing Job 和实际 full processing，不再把 legacy operation 请求误当作当前处理入口。
- **AI Review 请求次数**：统计所有请求尝试，包括成功、失败、超时和被拒绝，不等同于成功次数。
- **AI Review 成功次数**：仅统计 `wotb_ai_review_results_total{result="success"}`；**未成功次数**保留 `failure` 与 `rejected` 独立标签，不混为同一结果。
- **AI 平均每次调用 Token**：`wotb_ai_upstream_tokens_total{token_type="total"}` 增量 ÷ `wotb_ai_upstream_requests_total` 增量（分母含失败调用，失败计 0 token），即「平均每次发起的 AI 上游调用消耗的 token」；按模式面板可区分单机复盘（`PRE_BATTLE_STRATEGIC_PRIOR` + `TACTICAL_REVIEW_HARNESS`）与团队复盘（`SINGLE_TEAM_BATTLE` + `TEAM_AUTOPSY`）各阶段消耗。
- **数据保留**：Prometheus 仅保留约 7 天，不提供网站历史永久累计；如未来需要永久累计，应写入 PostgreSQL（当前不引入），而非依赖 Counter。

**WotBTools Replay Parser 面板清单**（uid `wotbtools-replay-parser`）

1. Backend Up
2. Processing Job started（`wotb_replay_processing_job_total`，所选区间）
3. Files processed（`wotb_replay_full_processing_total`，所选区间）
4. Succeeded / Failed Processing Jobs（`wotb_replay_processing_job_result_total`）
5. 当前 parse active / queue depth / jobs active / queued
6. 解析耗时 P50/P95/P99（`wotb_replay_processing_file_duration_seconds_*`）
7. Processing Job outcome trend 与最近 Replay 错误日志

> Processing Job 的成功/失败使用 `wotb_replay_processing_job_result_total` 终态计数；不再统计 legacy `wotb_replay_results_total`，
> 因为它无法可靠区分解析失败与异常路径（见指标清单）。

**旧 Backend Overview 已迁移为 JVM / Infrastructure；生产首页面板清单**

1. Backend Up、请求数、4xx、5xx、HTTP P50/P95/P99（首屏）
2. Replay jobs/files/success/failure 与 parse active/queued
3. AI started/success/failure/rejected 与 active
4. HTTP、Replay、AI 的 P50/P95/P99 趋势与 outcome trend
5. 精简 CPU、heap、GC 摘要
6. Recent backend errors / warnings（Loki）
7. Deferred Metrics Gaps（不生成不存在指标的假面板）

> Dashboard JSON 提交在 `deploy/observability/grafana/dashboards/`，volume 丢失后随 provisioning 自动重建。
> 面板查询基于上述指标名编写；**每个面板是否有真实数据支撑，需在生产实际产生流量后确认**（CI 仅校验 JSON 结构与指标名存在，无法验证面板有数据）。

---

## 7. 日志查询与 requestId 排查

Backend 日志为**结构化 JSON**（`logging.structured.format.console: logstash`）。MDC 的 `requestId` 与同值别名 `traceId` 输出为顶层 JSON 字段（不是 `mdc.*` 子对象；由 Spring Boot 4 `LogstashStructuredLogFormatter` 的 `ContextPairs.flat` 保证）。canonical error response 的 `body.id` 是唯一错误 id（typed `ApiException` 返回异常实例 id，非 typed/security/legacy 返回请求关联 id，等于响应头 `X-Request-ID`）；5xx 日志同时携带 `traceId=<requestId>` 与 `id=<body.id>`。

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

1. 请求响应头 `X-Request-ID` 会带回一个 UUID（或沿用并清洗请求头传入值）；错误 JSON 的 `id`（非 typed/security/legacy 错误）与其一致。用户界面的“诊断 ID”即该值；对 typed `ApiException`，`id` 为异常实例 id，后端日志 `id=<value>` 可检索到同一异常。
2. Loki 查询：

```logql
{container_name="wotb-backend"} | json | requestId="<requestId>"
```

3. 也可用 Error Explorer 顶部的 `service`、`id`、`errorCode`、`traceId`、`jobId` 变量 + Loki 面板联动；默认 service 为 `wotb-backend`，其它过滤器默认 `.*`。

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
`AI_TIMEOUT`、`AI_CANCELLED`（客户端取消，上游调用被中断，不产生新请求）、`AI_UPSTREAM_UNAVAILABLE`、`AI_INVALID_REQUEST`、`AI_AUTHENTICATION_ERROR`、`AI_RATE_LIMITED`、`AI_CONTEXT_TOO_LARGE`、`AI_RESPONSE_INVALID`、`AI_EMPTY_RESPONSE`。

> **AI 全链路超时与无效消耗**：整体 deadline 默认 1100s（团队 3 次 AI 调用 + 余量，`AI_REVIEW_WORKER_OVERALL_DEADLINE_SEC`）→ 前端 analyze 安全超时 1100s → 容器 nginx `/api/replay/analyze` 1120s → 后端 AI 单次预算 `AI_CALL_TIMEOUT_SEC=315s` + 解析余量。**host 级 Caddy/Nginx 反代必须允许 ≥1120s**（Nginx 默认 60s 会提前 504，用户重试即产生重复 API 消耗）。取消语义：**应用内路由切换因 `App.vue` 的 `<KeepAlive>` 缓存 AI 复盘页而不会取消进行中的复盘**（SSE 流继续）；只有**手动取消按钮、关闭/刷新浏览器页面（`beforeunload`）或前端安全超时**才会经 `POST /api/replay/analyze/cancel` 中断 in-flight 上游调用。`AI_TIMEOUT` 不再自动重试（上游可能已计费）。Broken pipe 已在 `GlobalExceptionHandler` 降级为 WARN，不再产生 Unhandled exception 堆栈。
### AI Review 全链路事件日志（按 correlationId 追踪）

> 随 AI Review JSON Output 任务（见 docs/architecture/ai-review.md）落地：AI Review 全链路结构化事件日志，
> 统一格式 `event=<eventName> correlationId=<id> key=value key=value`，与 logstash structured logging 兼容，
> Loki 可直接按字段过滤。**一次 AI Review 从进入 backend 到结束可用单个 correlationId 重建完整时间线**
>（correlationId 即前端 cancel 用的请求 id，见 `ReconstructionController`）。
>
> 日志纪律：只记录低基数 metadata——严禁 prompt / completion / reviewMarkdown / API key /
> Authorization / 回放原始内容 / 用户上传文件内容 / 明文昵称（身份用 account hash / vehicle id）。

#### 追一单

```bash
docker compose logs wotb-backend --since 30m 2>&1 | grep "correlationId=<id>"
```

或 Loki：

```logql
{container_name="wotb-backend"} | json | message=~"correlationId=<id>.*"
```

典型一条成功时间线（team 模式）：

```text
event=ai_review_sse_opened correlationId=...
event=ai_review_started correlationId=... language=ZH fileCount=1
event=ai_upstream_call_started correlationId=... stage=PRE_BATTLE mode=PRE_BATTLE_STRATEGIC_PRIOR attempt=1 responseFormat=TEXT
event=ai_upstream_call_completed correlationId=... attempt=1 promptTokens=... completionTokens=...
event=team_review_grounding_ready correlationId=... factsTotal=... deathFacts=...
event=ai_prompt_budget correlationId=... stage=TEAM_CALL_2 attempt=1 estimatedInputTokens=... maxOutputTokens=...
event=ai_upstream_call_started correlationId=... stage=TEAM_CALL_2 attempt=1 responseFormat=JSON_OBJECT
event=team_review_validation_attempt_completed correlationId=... attempt=1 promptTokens=... cumulativePromptTokens=...
event=team_review_parse_result correlationId=... attempt=1 responseFormat=JSON_OBJECT result=PASS
event=team_review_validation correlationId=... attempt=1 result=FAIL conflictCount=2 checks=BINDING,V5
event=ai_validation_retry correlationId=... stage=TEAM_CALL_2 validationAttempt=2 reason=VALIDATION_FAILED
event=team_review_validation correlationId=... attempt=2 result=PASS conflictCount=0
event=team_review_completed correlationId=... validationAttempts=2 totalPromptTokens=... result=PASS
event=ai_review_sse_completed correlationId=... durationMs=...
event=ai_review_finished correlationId=... result=SUCCESS durationMs=...
```

#### 事件清单（低基数，禁止高基数字段）

| event | 关键字段 | 含义 |
|---|---|---|
| `ai_review_sse_opened` / `ai_review_sse_completed` | durationMs | SSE 生命周期 |
| `ai_review_started` | language, fileCount | 请求开始 |
| `ai_review_finished` | result=SUCCESS/FAILED/CANCELLED, errorCode（FAILED）, source（CANCELLED）, durationMs | **唯一终态，exactly once**（每个真正开始执行的 worker 请求恰好一次；FAILED 带稳定 errorCode，CANCELLED 带稳定 source） |
| `ai_review_failed` | errorCode, exceptionClass, elapsedMs | 失败诊断事件（随 FAILED 终态一起出现，非终态本身） |
| `ai_review_cancelled` | source=CANCELLED_WHILE_QUEUED / SSE_DISCONNECT | 取消诊断事件（INFO 非 ERROR，随 CANCELLED 终态一起出现） |
| `ai_upstream_call_started` | stage, mode, attempt, model, responseFormat, thinking, maxOutputTokens, remainingBudgetSec | 每次上游调用 |
| `ai_upstream_call_completed` | attempt, durationMs, promptTokens, completionTokens, totalTokens | 上游成功（不记录硬编码 providerStatus——成功响应无真实 transport status metadata，真实 status 只在失败事件） |
| `ai_upstream_call_failed` | attempt, errorCode, providerStatus, retryable | 上游终态失败（providerStatus 为异常携带的真实 status） |
| `ai_transport_retry` | stage, retryNumber, reason, backoffMs | 传输层退避重试（与 validation retry 区分；retryNumber 为 1 基重试序号，retryNumber=1 → 下一次上游调用 attempt=2） |
| `ai_prompt_budget` | stage, attempt, estimatedInputTokens, maxOutputTokens, contextWindowTokens, remainingBudgetSec | 发送前预算（token amplification 观测） |
| `team_review_grounding_ready` | factsTotal, deathFacts, aliveTransitions, focusWindows, positionSnapshots, enemyPositionFacts | grounding 事实计数 |
| `team_review_validation_attempt_completed` | attempt, promptTokens, completionTokens, cumulativePromptTokens, cumulativeCompletionTokens | 每轮 token 累计 |
| `team_review_parse_result` | attempt, responseFormat, result=PASS/FAIL, reason | parser 结果分类 |
| `team_review_validation` | attempt, result=PASS/FAIL, conflictCount, checks, durationMs | validator 结果 |
| `team_review_validation_conflict`（DEBUG） | attempt, check, reasonCode | 冲突机器分类明细 |
| `ai_validation_retry` | stage, validationAttempt, reason | 业务返工重试 |
| `team_review_completed` | validationAttempts, totalPromptTokens, totalCompletionTokens, durationMs, result | Team Call #2 阶段汇总 |

#### parser 失败分类（低基数枚举）

`EMPTY_OUTPUT` · `INVALID_JSON` · `MISSING_PRIMARY_DIAGNOSIS` · `MISSING_REVIEW_MARKDOWN` · `INVALID_CLAIMS` ·
`UNKNOWN_CLAIM_TYPE` · `INVALID_MACHINE_FIELD_TYPE` · `MISSING_REQUIRED_MACHINE_FIELD` · `TOO_MANY_CLAIMS` · `TOO_MANY_EVIDENCE_IDS`

#### validator conflict reasonCode（机器分类）

`UNKNOWN_EVIDENCE` · `EVIDENCE_TYPE_MISMATCH` · `SUBJECT_MISMATCH` · `TIME_MISMATCH` · `REGION_MISMATCH` ·
`KNOWLEDGE_MISMATCH` · `COUNT_MISMATCH` · `UNSUPPORTED_HARD_FACT` · `TEMPORAL_OWNERSHIP` · `IDENTITY_AMBIGUITY` ·
`CLAIMS_COVERAGE` · `INTERNAL_LABEL_LEAK` · `EMPTY_OUTPUT` · `MISSING_DIAGNOSIS`（其余按 checkId 推断为 `UNCLASSIFIED`）

#### 常见错误码排障

- **`AI_REVIEW_GROUNDING_FAILED`**（502）：Team Call #2 三次 validation attempt 全部 FAIL 后 fail-safe（当前行为保持不变）。
  查 `event=team_review_validation` 的 `checks` 与 `event=team_review_validation_conflict` 的 `reasonCode` 判断是哪个 check 反复失败；
  `event=team_review_validation_attempt_completed` 看 token 放大（`cumulativePromptTokens`）。
- **`AI_TIMEOUT`**：分 provider read timeout / 整体预算耗尽 / SSE timeout 三种；查 `event=ai_upstream_call_failed` 与调用耗时、remainingBudgetSec。
- **`AI_UPSTREAM_UNAVAILABLE`**：上游 5xx / 连接失败；`event=ai_transport_retry` 记录退避重试。
- **`AI_CANCELLED`**：客户端取消（cancel 端点 / SSE 断开）；查 `event=ai_review_cancelled` 的 `source`。

---

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
- **AI Review**（自定义，`AiReplayReviewService.analyze` 边界，**一次进入 worker 的请求 = 一次 Review**）：
  - `wotb_ai_review_requests_total` — Review 请求量（每次 analyze +1，与上游调用次数无关）
  - `wotb_ai_review_results_total{result=success|failure|rejected}` — 结果（rejected 为流内拒绝：AI 未配置/不支持战斗类型/perspective 未确定/token budget 拒绝；混合批次中单文件解析失败返回 FAILED 结果不抛异常，计入 success 的请求完成语义）。**注意**：SSE worker 池饱和（503 `AI_REVIEW_BUSY`）与 request-envelope 预校验失败（文件数超限 `REPLAY_FILE_COUNT_EXCEEDED` / 文件类型非法 / 文件过大 / 总大小超限 / 未知 locale）由 `@ExceptionHandler` 在提交 worker 前同步返回 HTTP 400/503，**不进入 `analyze`，不计入这些 AI Review 计数器**——只能在 `http_server_requests_seconds_*`（按 status 4xx/5xx）与 nginx access log 中观察；监控告警须结合两者，不能只看 `wotb_ai_review_*`。
  - `wotb_ai_review_errors_total{type=<固定枚举>}` — 错误分类（仅流内失败，与 `failure` 一致；HTTP 4xx 预校验失败不在此处计数）
  - `wotb_ai_review_duration_seconds` — Review 完整总耗时（Timer，histogram，成功与异常都结束，覆盖文件验证→解析→分析→AI 调用→响应处理）
  - `wotb_ai_review_in_flight` — 当前处理中的 Review 数（Gauge，即"已进入 worker、尚未完成"的请求数；不含队列中等待的请求，也不含被 `AI_REVIEW_BUSY` 回绝的请求）
  - `wotb_ai_review_queue_wait_seconds` — worker 排队等待时长（Timer，histogram；由 `wotb_ai_review_queue_wait_seconds_bucket` 支撑 P95）
  - `wotb_ai_team_review_validation_attempt_total{result=pass|parser_invalid|validation_failed|metadata_only_pass}` — Team Call #2 validation attempt 分类；`parser_invalid` 与 `validation_failed` 表示 rework/失败尝试
- **AI upstream**（自定义，`SpringAiChatGateway.chat`，每次上游调用）：
  - `wotb_ai_upstream_requests_total{mode}` — 上游请求量（每个 attempt +1，含 retry 重试；token budget 拒绝不进入 gateway，不计）
  - `wotb_ai_upstream_success_total{mode}` — 成功调用数（一次逻辑调用 +1）
  - `wotb_ai_upstream_errors_total{type=<枚举>}` — 失败调用数（重试耗尽后的最终失败 +1，不按 attempt 重复累计）
  - `wotb_ai_upstream_duration_seconds` — 调用总耗时（Timer，histogram，含重试；成功与最终失败都结束，token budget rejection 不计时长）
  - `wotb_ai_upstream_retries_total{mode}` — retry 重试次数
  - `wotb_ai_upstream_retry_outcome_total{mode,outcome=no_retry|success_after_retry|failure_after_retry}` — 重试结果
  - `wotb_ai_upstream_tokens_total{mode,token_type=input|output|total|reasoning|cache_hit|cache_miss}` — token 用量（usage 缺失时不记录）
- **Replay 解析**（自定义）：
  - `wotb_replay_processing_job_total` — 线上 Prometheus 暴露的 Processing Job 创建数（Java 逻辑名为 `wotb_replay_processing_job_created_total`，Micrometer 运行时规范化为该名称）
  - `wotb_replay_processing_job_files_total` — Processing Job 输入文件数（低基数，无 jobId/文件名 tag）
  - `wotb_replay_processing_job_queue_wait_seconds` / `wotb_replay_processing_job_duration_seconds` — 排队等待与总耗时（Timer）
  - `wotb_replay_processing_job_result_total{result=ready|failed|cancelled}` — 终态计数（exactly once）
  - `wotb_replay_processing_file_duration_seconds` — 单个 replay full processing 耗时（p50/p95 用于评估并行化收益，无 filename tag）
  - `wotb_replay_full_processing_total` — 当前 V2 full processing 文件数
  - `wotb_replay_processing_file_duration_seconds` — 当前 V2 单个 replay full processing 耗时（Timer，histogram）
  - `wotb_replay_parse_active` / `wotb_replay_parse_queue_depth` — 当前并行处理数与排队 source 数
  - `wotb_replay_in_flight` — legacy 解析入口当前处理数（Gauge）
  - `wotb_replay_requests_total{operation}` / `wotb_replay_files_total{operation}` / `wotb_replay_parse_duration_seconds{operation}` — legacy operation 指标，保留用于兼容入口，不被当前 V2 dashboard 作为主信号

> **不统计 `wotb_replay_results_total`**：解析失败以 `ReplayProcessingResult.status=FAILED` 返回而非抛异常，
> 异常判定无法可靠区分 success/failure，故删除该指标（AI Review 自己的 `results_total` 不受影响）。

**Label 约束**：不使用用户 ID、Replay ID、文件名、IP、correlation ID、Prompt、Completion、异常正文作为 label；URI 一律为 Spring MVC 模板（如 `/api/preview`）。Token Usage 仅以低基数 `mode`/`token_type` 统计。

---

## 11. 日志安全

结构化日志**不会**包含：Authorization Header、Token、API Key、密码、Replay 文件内容、解析后的完整战斗数据、完整 Prompt/AI 响应、请求体、用户个人信息。AI 上游错误体被 `[PROVIDER_BODY_REDACTED]` 脱敏；`X-Request-ID` 限制 128 字符防注入。
