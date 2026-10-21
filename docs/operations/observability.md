# Observability 与产品用量

dashboard 回答维护者的问题：谁使用了产品、打开了哪些功能、解析了多少份回放、用户点击了多少次最终 APK 下载按钮、消耗了多少 AI token，以及出现了哪些错误。没有新增告警或通知系统。

## 归属与拓扑

- Yecao 托管 Prometheus、Loki、Alloy、Grafana、node-exporter、dev-metrics-exporter 以及独立的 ai-service。
- TX business-api 在 WireGuard `10.20.0.1:8088` 上暴露管理指标。TX `alloy-tx` 把 business-api、Keycloak、frontend APK 下载与 Caddy 日志发送到 Yecao 的 Loki（`10.20.0.2:3100`）。
- Yecao Alloy 按精确的 Compose service label 采集 `ai-service`。其基于名称的 backend/Keycloak/frontend 规则保留给部署 canary。
- Grafana 在 `10.20.0.2:3000` 上私有运行，经 TX Caddy 在 https://monitor.wotbtools.com 暴露。匿名登录与注册均已禁用。
- `infra/tofu/grafana` 单独拥有 dashboard；canonical JSON 位于 `deploy/observability/grafana/dashboards`。datasource 仍由只读文件 provisioning 提供，UID 为 `prometheus` 与 `loki`。
- 既有 Komodo/Periphery 主机监控保持独立，本文不做改动。

## 看板

五个产品 dashboard 默认显示最近 24 小时，使用 `Asia/Shanghai` 时区，并在五个产品看板之间互相导航且保留所选时间范围。Engineering Overview 是独立的第六个 dashboard，可单向跳转到这五个产品看板；产品看板不反向链接 Engineering Overview。**Today** 指北京时间当天零点到现在。可选择最近 7 天，或在保留窗口内的自定义范围。空结果展示为 No data，而不是已验证的零。

| 看板 | UID | 度量内容 |
|---|---|---|
| Engineering Overview | wotbtools-engineering-overview | GitHub PR/CI 聚合、历史、新鲜度与生产相关性 |
| Active users (home) | wotbtools-active-users | 收到前台活动信号去重后的认证账号数 |
| Feature usage | wotbtools-feature-usage | 按 Web/Android 划分的逐文件解析启动/结果与页面/能力打开数 |
| Android downloads | wotbtools-android-downloads | Web `/download/android` 页面最终「下载 APK」按钮点击次数 |
| AI token usage | wotbtools-ai-token-usage | 已知的输入/输出/总 token、单次评审平均值与缺失用量 |
| Backend error logs | wotbtools-backend-error-logs | 登录、HoF、积分赛、AI、客户端解析及其他错误分区 |

六个已退役 dashboard（与当前六个 UID 是不同集合）通过 OpenTofu 删除。dashboard 的删除与替换是普通的 desired-state 操作：**没有 delete allowlist**。datasource 删除仍然禁止。永远不要删除 Grafana volume，也不要通过编辑 state 来删除 dashboard。

## 客户端遥测

`POST /api/observability/events` 接收由 `contracts/http/openapi.yaml` 描述的有界批量请求。backend 在记录任何事件之前严格校验字段、枚举、时间戳、批量/请求体大小与请求速率。它从不接受任意客户端日志文本、账号身份、文件名或回放内容。

- 限额是在完整校验有界批量之后按固定分钟计的**事件**配额：认证 subject 各 120 事件/分钟，共享一个认证 6000 事件/分钟的池；匿名来源各 120 事件/分钟，共享独立的匿名 6000 事件/分钟池。20 事件的批量消耗 20；非法或超额批量不消耗配额，也不产生 telemetry。每个池最多跟踪 4096 个 key；key map 满时拒绝新身份，既有身份仍可使用剩余配额。分钟滚动会重置两个池与 map。
- 仅当 socket peer 匹配 `WOTB_OBSERVABILITY_TRUSTED_PROXIES`（默认为空）时，匿名来源才使用归一化后的 `X-Real-IP`。TX Compose 显式信任私有 `wotb_tx_internal` bridge `172.29.0.0/16`（含同宿主 hairpin NAT）与 TX2 frontend WireGuard 主机 `10.20.0.3/32`。该边界信任该私有 bridge 上的 workload 与 TX2 主机；backend 端口与该网络都不得暴露给不可信调用方。Caddy 是唯一公网 ingress；frontend nginx 信任 Caddy 的 real-IP 处理，并用解析出的 `$remote_addr` **覆写** `X-Real-IP`。backend 忽略 `X-Forwarded-For`/`Forwarded`；不可信 peer 或缺失/重复/非法的 `X-Real-IP` 回退到 socket peer。只接受单个字面 IP（不接受 DNS、列表或 zone ID）；IPv6 会被归一化。来源哈希保持按分钟加盐、仅存于 JVM，从不记录/持久化，也不用作访客标识。placement/网络变更必须同步更新这条显式 proxy 边界；不得推断出笼统的私有网络或公网信任。
- 认证前台活动：应用初始化、登录结算、回到前台、页面切换，以及最多每五分钟一次的常规心跳。隐藏的标签页会暂停活动。backend 校验 bearer token 并哈希其 subject；客户端无法指定账号。
- 部署 secret `WOTB_OBSERVABILITY_HASH_KEY` 必须至少 32 个字符。它只提供给 business-api workflow/运行时，从不提交。空/过短的 key 会禁用认证活动采集；feature/parse telemetry 仍然可用。在依赖用户计数之前，把它配置为 repository 级 Actions secret。保持其至少在整个七天查询窗口内稳定；轮换会在该窗口内拆分身份。
- 账号哈希保存在日志**内容**中，而不是索引的 stream label 或 Prometheus label。active users 在 Web/Android 之间去重；平台计数会重叠，不得相加。
- 其他 telemetry 可以是匿名的。feature 打开包括首次进入、刷新与返回某个 feature；同一 feature 内仅参数变化的导航不重复计数。Managed/admin、文档、contact 与 More 页面不在统计范围内。
- 回放计数按进入解析任务的每个文件计。选择十个文件就是十次启动。每个操作最多有一个成功/失败/取消结果。进行中的解析或页面崩溃不会被自动归类为失败。重新解析会再次计数。
- 只有权威的在线连通状态才允许入队或发送。断线会丢弃已排队事件；重连从不重放离线用量。首个页面可以等待初始连通性结算，若在线则只计一次。
- 发送方只持有有界的内存队列；它不持久化访客身份或离线历史，也不重试失败的批量。离线、旧客户端、被阻止的 telemetry 与页面关闭都可能造成少计。不要把这些计数用于计费、安全审计或精确总体估计。
- 前台活动是周期性的，因此最近几分钟可能不完整。请求按 backend 接收时刻记录；客户端 `occurred_at` 是诊断内容，不是可信的 Loki 时间戳。

## AI token 统计语义

`ai_token_usage` 在上游尝试的 received-usage 时刻发出。`inputTokens`、`outputTokens` 与 `totalTokens` 是互相独立的 provider 值；reasoning/cache 计数器是其子集，不得再加到 total 上。失败/取消的调用会贡献实际收到的任何 usage。没有 usage 的 provider 调用发出 `usageMissing=1`；缺失不是零消耗的证据。

`ai_review_usage` 在已执行的评审结束时发出一次，把内部调用/重试合并为一次用户评审，包括失败或在 worker 内被拒绝的评审。worker 执行前的 HTTP 拒绝不计入。平均值等于这些终态评审总量之和除以数量。因此跨越时间边界的请求属于平均值的完成窗口，而单次 usage 属于其接收窗口。永远不要用接收窗口的总量除以无关的请求数。

dashboard 报告的是**已知消耗**，不是 provider 的账单；缺失 usage 单独展示。常规测试中没有实时/付费的 provider 调用。

## Android 下载

Android downloads 只统计用户在 Web `/download/android` 页面点击最终「下载 APK」按钮的行为。打开下载页或其它入口不会计入。新点击记录为 `event=product_telemetry telemetry_event=android_download_click feature=android_download platform=web`；旧的下载页打开事件 `feature_open` 是不同契约，不能当作下载点击。事件通过 `keepalive` 立即发送，不阻塞导航，只表达下载意图。dashboard 不把后续 Caddy 302、网盘传输、HTTP 200/206、传输字节或安装当作下载完成；旧 APK HTTP 请求指标已退役，不能与点击次数合并。

## 错误日志

`Backend error logs` 有按功能划分的行：账号/登录、HoF（含百场/三环）、积分赛、AI、客户端上报的回放解析以及其他 backend 错误。先按来源 service、字面关键词与字面 Error ID 过滤，再展开日志条目。功能匹配使用既有 path/event/error-code 上下文，可能重叠；Other 分区排除已识别的分区。

服务器错误日志保留既有的安全诊断。AI 只使用安全的 event/error-code 字段，不含原始 provider 响应体；客户端解析错误只包含已批准的归类与生成的 ID。不要向 telemetry 发送 token、authorization header、用户标识、原始模型输出/prompt 或回放数据。

## 存储与限额

| 存储 | 保留 / 上限 |
|---|---|
| Prometheus | 168h，TSDB 大小上限 2GB |
| Loki | 默认 168h 保留；查询回看 4560h（190d），单次查询最长 168h |
| Loki security stream | 仅 `{compliance="security"}`：4560h（190d）保留——见 [`security-log-retention.md`](security-log-retention.md) |
| Grafana | 持久数据库；dashboard 是代码，不是用量存储 |
| 客户端队列 | 仅有界内存；被丢弃的批量不重试 |
| Docker stdout | 既有 20MB × 3 大小轮转；无基于时间的过期 |

有一条 stream 刻意豁免七天窗口：带 `compliance="security"` 标签的行（Keycloak realm events 与 Caddy 的 `/api/*` 及认证域访问日志）通过 `retention_stream` override 保留 190 天。其他一律不豁免，普通 telemetry 绝不能携带该标签——边界、脱敏规则与合规查询配方见 [`security-log-retention.md`](security-log-retention.md)。

Loki compactor 异步删除过期 chunk（10 分钟 compaction、2 小时 delete delay）。七天是该 stream 之外一切数据的**可查询 telemetry 窗口**，并不表示每份物理副本都会在第 168 小时被精确擦除。Docker 大小轮转可能让低流量原始日志保留超过七天。严格的物理年龄删除尚未实现；那需要单独的、经评审的宿主日志生命周期，而不是背着 Docker 删除其拥有的文件。不要把 telemetry 加入长期备份。

账号分组查询有显式的 `max_query_series=10000` 上限；超过会返回查询错误，而不是静默截断用户。在把 dashboard 视为运维已验收之前，先验证七天生产查询成本与内存；Loki 的 256MiB 内存上限保持不变。

## 验证与部署

PR CI 执行原生 Prometheus/Loki/Alloy 校验、真实 Docker emitter → Alloy → Loki 冒烟、Grafana datasource/dashboard API 冒烟、HTTP 契约检查与针对性语义测试。新 producer 尽可能在 receiver/collector 之后部署；否则独立 service owner 可能造成临时少计，而不是产品中断。Android 内置 telemetry 需要新的 APK 发布；既有 APK 无法回溯上报用量。

`observability.yml` 对运行时做 reconcile，针对既有本地 state 对 Grafana root 做 plan，apply 精确保存的 plan，要求第二次 plan 干净，验证全部六个当前 dashboard（五个产品 dashboard + Engineering Overview），并验证六个 retired UID 返回 404。默认 home 文件与运行时探针使用 Active users。保留七目标 Prometheus 门禁（backend、AI、node-exporter、Prometheus、Loki、Grafana、dev-metrics），即使基础设施图表已不再出现在 home dashboard 上。

deployment canary 只证明采集路径，不证明每个生产服务都有真实活动。运行时验收必须在 dashboard 中检查真实收到的客户端活动、一次解析批量、一次 Web 最终 APK 下载按钮点击及对应的 `android_download_click` backend telemetry event，以及 AI 用量/错误。无法从缺失事件回填任何历史客户端点击计数。

参见 [runbook](observability-runbook.md) 与 [Grafana OpenTofu ownership](../architecture/grafana-opentofu.md)。

## 工程指标

[Engineering metrics architecture](../architecture/engineering-metrics.md) 定义计数/归类。GitHub 每 15 分钟刷新一次，与 15 秒 scrape 相互独立。`/metrics` 读取最近一次完整的内存快照，不调用 GitHub。首次失败时进程保持健康，并置 `wotb_dev_collector_data_ready=0`；后续失败保留成功的聚合与时间戳。重启会从 GitHub 重建；没有数据库/缓存备份。

Engineering Overview 显示：距上次成功不足 30 分钟为 Healthy，30–60 分钟为 Delayed，60 分钟及以上为 Stale；从未成功为 Not ready。进程健康/Prometheus UP 要与数据集就绪/年龄分开检查。GitHub 故障不意味着 Grafana 运行时故障。

`DEV_METRICS_GITHUB_TOKEN` 是 repository 范围只读权限（Metadata、Pull requests、Issues、Actions、Contents read）。observability owner 注入一个受保护的运行时 token 文件并以只读方式挂载；容器配置中只出现其路径。永远不要把它的值放进镜像、Grafana JSON、OpenTofu state、argv、metrics、诊断或日志。通过同一 owner 轮换并重新部署。不暴露 exporter 公网端口；Grafana 仍然只允许认证访问。

在 `observability.yml` 中选择 exporter 之前，先配置该 repository secret。owner 在既有 Yecao deployment lock 下写入 `/run/wotb-dev-metrics/github-token`，并在轮换后重建容器。`/run` 是临时的：宿主重启后，dispatch Observability 并选择 scope `dev-metrics-exporter` 以重新注入 secret；缺失 bind source 会 fail closed，而不是创建目录。对于私有 GHCR package，owner 只用其短期 publishing token 认证 exporter 拉取，使用临时的 `/run` Docker config，并在成功或失败时删除该 config。Exporter 数据访问仍使用单独的只读 token。无需持久的宿主 Docker login。

重跑同一 source SHA 会复用既有 exporter tag 的 digest。只构建缺失的 tag；registry/认证失败仍然致命。复用与新构建的镜像在 staging 前都必须保留预期的 OCI source revision 与 registry digest，因此重试永远不会覆盖既有 SHA tag。

`verify-observability.sh` 分别检查 exporter 健康、`dev-metrics` Prometheus target 与数据集就绪/年龄。GitHub 快照不可用或过期时打印 `OBSERVABILITY DEGRADED [DEV_METRICS_DATA]` 并继续 Grafana/Loki 检查；它不会重启 exporter，也不会跳过无关的运行时验证。

月度表展示历史 event-date 标签。每日 Created/Merged 折线图通过原生 Grafana transformation 把 day 标签转换为 UTC 零点；其 x 轴跟随选择器。它们不虚构 Prometheus 之前的样本历史。月份从 2026 年 6 月开始；天数覆盖最近 90 天。instant bucket 查询要求选择器末端存在快照；选择超出观测到的 Prometheus 保留范围的末端可能返回 No data。workflow snapshot/生产趋势跟随选择器与既有七天保留。永远不要在重建的 GitHub 总量上使用 `increase()`/`rate()`。Area 会重叠，draft 会与 open 重叠，cancelled run 不是失败，Actions 保留期限可能限制 CI 完整性。PR 创建到合并不是 DORA lead time。Release/workflow 完成不证明已改动：deployment/publish 面板明确显示 Not available。

活动量不等于生产力，生产相关性也不证明因果关系。五个产品 dashboard 在彼此之间互相导航；Engineering Overview 是独立的第六个当前 dashboard，并可单向链接到五个产品 dashboard。生产验收必须比对实时 GitHub 总量/月份、证明 30 分钟内成功刷新、检查诊断信息无泄漏，并对完整 Grafana OpenTofu root 执行 plan、apply exact saved plan、clean second plan，验证全部 6 个当前 dashboard UID（5 个产品 dashboard + Engineering Overview），确认 6 个 retired UID 不存在/404，确认 7 个 Prometheus UP job（含 dev-metrics），同时保留 datasource/state 安全规则。
