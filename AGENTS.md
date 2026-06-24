# AGENTS.md — 给 AI coder 的硬性约定

本文件是任何 AI/自动化在本仓库工作的**入口**。先读这里,深入背景见 [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)。

项目:从 WoT Blitz `.wotbreplay` 提取战斗数据导出 Excel。`java/`(主线:`wotb-core` 共享核心 + `wotb-web` Spring Boot + `frontend` Vue;`offline/` jpackage、`online/` docker)、`common/`(共享 tankopedia/图标/样本)、`python/`(车辆库更新脚本)。CI/CD: `.github/workflows/deploy.yml` push main 触发,构建根 `Dockerfile` 单镜像 → Docker Hub(`a158coke/wotbtool`) → SSH 部署 VPS(`/opt/wotb`)。

## 硬性规则(RULES)

1. **改动即更新文档。** 任何影响"界面 / 导出 / 数据 / 构建 / 用法"的改动,必须在同一次提交里更新 [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) 及相关 README([根](README.md) / [java](java/README.md))。
2. **跨层一致性。** 列的 `key`(snake_case)在 **API / 前端 / 导出** 三方一致;显示名在 **前端三语 locale(`java/frontend/src/locales/{zh,en,ru}.json` 的 `player_labels`/`agg_labels`)+ 导出两处(`Columns.java`、`AggregateSheets` 汇总列)** 一致。
3. **API 纯英文。** `/api/columns` 和 DTO 只回 `key`+数据,**不得**把中文塞回 API。中文是前端/导出层各自的事。
4. **提交前必须通过测试。**
   - Java:`cd java && mvn -s settings.xml test`(需 `JAVA_HOME` 指向 JDK 21)
   - 改了前端:`cd java/frontend && npm run build`
5. **构建隔离(个人项目,勿碰公司基建)。** Maven 一律 `-s java/settings.xml`(Aliyun 镜像 + 独立 `java/.m2repo`);**系统默认 `java` 是 JDK 8,跑 mvn 必须先设 `JAVA_HOME` 指向 JDK 21**(`%USERPROFILE%\.jdks\jdk-21.0.1`)。车辆库单一来源在 `common/tankopedia.json`,勿在模块内放副本。
6. **Git。** 个人仓库,SSH remote `github-personal` 以账号 `A158Coke` 推送,**不使用**任何公司 token。提交信息中文、结尾带 `Co-Authored-By`。

> 复杂或多文件联动的改动,先看**工具无关的改动检查单** [.agents/wotb-sync.md](.agents/wotb-sync.md)(任何 AI/人都可读)。Claude Code 用户也可调用同名技能 `.claude/skills/wotb-sync/`(它只是指向那份)。

## 常用命令(均从仓库根)

```bash
# Java 测试 / 打包(JDK21)
cd java && JAVA_HOME=<jdk21> mvn -s settings.xml test

# 前端构建
cd java/frontend && npm run build
# 离线 exe / 在线容器
cd java/offline && build-desktop.bat
cd java/online && docker compose up --build
# 根 Dockerfile 单镜像构建(CI/CD)
docker build -f Dockerfile -t a158coke/wotbtool:test .
```

## 不要做

- 不要在 `target/`、`node_modules/`、`dist/`、`dist-desktop/`、`.m2repo/` 里改源码。
- 不要根据终端乱码判定文件损坏;按 UTF-8 读取。

