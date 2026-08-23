# Wargaming.net ASIA / EU / NA 登录 — 部署与手工配置（运维手册）

本文档对应 [wargaming-asia-login.md](wargaming-asia-login.md) 第十八节的"仍需在 Keycloak Admin Console 或生产环境手工完成的配置"。代码提交后，以下步骤仍需人工在开发/生产环境执行一次。

## 1. 准备 `WG_APPLICATION_ID`

Wargaming.net 按游戏注册 application_id，本项目使用 **WoT Blitz** 的 application id。application_id 按 Blitz 游戏注册、**跨区通用**，所以 **ASIA / EU / NA 三个 IdP 实例共用同一个 `WG_APPLICATION_ID`**。

接口 Host 分两类（均由服务端 `WargamingRegion` 白名单决定，无需在 Admin Console 配置）：

- **认证接口**（login / prolongate / logout）：`api.worldoftanks.{asia|eu|com}/wot/auth/`（Wargaming.net ID 认证服务承载）；
- **WoT Blitz 账号资料接口**（account/info）：`api.wotblitz.{asia|eu|com}/wotb/account/`。

> 生产实测：`api.wotblitz.*` 不提供 `/wot/auth/*`（返回 `METHOD_NOT_FOUND`），认证与账号 Host 必须分离。

- 获取：Wargaming.net Developer Portal → My Applications → 选择 WoT Blitz 应用 → Application ID。
- 注入：Keycloak 与 backend 容器环境变量 `WG_APPLICATION_ID`（同一个值，只维护一个 secret）。Keycloak 用于 WG 登录，backend 用于百场 WG 官方自动认证。
  - 生产：GitHub Secrets `WG_APPLICATION_ID`（`deploy.yml` 传给部署脚本，production compose 同时写入 keycloak 与 backend service environment）。
  - 本地：`docker/online/.env` 设置 `WG_APPLICATION_ID=...`。
- 禁止把 application ID 写进 realm JSON、Git、前端、IdP alias 或浏览器参数。
- 缺失行为（决策 D14）：容器正常启动；玩家点击 Wargaming 登录时 provider 返回"Wargaming login not configured"，百场 WG 自动认证返回稳定不可用错误；原人工审核链路不受影响。

## 2. 在 Keycloak Admin Console 创建三个 IdP 实例

生产 realm 不使用 `--import-realm`，WG IdP 不进 realm JSON（决策 D18）。**一个自定义 Provider 类型 `wargaming`，三个不同实例**（不同 alias、不同 Region、不同回调地址），共用同一个 `WG_APPLICATION_ID`。

步骤（对 ASIA / EU / NA 各执行一次）：

1. 进入 `auth.wotbtools.com/admin` → Realm `wotbtools` → Identity Providers → Add provider。
2. Provider type 选择 **`Wargaming.net`**（自定义 SPI，Provider ID `wargaming`）。
   > ⚠️ 如果配置界面出现 Client ID / Client Secret / Authorization URL / Token URL 字段，说明选成了标准 OIDC Provider，而不是本项目的自定义 Wargaming.net Provider。
3. 按下方表格填写并 Save。

| 配置项 | ASIA | EU | NA |
|---|---|---|---|
| Provider type | `Wargaming.net` | `Wargaming.net` | `Wargaming.net` |
| Alias | `wargaming-asia` | `wargaming-eu` | `wargaming-na` |
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
- **本次修复无需删除/重建 IdP**：三个 IdP 实例的 Alias 与 Region 配置保持不变，部署时只重新构建并发布 Keycloak 镜像即可。
- 三个 alias 决定各自的回调路径；前端未登录时直接跳转 Keycloak 登录页，由 Keycloak 按 IdP Display name 显示按钮（`Wargaming.net Asia` / `Europe` / `North America` + QQ），前端不再硬编码 alias。
- 重复登录刷新由 Provider 的 `updateBrokeredUser` 直接实现（决策 D11），与 Sync Mode 无关；Sync mode 仍按表格设 FORCE。
- **只使用一个 Keycloak Client：`wotbtools-web`**。不要创建 `wotbtools-asia` / `wotbtools-eu` / `wotbtools-na`。
- 自定义 Provider **不使用** Client ID / Client Secret / Authorization URL / Token URL；出现这些字段即配置错了类型。

> QQ IdP（`juhe-qq`）与 `wotbtools-admin-api` client 若尚未配置，同样在 Admin Console 手工维护，本仓库 realm JSON 不声明任何带密钥的 IdP。

## 3. 核对 realm 默认角色

三个区服首次登录都必须获得 `wotbtools-user`，依赖 realm `defaultRoles`（决策 D10）；**不要为不同区服创建不同业务角色**：

- dev：realm JSON 已加 `"defaultRoles": ["wotbtools-user"]`，`--import-realm` 导入即生效。
- 生产：Admin Console → Realm Settings → General → Default Role 确认为 `wotbtools-user`；若不是，手工设为该角色。

## 4. 核对 JWT Protocol Mapper

生产 realm 若没有随 realm JSON 导入（生产使用 Admin Console 手工配置、不使用 `--import-realm`），需在 Admin Console 为 `wotbtools-web` client 核对/添加 4 个 mapper（与 `docker/keycloak/wotbtools-realm.json` 一致，ID/Access/UserInfo 三个 token 均启用）。**该步骤可重复执行**：realm JSON 只对全新 realm 生效，已有生产 realm 不会自动获得 mapper，每次核对以本表为准：

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
