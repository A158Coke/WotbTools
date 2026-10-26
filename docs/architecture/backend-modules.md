# Backend module documentation

WotBTools 的 `wotb-web` 模块图以生产源码中的 Spring Modulith 声明为唯一事实来源：

- `com.wotb.web.*` 各模块的 `package-info.java`
- `@ApplicationModule(allowedDependencies = ...)`
- `@NamedInterface`
- `ApplicationModules.of(WotbWebApplication.class)`

不要在本文件手工维护第二份模块依赖图。

## 生成文档

从仓库 `java/` 目录运行：

```bash
mvn -s settings.xml -pl wotb-web -am \
  -Dtest=WebModuleDocumentationTest \
  -Dsurefire.failIfNoSpecifiedTests=false test
```

Spring Modulith `Documenter` 会从同一个已经验证过的 `ApplicationModules` 模型生成：

- 全局 module component diagram
- 每个 module 的局部 dependency diagram
- module canvas
- 聚合文档

默认输出位于 `wotb-web/target/spring-modulith-docs/`。`target/` 是构建产物并已被 `.gitignore` 忽略；生成结果不提交、不手改。

## 模块集成测试

当前对以下高价值模块提供独立启动与边界验证：

- `UserModuleIntegrationTest`：验证 user 模块能在不扫描 consumer modules 的情况下独立完成 Spring wiring，跨域入口仍由 `UserProfiles` 提供；repository 用 mock 替代，因为数据库行为已有独立 Testcontainers 测试。
- `ReplayModuleIntegrationTest`：验证 replay 模块独立启动，并通过真实 `ReplayCapacityLimiter` bean 验证配置容量与 permit 释放语义。

运行命令：

```bash
mvn -s settings.xml -pl wotb-web -am \
  -Dtest=UserModuleIntegrationTest,ReplayModuleIntegrationTest,WebModuleArchitectureTest,WebModuleDocumentationTest \
  -Dsurefire.failIfNoSpecifiedTests=false test
```

这些模块集成测试用于验证 Spring wiring、模块隔离和公开边界，不替代 PostgreSQL/Testcontainers、HTTP contract 或业务回归测试。

## 职责划分

Spring Modulith 负责：

- module graph
- public API / named interfaces
- allowed dependencies
- cycles
- module bootstrap tests
- derived architecture documentation

ArchUnit 继续负责 WotBTools 自己的分层和代码规则，例如 Controller/Service/Repository ownership、禁止字段注入、禁止 Lombok 等。

Spring Modulith runtime、events、outbox、event publication registry 和 observability runtime 当前未启用。
