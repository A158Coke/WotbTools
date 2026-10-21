# Komodo 服务器生命周期

> 内部 playbook：由 designer / executor / prompt-repair / review-with-docs 按需加载；不是顶层 Skill，也不参与生命周期选择。

> 目标：让服务器新增、迁移与退役成为可复核、可回滚、尽量声明式的运维流程，而不是临时 SSH
> 搬运。完整运行手册见 `docs/operations/komodo-server-lifecycle.md`。

## 必读事实源

执行前按相关范围读取：

1. `docs/operations/komodo-server-lifecycle.md` — 对应的服务器生命周期权威运行手册。
2. `docs/operations/komodo-periphery.md` — 新主机 Periphery 接入与生命周期。
3. `docs/operations/komodo-resource-sync.md` — Git 管理的 Komodo resources、人工差异审查/应用与安全边界。
4. `infra/komodo/resources/**` — 当前声明的 Komodo 期望状态。
5. 若迁移已有 workload，再读取该 workload 对应的运维文档、compose/deploy 配置、Caddy/ingress 权威配置。

真实代码、运行声明和权威运维文档优先于聊天记忆。无法确认的项写 `unknown`，禁止猜测为 `stateless`。

## 强制边界

Komodo 是 **部署/控制平面**，不是数据搬运工具。

以下内容绝不能因为 Stack/Deployment 的目标 Server 改了就视为已迁移：

- PostgreSQL / MySQL / MongoDB 数据；
- Redis RDB/AOF；
- Docker named volumes；
- bind mounts / host filesystem data；
- uploads / replay files；
- Keycloak database state；
- 任何只有源主机持有的业务数据。

`server = old` → `server = new` 只代表 workload 的执行目标改变。

## 执行流程

### 1. 盘点

对源服务器列出并验证：

- Komodo Stacks / Deployments；
- 非 Komodo 管理的 containers；
- ports / Caddy / DNS / LB routes；
- volumes / bind mounts；
- databases / Redis persistence；
- uploads / replay / local authoritative files；
- secrets / env / registry dependencies；
- WireGuard / inter-host dependencies。

任何未知持久化项标记 `uncertain`，在切换生产流量前必须解决。

### 2. 分类

每个 workload 必须标记：

- `stateless`
- `stateful`
- `uncertain`

常见无状态 workload：frontend、使用外部 DB/storage 的 backend API、无本地状态 worker、Git 可重建的 gateway。

常见有状态 workload：数据库、持久化 Redis、Keycloak DB、Docker volume、bind-mounted data、uploads、replay files。

### 3. 新增服务器

按以下顺序：

1. 准备主机与网络/WireGuard；
2. 安装 Docker；
3. 按 `komodo-periphery.md` 完成 Periphery 接入；
4. 按 `komodo-resource-sync.md` 更新 `infra/komodo/resources/servers.toml`；
5. 运行仓库现有 Komodo resource 校验；
6. 在 Komodo UI 审查待应用差异；
7. 发现意外的地址、tag、凭据或破坏性 diff → **STOP**；
8. 人工执行 Apply；
9. 验证 Server 在线、registry 与依赖可达；
10. 此时仍不切生产流量。

禁止把临时 SSH 手工 compose 当作长期迁移结果。

### 4. 无状态迁移

默认采用“源服务保持运行、目标先影子部署”的方式：

1. 保持源 workload 运行；
2. 在目标 Server 声明并部署 workload；
3. 检查健康状态与日志；
4. 验证 env、secrets 与网络；
5. 运行直接烟雾测试；
6. 切换或加入 ingress；
7. 观察目标运行状态；
8. 确认成功后才停止源 workload。

能影子部署或重叠运行就不要先停源服务。具体操作以本 playbook、`docs/operations/komodo-server-lifecycle.md` 与该 workload 的当前权威文档为准，不以历史迁移 wave 文档作为操作 authority。

### 5. 有状态迁移

必须先写明：

- 权威数据位于哪里；
- 使用什么迁移机制；
- 预计是否停机以及停机范围；
- 如何验证数据完整性；
- 连接配置与切换动作如何变化；
- 回滚点和可回滚窗口。

再依次执行：备份或复制 → 准备目标存储 → 迁移数据 → 启动目标服务 → 完整性检查 → 应用切换。

仅“容器启动成功”不能作为数据迁移成功的证据。

### 6. 切换门禁

流量切换前必须逐项确认：

- 目标服务健康；
- 日志没有未解释错误；
- env 与 secrets 完整；
- 所有依赖均可达；
- 持久化数据已验证；
- 烟雾测试通过；
- ingress 变更可逆；
- 存在可执行的回滚路径。

### 7. 退役源服务器

删除 Server 永远在最后：

1. 重新执行盘点；
2. 所有 workload 已迁移或明确移除；
3. 无唯一数据仍留在源服务器；
4. 停止残留服务，但先不销毁数据；
5. 观察替代服务；
6. 从 Git 管理的 Komodo resources 移除源 Server；
7. 审查 Resource Sync 差异；
8. 人工执行 Apply；
9. 最后才取消或退役 VPS。

不得为了方便退役而把 Resource Sync 改成 `delete = true`。

## 回滚要求

任何迁移计划在切换前必须写清：

- 触发回滚的条件；
- 流量如何回滚；
- 连接配置如何回滚；
- 是否需要停止目标服务，避免共享状态继续被写入；
- 有状态服务在切换后已经发生新写入时如何处理。

如果切换后已经产生新写入，禁止把“DNS 切回去”描述成完整回滚，除非数据所有权证明这样做安全。

## 输出格式

用户要求 plan / review 时，输出至少包含：

1. `源服务器 → 目标服务器`
2. `盘点结果`
3. `Workload 分类`
4. `无状态迁移`
5. `有状态数据迁移`
6. `切换门禁`
7. `回滚`
8. `源服务器退役`
9. `未知项 / STOP 条件`

计划必须引用具体仓库路径与权威文档，不用泛化的 DevOps 建议替代项目事实。

## 不主动引入

除非用户需求明确包含调度器、自动故障转移或多节点编排，否则不要主动把普通服务器迁移扩大成 Docker Swarm、Kubernetes 或其他集群改造。