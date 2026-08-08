---
name: keycloak-upgrade
description: >
  Keycloak 版本升级（patch/minor/major）全流程：版本同步点检查、自定义 SPI（Identity Provider）
  兼容性评估与修复、构建测试、本地与生产验证、回滚预案和边界情况清单。
  Trigger: 升级 Keycloak 镜像 tag 或依赖版本、改 provider pom 的 keycloak.version、
  Keycloak provider 编译/运行失败、评估 Keycloak 大版本升级影响、同步 frontend keycloak-js。
---

# keycloak-upgrade

本技能面向 WotbTools 的 Keycloak 升级：`quay.io/keycloak/keycloak` 镜像 + 两个自定义 Identity Provider SPI
（`keycloak-wargaming-provider` / `keycloak-juhe-qq-provider`）+ 前端 `keycloak-js` + 后端 Admin REST 调用。

## 适用场景（Use Cases）

| 场景 | 要点 |
|------|------|
| patch 升级（26.6.4 → 26.6.5） | 同 major.minor，官方支持零停机滚动升级；仍需读 migration guide 并跑 provider 测试 |
| minor 升级（26.x → 26.7） | 26.0+ 起官方保证 minor 内向后兼容（fully supported API）；但 `spi-private`/`services` 内部 API 仍可能变，必须重编译 |
| major 升级（26 → 27） | 不保证向后兼容；弃用 API 会在 next major 移除；必须逐项走本流程并预留 SPI 修复时间 |
| 只升级 provider 依赖版本 | 服务端不动时，pom `keycloak.version` 仍必须与镜像 tag 一致，否则运行期类不匹配 |
| 升级前影响评估 | 只读盘点 + 官方资料审查 + 风险清单，不写代码 |

## 核心原则

- **版本单一事实来源**：`docker/Dockerfile.keycloak` 的 FROM tag == 两个 provider pom 的 `<keycloak.version>` ==（建议）frontend `keycloak-js` major。
- **自定义 SPI 是最大风险**：本项目的 provider 依赖 `keycloak-server-spi-private` 与 `keycloak-services`（内部 API），跨版本可能编译失败或运行期行为变化；升级 = 重编译 + 单测 + 真机冒烟。
- **先读官方资料**：每次升级前查目标版本的 [Upgrading Guide](https://www.keycloak.org/docs/latest/upgrading/) 与 release notes，逐条对照本项目。
- **Keycloak 不支持降级**：升级前必须备份 `keycloak`（与 `wotb`）数据库；回滚 = 旧镜像 + 数据库快照。

## 流程

### Phase 0 — 盘点现状（只读）

1. 运行 `python .agents/skills/keycloak-upgrade/scripts/check_versions.py` 列出所有版本引用并确认同步。
2. 记录：镜像 tag、两个 pom 的 `keycloak.version`、frontend `keycloak-js`（`package.json` + `package-lock.json`）、后端 admin REST 调用点、`docker/keycloak/wotbtools-realm.json`。
3. 确认目标版本与升级路径（patch/minor/major），必要时查官方 [endoflife / release info](https://endoflife.date/keycloak)。

### Phase 1 — 官方资料审查

1. 打开目标版本 release notes + Upgrading Guide，重点看 Breaking changes / Notable changes / Deprecations。
2. 逐条对照本项目：broker SPI、protocol mapper、Admin REST API、`keycloak-js`、redirect URI、token introspection、outgoing HTTP。
3. 输出「与本项目相关」的变更清单；与本次升级无关的条目记录但不处理。

### Phase 2 — 自定义 SPI 兼容性

按 [references/spi-compat.md](references/spi-compat.md) 执行：

- 两个 pom 的 `<keycloak.version>` 一起改，禁止只改一个。
- `mvn -s java/settings.xml test`（在 `keycloak-juhe-qq-provider` 与 `keycloak-wargaming-provider` 各跑一次，JAVA_HOME → JDK21）。
- 修复编译错误；特别留意 `org.keycloak.broker.provider.*`、`org.keycloak.models.*`、`org.keycloak.sessions.*` 的签名变化。
- 确认 `META-INF/services/org.keycloak.broker.provider.IdentityProviderFactory` 注册文件未丢。
- 跑现有单测（`WargamingRegionTest` / `WargamingIdentityProviderTest` / `WargamingEndpointTest` / `WargamingApiClientTest` / `KeycloakFakes`）。

### Phase 3 — 代码与配置同步

- `docker/Dockerfile.keycloak`：FROM tag 与 pom 对齐（镜像 tag 用固定版本，不用 `latest`）。
- frontend：`keycloak-js` 26.2+ 独立发版、向后兼容；major 升级时同步 `package.json` + `package-lock.json`（`npm install`）。
- 后端：`KeycloakAdminUserService` 等调用 Admin REST API 的位置，核对目标版本响应结构与弃用端点。
- realm：`wotbtools-realm.json` 字段兼容性；dev 用 `--import-realm` 启动验证，注意启动日志里的 import warning。
- 环境变量不丢：`WG_APPLICATION_ID`、`KC_*`、`KEYCLOAK_*`（生产走 GitHub Secrets → deploy.yml）。

### Phase 4 — 本地构建与冒烟

1. `docker compose build keycloak`（或全栈 `docker/online` 八服务 up），确认 `kc.sh build` 成功、两个 jar 进 `/opt/keycloak/providers`。
2. 冒烟：`/realms/wotbtools/.well-known/openid-configuration` 正常；登录页出现 QQ + 三个 Wargaming IdP 按钮；三区服登录闭环；JWT 含 `wotb_region` / `wotb_account_id` / `wotb_nickname` / `wotb_verified`。
3. 回归后端：`mvn -s settings.xml test`；前端 `npm run build`（若 keycloak-js 变化）。

### Phase 5 — 生产升级（先出计划等用户批准）

- 备份：先跑 `deploy` 的 wotb + keycloak 数据库备份，确认备份可读。
- 固定镜像 tag（SHA 或精确版本）；单实例部署先起新容器验证 health 再停旧容器。
- 升级后核对 Admin Console：三个 WG IdP 实例（alias `wargaming-asia/eu/na`、region、enabled）与 QQ IdP、4 个 protocol mapper、defaultRoles。
- 保留回滚预案（见 [references/edge-cases.md](references/edge-cases.md) 的「回滚」节）。

### Phase 6 — 收尾

- 更新 `CHANGELOG.md`、`java/README.md`、`docs/auth/*`、`frontend/src/data/versions.json`（若涉及界面/版本说明）。
- 走 `review-with-docs`（影响构建/认证/文档时）+ `review-fix` 闭环。

## 边界情况必查清单（Edge Cases）

完整清单见 [references/edge-cases.md](references/edge-cases.md)。升级前至少过一遍：

- [ ] 三处版本不同步：Dockerfile / 两个 pom / keycloak-js
- [ ] major 升级的官方支持路径与逐步升级需求
- [ ] 数据库自动迁移 + 不支持降级 + 备份/恢复脚本可用
- [ ] 重启导致内存会话丢失 → 用户需重新登录
- [ ] `--import-realm` 在新版本上的 warning/失败；生产 realm 为手工配置，IdP 实例与 mapper 需人工核对
- [ ] redirect URI 通配符收紧（26.6.3+ hostname 通配符不再接受）
- [ ] outgoing HTTP 默认不再跟随重定向（26.6.1+）对 WG/QQ API 调用是否成立
- [ ] 扩展事务约束（26.6.3+ 事务只能 start 一次）与 provider 代码
- [ ] token introspection audience 校验（26.6.2+）是否影响后端
- [ ] Identity Brokering API V1 弃用（26.7+）— 本项目 Store tokens off，不检索外部 token
- [ ] 升级窗口与回滚预案

## 资源

- `scripts/check_versions.py` — 全仓库 Keycloak 版本引用同步检查
- `references/spi-compat.md` — 两个自定义 provider 的 SPI 表面、风险 API、修复方法
- `references/edge-cases.md` — 完整边界情况清单与处置
