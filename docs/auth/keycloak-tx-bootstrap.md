# TX Keycloak 新 Realm 启动手册

适用范围：Phase 1 在 TX 创建全新的 `keycloak-postgres` 数据库与 `wotbtools` realm。旧 Yecao Keycloak 数据库不导入；本手册不授权删除任何旧身份或业务数据。

## Git 中可导入的静态配置

Keycloak 镜像只包含自定义 provider。`infra/tofu/keycloak` 是 TX realm、角色、client、mapper
和 IdP 的唯一声明来源；镜像启动不使用 `--import-realm`。OpenTofu 在 TX localhost
`127.0.0.1:18080` 上以 bootstrap admin 建立 fresh realm，并在 apply 后执行第二次 plan
确认无 drift。

## 运行时配置与凭据边界

GitHub Actions Secrets / Variables 是 TX runtime 与 TX-local OpenTofu 的唯一配置入口。
工作流通过 SSH `envs` 注入变量；服务器不再维护 `/etc/wotb/tx-runtime.env` 或
`/etc/wotb/postgres-keycloak-tofu.env`。以下信息禁止写进 Git、realm JSON、tfvars、Tofu
state 或日志：

- `KC_BOOTSTRAP_ADMIN_PASSWORD`；
- `KC_POSTGRES_ADMIN_PASSWORD`；
- `KC_DB_PASSWORD`；
- `KEYCLOAK_ADMIN_CLIENT_SECRET`（`wotbtools-admin-api` 的 service account）；
- `WG_APPLICATION_ID`；
- `TX_QQ_CLIENT_SECRET`（QQ Connect application secret）。

TX workflow secrets：`TX_KC_POSTGRES_ADMIN_PASSWORD`、`TX_KC_DB_PASSWORD`、
`TX_KC_BOOTSTRAP_ADMIN_PASSWORD`、`WG_APPLICATION_ID`、`TENCENTCLOUD_SECRET_ID`、
`TENCENTCLOUD_SECRET_KEY`。非敏感固定值 `KC_POSTGRES_ADMIN_USER=kc_admin`、
`KC_DB_USERNAME=keycloak` 由 workflow 提供；`CADDY_ACME_EMAIL` 使用
`vars.CADDY_ACME_EMAIL`，为空时 fail-closed。

`wotbtools-admin-api` 是由 OpenTofu 创建的 confidential service-account client。它只获得
`realm-management` 的 `manage-users`、`query-users`、`view-realm`；secret 通过 write-only
runtime 变量注入，禁止写入 HCL、tfvars、plan 或普通 state attribute。backend 继续使用
`KEYCLOAK_ADMIN_CLIENT_ID=wotbtools-admin-api` 与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。

官方 QQ IdP 由 OpenTofu 完整拥有，不存在 operator 手工凭据路径：

- GitHub Variable `TX_QQ_CLIENT_ID` 经 SSH 环境传入 `TF_VAR_qq_client_id`；
- GitHub Secret `TX_QQ_CLIENT_SECRET` 经 SSH 环境传入 write-only
  `TF_VAR_qq_client_secret`，不得写进 tfvars、日志或普通 state attribute；
- GitHub Variable `TX_QQ_CLIENT_SECRET_VERSION` 经 SSH 环境传入
  `TF_VAR_qq_client_secret_version`。secret 每次轮换必须同时递增该正整数版本；缺失、空值、
  placeholder 或非法版本均使 TX-local OpenTofu apply fail-closed。

`qq_enabled` 的 production declaration 固定为 `true`。`idp-qq` 的 alias、enabled、client ID、
write-only secret/version 与 QQ endpoint configuration 均由 OpenTofu 收敛，并以
`prevent_destroy = true` 防止删除。QQ Open Platform 已获批准且 production credentials 已可用；
仍不得将凭据复制到 GitHub Actions 以外的介质。

## Identity Provider 启动顺序

1. 让 OpenTofu 创建 fresh realm，确认 `wotbtools-web`、`wotbtools-admin-api`、角色与 JWT mapper 已存在。
2. 由 OpenTofu 创建 `wargaming-asia`、`wargaming-eu`、`wargaming-na` 三个实例，并只在 Keycloak runtime 注入 `WG_APPLICATION_ID`。
3. 镜像构建 `keycloak-qq-provider` 与 `keycloak-wargaming-provider`；运行时验收必须确认
   `keycloak-qq-provider.jar` 存在且 Keycloak 已以 `start --optimized` 启动。仓库仍保留
   vendored legacy Juhe provider 源码/镜像 artifact 以兼容历史构建，但 TX realm 不创建它的实例，
   不得把它作为 fallback。
4. OpenTofu 创建唯一官方 QQ alias `idp-qq`（provider id `qq`，enabled）；TX 不创建
   `juhe-qq` fallback，也不创建裸 alias `qq`。固定 production broker callback 为
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
  `enabled=true`、client ID 非 placeholder、`authorizationUrl` / `tokenUrl` /
  `userInfoUrl` / `clientAuthMethod=client_secret_post` 全部匹配 QQ contract，且没有 `qq` 或
  `juhe-qq` alias；二次 plan 为 no-op；
- OIDC discovery、三个 Wargaming 登录、前端 public client redirect URI 均可验证；
- QQ Connect 凭据或 rotation version 缺失/非法时 fail-closed，不通过猜测配置绕过。
- DNS cutover 前，受控 TX runtime 必须记录一次真实 QQ E2E：Web Login → QQ authorize →
  `idp-qq` callback → Keycloak broker → 新 TX Keycloak user → WotBTools session/token；同时确认
  无 callback loop、expired_code、重复 broker alias 或 Juhe fallback，且无关 admin 登录仍可用。
  fresh TX realm 不迁移旧 Keycloak users。
- Android 使用 `idp-qq` 官方 OAuth callback contract；本 TX realm 不引入 Juhe fallback。

## PRE_CUTOVER_READY 只读门禁

在申请 DNS cutover 前，在 TX runtime 上执行 `deploy/tx/pre-cutover-check.sh`。该入口只复用
`deploy/tx/deploy.sh` 的现有 health-probe/Compose 配置读取逻辑，不执行 staging、promote、
recreate、stop、删除或 DNS 操作。TX 包内的 `yecao-backend-contract.json` 是由 Yecao
Compose contract test 校验的非机密 bind 基线；若 TX 上另有受控 checkout，可设置
`WOTB_SOURCE_ROOT` 让门禁直接复核 production Compose。两者都不可用时，门禁会拒绝宣称 ready，
而不是猜测 backend bind。

全部检查通过时输出：

```text
PRE_CUTOVER_READY
DNS_CUTOVER_NOT_PERFORMED
WAITING_FOR_OPERATOR_APPROVAL
```

Business PostgreSQL 是权威业务状态，因此门禁同样要求它完全就绪才允许 `PRE_CUTOVER_READY`：
`business-postgres` 容器存在且 healthy、`pg_isready` 成功、发布端口严格为
`127.0.0.1:25432:5432`（出现 `0.0.0.0`、`::` 或 WireGuard 地址即失败）、
`/opt/wotb-tx/business-postgres.tofu-provisioned` 存在且内容精确为
`tx-local-opentofu-business-postgres`。任一检查失败即输出 `PRE_CUTOVER_NOT_READY`；
这些检查全部只读，不创建、修改或删除任何数据库或数据行。详见
`docs/operations/business-postgres.md`。

门禁读取的 live Compose 现在也包含 TX 业务运行时 `business-api`，因此它的必需输入同样要在
环境中提供（应用数据库凭据 `TX_BUSINESS_DB_*`、`TX_RABBITMQ_CONTROL_API_PASSWORD`、
MinIO `control_api` key pair、`KEYCLOAK_ADMIN_CLIENT_SECRET`、`AI_API_KEY`），缺失时门禁在
渲染阶段立即拒绝，而不是给出误导性的 ready。门禁本身仍只读：这些值只用于 Compose 渲染与
就绪判定，不写盘、不落日志。

门禁以只读 Keycloak Admin API 检查 `idp-qq`：必须唯一、`providerId=qq`、`enabled=true`、
client ID 非 placeholder，且 QQ endpoint/config contract 完整；裸 `qq` / `juhe-qq` alias 会阻断。
全部通过后输出 `QQ_IDP_STATUS=idp-qq=READY`；不再接受 `WAITING_EXTERNAL` 豁免。门禁不再探测
Yecao backend 路径：公开 API 流量已在 TX 内部终结（frontend nginx → `business-api:8087`），
改为两条只读 token：`tx-internal-api-route`（frontend upstream 必须是 TX 内部业务运行时、
`business-api` 不发布任何端口、任何服务都不得发布 8087）与 `distributed-execution-plane`
（`business-api` 必须同时是 `WOTB_REPLAY_EXECUTION_MODE=distributed` 与
`WOTB_REPLAY_PROCESSING_JOB_REPOSITORY=jdbc`）。任一不满足即 `PRE_CUTOVER_NOT_READY`。

TX deploy 在修改 runtime 前只检查 Docker/Compose、`wg0` 地址与到 `10.20.0.2` 的路由（后者仍服务
MinIO 与 broker 链路）；staging 阶段先 fail-closed 拒绝「引用/发布已退役 8087」或「重新启用本地
执行面」的 staged Compose，再进入 pull/promote，因此不会出现「已切到 TX 内部路由但仍依赖
Yecao backend」或反向的中间状态。
