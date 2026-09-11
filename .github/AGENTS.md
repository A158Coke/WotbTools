# .github/ — CI/CD workflow 指令

> 仓库级硬约定见 `.agents/AGENTS.md`。

## 现有 workflow 职责

- `ci.yml`：仓库级 authoritative full-validation gate（PR merge gate），覆盖 Python、Backend、Keycloak providers/runtime、Frontend、Android、HTTP contract、Observability 与 Deploy smoke。
- `build.yml`：main push 或手工选择目标时，从冻结触发 SHA 只构建受影响 backend/frontend/keycloak 镜像，发布 immutable `sha-<short>` tag，并上传 authoritative `deployment-manifest`。docs-only push 仍产出 no-op manifest；不运行测试套件。
- `deploy.yml`：成功 Build `workflow_run` 自动接力，也支持手工选择任意 production Compose service；自动路径只下载并校验对应 manifest，checkout 精确 source SHA，按 manifest 发布，不重新计算 diff、不构建、不跑测试。应用服务/all 必须使用 manifest 指定的 immutable image tag；run-number stale guard fail-closed。
- `android-release.yml`：版本来自 committed `android/gradle.properties`，Native Bridge 协议来自 `contracts/android-native-bridge.json`；workflow 不接受手工版本输入。Android Contract CI 校验 Gradle/Native/FE/manifest 一致、runtime 改动递增版本、breaking bridge 改动递增 bridgeVersion。
- `update-tankopedia.yml`：手动触发，从 blitzkit 同步并提交 `common/tankopedia-tier{7,8,9,10}.json` 到当前分支。
- `database-backup.yml` / `prod-diagnostics.yml` / `cleanup-images.yml`：生产备份、线上诊断、镜像清理。

## 规则

- 新增/修改 workflow 前先读对应脚本真实实现；CI 命令必须与本地命令一致（settings.xml 路径、Node/JDK 版本）。
- 不把 secret 写进 workflow 文件；用 `secrets.*` / `vars.*` 或环境变量。
- 不要给 CI 塞非门禁性的重活；Deploy 不重复跑测试套件。
- 职责分层：Agent 做 targeted correctness，PR CI 是唯一 authoritative full-test gate，Deploy 做 production verification。
