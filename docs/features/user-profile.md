# 个人主页 · WoTB 账号绑定与「用回放验证」

> 实现：`java/wotb-web/.../user/`（`UserProfileService`）、`frontend/src/components/ProfilePage.vue`、
> `frontend/src/replay-local/submissionFacts.ts#replayRecorderAccountId`。
> 本文是当前 Profile / 绑定 / 验证的产品契约；实现位置见下。

## 身份信息卡

「身份信息」卡展示展示名、认证服务、Keycloak 用户 ID、Keycloak 用户名与 realm 角色，所有登录用户可见（只显示本人信息）：

- **Keycloak 用户 ID**：取 `GET /api/users/profile` 的 `keycloakUserId`（= token `sub`），等宽显示并可复制；
  复制成功才显示「已复制」。
- **Keycloak 用户名**：取 `GET /api/users/profile` 的 `username`（= token `preferred_username`，内部登录名，如
  `wg_asia_512345678`），等宽只读展示，不提供站内编辑入口；缺失时显示 `--`。绑定卡的展示名仍只认 `displayName` / WoTB 昵称。
- **角色**：只读当前 access token 的 `realm_access.roles`（Keycloak 已展开 composite，持有 `wotbtools-admin`
  会同时看到它包含的业务角色），隐藏 Keycloak 内置的 `default-roles-*` / `offline_access` / `uma_authorization`，
  其余按原始 key 排序展示，不做 i18n 翻译；角色展示与权限判断都以真实 token claims 为事实源。client 角色（`resource_access`）不展示。
- **不展示 group**：realm 未定义 group（`infra/tofu/keycloak` 无 group 资源），token 也没有 group-membership mapper。
  若以后启用 group，优先在 tofu 加 mapper 让前端读 token claim，而不是让资料接口依赖 Keycloak admin API。

## WoTB 账号绑定与验证状态

`user_profile.wotb_account_verified_at`（可空）是「**当前**绑定账号是否已验证」的唯一表达：NULL = 未验证，非 NULL = 已验证（保留**首次**成功验证时间，不重写）。写入方只有两个：

1. 可信 WG claims 的 canonical provisioning / 空 Profile 升级（`wotb_account_source=WARGAMING`）；
2. 「用回放验证」的客户端便利徽章（见下）。

### 绑定来源与只读边界

- **CN**：用户在个人主页手动填写国服账号；`PATCH /api/users/wotb-account` 只允许 `wotbServer=CN`，不得写入 source/verified。
- **ASIA / EU / NA**：Wargaming 登录写入可信 JWT claims；`PUT /api/users/wotb-account/from-login`（无 body，只读 JWT）幂等创建或同步 WARGAMING Profile。WG Profile 的 server / account_id / source / verified 只读，不提供站内解绑或删除。
- **ensure**：`PUT /api/users/profile` 是幂等账号 bootstrap，不覆盖已有绑定；缺失时按可信 WG claims 创建 WARGAMING Profile，否则创建 CN MANUAL Profile。并发 ensure 由 `keycloak_user_id` 唯一约束兜底。
- **唯一性**：一个 WotBTools Profile 对应一个主要 WoTB 游戏账号；`(server, account_id)` 全局唯一。
- **冲突/失败**：已绑定 CN Profile 被 WG 登录覆盖 → 409 `PROFILE_REGION_MISMATCH`；换账号 → 409 `WOTB_ACCOUNT_MISMATCH`；账号被他人占用 → 409 `WOTB_ACCOUNT_ALREADY_USED`；JWT claims 缺失/无效 → 400 `WOTB_CLAIMS_INVALID`；WARGAMING source 的手动修改/解绑 → 400 `ASIA_PROFILE_READONLY` / `WARGAMING_PROFILE_READONLY`。
- **验证清除**：换绑（`(server, account_id)` 任一变化）或解绑会清空 `wotb_account_verified_at`；只刷新昵称或 ensure 不清空。

## 「用回放验证」的信任模型

**这是客户端声称的便利徽章，不是身份证明。**

1. 浏览器本地用锁定版本的上游 Agent WASM（`parseResult`）解析用户选中的回放；
2. 本地得到录像者的数值 accountId；
3. 客户端只 POST 这个 accountId（`POST /api/users/wotb-account/verify-replay`，body `{recorderAccountId}`）——
   **不上传回放、服务端不解析回放、不比对回放字节**（server has no replay parser）；
4. 服务端只比较「客户端声称的录像者 accountId」与当前绑定的 WoTB accountId；
5. 相等 → 设置 `wotb_account_verified_at`（首次时间，幂等），个人主页显示已验证徽章。

徽章：

- **不授予任何权限、不参与任何授权判定、不是身份安全边界**；
- 客户端数据可以伪造（直接 POST 任意 accountId），这是**明确接受**的风险——功能本身不重要，不值得为它建立
  回放验真、密码学证明或抽样解析；
- 解绑 / 切换绑定账号会清空验证时间（陈旧验证不得被继承）。

守卫：`ReplayVerificationBadgeBoundaryTest`（`wotbAccountVerifiedAt` 只允许出现在 user 域的实体 / DTO / Mapper /
Service，任何授权代码读取它都会失败）、`UserProfileServiceTest#verificationIsAClientAssertedComparisonNotAReplayAuthenticityCheck`。
想让徽章影响权限，必须先推翻本决策并重新设计验真机制——而服务器没有 parser。

## 资料失败与认证失败

认证初始化失败才显示认证恢复入口；仍已认证时，资料 ensure（PUT）或读取（GET）发生非认证错误时显示
“账户资料加载失败 / 重试”。重试经全局 business bootstrap 再读资料，不重新发起 QQ 授权。
真正的 HTTP 401 继续沿用 transport 的认证恢复，不把服务端拒绝误当成普通资料失败。
请求进行中去重；离线、连接未知、降级与服务不可用继续使用 capability 的中性提示，恢复可用后补一次。

全局 bootstrap 缓存与在途结果按 `authEpoch` 隔离；账户页同时观察登录态与 token 的 `sub`。
登出或直接切换账号会清理旧投影，旧请求的成功、失败和 finally 都不能覆盖当前身份。
