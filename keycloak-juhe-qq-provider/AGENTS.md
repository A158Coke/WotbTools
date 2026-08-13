# keycloak-juhe-qq-provider/ — 聚合数据 QQ 登录 SPI

> 仓库级硬约定见 `.agents/AGENTS.md`；Keycloak 版本升级流程见 `.agents/skills/keycloak-upgrade/`。

- 独立 Maven 模块（JDK 21，Keycloak 26.6.4 SPI；CI 用 `-s ../java/settings.xml -Dmaven.repo.local=../java/.m2repo` 构建）。
- 工厂类 `com.wotbtools.keycloak.juheqq.JuheQqIdentityProviderFactory`，经 `src/main/resources/META-INF/services` 注册。
- 聚合数据（juhe）凭据走环境变量/secret，不落日志；部署参考 `docs/auth/keycloak-qq-only.md`。