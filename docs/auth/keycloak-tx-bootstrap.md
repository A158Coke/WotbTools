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
3. 使用 `keycloak-qq-provider` 构建 QQ provider。它是 `trashblazer/keycloak-social-provider-china` commit `45ffa0ec47f6dbdfc43c6c0b87856943256ff43c` 的 Apache-2.0 vendor，来源和本地安全修正见 [UPSTREAM.md](../../keycloak-qq-provider/UPSTREAM.md)。上游以 Keycloak 26.5.4 编译；本仓固定以 26.6.4 构建，必须先通过 `deploy/test-keycloak-runtime.sh` 的真实 image build + `start --optimized` smoke，不能把上游“26.x”说明当作兼容性证据。禁止构建或运行时下载 provider。
4. 在 Admin Console/API 创建 QQ IdP（provider id `qq`），将 QQ Connect App ID/Secret 仅保存在 runtime secret store。IdP alias 变更必须同步 Android exact callback allowlist 与回归测试。

## 导入后的验收

- Keycloak 使用 `start --optimized`，启动时没有 augmentation；
- image 包含 `keycloak-qq-provider.jar` 与 `keycloak-wargaming-provider.jar`，不得包含 Juhe provider；
- realm import 没有 credential-like key，IdP 配置留空；
- OIDC discovery、三个 Wargaming 登录、前端 public client redirect URI 均可验证；
- QQ Connect 凭据缺失时标记为 `BLOCKED_QQ_IDP_CREDENTIALS`，不通过猜测配置绕过。
