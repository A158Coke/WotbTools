# Keycloak Protocol Mapper 与 Client Scope 完全指南

> 本文用 WotBTools 的 Wargaming 登录真实例子，讲透「用户属性 → JWT Claim → 前端/后端消费」的完整机制，以及 Client 级 mapper 与 Client Scope 级 mapper 的区别、生产 realm 手工补 mapper 的标准做法。适合在「JWT 里为什么没有某个字段 / 登录后业务没生效 / 要不要用 client scope」时查阅。

## 1. 三个核心概念

| 概念 | 在哪 | 谁能看到 | 例子 |
|---|---|---|---|
| **User Attribute**（用户属性） | 存在 Keycloak 用户档案上 | 只有 Keycloak 内部知道 | `region = EU`、`wotb.account_id = 572253806` |
| **Claim**（声明） | 写进 JWT 里 | 拿到 token 的人都能读（前端 `tokenParsed`、后端） | `"wotb_region": "EU"` |
| **Protocol Mapper** | 挂在 client 或 client scope 上的「翻译规则」 | 只影响 token 生成 | 把 `region` 属性翻译成 `wotb_region` claim |

**关键：用户属性不会自动出现在 JWT 里。** Keycloak 签发 token 时逐个执行该 client 关联的 protocol mappers，把属性翻译成 claims。没有 mapper = 属性存在但 JWT 里看不到 = 前端和后端都读不到。

## 2. 完整链路（WG 登录示例）

```text
WG 登录成功
  → Provider 写入用户属性（region / wotb.account_id / wotb.nickname / wotb.verified / displayName）
  → Keycloak 用户档案
  → 用户申请 token
  → Keycloak 遍历 client 的 protocol mappers
      region           → wotb_region
      wotb.account_id  → wotb_account_id
      wotb.nickname    → wotb_nickname
      wotb.verified    → wotb_verified
  → JWT claims
  → 前端 isWargamingLogin 判断 / 后端创建或同步 WARGAMING Profile
```

2026-08-06 生产故障就是链路中断：用户属性已正确写入（`region=EU`、`wotb.*` 齐全），但生产 `wotbtools-web` client 没有任何 mapper → JWT 无 claims → 后端把 WG 用户当 CN → 创建空 CN/MANUAL Profile → 个人中心显示「尚未绑定 + 设置游戏账号」。

## 3. 一个 Mapper 的字段含义

仓库 [wotbtools-realm.json](../../docker/keycloak/wotbtools-realm.json) 中的真实例子：

```json
{
  "name": "wotb-region-mapper",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "region",
    "claim.name": "wotb_region",
    "claim.value": "attribute_value",
    "jsonType.label": "String",
    "id.token.claim": true,
    "access.token.claim": true,
    "userinfo.token.claim": true
  }
}
```

| 字段 | 含义 |
|---|---|
| `protocolMapper` | 映射器类型。`oidc-usermodel-attribute-mapper` = 用户属性 → JWT claim；另有角色/组成员/硬编码值等类型 |
| `user.attribute` | **读**哪个用户属性（来源） |
| `claim.name` | **写**成哪个 claim 名（目标） |
| `claim.value` | `attribute_value` = 原样写属性值；也可写固定值 |
| `jsonType.label` | JWT 中值的类型：`String` / `boolean` / `int` 等。`wotb_verified` 必须 boolean，后端才能按 `true` 判断 |
| `id.token.claim` / `access.token.claim` / `userinfo.token.claim` | 三个开关，决定 claim 进 ID Token / Access Token / UserInfo。后端资源服务器校验 **Access Token**，`access.token.claim` 必须为 true |

## 4. Client 级 mapper vs Client Scope 级 mapper

区别只有一句：**mapper 挂在哪，决定哪些 client 的 token 会带这些 claims**。

```text
Client 级：
  wotbtools-web ──┬── mapper: region → wotb_region
                  └── mapper: wotb.account_id → wotb_account_id
  → 只有 wotbtools-web 的 token 有这些 claims

Client Scope 级：
  wotb-claims (Client Scope) ──┬── mapper: region → wotb_region
                               └── mapper: wotb.account_id → wotb_account_id

  wotbtools-web ──关联──> wotb-claims   （默认 scope：自动应用）
  admin-client  ──关联──> wotb-claims   （可选 scope：手动勾选）
  → 所有关联了 wotb-claims 的 client 都带这些 claims
```

| | Client 级 mapper | Client Scope 级 mapper |
|---|---|---|
| 作用范围 | 只有这一个 client | 所有关联该 scope 的 client |
| 配置位置 | Client → Mappers | Client Scopes → 某 scope → Mappers |
| 复用性 | 差（每个 client 各配一份） | 好（一份配置多处引用） |
| 适合场景 | 只有 1 个 client，或某 client 独有 claims | 多个 client 需要同一组 claims |
| 冲突 | 不冲突 | 若 client 同时挂 scope 与同名 mapper，claim 会互相覆盖 |

**WotBTools 现状**：目前只有 `wotbtools-web` 一个前端 client 需要 WG claims，直接挂在 client 上（realm JSON 与生产均如此）。

**何时迁到 Client Scope**：以后加管理端、移动端等也要 `wotb_*` claims 时，把 4 个 mapper 挪进一个 `wotb-claims` client scope，让各 client 关联它；默认 scope 可做到自动应用。

> 注：Keycloak 自带默认 scopes（`profile` / `email` / `roles`…），你常见的 `preferred_username`、`realm_access.roles` 就来自它们——这也是为什么没配 mapper 也能看到这些 claim。

## 5. 生产 realm 手工补 mapper（标准做法）

realm JSON 只对**新建/导入 realm** 生效；已有生产 realm 不会自动获得 mapper。用 kcadm 补齐（与仓库 realm JSON 保持一致）：

```bash
# 1. 进入 Keycloak 容器并认证（凭据取容器环境变量，勿打印）
docker exec wotb-keycloak-1 /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"

# 2. 取 client 内部 uuid
CID=$(docker exec wotb-keycloak-1 /opt/keycloak/bin/kcadm.sh get clients -r wotbtools \
  -q clientId=wotbtools-web --fields id | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')

# 3. 逐个创建 mapper（示例：region → wotb_region）
docker exec wotb-keycloak-1 /opt/keycloak/bin/kcadm.sh create \
  "clients/$CID/protocol-mappers/models" -r wotbtools -b '{
    "name": "wotb-region-mapper",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-usermodel-attribute-mapper",
    "config": {
      "user.attribute": "region",
      "claim.name": "wotb_region",
      "claim.value": "attribute_value",
      "jsonType.label": "String",
      "id.token.claim": "true",
      "access.token.claim": "true",
      "userinfo.token.claim": "true"
    }
  }'

# 4. 验证
docker exec wotb-keycloak-1 /opt/keycloak/bin/kcadm.sh get \
  "clients/$CID/protocol-mappers/models" -r wotbtools
```

WotBTools 需要的 5 个 mapper（名称 / 属性 → claim / 类型）：

| Mapper 名 | user.attribute | claim.name | jsonType |
|---|---|---|---|
| display-name-mapper | `displayName` | `displayName` | String |
| wotb-region-mapper | `region` | `wotb_region` | String |
| wotb-account-id-mapper | `wotb.account_id` | `wotb_account_id` | String |
| wotb-nickname-mapper | `wotb.nickname` | `wotb_nickname` | String |
| wotb-verified-mapper | `wotb.verified` | `wotb_verified` | **boolean** |

> mapper 是 client 配置，**无需重启**；但已签发的旧 token 不含新 claims，用户需**重新登录**。

## 6. 自查与验证

- **看某个 client 最终会发哪些 claims**：Admin Console → Clients → `wotbtools-web` → **Client scopes** 页签。该页会把「client 直接挂的 mapper」和「关联 scope 的 mapper」合并展示。
- **看 token 实际内容**：前端 `tokenParsed`，或 F12 → 任一 API 请求的 `Authorization: Bearer xxx`，把 payload 段 base64 解码。
- **后端**：`JwtUtil.currentWotbRegion()` 读不到 = mapper 未生效或用户属性未写入。先查用户属性（Admin Console → Users → 该用户 → Attributes，或 kcadm `get users`），再查 mapper。
- **典型症状 → 根因对照**：
  - JWT 无 `wotb_*`、后端当 CN、个人中心显示「设置游戏账号」→ 缺 mapper（或用户属性未写入）。
  - 用户属性有值但 JWT 无 claim → mapper 缺失/未启用（`access.token.claim` 为 false）。
  - 有 claim 但 `wotb_verified` 是字符串 `"true"` 而非布尔 → mapper `jsonType.label` 不是 boolean（后端已兼容字符串，但应修正为 boolean）。
