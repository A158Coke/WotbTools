# Wargaming.net ASIA / EU / NA 登录 — 部署与手工配置（运维手册）

本文档对应 [wargaming-asia-login.md](wargaming-asia-login.md) 第十八节的配置说明。TX realm 的 IdP、client、mapper、role 由 `infra/tofu/keycloak` 在 TX localhost 受控执行；本文保留运行时凭据、回调与人工登录验收说明。

## 1. 准备 `WG_APPLICATION_ID`

Wargaming.net 按游戏注册 application_id，本项目使用 **WoT Blitz** 的 application id。application_id 按 Blitz 游戏注册、**跨区通用**，所以 **ASIA / EU / NA 三个 IdP 实例共用同一个 `WG_APPLICATION_ID`**。

接口 Host 分两类（均由服务端 `WargamingRegion` 白名单决定，无需在 Admin Console 配置）：

- **认证接口**（login / prolongate / logout）：`api.worldoftanks.{asia|eu|com}/wot/auth/`（Wargaming.net ID 认证服务承载）；
- **WoT Blitz 账号资料接口**（account/info）：`api.wotblitz.{asia|eu|com}/wotb/account/`。

> 生产实测：`api.wotblitz.*` 不提供 `/wot/auth/*`（返回 `METHOD_NOT_FOUND`），认证与账号 Host 必须分离。

- 获取：Wargaming.net Developer Portal → My Applications → 选择 WoT Blitz 应用 → Application ID。
- 注入：**同一个 `WG_APPLICATION_ID` 同时服务两条路径**，不引入第二个 secret：
  - Keycloak 容器环境变量 `WG_APPLICATION_ID`（自定义 SPI 通过 `System.getenv("WG_APPLICATION_ID")` 读取，运行期登录用）；
  - TX-local OpenTofu 变量 `TF_VAR_wargaming_application_id`（ASIA/EU/NA 三个 IdP representation 的 `client_id` 事实源）。
  - 生产：GitHub Secrets `WG_APPLICATION_ID`（`deploy.yml` 既传给部署脚本写入 production compose，也注入 Keycloak OpenTofu apply step）。
  - 本地完整 Compose 入口已退役；本地 Keycloak 行为由独立 disposable smoke 覆盖，不要求真实 Wargaming application ID。
- 禁止把 application ID 写进 realm JSON、Git、前端、IdP alias 或浏览器参数。
- 缺失行为（决策 D14）：容器正常启动；玩家点击 Wargaming 登录时 provider 返回"Wargaming login not configured"；百场统一人工审核链路不受影响。

## 2. 验证 OpenTofu 创建的三个 IdP 实例

生产 realm 不使用 `--import-realm`，WG IdP 不进 realm JSON。**一个自定义 Provider 类型 `wargaming`，三个不同实例**（不同 alias、不同 Region、不同回调地址），由 OpenTofu 创建并共用同一个 `WG_APPLICATION_ID`。

步骤（对 ASIA / EU / NA 各执行一次）：

1. 在 fresh realm 的 OpenTofu apply 后，进入 `auth.wotbtools.com/admin` → Realm `wotbtools` → Identity Providers **只读核对**结果。
2. Provider type 应为 **`Wargaming.net`**（自定义 SPI，Provider ID `wargaming`）。资源由 Terraform 的 OIDC
   resource adapter 管理，因此 representation 中会同时出现自定义 SPI 字段与 OIDC schema 字段：
   **Client ID = 真实 `WG_APPLICATION_ID`**（与 Keycloak runtime env 同一个 GitHub secret，三个区服一致）；
   Client Secret / Authorization URL / Token URL 仍是满足 OIDC resource schema 的固定 adapter 值
   （`not-used` / `https://unused.invalid`），**不是**凭据，也不代表 provider 类型配置错误。
   真正的类型判断以 `provider_id=wargaming` custom SPI adapter 为准；不要把它替换成标准 OIDC provider，
   也不要在 Console 手工创建或保存 IdP。
3. 按下方表格核对 OpenTofu 已声明的 representation；发现漂移时回到 `infra/tofu/keycloak/identity-providers.tf` 修复并重新 apply。

| 配置项 | ASIA | EU | NA |
|---|---|---|---|
| Provider type | `Wargaming.net` | `Wargaming.net` | `Wargaming.net` |
| Alias | `wargaming-asia` | `wargaming-eu` | `wargaming-na` |
| Client ID | `WG_APPLICATION_ID` | `WG_APPLICATION_ID` | `WG_APPLICATION_ID` |
| Display name | `Wargaming.net Asia` | `Wargaming.net Europe` | `Wargaming.net North America` |
| Region | `ASIA` | `EU` | `NA` |
| Enabled | On | On | On |
| Sync mode | FORCE | FORCE | FORCE |
| First Login Flow | first broker login | first broker login | first broker login |
| Post Login Flow | 留空 | 留空 | 留空 |
| Store Tokens | Off | Off | Off |
| Link Only | Off | Off | Off |
| Trust Email | Off | Off | Off |
| 回调地址（自动） | `https://auth.wotbtools.com/realms/wotbtools/broker/wargaming-asia/endpoint` | `https://auth.wotbtools.com/realms/wotbtools/broker/wargaming-eu/endpoint` | `https://auth.wotbtools.com/realms/wotbtools/broker/wargaming-na/endpoint` |

说明：

- API host 由服务端 Region 白名单决定，无需在 Admin Console 填 URL：认证 ASIA→`api.worldoftanks.asia/wot/auth/`（EU/NA 同理）；账号 ASIA→`api.wotblitz.asia/wotb/account/`（EU/NA 同理）。
- **本次修复无需删除/重建 IdP**：三个 IdP 实例的 Alias 与 Region 配置由 OpenTofu 声明；部署时由 TX-local OpenTofu apply reconciliation，不能只重新构建 Keycloak 镜像来替代配置 apply。
- 三个 alias 决定各自的回调路径；前端未登录时直接跳转 Keycloak 登录页，由 Keycloak 按 IdP Display name 显示按钮（`Wargaming.net Asia` / `Europe` / `North America` + QQ），前端不再硬编码 alias。
- 重复登录刷新由 Provider 的 `updateBrokeredUser` 直接实现（决策 D11），与 Sync Mode 无关；Sync mode 仍按表格设 FORCE。
- **只使用一个 Keycloak Client：`wotbtools-web`**。不要创建 `wotbtools-asia` / `wotbtools-eu` / `wotbtools-na`。
- 自定义 Provider 的真实运行类型是 `provider_id=wargaming` custom SPI adapter。**Client ID 是真实凭据引用**
  （`var.wargaming_application_id` ← `secrets.WG_APPLICATION_ID`，三个区服共用同一个值，经敏感 TF_VAR 注入且
  不打印）；Client Secret / Authorization URL / Token URL 仍是 OIDC adapter 为满足 Terraform resource schema
  而写入的固定 placeholder fields，它们不表示标准 OIDC 配置错误。Wargaming 凭据只有 **一个来源**
  （GitHub Secrets `WG_APPLICATION_ID`），同时供 OpenTofu IdP representation 与 Keycloak runtime 注入使用。

> QQ IdP 与 `wotbtools-admin-api` client 同样是新 realm 的运行时配置；凭据不进入 realm JSON。QQ provider 的已批准源码、版本与配置前置条件见 [keycloak-tx-bootstrap.md](keycloak-tx-bootstrap.md)。

## 3. 核对 realm 默认角色

三个区服首次登录都必须获得 `wotbtools-user`，依赖 realm `defaultRoles`（决策 D10）；**不要为不同区服创建不同业务角色**：

- TX：OpenTofu `keycloak_default_roles` 已声明 `wotbtools-user`。
- 生产：若迁移既有 realm，Admin Console 只用于核对，不应绕过 OpenTofu 写入漂移配置。

## 4. 核对 JWT Protocol Mapper

OpenTofu 为 `wotbtools-web` 声明 5 个 mapper（ID/Access/UserInfo 三个 token 均启用）。**该步骤可重复执行**：apply 后可在 Admin Console 只读核对，实际变更必须回到 `infra/tofu/keycloak/protocol-mappers.tf`：

| Mapper 名 | User Attribute | Claim | JSON 类型 |
|---|---|---|---|
| wotb-region-mapper | `region` | `wotb_region` | String |
| wotb-account-id-mapper | `wotb.account_id` | `wotb_account_id` | String |
| wotb-nickname-mapper | `wotb.nickname` | `wotb_nickname` | String |
| wotb-verified-mapper | `wotb.verified` | `wotb_verified` | boolean |

`displayName` 的 display-name-mapper 已存在，保持不变。

核对要点：

- `wotb-verified-mapper` 的 **JSON 类型必须为 boolean**（若为 String，后端已兼容字符串 `"true"`，但应修正为 boolean）；
- 三个 token 开关（id.token.claim / access.token.claim / userinfo.token.claim）必须均为 On；
- 若生产 realm 缺失任意 mapper，后端将收不到 WG claims，WG 登录会退化为 CN 手动流程——这是 WG 登录后仍显示「设置游戏账号」的常见根因之一。

## 5. Caddy 访问日志脱敏（仓库外运维项，决策 D16）

- Keycloak 保持默认，不开启含请求 URI 的访问日志。
- host 级 Caddy 若记录访问日志，三个 WG 回调路径（`.../broker/wargaming-asia/endpoint`、`.../broker/wargaming-eu/endpoint`、`.../broker/wargaming-na/endpoint`，含 `?state=...&access_token=...`）的 Query String 需要脱敏或裁剪，避免 token 落盘。建议 Caddyfile 使用 `log` 的过滤器或关闭该路径的查询参数记录。
- 已知限制：WG 回调机制导致 token 会短暂出现在浏览器地址栏；服务端不落日志即可。

## 6. 上线后手工验收（三个区服各一遍）

1. 打开 `https://wotbtools.com/?view=profile`（未登录）→ 应自动跳转 Keycloak 登录页，页面列出 QQ + 三个 Wargaming IdP 按钮。
2. 点击对应区服 IdP 按钮 → 跳转该区服认证 host（ASIA→`api.worldoftanks.asia/wot/auth/`、EU→`api.worldoftanks.eu`、NA→`api.worldoftanks.com`）→ 登录授权。
3. 回跳 Keycloak broker endpoint（state 校验通过）→ 进入 WotBTools 个人中心。
4. 个人中心显示：对应服务器标签（Asia / Europe / North America）、资料来源 Wargaming.net、账号已验证、官方昵称与 account_id；无编辑/解绑按钮。
5. 同一玩家再次登录 → 同一 Keycloak 用户（username=`wg_{region}_{account_id}`，如 `wg_asia_512345678`）；在 WG 改名后再次登录，昵称属性自动刷新。
6. 安全验证：登录身份只来自 `prolongate` 服务端返回的 `account_id`（浏览器回调参数不可信）；攻击者无法用账号 A 的有效 token 篡改回调登录成账号 B。
7. 中国大陆 QQ 登录路径不变，CN 手动绑定仍可用；存量用户 `region=CN` 已由迁移脚本补齐（138/138，2026-08-06）。

## 7. 凭据接线变更后的生产收敛路径

IdP representation 的 `client_id` 由占位值 `not-used` 收敛为真实 `WG_APPLICATION_ID` 后，**不要手工改 Admin Console**；用既有 CI/CD 路径收敛：

```
Release（main push 自动）或单目标手动入口
  Deploy workflow, service=keycloak（或 Release 的 deploy_keycloak lane）
    -> 依赖 keycloak-postgres root 已成功（Bootstrap TX Keycloak PostgreSQL）
    -> 启动空 Keycloak runtime
  Tofu Apply workflow, root=keycloak（或 Release 的 tofu_keycloak lane，needs deploy_keycloak）
    -> deploy/tx/keycloak-tofu.sh：plan 安全门 + 二次 plan 无漂移门
    -> 收敛 QQ + 三个 Wargaming IdP（in-place update，alias/realm 未变，不 destroy/recreate）
```

- 手动收敛时依次 dispatch `Deploy`（`service=keycloak`）与 `Infra / Tofu Apply`（`root=keycloak`），两者都只接受当前 main 完整 SHA；不再有 `target=tx` / `tx_services` 选择器。

- 不删除/重建 realm，也不删除/重建 IdP；`infra/tofu/keycloak/validate-plan.sh` 对 `keycloak_oidc_identity_provider.*` 的 delete/replace 一律 fail-closed。
- `WG_APPLICATION_ID` 的 runtime 注入（Keycloak 容器 env）在 apply 之后的精确 runtime 部署步骤中继续生效，无需额外操作。
- 收敛后按第 2 节表格只读核对三个 IdP 的 Client ID 是否等于生产 `WG_APPLICATION_ID`（值不落文档、不落日志）。
