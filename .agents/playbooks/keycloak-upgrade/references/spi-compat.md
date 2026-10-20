# 自定义 SPI 兼容性检查

## 项目中的 SPI 表面

本项目的自定义扩展有三类，均由 Keycloak 启动时通过 `META-INF/services/` 自动发现：

- `keycloak-wargaming-provider` 与 `keycloak-qq-provider`：`org.keycloak.broker.provider.IdentityProviderFactory`（broker IdP；QQ 生产 alias `idp-qq`）。
- `keycloak-session-provider`：`org.keycloak.authentication.AuthenticatorFactory`（`wotbtools-persistent-browser-session`，在 brokered `wotbtools-web` 登录上标记 remember-me；Android 原生 AppAuth 会话不受影响）。

| 组件 | Wargaming provider | Official QQ provider | Session provider |
|------|--------------------|----------------------|------------------|
| SPI | `IdentityProviderFactory` | `IdentityProviderFactory` | `AuthenticatorFactory` |
| Service registration | `META-INF/services/org.keycloak.broker.provider.IdentityProviderFactory` | 同左 | `META-INF/services/org.keycloak.authentication.AuthenticatorFactory` |
| Factory | `WargamingIdentityProviderFactory` | `QQIdentityProviderFactory` | `PersistentBrowserSessionAuthenticatorFactory` |
| Provider | `WargamingIdentityProvider` | `QQIdentityProvider` | `PersistentBrowserSessionAuthenticator`（`Authenticator`） |
| Config | `WargamingIdentityProviderConfig` | `QQIdentityProviderConfig` | 无配置：`isConfigurable() == false`，`getConfigProperties()` 为空 |
| Callback endpoint | `WargamingEndpoint`（`@Path` JAX-RS，回调自 `prolongate` 服务端换取 token） | QQ Connect OAuth callback（`idp-qq` broker endpoint） | 无外部 endpoint；在 post-broker authentication flow 中执行 |
| 业务 API 客户端 | `WargamingApiClient`（`java.net.http.HttpClient` 调 `api.wotblitz.*`） | QQ Connect OpenAPI（`graph.qq.com`） | 无；只写 `Details.REMEMBER_ME` auth note |
| 受影响的 client | browser + Android | browser + Android | 仅 browser `wotbtools-web`（Android 由 AppAuth 自管会话） |
| 测试 | `WargamingRegionTest` / `WargamingIdentityProviderTest` / `WargamingEndpointTest` / `WargamingApiClientTest` / `KeycloakFakes` | `keycloak-qq-provider` 模块内单测 | `PersistentBrowserSessionAuthenticatorTest` |

## 依赖的 Keycloak API（按破坏风险排序）

| 包 / 类 | 用途 | 破坏风险 |
|---------|------|----------|
| `org.keycloak.broker.provider.AbstractIdentityProvider` / `IdentityProvider` | 主流程：`performLogin`、`callback`、`keycloakInitiatedLogin`、`updateBrokeredUser`、`importNewUser` | 中：签名可能随 major 变化 |
| `org.keycloak.broker.provider.AbstractIdentityProviderFactory` / `IdentityProviderFactory` | 工厂：`getId`、`create`、`createConfig`、`getConfigProperties` | 中 |
| `org.keycloak.broker.provider.BrokeredIdentityContext` | 用户身份上下文（username/attribute 注入） | 中 |
| `org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback` | 回调身份校验（state、token 校验） | 中：较新的接口，跨版本需确认 |
| `org.keycloak.authentication.Authenticator` / `AuthenticatorFactory` | session 扩展的 SPI：`authenticate`、`action`、`configuredFor`、`setRequiredActions`、`create`、`getRequirementChoices` | 中：SPI 方法随 major/minor 调整 |
| `org.keycloak.authentication.AuthenticationFlowContext` | 读取认证会话与 client，写 auth note 并 `success()` | 中 |
| `org.keycloak.models.AuthenticationExecutionModel.Requirement` | session factory 的 requirement choices | 低 |
| `org.keycloak.events.Details.REMEMBER_ME` | remember-me auth note key | 低 |
| `org.keycloak.models.IdentityProviderModel` / `KeycloakSession` / `RealmModel` / `UserModel` / `FederatedIdentityModel` / `UserSessionModel` | 配置与用户模型 | 中 |
| `org.keycloak.sessions.AuthenticationSessionModel` | 认证会话 state / auth note 读写（两个 broker 与 session 扩展都会经过） | 高：内部 API，minor 也可能变 |
| `org.keycloak.events.EventBuilder` | 登录事件 | 低-中 |
| `org.keycloak.provider.ProviderConfigProperty` | 配置项声明（LIST_TYPE 等） | 低 |
| `jakarta.ws.rs`（JAX-RS 3.x） | Endpoint 注解与 `Response` | 低：随 Keycloak 自带版本走 |
| `com.fasterxml.jackson.databind` | API 响应解析 | 低：Keycloak 自带 jackson，勿在 jar 内打包自己的副本 |

`keycloak-server-spi-private` 与 `keycloak-services` 均为内部 API：**minor 版本也可能破坏**，即使官方保证
fully supported API 的 minor 向后兼容。升级后第一步永远是重编译 + 跑单测。

## 检查步骤

1. **同步版本**：三个 pom（`keycloak-wargaming-provider` / `keycloak-qq-provider` / `keycloak-session-provider`）的 `<keycloak.version>` 一起改为目标版本（与 Dockerfile FROM tag 一致）。
2. **重编译**：三个 provider 目录各跑一次 `mvn -s java/settings.xml test`，`JAVA_HOME` 指向
   **provider 目录 `AGENTS.md` 规定的 JDK 版本**（`keycloak-wargaming-provider/AGENTS.md`：JDK 21；
   三个 provider pom 的 `maven.compiler.release` 均为 21）——**不是** 仓库主工程的 JDK 25。
   - 编译错误 = 接口变化；逐个对照官方源码/迁移指南修复。
   - 常见修复点：`create(KeycloakSession, IdentityProviderModel)` 返回类型、`AuthenticationCallback` 方法签名、
     `BrokeredIdentityContext` 的 getter/setter、`IdentityProviderModel` 构造器。
   - session provider 额外检查 `AuthenticatorFactory#create(KeycloakSession)` 与
     `Authenticator` 的 `authenticate` / `action` / `configuredFor` / `setRequiredActions` 签名；
     `PersistentBrowserSessionAuthenticatorTest` 必须通过。
3. **查官方资料**：在目标版本 migration guide 中搜 `broker` / `IdentityProvider` / `Authenticator` /
   `authentication flow` / `SPI` / `private`，记录相关条目。
4. **看启动日志**：`kc.sh start` 后确认两个 `IdentityProviderFactory` 与
   `AuthenticatorFactory` 都已加载、无 `Provider not found` / class 冲突。
5. **冒烟**：三个 WG 区服 + QQ 各登录一次；重复登录验证 `updateBrokeredUser` 昵称刷新；验证 JWT claims；
   browser 登录后 `wotbtools-web` session 持久（remember-me），并确认 Android 原生 AppAuth 会话行为不变。

## 修复原则

- 只改签名适配，不改业务逻辑；最小 diff。
- 不要打包 Keycloak 自己的依赖进 jar（pom 中 `provided` scope 保持现状，避免 classpath 冲突）。
- 不要在 provider 里显式开事务（26.6.3+ 会拒绝重复 start），保持现有无事务风格。
- session provider 保持 stateless，且只对 `wotbtools-web` browser client 生效；不得把 Android client 纳入 remember-me。
- 改完走 `review-with-docs` 作为唯一 final gate。
