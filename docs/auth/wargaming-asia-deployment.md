# Wargaming.net ASIA 登录 — 部署与手工配置（运维手册）

本文档对应 [wargaming-asia-login.md](wargaming-asia-login.md) 第十八节的"仍需在 Keycloak Admin Console 或生产环境手工完成的配置"。代码提交后，以下步骤仍需人工在开发/生产环境执行一次。

## 1. 准备 `WG_APPLICATION_ID`

Wargaming.net 按游戏注册 application_id，本项目使用 **WoT Blitz** 的 application id。application_id 按 Blitz 游戏注册、**跨区通用**（三个官方 Blitz host `api.wotblitz.asia` / `api.wotblitz.eu` / `api.wotblitz.com` 均返回统一 `application_id` 要求），所以所有区服实例共用同一个 `WG_APPLICATION_ID`。

- 获取：Wargaming.net Developer Portal → My Applications → 选择 WoT Blitz 应用 → Application ID。
- 注入：Keycloak 容器环境变量 `WG_APPLICATION_ID`。
  - 生产：GitHub Secrets `WG_APPLICATION_ID`（`deploy.yml` 已把 `${{ secrets.WG_APPLICATION_ID }}` 写入 keycloak service environment）。
  - 本地：`docker/online/.env` 设置 `WG_APPLICATION_ID=...`。
- 缺失行为（决策 D14）：Keycloak 正常启动；玩家点击 Wargaming 登录时 provider 返回"Wargaming login not configured"，不泄露其他信息。

## 2. 在 Keycloak Admin Console 创建 IdP

生产 realm 不使用 `--import-realm`，`wargaming-asia` IdP 不进 realm JSON（决策 D18），需要在 Admin Console 手工创建：

1. 进入 `auth.wotbtools.com/admin` → Realm `wotbtools` → Identity Providers → Add provider。
2. Provider type 选择 `Wargaming.net`（自定义 SPI，Provider ID `wargaming`，一个类型可建多个区服实例）。
3. 配置：
   - Alias：`wargaming-asia`
   - Display name：`Wargaming.net Asia`
   - Region：`ASIA`（下拉，默认 ASIA；EU/NA 实例选对应区服，host 自动走 `api.wotblitz.eu` / `api.wotblitz.com`）
   - Enabled：开
   - 重复登录刷新由 Provider 的 `updateBrokeredUser` 直接实现（决策 D11），与 Sync Mode 无关；首次登录 Flow / Post Login Flow 使用 realm 默认值即可
4. Save。

> 未来加欧服/美服：Admin Console 再建一个实例（如 alias `wargaming-eu`、Region 选 `EU`）即可，无需改代码。注意后端 `user_profile` 目前仅接受 `CN`/`ASIA`，EU/NA 登录的后端展示与约束扩展属于后续任务，上线 EU/NA 前必须同步扩展。

> QQ IdP（`juhe-qq`）与 `wotbtools-admin-api` client 若尚未配置，同样在 Admin Console 手工维护，本仓库 realm JSON 不声明任何带密钥的 IdP。

## 3. 核对 realm 默认角色

WG 首次登录自动获得 `wotbtools-user` 依赖 realm `defaultRoles`（决策 D10）：

- dev：realm JSON 已加 `"defaultRoles": ["wotbtools-user"]`，`--import-realm` 导入即生效。
- 生产：Admin Console → Realm Settings → General → Default Role 确认为 `wotbtools-user`；若不是，手工设为该角色。

## 4. 核对 JWT Protocol Mapper

生产 realm 若没有随 realm JSON 导入，需在 Admin Console 为 `wotbtools-web` client 手工添加 4 个 mapper（与 `docker/keycloak/wotbtools-realm.json` 一致）：

| Mapper 名 | User Attribute | Claim | JSON 类型 |
|---|---|---|---|
| wotb-region-mapper | `region` | `wotb_region` | String |
| wotb-account-id-mapper | `wotb.account_id` | `wotb_account_id` | String |
| wotb-nickname-mapper | `wotb.nickname` | `wotb_nickname` | String |
| wotb-verified-mapper | `wotb.verified` | `wotb_verified` | boolean |

`displayName` 的 display-name-mapper 已存在，保持不变。三个 token 开关（id/access/userinfo）均开启。

## 5. Caddy 访问日志脱敏（仓库外运维项，决策 D16）

- Keycloak 保持默认，不开启含请求 URI 的访问日志。
- host 级 Caddy 若记录访问日志，回调路径 `.../broker/wargaming-asia/endpoint?state=...&access_token=...` 的 Query String 需要脱敏或裁剪，避免 token 落盘。建议 Caddyfile 使用 `log` 的过滤器或关闭该路径的查询参数记录。
- 已知限制：WG 回调机制导致 token 会短暂出现在浏览器地址栏；服务端不落日志即可。

## 6. 上线后手工验收

1. 打开 `https://wotbtools.com/?view=profile`（未登录）→ 应显示前端登录选择页。
2. 点击"使用 Wargaming.net 登录" → 跳转 `api.wotblitz.asia` 官方页面 → 登录授权。
3. 回跳 Keycloak broker endpoint（state 校验通过）→ 进入 WotBTools 个人中心。
4. 个人中心显示：服务器 Asia、资料来源 Wargaming.net、账号已验证、官方昵称与 account_id；无编辑/解绑按钮。
5. 同一玩家再次登录 → 同一 Keycloak 用户（username=account_id）；在 WG 改名后再次登录，昵称属性自动刷新。
6. 中国大陆 QQ 登录路径不变，CN 手动绑定仍可用；存量用户 `region=CN` 已由迁移脚本补齐（138/138，2026-08-06）。
