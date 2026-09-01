# .github/ — CI/CD workflow 指令

> 仓库级硬约定见 `.agents/AGENTS.md`。

## 现有 workflow 职责（经真实文件核对）

- `ci.yml`：**仓库级 authoritative full-validation gate（merge gate）**——PR 分支上跑全部测试与构建：Python（tankopedia 生成器/快照契约单测）、Backend（wotb-core+wotb-web 全量 `mvn test`，JDK 21，`-s settings.xml -Dmaven.repo.local=.m2repo`）、Keycloak providers ×2（`-s ../java/settings.xml -Dmaven.repo.local=../java/.m2repo`）、Frontend（Node 24 + `npm ci` + vitest + vite build + bundle separation + Docker build）、Android debug build、Observability config validation（compose/promtool/loki/alloy/grafana/no-host-port）、Deploy/rollback & nginx smoke（含 Flyway immutability guard）。Agent 不重复执行这些 full validation。
- `ci.yml` 的 `http-contract` job：独立执行 OpenAPI parse/ref、FE generated drift、生产形状 fixture、Ajv runtime test 及 Playback 相关后端 serialization/projector tests；它是快速合同门禁，不替代仓库级 full-validation job。
- `deploy.yml`：每次生产部署统一构建 backend/frontend/keycloak 三个 SHA 镜像 + GHCR 推送 + 部署；**不运行 backend/frontend/integration 测试套件**（测试与 merge 验证由 PR CI 承担）。只负责生产构建、镜像推送、配置校验、部署、健康检查、smoke 与回滚安全。
- `update-tankopedia.yml`：手动触发，从 blitzkit 同步并提交 `common/tankopedia-tier{7,8,9,10}.json` 到当前分支。
- `database-backup.yml` / `prod-diagnostics.yml` / `cleanup-images.yml`：生产备份、线上诊断、镜像清理。

## 规则

- 新增/修改 workflow 前先读对应脚本真实实现；CI 命令必须与本地命令一致（settings.xml 路径、Node/JDK 版本）。
- 不把 secret 写进 workflow 文件；用 `secrets.*` / `vars.*` 或环境变量。
- 不要给 CI 塞非门禁性的重活（探针测试不进 CI，靠 Assumptions 跳过无样本场景）。
- **职责分层**：Agent = fast feedback + targeted correctness + affected regression；PR CI = authoritative full validation（唯一 full-test gate）；Deploy = production verification。Deploy 不重复跑测试套件；CI 覆盖不因 Agent 提速被削弱。
