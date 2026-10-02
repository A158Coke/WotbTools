# TX Keycloak 新 Realm 启动手册

适用范围：Phase 1 在 TX 创建全新的 `keycloak-postgres` 数据库与 `wotbtools` realm。旧 Yecao Keycloak 数据库不导入；本手册不授权删除任何旧身份或业务数据。

## Git 中可导入的静态配置

Keycloak 镜像只包含自定义 provider。`infra/tofu/keycloak` 是 TX realm、角色、client、mapper
和 IdP 的唯一声明来源；镜像启动不使用 `--import-realm`。OpenTofu 在 TX localhost
`127.0.0.1:18080` 上以 bootstrap admin 建立 fresh realm，并在 apply 后执行第二次 plan
确认无 drift。

TX production Keycloak 使用 `--hostname=https://auth.wotbtools.com` 与
`--hostname-strict=true` 固定对外 OIDC issuer。容器内仍以 HTTP 8080 提供服务，
`--proxy-headers=xforwarded` 接收代理头，由 Caddy 终止对外 TLS。

## 删除保护边界（`tofu plan` 是 destructive-change 审计门）

唯一授权路径是 `.tf` 期望状态 → `tofu plan` → destructive audit → `tofu apply` → 第二次 plan 无
drift：`deploy/tx/keycloak-tofu.sh` 先 plan，再由 `infra/tofu/keycloak/validate-plan.sh` 审计该
plan，然后 apply，最后要求第二次 plan 全 no-op。因此删除保护按**「保护的是不是身份根」**划分，
而不是按「是否发生删除」划分：

| 对象 | 保护机制 | 分类 |
|---|---|---|
| `keycloak_role.realm`（realm 角色集合） | 无 `prevent_destroy`；plan guard 无 role 删除规则 | 角色成员是期望状态：增删角色是必须由 `tofu plan` 可见、可审计的正常变更，**不存在任何按角色名的例外**（含 Boost 专用白名单） |
| `keycloak_realm.wotbtools` | `prevent_destroy` + `terraform_deletion_protection` | 保护身份根：删除 realm 会连带删除全部用户、凭据、client 与角色 |
| `keycloak_openid_client.{web,admin_api,e2e}` | `prevent_destroy` | 保护身份凭据：删除/重建会轮换 client id 与 write-only secret，打断登录与门禁身份 |
| `keycloak_oidc_identity_provider.qq` | `prevent_destroy` | 保护外部身份绑定：删除会让已绑定用户无法登录 |
| `keycloak_default_roles.wotbtools` | `prevent_destroy` | 保护 realm 级不变量：新用户自动获得 `wotbtools-user` |
| realm/client 与 IdP 的 delete/replace | `validate-plan.sh` | 与上面同一批身份资源，在 plan 层 fail-closed |
| mass replacement 上限（> 3） | `validate-plan.sh` | 另一个不变量：拦截非预期的批量重建（例如 provider schema 漂移），与角色增删无关 |

回收 Boost 角色（`booster` / `boost-manager`）就是第一类的标准场景：期望状态不再声明这两个角色，
`tofu plan` 输出 `0 to add, 0 to change, 2 to destroy`，被删除地址恰为
`keycloak_role.realm["booster"]` 与 `keycloak_role.realm["boost-manager"]`，guard 必须放行。
`scripts/ci/test-keycloak-tofu-contract.sh` 用 fixture plan JSON 固定这条边界：角色删除放行（含非
Boost 角色），realm/client/IdP 删除与 mass replacement 仍被拒绝。

## 运行时配置与凭据边界

GitHub Actions Secrets / Variables 是 TX runtime 与 TX-local OpenTofu 的唯一配置入口。
工作流通过 SSH `envs` 注入变量；服务器不再维护 `/etc/wotb/tx-runtime.env` 或
`/etc/wotb/postgres-keycloak-tofu.env`。以下信息禁止写进 Git、realm JSON、tfvars、Tofu
output 或日志（`TX_QQ_CLIENT_SECRET` 的 state 归属见下一节）：

- `KC_BOOTSTRAP_ADMIN_PASSWORD`；
- `KC_POSTGRES_ADMIN_PASSWORD`；
- `KC_DB_PASSWORD`；
- `KEYCLOAK_ADMIN_CLIENT_SECRET`（`wotbtools-admin-api` 的 service account）；
- `WG_APPLICATION_ID`；
- `TX_QQ_CLIENT_SECRET`（QQ Connect application secret）。

TX workflow secrets：`TX_KC_POSTGRES_ADMIN_PASSWORD`、`TX_KC_DB_PASSWORD`、
`TX_KC_BOOTSTRAP_ADMIN_PASSWORD`、`WG_APPLICATION_ID`。非敏感固定值 `KC_POSTGRES_ADMIN_USER=kc_admin`、
`KC_DB_USERNAME=keycloak` 由 workflow 提供；`CADDY_ACME_EMAIL` 使用
`vars.CADDY_ACME_EMAIL`，为空时 fail-closed。

`wotbtools-admin-api` 是由 OpenTofu 创建的 confidential service-account client。它只获得
`realm-management` 的 `manage-users`、`query-users`、`view-realm`；secret 通过 write-only
runtime 变量注入，禁止写入 HCL、tfvars、plan 或普通 state attribute。backend 继续使用
`KEYCLOAK_ADMIN_CLIENT_ID=wotbtools-admin-api` 与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。

Wargaming IdP representation 与 Keycloak runtime 共用**同一个**已存在凭据，不引入第二个 secret：

- GitHub Secret `WG_APPLICATION_ID` 经 SSH 环境注入 Keycloak OpenTofu apply step；
- `deploy/tx/keycloak-tofu.sh` 在缺失、空值或 placeholder 时 fail-closed，并导出敏感
  `TF_VAR_wargaming_application_id`，由 `keycloak_oidc_identity_provider.wargaming` 的
  `wargaming-asia` / `wargaming-eu` / `wargaming-na` 三个实例共用为 `client_id`（值不打印、
  不进 tfvars、不进 Tofu output）；
- 同一 secret 仍注入 Keycloak runtime env `WG_APPLICATION_ID`（自定义 SPI 通过
  `System.getenv("WG_APPLICATION_ID")` 读取），因此这份注入不得删除；
- 不存在 `TX_WG_APPLICATION_ID` / `WG_CLIENT_ID` / `WARGAMING_CLIENT_ID` 等重复凭据。

官方 QQ IdP 由 OpenTofu 完整拥有，不存在 operator 手工凭据路径：

- GitHub Variable `TX_QQ_CLIENT_ID` 经 SSH 环境传入 `TF_VAR_qq_client_id`；
- GitHub Secret `TX_QQ_CLIENT_SECRET` 经 SSH 环境传入 `TF_VAR_qq_client_secret`。它是 QQ App Key
  的**唯一 source of truth**：缺失、空值或 placeholder 均使 TX-local OpenTofu apply fail-closed；
- 该 secret 是 `keycloak_oidc_identity_provider.qq` 的**普通敏感属性** `client_secret`，不是
  write-only 的 `client_secret_wo`。**不存在也不允许存在** rotation version / counter / hash：
  每次 apply 都以当次注入的值作为期望状态收敛 `idp-qq`——值不同则 plan 显示一次 IdP update，
  值相同则 no-op，因此「secret 是否变化」不需要任何版本信号来判断。provider schema 也决定了
  这一点：`client_secret_wo` 声明了 `RequiredWith = client_secret_wo_version`，且只在 version
  变化时才把写-only 值发给 Keycloak（`provider/resource_keycloak_oidc_identity_provider.go`）；
- 代价是该 secret 作为 sensitive 属性进入 TX owner-host 的 OpenTofu local state
  `/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate`。State 文件只允许 host root 访问，
  权限为 0600，父目录为 0700；state backup 同样使用 0600 权限并留在 owner host。
  Git、realm JSON、tfvars、Tofu output、日志与其它介质依然禁止。apply 期间 TX 上的
  `plan.tfplan` / `second-plan.tfplan` 同样带有该值（写-only 字段此前不会落进 plan 文件），
  因此 `deploy/tx/keycloak-tofu.sh` 的 `trap 'rm -f -- plan.tfplan second-plan.tfplan' EXIT`
  不得删除。

`qq_enabled` 的 production declaration 固定为 `true`。`idp-qq` 的 alias、enabled、client ID、
`client_secret` 与 QQ endpoint configuration 均由 OpenTofu 收敛，并以 `prevent_destroy = true`
防止删除。QQ Open Platform 已获批准且 production credentials 已可用；
仍不得将凭据复制到 GitHub Actions 与上述受 ACL 保护的 state 以外的介质。

## Identity Provider 启动顺序

1. 让 OpenTofu 创建 fresh realm，确认 `wotbtools-web`、`wotbtools-admin-api`、角色与 JWT mapper 已存在。
2. 由 OpenTofu 创建 `wargaming-asia`、`wargaming-eu`、`wargaming-na` 三个实例（`provider_id=wargaming`，
   `client_id` = 同一 `WG_APPLICATION_ID`），并在 Keycloak runtime 继续注入 `WG_APPLICATION_ID` 供自定义 SPI 读取。
3. 镜像构建 `keycloak-qq-provider` 与 `keycloak-wargaming-provider`；运行时验收必须确认
   `keycloak-qq-provider.jar` 存在且 Keycloak 已以 `start --optimized` 启动。仓库只 vendored
   这两个 provider 的源码（镜像内不存在第三个 QQ provider），历史聚合 provider 已完全退役。
4. OpenTofu 创建唯一官方 QQ alias `idp-qq`（provider id `qq`，enabled）；TX 不创建
   任何聚合 QQ fallback，也不创建裸 alias `qq`。固定 production broker callback 为
   `https://auth.wotbtools.com/realms/wotbtools/broker/idp-qq/endpoint`；QQ Open Platform、
   Android exact callback allowlist 与 Web 登录流必须使用此唯一 callback，不得引入
   `/qq/endpoint` 或 `idp-qq-v2`。

## wotbtools-web 浏览器客户端生产对齐

`infra/tofu/keycloak/client.tf` 的 `keycloak_openid_client.web` 显式声明当前生产
`wotbtools-web` 行为。字段名全部来自 pinned provider `keycloak/keycloak 5.9.0` 的
resource schema，不按 Admin Console 标签推断：

| 生产行为 | OpenTofu 声明 |
|---|---|
| client type: OpenID Connect | 资源类型 `keycloak_openid_client`（protocol 固定 `openid-connect`） |
| enabled: true | `enabled = true` |
| always display in UI: on | `always_display_in_console = true`（representation `alwaysDisplayInConsole`） |
| client authentication: off | `access_type = "PUBLIC"` |
| standard flow: on | `standard_flow_enabled = true` |
| direct access grants: off | `direct_access_grants_enabled = false` |
| implicit flow: off | `implicit_flow_enabled = false` |
| service account roles: off | `service_accounts_enabled = false` |
| PKCE required: off | `pkce_code_challenge_method = ""`（provider 允许的“无 code challenge method”取值） |
| login theme: wotbtools | `login_theme = "wotbtools"`（Keycloak client attribute `login_theme`） |
| front-channel logout: on | `frontchannel_logout_enabled = true`（representation `frontchannelLogout`） |
| front-channel logout session required: on | `extra_config` 的 `frontchannel.logout.session.required = "true"`（见下） |
| consent required: off | `consent_required = false` |

`frontchannel.logout.session.required` 是唯一没有 provider typed field 的生产设置：
provider 5.9.0 只有 `frontchannel_logout_enabled` 与 `frontchannel_logout_url`
（`backchannel_logout_session_required` 只覆盖 back-channel）。因此按 provider 官方支持的
声明方式，用其 `extra_config` map 声明，attribute key 取 Keycloak 26.6.4
`OIDCConfigAttributes.FRONT_CHANNEL_LOGOUT_SESSION_REQUIRED` 的字面值；不使用 `local-exec`、
provisioner 或 Admin Console 手工步骤。Keycloak 自身对该 attribute 的默认值也是 `true`
（`OIDCAdvancedConfigWrapper#isFrontChannelLogoutSessionRequired`），所以显式声明与
Keycloak 默认值一致，不会产生漂移。

`wotbtools-admin-api` 是 confidential service-account client，不声明任何浏览器流、theme
或 consent 设置；`security-admin-console` 等内置 client 由 Keycloak 自己拥有，OpenTofu 不管理。

## 导入后的验收

- Keycloak 使用 `start --optimized`，启动时没有 augmentation；
- image 包含 `keycloak-qq-provider.jar`，并成功以 `start --optimized` 启动；
- OpenTofu fresh realm 的 Admin API 验收通过：唯一 alias 为 `idp-qq`、`providerId=qq`、
  `enabled=true`、client ID 非 placeholder、`authorizationUrl` / `tokenUrl` / `userInfoUrl` /
  `clientAuthMethod=client_secret_post` 全部匹配 QQ contract，且 alias 集合恰好为 `idp-qq` + 三个 Wargaming；
  二次 plan 为 no-op；把注入的 QQ secret 换成新值后下一次 plan 必须是 `idp-qq` 的 in-place
  update、apply 后再次 plan 必须回到 no-op（证明没有 version 也能收敛）。**该 secret 无法回读
  断言**：Keycloak 在 list 与 single-instance 两个 Admin API representation 里都把 IdP client
  secret 掩码为 `**********`，所以验收边界就是 plan → apply；
- OIDC discovery、三个 Wargaming 登录、前端 public client redirect URI 均可验证；
- QQ Connect 凭据缺失、空值或 placeholder 时 fail-closed，不通过猜测配置绕过。
- DNS cutover 前，受控 TX runtime 必须记录一次真实 QQ E2E：Web Login → QQ authorize →
  `idp-qq` callback → Keycloak broker → 新 TX Keycloak user → WotBTools session/token；同时确认
  无 callback loop、expired_code、重复 broker alias 或聚合 QQ fallback，且无关 admin 登录仍可用。
  fresh TX realm 不迁移旧 Keycloak users。
- Android 使用 `idp-qq` 官方 OAuth callback contract；本 TX realm 不引入聚合 QQ fallback。

## TX_RUNTIME_READY 只读运行时检查

在 TX runtime 上执行 `deploy/tx/runtime-check.sh`。该入口只复用
`deploy/tx/deploy.sh` 的现有 health-probe/Compose 配置读取逻辑，不执行 staging、promote、
recreate、stop、删除或 DNS 操作。Yecao 应用运行时退役后，原先随 TX 包分发的
`yecao-backend-contract.json`（读取已删除的 Yecao `wotb-backend` bind）已删除：检查在 promote
后的布局里直接针对与脚本同级的 `docker-compose.yml` 运行，若 TX 上有受控 checkout，可设置
`WOTB_SOURCE_ROOT` 让它复核 production Compose。

全部检查通过时输出：

```text
TX_RUNTIME_READY
```

Business PostgreSQL 是权威业务状态，因此检查同样要求它完全就绪才允许 `TX_RUNTIME_READY`：
`business-postgres` 容器存在且 healthy、`pg_isready` 成功、发布端口严格为
`127.0.0.1:25432:5432`（出现 `0.0.0.0`、`::` 或 WireGuard 地址即失败）、
`/opt/wotb-tx/business-postgres.tofu-provisioned` 存在且内容精确为
`tx-local-opentofu-business-postgres`。任一检查失败即输出 `TX_RUNTIME_NOT_READY`；
这些检查全部只读，不创建、修改或删除任何数据库或数据行。详见
`docs/operations/business-postgres.md`。

检查读取的 live Compose 现在也包含 TX 业务运行时 `business-api`，因此它的必需输入同样要在
环境中提供（应用数据库凭据 `TX_BUSINESS_DB_*`、`KEYCLOAK_ADMIN_CLIENT_SECRET`），缺失时检查在
渲染阶段立即拒绝，而不是给出误导性的 ready。该运行时不再携带任何 AI provider 变量
（AI 配置归属 Yecao `ai-service`），因此检查也不需要 `AI_API_KEY`。检查本身仍只读：这些值
只用于 Compose 渲染与就绪判定，不写盘、不落日志。

## 全业务 E2E token（operator 运行时需要）

检查只有一个入口，没有阶段或模式：

```text
bash deploy/tx/runtime-check.sh
```

除上面的输入，检查还需要以下非默认输入：

```text
KEYCLOAK_E2E_CLIENT_SECRET   wotbtools-e2e 机器身份的 client secret（GitHub Secret，write-only）
可选：
WOTB_E2E_REPLAY_PATH         探针容器内的回放 fixture（默认 /e2e/random-battle-example.wotbreplay，
                             由 Deploy 从 common/fixtures/replays staged 到 /opt/wotb-tx/e2e）
WOTB_E2E_PUBLIC_IP           公网边缘必须由其应答的 TX 地址（默认 118.25.18.105）
```

检查用 `wotbtools-e2e`（client_credentials）驱动真实链路并逐项输出
`hof-replay-storage`、`admin-authz`、`anonymous-rejected`（回放解析相关检查随服务端解析一起删除）。
任何一项 FAIL 都输出 `TX_RUNTIME_NOT_READY`：**这是「TX runtime
不是业务可用状态」的机械含义**。

- 检查不做付费 AI 调用：AI Review 已迁至独立 `ai-service`，本检查不再消费 `ai-facts.json`
  （该 artifact 随 AI 解耦退役）。
- 检查对基础设施与用户数据只读。
- `business-data-integrity` 已**随 cutover machinery 一并退役**：它的输入是 X1 搬迁前从 Yecao
  只读导出的逐表行数快照（`WOTB_E2E_DATA_SNAPSHOT`），Yecao 业务库退役后无法再生，冻结行数
  也会随生产数据增长永久 FAIL，因此连同该 token 一起删除，不保留替代检查。
- `hof-replay-storage` 需要 `replay_data` 卷存在且至少存在一条可下载的 HoF 回放记录。

### 公网边缘：只接受受信任 TLS

公开 DNS 已在 TX，因此边缘检查只接受一种结果：两个公开名（`wotbtools.com` /
`auth.wotbtools.com`）必须由 `WOTB_E2E_PUBLIC_IP`（TX 地址）应答、受信任证书校验通过、HTTP 2xx。
`curl` 退出码 `60`（链不受信）、非 2xx 或连通失败（7/28/35）一律 FAIL。检查全程**不关闭 TLS
校验**、**不使用** `-k/--insecure`：

| token | 断言 |
|---|---|
| `public-tls-web` / `public-tls-auth` | 该 host 必须解析到 `WOTB_E2E_PUBLIC_IP`、受信任证书校验通过、HTTP 2xx；退出码 `60`（不受信）或连通失败即 FAIL |

路由正确性（frontend / Keycloak upstream）由 Caddy 内部 readiness surface
（`http://caddy/_wotb/...`，走 Docker service DNS）证明，不依赖固定容器 IP 或证书。

成功时输出：

```text
TX_RUNTIME_READY
```

顺序是：Caddy 已在 TX 所有接口上绑 80/443（生产默认，见 `deploy/tx/docker-compose.yml`）
→ 检查全绿即代表当前生产拓扑可用。

### Caddy 不再有固定容器地址

旧配置把 Caddy 固定在 `172.29.0.2`，在真实 TX 上与其他服务的动态地址冲突
（`failed to set up container networking: Address already in use`）。现在：

- Compose 不 pin 任何容器地址，Caddy 通过正常网络分配加入 `wotb_tx_internal`；
- readiness surface 绑定 `http://caddy`（Docker service DNS），所有内部探针使用
  `http://caddy/_wotb/...` 与 `http://caddy/.well-known/assetlinks.json`；
- frontend nginx 的 `set_real_ip_from` 改为信任整个 `wotb_tx_internal` 子网
  （`172.29.0.0/16`），因为信任边界不再是某个固定对端地址；该子网只包含本 TX 应用栈的容器，
  Caddy 仍是其中唯一的公网入口。

## Keycloak PostgreSQL backup owner

`deploy/tx/keycloak-postgres.compose.yml` is the sole Keycloak PostgreSQL service
definition and is included by the TX main Compose file. The independent
`keycloak-postgres.yml` owner stages this fragment directly and fixes Compose
project `deploy`; its existing Docker volume remains
`deploy_keycloak_postgres_data`. Before recreating the service, the workflow
requires that volume, checks its Compose labels and any existing container mount,
and refuses a different identity. It also promotes the validated fragment beside
the main Compose file for later runtime checks.

The scheduled `database-backup.yml` calls
`deploy/tx/keycloak-postgres-backup.sh`. It only reads the existing running
service, verifies the same project and volume identity, and publishes regular
`keycloak-<timestamp>.dump` and `.dump.sha256` files after archive and checksum
validation. It never starts or recreates PostgreSQL and never mutates the source
database. Keycloak archives must not be passed to the Business PostgreSQL restore
tool.
