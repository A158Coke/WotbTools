# TODO

本文件记录项目从“Python 离线 exe”迁移到“Java 主线”的待办。最终目标有两个交付物：

1. Java 离线 exe：纯离线、无需 Python、双击运行、可选择/拖拽回放、预览并导出 xlsx。
2. Web 版：Spring Boot 4 后端，前端暂定 Vue 3，支持浏览器上传、预览、导出。

## 当前状态

- [x] Python 版可解析 `.wotbreplay` 并导出单场 / 多场 xlsx。
- [x] Python 版已有 Tkinter GUI 和 PyInstaller exe 构建脚本。
- [x] Java `wotb-core` 已实现回放解析、车辆库映射、去重汇总和 POI 导出。
- [x] Java `wotb-web` 已提供 `/api/preview`、`/api/export`、`/api/columns`、`/api/health`。
- [x] Vue 3 前端已有上传、预览和下载雏形。
- [ ] Java 离线 exe 尚未实现。
- [ ] Spring Boot 版本声明尚未统一。
- [ ] Web 版和离线 exe 的最终打包流程尚未固定。

## P0：收敛 Java 主线

- [ ] 统一 Maven 中的 Spring Boot 版本声明，目标按 Spring Boot 4 维护。
- [ ] 明确 JDK 基线，当前建议保持 Java 21。
- [ ] 确认 `wotb-core/src/main/resources/tankopedia.json` 与根目录 `tankopedia.json` 同步策略。
- [ ] 给 `wotb-core` 增加更明确的 parity 测试说明：哪些字段必须与 Python 输出一致。
- [ ] 清理或标注生成物目录，避免后续维护者误改 `target/`、`dist/`、`node_modules/`。

## P0：Java 离线 exe

- [ ] 选定离线 UI 路线。
  - 推荐：复用 Vue 前端，本地启动 Spring Boot，浏览器打开本地页面。
  - 备选：JavaFX/Swing 原生 UI，但会新增一套 UI 维护成本。
- [ ] 新增离线启动入口。
  - [ ] 启动本地 Spring Boot 服务。
  - [ ] 选择可用端口或处理 `8087` 被占用。
  - [ ] 自动打开默认浏览器。
  - [ ] 程序退出时优雅关闭服务。
- [ ] 将 Vue 构建产物打入 Spring Boot 静态资源。
  - [ ] 确定复制路径，例如 `wotb-web/src/main/resources/static/` 或 Maven 构建阶段生成目录。
  - [ ] 确认 API 与静态页面同源可用。
- [ ] 新增 jpackage 构建脚本。
  - [ ] 打包 JRE runtime。
  - [ ] 设置应用图标。
  - [ ] 输出 Windows exe 或安装包。
  - [ ] 产物命名与版本号规则。
- [ ] 离线验证。
  - [ ] 无 Python 环境可运行。
  - [ ] 无外部 JDK 可运行。
  - [ ] 无网络可解析示例回放并导出 xlsx。
  - [ ] 重复打开、端口占用、异常退出后再次启动正常。

## P1：Web 版完善

- [ ] 明确前端技术栈最终选择；当前暂定 Vue 3。
- [ ] 完善上传体验。
  - [ ] 支持拖拽上传。
  - [ ] 支持文件夹/多文件批量上传。
  - [ ] 清晰展示重复文件和解析失败文件。
- [ ] 完善预览表格。
  - [ ] 列选择持久化。
  - [ ] 数字列排序准确。
  - [ ] 大批量回放时保持可用性能。
- [ ] 完善导出体验。
  - [ ] 单场和多场文件名策略。
  - [ ] 下载失败时展示后端错误。
- [ ] Docker 部署完善。
  - [ ] 固定镜像构建流程。
  - [ ] 明确端口配置。
  - [ ] 补充生产部署注意事项。

## P1：测试与质量

- [ ] Java 单元测试覆盖更多字段边界。
- [ ] 增加 Web API 错误路径测试。
- [ ] 增加前端构建检查。
- [ ] 增加离线 exe 冒烟测试说明或脚本。
- [ ] 增加 Excel 导出结构快照测试，避免工作表/列名无意变化。

## P2：Python 历史版处理

- [ ] 明确 Python 版定位：历史可用版本 / 行为参照 / 紧急 fallback。
- [ ] 除 bugfix 外，新功能优先进入 Java 主线。
- [ ] 当 Java 离线 exe 达到可用后，更新 README，降低 Python exe 的默认推荐级别。
- [ ] 视情况保留或归档 Python PyInstaller 构建脚本。

## P2：发布与文档

- [ ] 增加 Java 离线 exe 构建文档。
- [ ] 增加 Web 版部署文档。
- [ ] 增加版本发布清单。
- [ ] 增加用户常见问题：无法解析、车辆名未知、重复上传、端口占用、导出文件打不开。

## 决策记录

- 解析与导出逻辑必须集中在 `wotb-core`，离线 exe 和 Web 版都复用它。
- 前端暂定 Vue 3，因为仓库已有 Vue/Vite 雏形。
- 离线 exe 推荐采用“本地 Spring Boot + 内置 Vue 静态资源 + jpackage”，避免维护第二套桌面 UI。
- Python 版不再作为新功能主线，但短期仍保留用于对照和回归。
