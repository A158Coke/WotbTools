# TX WireGuard service plane 运行手册

TX1 的私有 service plane 为 TX 内服务提供 reviewed、fail-closed 的跨宿主 endpoint。TX 内 consumer 不再直接依赖 Docker bridge 名称；所有 placement 由 Git 中的 reviewed 值表达，并同时受 staged deploy、只读 dependency readiness 与 runtime gate 三处 canonical validator 约束。

当前 host role：

```text
TX1    10.20.0.1   TX production services + Caddy 公网 ingress
Yecao  10.20.0.2   非 TX 依赖：AI service（8089）、monitor
TX2    10.20.0.3   Frontend replica peer（8081）
```

## 当前生产 placement

```text
Frontend → Business API             TX_BACKEND_UPSTREAM=http://10.20.0.1:8087
Business API → Business PostgreSQL  TX_BUSINESS_DB_HOST=10.20.0.1  TX_BUSINESS_DB_PORT=25432
Business API → Keycloak Admin       TX_KEYCLOAK_ADMIN_SERVER_URL=http://10.20.0.1:8080
Keycloak → Keycloak PostgreSQL      TX_KEYCLOAK_DB_HOST=10.20.0.1  TX_KEYCLOAK_DB_PORT=15432
Caddy → Frontend pool               CADDY_FRONTEND_UPSTREAM=10.20.0.1:8081
                                    CADDY_FRONTEND_PEER=10.20.0.3:8081
Caddy → Keycloak                    CADDY_KEYCLOAK_UPSTREAM=10.20.0.1:8080

非 TX 固定依赖
Frontend → AI Service（Yecao）      TX_AI_UPSTREAM=http://10.20.0.2:8089
```

`scripts/ci/test-workflow-contract.sh` 的 `K6B_FINAL_PLACEMENT_MATRIX` 固定六个 TX consumer 的 reviewed TX1 placement（不含 `CADDY_FRONTEND_PEER`）；`CADDY_FRONTEND_PEER` 由 Caddy owner 与 `deploy/tx/Caddyfile` 契约单独断言。TX consumer matrix 由 runtime gate 持续要求 `Expected == Declared == Active`；Frontend peer 由 Caddy owner 的 health/active 检查守护。

### 三类合法值（不要混淆）

| 类别 | 含义 | 例子 |
|---|---|---|
| **current production placement** | 上表冻结的 TX 值；runtime gate 要求 declared 与 active 都等于它 | `10.20.0.1:8081`、`10.20.0.3:8081` |
| **allowed rollback placement** | canonical validator 仍然接受的 Docker-local 值，用于生产事故时的紧急回退（每步只回退一个 consumer） | `wotb-frontend:80`、`keycloak:8080`、`business-postgres:5432`、`keycloak-postgres:5432`、`http://business-api:8087` |
| **reviewed TX2 placement** | canonical validator 同样接受、但只对已批准迁移生效的 TX2 等价地址 | `10.20.0.3:8081`（Frontend，已生效）；其它 TX2 地址未授权 |

rollback 与 TX2 值保留在 allowlist 里是刻意的：如果迁移完成后把它们从 validator 删除，生产事故时回退会被自己的 guard rail 阻断。validator 继续拒绝退役 Yecao 地址当作 TX placement、公网 hostname 当私有 placement、任意 host、错误端口/协议、path/query/userinfo，以及 wildcard/公网发布。

## Endpoint 契约

| 服务 | TX1 WG TCP endpoint | 容器端口 | 保留的 loopback 管理入口 |
|---|---|---|---|
| Frontend | 10.20.0.1:8081 | 80 | — |
| Business API app | 10.20.0.1:8087 | 8087 | — |
| Business API management | 10.20.0.1:8088 | 8088 | — |
| Keycloak | 10.20.0.1:8080 | 8080 | 127.0.0.1:18080 |
| Keycloak PostgreSQL | 10.20.0.1:15432 | 5432 | 127.0.0.1:15432 |
| Business PostgreSQL | 10.20.0.1:25432 | 5432 | 127.0.0.1:25432 |

TX2 只发布 `10.20.0.3:8081` 的 Frontend replica peer；TX2 上没有其它已授权的生产 service endpoint。

Loopback 供宿主本地管理/OpenTofu；WG endpoint 供私有跨宿主访问。唯一公网 HTTP/HTTPS ingress 仍是 Caddy 的 80/443。UFW inactive 不允许使用 wildcard/public bind；服务入口只接受表中精确 TCP 绑定，禁止 `0.0.0.0`、`::`、公网 IP 或裸 `5432` 发布。两套 PostgreSQL 可同时在不同宿主地址上使用相同的各自 host port。

### Logical endpoint 契约

`当前生效值` 是当前生产实际 placement；`Docker-local 回滚值` 只用于紧急回退（仍在 canonical allowlist 内）。

| 消费方 | 变量 | Docker-local 回滚值 | 已评审 WG 值 | 当前生效值 |
|---|---|---|---|---|
| Frontend → Business API | `TX_BACKEND_UPSTREAM` | `http://business-api:8087` | `http://10.20.0.1:8087`, `http://10.20.0.3:8087` | `http://10.20.0.1:8087` |
| Business API → Business PostgreSQL | `TX_BUSINESS_DB_HOST/PORT` | `business-postgres:5432` | `10.20.0.1:25432`, `10.20.0.3:25432` | `10.20.0.1:25432` |
| Business API → Keycloak Admin | `TX_KEYCLOAK_ADMIN_SERVER_URL` | `http://keycloak:8080` | `http://10.20.0.1:8080`, `http://10.20.0.3:8080` | `http://10.20.0.1:8080` |
| Keycloak → Keycloak PostgreSQL | `TX_KEYCLOAK_DB_HOST/PORT` | `keycloak-postgres:5432` | `10.20.0.1:15432`, `10.20.0.3:15432` | `10.20.0.1:15432` |
| Caddy → Frontend | `CADDY_FRONTEND_UPSTREAM` | `wotb-frontend:80` | `10.20.0.1:8081`, `10.20.0.3:8081` | `10.20.0.1:8081` |
| Caddy → Frontend peer | `CADDY_FRONTEND_PEER` | `wotb-frontend:80` | `10.20.0.1:8081`, `10.20.0.3:8081` | `10.20.0.3:8081` |
| Caddy → Keycloak | `CADDY_KEYCLOAK_UPSTREAM` | `keycloak:8080` | `10.20.0.1:8080`, `10.20.0.3:8080` | `10.20.0.1:8080` |

K7C Frontend pool 的 active 语义：

- `deploy/tx/Caddyfile` 用 `reverse_proxy {$CADDY_FRONTEND_UPSTREAM} {$CADDY_FRONTEND_PEER}` + `lb_policy weighted_round_robin 2 8`，对两个 peer 做 `/version.json` active health check（10s interval、3s timeout）；TX1 weight 2（约 20%）、TX2 weight 8（约 80%）。
- Caddyfile 是只读 bind mount、没有渲染中间层，upstream 由运行容器 env 决定；runtime gate 读取运行容器 env 即读取实际生效的 upstream。
- TX2 Frontend replica 由 `.github/workflows/frontend-replica.yml` 部署，拉取与 TX1 相同的 immutable TCR artifact，不从 TX1 运行容器复制状态。
- 两个 peer 必须各自独立通过 Caddy owner 的 `/version.json` 与 `/api/health` 探针，才能被接受进 pool。

`KEYCLOAK_ISSUER_URI` 不是 placement endpoint，始终保持 `https://auth.wotbtools.com/realms/wotbtools`。Yecao AI 固定 `http://10.20.0.2:8089`，不随任何 TX placement 切换移动；monitor/Komodo/Loki 边界不变。公网 host、未审核 WG 地址、错误协议或错误端口在 live mutation 前 fail closed。

## 回滚契约

生产事故时按 consumer 回退：每一步只回退一个 consumer，回退值使用上表的 Docker-local rollback。回退必须同步 owner workflow、gate expectation 与 `CURRENT_K6B_CUTOVERS` / `K6B_FINAL_PLACEMENT_MATRIX`；只改一侧必然 FAIL。

| 消费方 | 回滚值 | 必须同步的位置 |
|---|---|---|
| Frontend → Business API | `http://business-api:8087` | `.github/workflows/frontend.yml`、`.github/workflows/tx-runtime-check.yml`、`CURRENT_K6B_CUTOVERS["frontend"]` |
| Business API → Business PostgreSQL | `business-postgres:5432` | `.github/workflows/business-api.yml`、`.github/workflows/tx-runtime-check.yml`、`CURRENT_K6B_CUTOVERS["business-api"]` |
| Business API → Keycloak Admin | `http://keycloak:8080` | `.github/workflows/business-api.yml`、`.github/workflows/tx-runtime-check.yml`、`CURRENT_K6B_CUTOVERS["business-api"]` |
| Keycloak → Keycloak PostgreSQL | `keycloak-postgres:5432` | `.github/workflows/keycloak.yml`、`.github/workflows/tx-runtime-check.yml`、`CURRENT_K6B_CUTOVERS["keycloak"]`、`scripts/ci/test-keycloak-tofu-contract.sh` 的 owner pin |
| Caddy → Frontend / peer | `wotb-frontend:80` | `.github/workflows/caddy.yml`、`.github/workflows/tx-runtime-check.yml`、`CURRENT_K6B_CUTOVERS["caddy"]`；彻底退出双实例池时同时把 `CADDY_FRONTEND_PEER` 置为 `wotb-frontend:80` |
| Caddy → Keycloak | `keycloak:8080` | `.github/workflows/caddy.yml`、`.github/workflows/tx-runtime-check.yml`、`CURRENT_K6B_CUTOVERS["caddy"]` |

合并后对应 owner 会自动重新部署，随后重新 dispatch `Ops / TX Runtime Check` 并要求 `TX_RUNTIME_READY`。回退不迁移数据库数据、schema、Flyway 历史、账号/密码/库名、持久卷、备份、OpenTofu ownership、WireGuard 配置或 DNS。

Frontend peer 的临时退出可以先依赖 Caddy 的 active health check 自动移出失败 peer；彻底移除 TX2 peer 时按 Caddy owner contract 修改 `CADDY_FRONTEND_PEER` 与 gate 期望并重新部署。

遵守现有宿主部署锁，手工 mutation 必须通过 `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>`。不要顺带改 DNS、WG 配置、Caddy 路由、Komodo/Periphery 或生产 dependency。

## Runtime gate 是永久基础设施

`tx-logical-endpoints-declared`、`tx-logical-endpoints-active` 与 `wireguard-service-plane` 不是 migration-only code，而是持续证明：

```text
Git desired placement（expectation）
= rendered deployment（declared）
= actual running container（active）
```

- `tx-logical-endpoints-declared`：当前环境 render 出来的 Compose 值 ∈ reviewed allowlist，且等于 deploy helper 现在会选择的 placement。
- `tx-logical-endpoints-active`：**正在运行**的容器 `Config.Env`（`docker inspect`，frontend/business-api/keycloak/caddy 四个 owner）同样满足上述条件。
- `wireguard-service-plane`：按精确 host IP / published port / target / protocol 校验五个 owner 的绑定，防止公网或 wildcard 暴露。

只断言 rendered Compose 会给出假绿：Git expectation 与 render 都是已评审值，而运行中的容器仍在 dial Docker-local 时，两侧都 healthy 的旧 gate 仍会输出 `TX_RUNTIME_READY`。active token 直接读取运行容器的真实环境，因此这种不一致一定 FAIL。

功能探针（`frontend` / `caddy-frontend` / `public-tls-web` / `keycloak` / `caddy-keycloak` / `public-tls-auth` / `auth-token` / `anonymous-rejected` / `admin-authz` / `qq-idp-admin-api` / `business-postgres` / `business-postgres-provisioning` / `keycloak-postgres` / `tx-business-api` / `business-profile` / `business-hof` / `hof-replay-storage`）继续作为 placement change 的 production acceptance 基础。

同一套 canonical validator（`deploy/tx/deploy.sh:validate_http_endpoint` / `validate_database_endpoint` / `validate_caddy_upstream`）同时守护三个入口，仓库里没有第二份 allowlist：staged deploy、只读 dependency readiness，以及 runtime gate。因此 `deploy/dependency-readiness.sh` 在启动任何容器之前就拒绝未审核 endpoint——携带 `TX_BUSINESS_DB_PASSWORD` 的 psql 探针与携带 `KEYCLOAK_ADMIN_CLIENT_SECRET` 的 Keycloak Admin 请求都不会先发出去再等 `deploy.sh` 拒绝。probe 自身也不为 `TX_KEYCLOAK_ADMIN_SERVER_URL` 取默认值：没有经过校验的显式值就直接失败。

复用的 CI 入口：

```bash
bash deploy/test-tx-runtime-config.sh
bash deploy/test-tx-runtime-check.sh
bash deploy/test-business-postgres-runtime.sh
```

前两个 fixture 分别证明 real rendered Compose/selected-owner gate 与 readiness failure。mutation checks 覆盖缺少 WG/loopback 入口、通配/公网/无地址绑定、错误端口、UDP、重复绑定与 app/management target 混用。PostgreSQL smoke 继续使用 disposable loopback DB，验证 ownership、provider、备份恢复；不连接生产 DB。仓库 deployment validation 由 PR CI 执行。

## Placement 变更验收

任何 placement 变更都必须一次只移动一个 workload，并保持 consumer contract 不变：

1. 先改 Git 里的 reviewed 值（owner workflow + gate expectation + matrix）。
2. 部署后由 runtime gate 证明 declared 与 active 都等于新值。
3. 全部功能探针仍然 PASS，且 `TX_RUNTIME_READY` 输出。
4. 保存部署 SHA、actual bindings、跨宿主 probe、public TLS 与 E2E 结果。

TX1 地址与 listener 检查：

```bash
ip -4 addr show wg0
ss -lntp | grep -E ':(8080|8081|8087|8088|18080|15432|25432)\b'
```

预期为表中六个 TX1 WG endpoint 与三个 loopback endpoint，零新增 wildcard/public listener。Docker 若禁用 userland proxy，`ss` 可能不显示 NAT publication；同时用各 owner 的 `docker compose ... config --format json` 和运行容器 `docker inspect --format '{{json .HostConfig.PortBindings}}' <container>` 核对精确实际绑定，并通过跨宿主探测证明可达；不要仅靠配置推断连通性。

从 TX2 与 Yecao 分别执行：

```bash
curl -fsS http://10.20.0.1:8080/realms/wotbtools/.well-known/openid-configuration
curl -fsS http://10.20.0.1:8087/api/health
curl -fsS http://10.20.0.1:8088/actuator/health
curl -fsS -H 'Host: wotbtools.com' http://10.20.0.1:8081/api/health
nc -vz 10.20.0.1 15432
nc -vz 10.20.0.1 25432
```

若无 nc，可用宿主可用的等效 TCP probe；只测试 TCP connect，不为验收登录生产数据库。8087 app 的健康路径是 `/api/health`；8088 是 management `/actuator/health`，不可混用。

随后检查现有公网路径与只读 E2E：

```bash
curl -fsS https://wotbtools.com/ >/dev/null
curl -fsS https://auth.wotbtools.com/realms/wotbtools/.well-known/openid-configuration >/dev/null
```

通过 GitHub Actions 手动触发 `.github/workflows/tx-runtime-check.yml`（`Ops / TX Runtime Check`，必须从 `main` dispatch）。workflow 先确认触发 SHA 仍是 exact current `main`，再把该 SHA 的 `runtime-check.sh`、`runtime-check-lib.sh`、`deploy.sh`、`with-deploy-lock.sh` 四个 verifier/helper 文件临时复制到 TX `/tmp/wotb-tx-runtime-check-<run>-<attempt>`；检查时显式使用 `WOTB_TX_DIR=/opt/wotb-tx`，因此 verifier 代码来自当前 Git SHA，而 Compose、容器、卷、marker 与业务数据仍读取真实 TX runtime。它通过 repository-level Actions secrets / variables 注入只读检查所需凭据，从正在运行的 Frontend / Business API 容器读取当前 image ref，并在 TX host lock 下执行 staged verifier；完成后清理临时 bundle，要求最终输出 `TX_RUNTIME_READY`。它不得覆盖 `/opt/wotb-tx/deploy` 下的 live verifier 或 stage 生产 Compose/config/data，不得 deploy/recreate/stop 服务、执行 OpenTofu apply、修改 DNS，也不得关闭 TLS 验证或打印凭据。

service-plane 的建立与 consumer 迁移技术历史见 `docs/architecture/TECHNICAL_EVOLUTION.md`。
