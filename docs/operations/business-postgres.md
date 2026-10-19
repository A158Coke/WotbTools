# TX Business PostgreSQL 基础设施边界

PostgreSQL 是权威业务状态。服务器没有回放解析器，也没有回放任务表；
Business PostgreSQL 刻意独立于 Keycloak PostgreSQL：

```text
Compose        business-postgres.compose.yml             keycloak-postgres.compose.yml
OpenTofu root  infra/tofu/postgres-business             infra/tofu/postgres-keycloak
state          /opt/wotb-tx/postgres-business-tofu-state  /opt/wotb-tx/postgres-keycloak-tofu-state
port           127.0.0.1:25432                          127.0.0.1:15432
volume         business_postgres_data                   keycloak_postgres_data
Docker volume  deploy_business_postgres_data             deploy_keycloak_postgres_data
marker         business-postgres.tofu-provisioned       keycloak.tofu-provisioned
```

业务表永不位于 `keycloak-postgres`，且任何业务表都不在 Flyway 之外创建。

## 资源归属

`deploy/tx/business-postgres.compose.yml` 是 `business-postgres` 运行时的唯一定义 owner。
`deploy/tx/docker-compose.yml` 把该 fragment 与独立的 Keycloak PostgreSQL fragment 一并 include，
使应用部署共享同一 service 与 volume 定义：

- 镜像 `postgres:18-alpine`（绝不使用浮动 tag）；
- 管理端口 `127.0.0.1:25432:5432` —— 宿主本地 OpenTofu/管理用途；
- 私有 service endpoint `10.20.0.1:25432:5432` —— 仅 WireGuard；
  生产消费者仍使用 `business-postgres:5432`；
- volume `business_postgres_data`；
- `POSTGRES_DB=postgres`，这样当 bootstrap 管理员名为 `wotb` 时，
  镜像 entrypoint 绝不会自动创建由 OpenTofu 拥有的业务数据库；
- bootstrap 管理员 `TX_BUSINESS_POSTGRES_ADMIN_USER` /
  `TX_BUSINESS_POSTGRES_ADMIN_PASSWORD`，与应用 role 不同；
- `pg_isready` healthcheck、`restart: unless-stopped`，以及 512m 内存限制。

应用凭据刻意不在 `business-postgres` service 中：该运行时从不接收它。它唯一的消费者是
TX business 运行时 `business-api`（`deploy/tx/docker-compose.yml`），后者也是运行 Flyway 的进程。
两个 TX PostgreSQL owner fragment 都使用 Compose project `deploy`；改动该 project 或任一
volume key 都会选中不同的 Docker volume，属于生产数据迁移，而不是例行清理。

`infra/tofu/postgres-business` 恰好拥有三个逻辑资源：

```text
postgresql_database.wotb                        owner = control_api, UTF8, template0
postgresql_role.control_api                     login, no superuser/createdb/createrole/replication/bypassrls
postgresql_grant.control_api_database_access    CONNECT, CREATE, TEMPORARY on the database
```

三者都使用 `prevent_destroy`。Flyway（`java/wotb-web/src/main/resources/db/migration`）
仍是应用 schema、表、索引与序列的唯一 owner；该 OpenTofu root 不声明任何 schema 对象。

## 凭据与 state

```text
TX_BUSINESS_POSTGRES_ADMIN_USER       GitHub Actions Variable
TX_BUSINESS_POSTGRES_ADMIN_PASSWORD   GitHub Actions Secret
TX_BUSINESS_DB_NAME                   GitHub Actions Variable (wotb)
TX_BUSINESS_DB_USERNAME               GitHub Actions Variable (control_api)
TX_BUSINESS_DB_PASSWORD               GitHub Actions Secret
TX_BUSINESS_DB_PASSWORD_VERSION       GitHub Actions Variable (rotation version)
```

这些值只转发到 TX 进程环境，再作为 OpenTofu `TF_VAR_*` 输入。它们绝不能提交、写入服务器
env 文件、打印到日志或存入 tfvars。应用 role 密码使用 provider 的 write-only 字段
（`password_wo` 加 `password_wo_version`），因此不会作为 state 属性持久化。敏感本地 state 位于
`/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate`，父目录权限 0700，与 Keycloak
PostgreSQL state 分离。

仅部署 `business-postgres` 时不需要任何 Keycloak、frontend 镜像或 Caddy 输入。
Business PostgreSQL 不在 loopback 之外发布任何内容。

## TX 开通顺序

单 service 的 Deploy（`service=business-postgres`）与单 root 的 Tofu Apply
（`root=business-postgres`）把这套顺序拆开；没有 `all` 选择器：

```text
Deploy lane (deploy/tx/deploy.sh)
1. validate inputs and render the Compose document with the owner fragments
2. start the business-postgres runtime and wait for pg_isready
3. require the root-only /opt/wotb-tx/business-postgres.tofu-provisioned marker

OpenTofu phase in `.github/workflows/business-postgres.yml` (same TX host-lock session)
4. TX-local OpenTofu init -lockfile=readonly / validate / saved plan
5. plan safety validation
6. apply the exact saved plan
7. second plan
8. require a completely clean (no-op) second plan
9. write the root-only /opt/wotb-tx/business-postgres.tofu-provisioned marker
```

独立 workflow 在同一把宿主锁会话中排序运行时阶段与 OpenTofu 阶段。第二次 plan 不干净即
workflow 失败。未知 resource address、破坏性动作与预期之外的更新会在 apply 前被拒绝。
GitHub Actions 从不连接数据库：它只通过 SSH 传输 root，由 TX 宿主调用
`127.0.0.1:25432` 上的 provider。

Tofu Apply lane 显式串接每个 provisioning 步骤，绝不从 `||` 列表中调用 provisioning helper，
因为以那种方式调用的函数内 bash 会禁用 `errexit`，否则脏 plan 会被忽略。

## 运行时检查

`deploy/tx/runtime-check.sh` 读取 `TX_BUSINESS_POSTGRES_ADMIN_USER`，并在 Business PostgreSQL
完全就绪之前拒绝输出 `TX_RUNTIME_READY`：

- `business-postgres` 容器存在并报告 `healthy`；
- `pg_isready -U "$TX_BUSINESS_POSTGRES_ADMIN_USER" -d postgres` 成功；
- 发布的 TCP binding 恰好是 `127.0.0.1:25432:5432` 与
  `10.20.0.1:25432:5432`；缺失/多余 binding、通配/公网地址、
  裸端口、错误目标或 UDP 都会使 `wireguard-service-plane` 检查失败；
- `/opt/wotb-tx/business-postgres.tofu-provisioned` 存在且内容恰好为
  `tx-local-opentofu-business-postgres`。

任何失败都会输出 `TX_RUNTIME_NOT_READY`。这些检查是只读的：它们从不创建、修改或删除
数据库、表或行。

## Provider 镜像源

生产 provider 安装基于 mirror 且 fail-closed。运维人员把精确锁定的
`cyrilgdn/postgresql 1.27.0` 归档安装到 `/opt/wotb-tx/tofu-provider-mirror` 下。
`deploy/tx/business-postgres.tofurc` 只包含该 provider 的这份文件系统 mirror，并排除直接
安装，因此 mirror 缺失会让部署失败，而不是从公共 registry 下载。该 mirror 也可以存放
RabbitMQ provider；每个 `.tofurc` 只把自己那个 provider 列入 allowlist。

## 应用密码轮换

1. 生成新密码并设置 `TX_BUSINESS_DB_PASSWORD` secret。
2. 递增 `TX_BUSINESS_DB_PASSWORD_VERSION`。
3. 运行 `business-postgres` target。

plan 必须只包含一次对 `postgresql_role.control_api` 的原地 `update`，这是唯一被接受的
create 之外变更。第二次 plan 随后必须完全 no-op。`delete`+`create` 替换会被拒绝，因为它
会让 role 脱离权威数据库 owner。

## 备份

Business PostgreSQL 是权威状态，因此备份是必需操作：

```text
deploy/tx/business-postgres-backup.sh [--backup-root DIR] [--retention-minutes N] [--skip-retention]
```

- 以 bootstrap 管理员身份运行 `pg_dump --format=custom --no-owner --no-privileges`，
  因此归档不携带 ownership 或 privilege 耦合，data-only 恢复可由应用 role 的 owner 执行。
- 把 `<database>-<UTC timestamp>.dump` 与 `.dump.sha256` sidecar 写入
  `/opt/wotb-tx/backups/business-postgres`（目录 0700，文件 0600）。
- 在发布文件之前校验归档 catalog（`pg_restore --list`）与每个压缩数据块
  （`pg_restore --file=/dev/null`），然后才把临时文件 rename 到位。
- 对更早的 `*.dump` 文件应用保留策略（默认 10080 分钟）。
- 要求既有 `deploy_business_postgres_data` volume、其 Compose ownership label，以及挂载在
  该确切 volume 上的运行中 Business PostgreSQL 容器。备份拒绝启动缺失的运行时，也不会
  选择其他 project/volume。
- **绝不** drop、truncate 或删除源数据库或其行。备份脚本中没有
  `DROP`/`DELETE`/`TRUNCATE` 路径。

备份文件按上述方式存放在 TX 的 root-only 存储中。定时的 `database-backup.yml` workflow
运行该脚本与独立的 Keycloak PostgreSQL 备份 owner，然后备份本地 Tofu state。本次 PR 不
引入外部备份平台或对象存储上传。

## 恢复

恢复一律校验到一次性数据库，绝不覆盖权威库：

```text
deploy/tx/business-postgres-restore.sh --file <dump> --database <scratch> --confirm RESTORE-<scratch>
deploy/tx/business-postgres-restore.sh --file <dump> --verify-only
```

- `--verify-only` 校验 SHA-256 sidecar 与完整归档完整性，不创建、修改或删除任何数据库。
- 恢复工具要求既有 Business PostgreSQL 运行时，并校验 `deploy_business_postgres_data`
  volume 身份。它从不自动启动数据库运行时。
- 脚本拒绝以权威源数据库（`wotb`）为目标，并要求确切的
  `--confirm RESTORE-<scratch>` opt-in token。
- 它创建 scratch 数据库，使用 `--exit-on-error` 恢复，并打印运维人员在宣布归档可恢复之前
  必须执行的校验 SQL。

恢复后的校验（脚本输出中也有记录）：

```sql
select count(*) from hall_of_fame_record;
select min(id), max(id) from hall_of_fame_record;
select pg_get_serial_sequence('hall_of_fame_record', 'id') as identity_sequence;
select last_value, is_called from pg_sequences
 where schemaname = 'public' and sequencename like 'hall_of_fame_record%';
select arena_id, account_id, count(*) from hall_of_fame_record
 group by 1, 2 having count(*) > 1;
select count(*) from hall_of_fame_record where replay_uploaded_by is not null;
```

## 名人堂 schema 契约

`hall_of_fame_record` 由 Flyway 拥有。当前兼容性不变量：

- 显式 id 能在 dump/restore 中存活，因为 `pg_dump` 会输出 `setval`；任何恢复之后，
  运维人员必须确认 `last_value` 不低于 `max(id)`；
- unique key 仍为 `(arena_id, account_id)`；
- 该表没有出向外键，因此永不与 Keycloak 用户或 `user_profile` 耦合；
- `replay_uploaded_by` 仍是可空字面 `varchar`，以不透明数据保存历史 Keycloak UUID。
  不得引入指向任何 Keycloak 拥有身份的 FK。

schema 与产品语义位于 [`features/hall-of-fame.md`](../features/hall-of-fame.md)；
本文只拥有运行时、备份与恢复边界。

## 验证

```text
bash infra/tofu/postgres-business/test-validate-plan.sh          # plan-policy fixtures
bash scripts/ci/test-postgres-business-tofu-contract.sh          # root/workflow/deploy contract
bash deploy/test-business-postgres-runtime.sh                    # disposable PostgreSQL 18 + real provider + backup/restore
bash deploy/test-tx-runtime-config.sh                            # Compose + isolation + provisioning order
mvn -pl wotb-web -Dtest=HofOwnershipMigrationTest test           # empty-database Flyway build and HoF properties
```

`deploy/test-business-postgres-runtime.sh` 把 provider mirror 到临时目录，对一次性
`postgres:18-alpine` 容器 apply root，证明应用 role 是非 superuser 且能在自己的数据库中
建表，要求第二次 plan 干净，然后在一个 Hall-of-Fame 形状的表（显式 id、unique key、
字面 Keycloak UUID、identity sequence）上实际运行备份/恢复脚本。
