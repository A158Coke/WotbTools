# 边界情况清单（Edge Cases）

升级前按编号过一遍，命中则执行处置；未命中记录「不适用」。

## 1. 版本不同步（最高频）

- 症状：Dockerfile FROM tag、两个 pom `keycloak.version`、frontend `keycloak-js` 三者不一致。
- 处置：运行 `scripts/check_versions.py`；以镜像 tag 为目标，两个 pom 必须一起改；
  major 变化时同步 `keycloak-js`（26.2+ 独立发版，向后兼容所有受支持的服务器版本，但建议匹配）。

## 2. 升级路径与跨版本

- 官方文档：升级顺序 = 查 migration changes → 升服务器 → 升适配器/客户端库。
- 26.0+ 起 minor 内对 fully supported API 保证向后兼容；**弃用 API 只会在 next major 移除**。
- 跨多个 major 时数据库 Liquibase 迁移可能失败或损坏数据；若官方要求或数据复杂，按 major 逐步升级，
  每步启动一次让迁移完成并验证。
- 处置：先确认目标版本相对当前版本的距离，必要时给出多步升级计划。

## 3. 数据库：自动迁移、不支持降级

- Keycloak 启动时自动跑 Liquibase 迁移（`keycloak` 库）。
- **不支持降级**：一旦新版本写过库，旧镜像无法再起。
- 处置：升级前跑项目备份脚本（wotb + keycloak 各一份，含 catalog 校验）；
  记录备份路径；回滚 = 恢复数据库快照 + 旧镜像。恢复流程见 `deploy/postgres-restore.sh`。

## 4. 会话丢失

- Keycloak 重启默认清内存会话（默认存储不持久化 session），升级即全员掉线。
- 处置：提前在版本说明/公告中声明；升级窗口选低峰；验证升级后新登录正常。

## 5. Realm 导入与生产手工配置

- dev 用 `--import-realm` 导入 `docker/keycloak/wotbtools-realm.json`；新版本字段/默认值变化会产生
  import warning 或覆盖差异，看启动日志。
- 生产 realm 是 Admin Console 手工维护（决定 D18）：WG IdP 不在 realm JSON 里。
- 处置：升级后逐项核对——三个 WG IdP（alias `wargaming-asia/eu/na`、region、enabled、Sync mode FORCE、
  回调 URL）、QQ IdP（`juhe-qq`）、`wotbtools-web` client 的 4 个 protocol mapper、defaultRoles
  `wotbtools-user`。任何一项缺失 = 登录/claims 回归，先补配置再宣布完成。

## 6. Redirect URI 通配符（26.6.3+ 收紧）

- 26.6.3 起 hostname 不再接受 `https://example.com*` 式通配符（会被当作 path 通配符 `https://example.com/*`）；
  `https://*` 全通配仍接受。
- 本项目 realm JSON 使用 `https://*.wotbtools.com/*`（subdomain 通配在 host 部分）与 `https://wotbtools.com/*`。
  - `https://*.wotbtools.com/*` 属 hostname 通配——需在目标版本确认仍被接受（26.6.x 保留 `https://*`，
    但子域通配规则要实测）；如被拒，改用精确列表。
- 处置：升级后跑一次前端登录 + 回调，确认无 redirect_uri 报错。

## 7. Outgoing HTTP 不再跟随重定向（26.6.1+）

- 26.6.1 起 Keycloak 发出的 HTTP 默认不跟随 3xx；`Location` 不再自动抓取。
- 本项目 provider 用自己的 `java.net.http.HttpClient` 调外部 API，不走 Keycloak 的 HTTP client；
  但若未来改用 Keycloak 工具类，需显式处理重定向。
- 处置：确认 WG/QQ 的 token/用户信息接口不会返回 3xx（正常 OAuth 不会）；回归登录一次即可。

## 8. 扩展事务约束（26.6.3+）

- 26.6.3 起一个 session 事务只能 start 一次，重复 start 会报错。
- 本项目 provider 不显式管理事务，风险低；升级后在日志中搜 `transaction` 相关 error。

## 9. Token introspection / UserInfo 收紧（26.6.2+）

- 26.6.2 起 introspection 校验 audience；UserInfo 拒绝 lightweight access token。
- 本项目后端用 Spring Security Resource Server 直接验 JWT（issuer-uri），不走 introspection endpoint；
  keycloak-js 使用完整 access token。预期无影响，升级后冒烟验证 `/api/me` 仍返回 200。

## 10. Identity Brokering API V1 弃用（26.7+）

- 26.7.0 起新增 V2（默认关），V1 弃用但仍默认开。
- 本项目 IdP 配置 Store tokens off，不检索外部 token，不依赖该 API。
- 处置：记录该弃用，未来启用外部 token 检索时必须用 V2。

## 11. 环境变量与密钥

- 升级不得丢 `WG_APPLICATION_ID`（生产在 GitHub Secrets → deploy.yml → keycloak service env；
  本地在 `docker/online/.env`）。缺失时 WG 登录返回 "Wargaming login not configured"。
- realm keys 存在 DB，升级后旧 access token 在过期前仍有效（issuer 与签名不变）；
  不要重建 realm、不要手动轮换 keys，除非另行计划。
- 不要在日志/Caddy 访问日志中暴露回调 URL 的 `access_token`（已知 WG 回调会把 token 带在地址栏）。

## 12. 构建与镜像

- `kc.sh build` 必须重新执行（provider 已打进镜像层，由 Dockerfile 的 `RUN kc.sh build` 保证）。
- 镜像 tag 固定版本/SHA，禁止 `latest`；quay.io 拉取在 CI/部署环境需可达。
- CI 中 provider 测试用 `java/settings.xml`（Aliyun + 独立 `.m2repo`），本地一致，避免网络/仓库差异。

## 13. 升级窗口与回滚

- minor/major 需要停机升级（patch 同流可滚动）；单实例部署 = 先备份 → 起新容器 → 验证 health →
  确认无问题后再视为完成。
- 回滚预案（写进升级计划）：`keycloak` 与 `wotb` 库快照恢复 + 旧镜像 tag；回滚后必须重新验证登录，
  因为数据库恢复可能带回旧 schema 而业务表有新数据（按项目备份脚本的 catalog 校验确认一致性）。
