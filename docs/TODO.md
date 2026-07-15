# TODO

本文件记录项目待办。最终交付 Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、导出，Keycloak 认证。

## 当前状态

- [x] Java `wotb-core` 已实现回放解析、车辆库映射、去重汇总和 POI 导出。
- [x] Java `wotb-web` 已提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/rating`、`/api/health`。
- [x] Vue 3 前端已有上传、预览、下载、排序、列选择、拖拽上传、文件夹选择、重复/失败提示、单场移除后二次确认与自动重新汇总。
- [x] Spring Boot 版本已统一为 `4.1.0`（父 POM 与 Web 模块一致）。
- [x] 前端静态资源已嵌入 Spring Boot JAR（Maven 构建阶段从 `frontend/dist` 复制到 `classpath:/static/`）。
- [x] Maven `settings.xml` 已改为仓库跟踪的可移植配置，使用 `${user.dir}/.m2repo`，干净 clone 可直接执行。
- [x] 在线演示：https://wotbtools.com
- [x] 赞助入口恢复，二维码改为 VPS 运行时配置和只读挂载，不进入仓库/镜像。
- [x] Keycloak 容器部署 + realm 配置 + 前端 check-sso 认证集成。

- [x] 排行榜支持按车辆筛选（点击车辆名查看专属伤害榜）。
- [x] 排行榜新增 version（回放游戏版本号）和 battle_time（战斗实际发生时间）列。

## P0：Java 主线完善

- [x] `ParityTest` / `PotentialDamageTest` 已移入 Maven 标准测试目录，并覆盖字段不变量与导出一致性。
- [x] ZIP/pickle/protobuf 已增加压缩、解压、长度、栈、opcode、字段数与截断输入的安全预算和恶意输入测试。
- [x] 车辆库同步：已统一为单一来源 `common/tankopedia.json`，`wotb-core` 构建时自动复制到 classpath。
- [x] **存活时间(survivalTimeSec)推算已改善。** 新增 Damage 层 fallback（Type 8 sub=3事件，优先于 EntityLeave/Position）：
  - 3 层 fallback：deathTimeMillis → Damage (sub=3 累计) → hybrid EntityLeave/Position
  - 解决 EntityLeave 假阳性（临时离场）和 Position 在部分模式实体不停止的问题
  - 已知局限：sub=3 可能不覆盖全部受伤（火烧/撞击伤害走不同 subtype）

## P1：Web 版完善

- [ ] 完善上传体验。
  - [x] 支持文件夹/多文件批量上传（`webkitdirectory` + 多选 + 拖拽）。
  - [x] 清晰展示重复文件和解析失败文件。
  - [x] 增加单文件/文件数/请求总量与并发限制，并用三语错误码提示。
- [ ] 完善预览表格。
  - [x] 列选择持久化（localStorage）。
  - [ ] 大批量回放时保持可用性能（虚拟滚动或分页）。
- [ ] 完善导出体验。
  - [x] 单场和多场文件名策略（单场沿用源文件名，多场 `联赛汇总.xlsx`，逐场 `逐场导出.zip`）。
  - [x] 下载失败时按稳定英文错误码展示前端三语文案，不回显后端异常文本。
- [x] Docker 部署完善。
  - [x] 固定三镜像构建流程（backend + frontend + keycloak，各推送 SHA 与 `latest`，共六个标签）。
  - [x] 明确端口配置（前端暴露 `8088:80`，后端内部 `8087`，postgres 内部 `5432`）。
  - [x] 补充生产部署、双库备份与手动恢复注意事项。

## P1：国际化（i18n）

- [x] 前端三语（中/英/俄）：UI 文案 + 列显示名（`locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels`）。
- [x] **地图名接入 i18n**：`common/map_names.json` 已扩成 `{ zh, en, ru }` 三语结构，`mapLabel()` 按当前 locale 渲染网页，导出层 `MapNames.cn()` 继续固定中文。

## P1：用户认证

- [x] Keycloak 容器部署。详见 [docs/auth/keycloak-qq-only.md](auth/keycloak-qq-only.md)
  - [x] `auth.wotbtools.com` Keycloak 部署（外层 Caddy → KC 8080）
  - [x] realm `wotbtools` + client `wotbtools-web` 导入
  - [x] 前端 `useAuth.js` — Keycloak 适配器（check-sso 游客模式 + 登录/登出）
  - [x] QQ IdP 接入
  - [x] Spring Security Resource Server JWT 验证与 realm role 提取
  - [x] `user_profile` 表 + `GET /api/users/profile`
  - [x] `user_profile` 内 WoTB 账号绑定字段 + 绑定 API（account_id）
  - [x] 前端 QQ 登录/退出/当前用户 + Blitz 绑定 UI

## P1：运维与 CI/CD

- [x] **拆分部署 Workflow**：不再每次部署都构建全端（前端/后端/Keycloak）。改为：
  - [x] 前端变动 → 只构建前端镜像并推送 GHCR
  - [x] 后端变动 → 只构建后端镜像并推送 GHCR
  - [x] Keycloak 变动 → 只构建 Keycloak 镜像并推送 GHCR
  - [x] 全端变更 → 并行构建 + 统一 docker compose pull + restart
- [x] 后端 Maven、前端 Vitest/Vite 构建成为镜像构建前置门禁。
- [x] 增量检测使用完整 push range，并覆盖 `rating.json`、`map_names.json`、公共资源与部署脚本。
- [x] 生产 `wotb` + `keycloak` 双库部署前/每日备份、7 日保留、校验与手动恢复闭环。
- [ ] 优化 deploy.yml，利用 GHCR 标签判断增量构建。

## P1：打手视角订单系统

- [x] **打手个人订单面板**：登录用户若为打手（`booster` role），可在个人中心查看与自己相关的订单。
  - [x] 后端：根据 `keycloak_user_id` 查 `booster_profile`，再查 `boost_request_assignment` 获取活跃/历史分配
  - [x] 后端 API：`GET /api/booster/assignments`（默认活跃；`includeHistory=true` 返回活跃 + 历史）
  - [x] 前端 Profile 页面：显示当前活跃订单（需求名称、状态、匹配时间）和历史订单
  - [x] 订单状态变更通知（需求更新、新的匹配提醒）
- [x] **打手自助接单状态**：个人中心可直接暂停/恢复接收新订单，复用 `booster_profile.available`，不影响已有进行中订单。

## P1：测试与质量

- [x] Java 单元测试覆盖 parser 资源预算、Keycloak role 补偿、权限和上传边界。
- [x] 增加 Web API 错误码、503 容量、raw enum 与 DTO 去本地化契约测试。
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
