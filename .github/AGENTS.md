# .github/ — CI/CD workflow 指令

> 仓库级硬约定见 `.agents/AGENTS.md`。

## 现有 workflow 职责（经真实文件核对）

- `ci.yml`：每个 PR/push 门禁——4 个并行 job：Python（tankopedia 生成器单测）、Backend（wotb-core+wotb-web，JDK 21，`-s settings.xml -Dmaven.repo.local=.m2repo`）、Keycloak providers ×2（`-s ../java/settings.xml -Dmaven.repo.local=../java/.m2repo`）、Frontend（Node 24 + `npm ci` + vitest + vite build + Docker build）。
- `deploy.yml`：每次生产部署统一构建 backend/frontend/keycloak 三个 SHA 镜像 + GHCR 推送 + 部署；路径检测只用于 backend/frontend 测试门禁与 tag 计算（未变更组件对应测试 job 可 skipped，但三个镜像构建仍执行）。改动路径匹配必须同步 deploy/AGENTS.md。
- `update-tankopedia.yml`：手动触发，从 blitzkit 同步并提交 `common/tankopedia-tier{7,8,9,10}.json` 到当前分支。
- `database-backup.yml` / `prod-diagnostics.yml` / `cleanup-images.yml`：生产备份、线上诊断、镜像清理。

## 规则

- 新增/修改 workflow 前先读对应脚本真实实现；CI 命令必须与本地命令一致（settings.xml 路径、Node/JDK 版本）。
- 不把 secret 写进 workflow 文件；用 `secrets.*` / `vars.*` 或环境变量。
- 不要给 CI 塞非门禁性的重活（探针测试不进 CI，靠 Assumptions 跳过无样本场景）。
