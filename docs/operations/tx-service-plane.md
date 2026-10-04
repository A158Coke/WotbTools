# TX WireGuard service plane（K6A / K6B）

K6A 已在 TX1 Docker-local production plane 之外建立并验收私有跨宿主入口。
K6B-1 在不切换生产流量的前提下，把消费者依赖改为 fail-closed logical endpoints；
owner workflows 当时仍显式注入 Docker-local 值。K6B-2 随后逐 consumer 切换，
每个 consumer 一次，并以 production `TX_RUNTIME_READY` 作为继续/回滚边界。

本文件现在是一份**已完成的迁移记录 + 冻结的 production baseline**：

```text
K6A    COMPLETE  TX1 WireGuard service plane 建成并生产验收

K6B-1  COMPLETE  logical endpoint 契约（resolve → validate → fail closed）
K6B-2A COMPLETE  Frontend → Business API              http://10.20.0.1:8087
K6B-2B COMPLETE  Business API → Business PostgreSQL   10.20.0.1:25432
K6B-2C COMPLETE  Business API → Keycloak Admin        http://10.20.0.1:8080
K6B-2D COMPLETE  Keycloak → Keycloak PostgreSQL       10.20.0.1:15432
K6B-2E COMPLETE  Caddy → Frontend                     10.20.0.1:8081
K6B-2F COMPLETE  Caddy → Keycloak                     10.20.0.1:8080

K6B-2  COMPLETE  六个 TX consumer 全部完成
K6B    COMPLETE  仓库内不存在 K6B-1 / K6B-2 之外的 K6B phase

Non-TX（不在 TX service plane 内，不随 placement 移动）
       Frontend → AI Service（Yecao）        http://10.20.0.2:8089
```

K6B-2F 的 production acceptance：`Ops / TX Runtime Check` run `37187973790`，exact main
`07f731e2a17d3dec1a24ac73cb27655a1d69e28f`，`tx-logical-endpoints-declared` /
`tx-logical-endpoints-active` / `wireguard-service-plane` PASS，`TX_RUNTIME_READY`。

## Production baseline（冻结，K7 的起点）

六个 TX consumer 的当前 production placement（`Expected == Declared == Active`，由 runtime gate
持续强制；`scripts/ci/test-workflow-contract.sh:K6B_FINAL_PLACEMENT_MATRIX` 是它的契约副本）：

```text
Frontend → Business API            TX_BACKEND_UPSTREAM=http://10.20.0.1:8087
Business API → Business PostgreSQL TX_BUSINESS_DB_HOST=10.20.0.1  TX_BUSINESS_DB_PORT=25432
Business API → Keycloak Admin      TX_KEYCLOAK_ADMIN_SERVER_URL=http://10.20.0.1:8080
Keycloak → Keycloak PostgreSQL     TX_KEYCLOAK_DB_HOST=10.20.0.1  TX_KEYCLOAK_DB_PORT=15432
Caddy → Frontend                   CADDY_FRONTEND_UPSTREAM=10.20.0.1:8081
Caddy → Keycloak                   CADDY_KEYCLOAK_UPSTREAM=10.20.0.1:8080

Non-TX fixed dependency
Frontend → AI Service（Yecao）      TX_AI_UPSTREAM=http://10.20.0.2:8089
```

主机地址语义：**TX1 = `10.20.0.1`、Yecao = `10.20.0.2`、TX2 = `10.20.0.3`**。
`10.20.0.2` 只承载非 TX 依赖（AI service / monitor），永远不是 TX service placement。

### 三类合法值（不要混淆）

| 类别 | 含义 | 例子 |
|---|---|---|
| **current production placement** | 本文件冻结的六个值；runtime gate 要求 declared 与 active 都等于它 | `10.20.0.1:8081` |
| **allowed rollback placement** | canonical validator 仍然接受的 Docker-local 值，用于生产事故时的紧急回退（每步只回退一个 consumer） | `wotb-frontend:80`、`keycloak:8080`、`business-postgres:5432`、`keycloak-postgres:5432`、`http://business-api:8087` |
| **future reviewed TX2 placement** | canonical validator 同样接受的 TX2 等价地址，供未来 workload migration 使用；**不是**当前 desired state | `10.20.0.3:8081` |

rollback 与 TX2 值保留在 allowlist 里是刻意的：如果 K6B 完成后把它们从 validator 删除，生产事故
时回退会被自己的 guard rail 阻断。validator 继续拒绝退役 Yecao 地址当作 TX placement、公网
hostname 当私有 placement、任意 host、错误端口/协议、path/query/userinfo，以及 wildcard/公网发布。

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
| Caddy → Frontend | `CADDY_FRONTEND_UPSTREAM` | `wotb-frontend:80` | `10.20.0.1:8081`, `10.20.0.3:8081` | **`10.20.0.1:8081`（K6B-2E 已切换）** |
| Caddy → Keycloak | `CADDY_KEYCLOAK_UPSTREAM` | `keycloak:8080` | `10.20.0.1:8080`, `10.20.0.3:8080` | **`10.20.0.1:8080`（K6B-2F 已切换）** |

上表六行即 K6B-2 的最终 placement matrix，同时被
`scripts/ci/test-workflow-contract.sh` 的 `K6B_FINAL_PLACEMENT_MATRIX`（owner 与 runtime gate
两侧都断言）与 `deploy/test-tx-runtime-check.sh` 的 K6B-2F steady-state fixture 固定下来，作为
K7 placement migration 的权威 baseline。`Docker-local default` 这一列现在只表示
**rollback 值**（见上文「三类合法值」）：它们仍在 canonical allowlist 内，任何一步都可以只回退
一个 consumer，但已不再是 reviewed production placement。

`KEYCLOAK_ISSUER_URI` 不是 placement endpoint，始终保持
`https://auth.wotbtools.com/realms/wotbtools`。Yecao AI 仍固定
`http://10.20.0.2:8089`，不随任何 TX placement 切换移动；monitor/Komodo/Loki 边界不变。
公网 host、未审核 WG 地址、
错误协议或错误端口在 live mutation 前 fail closed。K6B 不迁移任何 workload。

## Runtime gate 是永久基础设施（不是 migration-only code）

`tx-logical-endpoints-declared` 与 `tx-logical-endpoints-active` 在 K6B 期间用来证明「Git 里的
desired placement 已经真的生效」；K6B 完成后它们**继续存在**，并且是 K7 的前提条件：K7 开始移动
workload 之后，这三个 token 负责证明

```text
Git desired placement（expectation）
= rendered deployment（declared）
= actual running container（active）
```

因此 closeout 不删除、不弱化这三个 token，也不把 `Expected == Declared == Active` 降级为
「至少不是 Docker-local」。`wireguard-service-plane` 同样保留：它按精确 host IP / published
port / target / protocol 校验五个 owner 的绑定，防止公网或 wildcard 暴露。功能探针
（`frontend` / `caddy-frontend` / `public-tls-web` / `keycloak` / `caddy-keycloak` /
`public-tls-auth` / `auth-token` / `anonymous-rejected` / `admin-authz` / `qq-idp-admin-api` /
`business-postgres` / `business-postgres-provisioning` / `keycloak-postgres` / `tx-business-api` /
`business-profile` / `business-hof` / `hof-replay-storage`）同样保留：它们是 K7 workload migration
的 production acceptance 基础。

同一套 canonical validator（`deploy/tx/deploy.sh:validate_http_endpoint` /
`validate_database_endpoint` / `validate_caddy_upstream`）同时守护三个入口，仓库里没有第二份
allowlist：staged deploy、只读 dependency readiness，以及 runtime gate。因此
`deploy/dependency-readiness.sh` 在启动任何容器之前就拒绝未审核 endpoint——携带
`TX_BUSINESS_DB_PASSWORD` 的 psql 探针与携带 `KEYCLOAK_ADMIN_CLIENT_SECRET` 的
Keycloak Admin 请求都不会先发出去再等 `deploy.sh` 拒绝。probe 自身也不再为
`TX_KEYCLOAK_ADMIN_SERVER_URL` 取默认值：没有经过校验的显式值就直接失败。

## K6B-2 迁移记录：同宿主 hairpin 是刻意的 placement 验证

本节记录 K6B-2A–2F 为什么这样切换（历史依据），不是待执行的步骤。

Frontend、Business API、Keycloak、Caddy 与两套 PostgreSQL **都在 TX1**，因此六个已切换的
consumer 都是**同宿主**切换：Frontend 不再走 Docker bridge 的 `business-api:8087`，而是连到
TX1 自己的 WG 地址 `10.20.0.1:8087`；Business API 也不再走 `business-postgres:5432` 与
`http://keycloak:8080`，而是连到 `10.20.0.1:25432` 与 `http://10.20.0.1:8080`；Keycloak 也不再走
Docker bridge 的 `keycloak-postgres:5432`，而是连到 `10.20.0.1:15432`；Caddy 也不再走
`wotb-frontend:80` 与 `keycloak:8080`，而是连到 `10.20.0.1:8081` 与 `10.20.0.1:8080`。六者都经宿主的
published port 回到同一台机器。这在网络上是 hairpin，且是有意为之：

- **目的**：K6B 的目标是 logical placement abstraction / migration readiness，不是"为了使用
  WireGuard"。把 consumer 的值改成 service-plane 地址后，placement 由 Git 里的一个已评审值
  表达，未来把 Business API 移到 TX2（`10.20.0.3:8087`）、其数据库移到 TX2
  （`10.20.0.3:25432`）、Keycloak 移到 TX2（`http://10.20.0.3:8080`）、Keycloak 的数据库移到
  TX2（`10.20.0.3:15432`）、Frontend 移到 TX2（`10.20.0.3:8081`）或 Caddy 的 Keycloak upstream 移到
  TX2（`10.20.0.3:8080`）只需改这一个值；
  如果同宿主 consumer
  永远保持 Docker-local，K6B-2 的整套 allowlist 与 runtime token 就永远得不到真实验证。
- **代价**：被切换的路径比走 bridge 多一次宿主 NAT 跳；对 K6B-2B 而言，Business API 的数据库
  连接新增一个依赖——TX1 自己的 `wg0` 地址必须存在（TX deploy 的 `preflight_host` 本来就要求
  `wg0`）；对 K6B-2C 而言，Keycloak Admin 请求同样依赖该地址；对 K6B-2D 而言，Keycloak 到
  PostgreSQL 的 JDBC 连接同样依赖该地址；对 K6B-2E 而言，**公网入口**（Caddy → Frontend）也
  依赖它。它**不**意味着
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
- **2E 的 active 配置语义（为什么 `tx-logical-endpoints-active` 是真检查）**：Caddy 的
  `deploy/tx/Caddyfile` 以 `reverse_proxy {$CADDY_FRONTEND_UPSTREAM}` 使用 **Caddy 自身的环境变量
  替换**，而该 Caddyfile 是只读 bind mount、没有任何渲染步骤（`deploy/tx/caddy.compose.yml`），
  所以运行中容器的 `Config.Env` **就是** Caddy 载入配置时用的值；改变它必须 recreate 容器。
  runtime gate 的 active 记录正是 `docker inspect` 该容器的 `CADDY_FRONTEND_UPSTREAM`，因此
  "容器 env = 实际生效的 upstream"，不存在 stale rendered config 的假绿；stale-active fixture
  专门覆盖 declared WG + active `wotb-frontend:80` 的情形（declared PASS、active FAIL、
  无 `TX_RUNTIME_READY`）。
- **2E 的 Host/TLS/路由语义不变**：Caddyfile 未修改。公网 catch-all 用
  `reverse_proxy {$CADDY_FRONTEND_UPSTREAM} { header_up Host {host} }`（保留客户端 Host），
  探测路由 `/_wotb/frontend/*` 用 `header_up Host wotbtools.com`；因此 upstream 从 Docker 名换成
  IP 不改变 Host、TLS、静态资源/SPA/`/api` 路由、assetlinks、下载路由、压缩或安全头语义。
  Caddyfile 中也没有任何逻辑依赖 upstream 的 **hostname** 是 `wotb-frontend`（该名字只是 compose
  的默认值 `${CADDY_FRONTEND_UPSTREAM:-wotb-frontend:80}`，回退时仍然可用）。`10.20.0.1:8081`
  是 WG-only 发布（`deploy/tx/frontend.compose.yml`），由 `wireguard-service-plane` token 按精确
  binding 守护；8081 = Frontend、8080 = Keycloak、8087 = Business API 不可互换。
- **2F 的 active 配置语义与 2E 相同**：Caddyfile 的两条私有 upstream 都用 Caddy 自身的
  `{$VAR}` 替换（`{$CADDY_FRONTEND_UPSTREAM}` / `{$CADDY_KEYCLOAK_UPSTREAM}`），Caddyfile 是只读
  bind mount、没有渲染中间层，所以运行容器的 `Config.Env` 就是 Caddy 载入配置时的 upstream；
  runtime gate 的 active 记录是对运行中 caddy 容器 `docker inspect` 取这两个变量。2F 的
  false-green（expected/declared `10.20.0.1:8080` + active `keycloak:8080`）由 stale-active
  fixture 覆盖（declared PASS、active FAIL、无 `TX_RUNTIME_READY`）。Caddy 契约另外禁止把
  `keycloak:8080` / `10.20.0.1:8080` / `10.20.0.3:8080` 直接写死成 `reverse_proxy` 目标，
  否则 env-based active 验证会失真。
- **2F 不触碰 Keycloak 的公开身份语义**：2F 只改 Caddy 的**私有 upstream**。Keycloak 的
  `--hostname=https://auth.wotbtools.com --hostname-strict=true`、公开 hostname、realm issuer
  `https://auth.wotbtools.com/realms/wotbtools`、`KEYCLOAK_ISSUER_URI`、Caddy 的
  `auth.wotbtools.com` 站点块与 TLS 终止、以及 OIDC/QQ/WG/Android/Web/logout 的 redirect 语义
  都不变（相关文件未修改）。Caddyfile 的公开 auth catch-all 显式写
  `reverse_proxy {$CADDY_KEYCLOAK_UPSTREAM} { header_up Host {host} }`，探测路由
  `/_wotb/keycloak/*` 显式写 `header_up Host auth.wotbtools.com`，所以 upstream 从 Docker 名换成
  IP 之后 Keycloak 仍然收到 `Host: auth.wotbtools.com`（且 `--hostname-strict=true` 下 URL 生成
  本来只按配置的 hostname），不会出现跳转到私有 IP、issuer 变化、hostname-strict 失败或
  redirect loop。`10.20.0.1:8080` 是 2C 起就在用的同一个已评审 WG 绑定
  （`keycloak.compose.yml` 的 `10.20.0.1:8080:8080`，loopback `127.0.0.1:18080` 仅供宿主管理），
  2F **没有新增任何 listener / published port / 网络架构**。
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

## Rollback（K6B 已完成；以下是紧急回退记录）

K6B-2 已完成，因此本节不再是待执行的迁移步骤，而是**生产事故时的单 consumer 回退手册**：每一步
只回退一个 consumer，回退值就是上表的 `Docker-local default`（它们仍在 canonical allowlist 内），
合并后对应 owner 会自动重新部署，随后重新 dispatch `Ops / TX Runtime Check` 并要求
`TX_RUNTIME_READY`。回退必须同步 owner workflow、gate expectation 与
`K6B_FINAL_PLACEMENT_MATRIX`／`CURRENT_K6B_CUTOVERS`，只改一侧必然 FAIL。

回退 K6A 提交，经同一批服务 owner 重新部署，移除新增 WG 绑定并保留原有管理入口。
卷、DNS、Caddy 与数据不变，因此无需数据迁移。遵守现有宿主部署锁，
手工 mutation 必须通过 `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>`。

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

**K6B-2E rollback（只回退 Caddy → Frontend）**：同一个 revert 里把
`.github/workflows/caddy.yml` 与 `.github/workflows/tx-runtime-check.yml` 的
`CADDY_FRONTEND_UPSTREAM` 一起改回 `wotb-frontend:80`，并同步把
`CURRENT_K6B_CUTOVERS["caddy"]` 与 `test-workflow-contract.sh` 的 gate 期望改回同一 desired
state（`CADDY_KEYCLOAK_UPSTREAM` 保持 `keycloak:8080` 不动——那是 K6B-2F），合并后 Caddy owner
会自动重新部署，随后重新 dispatch `Ops / TX Runtime Check`，期望
`frontend` / `caddy-frontend` / `public-tls-web` 与 `TX_RUNTIME_READY` 全部通过。回退后必须是
`2A = WG`、`2B = WG`、`2C = WG`、`2D = WG`、`2E = Docker-local`、`2F = Docker-local`；
**绝对不得**回退 2A–2D。该回退不改 Caddyfile 的 route/TLS/Host 语义、不改公开 hostname、不改
DNS/WireGuard 配置、不改 Keycloak 或任何 workload。

**K6B-2F rollback（只回退 Caddy → Keycloak）**：同一个 revert 里把 `.github/workflows/caddy.yml`
与 `.github/workflows/tx-runtime-check.yml` 的 `CADDY_KEYCLOAK_UPSTREAM` 一起改回
`keycloak:8080`，并同步把 `CURRENT_K6B_CUTOVERS["caddy"]` 与 `K6B_FINAL_PLACEMENT_MATRIX`
（`scripts/ci/test-workflow-contract.sh`）的 gate 期望改回同一 desired state
（`CADDY_FRONTEND_UPSTREAM` 保持 `10.20.0.1:8081` 不动——那是 2E 的成果），合并后 Caddy owner
会自动重新部署，随后重新 dispatch `Ops / TX Runtime Check`，期望 `keycloak` / `caddy-keycloak` /
`public-tls-auth` 与 `auth-token` / `anonymous-rejected` / `admin-authz` / `qq-idp-admin-api` 以及
`TX_RUNTIME_READY` 全部通过。回退后必须是
`2A = WG`、`2B = WG`、`2C = WG`、`2D = WG`、`2E = WG`、`2F = Docker-local`；
**绝对不得**回退 2A–2E。该回退只改 Caddy 的私有 upstream（Keycloak 容器、`--hostname`、公开
issuer、realm/client、TLS、Caddyfile 路由与 Host 语义、DNS 与 WireGuard 配置都不变），因此
`keycloak:8080` 一直是 canonical allowlist 里的合法 rollback 值。

## K7 readiness baseline

以下是**已经成立的事实**，不是计划：本文件不做 K7 的 workload 排序，也不包含任何 K7 实现。

```text
K6B logical placement abstraction 已 production accepted。
六个 TX consumer 依赖全部使用 reviewed logical service-plane endpoint。
Expected == Declared == Active 由 TX runtime gate 持续强制（permanent infrastructure）。
功能探针覆盖 frontend、public TLS、auth（discovery/issuer/token/anonymous/admin/IdP）、
两套 PostgreSQL 与 Business API 读路径。
TX1 = 10.20.0.1    Yecao = 10.20.0.2    TX2 = 10.20.0.3
```

后续 K7 workload migration 必须**一次只移动一个 workload placement**，并保持 consumer contract
不变（`K6B_FINAL_PLACEMENT_MATRIX` 是它的权威 baseline）：移动前先改 Git 里的 reviewed 值，
部署后由 runtime gate 证明 declared 与 active 都等于新值，且全部功能探针仍然 PASS。

K6A 的回退入口（移除 WG 绑定、保留原管理入口）与上文每个 consumer 的紧急 rollback 手册继续有效。
