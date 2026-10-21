# TX Business PostgreSQL OpenTofu 边界

`infra/tofu/postgres-business` 是 TX Business PostgreSQL 应用 role、database 与 database grant 的独立 OpenTofu root。它独立于 Grafana 和 Keycloak 的 PostgreSQL root，并使用 TX-local state：

```text
/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate
```

`deploy/tx/deploy.sh` 以 0700 创建父目录；application role 密码使用 provider 的 write-only 字段，因此 state 不保存 application credential attribute。

Docker Compose 创建并运行 `business-postgres`；管理端口只在 TX loopback `127.0.0.1:25432:5432`，另在 WireGuard 私网暴露 service endpoint `10.20.0.1:25432:5432`。生产 `business-api` consumer 使用 `10.20.0.1:25432`；`business-postgres:5432` 只保留为允许的 rollback placement。PostgreSQL provider 硬限制在 `127.0.0.1:25432`，不能访问公网、WireGuard 网络或 Keycloak PostgreSQL runtime。

## Ownership 划分

```text
Compose   runtime、image、volume、loopback 管理端口 + WG service 端口、healthcheck、restart、内存限制
OpenTofu  wotb database、control_api role、database-level grant
Flyway    application schema、tables、indexes、sequences、rows
```

OpenTofu root 不声明 schema、table、index、sequence 或 extension，也不声明 application business table；任何 table 都不得在 Flyway 之外创建。

Application role 是最小权限 login role：没有 `superuser`、`createdb`、`createrole`、`replication` 或 `bypassrls`。Database-level grant 覆盖 `CONNECT`、`CREATE` 与 `TEMPORARY`；schema 对象仍由 Flyway 拥有。

## Workflow 划分

1. Pull request 在 GitHub-hosted runner 上运行 `tofu fmt -check`、`tofu init -backend=false`、`tofu validate`、plan-policy fixtures 与 contract script。Pull request 从不触达 TX：没有 SSH step，也没有 production-local state、database plan 或连接。
2. 合并后的 main 变更通过 SSH 暂存到 TX 的 immutable SHA-named 目录；`business-postgres` Deploy lane 启动 runtime 并等待 `pg_isready`。
3. TX host 针对 `127.0.0.1:25432` 创建一份 saved plan，拒绝 destructive changes，apply 该精确 plan，要求完全干净的 second plan，之后才写入 root-only 的 `/opt/wotb-tx/business-postgres.tofu-provisioned` marker。Runtime 与 root 在 `.github/workflows/business-postgres.yml` 拥有的同一把 locked SSH session 中运行。

Standalone workflow 使用共享的 `production-maintenance` GitHub Actions concurrency group，以及 TX host 上的 `flock`，覆盖 runtime、apply、second plan、verification 与 marker update。GitHub Actions 不直接连接数据库；OpenTofu 在 TX 上运行。

Provider 安装基于 mirror 并 fail-closed：`deploy/tx/business-postgres.tofurc` 只 allowlist `/opt/wotb-tx/tofu-provider-mirror` 中的 `cyrilgdn/postgresql`，并明确排除直接安装。

## 安全行为

`prevent_destroy` 保护受管的 role、database 与 grant；`infra/tofu/postgres-business/validate-plan.sh` 在 apply 前拒绝任何 delete 与 replacement：

- 任何 `delete` action，包括 role deletion 与 `delete`+`create`；
- 对 database 或 grant 的任何 update；
- 三个已声明 address 之外的任何 resource address；
- post-apply second plan 的非空 change set（`--require-no-changes`）。

已知安全的 application password rotation 只是对 `postgresql_role.control_api` 的 in-place `update`；随后 second plan 必须完全 no-op。

由于 helper 在 `if`/`||` 上下文中运行 provisioning steps，steps 显式串联，而不是依赖 `errexit`——bash 在该位置调用 function 时不会启用 `errexit`。

## Runtime 检查

Business PostgreSQL 是权威状态，因此只读的 `deploy/tx/runtime-check.sh` 要求容器 health、`pg_isready`、精确的 `127.0.0.1:25432:5432` + `10.20.0.1:25432:5432` TCP publications，以及 `tx-local-opentofu-business-postgres` provisioning marker，之后才允许输出 `TX_RUNTIME_READY`。任何失败输出 `TX_RUNTIME_NOT_READY`；检查从不创建、修改或删除 database 或 row。

从该 root 移除 address 不是受支持的 retirement process。Database retirement、Keycloak user migration 与 production data movement 是独立的、operator-approved 操作；source database 从不会作为 backup 或 restore 的一部分被删除。操作细节、credential 名称与 backup/restore 流程见 `docs/operations/business-postgres.md`。
