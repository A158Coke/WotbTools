# 工程指标 V1

GitHub (`A158Coke/WotbTools`) → Yecao `dev-metrics-exporter` → Prometheus → `WotbTools Engineering Overview` (`wotbtools-engineering-overview`)。现有 Prometheus/Loki 信号提供生产上下文。OpenTofu 从 Git JSON 管理 dashboard API 资源；文件 provisioning 管理 datasources。Grafana 保持认证。

## 运行与恢复

Python exporter 是 TX 请求路径之外的 adapter/aggregator。GitHub 每 15 分钟刷新；普通 15 秒 scrape 读取完整的内存快照。`/health` 证明进程健康；`collector_data_ready` 与 `collector_last_success_timestamp` 证明数据集可用性与新鲜度。初始同步失败时进程保持存活且 unready。后续刷新失败保留上一次成功快照、递增错误计数并保持成功时间戳不变。重启后从 GitHub 重建。不引入 PostgreSQL、SQLite、Redis 或持久 raw-object store。

Yecao 将 API 故障与产品流量隔离。Grafana GitHub datasource 会让渲染耦合 API 调用、凭据与分类逻辑；exporter 提供单一有界聚合契约与可观测故障。无需数据库，因为 GitHub 可重建状态且 Prometheus 保存观测样本。

## 计数与历史

PR 状态先检查 `merged_at`；closed 且没有该字段表示 closed-unmerged。Draft 是 open 的子集。Merge rate = merged / (merged + closed-unmerged)；分母为 0 时未定义。7/30 天窗口使用相对刷新时间的事件时间戳。快照 P50/P90/P95 merge lead time 表示创建到合并，不是 DORA commit-to-production 时间。空集合不出分位数。

回填从 2026-06-22 开始。月桶从 2026 年 6 月起保留；日覆盖最近 90 天。即使 Prometheus 未覆盖该时段，事件日期 label 也能重建历史。月表列出事件桶。日折线图使用 Grafana 原生 grouping-to-matrix、ISO8601 UTC 时间转换与排序，把 Created/Merged 按事件日绘制到 picker 轴；scrape 时间戳被丢弃。每个桶位于 UTC 午夜，因此 sub-day 范围会按该时间戳裁剪，当天为 partial。这不回填 TSDB 样本。instant query 需要 picker 末端有快照；超出 Prometheus 观测保留期时返回 No data。当前桶不完整。重建计数（包括以 `_total` 结尾的名称）是 gauge：不得使用 `increase()`/`rate()`。只有进程错误计数器具备 counter 语义。工作流趋势显示 scrape 时刻累计快照比率的变化，不是 scrape 时的事件吞吐。

分页覆盖 PR、workflow run、release 与 PR file list。GitHub 的保留/删除限制决定可用的 CI 历史；V1 无法证明 6 月以来完整的 workflow 历史。Required Gate 使用实际 job，而不是 workflow 名代理。cancelled/skipped/other 分开统计；success ratio = success / (success + failure)。P50/P90 时长使用可用的 completed gate job。GitHub release 仅代表发布事件。生产 deploy/publish 面板在稳定证据证明变更前保持 Not available。

## 分类与隐私

Areas: replay、playback、android、ai、frontend、backend、auth、infra、observability、docs，另加 unclassified。area 使用这组 bounded vocabulary。当前 PR 主要按 changed paths 分类；path 证据不足时使用 stable semantic fallback；历史 frozen overrides 保留 merged / closed PR 已冻结的分类。open 或 reopen 的 PR 始终按当前 changed paths 分类，不会因历史 override 永久冻结；超过 GitHub file-list 上限的 active PR 只能使用绑定 exact `headRefOid` 的 versioned override 回退。人工 PR area label 不是分类权威，也不是必需的人工 metadata。一个 PR 可以有多个 area：柱状条重叠，不代表工作量份额。Frozen history 版本化在 exporter 目录；heuristic 改动不得静默重分类历史。需要显式纠正时，只通过该 versioned historical override 文件。

冻结记录共 655 个 PR 的 area 集合，包含初始 608 个基于 2026-10-16 分页获取的 GitHub file list 的分类，以及之后显式冻结的既有 PR 分类；记录只包含 PR 编号与 area 集合，不保存 file path、title 与 body。Feature-specific path 规则同时保留产品 area 与其实现层（例如 frontend replay processing 中的 playback）。Runtime cache 只保留分类/job 聚合贡献，并清理被取代的 PR 更新/run attempt；重启后重建。

Actor 类型 human/agent/automation 依赖可靠 metadata 或已知身份。未知普通账号保持 human；PR 中的 AI 文本不构成 actor 身份。不按 developer/PR/title/SHA/email 打 label，也不做排名、LOC 评分或推断 AI 生产力。指标只包含聚合：没有 raw PR/comment body、私有日志、token 或 secret。Workflow 身份与 area/state/actor/conclusion/window/quantile/target label 有界；day/month label 遵循文档化的桶节奏。

## 运维与安全

repository-scoped `DEV_METRICS_GITHUB_TOKEN` 只授予 Metadata/Pull requests/Issues/Actions/Contents read。生产注入提供受保护的只读 token 文件；值不进入容器环境、镜像、Grafana JSON、OpenTofu state、metrics 或日志。无公网端口、host network 或 privileged container。现有 observability owner 部署 immutable SHA-related image、协调 Prometheus 并应用保存的 Grafana plan；Komodo 只提供可见性，永远不是 dashboard desired state。

数据年龄：Healthy 低于 30 分钟，Delayed 30–60 分钟，Stale 60 分钟及以上；无初始同步为 Not ready。Stale 计数仍然可见。运行状态与数据新鲜度不同：GitHub 故障不得重启健康进程或使健康 Grafana 失效。容器恢复无需持久数据库。

活动量不等于生产力。生产信号允许相关，不自动构成因果，也不自动把事故归因到某个 PR。五个真实产品 dashboard 保持 drilldown；退役 dashboard 不为链接而重建。GitHub 是开发事实，Prometheus/Loki 拥有观测 telemetry，Git 拥有配置，OpenTofu 拥有 Grafana desired state。

生产验收/保留见 [operations](../operations/observability.md)，IaC 恢复见 [Grafana ownership](grafana-opentofu.md)。

## 参考

[Prometheus instrumentation guidance](https://prometheus.io/docs/practices/instrumentation/) 说明 gauge/counter 选择、时间戳新鲜度与 label 成本。[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) 记录 remaining/reset header 与 primary/secondary limit。

[Grafana transformation documentation](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/) 描述 grouping to matrix 与 time-field 转换。日图管线以部署版本 `@grafana/data` 11.6.16 对未排序 fixture 执行；它保留两个计数、产生排序后的 UTC 时间并丢弃 scrape 时间戳。
