# K6B-1：TX logical endpoints 可配置化

状态：已批准 / 执行中  
批准来源：用户 2026-10-03 明确“开工”。

## 目标

在 K6A 已验证的 WireGuard service plane 之上，把 TX 生产消费者对 Docker service name 的直接依赖改成**可配置的 logical endpoint**，但本阶段默认值保持当前 Docker-local 路径，生产流量不切换、不迁移 workload。

K6B-1 完成后，K6B-2 只需要变更已审核的 endpoint variables，就能逐项把消费者切到 TX1/TX2 WireGuard 地址，不再改业务 Compose 结构。

## 范围

1. Frontend
   - 复用现有 `TX_BACKEND_UPSTREAM`。
   - 默认保持 `http://business-api:8087`。
   - 允许受控的 TX WireGuard Business API endpoint。
2. Business API
   - 引入 `TX_BUSINESS_DB_HOST` / `TX_BUSINESS_DB_PORT`，映射为应用 `POSTGRES_HOST` / `POSTGRES_PORT`。
   - 引入 `TX_KEYCLOAK_ADMIN_SERVER_URL`，映射为 `KEYCLOAK_ADMIN_SERVER_URL`。
   - `KEYCLOAK_ISSUER_URI` 保持 `https://auth.wotbtools.com/realms/wotbtools`。
3. Keycloak
   - 引入 `TX_KEYCLOAK_DB_HOST` / `TX_KEYCLOAK_DB_PORT`，生成 `KC_DB_URL`。
4. Caddy
   - 引入 `CADDY_FRONTEND_UPSTREAM` / `CADDY_KEYCLOAK_UPSTREAM`。
   - 默认保持 `wotb-frontend:80` / `keycloak:8080`。
5. Deployment contracts
   - 更新 staged validation、runtime readiness、dependency readiness、workflow env 传递。
   - endpoint 只允许当前 Docker-local 默认值或 reviewed WireGuard service-plane 地址；拒绝公网 URL、错误端口和 wildcard。
6. Documentation
   - 更新 `.env.example`、`docs/operations/tx-service-plane.md`、相关 deploy 文档。

## 非目标

- 不切换任何生产消费者到 WireGuard endpoint。
- 不迁移 Frontend / Business API / Keycloak / PostgreSQL / Caddy 到 TX2。
- 不改 DNS、Caddy 公网域名、WireGuard topology、Komodo/Periphery。
- 不改 Keycloak public issuer。
- 不引入 service discovery、Consul/Nomad/Kubernetes。
- 不改数据库数据或 volume ownership。

## SSOT / 约束

- K6A endpoint contract 继续由 `docs/operations/tx-service-plane.md` 与 `deploy/tx/runtime-check-lib.sh:assert_tx_service_ports` 守护。
- logical endpoint 只复用现有 Compose env + deploy validation，不新增第二套配置文件或 endpoint registry。
- production endpoint variables 由各 owner workflow 的 `tx-production` GitHub Variables 注入；未设置时使用 Docker-local 默认值。
- `KEYCLOAK_ISSUER_URI` 永远保持 public issuer。
- Caddy 仍是唯一公网 80/443 ingress。

## 风险

- endpoint validation 过宽可能允许公网绕路。
- endpoint validation 过窄会阻断 K6B-2。
- Caddy env placeholder 与静态 inventory validator 必须同时更新，避免“配置可变但 validator 仍写死”。
- PostgreSQL port 配置必须贯穿 Spring datasource；只改 Compose 不改 `application.yml` 会导致端口变量无效。

## 分步计划

| 步骤 | 状态 | 内容 |
|---|---|---|
| 1 | 完成 | 审计当前 Docker-local dependency、workflow env、runtime/deploy validator |
| 2 | 进行中 | 实现 logical endpoint variables 与 fail-closed validation |
| 3 | 待执行 | 更新 runtime/dependency/readiness fixtures 与 regression tests |
| 4 | 待执行 | 同步 canonical docs / env example |
| 5 | 待执行 | Review-Fix + Review-With-Docs，零 blocker 后开 PR |

## 验收标准

- 不设置任何新 variable 时，rendered production Compose 与当前 dependency 路径语义一致。
- Frontend / Business API / Keycloak / Caddy 均可接受 reviewed TX1 WireGuard endpoint。
- 公网 host、错误端口、错误协议、未审核地址必须在 live mutation 前 fail closed。
- `KEYCLOAK_ISSUER_URI` 仍为 public URL。
- K6A `assert_tx_service_ports` 不变量保持不变。
- 现有 deployment validation/targeted regression tests 通过。
- PR CI 作为 repository-level authoritative gate。

## K6B-2 后续切换顺序

1. Frontend → Business API WG endpoint。
2. Business API → Business PostgreSQL WG endpoint。
3. Business API Admin → Keycloak WG endpoint。
4. Keycloak → Keycloak PostgreSQL WG endpoint。
5. Caddy Web/Auth → Frontend/Keycloak WG endpoint。

每一步单独部署并运行 `TX_RUNTIME_READY`；任一步失败即恢复该 endpoint variable 的 Docker-local 值。
