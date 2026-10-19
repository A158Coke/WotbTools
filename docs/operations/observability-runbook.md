# Observability 运行手册

## 首要检查

Grafana：https://monitor.wotbtools.com。Home 为 **Active users**；所有 dashboard 默认显示北京时间最近 24 小时。选择 Today 表示本地自然日。永远不要把 No data 解释为已验证的零用量。

在 Yecao 上：

```bash
cd /opt/wotb
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 alloy loki prometheus ai-service
```

在 TX 上：

```bash
cd /opt/wotb-tx
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 alloy-tx business-api keycloak
```

Prometheus 必须有七个 UP job：wotb-backend（WireGuard `10.20.0.1:8088`）、ai-service、node-exporter、prometheus、loki、grafana、dev-metrics（工程 exporter `dev-metrics-exporter:9108`）。Node-exporter 只覆盖 Yecao；其他宿主资源视图使用既有 Komodo。Keycloak 没有 Prometheus job，也没有独立的管理端点契约；使用 OIDC discovery 与日志。

## 活动或功能数据缺失

1. 确认客户端包含新的 telemetry producer；旧的 Web bundle/APK 无法发出这些事件。
2. 在 DevTools 中确认 `/api/observability/events` 返回 204。永远不要把 bearer header 或请求标识复制进工单。
3. 若 active-user 返回 503，确认 business-api 运行时配置了至少 32 个字符的 `WOTB_OBSERVABILITY_HASH_KEY`，且不要打印它。配置 repository 级 Actions secret，并按常规部署 owner。401 表示没有有效的已验证身份；不要绕过认证。
4. 检查 business-api 结构化日志中的 `event=product_telemetry`，再检查 TX Alloy → WireGuard → Yecao Loki。
5. 事件是尽力而为的；离线/被阻止的上传与关机都会造成少计。查询序列上限错误是显式失败，不是部分总体。在提高限额之前先检查 Loki 日志与查询成本。

```logql
{container_name="wotb-backend"} |= "event=product_telemetry " | json | line_format "{{.message}}" | logfmt
```

## 定位错误

打开 **Backend error logs**，选择时间/来源，然后输入字面关键词或 Error ID。功能行覆盖登录、HoF、积分赛、AI、客户端解析及其他错误。展开记录可查看 path、稳定 error code、来源 service 与安全的服务器诊断。客户端解析行是用户设备上报，不是服务器故障的证据。原始回放名称或异常文本被有意省略。

对于 Keycloak 回调，使用登录行加 Caddy/Keycloak 来源与 OIDC discovery；保留既有 deployment E2E auth-token 探针。永远不要为了让探针通过而降低 TLS 校验。

对于 AI，搜索 correlation/error ID 并跟踪 `ai_upstream_call_failed`、`ai_review_contract_failed`、`ai_review_recovery_triggered`、`ai_review_recovery_failed`、`team_review_completed`，以及安全的 `ai_review_error` 事件。这些事件来自 `container_name="ai-service"`，不是 backend stream。旧版 `ai_review_started/finished/failed` 生命周期名称没有 producer；不要依赖它们。

```logql
{container_name="ai-service"} | json | line_format "{{.message}}" | logfmt | event=~"ai_token_usage|ai_review_usage|ai_review_error"
```

## 下载与 token 问题

- Android downloads 区分 200、206 与失败。部分请求计数不是安装计数。若缺少某个版本，检查 nginx 访问输出与脱敏后的 frontend Loki stream。
- AI 总量统计接收时刻的已知用量。平均值统计完成时刻的终态评审。在与 provider 账单比较之前先检查 usage-missing 调用；取消/超时会隐藏 provider 从未返回的计费用量。
- 页面浏览不是成功操作。回放解析按文件统计独立的启动与结果，而不是打开工作区。

## 保留与恢复

普通 telemetry stream 的可查询历史限制为七天；`{compliance="security"}` stream 保留 4560h（190 天），查询回看可到 190 天，但单次查询长度仍限制在 7 天。Loki 物理 compaction 是异步的；原始 Docker 日志仍按大小轮转，可能比查询窗口活得更久。不要声称严格的七天物理擦除，不要添加长期 telemetry 备份，不要删除活跃的 Docker 日志文件，也不要使用 `docker compose down -v`。

dashboard 变更通过 `infra/tofu/grafana` 与 observability owner workflow 应用。任何 dashboard 都可以无 allowlist 地删除/替换；datasource 删除仍然禁止。从 Git 恢复内容的方式是恢复声明并 apply 经评审的 plan，而不是覆写线上 state。部分 apply 需要先检查当前 state 并重新 plan；不要自动恢复旧 state。

生产验收：验证真实用户活动、一批十个回放文件的成功/失败/取消路径、页面重新进入、APK 200/206 行为，以及 AI 已知/缺失用量。仅靠 deployment canary 不能证明这些用户流程。
