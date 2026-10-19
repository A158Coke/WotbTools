# Wargaming.net ASIA / EU / NA 登录 — 部署与手工配置（运维手册）

本文档是 Wargaming.net（ASIA / EU / NA）登录的当前运维手册：TX realm 的 IdP、client、mapper、role 由 `infra/tofu/keycloak` 在 TX localhost 受控执行；本文保留运行时凭据、回调、身份/安全契约与人工登录验收说明。业务 Profile 契约见 [`../features/user-profile.md`](../features/user-profile.md)，后端同步规则见 [`../../java/README.md`](../../java/README.md)「用户资料」。

## 0. 当前登录身份与安全契约

WG 登录由 Keycloak 自定义 broker provider 完成。信任链固定为：

```text
Keycloak state / session
  -> WG auth login（Region 白名单 host）
  -> 浏览器回调：account_id / nickname / expires_at 均不可信
  -> POST wot/auth/prolongate（服务端验证 token）
       -> trusted account_id = token owner
  -> GET wotb/account/info（用刷新后的 token 取官方昵称）
  -> 稳定身份 wg:{region}:{account_id}
  -> 写 region / displayName / wotb.* 属性
  -> 立即 logout（best effort，使用 prolongate 刷新后的 token）
```

- **唯一可信身份来源**：`prolongate` 返回的 `account_id`。浏览器回调的 `account_id` / `nickname` 只做一致性检查，`expires_at` 不参与判断；`account_id` 与可信值不一致、或 `nickname` 与官方昵称不一致时拒绝登录；`account/info` 只提供官方昵称，不能单独证明 token 归属。
- **稳定身份**：broker id `wg:{region}:{account_id}`；Keycloak username `wg_{region}_{account_id}`；`wotb.account_id` 只存纯数字字符串；`(region, account_id)` 唯一。重复登录刷新 `displayName` / `wotb.nickname`，不改稳定身份。
- **安全边界**：只用 HTTPS；API Host 只来自固定 Region 白名单；state 缺失/无效/过期/篡改一律拒绝；WG token 用完立即 logout，不写入数据库、用户属性、JWT、日志、指标或 Trace；前端不接触 WG token，也不采集 WG 用户名/密码/账号 ID；WG 错误只做安全映射，不回传原始正文；日志只记录 region、stage、reason、安全数字 code、固定 allowlist 分类和有界脱敏 detail。
- **超时与已知限制**：WG 请求连接超时约 5 秒、总请求约 10 秒，不无限重试；WG 回调机制会让 token 短暂出现在浏览器地址栏，服务端不落日志，Caddy 侧脱敏见 §5。
- **账号语义**：WG 登录创建独立账号，不按昵称/邮箱自动合并到 QQ 账号；当前不提供 QQ→WG 关联；WG Profile（ASIA/EU/NA）只读，不提供站内解绑/删除；CN 手动绑定只允许 `CN`。
- **配置 ownership**：IdP、protocol mapper、default role 由 `infra/tofu/keycloak` 声明；Provider 运行期只读 `WG_APPLICATION_ID`；JWT claims 映射见 §4；业务 Profile 同步见 [`../features/user-profile.md`](../features/user-profile.md) 与 [`../../java/README.md`](../../java/README.md)。

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
  - 生产：GitHub Secrets `WG_APPLICATION_ID`（`.github/workflows/keycloak.yml` 传给部署脚本和同一 locked Keycloak OpenTofu apply phase）。
  - 本地完整 Compose 入口已退役；本地 Keycloak 行为由独立 disposable smoke 覆盖，不要求真实 Wargaming application ID。
- 禁止把 application ID 写进 realm JSON、Git、前端、IdP alias 或浏览器参数。
- 缺失行为：容器正常启动；玩家点击 Wargaming 登录时 provider 返回"Wargaming login not configured"；百场统一人工审核链路不受影响。

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
- **不需要删除/重建 IdP**：三个 IdP 实例的 Alias 与 Region 配置由 OpenTofu 声明；部署时由 TX-local OpenTofu apply reconciliation，不能只重新构建 Keycloak 镜像来替代配置 apply。
- 三个 alias 决定各自的回调路径；前端未登录时直接跳转 Keycloak 登录页，由 Keycloak 按 IdP Display name 显示按钮（`Wargaming.net Asia` / `Europe` / `North America` + QQ），前端不再硬编码 alias。
- 重复登录刷新由 Provider 的 `updateBrokeredUser` 直接实现，与 Sync Mode 无关；Sync mode 仍按表格设 FORCE。
- **只使用一个 Keycloak Client：`wotbtools-web`**。不要创建 `wotbtools-asia` / `wotbtools-eu` / `wotbtools-na`。
- 自定义 Provider 的真实运行类型是 `provider_id=wargaming` custom SPI adapter。**Client ID 是真实凭据引用**
  （`var.wargaming_application_id` ← `secrets.WG_APPLICATION_ID`，三个区服共用同一个值，经敏感 TF_VAR 注入且
  不打印）；Client Secret / Authorization URL / Token URL 仍是 OIDC adapter 为满足 Terraform resource schema
  而写入的固定 placeholder fields，它们不表示标准 OIDC 配置错误。Wargaming 凭据只有 **一个来源**
  （GitHub Secrets `WG_APPLICATION_ID`），同时供 OpenTofu IdP representation 与 Keycloak runtime 注入使用。

> QQ IdP 与 `wotbtools-admin-api` client 同样是新 realm 的运行时配置；凭据不进入 realm JSON。QQ provider 的已批准源码、版本与配置前置条件见 [keycloak-tx-bootstrap.md](keycloak-tx-bootstrap.md)。

## 3. 核对 realm 默认角色

三个区服首次登录都必须获得 `wotbtools-user`，依赖 realm `defaultRoles`；**不要为不同区服创建不同业务角色**：

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

## 5. Caddy 访问日志脱敏（仓库内强制执行）

- Keycloak 保持默认，不开启含请求 URI 的访问日志。
- `deploy/tx/Caddyfile` 对认证域访问日志统一处理：始终记录访问日志，但在写 stdout 前删除原始 URI（含 query string）、请求头与响应头，再用 `log_append` 只写回 path 与 User-Agent；`compliance="security"` 标签使其进入 190 天安全日志留存。该过滤不是 host 级可选运维项，新增/修改网关必须保持并由 Caddy config/route inventory 回归验证。
- 已知限制（WG API 错误）：Keycloak provider 的 `WargamingApiClient` 会把上游 `error.message` / `error.field` 拼进异常，`WargamingEndpoint` 的 `safeMessage` 只清控制字符并截断；因此“日志不含 token”只覆盖浏览器回调与固定分类，不覆盖上游 API 错误正文。字段级 allowlist 尚未实现。
- 已知限制：WG 回调机制导致 token 会短暂出现在浏览器地址栏；服务端与仓库 Caddy 日志不落 token。

## 6. 上线后手工验收（三个区服各一遍）

1. 打开 `https://wotbtools.com/?view=profile`（未登录）→ 应自动跳转 Keycloak 登录页，页面列出 QQ + 三个 Wargaming IdP 按钮。
2. 点击对应区服 IdP 按钮 → 跳转该区服认证 host（ASIA→`api.worldoftanks.asia/wot/auth/`、EU→`api.worldoftanks.eu`、NA→`api.worldoftanks.com`）→ 登录授权。
3. 回跳 Keycloak broker endpoint（state 校验通过）→ 进入 WotBTools 个人中心。
4. 个人中心显示：对应服务器标签（Asia / Europe / North America）、资料来源 Wargaming.net、账号已验证、官方昵称与 account_id；无编辑/解绑按钮。
5. 同一玩家再次登录 → 同一 Keycloak 用户（username=`wg_{region}_{account_id}`，如 `wg_asia_512345678`）；在 WG 改名后再次登录，昵称属性自动刷新。
6. 安全验证：登录身份只来自 `prolongate` 服务端返回的 `account_id`（浏览器回调参数不可信）；攻击者无法用账号 A 的有效 token 篡改回调登录成账号 B。
7. 中国大陆 QQ 登录路径不变，CN 手动绑定仍可用。

## 7. 凭据接线变更后的生产收敛路径

IdP representation 的 `client_id` 由占位值 `not-used` 收敛为真实 `WG_APPLICATION_ID` 后，**不要手工改 Admin Console**；用既有 CI/CD 路径收敛：

```
`.github/workflows/keycloak.yml`（main 路径触发或单目标手动 dispatch）
  -> Build immutable Keycloak image and run disposable provider/runtime smoke
  -> 在 TX host lock 内检查 PostgreSQL、bootstrap/reconcile Keycloak runtime
  -> `infra/tofu/keycloak`：plan safety gate + exact apply + clean second-plan gate
  -> 核对 OIDC / providers / IdP 配置，成功后更新 Keycloak image metadata
```

手动收敛只需 dispatch `Keycloak` workflow，且只接受当前 main 完整 SHA；PostgreSQL runtime 与独立 root 仍由 `keycloak-postgres.yml` 所有，不再有第二个 Deploy/Tofu dispatch。

- 不删除/重建 realm，也不删除/重建 IdP；`infra/tofu/keycloak/validate-plan.sh` 对 `keycloak_oidc_identity_provider.*` 的 delete/replace 一律 fail-closed。
- `WG_APPLICATION_ID` 的 runtime 注入（Keycloak 容器 env）在 apply 之后的精确 runtime 部署步骤中继续生效，无需额外操作。
- 收敛后按第 2 节表格只读核对三个 IdP 的 Client ID 是否等于生产 `WG_APPLICATION_ID`（值不落文档、不落日志）。
