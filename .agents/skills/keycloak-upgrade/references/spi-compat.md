# 自定义 SPI 兼容性检查

## 项目中的 SPI 表面

两个 provider 均为 `org.keycloak.broker.provider.IdentityProviderFactory` 实现（服务注册文件
`META-INF/services/org.keycloak.broker.provider.IdentityProviderFactory`），由 Keycloak 启动时自动发现。

| 组件 | Wargaming provider | Juhe QQ provider |
|------|--------------------|------------------|
| Factory | `WargamingIdentityProviderFactory extends AbstractIdentityProviderFactory<WargamingIdentityProvider>` | `JuheQqIdentityProviderFactory extends AbstractIdentityProviderFactory<JuheQqIdentityProvider>` |
| Provider | `WargamingIdentityProvider extends AbstractIdentityProvider<WargamingIdentityProviderConfig>` | `JuheQqIdentityProvider extends AbstractIdentityProvider<JuheQqIdentityProviderConfig>` |
| Config | `WargamingIdentityProviderConfig extends IdentityProviderModel` | `JuheQqIdentityProviderConfig extends IdentityProviderModel` |
| Callback endpoint | `WargamingEndpoint`（`@Path` JAX-RS，回调自 `prolongate` 服务端换取 token） | `JuheQqEndpoint`（JAX-RS 回调） |
| 业务 API 客户端 | `WargamingApiClient`（`java.net.http.HttpClient` 调 `api.wotblitz.*`） | `JuheQqEndpoint` 内联 HTTP（`java.net.http.HttpClient` 调聚合 API） |
| 测试 | `WargamingRegionTest` / `WargamingIdentityProviderTest` / `WargamingEndpointTest` / `WargamingApiClientTest` / `KeycloakFakes` | 无单测 |

## 依赖的 Keycloak API（按破坏风险排序）

| 包 / 类 | 用途 | 破坏风险 |
|---------|------|----------|
| `org.keycloak.broker.provider.AbstractIdentityProvider` / `IdentityProvider` | 主流程：`performLogin`、`callback`、`keycloakInitiatedLogin`、`updateBrokeredUser`、`importNewUser` | 中：签名可能随 major 变化 |
| `org.keycloak.broker.provider.AbstractIdentityProviderFactory` / `IdentityProviderFactory` | 工厂：`getId`、`create`、`createConfig`、`getConfigProperties` | 中 |
| `org.keycloak.broker.provider.BrokeredIdentityContext` | 用户身份上下文（username/attribute 注入） | 中 |
| `org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback` | 回调身份校验（state、token 校验） | 中：较新的接口，跨版本需确认 |
| `org.keycloak.models.IdentityProviderModel` / `KeycloakSession` / `RealmModel` / `UserModel` / `FederatedIdentityModel` / `UserSessionModel` | 配置与用户模型 | 中 |
| `org.keycloak.sessions.AuthenticationSessionModel` | 认证会话 state 读写 | 高：内部 API，minor 也可能变 |
| `org.keycloak.events.EventBuilder` | 登录事件 | 低-中 |
| `org.keycloak.provider.ProviderConfigProperty` | 配置项声明（LIST_TYPE 等） | 低 |
| `jakarta.ws.rs`（JAX-RS 3.x） | Endpoint 注解与 `Response` | 低：随 Keycloak 自带版本走 |
| `com.fasterxml.jackson.databind` | API 响应解析 | 低：Keycloak 自带 jackson，勿在 jar 内打包自己的副本 |

`keycloak-server-spi-private` 与 `keycloak-services` 均为内部 API：**minor 版本也可能破坏**，即使官方保证
fully supported API 的 minor 向后兼容。升级后第一步永远是重编译 + 跑单测。

## 检查步骤

1. **同步版本**：两个 pom 的 `<keycloak.version>` 一起改为目标版本（与 Dockerfile FROM tag 一致）。
2. **重编译**：`JAVA_HOME=<jdk21> mvn -s java/settings.xml test`（两个 provider 目录各一次）。
   - 编译错误 = 接口变化；逐个对照官方源码/迁移指南修复。
   - 常见修复点：`create(KeycloakSession, IdentityProviderModel)` 返回类型、`AuthenticationCallback` 方法签名、
     `BrokeredIdentityContext` 的 getter/setter、`IdentityProviderModel` 构造器。
3. **查官方资料**：在目标版本 migration guide 中搜 `broker` / `IdentityProvider` / `SPI` / `private`，记录相关条目。
4. **看启动日志**：`kc.sh start` 后确认 provider 加载成功、无 `Provider not found` / class 冲突。
5. **冒烟**：三个 WG 区服 + QQ 各登录一次；重复登录验证 `updateBrokeredUser` 昵称刷新；验证 JWT claims。

## 修复原则

- 只改签名适配，不改业务逻辑；最小 diff。
- 不要打包 Keycloak 自己的依赖进 jar（pom 中 `provided` scope 保持现状，避免 classpath 冲突）。
- 不要在 provider 里显式开事务（26.6.3+ 会拒绝重复 start），保持现有无事务风格。
- 改完走 `grill-fix` + `grill-with-docs`。
