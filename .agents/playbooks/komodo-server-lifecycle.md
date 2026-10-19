
# Komodo Server Lifecycle

> 内部 playbook：由 designer / executor / prompt-repair / review-with-docs 按需加载；不是顶层 Skill，也不参与生命周期选择。

> 目标：让服务器新增、迁移与退役成为可复核、可回滚、尽量声明式的运维流程，而不是临时 SSH
> 搬运。完整运行手册见 `docs/operations/komodo-server-lifecycle.md`。

## 必读事实源

执行前按相关范围读取：

1. `docs/operations/komodo-server-lifecycle.md` — 本技能对应的 canonical lifecycle runbook。
2. `docs/operations/komodo-periphery.md` — 新主机 Periphery onboarding / lifecycle。
3. `docs/operations/komodo-resource-sync.md` — Git-owned Komodo resources、manual diff/apply、安全边界。
4. `infra/komodo/resources/**` — 当前声明的 Komodo desired state。
5. 若迁移已有 workload，再读取该 workload 对应的 operations 文档、compose/deploy 配置、Caddy/ingress owner。

真实代码、运行声明和 canonical operations docs 优先于聊天记忆。无法确认的项写 `unknown`，禁止猜测为 stateless。

## 强制边界

Komodo 是 **deployment/control plane**，不是数据搬运工具。

以下内容绝不能因为 Stack/Deployment target server 改了就视为已迁移：

- PostgreSQL / MySQL / MongoDB 数据；
- Redis RDB/AOF；
- Docker named volumes；
- bind mounts / host filesystem data；
- uploads / replay files；
- Keycloak database state；
- 任何只有源主机持有的业务数据。

`server = old` -> `server = new` 只代表 workload execution target 改变。

## 执行流程

### 1. Inventory

对源服务器列出并验证：

- Komodo Stacks / Deployments；
- 非 Komodo 管理的 containers；
- ports / Caddy / DNS / LB routes；
- volumes / bind mounts；
- databases / Redis persistence；
- uploads / replay / local authoritative files；
- secrets / env / registry dependencies；
- WireGuard / inter-host dependencies。

任何未知持久化项标记 `uncertain`，在 cutover 前必须解决。

### 2. Classify

每个 workload 必须标记：

- `stateless`
- `stateful`
- `uncertain`

常见 stateless：frontend、使用外部 DB/storage 的 backend API、无本地状态 worker、Git 可重建的 gateway。

常见 stateful：数据库、persistent Redis、Keycloak DB、Docker volume、bind-mounted data、uploads、replay files。

### 3. 新增服务器

按以下顺序：

1. provision host + 网络/WireGuard；
2. Docker；
3. 按 `komodo-periphery.md` 完成 Periphery；
4. 按 `komodo-resource-sync.md` 更新 `infra/komodo/resources/servers.toml`；
5. 运行仓库现有 Komodo resource validation；
6. 在 Komodo UI review pending diff；
7. unexpected address/tag/credential/destructive diff => STOP；
8. manual Apply；
9. 验证 Server online、registry 与依赖可达；
10. 暂不切生产流量。

禁止把临时 SSH 手工 compose 当作长期迁移结果。

### 4. Stateless migration

默认采用 source-stays-up / shadow-first：

1. 保持 source workload；
2. 在 target Server 声明/部署 workload；
3. health + logs；
4. env/secrets/network validation；
5. direct smoke test；
6. 切或加入 ingress；
7. 观察；
8. 成功后才停 source。

能 shadow/overlap 就不要 stop-first。现有 K7B/K7C 文档是 frontend 迁移 precedent。

### 5. Stateful migration

必须先写明：

- authoritative data location；
- migration mechanism；
- downtime expectation；
- integrity validation；
- connection/cutover change；
- rollback point/window。

再执行 backup/replication -> target storage -> data move -> target service -> integrity checks -> application cutover。

仅“容器启动成功”不能作为数据迁移成功的证据。

### 6. Cutover gate

流量切换前必须逐项确认：

- target healthy；
- logs 无未解释错误；
- env/secrets 完整；
- dependencies reachable；
- persistent data verified；
- smoke test passes；
- ingress change reversible；
- rollback path exists。

### 7. Retire source

删除 Server 永远在最后：

1. 重新 inventory；
2. 所有 workload 已迁移/明确移除；
3. 无唯一数据仍留在 source；
4. stop residual services，但先不销毁数据；
5. 观察 replacement；
6. 从 Git-owned Komodo resources 移除 source Server；
7. review Resource Sync diff；
8. manual Apply；
9. 最后才 cancel/decommission VPS。

不得为了方便退役而把 Resource Sync 改成 `delete = true`。

## Rollback 要求

任何 migration plan 在 cutover 前必须写清：

- rollback trigger；
- traffic rollback；
- connection rollback；
- target 是否需要停止以防共享状态继续写入；
- stateful 服务在 cutover 后发生新写入时如何处理。

如果存在 post-cutover writes，禁止把“DNS 切回去”描述成完整 rollback，除非数据所有权证明这样做安全。

## 输出格式

用户要求 plan / review 时，输出至少包含：

1. `Source -> Target`
2. `Inventory`
3. `Workload Classification`
4. `Stateless Migration`
5. `Stateful Data Migration`
6. `Cutover Gate`
7. `Rollback`
8. `Source Retirement`
9. `Unknowns / STOP conditions`

计划必须引用具体 repository paths / canonical docs，不用泛化的 DevOps 建议替代项目事实。

## 不主动引入

除非用户需求明确包含 scheduler / automatic failover / multi-node orchestration，否则不要主动把普通服务器迁移扩大成 Docker Swarm、Kubernetes 或其他集群改造。
