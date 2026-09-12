# Contribution Map

> 想接功能、改接口、补体验时，先用这张地图判断入口归属。具体代码仍以当前实现和各目录 `AGENTS.md` 为准。

## Start before coding

| 入口 | 用途 |
|---|---|
| `../../.agents/AGENTS.md` | 仓库级接手方法、计划/验证/文档同步规则 |
| `../DEVELOPER_GUIDE.md` | 环境、模块、构建、运行方式总入口 |
| `../../contracts/AGENTS.md` | HTTP 契约、生成代码、fixture 与 schema drift 规则 |
| `../../java/AGENTS.md` | 后端分层、测试、Flyway、HTTP contract 规则 |
| `../../frontend/AGENTS.md` | Vue 路由、API、状态、i18n、UI 验证规则 |

## New feature entry points

| 你要做什么 | 先看哪里 | 常见落点 |
|---|---|---|
| 新增或修改 HTTP 接口 | `../../contracts/http/openapi.yaml` | 后端 `../../java/wotb-web/.../controller`、`service`、`dto`、`mapper`；前端 `../../frontend/src/api/` 或生成的 `../../frontend/src/api/generated/` |
| 调整 API path / security | `../../java/wotb-web/src/main/java/com/wotb/web/config/ApiPaths.java` | `SecurityConfig`、Controller、`ApiException` / `ApiErrorCode`、`../api/error-contract.md` |
| 新增数据库字段或表 | 目标 domain 的 `entity` / `repository` | `../../java/wotb-web/src/main/resources/db/migration` 新增 Flyway migration；不要改历史 migration |
| 新增 Replay 派生指标或导出列 | `../../java/wotb-core/src/main/java/com/wotb/core/...` | `wotb-replay-processing`、`wotb-result`、`wotb-playback`、相关 fixture / golden output |
| 新增 Replay Workspace 能力 | `../frontend/replay-workspace.md` | `../../frontend/src/composables/useReplay*.ts`、`../../frontend/src/api/replay*.ts`、Replay 相关页面组件 |
| 改名人堂 / Hundred / Mark3 | 对应 `../features/*.md` | `../../java/wotb-web/src/main/java/com/wotb/web/hof`、`hundred`、`mark3`，以及前端对应页面 |
| 改登录、用户档案、WG 账号绑定 | `../auth/*.md` | `../../java/wotb-web/src/main/java/com/wotb/web/user`、Keycloak 配置、`../../frontend/src/composables/useAuth.js` |
| 新增前端页面或视图 | `../frontend/architecture.md` | `../../frontend/src/app/router.js`、`../../frontend/src/components/*Page.vue`、`../../frontend/src/locales/*.json` |
| 新增静态数据或资源 | `../architecture/tankopedia-reference-data.md` 或相关 assets 文档 | `../../common/`、`../../frontend/public/`、`../assets/...`；避免多处手写同一份映射 |

## Backend map

后端优先按 domain 找包：`user`、`hof`、`replay`、`boost`、`admin`、`hundred`、`mark3`。典型路径是 Controller 接 HTTP、Service 放业务编排、Repository 管持久化、Mapper 管 DTO 转换。

Replay 相关功能要先区分“确定性事实”和“产品编排”：确定性解析、统计、导出优先落在 `../../java/wotb-core`；异步处理、派生产物和任务生命周期再进入 `wotb-replay-processing`、`wotb-replay-coordinator`、`wotb-playback`、`wotb-ai`、`wotb-result` 或 `wotb-web`。

## Frontend map

前端页面入口从 `../../frontend/src/app/router.js` 和 `../../frontend/src/components/*Page.vue` 开始。共享状态与业务组合逻辑优先放 `../../frontend/src/composables/`，接口边界放 `../../frontend/src/api/` 或现有 `../../frontend/src/utils/api*.js`，多语言文本同步维护 `../../frontend/src/locales/zh.json`、`en.json`、`ru.json` 和 `feature-messages.json`。

生成代码目录 `../../frontend/src/api/generated/` 不手工编辑；OpenAPI 变更后通过契约生成流程刷新。

## Verification map

| 改动类型 | 最小验证 |
|---|---|
| HTTP contract | `npm run api:lint`、`npm run api:generate`、`npm run api:check`、`npm run api:fixture` |
| Java domain / service | 在 `java/` 下跑目标模块或目标测试；需要 Maven settings 时使用 `-s java/settings.xml` |
| Frontend route / component / API | 跑相关前端测试、typecheck 或 build；涉及页面布局时补浏览器检查 |
| Replay parser / playback / derived data | 跑对应 golden / fixture / pixel 或数据一致性检查，确认没有 schema drift |
| Docs only | 链接存在性、`git diff --check`；必要时说明未跑业务测试 |
