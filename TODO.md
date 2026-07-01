# TODO

本文件记录项目待办。最终交付 Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、导出，Keycloak 认证。

## 当前状态

- [x] Java `wotb-core` 已实现回放解析、车辆库映射、去重汇总和 POI 导出。
- [x] Java `wotb-web` 已提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/health`、`/api/shutdown`。
- [x] Vue 3 前端已有上传、预览、下载、排序、列选择、拖拽上传、文件夹选择、重复/失败提示、单场移除后二次确认与自动重新汇总。
- [x] Spring Boot 版本已统一为 `4.1.0`（父 POM 与 Web 模块一致）。
- [x] 前端静态资源已嵌入 Spring Boot JAR（Maven 构建阶段从 `frontend/dist` 复制到 `classpath:/static/`）。
- [x] Maven settings.xml 本地仓库路径改为模板 + 动态生成，不再写死。
- [x] 在线演示：https://wotbtools.com
- [x] Keycloak 容器部署 + realm 配置 + 前端 check-sso 认证集成。

- [x] 排行榜支持按车辆筛选（点击车辆名查看专属伤害榜）。
- [x] 排行榜新增 version（回放游戏版本号）和 battle_time（战斗实际发生时间）列。

## P0：Java 主线完善

- [ ] 给 `wotb-core` 增加更明确的 parity 测试说明：字段不变量与导出格式一致性。
- [x] 车辆库同步：已统一为单一来源 `common/tankopedia.json`，`wotb-core` 构建时自动复制到 classpath。
- [x] **存活时间(survivalTimeSec)推算已改善。** 新增 Damage 层 fallback（Type 8 sub=3事件，优先于 EntityLeave/Position）：
  - 3 层 fallback：deathTimeMillis → Damage (sub=3 累计) → hybrid EntityLeave/Position
  - 解决 EntityLeave 假阳性（临时离场）和 Position 在部分模式实体不停止的问题
  - 已知局限：sub=3 可能不覆盖全部受伤（火烧/撞击伤害走不同 subtype）

## P1：Web 版完善

- [ ] 完善上传体验。
  - [x] 支持文件夹/多文件批量上传（`webkitdirectory` + 多选 + 拖拽）。
  - [x] 清晰展示重复文件和解析失败文件。
- [ ] 完善预览表格。
  - [ ] 列选择持久化（localStorage）。
  - [ ] 大批量回放时保持可用性能（虚拟滚动或分页）。
- [ ] 完善导出体验。
  - [x] 单场和多场文件名策略（单场沿用源文件名，多场 `联赛汇总.xlsx`，逐场 `逐场导出.zip`）。
  - [x] 下载失败时展示后端错误（前端显示 HTTP 错误信息）。
- [x] Docker 部署完善。
  - [x] 固定镜像构建流程（双镜像 `Dockerfile.backend` + `Dockerfile.frontend`，CI/CD 四标签推送）。
  - [x] 明确端口配置（前端暴露 `8088:80`，后端内部 `8087`，postgres 内部 `5432`）。
  - [ ] 补充生产部署注意事项。

## P1：国际化（i18n）

- [x] 前端三语（中/英/俄）：UI 文案 + 列显示名（`locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels`）。
- [ ] **地图名未接 i18n**：当前 `common/map_names.json` 只有「内部英文名（如 `lagoon`）→ 中文（海岸礁湖）」一套映射，`mapLabel()` 在任何语言下都返回中文（表里没有的图则原样显示内部英文名）。导致 en/ru 界面地图名仍是中文，且**内部名 / 中文名 / 英文名三者不统一**。
  - 方案待定：把 `map_names.json` 扩成多语言（如 `{ "lagoon": { "zh": "海岸礁湖", "en": "Lagoon", "ru": "Лагуна" } }`），`mapLabel()` 按当前 locale 取值；导出层（`MapNames.cn()`）相应改造或保持中文。需同步后端 `MapNames` 读取逻辑、`wotb-core/pom.xml` 资源、wotb-sync 配方 G。

## P1：用户认证

- [x] Keycloak 容器部署。详见 [docs/auth/keycloak-qq-only.md](docs/auth/keycloak-qq-only.md)
  - [x] `auth.wotbtools.com` Keycloak 部署（外层 Caddy → KC 8080）
  - [x] realm `wotbtools` + client `wotbtools-web` 导入
  - [x] 前端 `useAuth.js` — Keycloak 适配器（check-sso 游客模式 + 登录/登出）
  - [x] QQ IdP 接入
  - [ ] Spring Security Resource Server JWT 验证
  - [x] `user_profile` 表 + `GET /api/profile`
  - [x] `blitz_account_binding` 表 + 绑定 API（account_id）
  - [x] 前端 QQ 登录/退出/当前用户 + Blitz 绑定 UI

## P1：运维与 CI/CD

- [ ] **拆分部署 Workflow**：不再每次部署都构建全端（前端/后端/Keycloak）。改为：
  - [ ] 前端变动 → 只构建前端镜像并推送 GHCR
  - [ ] 后端变动 → 只构建后端镜像并推送 GHCR
  - [ ] Keycloak 变动 → 只构建 Keycloak 镜像并推送 GHCR
  - [ ] 全端变更 → 并行构建 + 统一 docker compose pull + restart
- [ ] 优化 deploy.yml，利用 GHCR 标签判断增量构建。

## P1：打手视角订单系统

- [ ] **打手个人订单面板**：登录用户若为打手（`booster` role），可在个人中心查看与自己相关的订单。
  - [ ] 后端：根据 `keycloak_user_id` 查 `booster_profile`，再查 `boost_request_assignment` 获取活跃/历史分配
  - [ ] 后端 API：`GET /api/booster/assignments`（打手视角，仅返回自己的订单）
  - [ ] 前端 Profile 页面：显示当前活跃订单（需求名称、状态、匹配时间）和历史订单
  - [ ] 订单状态变更通知（需求更新、新的匹配提醒）

## P1：测试与质量

- [ ] Java 单元测试覆盖更多字段边界。
- [ ] 增加 Web API 错误路径测试。
- [ ] 增加 Excel 导出结构快照测试，避免工作表/列名无意变化。

## P2：发布与文档

- [ ] 增加版本发布清单。
- [ ] 增加用户常见问题：无法解析、车辆名未知、重复上传、端口占用、导出文件打不开。

## P2：战术地图

- [ ] 获取 WoT Blitz 鸟瞰视角地图，允许玩家以此编辑创建战术图
  - [ ] 研究地图数据来源（游戏提取 / 截图拼接 / 社区资源）
  - [ ] 画布编辑器：箭头、标记、文字标注
  - [ ] 导出/分享战术图

## 决策记录

- 解析与导出逻辑必须集中在 `wotb-core`。
- 前端 Vue 3，Vite 构建。
- Web 版通过 Docker 镜像部署，CI/CD 自动构建推送。
