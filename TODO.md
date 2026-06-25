# TODO

本文件记录项目构建 Java 主线的待办。最终目标有两个交付物：

1. Java 离线 exe：纯离线、双击运行、可选择/拖拽回放、预览并导出 xlsx。
2. Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、导出。

## 当前状态

- [x] Java `wotb-core` 已实现回放解析、车辆库映射、去重汇总和 POI 导出。
- [x] Java `wotb-web` 已提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/health`、`/api/shutdown`。
- [x] Vue 3 前端已有上传、预览、下载、排序、列选择、拖拽上传、文件夹选择、重复/失败提示、单场移除后二次确认与自动重新汇总。
- [x] Java 离线 exe 已实现：`build-desktop.bat` + `WotbWebApplication --desktop` 模式 + jpackage。
- [x] Spring Boot 版本已统一为 `4.1.0`（父 POM 与 Web 模块一致）。
- [x] 前端静态资源已嵌入 Spring Boot JAR（Maven 构建阶段从 `frontend/dist` 复制到 `classpath:/static/`）。
- [x] 离线 exe 便携构建：`build-desktop.ps1` 自动下载 JDK 21 / Maven / Node.js 到 `tools/`，宿主机零依赖。
- [x] Maven settings.xml 本地仓库路径改为模板 + 动态生成，不再写死。
- [x] 在线演示：https://replay.wotbtools.com

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
- [ ] Docker 部署完善。
  - [ ] 固定镜像构建流程。
  - [x] 明确端口配置（前端 `8088`，后端 `8087`，健康检查 `/api/health`）。
  - [ ] 补充生产部署注意事项。

## P1：国际化（i18n）

- [x] 前端三语（中/英/俄）：UI 文案 + 列显示名（`locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels`）。
- [ ] **地图名未接 i18n**：当前 `common/map_names.json` 只有「内部英文名（如 `lagoon`）→ 中文（海岸礁湖）」一套映射，`mapLabel()` 在任何语言下都返回中文（表里没有的图则原样显示内部英文名）。导致 en/ru 界面地图名仍是中文，且**内部名 / 中文名 / 英文名三者不统一**。
  - 方案待定：把 `map_names.json` 扩成多语言（如 `{ "lagoon": { "zh": "海岸礁湖", "en": "Lagoon", "ru": "Лагуна" } }`），`mapLabel()` 按当前 locale 取值；导出层（`MapNames.cn()`）相应改造或保持中文。需同步后端 `MapNames` 读取逻辑、`wotb-core/pom.xml` 资源、wotb-sync 配方 G。

## P1：测试与质量

- [ ] Java 单元测试覆盖更多字段边界。
- [ ] 增加 Web API 错误路径测试。
- [ ] 增加离线 exe 冒烟测试说明或脚本。
- [ ] 增加 Excel 导出结构快照测试，避免工作表/列名无意变化。

## P2：发布与文档

- [ ] 增加版本发布清单。
- [ ] 增加用户常见问题：无法解析、车辆名未知、重复上传、端口占用、导出文件打不开。

## 决策记录

- 解析与导出逻辑必须集中在 `wotb-core`，离线 exe 和 Web 版都复用它。
- 前端暂定 Vue 3，因为仓库已有 Vue/Vite 雏形。
- 离线 exe 已采用"本地 Spring Boot + 内置 Vue 静态资源 + jpackage"方案，避免维护第二套桌面 UI。
