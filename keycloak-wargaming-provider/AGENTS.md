# keycloak-wargaming-provider/ — Wargaming.net 登录 SPI

> 仓库级硬约定见 `.agents/AGENTS.md`；Keycloak 版本升级流程见 `.agents/skills/keycloak-upgrade/`。

- 独立 Maven 模块（JDK 21，Keycloak 26.6.4 SPI；CI 用 `-s ../java/settings.xml -Dmaven.repo.local=../java/.m2repo` 构建）。
- 工厂类 `com.wotbtools.keycloak.wargaming.WargamingIdentityProviderFactory`，经 `src/main/resources/META-INF/services`
  注册；provider id = `wargaming`，一个类型、ASIA/EU/NA 三个实例。
- 认证接口走 `api.worldoftanks.{asia|eu|com}/wot/auth/*`，账号接口走 `api.wotblitz.{asia|eu|com}/wotb/account/*`
  （生产实证，勿互换）；token/application_id 不落日志。
- 账号隔离：`username = wg_{region}_{account_id}`、`broker = wg:{region}:{account_id}`。部署与手工配置见
  `docs/auth/wargaming-asia-deployment.md`。
