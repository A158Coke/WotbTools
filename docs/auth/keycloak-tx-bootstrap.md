# TX Keycloak 新 Realm 启动手册

适用范围：Phase 1 在 TX 创建全新的 `keycloak-postgres` 数据库与 `wotbtools` realm。旧 Yecao Keycloak 数据库不导入；本手册不授权删除任何旧身份或业务数据。

## Git 中可导入的静态配置

`docker/keycloak/wotbtools-realm.json` 只包含无密钥的 realm 基线：角色、`wotbtools-web` public client、redirect URI、protocol mapper、登录主题和空的 `identityProviders` 列表。该文件不得包含 client secret、IdP secret、密码、token，亦不得声明具体 IdP。

首次创建新数据库时，以 `start --optimized --import-realm` 导入该文件。导入只针对空 realm；既有 realm 的修改必须通过受控的 Admin API/console 步骤完成，不应靠重复 import 覆盖。

## 运行时配置与凭据边界

以下信息只在 TX 的受控运行时环境或 Secret store 中提供，禁止写进 Git、realm JSON、Tofu variables/state 或日志：

- `KC_BOOTSTRAP_ADMIN_PASSWORD`；
- `KEYCLOAK_ADMIN_CLIENT_SECRET`（`wotbtools-admin-api` 的 service account）；
- `WG_APPLICATION_ID`；
- QQ Connect application id/secret，以及 QQ provider 所需的回调配置。

`wotbtools-admin-api` 是机密 client：在导入后由受控 Admin API/console 创建，生成 secret 后直接写入运行时 secret store。不要把生成后的 realm export 提交回仓库。

## Identity Provider 启动顺序

1. 导入空 IdP 列表的 realm，确认 `wotbtools-web`、角色与 JWT mapper 已存在。
2. 以现有 [Wargaming 部署手册](wargaming-asia-deployment.md) 创建 `wargaming-asia`、`wargaming-eu`、`wargaming-na` 三个实例，并只在 Keycloak runtime 注入 `WG_APPLICATION_ID`。
3. 同时构建三个 vendored provider：生产过渡期仍需要的 `keycloak-juhe-qq-provider`（真实 Juhe API 链路）、待官方 QQ Open Platform 审核的 `keycloak-qq-provider`（来源和本地安全修正见 [UPSTREAM.md](../../keycloak-qq-provider/UPSTREAM.md)），以及 `keycloak-wargaming-provider`。三者均固定以当前 Keycloak `26.6.4` 构建；禁止构建或运行时下载 provider。
4. 在 Admin Console/API 创建 QQ IdP（provider id `qq`）时，生产 alias `juhe-qq` 继续绑定 `keycloak-juhe-qq-provider`，作为当前必需的 production fallback；新 TX 官方 QQ 预备 alias `idp-qq` 绑定 `keycloak-qq-provider`，其 QQ Open Platform App approval 仍 pending。两个 alias 的实现不同，不能互换。QQ Connect App ID/Secret 与 Juhe runtime credentials 仅保存在 runtime secret store；alias 变更必须同步 Android exact callback allowlist 与回归测试。

## 导入后的验收

- Keycloak 使用 `start --optimized`，启动时没有 augmentation；
- image 同时包含 `keycloak-juhe-qq-provider.jar`、`keycloak-qq-provider.jar` 与 `keycloak-wargaming-provider.jar`；
- realm import 没有 credential-like key，IdP 配置留空；
- OIDC discovery、三个 Wargaming 登录、前端 public client redirect URI 均可验证；
- QQ Connect 凭据缺失时标记为 `BLOCKED_QQ_IDP_CREDENTIALS`，不通过猜测配置绕过。
- Android 只接受两个 exact callback path：`juhe-qq` 回调保持 Juhe contract，`idp-qq` 回调使用官方 OAuth contract；不得以新 provider 存在为由删除 Juhe fallback。

## PRE_CUTOVER_READY 只读门禁

在申请 DNS cutover 前，在 TX runtime 上执行 `deploy/tx/pre-cutover-check.sh`。该入口只复用
`deploy/tx/deploy.sh` 的现有 health-probe/Compose 配置读取逻辑，不执行 staging、promote、
recreate、stop、删除或 DNS 操作。`WOTB_SOURCE_ROOT` 应指向包含 Yecao
`deploy/docker-compose.prod.yml` 与 realm baseline 的受控 checkout；缺少该路径时，门禁会拒绝
宣称 ready，而不是猜测 backend bind。

全部检查通过时输出：

```text
PRE_CUTOVER_READY
DNS_CUTOVER_NOT_PERFORMED
WAITING_FOR_OPERATOR_APPROVAL
```

`idp-qq=WAITING_EXTERNAL`（官方 QQ Open Platform 审核 pending）是允许状态，不阻断门禁；
`juhe-qq=PRODUCTION_REQUIRED` 仍是当前生产 fallback。门禁中的独立
`wireguard-backend` probe 必须从 TX `health-probe` 访问
`http://10.20.0.2:8087/api/health`，以区分 WG/backend 链路与 frontend/Caddy 路由故障。
