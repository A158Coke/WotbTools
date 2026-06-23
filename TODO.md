# TODO

本文件记录项目从"Python 离线 exe"迁移到"Java 主线"的待办。最终目标有两个交付物：

1. Java 离线 exe：纯离线、无需 Python、双击运行、可选择/拖拽回放、预览并导出 xlsx。
2. Web 版：Spring Boot 4 后端，Vue 3 前端，支持浏览器上传、预览、导出。

## 当前状态

- [x] Python 版可解析 `.wotbreplay` 并导出单场 / 多场 xlsx。
- [x] Python 版已有 Tkinter GUI 和 PyInstaller exe 构建脚本。
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

- [ ] 给 `wotb-core` 增加更明确的 parity 测试说明：哪些字段必须与 Python 输出一致。
- [x] 车辆库同步：已统一为单一来源 `common/tankopedia.json`，`wotb-core` 构建时自动复制到 classpath，`update_tankopedia.py` 直接写 common，两侧不再各存一份。

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

## P1：测试与质量

- [ ] Java 单元测试覆盖更多字段边界。
- [ ] 增加 Web API 错误路径测试。
- [ ] 增加离线 exe 冒烟测试说明或脚本。
- [ ] 增加 Excel 导出结构快照测试，避免工作表/列名无意变化。

## P2：Python 历史版处理

- [ ] 明确 Python 版定位：历史可用版本 / 行为参照 / 紧急 fallback。
- [ ] 除 bugfix 外，新功能优先进入 Java 主线。
- [ ] 视情况保留或归档 Python PyInstaller 构建脚本。

## P2：发布与文档

- [ ] 增加版本发布清单。
- [ ] 增加用户常见问题：无法解析、车辆名未知、重复上传、端口占用、导出文件打不开。

## 决策记录

- 解析与导出逻辑必须集中在 `wotb-core`，离线 exe 和 Web 版都复用它。
- 前端暂定 Vue 3，因为仓库已有 Vue/Vite 雏形。
- 离线 exe 已采用"本地 Spring Boot + 内置 Vue 静态资源 + jpackage"方案，避免维护第二套桌面 UI。
- Python 版不再作为新功能主线，但短期仍保留用于对照和回归。
