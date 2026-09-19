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
- QQ Connect application id/secret，以及 QQ provider 所需的回调配置。

TX workflow secrets：`TX_KC_POSTGRES_ADMIN_PASSWORD`、`TX_KC_DB_PASSWORD`、
`TX_KC_BOOTSTRAP_ADMIN_PASSWORD`、`WG_APPLICATION_ID`、`TENCENTCLOUD_SECRET_ID`、
`TENCENTCLOUD_SECRET_KEY`。非敏感固定值 `KC_POSTGRES_ADMIN_USER=kc_admin`、
`KC_DB_USERNAME=keycloak` 由 workflow 提供；`CADDY_ACME_EMAIL` 使用
`vars.CADDY_ACME_EMAIL`，为空时 fail-closed。

`wotbtools-admin-api` 是由 OpenTofu 创建的 confidential service-account client。它只获得
`realm-management` 的 `manage-users`、`query-users`、`view-realm`；secret 通过 write-only
runtime 变量注入，禁止写入 HCL、tfvars、plan 或普通 state attribute。backend 继续使用
`KEYCLOAK_ADMIN_CLIENT_ID=wotbtools-admin-api` 与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。

## Identity Provider 启动顺序

1. 让 OpenTofu 创建 fresh realm，确认 `wotbtools-web`、`wotbtools-admin-api`、角色与 JWT mapper 已存在。
2. 由 OpenTofu 创建 `wargaming-asia`、`wargaming-eu`、`wargaming-na` 三个实例，并只在 Keycloak runtime 注入 `WG_APPLICATION_ID`。
3. 同时构建三个 vendored provider：生产过渡期仍需要的 `keycloak-juhe-qq-provider`（真实 Juhe API 链路）、待官方 QQ Open Platform 审核的 `keycloak-qq-provider`（来源和本地安全修正见 [UPSTREAM.md](../../keycloak-qq-provider/UPSTREAM.md)），以及 `keycloak-wargaming-provider`。三者均固定以当前 Keycloak `26.6.4` 构建；禁止构建或运行时下载 provider。
4. OpenTofu 创建官方 QQ alias `idp-qq`（provider id `qq`）；TX 不创建 `juhe-qq` fallback，也不创建裸 alias `qq`。QQ Connect App ID/Secret 仅由 runtime secret 注入；alias 变更必须同步 Android exact callback allowlist 与回归测试。

## 导入后的验收

- Keycloak 使用 `start --optimized`，启动时没有 augmentation；
- image 同时包含 `keycloak-juhe-qq-provider.jar`、`keycloak-qq-provider.jar` 与 `keycloak-wargaming-provider.jar`；
- OpenTofu fresh realm 的 Admin API 验收通过，且二次 plan 为 no-op；
- OIDC discovery、三个 Wargaming 登录、前端 public client redirect URI 均可验证；
- QQ Connect 凭据缺失时 fail-closed，不通过猜测配置绕过。
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

`idp-qq=WAITING_EXTERNAL`（官方 QQ Open Platform 审核 pending）是允许状态，不阻断门禁；
TX 明确不配置 `juhe-qq` fallback，门禁输出 `juhe-qq=NOT_CONFIGURED_IN_TX` 仅用于说明该
旧 provider 不属于本 realm 的声明状态。门禁中的独立
`wireguard-backend` probe 必须从 TX `health-probe` 访问
`http://10.20.0.2:8087/api/health`，以区分 WG/backend 链路与 frontend/Caddy 路由故障。

TX deploy 在修改 runtime 前只检查 Docker/Compose、`wg0` 地址与到 `10.20.0.2` 的路由；
它不要求尚未发布的 Yecao backend `8087` 端口可达。`10.20.0.2:8087/api/health`
仅由 application deploy 与本只读门禁在 runtime 已部署后验证。
