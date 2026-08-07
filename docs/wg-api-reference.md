# Wargaming API — WoT Blitz 接口清单

> 数据来源：2026-08-07 使用本项目 `WG_APPLICATION_ID` 对线上 API 逐个探测验证（约 60 个候选接口）。
> 官方参考站（developers.wargaming.net）的方法清单需要登录才能查看，因此本清单为**实测存在性结果**。
> 本文件不提交到仓库，仅作参考。

## 1. `api.wotblitz.{asia|eu|com}` — Blitz 数据 API

### account/（玩家）

| 接口 | 说明 | 必填/常用参数 |
|---|---|---|
| `account/info/` | 玩家档案（昵称、战队、战绩） | `account_id` |
| `account/list/` | 按昵称搜索玩家 | `search` |
| `account/achievements/` | 玩家成就 | `account_id` |
| `account/tankstats/` | 玩家单车战绩 | `account_id` |

### clans/（战队）

| 接口 | 说明 | 必填/常用参数 |
|---|---|---|
| `clans/info/` | 战队详情 | `clan_id` |
| `clans/list/` | 搜索战队 | `search` |

### encyclopedia/（百科，只读）

| 接口 | 说明 | 备注 |
|---|---|---|
| `encyclopedia/vehicles/` | **车辆百科**（本项目数据源） | 血量在 `default_profile.hp`、炮弹在 `default_profile.shells`；支持 `tank_id` / `fields` / `language` |
| `encyclopedia/modules/` | 配件（suspensions / engines / guns / turrets…） | 返回按类型分组的字典 |
| `encyclopedia/provisions/` | 消耗品 | 按 `provision_id` 索引 |
| `encyclopedia/achievements/` | 成就定义 | 按 `achievement_id` 索引 |
| `encyclopedia/info/` | 百科字典（成就分类、车种、国家等） | 无必填参数 |

## 2. `api.worldoftanks.{asia|eu|com}` — Wargaming 统一认证（注意 host 不同）

| 接口 | 说明 |
|---|---|
| `wot/auth/login/` | 发起 OAuth 登录（需 `redirect_uri`） |
| `wot/auth/prolongate/` | 续期/校验 access_token（本项目登录用它取可信 `account_id`） |
| `wot/auth/logout/` | 注销 access_token |

> `api.wotblitz.*` 上**没有** `wotb/auth/*`（真实返回 METHOD_NOT_FOUND），认证必须走 `api.worldoftanks.*`。
> 本项目 `WargamingRegion` 正是因此把 auth host 与 account host 分开配置。

## 3. 实测不存在（探测返回 404）——避免踩坑

- `wotb/ratings/*`（accounts / dates / neighbors / tanks / top）——Blitz 无公开战绩榜 API
- `wotb/servers/info`、`wotb/stronghold/*`、`wotb/teams/info`、`wotb/globalmap/*`
- `wotb/wgn/*`（WGN 账号/战队信息不在 wotblitz 上）
- `wotb/account/medals`、`wotb/account/tanks`（WoT PC 才有）
- `wotb/encyclopedia/tanks`、`turrets`、`shells`、`crews`、`boosters`、`arenas`、`tank_engines`、`tank_radios`、`vehicle_profiles`、`vehicle_characteristics`、`personal_missions` 等——Blitz 百科是精简版，只有上表 5 个接口

## 4. 通用行为（实测）

- 响应头 `X-Api-Version`：API 网关版本（当前 `2.75.1`），**不是游戏版本**；JSON 响应体里没有任何版本字段
- `encyclopedia/vehicles` 忽略 `limit` / `offset`，单次返回全集（本项目已按此契约实现）
- `fields` 可裁剪字段，`language=zh-cn|en|...` 控制语言
- IP 白名单：`application_id` 绑定 IP（上限 10 个），未白名单返回 `407 INVALID_IP_ADDRESS`
- 错误码：`402` 参数缺失 / `404 METHOD_NOT_FOUND` / `407` 白名单或限流 / `504` 数据源不可用

## 附：本项目用到的接口

| 用途 | 接口 |
|---|---|
| 车辆库同步（WG 官方数据） | `wotb/encyclopedia/vehicles/` |
| WG 登录（Keycloak 自定义 IdP） | `wot/auth/login/` + `wot/auth/prolongate/` + `wot/auth/logout/` |
| 登录后账号资料校验 | `wotb/account/info/` |
