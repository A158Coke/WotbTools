# WotBTools 接入 Wargaming.net 亚服登录 —— 最终需求（v2）

> 本文档是 v1 需求评审后的**定稿版**：所有此前"不明确 / 待定"的点均已拍板，实现方按本文执行，不再做产品决策。

## 0. 已拍板决策记录

| # | 原不确定点 | 最终决定 |
|---|---|---|
| D1 | 认证 API 域名 | 使用 WoT **Blitz** 认证接口：`https://api.wotblitz.asia/wot/auth/`（不是 `api.worldoftanks.asia`，那是 WoT PC）。Application ID 按 Blitz 游戏注册 |
| D2 | 用户名方案 | WG 用户 Keycloak `username` = `account_id`（纯数字，稳定、不随改名变化）；broker 身份仍为 `wg:asia:{account_id}`；QQ 用户 username 维持现有 nickname-hash 方案 |
| D3 | region 统一 | Keycloak 用户属性统一为 `region`，值统一大写 `CN` / `ASIA`；存量用户通过一次性迁移脚本补 `region=CN`；QQ Provider 对新用户也写 `region=CN`；已有值一律不覆盖 |
| D4 | displayName | 沿用现有模式：user attribute `displayName`（QQ 已在写，realm 已有 mapper）；WG Provider 照写；存量缺 displayName 的用户如需回填，作为独立迁移另行执行（本期 region 迁移未包含） |
| D5 | token↔account 绑定 | WG 官方**没有**证明 token 归属的接口。验收以可实现方案为准：state/会话校验 + HTTPS 回调 + prolongate 验证 token 有效性 + `account/info` 核对官方昵称 + 立即 logout。删除"证明 token 属于该 account_id"的不可实现表述 |
| D6 | QQ→WG 绑定（AIA） | **本期不做**，记录为后续任务。登录页文案不得承诺"先 QQ 登录再绑定"；WG 登录创建独立账号 |
| D7 | WG 用户解绑 | 本期不允许：WG profile 的 server / account_id / source / verified 不可编辑，也不提供解绑/删除入口（后端拒绝 PATCH/DELETE on ASIA profile） |
| D8 | `wotb_account_verified_at` | 定义为"后端首次可信同步时间"：首次创建 ASIA profile 时写 now，后续昵称刷新不更新。不新增 Keycloak claim |
| D9 | 登录入口 | 新增极简前端登录选择页（中国大陆 QQ / 亚服 Wargaming 两个按钮 + 提示语，zh/en/ru 三语）；Keycloak 托管登录页留作兜底；不改 Keycloak 主题 |
| D10 | 角色授予 | realm JSON 增加 `defaultRoles: ["wotbtools-user"]`；生产先核对现有 default role 是否已是 `wotbtools-user`（是则无需操作）。Provider 不写授角色代码 |
| D11 | 重复登录属性刷新 | WG 改名后再次登录，Provider 必须显式更新 `displayName` / `wotb.nickname`（QQ Provider 无此逻辑，不可照抄） |
| D12 | 冲突可见性 | 不做自定义 Keycloak 错误页。broker 层默认拦截；后端 `from-login` 冲突检查作兜底，返回 `WOTB_ACCOUNT_ALREADY_USED` |
| D13 | Provider 测试基建 | JUnit 5 + JDK 内置 `HttpServer` 做 WG API stub，不引入 Keycloak Testcontainers |
| D14 | `WG_APPLICATION_ID` 读取 | Keycloak 容器 env 注入；Provider 在配置层 `System.getenv("WG_APPLICATION_ID")` 读取，缺失时登录报错（不导致启动失败）；不硬编码进源码 / Realm JSON / 前端 |
| D15 | `wotb_verified` claim 类型 | Protocol Mapper 配置 `jsonType=boolean`，JWT 输出真布尔；后端按 `Boolean` 解析；region / verified 缺失一律按 CN 兜底 |
| D16 | 日志脱敏 | Keycloak 保持默认（不开启请求 URI 访问日志）；host 级 Caddy 访问日志脱敏为仓库外运维项，写入部署文档；已知限制：WG token 会短暂出现在浏览器地址栏（WG 回调机制固有） |
| D17 | 存量 region 迁移 | 使用 `deploy/keycloak-add-region-attribute.py`：dry-run 默认、`--apply` 才写、只补缺失值、幂等 |
| D18 | IdP 配置载体 | 跟随 QQ 现状：`wargaming-asia` IdP 不进 realm JSON（避免硬编码密钥），dev/prod 均在 Admin Console 手工配置，步骤写进交付文档 |

---

## 一、任务目标

基于当前仓库真实代码，实现 Wargaming.net ASIA 登录的完整业务闭环：

```text
中国大陆玩家：QQ 登录 + 手动填写国服游戏资料
亚服玩家：Wargaming.net 登录 + 自动验证并填写亚服游戏资料
```

不要删除、替换或破坏现有 QQ 登录与国服手动绑定功能。

不要只输出设计或计划。先检查实际代码并简要说明发现，然后直接实现、测试并提交完整改动。

---

## 二、开始开发前必须检查

先检查当前分支的真实实现，包括但不限于：

- `keycloak-juhe-qq-provider`（Keycloak 26.6.4，Java 21）
- `docker/Dockerfile.keycloak`（构建两个 Provider 的镜像）
- `docker/keycloak/wotbtools-realm.json`（当前只有 roles + `wotbtools-web` client + display-name mapper；**没有** identityProviders）
- Keycloak 生产部署配置（生产 realm 为 Admin Console 手工配置，不使用 `--import-realm`）
- `frontend/src/composables/useAuth.js`（当前无 WG 相关代码）
- 登录页与个人资料页（当前**没有**前端登录页，`ProfilePage` 未登录时直接跳 Keycloak）
- `UserProfileController` / `UserProfileService` / `UserProfile` Entity、Repository、DTO（`create()` 当前硬编码 `wotbServer=CN`）
- `JwtUtil`（读 `sub` / `preferred_username` / `displayName`）
- `V5__create_user_profile.sql` 及后续 migration（当前最高 V11；`CHECK (wotb_server IN ('CN'))`）
- Spring Security JWT 配置（`SecurityConfig`，role 来自 `realm_access.roles`）
- GitHub Actions 与部署路径检测（`deploy.yml`）
- `.env.example`、`docker/online/docker-compose.yml`、生产 Compose（由 `deploy.yml` 内联生成）
- `deploy/keycloak-add-region-attribute.py`（存量 region 迁移脚本，已存在并验证）

开始修改前，先简要说明：

1. 当前 Keycloak 用户和 `user_profile` 的关联方式（JWT `sub` → `user_profile.keycloak_user_id`）；
2. 当前 Profile 的创建时机（懒创建：访问个人资料页 → `POST /api/users/profile`）；
3. 当前 CN 手动绑定逻辑（`PATCH /api/users/wotb-account`，后端仅允许 `CN`）；
4. 为支持 WG ASIA 需要修改哪些文件（对照本文各节）。

---

## 三、必须保留的现有业务行为

- 以 JWT `sub` 关联 `user_profile.keycloak_user_id`，不改变。
- QQ/CN 流程保持不变：

```text
QQ 登录 → Keycloak 创建或找到用户 → WotBTools 懒创建 user_profile
→ wotb_server = CN → 用户手动填写国服账号 ID 和昵称
```

- 手动接口继续保留，但只允许 `wotbServer = CN`；不允许前端通过手动接口伪造 ASIA account_id / nickname / verified 状态。
- 一个 WotBTools user_profile 对应一个主要 WoTB 游戏账号；不拆分多账号表，不为 EU/NA 过度设计。
- 新增不变量：**每个 Keycloak 用户都有 `region` 属性**（CN 用户为 `CN`，WG 用户为 `ASIA`）。

---

## 四、region 属性统一与存量迁移

### 1. 属性约定

- 用户属性名：`region`（不是 `wotb.region`），值统一大写 `CN` / `ASIA`。
- JWT claim：`region` → `wotb_region`（见第八节）。
- 后端兜底：JWT 缺失 `wotb_region` 或 `wotb_verified` 时，一律按 CN 用户处理（保证迁移与上线顺序不影响登录）。

### 2. 存量用户迁移（已执行）

使用 `deploy/keycloak-add-region-attribute.py`：

```bash
export KEYCLOAK_ADMIN_CLIENT_SECRET='...'
python3 deploy/keycloak-add-region-attribute.py --dry-run   # 先看影响范围
python3 deploy/keycloak-add-region-attribute.py --apply     # 确认后执行
```

要求：

- 只给**缺失** `region` 的用户补 `["CN"]`；已有值（例如未来的 `ASIA`）一律跳过、不覆盖；
- 幂等，可重复执行；保留用户其他属性；
- displayName 回填**不在本脚本范围内**（脚本只处理 `--attribute` 指定的属性）；如需回填，作为独立迁移另行执行（决策 D4）；
- 迁移前后输出影响人数，写入交付记录。

### 3. 执行记录（2026-08-06 生产环境）

目标：生产 realm `wotbtools`（auth.wotbtools.com），脚本 `deploy/keycloak-add-region-attribute.py`。

| 阶段 | 结果 |
|---|---|
| dry-run | total examined 138，missing 138，already set 0，would update 138 |
| apply | updated 138 / 138 |
| 重跑 dry-run（幂等验证） | total examined 138，already set 138，would update 0 |

- 只补写了 `region=["CN"]`，未覆盖任何已有属性；displayName 未在本次迁移中回填（见 D4）。
- 脚本保留在 VPS `/opt/wotb/deploy/keycloak-add-region-attribute.py`，与仓库内版本一致。

### 4. 新 CN/QQ 用户

`keycloak-juhe-qq-provider` 的 `JuheQqEndpoint` 在认证成功时增加写入 user attribute：

```text
region = CN
```

（`displayName` 现有逻辑已写，保持不动。）否则存量有 region、增量没有，不变量失效。

---

## 五、新建 Keycloak Wargaming Provider 模块

新增独立模块 `keycloak-wargaming-provider`，实现适配 Keycloak 26.6.4 的自定义 Identity Provider SPI。不要把 WG 登录逻辑塞进 `keycloak-juhe-qq-provider`。

### 1. 单 Provider 配置

```text
alias:        wargaming-asia
displayName:  Wargaming.net Asia
region:       ASIA
```

### 2. API 白名单（固定，不接受用户/前端传入任何 URL）

```text
认证 API:      https://api.wotblitz.asia/wot/auth/
WoTB 账号 API: https://api.wotblitz.asia/wotb/account/
```

### 3. Application ID

- 环境变量：`WG_APPLICATION_ID`（Keycloak 容器 env 注入）。
- Provider 在配置层通过 `System.getenv("WG_APPLICATION_ID")` 读取；缺失时 `performLogin` 返回明确错误（对齐 QQ Provider 的"未配置返回错误"模式），不导致 Keycloak 启动失败。
- 禁止硬编码进源码、Realm JSON 或前端代码。
- `wargaming-asia` IdP 不在 realm JSON 中声明（避免密钥进导入配置），dev/prod 均在 Admin Console 手工创建，步骤写入交付文档（决策 D18）。

---

## 六、WG 登录流程

Keycloak 发起登录时构造：

```text
GET https://api.wotblitz.asia/wot/auth/login/
     ?application_id={WG_APPLICATION_ID}
     &redirect_uri={Keycloak broker endpoint}
     &nofollow=1
```

回调地址（由 provider 根据会话动态构造，含 `state`）：

```text
https://auth.wotbtools.com/realms/wotbtools/broker/wargaming-asia/endpoint
```

要求：

- 正确使用并验证 Keycloak 登录会话的 `state`（参照 QQ Provider 的 `authCallback.getAndVerifyAuthenticationSession` 模式，不发明弱化版校验）；
- 回调属于原始认证会话；state 缺失/无效/过期/被篡改时拒绝登录；
- 回调不能被直接构造后绕过认证；
- 认证错误安全返回 Keycloak 登录流程。

WG 成功回调可能包含 `status`、`access_token`、`nickname`、`account_id`、`expires_at`。这些参数**不能直接作为最终可信身份**。

---

## 七、验证 WG 身份

### 1. 基础校验

- `status` 表示成功；
- `access_token` 存在；
- `account_id` 存在且格式正确（纯数字）；
- `expires_at` 未过期；
- 区服固定 `ASIA`；
- 回调 `state` 有效。

### 2. 服务端验证 Token 有效性

调用：

```text
POST https://api.wotblitz.asia/wot/auth/prolongate/
```

参数：`application_id`、`access_token`。用于确认 token 有效并刷新有效期。

### 3. 查询 WoTB 官方账号资料

```text
GET https://api.wotblitz.asia/wotb/account/info/
     ?application_id={WG_APPLICATION_ID}
     &account_id={回调 account_id}
```

确认：

- API 返回成功；
- 返回结果中存在该 `account_id`；
- 获取官方当前昵称，并（可选）与回调 `nickname` 比对，不一致时告警/拒绝。

### 4. 身份一致性结论（决策 D5）

WG 官方**不提供**"token 归属账号"的证明接口（`account/info` 的 `access_token` 仅用于访问私人数据，不校验归属；`prolongate` 不返回账号身份）。因此身份可信性由以下组合保证，验收以此为准：

```text
Keycloak state/会话校验 + HTTPS 回调送达受控 redirect_uri
+ prolongate 验证 token 有效 + account/info 获取官方昵称 + 立即 logout
```

任何一环失败都终止登录，不创建/关联 Keycloak 用户。

### 5. 构造稳定身份

- broker 唯一标识：`wg:asia:{account_id}`（不使用昵称）。
- Keycloak `username`：`account_id`（决策 D2，纯数字、稳定）。
- 首次登录创建用户；重复登录按 broker 身份找到同一用户。
- **重复登录时显式刷新**（决策 D11）：更新 `displayName`、`wotb.nickname`；不修改 `username`、broker id 等稳定身份。

### 6. 写入 Keycloak 用户属性

认证成功后写入/更新（只能由 Provider 或管理员写入，用户不可在 Account Console 修改）：

```text
region           = ASIA
displayName      = 官方昵称
wotb.account_id  = account_id
wotb.nickname    = 官方昵称
wotb.verified    = true
```

### 7. 用户角色

WG 首次登录创建用户后自动获得 `wotbtools-user`：

- realm JSON 增加 `defaultRoles: ["wotbtools-user"]`（dev 导入即生效）；
- 生产核对现有 default role 是否已是 `wotbtools-user`，是则无需操作；
- Provider 内不写授角色代码，避免两套实现。

### 8. 立即销毁 WG Token

完成验证后（成功或失败路径都要尽最大努力）调用：

```text
POST https://api.wotblitz.asia/wot/auth/logout/
```

WG Access Token 绝对不能：

- 写入数据库、Keycloak 用户属性、Keycloak Token Store、JWT；
- 返回前端；
- 出现在日志、异常正文、Loki / Prometheus / Tracing。

logout 失败可记录不含 token 的安全警告；不能因失败把 token 泄漏到日志。

---

## 八、Keycloak JWT Claims

为 `wotbtools-web` 配置只读 Protocol Mapper：

| Keycloak 用户属性 | JWT Claim | JSON 类型 |
|---|---|---|
| `region` | `wotb_region` | String |
| `wotb.account_id` | `wotb_account_id` | String |
| `wotb.nickname` | `wotb_nickname` | String |
| `wotb.verified` | `wotb_verified` | **boolean**（`jsonType=boolean`） |

（`displayName` 已有 mapper，保持不变。）

WG 用户 JWT 示例：

```json
{
  "sub": "keycloak-user-uuid",
  "preferred_username": "512345678",
  "displayName": "Player",
  "wotb_region": "ASIA",
  "wotb_account_id": "512345678",
  "wotb_nickname": "Player",
  "wotb_verified": true
}
```

要求：

- `wotb_verified` 输出真布尔，后端按 `Boolean` 解析；测试固定该契约；
- 不要把 WG Access Token 放进 JWT；
- Realm 导入配置不得硬编码生产 Application ID；
- JWT 缺失 `wotb_region` / `wotb_verified` 时，后端一律按 CN 兜底。

---

## 九、后端业务 Profile 同步

保留懒创建与 `JWT sub → user_profile.keycloak_user_id`，扩展创建与同步逻辑。

### 1. CN/QQ 用户

JWT 无可信 WG Claims（缺 `wotb_verified` 或非 `ASIA`）：`wotb_server = CN`，继续现有国服流程，不自动生成虚假 WG 数据。

### 2. WG ASIA 用户首次创建

仅当同时满足：

```text
wotb_verified == true
wotb_region == ASIA
wotb_account_id 有效
wotb_nickname 有效
```

首次创建 Profile 时自动写入：

```text
wotb_server              = ASIA
wotb_account_id          = JWT wotb_account_id
wotb_nickname            = JWT wotb_nickname
wotb_account_source      = WARGAMING
wotb_account_verified_at = 首次可信同步时间（后端 now，决策 D8）
```

### 3. 已存在 Profile 的同步

新增幂等接口（仅当现有创建接口不适合承载同步时）：

```text
PUT /api/users/wotb-account/from-login
```

- 不接受 request body；只读当前已签名 JWT；
- 要求 `wotb_verified == true`，只接受 `ASIA`；
- 按 JWT `sub` 查找 Profile；
- Profile 属于同一 `(ASIA, account_id)` 时允许更新官方昵称（`wotb_nickname`），不刷新 `wotb_account_verified_at`；
- 不允许把已有 CN Profile 静默覆盖为 ASIA；
- 不允许把已有 ASIA Profile 切换到另一个 `account_id`；
- `(ASIA, account_id)` 已属其他用户时返回明确冲突（错误码 `WOTB_ACCOUNT_ALREADY_USED`，作为兜底；直接登录场景由 broker 层拦截，决策 D12）；
- 不根据昵称/邮箱自动合并用户；
- 前端触发时机：个人资料页每次加载后调用一次（幂等）。

避免在多个接口中复制同一套 Claim 校验和同步逻辑：创建与同步共用 service 层统一校验。

### 4. DTO 与 API 契约

- `UserProfileDto` 增加 `wotbAccountSource`、`wotbAccountVerifiedAt`（纯英文 snake_case，不放中文）；
- 手动绑定接口继续只允许 `CN`，且不得写入 source/verified 字段。

---

## 十、数据库迁移

新增 Flyway migration（当前最高 V11，新编号 V12），不修改已执行过的旧 migration：

- `CHECK (wotb_server IN ('CN'))` 扩展为 `IN ('CN','ASIA')`；
- 保留 `UNIQUE (wotb_server, wotb_account_id)`；
- 增加最少必要字段：

```text
wotb_account_source     VARCHAR(32) NOT NULL DEFAULT 'MANUAL'
wotb_account_verified_at TIMESTAMPTZ
```

- 现有 CN 记录 → `wotb_account_source = MANUAL`、`wotb_account_verified_at = NULL`（平滑迁移，不删除/重建数据）；
- 若添加 enum/check 约束，确保现有数据平滑迁移。

---

## 十一、前端登录入口

### 1. 新增前端登录选择页（决策 D9）

未登录用户访问需鉴权页面时，跳转到前端登录选择页（当前 `ProfilePage` 是直接跳 Keycloak，需改为先进入本页）：

```text
中国大陆玩家
[使用 QQ 登录]

亚服玩家
[使用 Wargaming.net 登录]

提示：Wargaming.net 登录仅适用于国际亚服，不适用于中国大陆网易服。
```

- 三语 i18n（zh/en/ru）同步；
- `useAuth.js` 增加：

```js
const WG_PROVIDER_BY_REGION = Object.freeze({
  ASIA: 'wargaming-asia',
})

async function loginWithWargaming(region = 'ASIA', view = 'profile') {
  const provider = WG_PROVIDER_BY_REGION[region]
  if (!provider) {
    throw new Error('Unsupported Wargaming region')
  }
  const kc = ensureKeycloak()
  await initAuth()
  return kc.login({ idpHint: provider, redirectUri: loginRedirectUri(view) })
}
```

- 按当前 `useAuth.js` 真实结构调整，不机械复制；
- Keycloak 托管登录页保留为兜底入口，不改 Keycloak 主题。

### 2. 禁止采集 WG 凭据

前端绝对不能要求用户输入：WG 邮箱、WG 密码、WG Access Token、WG account ID、任意 WG API URL。所有 WG 凭据只在 WG 官方页面输入。

### 3. 文案约定（决策 D6）

登录页/个人资料页**不得**出现"请先 QQ 登录，再绑定 Wargaming.net 账号"的承诺文案。本期文案：

```text
Wargaming.net 登录会创建独立账号；QQ 与 WG 账号互通功能开发中。
```

---

## 十二、登录后的个人资料展示

### CN 用户（保持）

```text
服务器：中国大陆
资料来源：用户填写
[编辑游戏资料]
```

### WG ASIA 用户

```text
服务器：Asia
资料来源：Wargaming.net
账号已验证
玩家昵称：{wotb_nickname}
账号 ID：{wotb_account_id}
```

要求：

- ASIA 账号的 `server` / `account_id` / `verified` / `source` 不可手动编辑；
- **本期不允许 WG 用户解绑/删除账号**（决策 D7）：前端隐藏"解绑"按钮，后端对 ASIA profile 的 `PATCH/DELETE /api/users/wotb-account` 返回拒绝；
- 昵称以 WG 官方数据为准，在重新登录或可信同步时刷新；
- 新增展示文案三语 i18n 同步。

---

## 十三、已有 QQ 用户的处理

- 不根据相同昵称、相似用户名、相同展示名、推测邮箱自动合并 QQ 用户与 WG 用户；
- 用户直接使用 WG 登录时，系统创建新的 WG 用户；
- **本期不实现 Client-initiated Account Linking（AIA 绑定）**（决策 D6），明确记录为后续任务：
  - 后续任务：Keycloak 26 客户端发起的账号关联（确保关联后仍是同一 `sub`）；
  - 后续任务：绑定后 CN Profile 的迁移语义（server/source/旧 CN 数据）；
  - 本期至少保证直接 WG 登录不破坏现有 QQ 用户。

---

## 十四、Docker 与部署

### 1. Keycloak 镜像

修改 `docker/Dockerfile.keycloak`，同时构建并复制两个 JAR 到 `/opt/keycloak/providers/`，然后 `kc.sh build`：

```text
keycloak-juhe-qq-provider
keycloak-wargaming-provider
```

### 2. 部署路径检测

修改 `.github/workflows/deploy.yml` 的路径检测，确保修改 `keycloak-wargaming-provider/**` 时触发 Keycloak 镜像重建与部署。

### 3. 环境变量

生产部署注入 `WG_APPLICATION_ID`，同步更新：

- `.env.example`
- `docker/online/docker-compose.yml`
- 生产 Compose（`deploy.yml` 内联生成的 keycloak service environment）
- 必要的部署文档

禁止在日志中输出环境变量值。

### 4. Realm 配置载体（决策 D18）

- realm JSON：增加 4 个 Protocol Mapper（第八节）与 `defaultRoles`（第七节第 7 条）；不声明 IdP；
- `wargaming-asia` IdP 与 `wotbtools-admin-api` 等：dev/prod 均在 Admin Console 手工配置，步骤写入交付文档。

---

## 十五、安全要求

必须落实：

- 所有 WG 请求只使用 HTTPS；
- WG API Host 只来自固定白名单（第五节）；
- 正确验证 Keycloak state；
- 用 prolongate 验证 token 有效性、`account/info` 核对官方昵称（第七节第 4 条的口径）；
- WG Token 用完立即 logout，不持久化；
- Token 不进日志、指标、Trace、异常正文；日志不记录完整 WG 回调 Query String；
- 对 WG 请求设置合理超时：连接约 5 秒、总请求约 10 秒；不长时间/无限重试；
- 对 WG 错误响应做安全映射，不把原始错误正文直接返回浏览器；
- 前端不得获得 WG Token；
- 不允许前端伪造 ASIA 绑定；
- 不允许昵称驱动账号合并；
- 不允许一个 `(ASIA, account_id)` 属于多个业务用户；
- 日志策略（决策 D16）：Keycloak 保持默认（不开启含请求 URI 的访问日志）；host 级 Caddy 访问日志脱敏为仓库外运维项，写入部署文档；已知限制：WG token 会短暂出现在浏览器地址栏（WG 回调机制固有），服务端不落日志。

---

## 十六、测试要求

重点验证业务闭环，不做无价值的形式化测试。

### Keycloak Provider（决策 D13：JUnit 5 + JDK 内置 HttpServer stub）

- 成功生成 ASIA WG 登录地址（正确域名 `api.wotblitz.asia/wot/auth/login/`、参数完整、含 state）；
- 无效/缺失/过期/被篡改的 state 被拒绝；
- WG 拒绝登录时安全返回；
- 缺少 token 时拒绝；token 过期（prolongate 失败）时拒绝；
- 官方昵称与回调不一致时拒绝；
- `account/info` 失败时不创建用户；
- 成功登录后生成稳定的 `wg:asia:{account_id}` 与 `username = account_id`；
- 重复登录返回同一 Keycloak 用户；
- **WG 昵称变化后重复登录：同一用户，`displayName` / `wotb.nickname` 已更新，username 不变**（决策 D11）；
- region / displayName / wotb.* 属性写入正确；
- Token 不进用户属性和 JWT；
- 成功或失败路径都会尽力 logout；
- `WG_APPLICATION_ID` 缺失时返回明确错误。

### 后端

- CN 用户仍可正常创建 Profile、手动绑定国服资料；
- 手动接口拒绝 ASIA，且不能伪造 source/verified；
- WG 可信 Claims 创建 ASIA Profile（含 source=WARGAMING、verified_at=首次同步时间）；
- 缺少 `wotb_verified` / 非 ASIA Claim 被拒绝或按 CN 兜底；
- 重复同步幂等；WG 昵称可更新；verified_at 不被刷新；
- 已存在其他 ASIA 账号不能被静默覆盖；`(ASIA, account_id)` 冲突返回 `WOTB_ACCOUNT_ALREADY_USED`；
- 现有 CN 数据迁移后保持不变；
- 迁移脚本：dry-run 计数正确、只补缺失值、幂等重跑 0 更新。

### 前端

- QQ 登录入口仍然存在；
- WG ASIA 登录正确传递 `idpHint=wargaming-asia`；
- 不要求用户输入 WG 凭据；
- CN 与 ASIA 资料展示正确，三语文案齐全；
- ASIA 官方字段不可手动修改，无解绑入口；
- 登录选择页文案不含"绑定"承诺。

### 构建与部署

- 后端测试通过；前端测试和构建通过；
- Keycloak 两个 Provider 都能构建；镜像包含两个 JAR；
- Flyway migration 可从现有生产结构平滑升级；
- 只修改 WG Provider 也触发 Keycloak 镜像构建。

---

## 十七、验收标准

```text
亚服玩家点击"使用 Wargaming.net 登录"
→ 跳转到 WG 官方页面（api.wotblitz.asia）
→ 用户只在 WG 官方页面输入凭据
→ WG 回调 Keycloak（broker endpoint，state 校验通过）
→ 服务端 prolongate 验证 token 有效
→ 调用 WoTB ASIA account/info 获取官方昵称并核对
→ 创建或找到稳定 Keycloak 用户（username = account_id，broker = wg:asia:{account_id}）
→ 自动获得 wotbtools-user
→ 写入 region=ASIA / displayName / wotb.* 属性
→ JWT 包含 wotb_region / wotb_account_id / wotb_nickname / wotb_verified(boolean)
→ WotBTools 首次懒创建 ASIA user_profile（source=WARGAMING，verified_at=首次同步时间）
→ 自动填写 account_id 和 nickname
→ 用户进入个人资料页，显示"Wargaming.net 已验证"
→ WG Token 已 logout 且没有被保存
→ 同一玩家再次登录仍返回同一用户；改名后昵称属性更新、身份不变
```

同时必须保证：

```text
现有 QQ 登录正常
现有 CN 用户数据不丢失
现有 CN 手动绑定正常
所有存量用户已补 region=CN（迁移脚本执行记录）
前端不能手动伪造 ASIA 账号
WG Token 不会泄漏
```

---

## 十八、完成后输出

1. 实际修改文件列表；
2. 关键实现说明（含 Provider 身份构造与重复登录属性刷新）；
3. 数据库迁移说明（V12：CHECK、新字段、存量数据平滑迁移）；
4. 安全处理说明（state 校验、token 生命周期、日志策略、浏览器地址栏已知限制）；
5. 测试和构建结果；
6. 仍需在 Keycloak Admin Console 或生产环境手动完成的配置（wargaming-asia IdP、admin client、default role 核对、Caddy 日志脱敏）；
7. region 存量迁移脚本执行记录（dry-run 人数 + 实际更新人数）；
8. ASIA 完整手工验收步骤。

---

## 范围外 / 后续任务

- QQ→WG 账号关联（Keycloak 26 client-initiated account linking）及其 CN Profile 迁移语义；
- EU/NA 区服与多账号拆分；
- 自定义 Keycloak 错误页（broker 冲突的可读文案）；
- host 级 Caddy 访问日志脱敏落地（仓库外运维项）。
