# TX WireGuard service plane（K6A / K6B）

K6A 已在 TX1 Docker-local production plane 之外建立并验收私有跨宿主入口。
K6B-1 在不切换生产流量的前提下，把消费者依赖改为 fail-closed logical endpoints；
owner workflows 当时仍显式注入 Docker-local 值。K6B-2 才逐 consumer 切换：

```text
K6B-1  COMPLETE
K6B-2A COMPLETE  Frontend → Business API              http://10.20.0.1:8087
K6B-2B COMPLETE  Business API → Business PostgreSQL   10.20.0.1:25432
K6B-2C COMPLETE  Business API → Keycloak Admin        http://10.20.0.1:8080
K6B-2D CUT OVER  Keycloak → Keycloak PostgreSQL       10.20.0.1:15432
Remaining（Docker-local，各自步骤前不变）
       Caddy → Frontend                     wotb-frontend:80
       Caddy → Keycloak                     keycloak:8080
       Frontend → AI Service（Yecao）        http://10.20.0.2:8089   （不随 TX placement 移动）
```

## Endpoint contract

| Service | TX1 WG TCP endpoint | Container port | 保留的 loopback administration |
|---|---|---|---|
| Frontend | 10.20.0.1:8081 | 80 | — |
| Business API app | 10.20.0.1:8087 | 8087 | — |
| Business API management | 10.20.0.1:8088 | 8088 | — |
| Keycloak | 10.20.0.1:8080 | 8080 | 127.0.0.1:18080 |
| Keycloak PostgreSQL | 10.20.0.1:15432 | 5432 | 127.0.0.1:15432 |
| Business PostgreSQL | 10.20.0.1:25432 | 5432 | 127.0.0.1:25432 |

Loopback 供宿主本地管理/OpenTofu；WG endpoint 供私有跨宿主访问，也是 K6B logical
placement 的可选目标地址。唯一公网 HTTP/HTTPS
ingress 仍是 Caddy 的 80/443。UFW inactive 不允许使用 wildcard/public bind；
服务入口只接受表中精确 TCP 绑定，禁止 `0.0.0.0`、`::`、公网 IP 或裸 `5432` 发布。
两套 PostgreSQL 可同时在不同宿主地址上使用相同的各自 host port。

K6B logical endpoint contract（`Active value` 为当前生产实际 placement）：

| Consumer | Variable(s) | Docker-local default | Reviewed WG values | Active value |
|---|---|---|---|---|
| Frontend → Business API | `TX_BACKEND_UPSTREAM` | `http://business-api:8087` | `http://10.20.0.1:8087`, `http://10.20.0.3:8087` | **`http://10.20.0.1:8087`（K6B-2A 已切换）** |
| Business API → Business PostgreSQL | `TX_BUSINESS_DB_HOST/PORT` | `business-postgres:5432` | `10.20.0.1:25432`, `10.20.0.3:25432` | **`10.20.0.1:25432`（K6B-2B 已切换）** |
| Business API → Keycloak Admin | `TX_KEYCLOAK_ADMIN_SERVER_URL` | `http://keycloak:8080` | `http://10.20.0.1:8080`, `http://10.20.0.3:8080` | **`http://10.20.0.1:8080`（K6B-2C 已切换）** |
| Keycloak → Keycloak PostgreSQL | `TX_KEYCLOAK_DB_HOST/PORT` | `keycloak-postgres:5432` | `10.20.0.1:15432`, `10.20.0.3:15432` | **`10.20.0.1:15432`（K6B-2D 已切换）** |
| Caddy → Frontend | `CADDY_FRONTEND_UPSTREAM` | `wotb-frontend:80` | `10.20.0.1:8081`, `10.20.0.3:8081` | Docker-local |
| Caddy → Keycloak | `CADDY_KEYCLOAK_UPSTREAM` | `keycloak:8080` | `10.20.0.1:8080`, `10.20.0.3:8080` | Docker-local |

`KEYCLOAK_ISSUER_URI` 不是 placement endpoint，始终保持
`https://auth.wotbtools.com/realms/wotbtools`。Yecao AI 仍固定
`http://10.20.0.2:8089`，不随任何 TX placement 切换移动；monitor/Komodo/Loki 边界不变。
公网 host、未审核 WG 地址、
错误协议或错误端口在 live mutation 前 fail closed。K6B 不迁移任何 workload。

同一套 canonical validator（`deploy/tx/deploy.sh:validate_http_endpoint` /
`validate_database_endpoint` / `validate_caddy_upstream`）同时守护三个入口，仓库里没有第二份
allowlist：staged deploy、只读 dependency readiness，以及 runtime gate。因此
`deploy/dependency-readiness.sh` 在启动任何容器之前就拒绝未审核 endpoint——携带
`TX_BUSINESS_DB_PASSWORD` 的 psql 探针与携带 `KEYCLOAK_ADMIN_CLIENT_SECRET` 的
Keycloak Admin 请求都不会先发出去再等 `deploy.sh` 拒绝。probe 自身也不再为
`TX_KEYCLOAK_ADMIN_SERVER_URL` 取默认值：没有经过校验的显式值就直接失败。

## K6B-2A / 2B / 2C / 2D：同宿主 hairpin 是刻意的 placement 验证

Frontend、Business API、Keycloak、Caddy 与两套 PostgreSQL **当前都在 TX1**，因此四个已切换的
consumer 都是**同宿主**切换：Frontend 不再走 Docker bridge 的 `business-api:8087`，而是连到
TX1 自己的 WG 地址 `10.20.0.1:8087`；Business API 也不再走 `business-postgres:5432` 与
`http://keycloak:8080`，而是连到 `10.20.0.1:25432` 与 `http://10.20.0.1:8080`；Keycloak 也不再走
Docker bridge 的 `keycloak-postgres:5432`，而是连到 `10.20.0.1:15432`。四者都经宿主的
published port 回到同一台机器。这在网络上是 hairpin，且是有意为之：

- **目的**：K6B 的目标是 logical placement abstraction / migration readiness，不是"为了使用
  WireGuard"。把 consumer 的值改成 service-plane 地址后，placement 由 Git 里的一个已评审值
  表达，未来把 Business API 移到 TX2（`10.20.0.3:8087`）、其数据库移到 TX2
  （`10.20.0.3:25432`）、Keycloak 移到 TX2（`http://10.20.0.3:8080`）或 Keycloak 的数据库移到
  TX2（`10.20.0.3:15432`）只需改这一个值；
  如果同宿主 consumer
  永远保持 Docker-local，K6B-2 的整套 allowlist 与 runtime token 就永远得不到真实验证。
- **代价**：被切换的路径比走 bridge 多一次宿主 NAT 跳；对 K6B-2B 而言，Business API 的数据库
  连接新增一个依赖——TX1 自己的 `wg0` 地址必须存在（TX deploy 的 `preflight_host` 本来就要求
  `wg0`）；对 K6B-2C 而言，Keycloak Admin 请求同样依赖该地址；对 K6B-2D 而言，Keycloak 到
  PostgreSQL 的 JDBC 连接同样依赖该地址。它**不**意味着
  TX1 → TX1 的流量会走到远端 WG peer：流量没有离开宿主机，因此 WG peer 不可达不会影响它，
  只有 `wg0` 地址本身消失才会。
- **可观测性**：frontend owner deploy 用 `frontend-api` 探针**穿过 frontend**
  （`http://wotb-frontend/api/health`，nginx → `BACKEND_UPSTREAM`）验证 2A 的 placement；探针直接打
  Business API 会在运行容器 dial 别处时仍然通过，属于本步骤要拒绝的 false green。探针失败时
  deploy 失败并把 `wotb-frontend` 当作受影响服务处理（与 `frontend-static` 同一策略）。
  2B 不需要新的 deploy 探针：`dependency-readiness.sh business-api` 在 **recreate 之前**就用
  `TX_BUSINESS_DB_PASSWORD` 对**新 placement** 执行真实 `psql SELECT 1`（fail-closed），而应用
  启动本身需要数据库（Flyway + `ddl-auto: validate`），`/actuator/health` 的聚合状态也包含
  `db`（`show-details: never` 只隐藏细节）。2C 同样不需要新的 deploy 探针：
  `deploy/dependency-readiness.py:check_keycloak()` 先用**已校验**的 `TX_KEYCLOAK_ADMIN_SERVER_URL`
  读取 discovery 并要求 `issuer` 仍是公开 realm URL，然后用**与 Business API 完全相同的
  admin client（`wotbtools-admin-api` + `KEYCLOAK_ADMIN_CLIENT_SECRET`）**发真实
  `client_credentials` 请求并必须拿到 access token——任何一步失败都在 recreate 之前失败，
  且凭据只在 canonical validator 通过之后才发出。2D 也不需要新的 deploy 探针：
  Keycloak owner 的 readiness 在 recreate 之前先 `resolve → validate` 新的
  `TX_KEYCLOAK_DB_HOST/PORT`，再用 `pg_isready` 探该**新 placement**（`pg_isready` 不带密码，
  真正携带 `KC_DB_PASSWORD` 的是 Keycloak 容器，它只在验证通过后才被 recreate）；而 Keycloak
  启动本身要求数据库可读（Flyway/Liquibase 迁移 + realm 读取），启动失败即 deploy 失败。
- **2D 的 JDBC 语义**：`deploy/tx/keycloak.compose.yml` 从 logical contract 生成
  `KC_DB_URL: jdbc:postgresql://${TX_KEYCLOAK_DB_HOST:-keycloak-postgres}:${TX_KEYCLOAK_DB_PORT:-5432}/${KC_DB_NAME:-keycloak}`，
  因此切换后等价于 `jdbc:postgresql://10.20.0.1:15432/<同一个库>`。库里没有任何地方默认
  `port == 5432` 或 `host == keycloak-postgres`（5432/keycloak-postgres 只作为 canonical local
  *取值* 与容器端口出现），DB 名、账号、密码、驱动与连接池语义都不变，也没有第二份硬编码 URL。
  `10.20.0.1:15432` 是 WG-only 发布（`127.0.0.1:15432` 仅供宿主管理），由
  `wireguard-service-plane` token 按精确 binding 守护。两个 PostgreSQL 端口不可互换：
  25432 是 Business，15432 是 Keycloak。
- **K6B-2C 的运行时功能边界（诚实记录）**：runtime gate 的 `business-profile` / `business-hof` /
  `hof-replay-storage` / `admin-authz` 走的是 Business API 的**用户面**，代码上**不**调用
  Keycloak Admin client（唯一调用者是 `AdminUserService`，只挂在需要 `wotbtools-admin` realm role
  的 `/api/admin/users/**`）；而 gate 的两个身份（`wotbtools-e2e` 只有 `wotbtools-user`，
  `wotbtools-admin-api` 只有 `realm-management` client roles）都**刻意**没有该 realm role
  （`admin-authz` 正是断言非管理员被 403）。因此"由 Business API 自己发起的 Admin 调用"在
  runtime gate 里**不可达**，除非新增 Keycloak realm/client 授权——那属于 Keycloak workload
  变更，不在 K6B-2C 范围内。2C 的功能证据因此是：**deploy 前**用同一 admin client 对已校验的
  新 endpoint 取到真实 token（readiness，fail-closed）＋ runtime gate 的 declared/active
  placement 断言（运行中的 Business API 容器确实持有新值）＋ gate 自己的 Keycloak Admin REST
  查询（`qq-idp-admin-api`）与 Keycloak 认证面（`keycloak` / `auth-token` / `anonymous-rejected`）。
  `KEYCLOAK_ISSUER_URI` 与公开 hostname（`https://auth.wotbtools.com`）**不变**：issuer 是
  token 语义，不是 placement endpoint，readiness 还会显式断言 discovery 报告的 issuer 仍是它。
- **每次只切一个 consumer**：未切换的 placement 在各自步骤前保持 Docker-local，并由
  `scripts/ci/test-workflow-contract.sh` 的 `CURRENT_K6B_CUTOVERS`
  pin、runtime gate 的 expectation 与
  `deploy/test-tx-runtime-check.sh` 的提前切换 fixture（2D/2E/2F）三重守护。

## Repository acceptance

`deploy/tx/runtime-check-lib.sh:assert_tx_service_ports` 比较 native Compose JSON 的
host IP、published port、target、protocol 与数量，声明顺序不影响结果。
staged deploy 对 selected owner 在 live promote/recreate 前使用同一校验；runtime readiness
使用 `wireguard-service-plane` token 检查全部五个 owner。它替代旧的
`postgres-loopback` / `business-postgres-loopback` / `keycloak-admin-loopback` token。

K6B logical endpoint 由两条 token 分别证明两个不同事实，两者都必须 PASS：

- `tx-logical-endpoints-declared`：当前环境 render 出来的 Compose 值 ∈ reviewed allowlist
  且等于 deploy helper 现在会选择的 placement。
- `tx-logical-endpoints-active`：**正在运行**的容器自己的 `Config.Env`（`docker inspect`，
  frontend/business-api/keycloak/caddy 四个 owner）同样满足上述两个条件。

只断言 rendered Compose 会给出假绿：workflow 期望与 render 都是 `10.20.0.3`，而运行中的
容器仍在 dial Docker-local，两侧都 healthy 时旧 gate 仍会输出 `TX_RUNTIME_READY`。active
token 直接读取运行容器的真实环境，因此这种不一致一定 FAIL。
`wireguard-service-plane` 继续守护 K6A published bindings。业务 E2E 与受信任公网 TLS
探针继续验证真实运行链。配置通过本身不代表 WG 实际可达。

复用的 CI 入口：

```bash
bash deploy/test-tx-runtime-config.sh
bash deploy/test-tx-runtime-check.sh
bash deploy/test-business-postgres-runtime.sh
```

前两个 fixture 分别证明 real rendered Compose/selected-owner gate 与 readiness failure。
mutation checks 覆盖缺少 WG/loopback 入口、通配/公网/无地址绑定、错误端口、UDP、重复绑定与
app/management target 混用。PostgreSQL smoke 继续使用 disposable loopback DB，验证
ownership、provider、备份恢复；不连接生产 DB。仓库 deployment validation 由 PR CI 执行。

## Post-merge production acceptance

通过现有服务 owner workflows 部署五个受影响服务；published-port 变化会 recreate 容器，
可能有短暂中断。数据库卷、512m Business PostgreSQL 限制、OpenTofu ownership/state、备份模型
均不变。不要顺带改 DNS、WG 配置、Caddy 路由、Komodo/Periphery 或生产 dependency。

TX1 先检查地址与 listener：

```bash
ip -4 addr show wg0
ss -lntp | grep -E ':(8080|8081|8087|8088|18080|15432|25432)\b'
```

预期为表中六个 WG endpoint 与三个 loopback endpoint，零新增 wildcard/public listener。
Docker 若禁用 userland proxy，`ss` 可能不显示 NAT publication；同时用各 owner 的
`docker compose ... config --format json` 和运行容器
`docker inspect --format '{{json .HostConfig.PortBindings}}' <container>` 核对精确实际绑定，
并通过下述跨宿主探测证明可达；不要仅靠配置推断连通性。

从 TX2 与 Yecao 分别执行：

```bash
curl -fsS http://10.20.0.1:8080/realms/wotbtools/.well-known/openid-configuration
curl -fsS http://10.20.0.1:8087/api/health
curl -fsS http://10.20.0.1:8088/actuator/health
curl -fsS -H 'Host: wotbtools.com' http://10.20.0.1:8081/api/health
nc -vz 10.20.0.1 15432
nc -vz 10.20.0.1 25432
```

若无 nc，可用宿主可用的等效 TCP probe；只测试 TCP connect，不为验收登录生产数据库。
8087 app 的健康路径是 `/api/health`；8088 是 management `/actuator/health`，不可混用。

随后检查现有公网路径与只读 E2E：

```bash
curl -fsS https://wotbtools.com/ >/dev/null
curl -fsS https://auth.wotbtools.com/realms/wotbtools/.well-known/openid-configuration >/dev/null
```

通过 GitHub Actions 手动触发 `.github/workflows/tx-runtime-check.yml`（`Ops / TX Runtime Check`，必须从 `main` dispatch）。workflow 先确认触发 SHA 仍是 exact current `main`，再把该 SHA 的 `runtime-check.sh`、`runtime-check-lib.sh`、`deploy.sh`、`with-deploy-lock.sh` 四个 verifier/helper 文件临时复制到 TX `/tmp/wotb-tx-runtime-check-<run>-<attempt>`；检查时显式使用 `WOTB_TX_DIR=/opt/wotb-tx`，因此 verifier 代码来自当前 Git SHA，而 Compose、容器、卷、marker 与业务数据仍读取真实 TX runtime。它通过现有 `tx-production` Secrets/Variables 注入只读检查所需凭据，从正在运行的 Frontend / Business API 容器读取当前 image ref，并在 TX host lock 下执行 staged verifier；完成后清理临时 bundle，要求最终输出 `TX_RUNTIME_READY`。它不得覆盖 `/opt/wotb-tx/deploy` 下的 live verifier 或 stage 生产 Compose/config/data，不得 deploy/recreate/stop 服务、执行 OpenTofu apply、修改 DNS，也不得关闭 TLS 验证或打印凭据。

验收记录应保存部署 SHA、actual bindings、TX2/Yecao probe、public TLS 与 E2E 结果；所有条件同时通过且 workload 未移动后才记为 K6A COMPLETE。

## Rollback and next phase

回退 K6A 提交，经同一批服务 owner 重新部署，移除新增 WG 绑定并保留原有管理入口。
卷、DNS、Caddy 与数据不变，因此无需数据迁移。遵守现有宿主部署锁，
手工 mutation 必须通过 `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>`。

K6B-2 按 consumer 逐项把 owner workflow 切到对应 endpoint variable/value；每一步单独部署并要求
`TX_RUNTIME_READY`，失败即恢复该 consumer 的 Docker-local value。

**K6B-2A rollback（只回退 Frontend → Business API）**：在同一个 revert 里把
`.github/workflows/frontend.yml` 与 `.github/workflows/tx-runtime-check.yml` 的
`TX_BACKEND_UPSTREAM` 一起改回 `http://business-api:8087`，合并后 Frontend owner 会自动重新
部署，随后重新 dispatch `Ops / TX Runtime Check` 并期望同一组 token 通过。只回退一侧不可行：
owner 值与 gate expectation 不一致时，`tx-logical-endpoints-declared` /
`tx-logical-endpoints-active` 必然 FAIL，因此不存在"回退掩盖问题"的假绿。该回退不涉及数据库、
Keycloak、Caddy、AI service、WireGuard 配置、持久卷或 DNS，也不需要恢复整个生产栈。

**K6B-2B rollback（只回退 Business API → Business PostgreSQL）**：同一个 revert 里把
`.github/workflows/business-api.yml` 与 `.github/workflows/tx-runtime-check.yml` 的
`TX_BUSINESS_DB_HOST` / `TX_BUSINESS_DB_PORT` 一起改回 `business-postgres` / `5432`，合并后
Business API owner 会自动重新部署（`dependency-readiness.sh` 会先对恢复后的 Docker-local
placement 做真实 `psql` 检查），随后重新 dispatch `Ops / TX Runtime Check`。
回退后仍然是 `2A = WG`、`2B = Docker-local`；**不得**顺手回退 2A。只回退一侧同样不可行
（declared/active 必 FAIL）。该回退只改 consumer 连接目标：不迁移 PostgreSQL 数据、schema、
Flyway 历史、数据库账号/密码/库名、持久卷、备份、OpenTofu ownership、WireGuard 配置或
published-port 架构，也不需要恢复整个生产栈。

**K6B-2C rollback（只回退 Business API → Keycloak Admin）**：同一个 revert 里把
`.github/workflows/business-api.yml` 与 `.github/workflows/tx-runtime-check.yml` 的
`TX_KEYCLOAK_ADMIN_SERVER_URL` 一起改回 `http://keycloak:8080`，并同步把
`scripts/ci/test-workflow-contract.sh` 的 `CURRENT_K6B_CUTOVERS["business-api"]` 去掉这一项，
合并后 Business API owner 会自动重新部署（`dependency-readiness.sh` 会先用恢复后的
Docker-local endpoint 完成 discovery + admin token 检查），随后重新 dispatch
`Ops / TX Runtime Check`。回退后必须是 `2A = WG`、`2B = WG`、`2C = Docker-local`；
**绝对不得**回退 2A/2B。该回退不改 Keycloak 容器、镜像、realm、client、client secret、IdP、
SPI、Keycloak PostgreSQL、hostname、公开 issuer、Caddy 路由、DNS 或 WireGuard 配置，
也不需要恢复整个生产栈。

**K6B-2D rollback（只回退 Keycloak → Keycloak PostgreSQL）**：同一个 revert 里把
`.github/workflows/keycloak.yml` 与 `.github/workflows/tx-runtime-check.yml` 的
`TX_KEYCLOAK_DB_HOST` / `TX_KEYCLOAK_DB_PORT` 一起改回 `keycloak-postgres` / `5432`，并同步把
`scripts/ci/test-keycloak-tofu-contract.sh` 的 owner pin 断言与
`CURRENT_K6B_CUTOVERS["keycloak"]` 改回同一 desired state，合并后 Keycloak owner 会自动重新
部署（readiness 先用恢复后的 Docker-local placement 做 validate + `pg_isready`），随后重新
dispatch `Ops / TX Runtime Check`。回退后必须是 `2A = WG`、`2B = WG`、`2C = WG`、
`2D = Docker-local`；**绝对不得**回退 2A/2B/2C。数据库本身没有任何需要回退的东西——没有迁移
数据、schema、库名、账号、密码、卷、备份或 provisioning 语义，只改 consumer 的连接目标。

K6B 全部 consumer 完成后，K7 才进行首个真实 Komodo workload migration。
