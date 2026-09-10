# Keycloak Admin REST 用户检索能力（Admin Users 分页 / IdP 过滤前提）

> 本文是 Admin Users 服务端分页与 Juhe QQ cleanup 的**能力事实源**。
> 结论只声明已被证据支持的部分；未被证据支持的写入「局限」，不猜。

## 1. 版本矩阵

| 组件 | 版本 | 来源 |
|---|---|---|
| Keycloak 服务器镜像 | `26.6.4` | `docker/Dockerfile.keycloak` |
| `keycloak-admin-client` | `26.0.9` | `java/wotb-web/pom.xml:123` |
| `keycloak-core` | `26.6.4` | `java/wotb-web/pom.xml:128` |

## 2. Step 0 时点的缺口（本 PR 已补齐）

`java/wotb-web/src/main/java/com/wotb/web/config/KeycloakAdminUserService.java` 当前**没有任何用户检索能力**，只有：

```text
getUser(String)                  :27   单个用户详情
getFederatedIdentities(String)   :36   单个用户的联合身份
hasRealmRole / addRealmRole / removeRealmRole
deleteUser(String)               :82   删除单个用户
```

因此 `AdminUserService.searchUsers:52` 的数据源 100% 是本地 `user_profile`
（`UserProfileRepository.searchAdminUsers(query, Pageable)`），**Keycloak-only 用户不可见**。

> 上述是本文件写作时（Step 0）的缺口描述，保留作为能力评估依据。
> 本 PR 已据此补齐实现：`KeycloakAdminUserService` 新增 `searchUsers` / `countUsers` /
> `searchUsersByIdpAlias` / `countUsersByIdpAlias`；`GET /api/admin/users` 改为
> `segment=keycloak`（权威源 Keycloak，可发现 Keycloak-only 用户）与 `segment=local`
> （权威源本地 profile，标记 `keycloakUserMissing` 孤儿绑定）两个 segment 的服务端分页。

## 3. 结论

| 能力 | 结论 | 证据 |
|---|---|---|
| 用户分页检索 | **支持** | `UsersResource.list(Integer first, Integer max)`；`search(String search, Integer first, Integer max)` |
| 总数 count（分页必需） | **支持** | `UsersResource.count()` / `count(String search)` |
| 按 IdP alias 过滤 | **支持** | admin-client 26.0.9 字节码中 `search`/`count` 重载带 `@QueryParam("idpAlias")` 与 `@QueryParam("idpUserId")` |
| 按 ids 批量取用户 | **不支持** | 全部重载与 `count` 均无 `ids` 参数；只能逐个 `getUser(id)` |

## 4. 精确签名（`javap -v` 逐参数注解还原，可编译验证）

带 IdP 过滤的**列表**重载（11 参数）：

```java
List<UserRepresentation> search(String username, String firstName, String lastName,
                               String email, Boolean emailVerified,
                               String idpAlias, String idpUserId,
                               Integer first, Integer max,
                               Boolean enabled, Boolean briefRepresentation)
```

带 IdP 过滤的 **count** 重载（13 参数）：

```java
Integer count(String search, String lastName, String firstName, String email,
              String emailVerified, String username, Boolean enabled,
              String idpAlias, String idpUserId,
              Boolean exact, String q,
              String createdAfter, String createdBefore)
```

无 IdP 过滤的**自由文本列表**重载：

```java
List<UserRepresentation> search(String search, Integer first, Integer max)
List<UserRepresentation> search(String search, Integer first, Integer max, Boolean briefRepresentation)
List<UserRepresentation> search(String search, Boolean enabled, Integer first, Integer max)
```

### 4.1 关键约束（本任务必须绕开的客户端短板）

```text
admin-client 26.0.9 的列表查询重载中，不存在同时带 search(自由文本) 与 idpAlias 的重载：
  - 带 idpAlias 的列表重载只有 username / firstName / lastName / email / emailVerified 维度
  - 带 search 自由文本的列表重载没有 idpAlias
而 count 重载【同时】支持 search 与 idpAlias。

服务端（Keycloak 26.x UsersResource）本身同时支持 search 与 idpAlias，
因此这是【客户端重载缺口】，不是服务端能力缺口。
```

绕开方式（Step 3 实施时二选一，优先第一种）：

```text
方式 A（纯受支持 API）：idpAlias 生效时，文本条件改用重载的 username 维度
         （Keycloak username 匹配为前缀/包含语义，覆盖「按用户名找 QQ 用户」这一真实场景），
         并用 count 的 search+idpAlias 重载取总数 → 分页与总数一致。
方式 B（自定义 JAX-RS 代理）：keycloak.proxy(Class<T>, URI)
         （javap 已确认 org.keycloak.admin.client.Keycloak.proxy(Class,URI) 存在），
         声明只含所需 @QueryParam 的接口，按服务端真实参数集发请求。
```

禁止：把 IdP 过滤做成「先拉一页再在内存里筛」。那会破坏分页正确性，正是任务禁止的 fake pagination。

## 5. 局限（必须显式声明，不得假装已验证）

```text
1. 本地 Docker daemon 未运行（docker version 连接 npipe 失败），
   因此无法对 26.6.4 容器做端到端实测。
   第 3 节结论来自：admin-client 26.0.9 字节码（javap -v 逐参数注解）
   + Keycloak 官方 server-side UsersResource javadoc
   + 版本单调性（server 26.6.4 晚于 client 26.0.9 发布线）。
2. 「26.6.4 服务端确实兑现 idpAlias 查询参数」的端到端验证，
   留给 PR CI（Testcontainers / Docker 可用时）。
3. 在 CI 验证通过前，不得在文档或 UI 中宣称 IdP 过滤已生产可用。
```

## 6. 对 Admin Users 设计的直接约束

```text
- 分页：Keycloak 侧 first/max 作为唯一权威分页；本地 profile 增强必须按【当前页】
       做一次 IN 查询，禁止逐用户 getUser（N+1）。
- 详情增强：federated identities 仍只在详情页逐用户拉取（既有能力，非列表路径）。
- 孤儿 profile 判定需要知道「某 keycloak_user_id 在 Keycloak 是否还存在」，
  Keycloak 无批量按 id 查询 → 只能对【当页】的候选做逐个 getUser，
  因此 `segment=local` 的分页权威必须放在本地 DB（user_profile），而不是 Keycloak；
  该 segment 每页因此产生 N（≤ size）次 Keycloak Admin 调用，代价由默认页大小界定。
```

## 7. 引用

- Keycloak 服务端 Admin REST `UsersResource` javadoc：<https://www.keycloak.org/docs-api/latest/javadocs/org/keycloak/services/resources/admin/UsersResource.html>
- Keycloak admin-client `UsersResource` javadoc（26.3.2 线）：<https://www.keycloak.org/docs-api/26.3.2/javadocs/org/keycloak/admin/client/resource/UsersResource.html>
- 相关上游 issue（admin UI 增加按 IdP alias 搜索）：<https://github.com/keycloak/keycloak/issues/25997>
